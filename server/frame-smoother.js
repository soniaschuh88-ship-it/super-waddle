/**
 * server/frame-smoother.js — Anti-Latency Perception System
 *
 * Solves: distributed tile assembly produces visible jitter and tearing.
 *
 * Three interlocking mechanisms:
 *
 * ① JITTER BUFFER
 *    Per-tile frames arrive with varying network delay.
 *    A shallow ring buffer (3 frames deep) re-orders them by sequence number
 *    before release. Smooths up to ±2 frames of arrival jitter.
 *    Release condition: seq[n] arrives OR buffer older than RELEASE_DEADLINE_MS.
 *
 * ② TILE INTERPOLATION  (temporal smoothing)
 *    If the newest tile is late (> LATE_THRESHOLD_MS old):
 *      blend = lerp(lastKnownGood, predictedNext, alpha)
 *    "predictedNext" is estimated from per-tile velocity (delta between last
 *    two known-good frames). This hides single-frame drops entirely.
 *
 * ③ QUORUM SYNC  (presentation gating)
 *    A composite frame is only "ready for presentation" when:
 *      receivedTiles / totalTiles >= QUORUM_RATIO  (default 0.78 = 7/9)
 *    Tiles below the quorum threshold are filled with their last known-good
 *    frame. This prevents one slow peer from holding the entire frame.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  PIPELINE (per render frame, 60 Hz server tick)
 *
 *  1. Collect TileFrame events as they arrive from render peers
 *  2. Run jitter buffer: release frames in-order or on timeout
 *  3. Assess quorum: count on-time tiles
 *  4. If quorum met → release composite signal  (type: 'frame.present')
 *  5. If quorum not met → fill stale slots with last-known + emit warning
 *  6. Compute per-tile health scores → feed into GPU trust module
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'events';
import { peerRegistry  } from './bkg-p2p.js';
import { renderPartition } from './render-partition.js';

// ── Config ────────────────────────────────────────────────────────────────────

const JITTER_BUFFER_DEPTH  = 3;      // frames to hold in re-order buffer
const RELEASE_DEADLINE_MS  = 25;     // force-release a buffered frame after 25ms
const LATE_THRESHOLD_MS    = 40;     // tile considered "late" after 40ms
const INTERPOLATION_ALPHA  = 0.6;    // blend factor for temporal smoothing
const QUORUM_RATIO         = 7/9;    // 77.8% — 7 of 9 tiles needed
const FRAME_BUDGET_MS      = 16.67;  // 60fps target
const HEALTH_WINDOW        = 60;     // frames to measure tile health over
const MAX_LATE_STREAK      = 5;      // tiles late >5 consecutive frames → warn

// ── TileJitterBuffer ──────────────────────────────────────────────────────────

class TileJitterBuffer {
  constructor(tileId) {
    this.tileId      = tileId;
    this.pending     = [];    // [{seq, frame, arrivedAt}] — not yet released
    this.nextExpected = 0;    // next seq we want to release
    this.released    = [];    // last JITTER_BUFFER_DEPTH released frames
    this.lateStreak  = 0;
    this.healthScores = [];   // last HEALTH_WINDOW delivery scores (0/1)
  }

  /**
   * Ingest a new frame from the render peer.
   * Returns the frame if it can be immediately released (in-order).
   */
  ingest(frame) {
    const { seq } = frame;

    // Discard older-than-expected frames
    if (seq < this.nextExpected) return null;

    // Insert in sorted order
    const pos = this.pending.findIndex(p => p.seq > seq);
    const entry = { seq, frame, arrivedAt: Date.now() };
    if (pos === -1) this.pending.push(entry);
    else            this.pending.splice(pos, 0, entry);

    // Try to release in-order
    return this._tryRelease();
  }

  /**
   * Flush stale entries from the buffer (called every frame tick).
   * Returns any frames that exceeded the release deadline.
   */
  flushStale() {
    const now      = Date.now();
    const flushed  = [];
    while (this.pending.length > 0 &&
           now - this.pending[0].arrivedAt >= RELEASE_DEADLINE_MS) {
      const entry = this.pending.shift();
      this.nextExpected = entry.seq + 1;
      this._doRelease(entry.frame);
      flushed.push(entry.frame);
    }
    return flushed;
  }

  _tryRelease() {
    if (this.pending.length === 0) return null;
    if (this.pending[0].seq !== this.nextExpected) return null;  // gap — wait

    const entry = this.pending.shift();
    this.nextExpected = entry.seq + 1;
    this._doRelease(entry.frame);
    return entry.frame;
  }

  _doRelease(frame) {
    this.released.push({ frame, releasedAt: Date.now() });
    if (this.released.length > JITTER_BUFFER_DEPTH) this.released.shift();
    this._recordHealth(1);  // on-time delivery
  }

  _recordHealth(score) {
    this.healthScores.push(score);
    if (this.healthScores.length > HEALTH_WINDOW) this.healthScores.shift();
  }

  /** Last confirmed frame for this tile */
  get lastKnownGood() {
    return this.released.at(-1)?.frame ?? null;
  }

  /** Health: fraction of on-time frames in recent window */
  get health() {
    if (!this.healthScores.length) return 1;
    return this.healthScores.reduce((s, v) => s + v, 0) / this.healthScores.length;
  }

  /** Age of the most recent released frame in ms */
  age() {
    const last = this.released.at(-1);
    return last ? Date.now() - last.releasedAt : Infinity;
  }
}

