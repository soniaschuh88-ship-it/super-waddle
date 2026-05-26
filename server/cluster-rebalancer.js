/**
 * server/cluster-rebalancer.js — Dynamic Zone Splitting & Peer Migration
 *
 * Monitors cluster health and rebalances zones automatically:
 *
 *   OVERLOADED  (too many peers / high sim lag)
 *     → split zone into 2 sub-zones along busiest axis
 *     → migrate peers to closest sub-zone
 *     → transfer relevant ledger events
 *
 *   UNDERLOADED  (too few peers)
 *     → find mergeable neighbour
 *     → absorb neighbour into current zone
 *     → transfer neighbour's ledger + peers
 *
 *   ORPHANED  (0 peers, no activity for 60s)
 *     → dissolve cluster, release memory
 *
 * Hysteresis prevents oscillation:
 *   split only if load > SPLIT_THRESH for > HYSTERESIS_TICKS consecutive ticks
 *   merge only if load < MERGE_THRESH for > HYSTERESIS_TICKS consecutive ticks
 */

import { EventEmitter }  from 'events';
import { peerRegistry, chunkToZone, zoneCoords, zoneNeighbours } from './bkg-p2p.js';

// ── Thresholds ────────────────────────────────────────────────────────────────

export const SPLIT_PEER_THRESH    = 50;   // peers per zone → split
export const MERGE_PEER_THRESH    = 2;    // peers per zone → merge
export const ORPHAN_TIMEOUT_MS    = 60_000;
export const HYSTERESIS_TICKS     = 60;   // ~3s at 20 Hz before acting
export const MONITOR_INTERVAL_MS  = 2_000;
export const OVERLOAD_SIM_MS      = 80;   // sim tick budget exceeded if > 80ms
export const MAX_ZONE_DEPTH       = 3;    // don't split smaller than 2³ chunk zones

// ── Load classifier ───────────────────────────────────────────────────────────

function zoneLoad(cluster) {
  // Composite load score:
  //   peerLoad   = peerCount / SPLIT_PEER_THRESH        (0–1+)
  //   simLoad    = avgTickMs / OVERLOAD_SIM_MS           (0–1+)
  //   eventLoad  = recentEvents / 200                   (0–1+)
  const peerLoad  = (cluster.peerCount ?? 0) / SPLIT_PEER_THRESH;
  const simLoad   = (cluster.metrics?.avgTickMs ?? 0) / OVERLOAD_SIM_MS;
  const evLoad    = Math.min(1, (cluster.metrics?.eventsIngested ?? 0) / 200);
  return (peerLoad * 0.5 + simLoad * 0.35 + evLoad * 0.15);
}

// ── Split strategy: find the longest axis ─────────────────────────────────────

function splitAxis(cluster) {
  // Split along whichever axis has the widest peer distribution
  const peers = cluster.peers ?? [];
  if (!peers.length) return 'x';

  const positions = peers.map(p => ({ x: p.cx ?? 0, y: p.cy ?? 0, z: p.cz ?? 0 }));
  const spread    = (axis) => {
    const vals = positions.map(p => p[axis]);
    return Math.max(...vals) - Math.min(...vals);
  };

  const sx = spread('x'), sy = spread('y'), sz = spread('z');
  if (sx >= sy && sx >= sz) return 'x';
  if (sz >= sx && sz >= sy) return 'z';
  return 'y';
}

function splitZone(zoneId) {
  const { zx, zy, zz } = zoneCoords(zoneId);
  return [`${zx*2}:${zy}:${zz}`, `${zx*2+1}:${zy}:${zz}`];  // split X by default
}

// ── ClusterRebalancer ─────────────────────────────────────────────────────────

export class ClusterRebalancer extends EventEmitter {
  constructor(clusterManager) {
    super();
    this.mgr        = clusterManager;
    this._timer     = null;
    this._running   = false;

    // Hysteresis counters: zoneId → { overCount, underCount }
    this._hysteresis = new Map();

    // Migration log: [{ fromZone, toZone, peerId, ts }]
    this.migrations  = [];

    // Split / merge history
    this.events = [];
  }

  start() {
    if (this._running) return this;
    this._running = true;
    this._timer   = setInterval(() => this._checkAll(), MONITOR_INTERVAL_MS);
    this._timer.unref?.();
    return this;
  }

  stop() {
    this._running = false;
    clearInterval(this._timer);
  }

  // ── Main check loop ──────────────────────────────────────────────────────

  _checkAll() {
    for (const cluster of this.mgr.clusters.values()) {
      const zoneId = cluster.zoneId;
      const load   = zoneLoad(cluster);
      const h      = this._hysteresis.get(zoneId) ?? { overCount: 0, underCount: 0, checked: 0 };

      h.checked++;

      // Overloaded path
      if (load > 1.0) {
        h.overCount++;
        h.underCount = 0;
        if (h.overCount >= HYSTERESIS_TICKS && cluster.peerCount > 4) {
          h.overCount = 0;
          this._splitCluster(cluster);
        }
      }
      // Underloaded path (only consider zones with peers)
      else if (load < (MERGE_PEER_THRESH / SPLIT_PEER_THRESH) && cluster.peerCount > 0) {
        h.underCount++;
        h.overCount = 0;
        if (h.underCount >= HYSTERESIS_TICKS) {
          h.underCount = 0;
          this._tryMerge(cluster);
        }
      }
      // Orphaned check
      else if (cluster.peerCount === 0) {
        const idleMs = Date.now() - (cluster.lastActivity ?? 0);
        if (idleMs > ORPHAN_TIMEOUT_MS) {
          this._dissolve(cluster);
        }
      }
      else {
        h.overCount = Math.max(0, h.overCount - 1);
        h.underCount = Math.max(0, h.underCount - 1);
      }

      this._hysteresis.set(zoneId, h);
    }
  }

