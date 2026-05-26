/**
 * server/render-partition.js — Voxel Render Distribution Layer (VRDL)
 *
 * Solves: "10,000 players see the same world without any machine dying"
 *
 * Principle: No peer renders the full frame.
 * Each peer renders only their assigned TILE(s).
 * Tiles are composed client-side into the final frame.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  TILE GRID  (default 3×3 = 9 screen-space tiles)
 *
 *  [ 0,0 ][ 1,0 ][ 2,0 ]   ← top row    (sky, far terrain)
 *  [ 0,1 ][ 1,1 ][ 2,1 ]   ← mid row    (player view zone)
 *  [ 0,2 ][ 1,2 ][ 2,2 ]   ← bottom row (ground, near combat)
 *
 *  Each tile = { col, row, cost, assignedPeer, lodLevel }
 *
 *  COST MODEL  (render budget estimate per tile)
 *    triangles     — greedy-mesh triangle count in tile frustum
 *    lights        — dynamic lights (lava, fire, data cores)
 *    entities      — NPCs + players in tile region
 *    dynamicVoxels — recently changed voxels (dirty chunks)
 *
 *  ASSIGNMENT  — greedy bin packing
 *    sort tiles by cost DESC
 *    sort peers by GPU budget DESC
 *    assign each tile to the peer with most remaining capacity
 *    rebalance every REBALANCE_INTERVAL_MS
 * ─────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'events';
import { peerRegistry  } from './bkg-p2p.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const GRID_COLS    = 3;
export const GRID_ROWS    = 3;
export const TILE_COUNT   = GRID_COLS * GRID_ROWS;   // 9

// GPU budget in "tile units" per peer GPU tier
export const GPU_BUDGET = Object.freeze({
  0: 0.25,   // integrated / CPU-only
  1: 0.75,   // mobile / low GPU
  2: 2.0,    // mid-range (most desktops)
  3: 4.0,    // high-end (gaming GPU)
});

// Render cost weights
const W_TRIANGLES   = 0.001;  // per 1000 triangles
const W_LIGHTS      = 0.15;   // per dynamic light
const W_ENTITIES    = 0.08;   // per entity
const W_DYNAMICS    = 0.02;   // per dirty voxel

// LOD level assigned per tile based on distance from camera centre
const LOD_BY_DISTANCE = [0, 0, 1, 1, 2, 2];  // index = Manhattan dist from centre

const REBALANCE_INTERVAL_MS = 5_000;

// ── Tile spec ──────────────────────────────────────────────────────────────────

export function makeTile(col, row) {
  return {
    id:          `${col}:${row}`,
    col, row,
    // World-space fraction [0,1] this tile covers
    uMin:        col       / GRID_COLS,
    uMax:        (col + 1) / GRID_COLS,
    vMin:        row       / GRID_ROWS,
    vMax:        (row + 1) / GRID_ROWS,
    // Dynamic
    cost:        1.0,
    lod:         0,
    assignedPeer:null,
    frameTs:     0,   // when we last received a rendered frame for this tile
    stale:       true,
  };
}

/** Distance from tile to centre tile (Manhattan on grid) */
function distFromCentre(col, row) {
  const cc = Math.floor(GRID_COLS / 2), cr = Math.floor(GRID_ROWS / 2);
  return Math.abs(col - cc) + Math.abs(row - cr);
}

// ── Cost model ────────────────────────────────────────────────────────────────

/**
 * Estimate render cost for a tile.
 * Higher cost = needs a better GPU peer.
 *
 * @param {object} tile
 * @param {object} worldSnapshot — from VoxelEngine / VLDB
 */
export function estimateTileCost(tile, worldSnapshot = {}) {
  const {
    trianglesInView  = 50_000,   // total triangle estimate
    lightsInView     = 4,
    entitiesInView   = 20,
    dirtyVoxels      = 100,
  } = worldSnapshot;

  // Each tile gets a share of the world cost proportional to its screen area
  const area         = (tile.uMax - tile.uMin) * (tile.vMax - tile.vMin);

  // Centre tiles (mid row) have higher entity density
  const entityFactor = (tile.row === 1) ? 1.5 : 1.0;
  // Top row is sky — lower triangle count
  const triFactor    = (tile.row === 0) ? 0.4 : 1.0;
  // Bottom row has near-geometry: more detail
  const geoFactor    = (tile.row === 2) ? 1.3 : 1.0;

  const base = (
    trianglesInView * area * triFactor * geoFactor * W_TRIANGLES +
    lightsInView    * area * W_LIGHTS                             +
    entitiesInView  * area * entityFactor * W_ENTITIES            +
    dirtyVoxels     * area * W_DYNAMICS
  );

  return Math.max(0.1, +base.toFixed(3));
}