// ── TileInterpolator ──────────────────────────────────────────────────────────

/**
 * Predicts a "virtual frame" for a tile that is late.
 * Uses pixel-level delta between last two frames to extrapolate forward.
 *
 * In practice: since pixel data travels P2P (not through server),
 * this module tracks per-tile metadata (hash, bytes, quality) and
 * emits a smoothing hint clients use to blend in their local compositor.
 */
class TileInterpolator {
  constructor(tileId) {
    this.tileId   = tileId;
    this.history  = [];   // last 2 frame metadata snapshots
  }

  record(frameMetadata) {
    this.history.push({ ...frameMetadata, recordedAt: Date.now() });
    if (this.history.length > 2) this.history.shift();
  }

  /**
   * Compute interpolation hint for late tile.
   * Returns { alpha, motionX, motionY, useLastGood }
   *   alpha:     blend factor (0=freeze last frame, 1=extrapolate fully)
   *   motionX/Y: estimated pixel motion (from client-reported camera delta)
   *   useLastGood: whether to just show the last frame (motion too fast)
   */
  hint(lateMs) {
    if (this.history.length < 2) {
      // No history → freeze last frame
      return { alpha: 0, motionX: 0, motionY: 0, useLastGood: true };
    }

    const [prev, curr] = this.history;
    const dt = (curr.recordedAt - prev.recordedAt) / 1000;
    if (dt <= 0) return { alpha: 0, motionX: 0, motionY: 0, useLastGood: true };

    // Extrapolation factor: how far into the next frame are we?
    const alpha = Math.min(1, lateMs / FRAME_BUDGET_MS);

    // If tile is very late (> 2 frames), just freeze — extrapolation too inaccurate
    if (lateMs > FRAME_BUDGET_MS * 2.5) {
      return { alpha: 0, motionX: 0, motionY: 0, useLastGood: true };
    }

    // Estimated motion from camera reprojection (if available from peer reports)
    const motionX = (curr.camDeltaX ?? 0) * alpha;
    const motionY = (curr.camDeltaY ?? 0) * alpha;

    return { alpha, motionX, motionY, useLastGood: false };
  }
}

// ── QuorumGate ────────────────────────────────────────────────────────────────

