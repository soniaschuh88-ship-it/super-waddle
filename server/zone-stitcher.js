/**
 * server/zone-stitcher.js — Predictive Zone Prefetch + Boundary Smoothing
 *
 * Solves zone fragmentation before it happens:
 *
 *   PROBLEM: Player moves toward zone boundary → world not loaded → visible pop
 *   SOLUTION: Predict next zones from movement vector → prefetch → stitch seams
 *
 * Two sub-systems:
 *
 * ① PREDICTIVE PREFETCH
 *   Track peer position + velocity. Extrapolate 2-3 seconds ahead.
 *   Pre-generate/load zones the peer will need before they arrive.
 *   Handoff: transfer ledger events from old zone to new zone.
 *
 * ② SEAM SMOOTHING
 *   At zone boundaries (chunk seams), voxel values from adjacent zones
 *   can be discontinuous. Smooth by blending at the seam.
 *   Smoothing is VISUAL ONLY — canonical state unchanged.
 *   Uses 1-voxel overlap strip read from both sides.
 *
 * ③ ZONE BRIDGE DETECTION
 *   Detect isolated zone clusters (islands) that cannot communicate
 *   with the main cluster. Find shortest "bridge path" and assign
 *   relay peers to bridge the gap.
 */

import { EventEmitter } from 'events';
import { peerRegistry, chunkToZone, zoneCoords, zoneNeighbours } from './bkg-p2p.js';

// ── Config ────────────────────────────────────────────────────────────────────

const PREFETCH_AHEAD_S  = 3.0;      // seconds ahead to predict
const PEER_SPEED_VOXELS = 5 * 20;   // 5 voxels/tick × 20 ticks/s = 100 voxels/s default
const SMOOTH_STRIP      = 1;        // voxels of overlap to smooth at seam
const BRIDGE_MAX_HOPS   = 5;        // max hop count for bridge path
const STITCH_INTERVAL_MS = 2_000;
const VELOCITY_ALPHA     = 0.3;     // EMA smoothing for velocity estimation

// ── Peer movement tracker ──────────────────────────────────────────────────────

class PeerMovementTracker {
  constructor() {
    this._history = new Map();   // peerId → [{ wx,wy,wz,ts }] (last 5)
    this._velocity = new Map();  // peerId → { vx, vy, vz } (smoothed)
  }

  update(peerId, wx, wy, wz) {
    const now  = Date.now();
    const hist = this._history.get(peerId) ?? [];
    hist.push({ wx, wy, wz, ts: now });
    if (hist.length > 5) hist.shift();
    this._history.set(peerId, hist);

    // Update velocity estimate (EMA)
    if (hist.length >= 2) {
      const a = hist[hist.length - 2], b = hist[hist.length - 1];
      const dt = Math.max(1, b.ts - a.ts) / 1000;
      const raw = { vx: (b.wx-a.wx)/dt, vy: (b.wy-a.wy)/dt, vz: (b.wz-a.wz)/dt };
      const prev = this._velocity.get(peerId) ?? raw;
      this._velocity.set(peerId, {
        vx: prev.vx * (1-VELOCITY_ALPHA) + raw.vx * VELOCITY_ALPHA,
        vy: prev.vy * (1-VELOCITY_ALPHA) + raw.vy * VELOCITY_ALPHA,
        vz: prev.vz * (1-VELOCITY_ALPHA) + raw.vz * VELOCITY_ALPHA,
      });
    }
  }

  /**
   * Predict where this peer will be in `aheadS` seconds.
   * Returns { wx, wy, wz }
   */
  predict(peerId, aheadS = PREFETCH_AHEAD_S) {
    const hist = this._history.get(peerId);
    const vel  = this._velocity.get(peerId);
    if (!hist?.length) return null;

    const last = hist[hist.length - 1];
    const v    = vel ?? { vx: 0, vy: 0, vz: 0 };

    return {
      wx: Math.round(last.wx + v.vx * aheadS),
      wy: Math.round(last.wy + v.vy * aheadS),
      wz: Math.round(last.wz + v.vz * aheadS),
    };
  }

  /**
   * Predict which zones the peer will be in.
   * Returns [zoneId, ...] sorted by predicted arrival time.
   */
  predictZones(peerId, aheadS = PREFETCH_AHEAD_S) {
    const pos = this.predict(peerId, aheadS);
    if (!pos) return [];

    const cx   = pos.wx >> 5, cy = pos.wy >> 5, cz = pos.wz >> 5;
    const zone = chunkToZone(cx, cy, cz);
    return [zone, ...zoneNeighbours(zone).slice(0, 8)];
  }

  clearPeer(peerId) {
    this._history.delete(peerId);
    this._velocity.delete(peerId);
  }
}

// ── Seam smoother ─────────────────────────────────────────────────────────────

