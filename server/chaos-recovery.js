/**
 * server/chaos-recovery.js — Chaos Recovery Kernel (Orchestrator)
 *
 * The final layer that keeps the distributed voxel universe alive under:
 *   • Packet loss          → speculative replay + forward correction
 *   • Peer dropout         → zone re-assignment + state hand-off
 *   • Latency spikes       → speculative execution during blackout
 *   • Malicious peers      → trust scoring + event rejection
 *   • Zone fragmentation   → predictive stitching + seam healing
 *
 * Four recovery strategies — selected by observed chaos type:
 *
 *   STRATEGY A — Speculative Replay
 *     Apply events optimistically, correct forward when truth arrives.
 *     No rollback. Patches only diverged voxels. (see speculative-replay.js)
 *
 *   STRATEGY B — State Healing
 *     CRC-validate chunk state, identify corrupted voxels, fetch
 *     canonical patches from most-trusted peer. (see state-healer.js)
 *
 *   STRATEGY C — Fork Healing (Forward Merge)
 *     Merge diverged branches forward using canonical reduce().
 *     Apply only the diff (not a rollback). (extends vsl-conflict-resolver.js)
 *
 *   STRATEGY D — Zone Stitching
 *     Predict peer movement, pre-fetch zones, smooth chunk seams.
 *     (see zone-stitcher.js)
 *
 * Chaos detection heuristics:
 *   PACKET_LOSS    — sequence gap in peer event stream > 3 events
 *   PEER_DROPOUT   — peer silent for > 5s when expected to sim
 *   LATENCY_SPIKE  — round-trip latency > 500ms (peer reports)
 *   MALICIOUS_PEER — event rate > 1000/s OR tampered signatures
 *   FRAGMENTATION  — zone with no peers but non-empty ledger
 */

import { EventEmitter }    from 'events';
import { createHash }      from 'crypto';
import { peerRegistry }    from './bkg-p2p.js';
import { conflictResolver }from './vsl-conflict-resolver.js';
import { interestManager } from './interest-manager.js';
import { getTickSync }     from './tick-sync.js';

// ── Chaos types ───────────────────────────────────────────────────────────────

export const CHAOS = Object.freeze({
  PACKET_LOSS:    'packet_loss',
  PEER_DROPOUT:   'peer_dropout',
  LATENCY_SPIKE:  'latency_spike',
  MALICIOUS_PEER: 'malicious_peer',
  FRAGMENTATION:  'fragmentation',
  FORK:           'fork',
  CORRUPTION:     'corruption',
});

// ── Thresholds ────────────────────────────────────────────────────────────────

const DROPOUT_TIMEOUT_MS    = 5_000;   // sim-node silent for 5s → dropout
const LATENCY_SPIKE_MS      = 500;     // round-trip > 500ms → spike detected
const EVENT_RATE_LIMIT      = 1000;    // events/s per peer → malicious
const SEQ_GAP_THRESHOLD     = 3;       // event sequence gaps → packet loss
const FRAGMENTED_TIMEOUT_MS = 15_000;  // zone with no peers but active ledger
const HEAL_INTERVAL_MS      = 3_000;   // chaos scan frequency
const MAX_CHAOS_HISTORY      = 200;

// ── Trust scoring ─────────────────────────────────────────────────────────────

/**
 * Compute a trust score for a peer (0.0 = untrusted, 1.0 = fully trusted).
 * Used to select which peer to request canonical state from during healing.
 *
 * Factors:
 *   proofBlocks    — how many valid state proofs they've contributed
 *   clockQuality   — GOOD=1.0 FAIR=0.7 POOR=0.4 DRIFTED=0.0
 *   role           — sim-node=1.0 backup=0.8 render=0.6 relay=0.4 idle=0.2
 *   latency        — lower is better (normalized to 0-1)
 *   badEvents      — tampered event count (hard penalty)
 */
