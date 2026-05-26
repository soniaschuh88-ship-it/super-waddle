/**
 * server/compositing-serverless.js — P2P Frame Composition
 *
 * No central compositing server.
 * Each peer receives tiles from its neighbours and assembles them locally.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  DATA FLOW
 *
 *  Peer A (renders tile 0,0) → broadcasts TileFrame to zone peers
 *  Peer B (renders tile 1,1) → broadcasts TileFrame to zone peers
 *  ...
 *  Each peer accumulates tiles → assembles complete frame locally
 *
 *  TILE FRAME  (what's broadcast)
 *  {
 *    type:     'tile.frame',
 *    tileId:   '1:1',
 *    seq:      number,       // frame sequence (monotonic per tile)
 *    peerId:   string,
 *    width:    number,       // pixel width of tile
 *    height:   number,
 *    encoding: 'raw' | 'rle' | 'jpeg_meta',  // metadata only in most cases
 *    bytes:    number,       // compressed size
 *    hash:     string,       // sha256 of pixel data (for verification)
 *    ts:       number,
 *  }
 *
 *  NOTE: Pixel data itself is transferred via WebRTC data channel (fast path).
 *        Server only handles metadata, coordination, and relay fallback.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  TEMPORAL SMOOTHING
 *  If a tile frame is missing (peer slow/dropped):
 *    Use last known good frame + alpha blend with estimated motion
 *    After 200ms: mark tile as "degraded" (lower resolution fallback)
 *    After 1000ms: show error texture for that tile
 *
 *  NPC EXECUTION SPLIT  (as requested)
 *    NPC Logic:    computed by zone SIMULATION_NODE (VSL authority)
 *    NPC Render:   delegated to nearest RENDER_NODE peer
 *    Server coordinates which render node handles which NPC cluster
 */

import { EventEmitter }      from 'events';
import { createHash }        from 'crypto';
import { peerRegistry }      from './bkg-p2p.js';
import { renderPartition }   from './render-partition.js';

// ── Config ────────────────────────────────────────────────────────────────────

const TILE_STALE_MS       = 200;    // tile frame older than this = stale
const TILE_DEGRADED_MS    = 500;    // degrade to lower LOD
const TILE_ERROR_MS       = 1500;   // show error state
const FRAME_BUFFER_MAX    = 3;      // frames to buffer per tile
const NPC_RENDER_RADIUS   = 4;      // chunks: nearest render peer within this radius

// ── TileFrameRecord ───────────────────────────────────────────────────────────

class TileFrameRecord {
  constructor(tileId) {
    this.tileId   = tileId;
    this.frames   = [];    // last FRAME_BUFFER_MAX frames
    this.seq      = 0;
    this.lastSeq  = -1;
    this.droppedFrames = 0;
  }

  record(frame) {
    // Detect out-of-order or duplicate
    if (frame.seq <= this.lastSeq) {
      this.droppedFrames++;
      return false;
    }
    this.lastSeq = frame.seq;
    this.frames.push({ ...frame, receivedAt: Date.now() });
    if (this.frames.length > FRAME_BUFFER_MAX) this.frames.shift();
    return true;
  }

  get latest() { return this.frames.at(-1) ?? null; }

  age() {
    const l = this.latest;
    return l ? Date.now() - l.receivedAt : Infinity;
  }

  quality() {
    const a = this.age();
    if (a < TILE_STALE_MS)    return 'fresh';
    if (a < TILE_DEGRADED_MS) return 'stale';
    if (a < TILE_ERROR_MS)    return 'degraded';
    return 'error';
  }
}

// ── NPC render assignment ─────────────────────────────────────────────────────

class NPCRenderAssigner {
  constructor() {
    this.assignments = new Map();  // npcId → renderPeerId
    this.peerNPCs    = new Map();  // renderPeerId → npcId[]
  }