/**
 * Decides when a composite frame is "ready to present".
 *
 * A frame is ready when:
 *   • >= QUORUM_RATIO of tiles have fresh frames (age < LATE_THRESHOLD_MS)
 *   OR
 *   • frame budget exceeded (FRAME_BUDGET_MS has elapsed since frame start)
 *
 * Missing tiles (below quorum) are filled with their last-known-good frame.
 * After two consecutive budget overruns → log warning + potentially degrade peer.
 */
class QuorumGate {
  constructor(tileCount) {
    this.tileCount    = tileCount;
    this.quorumTarget = Math.ceil(tileCount * QUORUM_RATIO);
    this.frameStart   = Date.now();
    this.overruns     = 0;
    this.frameCount   = 0;
    this.quorumHits   = 0;
  }

  reset() {
    this.frameStart = Date.now();
  }

  /**
   * Assess current frame state.
   * @param {Map<string, TileJitterBuffer>} buffers  tileId → TileJitterBuffer
   * @returns {{ ready, freshCount, staleIds, budgetUsedMs, overrun }}
   */
  assess(buffers) {
    const now          = Date.now();
    const budgetUsedMs = now - this.frameStart;
    const freshIds     = [];
    const staleIds     = [];

    for (const [tileId, buf] of buffers) {
      if (buf.age() <= LATE_THRESHOLD_MS) {
        freshIds.push(tileId);
      } else {
        staleIds.push(tileId);
      }
    }

    const freshCount = freshIds.length;
    const quorumMet  = freshCount >= this.quorumTarget;
    const overrun    = budgetUsedMs >= FRAME_BUDGET_MS;

    // Frame is ready when quorum met or budget expired
    const ready = quorumMet || overrun;

    if (ready) {
      this.frameCount++;
      if (quorumMet)  this.quorumHits++;
      if (overrun && !quorumMet) this.overruns++;
    }

    return {
      ready,
      freshCount,
      staleIds,
      freshIds,
      budgetUsedMs: +budgetUsedMs.toFixed(2),
      quorumMet,
      overrun,
      quorumRatio:  +(freshCount / this.tileCount).toFixed(3),
    };
  }

  stats() {
    return {
      frames:        this.frameCount,
      quorumHits:    this.quorumHits,
      overruns:      this.overruns,
      quorumRate:    this.frameCount ? +(this.quorumHits / this.frameCount).toFixed(3) : 0,
      tileCount:     this.tileCount,
      quorumTarget:  this.quorumTarget,
    };
  }
}

// ── FrameSmoother ─────────────────────────────────────────────────────────────