export function peerTrustScore(peerId, metrics = {}) {
  const proofScore   = Math.min(1, (metrics.proofBlocks ?? 0) / 20);
  const clockScore   = [1.0, 0.7, 0.4, 0.0][metrics.clockQuality ?? 1];
  const roleScore    = { sim:1.0, backup:0.8, render:0.6, relay:0.4, idle:0.2 }[metrics.role ?? 'idle'];
  const latScore     = 1 - Math.min(1, (metrics.latencyMs ?? 200) / 1000);
  const penaltyScore = Math.max(0, 1 - (metrics.badEvents ?? 0) * 0.2);

  return +((proofScore * 0.30 +
            clockScore * 0.25 +
            roleScore  * 0.20 +
            latScore   * 0.15 +
            penaltyScore * 0.10)).toFixed(3);
}

// ── ChaosEvent ────────────────────────────────────────────────────────────────

function makeChaosEvent(type, zoneId, data = {}) {
  return { type, zoneId, data, ts: Date.now(), recovered: false, strategy: null };
}

// ── ChaosRecoveryKernel ───────────────────────────────────────────────────────

export class ChaosRecoveryKernel extends EventEmitter {
  constructor(clusterMgr) {
    super();
    this.mgr        = clusterMgr;
    this._timer     = null;
    this._running   = false;

    // Per-peer event rate tracking (for malicious detection)
    this._peerEventCounts = new Map();  // peerId → { count, windowStart }

    // Per-peer sequence tracking (for packet-loss detection)
    this._peerSequences   = new Map();  // peerId → lastSeq

    // Per-peer latency history
    this._peerLatency     = new Map();  // peerId → latencyMs[]

    // Trust score cache (refresh every heal cycle)
    this._trustScores     = new Map();  // peerId → score

    // Chaos history
    this.history          = [];
    this.stats = {
      scans:       0,
      detected:    { [CHAOS.PACKET_LOSS]: 0, [CHAOS.PEER_DROPOUT]: 0,
                     [CHAOS.LATENCY_SPIKE]: 0, [CHAOS.MALICIOUS_PEER]: 0,
                     [CHAOS.FRAGMENTATION]: 0, [CHAOS.FORK]: 0, [CHAOS.CORRUPTION]: 0 },
      recovered:   0,
      failed:      0,
      trustEvictions: 0,
    };
  }

  start() {
    if (this._running) return this;
    this._running = true;
    this._timer   = setInterval(() => this._scan(), HEAL_INTERVAL_MS);
    this._timer.unref?.();
    return this;
  }

  stop() {
    this._running = false;
    clearInterval(this._timer);
  }

  // ── Real-time event tracking ──────────────────────────────────────────────

  /** Track incoming event from peer (call from message handler) */
  trackEvent(peerId, event) {
    // Event rate tracking (malicious detection)
    const now   = Date.now();
    const rate  = this._peerEventCounts.get(peerId) ?? { count: 0, windowStart: now };
    if (now - rate.windowStart > 1000) {
      rate.count = 0; rate.windowStart = now;
    }
    rate.count++;
    this._peerEventCounts.set(peerId, rate);

    // Sequence gap tracking (packet loss detection)
    const seq  = event.seq;
    if (seq !== undefined) {
      const last = this._peerSequences.get(peerId);
      if (last !== undefined && seq - last > SEQ_GAP_THRESHOLD) {
        this._detectPacketLoss(peerId, last, seq, event.chunkId ?? '?');
      }
      this._peerSequences.set(peerId, seq);
    }
  }

  /** Record a latency measurement for a peer */
  trackLatency(peerId, latencyMs) {
    const history = this._peerLatency.get(peerId) ?? [];
    history.push(latencyMs);
    if (history.length > 10) history.shift();
    this._peerLatency.set(peerId, history);

    const avg = history.reduce((s, v) => s + v, 0) / history.length;
    if (avg > LATENCY_SPIKE_MS && history.length >= 3) {
      this._detectLatencySpike(peerId, avg);
    }
  }

  /** Report a signature failure for a peer (from verifyEvent) */
  reportBadEvent(peerId, event) {
    const score = this._trustScores.get(peerId) ?? 0.8;
    this._trustScores.set(peerId, Math.max(0, score - 0.2));

    const metrics = this._peerMetrics(peerId);
    if (metrics.badEvents >= 5 || score - 0.2 <= 0.2) {
      this._detectMalicious(peerId, 'tampered_event');
    }
  }