  /**
   * Assign NPCs to the nearest render peer.
   * Called after NPC spawn by SIMULATION_NODE.
   *
   * @param {object[]} npcs  — { id, wx, wy, wz, zoneId }
   * @param {string}   zoneId
   */
  assign(npcs, zoneId) {
    const renderPeers = [...peerRegistry.peers.values()]
      .filter(p => p.role === 'render' || p.role === 'sim');

    if (!renderPeers.length) return;

    const changed = [];
    for (const npc of npcs) {
      // Find nearest render peer by world distance
      const nearest = renderPeers
        .map(p => {
          const dx = (p.cx ?? 0) * 32 - npc.wx;
          const dz = (p.cz ?? 0) * 32 - npc.wz;
          return { peer: p, d2: dx*dx + dz*dz };
        })
        .sort((a, b) => a.d2 - b.d2)[0];

      if (!nearest) continue;

      const peerId = nearest.peer.id;
      this.assignments.set(npc.id ?? npc.seed, peerId);

      if (!this.peerNPCs.has(peerId)) this.peerNPCs.set(peerId, []);
      const list = this.peerNPCs.get(peerId);
      if (!list.includes(npc.id ?? npc.seed)) list.push(npc.id ?? npc.seed);

      changed.push({ npcId: npc.id ?? npc.seed, renderPeer: peerId });
    }

    return changed;
  }

  /** Get all NPCs assigned to a peer for rendering */
  getNPCsForPeer(peerId) {
    return this.peerNPCs.get(peerId) ?? [];
  }

  /** Get render peer for a specific NPC */
  getRenderPeer(npcId) {
    return this.assignments.get(npcId) ?? null;
  }

  /** Reassign NPCs when a render peer drops */
  handlePeerDrop(droppedPeerId) {
    const orphaned = this.peerNPCs.get(droppedPeerId) ?? [];
    this.peerNPCs.delete(droppedPeerId);

    // Re-assign to remaining peers
    const remaining = [...peerRegistry.peers.values()]
      .filter(p => p.role === 'render' && p.id !== droppedPeerId);

    if (!remaining.length) { orphaned.forEach(id => this.assignments.delete(id)); return orphaned; }

    for (const npcId of orphaned) {
      const peer = remaining[Math.floor(Math.random() * remaining.length)];
      this.assignments.set(npcId, peer.id);
      if (!this.peerNPCs.has(peer.id)) this.peerNPCs.set(peer.id, []);
      this.peerNPCs.get(peer.id).push(npcId);
    }

    return orphaned;
  }

  stats() {
    return {
      totalNPCs:   this.assignments.size,
      renderPeers: this.peerNPCs.size,
      distribution:Object.fromEntries(
        [...this.peerNPCs.entries()].map(([k, v]) => [k.slice(0, 8), v.length]),
      ),
    };
  }
}

// ── CompositingCoordinator ────────────────────────────────────────────────────

export class CompositingCoordinator extends EventEmitter {
  constructor() {
    super();

    // Per-tile frame buffers
    this.tileBuffers = new Map();   // tileId → TileFrameRecord

    // NPC render assignment
    this.npcAssigner = new NPCRenderAssigner();

    // Frame assembly stats
    this.stats = {
      framesAssembled: 0,
      tilesStale:      0,
      tilesError:      0,
      avgFrameRateHz:  0,
      npcAssignments:  0,
    };

    // Frame rate tracking
    this._frameTs   = [];
    this._timer     = null;
    this._running   = false;
  }

  start() {
    this._running = true;
    this._timer   = setInterval(() => this._monitorFrames(), 100);  // 10 Hz monitor
    this._timer.unref?.();
    return this;
  }

  stop() {
    this._running = false;
    clearInterval(this._timer);
  }

  // ── Tile frame ingestion ───────────────────────────────────────────────

  /**
   * Record a tile frame submitted by a render peer.
   * This is metadata only — pixel data travels P2P.
   */
  recordTileFrame(frame) {
    const { tileId, seq, peerId, bytes = 0 } = frame;
    if (!tileId || !peerId) return false;

    if (!this.tileBuffers.has(tileId)) {
      this.tileBuffers.set(tileId, new TileFrameRecord(tileId));
    }

    const accepted = this.tileBuffers.get(tileId).record(frame);
    if (accepted) {
      renderPartition.recordFrame(peerId, tileId, seq, bytes);
      this._frameTs.push(Date.now());
      if (this._frameTs.length > 100) this._frameTs.shift();
    }

    return accepted;
  }