/**
 * Compute a blended seam strip for two adjacent zones.
 * Returns an array of { wx, wy, wz, value } patches to apply VISUALLY.
 *
 * @param {object} zoneA  — VSLedger
 * @param {object} zoneB  — VSLedger
 * @param {string} axis   — 'x' or 'z' (which axis the zones share)
 * @returns {Array<{key, blendedValue}>}
 */
export function computeSeamBlend(zoneA, zoneB, axis = 'x') {
  const patches = [];
  const { zx: zxA, zy: zyA, zz: zzA } = zoneCoords(zoneA.zoneId);
  const { zx: zxB, zy: zyB, zz: zzB } = zoneCoords(zoneB.zoneId);

  // Find the seam chunk coordinate
  const seamCxA = axis === 'x' ? Math.max(zxA, zxB) * 4 - 1 : (zxA) * 4;
  const seamCxB = axis === 'x' ? Math.max(zxA, zxB) * 4     : (zxB) * 4;
  const seamCzA = axis === 'z' ? Math.max(zzA, zzB) * 4 - 1 : (zzA) * 4;
  const seamCzB = axis === 'z' ? Math.max(zzA, zzB) * 4     : (zzB) * 4;

  // For each voxel in the seam column, blend values
  for (let ly = 0; ly < 32; ly++) {
    for (let lt = 0; lt < 32; lt++) {
      const keyA = axis === 'x'
        ? `${chunkHex(seamCxA)}${chunkHex(zyA * 4)}${chunkHex(seamCzA)}:31:${ly}:${lt}`
        : `${chunkHex(seamCxA)}${chunkHex(zyA * 4)}${chunkHex(seamCzA)}:${lt}:${ly}:31`;
      const keyB = axis === 'x'
        ? `${chunkHex(seamCxB)}${chunkHex(zyB * 4)}${chunkHex(seamCzB)}:0:${ly}:${lt}`
        : `${chunkHex(seamCxB)}${chunkHex(zyB * 4)}${chunkHex(seamCzB)}:${lt}:${ly}:0`;

      const vA = zoneA.voxelMap?.get(keyA)?.value ?? 0;
      const vB = zoneB.voxelMap?.get(keyB)?.value ?? 0;

      if (vA !== vB && vA !== 0 && vB !== 0) {
        // Blend: prefer the non-air value; if both solid, keep zone A (authority)
        const blended = vA !== 0 ? vA : vB;
        patches.push({ key: keyA, blendedValue: blended, original: vA });
        patches.push({ key: keyB, blendedValue: blended, original: vB });
      }
    }
  }

  return patches;
}

function chunkHex(n) { return Math.max(0, n).toString(16).padStart(4, '0'); }

// ── Zone bridge detection ──────────────────────────────────────────────────────

/**
 * BFS to find connected components in the active zone graph.
 * Returns {components: string[][], bridges: {from, to, via}[]}
 *
 * Islands = components with no relay-peer connection to main cluster.
 * Bridge = minimum path to reconnect them.
 */