  // ── Periodic scan ─────────────────────────────────────────────────────────

  _scan() {
    this.stats.scans++;
    this._refreshTrustScores();

    for (const cluster of this.mgr.clusters.values()) {
      // PEER_DROPOUT: sim-node has been silent
      this._checkDropout(cluster);

      // FRAGMENTATION: zone with ledger but no peers
      this._checkFragmentation(cluster);

      // MALICIOUS_PEER: excessive event rate
      this._checkEventRates(cluster);
    }

    // FORK: check conflict resolver for active forks
    const activeForks = conflictResolver.getActiveForks();
    for (const fork of activeForks) {
      if (fork.ageMs > 5000 && !this.history.find(e => e.data?.forkId === fork.id)) {
        this._recoverFork(fork);
      }
    }
  }

  _checkDropout(cluster) {
    const authId = cluster.authority;
    if (!authId) return;

    const auth = peerRegistry.getPeer(authId);
    const silent = !auth || (Date.now() - (auth.lastSeen ?? 0)) > DROPOUT_TIMEOUT_MS;

    if (silent && cluster.peerCount > 0) {
      const evt = makeChaosEvent(CHAOS.PEER_DROPOUT, cluster.zoneId, { droppedPeer: authId });
      this._dispatch(evt, cluster);
    }
  }

  _checkFragmentation(cluster) {
    if (cluster.peerCount > 0) return;
    if (!cluster.isActive?.() && cluster.ledger?.events?.length > 0) {
      const evt = makeChaosEvent(CHAOS.FRAGMENTATION, cluster.zoneId, {
        eventCount:  cluster.ledger.events.length,
        voxelCount:  cluster.ledger.voxelMap?.size ?? 0,
        lastActivity:cluster.lastActivity,
      });
      this._dispatch(evt, cluster);
    }
  }

  _checkEventRates(cluster) {
    for (const peer of cluster.peers ?? []) {
      const rate = this._peerEventCounts.get(peer.id);
      if (rate && rate.count > EVENT_RATE_LIMIT) {
        this._detectMalicious(peer.id, 'flood_attack');
      }
    }
  }

  // ── Detection handlers ────────────────────────────────────────────────────

  _detectPacketLoss(peerId, lastSeq, currentSeq, zoneId) {
    const gap = currentSeq - lastSeq;
    const evt = makeChaosEvent(CHAOS.PACKET_LOSS, zoneId, { peerId, lastSeq, currentSeq, gap });
    this.stats.detected[CHAOS.PACKET_LOSS]++;
    this._recordHistory(evt);
    this._recoverPacketLoss(evt, peerId, lastSeq, currentSeq);
    this.emit('chaos', evt);
  }

  _detectLatencySpike(peerId, avgMs) {
    const peer = peerRegistry.getPeer(peerId);
    const evt  = makeChaosEvent(CHAOS.LATENCY_SPIKE, peer?.zoneId ?? '?', { peerId, avgMs });
    this.stats.detected[CHAOS.LATENCY_SPIKE]++;
    this._recordHistory(evt);
    this._recoverLatencySpike(evt, peerId);
    this.emit('chaos', evt);
  }

  _detectMalicious(peerId, reason) {
    const peer = peerRegistry.getPeer(peerId);
    const evt  = makeChaosEvent(CHAOS.MALICIOUS_PEER, peer?.zoneId ?? '?', { peerId, reason });
    this.stats.detected[CHAOS.MALICIOUS_PEER]++;
    this._recordHistory(evt);
    this._recoverMalicious(evt, peerId);
    this.emit('chaos', evt);
  }

  // ── Recovery strategies ───────────────────────────────────────────────────

  /** STRATEGY A: Packet loss → request re-sync from trusted peer */
  _recoverPacketLoss(evt, peerId, fromSeq, toSeq) {
    evt.strategy = 'speculative_replay';

    // Find the most trusted peer in the zone to request missed events from
    const cluster = this.mgr.clusters.get(evt.zoneId);
    if (!cluster) return;

    const trusted = this._mostTrustedPeer(cluster.peers ?? [], peerId);
    if (!trusted) return;

    // Signal trusted peer to re-broadcast missed events
    const ws = peerRegistry.getPeer(trusted.id)?.ws;
    if (ws?.readyState === 1) {
      try {
        ws.send(JSON.stringify({
          type:    'sync.request',
          from:    peerId,
          fromSeq,
          toSeq,
          zoneId:  evt.zoneId,
        }));
        evt.recovered = true;
        this.stats.recovered++;
      } catch { this.stats.failed++; }
    }

    this._recordHistory(evt);
    this.emit('recovery', evt);
  }