  // ── Frame monitoring ───────────────────────────────────────────────────

  _monitorFrames() {
    const now    = Date.now();
    let stale = 0, error = 0;

    for (const [tileId, buf] of this.tileBuffers) {
      const q = buf.quality();
      if (q === 'stale' || q === 'degraded') { stale++; }
      if (q === 'error')                      { error++; }

      // Request reassignment for errored tiles
      if (q === 'error') {
        const newPeer = renderPartition.reassignStaleTile(tileId);
        if (newPeer) {
          this.emit('tile.reassigned', { tileId, newPeer });
        }
      }
    }

    this.stats.tilesStale  = stale;
    this.stats.tilesError  = error;

    // Frame rate
    const recent = this._frameTs.filter(t => t > now - 1000).length;
    this.stats.avgFrameRateHz = recent;

    if (stale > 0 || error > 0) {
      this.emit('quality.update', { stale, error, ts: now });
    }
  }

  // ── NPC render split ───────────────────────────────────────────────────

  assignNPCRendering(npcs, zoneId) {
    const assignments = this.npcAssigner.assign(npcs, zoneId);
    this.stats.npcAssignments += assignments?.length ?? 0;

    if (assignments?.length) {
      // Notify render peers of their NPC responsibilities
      for (const { npcId, renderPeer } of assignments) {
        const ws = peerRegistry.getPeer(renderPeer)?.ws;
        if (ws?.readyState === 1) {
          try {
            ws.send(JSON.stringify({ type: 'npc.render', npcId, renderPeer }));
          } catch { /**/ }
        }
      }
    }

    return assignments;
  }

  /** Broadcast tile assignment to all zone peers via WebSocket */
  broadcastAssignment(assignment) {
    const msg = JSON.stringify({ type: 'render.assignment', tiles: assignment, ts: Date.now() });
    for (const peer of peerRegistry.peers.values()) {
      const ws = peer.ws;
      if (ws?.readyState === 1) { try { ws.send(msg); } catch { /**/ } }
    }
  }

  // ── Frame completeness ─────────────────────────────────────────────────

  /**
   * Check if a complete frame is available (all 9 tiles have fresh frames).
   */
  isFrameComplete(maxAgeMs = TILE_STALE_MS) {
    const tiles = renderPartition.tiles;
    for (const tile of tiles.values()) {
      const buf = this.tileBuffers.get(tile.id);
      if (!buf || buf.age() > maxAgeMs) return false;
    }
    return true;
  }

  /**
   * Get the "virtual frame" — metadata for all tiles, indicating
   * which peer rendered which tile and at what quality.
   */
  getFrameSummary() {
    const tiles = [...renderPartition.tiles.values()].map(tile => {
      const buf = this.tileBuffers.get(tile.id);
      return {
        id:      tile.id,
        col:     tile.col,
        row:     tile.row,
        peer:    tile.assignedPeer,
        quality: buf?.quality() ?? 'missing',
        seq:     buf?.lastSeq ?? -1,
        ageMs:   buf ? buf.age() : Infinity,
        lod:     tile.lod,
      };
    });

    return {
      tiles,
      complete:      this.isFrameComplete(),
      qualityMap:    tiles.map(t => t.quality),
      avgAgeMs:      +(tiles.reduce((s, t) => s + Math.min(t.ageMs, 9999), 0) / tiles.length).toFixed(1),
    };
  }

  // ── Stats ──────────────────────────────────────────────────────────────

  snapshot() {
    return {
      ...this.stats,
      frameSummary:  this.getFrameSummary(),
      npcAssigner:   this.npcAssigner.stats(),
      tileBuffers:   this.tileBuffers.size,
      running:       this._running,
    };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const compositor = new CompositingCoordinator().start();
