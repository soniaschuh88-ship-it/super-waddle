/**
 * server/tick-sync.js — Distributed Tick Synchronisation Protocol
 *
 * Solves the tick drift problem: without this, peers diverge in their
 * local tick counters over time → authority rotation breaks → merge fails.
 *
 * Protocol (NTP-inspired, 3-step):
 *
 *   1. SAMPLE   peer sends { type:'tick.report', localTick, sentAt, peerId }
 *   2. ESTIMATE server adjusts for network latency: estimatedTick = localTick + roundTripTicks/2
 *   3. CORRECT  if |estimatedTick - medianTick| > MAX_DRIFT:
 *                 server sends { type:'tick.correct', delta, canonical }
 *               peer applies: localTick += delta * DAMPING
 *
 * Median instead of average: robust against Byzantine peers reporting wrong ticks.
 *
 * Damping: gradual correction prevents sudden jumps that would desync physics.
 *   FAST  path: |drift| > 20 ticks → apply 50% correction per cycle
 *   SLOW  path: |drift| 5-20 ticks → apply 20% correction per cycle
 *   DEAD  band: |drift| < 5 ticks  → no correction (noise tolerance)
 *
 * Clock quality classification:
 *   GOOD    — drift < 5   ticks → authoritative candidate
 *   FAIR    — drift 5-15  ticks → advisory only
 *   POOR    — drift 15-50 ticks → non-authoritative
 *   DRIFTED — drift > 50  ticks → request full resync
 */

import { EventEmitter } from 'events';

// ── Constants ─────────────────────────────────────────────────────────────────

export const TICK_HZ          = 20;   // simulation ticks per second
export const TICK_MS          = 1000 / TICK_HZ;
export const SYNC_INTERVAL_MS = 5_000;  // how often to run sync assessment
export const MAX_DRIFT        = 50;     // ticks — trigger full resync if exceeded
export const DRIFT_DEADBAND   = 5;     // ticks — ignore drift smaller than this
export const DAMPING_FAST     = 0.5;   // correction fraction for large drift
export const DAMPING_SLOW     = 0.2;   // correction fraction for small drift
export const MAX_SAMPLE_AGE   = 10_000; // discard reports older than 10s

// Clock quality levels
export const CLOCK_QUALITY = { GOOD: 0, FAIR: 1, POOR: 2, DRIFTED: 3 };
const CLOCK_QUALITY_NAME   = ['GOOD', 'FAIR', 'POOR', 'DRIFTED'];

// ── TickSyncProtocol ──────────────────────────────────────────────────────────

export class TickSyncProtocol extends EventEmitter {
  constructor(zoneId) {
    super();
    this.zoneId       = zoneId;
    this.globalTick   = 0;          // server's canonical tick
    this._peerReports = new Map();  // peerId → PeerTickReport
    this._timer       = null;
    this._running     = false;

    // Correction history
    this.corrections  = [];         // last 50 correction events
    this.stats = {
      syncCycles:      0,
      correctionsIssued: 0,
      fullResyncs:     0,
      avgDrift:        0,
    };
  }

  // ── Server-side tick advance ────────────────────────────────────────────

  /**
   * Advance the canonical tick by N steps.
   * Called by ClusterManager at 20 Hz.
   */
  advance(steps = 1) {
    this.globalTick += steps;
    return this.globalTick;
  }

  // ── Peer report ingestion ───────────────────────────────────────────────

  /**
   * Process a tick report from a peer.
   *
   * @param {string} peerId
   * @param {number} localTick   — peer's current local tick
   * @param {number} sentAt      — Date.now() when peer sent this
   * @param {number} latencyMs   — estimated round-trip latency from peer
   * @returns {{ correction: number|null, quality: number, canonical: number }}
   */
  report(peerId, localTick, sentAt, latencyMs = 100) {
    const now          = Date.now();
    const transitTicks = (latencyMs / 2) / TICK_MS;

    // Compensate for transit time
    const adjustedTick = localTick + transitTicks;

    const prev = this._peerReports.get(peerId);
    const tickRate = prev && (now - prev.ts > 0)
      ? (localTick - prev.localTick) / ((now - prev.ts) / 1000)
      : TICK_HZ;

    const report = {
      peerId,
      localTick,
      adjustedTick,
      canonical:    this.globalTick,
      drift:        adjustedTick - this.globalTick,
      absDrift:     Math.abs(adjustedTick - this.globalTick),
      latencyMs,
      tickRate:     +tickRate.toFixed(2),
      quality:      this._qualityOf(Math.abs(adjustedTick - this.globalTick)),
      ts:           now,
    };

    this._peerReports.set(peerId, report);

    // Determine correction needed
    const correction = this._computeCorrection(report.drift, report.absDrift);

    if (correction !== null) {
      this.stats.correctionsIssued++;
      this.corrections.push({
        peerId, tick: this.globalTick, drift: report.drift,
        correction, ts: now,
      });
      if (this.corrections.length > 50) this.corrections.shift();
    }

    return {
      correction,
      quality:   report.quality,
      canonical: this.globalTick,
      drift:     report.drift,
    };
  }