  /** STRATEGY B: Peer dropout → demote + promote backup */
  _dispatch(evt, cluster) {
    this.stats.detected[evt.type]++;

    switch (evt.type) {
      case CHAOS.PEER_DROPOUT:
        this._recoverDropout(evt, cluster);
        break;
      case CHAOS.FRAGMENTATION:
        this._recoverFragmentation(evt, cluster);
        break;
      default:
        evt.strategy = 'no-op';
        this._recordHistory(evt);
    }
    this.emit('chaos', evt);
  }

  _recoverDropout(evt, cluster) {
    evt.strategy = 'promote_backup';

    // Use peerRegistry cluster roles, or fall back to second peer by join order
    const clusterRoles = peerRegistry.getCluster(cluster.zoneId);
    const backupId = clusterRoles?.backupNode ?? cluster.peers?.[1]?.id ?? cluster.peers?.[0]?.id;

    if (backupId && backupId !== evt.data.droppedPeer) {
      // Promote backup by rebalancing roles
      const peers = (cluster.peers ?? []).map(p => p.id).filter(id => id !== evt.data.droppedPeer).sort();
      cluster.ledger.authority.setPeers(peers);
      // Force next slot
      cluster.ledger.authority.tick = Math.ceil(cluster.ledger.authority.tick / 100 + 1) * 100;

      evt.recovered = true;
      evt.data.newAuthority = cluster.authority;
      this.stats.recovered++;

      // Notify zone peers
      for (const peer of cluster.peers ?? []) {
        const ws = peerRegistry.getPeer(peer.id)?.ws;
        if (ws?.readyState === 1) {
          try { ws.send(JSON.stringify({ type: 'authority', peerId: cluster.authority, tick: cluster.ledger.authority.tick, zoneId: cluster.zoneId, reason: 'dropout_recovery' })); } catch { /**/ }
        }
      }
    }

    this._recordHistory(evt);
    this.emit('recovery', evt);
  }

  /** STRATEGY C: Fork healing → forward merge, no rollback */
  _recoverFork(fork) {
    const evt     = makeChaosEvent(CHAOS.FORK, fork.zoneId, { forkId: fork.id, forkTick: fork.forkTick });
    evt.strategy  = 'forward_merge';

    // Force resolution with events we have
    const result = conflictResolver.forceResolve(fork.id);
    if (result) {
      // Apply canonical state FORWARD (patch only diverged voxels)
      const cluster = this.mgr.getCluster(fork.zoneId);
      conflictResolver.applyToLedger(cluster.ledger, result.voxelMap, result.stateHash);
      evt.recovered  = true;
      evt.data.stateHash    = result.stateHash;
      evt.data.patchedVoxels= result.appliedCount;
      this.stats.recovered++;
    } else {
      this.stats.failed++;
    }

    this.stats.detected[CHAOS.FORK]++;
    this._recordHistory(evt);
    this.emit('chaos', evt);
    if (evt.recovered) this.emit('recovery', evt);
  }