// ── Greedy bin packing ────────────────────────────────────────────────────────

/**
 * Assign tiles to peers via greedy bin packing.
 *
 * Algorithm:
 *   1. Sort tiles by cost DESC (hardest first)
 *   2. Sort peers by GPU budget DESC (best first)
 *   3. Assign each tile to the peer with the most remaining capacity
 *   4. If no peer can take it (all over budget): assign to peer with highest tier
 *
 * @param {object[]} tiles   — tile specs with .cost set
 * @param {object[]} peers   — peerInfo objects with .gpuTier
 * @returns {Map<peerId, string[]>}  peerId → tileId[]
 */
export function assignTiles(tiles, peers) {
  if (!peers.length) return new Map();

  // Build peer records with remaining budget
  const peerState = peers.map(p => ({
    id:        p.id,
    budget:    GPU_BUDGET[p.gpuTier ?? 0] ?? 0.25,
    remaining: GPU_BUDGET[p.gpuTier ?? 0] ?? 0.25,
    assigned:  [],
    load:      0,
    gpuTier:   p.gpuTier ?? 0,
  })).sort((a, b) => b.budget - a.budget);

  // Sort tiles by cost descending
  const sorted = [...tiles].sort((a, b) => (b.cost ?? 1) - (a.cost ?? 1));

  const result = new Map(peerState.map(p => [p.id, []]));

  for (const tile of sorted) {
    const cost = tile.cost ?? 1;

    // Find best-fit peer: highest remaining budget that can accommodate tile
    const eligible = peerState.filter(p => p.remaining >= cost * 0.7);  // 30% overflow allowed
    const target   = eligible.length
      ? eligible.sort((a, b) => b.remaining - a.remaining)[0]
      : peerState.sort((a, b) => b.gpuTier - a.gpuTier)[0];  // fallback: best GPU

    target.assigned.push(tile.id);
    target.remaining -= cost;
    target.load      += cost;
    result.get(target.id)?.push(tile.id);
  }

  return result;
}

// ── RenderPartitionManager ────────────────────────────────────────────────────