  _computeCorrection(drift, absDrift) {
    // Dead band — no correction
    if (absDrift < DRIFT_DEADBAND) return null;

    // Full resync for extreme drift
    if (absDrift > MAX_DRIFT) {
      this.stats.fullResyncs++;
      this.emit('resync.required', { zoneId: this.zoneId, drift, canonical: this.globalTick });
      return this.globalTick;  // return canonical tick for full snap
    }

    // Gradual damped correction
    const damping = absDrift > 20 ? DAMPING_FAST : DAMPING_SLOW;
    return Math.round(-drift * damping);  // negative because we want peer to add this
  }

  _qualityOf(absDrift) {
    if (absDrift < DRIFT_DEADBAND) return CLOCK_QUALITY.GOOD;
    if (absDrift < 15)             return CLOCK_QUALITY.FAIR;
    if (absDrift <= MAX_DRIFT)     return CLOCK_QUALITY.POOR;
    return CLOCK_QUALITY.DRIFTED;
  }

  // ── Cluster-level assessment ────────────────────────────────────────────

  /**
   * Run a sync assessment for all peers in the zone.
   * Returns corrections to send and the new canonical tick (median).
   */
  assess() {
    this.stats.syncCycles++;

    const now = Date.now();

    // Remove stale reports
    for (const [id, r] of this._peerReports) {
      if (now - r.ts > MAX_SAMPLE_AGE) this._peerReports.delete(id);
    }

    if (!this._peerReports.size) return { corrections: [], canonical: this.globalTick };

    // Compute median adjusted tick
    const ticks  = [...this._peerReports.values()].map(r => r.adjustedTick).sort((a, b) => a - b);
    const median = ticks[Math.floor(ticks.length / 2)];

    // Use median as new canonical tick (Byzantine-robust)
    this.globalTick = Math.round(median);

    // Compute corrections for each peer
    const corrections = [];
    let driftSum = 0;

    for (const [peerId, report] of this._peerReports) {
      const drift    = report.adjustedTick - this.globalTick;
      const absDrift = Math.abs(drift);
      driftSum      += absDrift;

      const correction = this._computeCorrection(drift, absDrift);
      if (correction !== null) {
        corrections.push({
          peerId,
          correction,
          canonical:  this.globalTick,
          quality:    this._qualityOf(absDrift),
          qualityName:CLOCK_QUALITY_NAME[this._qualityOf(absDrift)],
        });
      }
    }

    this.stats.avgDrift = this._peerReports.size
      ? +(driftSum / this._peerReports.size).toFixed(2)
      : 0;

    return { corrections, canonical: this.globalTick };
  }

  // ── Authority quality ────────────────────────────────────────────────────

  /**
   * Which peers are eligible to be the authority? (GOOD or FAIR clock quality)
   * Used by ClusterManager's role assignment.
   */
  eligibleAuthorities() {
    return [...this._peerReports.values()]
      .filter(r => r.quality <= CLOCK_QUALITY.FAIR)
      .sort((a, b) => a.absDrift - b.absDrift)
      .map(r => r.peerId);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  start(initialTick = 0) {
    this.globalTick = initialTick;
    this._running   = true;
    this._timer     = setInterval(() => {
      const result = this.assess();
      if (result.corrections.length > 0) {
        this.emit('corrections', { zoneId: this.zoneId, ...result });
      }
    }, SYNC_INTERVAL_MS);
    this._timer.unref?.();
    return this;
  }

  stop() {
    this._running = false;
    clearInterval(this._timer);
  }

  // ── Snapshot ─────────────────────────────────────────────────────────────

  snapshot() {
    const reports = [...this._peerReports.values()].map(r => ({
      peerId:      r.peerId,
      localTick:   r.localTick,
      drift:       +(r.drift).toFixed(1),
      quality:     CLOCK_QUALITY_NAME[r.quality],
      latencyMs:   r.latencyMs,
      tickRate:    r.tickRate,
    }));

    return {
      zoneId:     this.zoneId,
      canonical:  this.globalTick,
      peers:      reports.length,
      avgDrift:   this.stats.avgDrift,
      stats:      { ...this.stats },
      reports,
      recentCorrections: this.corrections.slice(-5),
    };
  }
}

// ── Zone-level sync registry ──────────────────────────────────────────────────

const _syncInstances = new Map();  // zoneId → TickSyncProtocol

export function getTickSync(zoneId) {
  if (!_syncInstances.has(zoneId)) {
    const ts = new TickSyncProtocol(zoneId);
    ts.start(0);
    _syncInstances.set(zoneId, ts);
  }
  return _syncInstances.get(zoneId);
}

export function listTickSyncs() {
  return [..._syncInstances.values()].map(ts => ts.snapshot());
}

export function globalTickSyncStats() {
  const all = [..._syncInstances.values()];
  return {
    zones:          all.length,
    totalPeers:     all.reduce((s, ts) => s + ts._peerReports.size, 0),
    avgDrift:       all.length
      ? +(all.reduce((s, ts) => s + ts.stats.avgDrift, 0) / all.length).toFixed(2)
      : 0,
    corrections:    all.reduce((s, ts) => s + ts.stats.correctionsIssued, 0),
    fullResyncs:    all.reduce((s, ts) => s + ts.stats.fullResyncs, 0),
  };
}