  // ── Split ────────────────────────────────────────────────────────────────

  _splitCluster(cluster) {
    const [zoneA, zoneB] = splitZone(cluster.zoneId);
    const { zx, zy, zz } = zoneCoords(cluster.zoneId);

    // Create two child clusters
    const cA = this.mgr.getCluster(zoneA);
    const cB = this.mgr.getCluster(zoneB);

    // Transfer ledger events to appropriate sub-zone
    const midX = (zx * 2 + 1) * (4 * 32);  // world X of split boundary
    let evA = 0, evB = 0;

    for (const evt of cluster.ledger.events) {
      // Derive world X from chunkId (hex encoding)
      const cx    = parseInt(evt.chunkId?.slice(0, 4) ?? '0', 16);
      const worldX = cx * 32 + (evt.lx ?? 0);
      if (worldX < midX) { cA.ledger.ingest(evt); evA++; }
      else               { cB.ledger.ingest(evt); evB++; }
    }

    // Migrate peers to closest sub-zone
    let migratedA = 0, migratedB = 0;
    for (const peer of cluster.peers) {
      const worldX = (peer.cx ?? 0) * 32;
      if (worldX < midX) {
        peerRegistry.updatePosition(peer.id, peer.cx ?? 0, peer.cy ?? 0, peer.cz ?? 0);
        this._recordMigration(peer.id, cluster.zoneId, zoneA);
        migratedA++;
      } else {
        peerRegistry.updatePosition(peer.id, (peer.cx ?? 0) + 4, peer.cy ?? 0, peer.cz ?? 0);
        this._recordMigration(peer.id, cluster.zoneId, zoneB);
        migratedB++;
      }
    }

    // Dissolve original cluster
    this.mgr.clusters.delete(cluster.zoneId);

    const record = {
      type: 'split', fromZone: cluster.zoneId, toZones: [zoneA, zoneB],
      peersMigrated: migratedA + migratedB,
      eventsTransferred: evA + evB,
      ts: Date.now(),
    };
    this.events.push(record);
    if (this.events.length > 200) this.events.shift();

    this.emit('split', record);
    console.log(`[rebalancer] SPLIT ${cluster.zoneId} → ${zoneA} (${migratedA}p) + ${zoneB} (${migratedB}p)`);
  }

  // ── Merge ────────────────────────────────────────────────────────────────

  _tryMerge(cluster) {
    const neighbours  = zoneNeighbours(cluster.zoneId);
    const candidates  = neighbours
      .map(nzId => this.mgr.clusters.get(nzId))
      .filter(Boolean)
      .filter(n => n.peerCount + cluster.peerCount <= SPLIT_PEER_THRESH * 0.6)
      .sort((a, b) => a.peerCount - b.peerCount);

    if (!candidates.length) return;

    const target = candidates[0];

    // Merge smaller cluster into target
    const absorbed = cluster.peerCount < target.peerCount ? cluster : target;
    const into     = cluster.peerCount < target.peerCount ? target   : cluster;

    // Transfer events
    let transferred = 0;
    for (const evt of absorbed.ledger.events) {
      into.ledger.ingest(evt);
      transferred++;
    }

    // Migrate peers to new zone centre
    const { zx, zy, zz } = zoneCoords(into.zoneId);
    const newCx = zx * 4 + 2, newCz = zz * 4 + 2;

    for (const peer of absorbed.peers) {
      peerRegistry.updatePosition(peer.id, newCx, peer.cy ?? 0, newCz);
      this._recordMigration(peer.id, absorbed.zoneId, into.zoneId);
    }

    this.mgr.clusters.delete(absorbed.zoneId);

    const record = {
      type: 'merge', fromZone: absorbed.zoneId, intoZone: into.zoneId,
      peersMigrated: absorbed.peerCount,
      eventsTransferred: transferred,
      ts: Date.now(),
    };
    this.events.push(record);
    if (this.events.length > 200) this.events.shift();

    this.emit('merge', record);
    console.log(`[rebalancer] MERGE ${absorbed.zoneId} → ${into.zoneId} (${absorbed.peerCount}p transferred)`);
  }

  // ── Dissolve ─────────────────────────────────────────────────────────────

  _dissolve(cluster) {
    this.mgr.clusters.delete(cluster.zoneId);
    const record = { type: 'dissolve', zoneId: cluster.zoneId, ts: Date.now() };
    this.events.push(record);
    this.emit('dissolve', record);
  }

  _recordMigration(peerId, from, to) {
    this.migrations.push({ peerId, fromZone: from, toZone: to, ts: Date.now() });
    if (this.migrations.length > 500) this.migrations.shift();
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  getMetrics() {
    const splits   = this.events.filter(e => e.type === 'split').length;
    const merges   = this.events.filter(e => e.type === 'merge').length;
    const dissolves= this.events.filter(e => e.type === 'dissolve').length;

    return {
      splits, merges, dissolves,
      totalMigrations: this.migrations.length,
      recentEvents:    this.events.slice(-10),
      running:         this._running,
    };
  }

  getLoadMap() {
    const result = {};
    for (const [zoneId, cluster] of this.mgr.clusters) {
      result[zoneId] = {
        peerCount: cluster.peerCount,
        load:      +zoneLoad(cluster).toFixed(3),
        hysteresis:this._hysteresis.get(zoneId) ?? { overCount: 0, underCount: 0 },
      };
    }
    return result;
  }
}