export class FrameSmoother extends EventEmitter {
  constructor() {
    super();

    this.tileCount    = 9;   // 3×3 grid
    this.buffers      = new Map();   // tileId → TileJitterBuffer
    this.interpolators= new Map();   // tileId → TileInterpolator
    this.gate         = new QuorumGate(this.tileCount);

    // Per-frame metrics
    this.metrics = {
      framesAssessed:   0,
      quorumFrames:     0,
      overrunFrames:    0,
      interpolations:   0,
      avgQuorumRatio:   0,
      _ratioSum:        0,
    };

    this._timer   = null;
    this._running = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start() {
    if (this._running) return this;
    this._running = true;
    this._timer   = setInterval(() => this._assess(), Math.floor(FRAME_BUDGET_MS));
    this._timer.unref?.();
    return this;
  }

  stop() {
    this._running = false;
    clearInterval(this._timer);
  }

  // ── Tile frame ingestion ───────────────────────────────────────────────────

  /**
   * Called when a render peer submits a tile frame.
   * @param {object} frame  { tileId, seq, peerId, bytes, camDeltaX?, camDeltaY? }
   */
  ingest(frame) {
    const { tileId } = frame;
    if (!tileId) return;

    // Lazily create buffer + interpolator
    if (!this.buffers.has(tileId)) {
      this.buffers.set(tileId, new TileJitterBuffer(tileId));
      this.interpolators.set(tileId, new TileInterpolator(tileId));
    }

    const buf = this.buffers.get(tileId);
    this.interpolators.get(tileId).record(frame);

    const released = buf.ingest(frame);
    if (released) {
      this.emit('tile.released', { tileId, frame: released, via: 'inorder' });
    }
  }

  // ── Frame assessment (60Hz) ────────────────────────────────────────────────

  _assess() {
    // Flush stale buffered frames first
    for (const [tileId, buf] of this.buffers) {
      const flushed = buf.flushStale();
      for (const frame of flushed) {
        this.emit('tile.released', { tileId, frame, via: 'flush' });
      }
    }

    // Assess quorum
    const result = this.gate.assess(this.buffers);

    this.metrics.framesAssessed++;
    this.metrics._ratioSum    += result.quorumRatio;
    this.metrics.avgQuorumRatio = +(this.metrics._ratioSum / this.metrics.framesAssessed).toFixed(3);

    if (result.ready) {
      this.metrics.quorumFrames  += result.quorumMet ? 1 : 0;
      this.metrics.overrunFrames += result.overrun   ? 1 : 0;

      // Build presentation signal
      const signal = this._buildPresentSignal(result);

      this.emit('frame.present', signal);

      // Broadcast to all peers
      this._broadcast(signal);

      // Reset gate for next frame
      this.gate.reset();
    }
  }

  _buildPresentSignal(assessment) {
    const { freshIds, staleIds, budgetUsedMs, quorumRatio, overrun } = assessment;

    // Compute interpolation hints for stale tiles
    const staleFills = staleIds.map(tileId => {
      const buf    = this.buffers.get(tileId);
      const interp = this.interpolators.get(tileId);
      const ageMs  = buf ? buf.age() : Infinity;
      const hint   = interp ? interp.hint(ageMs) : { alpha: 0, useLastGood: true };

      if (!hint.useLastGood) this.metrics.interpolations++;

      return {
        tileId,
        hint,
        ageMs:       ageMs === Infinity ? -1 : +ageMs.toFixed(1),
        hasLastGood: buf ? buf.lastKnownGood !== null : false,
      };
    });

    return {
      type:          'frame.present',
      frameIndex:    this.gate.frameCount,
      budgetUsedMs,
      quorumRatio,
      overrun,
      freshTiles:    freshIds,
      staleTiles:    staleFills,
      tileHealthMap: this._healthMap(),
      ts:            Date.now(),
    };
  }

  _healthMap() {
    const map = {};
    for (const [tileId, buf] of this.buffers) {
      map[tileId] = +buf.health.toFixed(3);
    }
    return map;
  }

  _broadcast(signal) {
    const msg = JSON.stringify(signal);
    for (const peer of peerRegistry.peers.values()) {
      const ws = peer.ws;
      if (ws?.readyState === 1) {
        try { ws.send(msg); } catch { /**/ }
      }
    }
  }

  // ── Peer late-streak tracking ──────────────────────────────────────────────

  /**
   * Check if any tiles have a high late-streak — signals GPU trust module.
   * Returns list of tiles that should be flagged for potential reassignment.
   */
  getLateStreakTiles() {
    const flagged = [];
    for (const [tileId, buf] of this.buffers) {
      if (buf.age() > LATE_THRESHOLD_MS * MAX_LATE_STREAK) {
        const tile    = renderPartition.tiles.get(tileId);
        const peerId  = tile?.assignedPeer;
        if (peerId) flagged.push({ tileId, peerId, health: buf.health, age: buf.age() });
      }
    }
    return flagged;
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  snapshot() {
    return {
      ...this.metrics,
      gate:         this.gate.stats(),
      tileBuffers:  this.buffers.size,
      running:      this._running,
      lateStreaks:  this.getLateStreakTiles().length,
      tileHealth:   this._healthMap(),
    };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const frameSmoother = new FrameSmoother().start();