  /** STRATEGY D: Zone fragmentation → assign idle peer to simulate */
  _recoverFragmentation(evt, cluster) {
    evt.strategy = 'idle_peer_assignment';

    const idlePeers = [...peerRegistry.peers.values()]
      .filter(p => p.role === 'idle' || p.computeFarm)
      .sort((a, b) => (a.lat ?? 999) - (b.lat ?? 999));

    if (idlePeers.length > 0) {
      const candidate = idlePeers[0];
      // Migrate idle peer to fragmented zone
      const { zx, zy, zz } = { zx: parseInt(cluster.zoneId.split(':')[0], 10) || 0,
                                zy: parseInt(cluster.zoneId.split(':')[1], 10) || 0,
                                zz: parseInt(cluster.zoneId.split(':')[2], 10) || 0 };
      peerRegistry.updatePosition(candidate.id, zx * 128 + 64, zy * 128, zz * 128 + 64);

      // Notify the peer
      const ws = candidate.ws;
      if (ws?.readyState === 1) {
        try {
          ws.send(JSON.stringify({
            type:     'chaos.assignment',
            strategy: 'simulate_fragmented_zone',
            zoneId:   cluster.zoneId,
            events:   cluster.ledger.eventsSince(0, 100),
          }));
          evt.recovered = true;
          evt.data.assignedPeer = candidate.id;
          this.stats.recovered++;
        } catch { this.stats.failed++; }
      }
    } else {
      this.stats.failed++;
    }

    this._recordHistory(evt);
    this.emit('recovery', evt);
  }

  _recoverLatencySpike(evt, peerId) {
    evt.strategy = 'throttle_bandwidth';
    // Throttle this peer's bandwidth tier during the spike
    const { bandwidthShaper } = this._deps ?? {};
    if (bandwidthShaper) {
      bandwidthShaper.setTier(peerId, 'throttled');
      // Auto-restore after 10s
      setTimeout(() => bandwidthShaper.setTier(peerId, 'normal'), 10_000);
      evt.recovered = true;
      this.stats.recovered++;
    }
    this._recordHistory(evt);
    this.emit('recovery', evt);
  }

  _recoverMalicious(evt, peerId) {
    evt.strategy  = 'peer_eviction';
    peerRegistry.leave(peerId);
    this.stats.trustEvictions++;
    evt.recovered = true;
    this.stats.recovered++;
    this._recordHistory(evt);
    this.emit('recovery', evt);
  }

  // ── Trust management ──────────────────────────────────────────────────────

  _refreshTrustScores() {
    for (const [peerId, peer] of peerRegistry.peers) {
      const clockQuality = getTickSync(peer.zoneId ?? '0:0:0')
        ._peerReports?.get(peerId)?.quality ?? 1;
      const score = peerTrustScore(peerId, {
        proofBlocks:  0,   // TODO: track from proofChain
        clockQuality,
        role:         peer.role,
        latencyMs:    peer.lat ?? 200,
        badEvents:    this._badEventCount(peerId),
      });
      this._trustScores.set(peerId, score);
    }
  }

  _badEventCount(peerId) {
    return this.history.filter(e => e.type === CHAOS.MALICIOUS_PEER && e.data?.peerId === peerId).length;
  }

  _peerMetrics(peerId) {
    return {
      badEvents: this._badEventCount(peerId),
      latencyMs: this._avgLatency(peerId),
    };
  }

  _avgLatency(peerId) {
    const h = this._peerLatency.get(peerId) ?? [];
    return h.length ? h.reduce((s,v)=>s+v,0)/h.length : 0;
  }

  _mostTrustedPeer(peers, excludeId = '') {
    return peers
      .filter(p => p.id !== excludeId)
      .map(p => ({ ...p, trust: this._trustScores.get(p.id) ?? 0.5 }))
      .sort((a, b) => b.trust - a.trust)[0] ?? null;
  }

  // ── Helper ────────────────────────────────────────────────────────────────

  injectDeps(deps) { this._deps = deps; }   // inject bandwidthShaper etc.

  _recordHistory(evt) {
    this.history.push(evt);
    if (this.history.length > MAX_CHAOS_HISTORY) this.history.shift();
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  getStats() {
    return {
      ...this.stats,
      running:      this._running,
      trustScores:  [...this._trustScores.entries()]
        .sort(([,a],[,b]) => b - a)
        .slice(0, 10)
        .map(([id, score]) => ({ id: id.slice(0,8), score })),
    };
  }

  getHistory(limit = 30) {
    return this.history.slice(-limit).reverse();
  }

  getTrustLeaderboard() {
    return [...this._trustScores.entries()]
      .sort(([,a],[,b]) => b - a)
      .map(([id, score]) => ({
        peerId: id,
        score,
        role:   peerRegistry.getPeer(id)?.role ?? 'unknown',
        latency:this._avgLatency(id),
      }));
  }
}