export function analyzeZoneConnectivity(clusters) {
  const nodes = [...clusters.keys()];
  if (!nodes.length) return { components: [], bridges: [] };

  const adjacency = new Map(nodes.map(n => [n, []]));
  for (const node of nodes) {
    const neighbours = zoneNeighbours(node);
    for (const n of neighbours) {
      if (clusters.has(n)) adjacency.get(node).push(n);
    }
  }

  // BFS to find components
  const visited = new Set();
  const components = [];

  for (const start of nodes) {
    if (visited.has(start)) continue;
    const component = [];
    const queue     = [start];
    visited.add(start);

    while (queue.length) {
      const curr = queue.shift();
      component.push(curr);
      for (const next of adjacency.get(curr) ?? []) {
        if (!visited.has(next)) { visited.add(next); queue.push(next); }
      }
    }
    components.push(component);
  }

  // Find bridges needed to connect isolated components to the largest
  const bridges = [];
  if (components.length > 1) {
    const main    = components.sort((a, b) => b.length - a.length)[0];
    const mainSet = new Set(main);

    for (const comp of components.slice(1)) {
      // Find shortest path from comp to main cluster
      let found = false;
      for (const node of comp) {
        const { zx, zy, zz } = zoneCoords(node);
        for (const mNode of main) {
          const { zx: mx, zy: my, zz: mz } = zoneCoords(mNode);
          const dist = Math.abs(zx-mx) + Math.abs(zy-my) + Math.abs(zz-mz);
          if (dist <= BRIDGE_MAX_HOPS) {
            bridges.push({ from: node, to: mNode, distance: dist });
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
  }

  return { components, islands: components.slice(1), bridges };
}

// ── ZoneStitcher ──────────────────────────────────────────────────────────────

export class ZoneStitcher extends EventEmitter {
  constructor(clusterMgr) {
    super();
    this.mgr       = clusterMgr;
    this.tracker   = new PeerMovementTracker();
    this._timer    = null;
    this._running  = false;

    // Prefetch queue: zoneId → { requestedBy: peerId, ts }
    this.prefetchQueue  = new Map();

    // Seam patches pending application: zoneId → patches[]
    this.seamPatches    = new Map();

    // Connectivity analysis cache
    this.connectivity   = null;
    this._connLastUpdate = 0;

    this.stats = {
      prefetches:     0,
      seamsSmoothed:  0,
      bridgesBuilt:   0,
      peersTracked:   0,
    };
  }

  start() {
    this._running = true;
    this._timer   = setInterval(() => this._stitch(), STITCH_INTERVAL_MS);
    this._timer.unref?.();
    return this;
  }

  stop() {
    this._running = false;
    clearInterval(this._timer);
  }

  // ── Track peer movement ───────────────────────────────────────────────────

  trackPeer(peerId, wx, wy, wz) {
    this.tracker.update(peerId, wx, wy, wz);
    this.stats.peersTracked = this.tracker._history.size;
  }

  // ── Prefetch ──────────────────────────────────────────────────────────────

  /** Queue zones for prefetch based on peer movement prediction */
  prefetchForPeer(peerId) {
    const predictedZones = this.tracker.predictZones(peerId);
    const prefetched     = [];

    for (const zoneId of predictedZones) {
      if (!this.mgr.clusters.has(zoneId)) {
        this.prefetchQueue.set(zoneId, { requestedBy: peerId, ts: Date.now() });
        prefetched.push(zoneId);
      }
    }

    return prefetched;
  }

  // ── Seam smoothing ────────────────────────────────────────────────────────

  /**
   * Compute and cache seam blends for adjacent zones.
   * Returns the patch count.
   */
  smoothSeam(zoneIdA, zoneIdB, axis = 'x') {
    const clusterA = this.mgr.clusters.get(zoneIdA);
    const clusterB = this.mgr.clusters.get(zoneIdB);
    if (!clusterA || !clusterB) return 0;

    const patches = computeSeamBlend(clusterA.ledger, clusterB.ledger, axis);
    if (patches.length) {
      this.seamPatches.set(`${zoneIdA}|${zoneIdB}`, patches);
      this.stats.seamsSmoothed++;
    }
    return patches.length;
  }

  // ── Main stitch cycle ─────────────────────────────────────────────────────

  _stitch() {
    // 1. Prefetch predicted zones for all moving peers
    for (const [peerId] of peerRegistry.peers) {
      const prefetched = this.prefetchForPeer(peerId);
      if (prefetched.length) {
        for (const zoneId of prefetched) {
          this.mgr.getCluster(zoneId);  // creates + generates if needed
          this.stats.prefetches++;
          this.emit('prefetch', { zoneId, requestedBy: peerId });
        }
        this.prefetchQueue.clear();
      }
    }

    // 2. Smooth seams between adjacent loaded zones
    const zones = [...this.mgr.clusters.keys()];
    for (const zoneId of zones) {
      const neighbours = zoneNeighbours(zoneId);
      for (const nzId of neighbours) {
        if (this.mgr.clusters.has(nzId)) {
          const { zx: zxA, zy: zyA, zz: zzA } = zoneCoords(zoneId);
          const { zx: zxB, zz: zzB } = zoneCoords(nzId);
          const axis = zxA !== zxB ? 'x' : 'z';
          this.smoothSeam(zoneId, nzId, axis);
        }
      }
    }

    // 3. Zone connectivity analysis (every 10s)
    if (Date.now() - this._connLastUpdate > 10_000) {
      this.connectivity   = analyzeZoneConnectivity(this.mgr.clusters);
      this._connLastUpdate = Date.now();

      // Build bridges for isolated islands
      for (const bridge of this.connectivity.bridges ?? []) {
        this._buildBridge(bridge);
      }
    }
  }

  _buildBridge(bridge) {
    // Find an idle peer near the bridge path and assign them as relay
    const midX = Math.round((parseInt(bridge.from.split(':')[0],10) + parseInt(bridge.to.split(':')[0],10)) / 2) * 128 + 64;
    const midZ = Math.round((parseInt(bridge.from.split(':')[2],10) + parseInt(bridge.to.split(':')[2],10)) / 2) * 128 + 64;

    const idlePeers = [...peerRegistry.peers.values()]
      .filter(p => p.role === 'idle')
      .slice(0, 1);

    for (const peer of idlePeers) {
      peerRegistry.updatePosition(peer.id, midX, 0, midZ);
      this.stats.bridgesBuilt++;
      this.emit('bridge.built', { from: bridge.from, to: bridge.to, assignedPeer: peer.id });
    }
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  snapshot() {
    return {
      ...this.stats,
      prefetchQueueSize:  this.prefetchQueue.size,
      seamPatchCaches:    this.seamPatches.size,
      connectivity:       this.connectivity ? {
        components: this.connectivity.components?.length ?? 0,
        islands:    this.connectivity.islands?.length   ?? 0,
        bridges:    this.connectivity.bridges?.length   ?? 0,
      } : null,
    };
  }
}