export class RenderPartitionManager extends EventEmitter {
  constructor() {
    super();

    // Build the tile grid
    this.tiles = new Map();
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const t  = makeTile(c, r);
        t.lod    = LOD_BY_DISTANCE[Math.min(distFromCentre(c, r), LOD_BY_DISTANCE.length - 1)];
        this.tiles.set(t.id, t);
      }
    }

    // Current assignment: peerId → tileId[]
    this.assignment  = new Map();

    // Per-tile frame receipt tracking
    this.frameBuffer = new Map();   // tileId → { peerId, receivedAt, seq }

    // Performance metrics
    this.metrics = {
      rebalances:   0,
      framesRecv:   0,
      tilesMissed:  0,
      avgCost:      1.0,
    };

    this._timer   = null;
    this._running = false;
    this._worldSnapshot = {};
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  start() {
    this._running = true;
    this._timer   = setInterval(() => this.rebalance(), REBALANCE_INTERVAL_MS);
    this._timer.unref?.();
    return this;
  }

  stop() {
    this._running = false;
    clearInterval(this._timer);
  }

  // ── World state injection ──────────────────────────────────────────────

  updateWorldSnapshot(snapshot) {
    this._worldSnapshot = { ...this._worldSnapshot, ...snapshot };
    // Recompute tile costs
    for (const tile of this.tiles.values()) {
      tile.cost = estimateTileCost(tile, this._worldSnapshot);
    }
    this.metrics.avgCost = [...this.tiles.values()].reduce((s, t) => s + t.cost, 0) / this.tiles.size;
  }

  // ── Assignment ─────────────────────────────────────────────────────────

  rebalance() {
    const peers = [...peerRegistry.peers.values()];
    if (!peers.length) return;

    const tiles      = [...this.tiles.values()];
    const assignment = assignTiles(tiles, peers);

    // Apply assignment to tiles
    for (const [peerId, tileIds] of assignment) {
      for (const tileId of tileIds) {
        const tile = this.tiles.get(tileId);
        if (tile) tile.assignedPeer = peerId;
      }
    }

    this.assignment = assignment;
    this.metrics.rebalances++;

    this.emit('assignment.updated', {
      assignment: Object.fromEntries(assignment),
      tileCount:  this.tiles.size,
      peerCount:  peers.length,
    });

    return assignment;
  }

  /** Get tile assignments for a specific peer */
  getPeerAssignment(peerId) {
    return (this.assignment.get(peerId) ?? []).map(id => this.tiles.get(id)).filter(Boolean);
  }

  /** Get full assignment map as serialisable object */
  getAssignmentMap() {
    const out = {};
    for (const [peerId, tileIds] of this.assignment) {
      out[peerId] = tileIds.map(id => {
        const t = this.tiles.get(id);
        return t ? { id: t.id, col: t.col, row: t.row, cost: t.cost, lod: t.lod, uMin: t.uMin, uMax: t.uMax, vMin: t.vMin, vMax: t.vMax } : null;
      }).filter(Boolean);
    }
    return out;
  }

  // ── Frame receipt tracking ─────────────────────────────────────────────

  /**
   * Record that a peer has submitted a rendered tile frame.
   * @param {string} peerId
   * @param {string} tileId
   * @param {number} seq   — frame sequence number
   * @param {number} bytes — compressed frame size
   */
  recordFrame(peerId, tileId, seq, bytes = 0) {
    const tile = this.tiles.get(tileId);
    if (tile) tile.frameTs = Date.now();

    this.frameBuffer.set(tileId, { peerId, receivedAt: Date.now(), seq, bytes });
    this.metrics.framesRecv++;

    this.emit('frame.received', { peerId, tileId, seq, bytes });
  }

  /**
   * Detect stale tiles: assigned but no frame received in > maxAgeMs.
   */
  getStaleTiles(maxAgeMs = 200) {
    const now    = Date.now();
    const stale  = [];
    for (const tile of this.tiles.values()) {
      const last = this.frameBuffer.get(tile.id);
      if (!last || now - last.receivedAt > maxAgeMs) {
        stale.push({ ...tile, lastFrameMs: last ? now - last.receivedAt : Infinity });
      }
    }
    this.metrics.tilesMissed = stale.length;
    return stale;
  }

  /** Which peer should render a stale tile (reassign to fastest available) */
  reassignStaleTile(tileId) {
    const tile  = this.tiles.get(tileId);
    if (!tile) return null;

    // Find peer with most remaining capacity + lowest latency
    const peers  = [...peerRegistry.peers.values()]
      .sort((a, b) => (a.lat ?? 999) - (b.lat ?? 999))
      .filter(p => p.gpuTier > 0);

    if (!peers.length) return null;

    tile.assignedPeer = peers[0].id;
    const list = this.assignment.get(peers[0].id) ?? [];
    if (!list.includes(tileId)) list.push(tileId);
    this.assignment.set(peers[0].id, list);

    this.emit('tile.reassigned', { tileId, newPeer: peers[0].id });
    return peers[0].id;
  }

  // ── Stats ──────────────────────────────────────────────────────────────

  snapshot() {
    const frameAge = [...this.frameBuffer.values()];
    const avgFrameMs = frameAge.length
      ? frameAge.reduce((s, f) => s + (Date.now() - f.receivedAt), 0) / frameAge.length
      : 0;

    return {
      tiles:       [...this.tiles.values()].map(t => ({
        id: t.id, col: t.col, row: t.row, cost: t.cost, lod: t.lod,
        peer: t.assignedPeer, frameAge: t.frameTs ? Date.now() - t.frameTs : null,
      })),
      assignment:  Object.fromEntries(
        [...this.assignment.entries()].map(([k, v]) => [k.slice(0, 8), v]),
      ),
      metrics:     { ...this.metrics, avgFrameMs: +avgFrameMs.toFixed(1) },
      running:     this._running,
    };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const renderPartition = new RenderPartitionManager().start();
