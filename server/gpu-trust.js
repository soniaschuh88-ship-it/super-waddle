/**
 * server/gpu-trust.js — GPU Peer Trust Scoring + Tile Quality Eviction
 *
 * Solves: bad render peers degrade the entire distributed frame.
 *   Without this: a slow/corrupt peer blocks tile assembly forever
 *   With this:    bad peers get fewer tiles → degraded to LOD2 → evicted
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  TRUST SCORE  (per render peer, 0.0–1.0)
 *
 *  score = deliveryRate × 0.40
 *        + latencyScore  × 0.35
 *        + qualityScore  × 0.25
 *
 *  deliveryRate  = frames_delivered / frames_expected  (rolling 60-frame window)
 *  latencyScore  = clamp(1 – avgLatency / DEADLINE_MS, 0, 1)
 *  qualityScore  = client-reported pixel quality OR peer-verified hash match
 *
 * GRADE bands:
 *   EXCELLENT  ≥ 0.90  — full tile count, LOD0 (highest detail)
 *   GOOD       ≥ 0.75  — full tile count, LOD0
 *   FAIR       ≥ 0.55  — reduced tiles (−1), LOD1
 *   POOR       ≥ 0.35  — reduced tiles (−2), LOD2 (lowest detail)
 *   CRITICAL   <  0.35 — 1 tile max, LOD2, flagged for eviction
 *   EVICTED    —        — removed from render pool, tiles reassigned
 *
 * RECOVERY:
 *   Scores decay toward 0 on inactivity.
 *   Good delivery windows recover score at RECOVERY_RATE/frame.
 *   Evicted peers can re-enter after REENTRY_COOLDOWN_MS + 5 consecutive good frames.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter }     from 'events';
import { peerRegistry }     from './bkg-p2p.js';
import { renderPartition }  from './render-partition.js';
import { frameSmoother }    from './frame-smoother.js';

// ── Config ────────────────────────────────────────────────────────────────────

const WINDOW_SIZE          = 60;    // rolling window in frames
const DEADLINE_MS          = 16.67; // 60fps budget
const RECOVERY_RATE        = 0.008; // score recovery per good frame
const DECAY_RATE           = 0.004; // score decay per frame without delivery
const REENTRY_COOLDOWN_MS  = 30_000;
const REENTRY_MIN_GOOD     = 5;

// Grade thresholds
export const GRADE = Object.freeze({
  EXCELLENT: 'EXCELLENT',
  GOOD:      'GOOD',
  FAIR:      'FAIR',
  POOR:      'POOR',
  CRITICAL:  'CRITICAL',
  EVICTED:   'EVICTED',
});

const GRADE_THRESHOLD = {
  [GRADE.EXCELLENT]: 0.90,
  [GRADE.GOOD]:      0.75,
  [GRADE.FAIR]:      0.55,
  [GRADE.POOR]:      0.35,
  [GRADE.CRITICAL]:  0,
};

// Max tiles and LOD per grade
const GRADE_CONFIG = {
  [GRADE.EXCELLENT]: { maxTiles: 9, lod: 0 },
  [GRADE.GOOD]:      { maxTiles: 9, lod: 0 },
  [GRADE.FAIR]:      { maxTiles: 4, lod: 1 },
  [GRADE.POOR]:      { maxTiles: 2, lod: 2 },
  [GRADE.CRITICAL]:  { maxTiles: 1, lod: 2 },
  [GRADE.EVICTED]:   { maxTiles: 0, lod: 2 },
};

// ── PeerRecord ────────────────────────────────────────────────────────────────

class PeerRecord {
  constructor(peerId) {
    this.peerId = peerId;

    // Rolling window (0 = miss, >0 = latency in ms)
    this._deliveries   = new Array(WINDOW_SIZE).fill(0);  // ms or 0
    this._windowPtr    = 0;
    this._frameCount   = 0;

    // Scores (0–1)
    this.deliveryRate  = 1.0;
    this.latencyScore  = 1.0;
    this.qualityScore  = 1.0;
    this.trustScore    = 1.0;

    // Grade state
    this.grade         = GRADE.GOOD;
    this._prevGrade    = GRADE.GOOD;

    // Eviction tracking
    this.evictedAt     = null;
    this.reentryGood   = 0;   // consecutive good frames since re-entry
    this.violations    = 0;   // lifetime eviction count

    // Quality reports (from compositor / peer hash checks)
    this._qualityReports = [];  // {score: 0-1, ts}

    this.joinedAt = Date.now();
    this.lastSeen = Date.now();
  }

  // ── Frame record ────────────────────────────────────────────────────────────

  /**
   * Record a frame delivery event.
   * @param {number} latencyMs  actual delivery latency, or -1 for miss
   * @param {number} quality    optional pixel quality score 0–1
   */
  recordDelivery(latencyMs, quality = null) {
    this.lastSeen    = Date.now();
    this._frameCount++;

    const slot = this._windowPtr % WINDOW_SIZE;
    this._deliveries[slot] = latencyMs >= 0 ? latencyMs : 0;
    this._windowPtr++;

    if (quality !== null) {
      this._qualityReports.push({ score: quality, ts: Date.now() });
      if (this._qualityReports.length > 30) this._qualityReports.shift();
    }

    this._recalc();
  }

  /**
   * Record a missed frame (peer failed to deliver on time).
   */
  recordMiss() {
    this.recordDelivery(-1, null);
    // Apply decay penalty immediately
    this.trustScore = Math.max(0, this.trustScore - DECAY_RATE * 2);
  }

  _recalc() {
    const n = Math.min(this._frameCount, WINDOW_SIZE);

    // Delivery rate: fraction of window slots with a valid delivery
    const delivered   = this._deliveries.filter(v => v > 0).length;
    this.deliveryRate = n > 0 ? delivered / WINDOW_SIZE : 1;

    // Latency score: avg latency of delivered frames vs deadline
    const latencies    = this._deliveries.filter(v => v > 0);
    const avgLatency   = latencies.length
      ? latencies.reduce((s, v) => s + v, 0) / latencies.length
      : 0;
    this.latencyScore  = Math.max(0, Math.min(1, 1 - avgLatency / DEADLINE_MS));

    // Quality score: average of recent quality reports
    if (this._qualityReports.length > 0) {
      const recentQual   = this._qualityReports.slice(-10);
      this.qualityScore  = recentQual.reduce((s, r) => s + r.score, 0) / recentQual.length;
    }

    // Composite trust score
    const raw = (
      this.deliveryRate * 0.40 +
      this.latencyScore  * 0.35 +
      this.qualityScore  * 0.25
    );
    this.trustScore = +Math.max(0, Math.min(1, raw)).toFixed(4);

    // Determine grade
    this._prevGrade = this.grade;
    if (this.grade !== GRADE.EVICTED) {
      if      (this.trustScore >= 0.90) this.grade = GRADE.EXCELLENT;
      else if (this.trustScore >= 0.75) this.grade = GRADE.GOOD;
      else if (this.trustScore >= 0.55) this.grade = GRADE.FAIR;
      else if (this.trustScore >= 0.35) this.grade = GRADE.POOR;
      else                              this.grade = GRADE.CRITICAL;
    }
  }

  // ── Grade config ────────────────────────────────────────────────────────────

  get config()       { return GRADE_CONFIG[this.grade]; }
  get maxTiles()     { return this.config.maxTiles; }
  get lod()          { return this.config.lod; }
  get isEvicted()    { return this.grade === GRADE.EVICTED; }
  get gradeChanged() { return this.grade !== this._prevGrade; }

  // ── Eviction / recovery ─────────────────────────────────────────────────────

  evict() {
    this._prevGrade = this.grade;
    this.grade      = GRADE.EVICTED;
    this.evictedAt  = Date.now();
    this.violations++;
    this.reentryGood = 0;
  }

  /**
   * Attempt re-entry after cooldown.
   * @returns {boolean} true if re-entry allowed
   */
  attemptReentry() {
    if (this.grade !== GRADE.EVICTED) return true;
    const cooldownDone = Date.now() - (this.evictedAt ?? 0) >= REENTRY_COOLDOWN_MS;
    if (!cooldownDone) return false;

    // Allow probationary period
    this.grade      = GRADE.CRITICAL;  // start at lowest non-evicted grade
    this.trustScore = 0.30;
    return true;
  }

  /**
   * Record a good frame during probation.
   * After REENTRY_MIN_GOOD consecutive good frames → restore to POOR.
   */
  probationGoodFrame() {
    this.reentryGood++;
    if (this.reentryGood >= REENTRY_MIN_GOOD && this.grade === GRADE.CRITICAL) {
      this.grade = GRADE.POOR;
    }
  }

  // ── Serialise ───────────────────────────────────────────────────────────────

  snapshot() {
    return {
      peerId:       this.peerId,
      grade:        this.grade,
      trustScore:   this.trustScore,
      deliveryRate: +this.deliveryRate.toFixed(3),
      latencyScore: +this.latencyScore.toFixed(3),
      qualityScore: +this.qualityScore.toFixed(3),
      maxTiles:     this.maxTiles,
      lod:          this.lod,
      frameCount:   this._frameCount,
      violations:   this.violations,
      isEvicted:    this.isEvicted,
      joinedAt:     this.joinedAt,
    };
  }
}

// ── GPUTrustManager ───────────────────────────────────────────────────────────

export class GPUTrustManager extends EventEmitter {
  constructor() {
    super();
    this._peers      = new Map();   // peerId → PeerRecord
    this._timer      = null;
    this._running    = false;
    this._frameCount = 0;

    this.stats = {
      evictions:  0,
      recoveries: 0,
      rebalances: 0,
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start() {
    if (this._running) return this;
    this._running = true;
    // Sync with frame smoother events
    frameSmoother.on('frame.present', (signal) => this._onFrame(signal));
    this._timer = setInterval(() => this._maintenance(), 5000);
    this._timer.unref?.();
    return this;
  }

  stop() {
    this._running = false;
    clearInterval(this._timer);
    frameSmoother.off('frame.present', this._onFrame);
  }

  // ── Record events ──────────────────────────────────────────────────────────

  /**
   * Record a tile frame submission from a peer.
   * @param {string} peerId
   * @param {number} latencyMs  time from frame-start to frame-received
   * @param {number} quality    optional 0–1 quality score
   */
  recordDelivery(peerId, latencyMs, quality = null) {
    const rec = this._getOrCreate(peerId);
    if (rec.isEvicted && !rec.attemptReentry()) return;

    rec.recordDelivery(latencyMs, quality);
    this._checkGradeChange(rec);
  }

  /**
   * Record a missed frame for a peer.
   * Called when the jitter buffer times out waiting for a tile.
   */
  recordMiss(peerId) {
    const rec = this._getOrCreate(peerId);
    if (rec.isEvicted) return;
    rec.recordMiss();
    this._checkGradeChange(rec);
  }

  /**
   * Report pixel quality from a peer's rendered tile.
   * Quality is measured by the compositor (hash verification, pixel diff, etc.)
   * @param {string} peerId
   * @param {number} quality  0–1
   */
  reportQuality(peerId, quality) {
    const rec = this._getOrCreate(peerId);
    rec._qualityReports.push({ score: Math.max(0, Math.min(1, quality)), ts: Date.now() });
    if (rec._qualityReports.length > 30) rec._qualityReports.shift();
    rec._recalc();
    this._checkGradeChange(rec);
  }

  // ── Frame signal integration ───────────────────────────────────────────────

  _onFrame(signal) {
    this._frameCount++;

    // Stale tiles → misses for assigned peers
    for (const { tileId, ageMs } of signal.staleTiles ?? []) {
      const tile   = renderPartition.tiles.get(tileId);
      const peerId = tile?.assignedPeer;
      if (peerId) {
        // Miss if tile is very stale; latency penalty otherwise
        if (ageMs < 0 || ageMs > DEADLINE_MS * 3) {
          this.recordMiss(peerId);
        } else {
          this.recordDelivery(peerId, ageMs);
        }
      }
    }

    // Fresh tiles → good deliveries
    for (const tileId of signal.freshTiles ?? []) {
      const tile    = renderPartition.tiles.get(tileId);
      const peerId  = tile?.assignedPeer;
      const buf     = frameSmoother.buffers.get(tileId);
      if (peerId && buf) {
        const lastFrame = buf.lastKnownGood;
        const latencyMs = lastFrame ? signal.budgetUsedMs : DEADLINE_MS;
        this.recordDelivery(peerId, latencyMs);
        const rec = this._peers.get(peerId);
        if (rec?.grade === GRADE.CRITICAL) rec.probationGoodFrame();
      }
    }

    // Tile health map from jitter buffers
    for (const [tileId, health] of Object.entries(signal.tileHealthMap ?? {})) {
      const tile    = renderPartition.tiles.get(tileId);
      const peerId  = tile?.assignedPeer;
      if (peerId) this.reportQuality(peerId, health);
    }
  }

  // ── Grade change handling ──────────────────────────────────────────────────

  _checkGradeChange(rec) {
    if (!rec.gradeChanged) return;

    const { peerId, grade, trustScore } = rec;

    this.emit('grade.changed', { peerId, grade, trustScore, prev: rec._prevGrade });

    // CRITICAL → EVICTED threshold
    if (grade === GRADE.CRITICAL && trustScore < 0.20) {
      this._evict(rec);
      return;
    }

    // Any downgrade → trigger tile rebalance
    const gradePriority = [GRADE.EXCELLENT, GRADE.GOOD, GRADE.FAIR, GRADE.POOR, GRADE.CRITICAL, GRADE.EVICTED];
    if (gradePriority.indexOf(grade) > gradePriority.indexOf(rec._prevGrade)) {
      this._rebalancePeer(rec);
    }
  }

  _evict(rec) {
    rec.evict();
    this.stats.evictions++;

    // Remove peer from all assigned tiles → let render-partition reassign
    for (const [tileId, tile] of renderPartition.tiles) {
      if (tile.assignedPeer === rec.peerId) {
        tile.assignedPeer = null;
      }
    }

    // Trigger full rebalance
    renderPartition.rebalance();
    this.stats.rebalances++;

    this.emit('peer.evicted', { peerId: rec.peerId, violations: rec.violations });
  }

  _rebalancePeer(rec) {
    const cfg = GRADE_CONFIG[rec.grade];

    // Cap the number of tiles this peer can hold
    let tileCount = 0;
    for (const [tileId, tile] of renderPartition.tiles) {
      if (tile.assignedPeer === rec.peerId) {
        tileCount++;
        if (tileCount > cfg.maxTiles) {
          // Unassign excess tiles
          tile.assignedPeer = null;
        }
        // Degrade LOD for this peer's tiles
        tile.lod = Math.max(tile.lod, cfg.lod);
      }
    }

    if (tileCount > cfg.maxTiles || cfg.lod > 0) {
      renderPartition.rebalance();
      this.stats.rebalances++;
      this.emit('peer.degraded', { peerId: rec.peerId, grade: rec.grade, maxTiles: cfg.maxTiles, lod: cfg.lod });
    }
  }

  // ── Maintenance ────────────────────────────────────────────────────────────

  _maintenance() {
    const now = Date.now();

    for (const [peerId, rec] of this._peers) {
      // Decay inactive peers
      const silentMs = now - rec.lastSeen;
      if (silentMs > 5000 && !rec.isEvicted) {
        rec.trustScore = Math.max(0, rec.trustScore - DECAY_RATE * (silentMs / 1000));
        rec._recalc();
        this._checkGradeChange(rec);
      }

      // Clean up disconnected peers
      if (!peerRegistry.getPeer(peerId) && silentMs > 60_000) {
        this._peers.delete(peerId);
      }

      // Attempt re-entry for cooled-down evicted peers
      if (rec.isEvicted) {
        if (rec.attemptReentry()) {
          this.stats.recoveries++;
          this.emit('peer.reentry', { peerId, violations: rec.violations });
        }
      }
    }
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  _getOrCreate(peerId) {
    if (!this._peers.has(peerId)) {
      this._peers.set(peerId, new PeerRecord(peerId));
    }
    return this._peers.get(peerId);
  }

  getTrust(peerId)    { return this._peers.get(peerId)?.trustScore ?? 1.0; }
  getGrade(peerId)    { return this._peers.get(peerId)?.grade ?? GRADE.GOOD; }
  getMaxTiles(peerId) { return this._peers.get(peerId)?.maxTiles ?? 9; }
  getLod(peerId)      { return this._peers.get(peerId)?.lod ?? 0; }
  isEvicted(peerId)   { return this._peers.get(peerId)?.isEvicted ?? false; }

  /** Leaderboard sorted by trust score descending */
  leaderboard() {
    return [...this._peers.values()]
      .map(r => r.snapshot())
      .sort((a, b) => b.trustScore - a.trustScore);
  }

  snapshot() {
    const records = this.leaderboard();
    const gradeCount = {};
    for (const r of records) {
      gradeCount[r.grade] = (gradeCount[r.grade] ?? 0) + 1;
    }
    return {
      peers:      records.length,
      gradeCount,
      frames:     this._frameCount,
      stats:      { ...this.stats },
      leaderboard:records.slice(0, 20),
      running:    this._running,
    };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const gpuTrust = new GPUTrustManager();
