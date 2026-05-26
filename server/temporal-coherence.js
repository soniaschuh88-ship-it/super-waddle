/**
 * server/temporal-coherence.js — Long-Term Motion Continuity Layer
 *
 * Solves: jitter buffer handles 16.67ms; but over seconds, distributed
 * rendering shows discontinuities — tiles predict different camera paths,
 * world streaming has pops, speculative rendering diverges.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  THREE SUBSYSTEMS
 *
 *  ① TRAJECTORY TRACKER
 *     Per-peer cubic spline through last N camera samples.
 *     Peers sample: {pos, rot, fov, ts} every SAMPLE_INTERVAL_MS.
 *     Spline gives: smooth interpolated position at ANY timestamp.
 *     Prediction: extrapolate forward PREDICTION_HORIZON_MS.
 *
 *  ② TEMPORAL ANCHOR
 *     Every ANCHOR_INTERVAL_MS, snapshot:
 *       { worldMatrix, viewMatrix, tick, stateHash, ts }
 *     All tile renderers use the same anchor for a frame batch.
 *     Eliminates inter-tile perspective drift.
 *
 *  ③ MOTION CONTINUITY GUARD
 *     Detects discontinuities: |predicted_pos - actual_pos| > TELEPORT_THRESHOLD
 *     On teleport: emit 'camera.teleport' — renderers flush tile cache
 *     On high-velocity: increase tile LOD budget (motion blur masks detail)
 *     On low-velocity (stationary): decrease LOD budget (max detail)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'events';
import { peerRegistry  } from './bkg-p2p.js';

// ── Config ────────────────────────────────────────────────────────────────────

const SAMPLE_INTERVAL_MS    = 50;   // camera sample rate (matches render tick)
const MAX_TRAJECTORY_SAMPLES= 40;   // 2 seconds of history at 20Hz
const PREDICTION_HORIZON_MS = 300;  // predict this far ahead
const ANCHOR_INTERVAL_MS    = 100;  // new temporal anchor every 100ms
const TELEPORT_THRESHOLD    = 64;   // voxels/tick — above this = teleport
const HIGH_VELOCITY         = 32;   // voxels/tick — start reducing LOD
const SPLINE_TENSION        = 0.5;  // Catmull-Rom tension (0=linear, 1=tight)

// ── Vec3 helpers ──────────────────────────────────────────────────────────────

function vec3(x=0, y=0, z=0) { return {x, y, z}; }

function lerpVec3(a, b, t) {
  return { x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t, z: a.z + (b.z-a.z)*t };
}

function distVec3(a, b) {
  const dx=a.x-b.x, dy=a.y-b.y, dz=a.z-b.z;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

function lenVec3(v) { return Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z); }

/**
 * Catmull-Rom spline interpolation between p1 and p2.
 * Uses p0 and p3 as control points.
 * t ∈ [0,1]
 */
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t*t, t3 = t2*t;
  const f = SPLINE_TENSION;
  return {
    x: 0.5*((2*p1.x) + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3*f*2),
    y: 0.5*((2*p1.y) + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3*f*2),
    z: 0.5*((2*p1.z) + (-p0.z+p2.z)*t + (2*p0.z-5*p1.z+4*p2.z-p3.z)*t2 + (-p0.z+3*p1.z-3*p2.z+p3.z)*t3*f*2),
  };
}

// ── CameraTrajectory ──────────────────────────────────────────────────────────

class CameraTrajectory {
  constructor(peerId) {
    this.peerId   = peerId;
    this.samples  = [];   // {pos:{x,y,z}, yaw, pitch, fov, ts}
    this.velocity = vec3();
    this.speed    = 0;    // voxels/tick
    this.lastTeleportTs = 0;
    this.isStationary = true;
  }

  /**
   * Add a new camera sample.
   * Returns continuity event if discontinuity detected.
   */
  record(pos, yaw, pitch, fov, ts = Date.now()) {
    const prev  = this.samples.at(-1);
    let event   = null;

    if (prev) {
      const dt    = Math.max(1, ts - prev.ts) / 1000;  // seconds
      const dist  = distVec3(pos, prev.pos);
      const speed = dist / dt;

      this.speed    = speed;
      this.velocity = {
        x: (pos.x - prev.pos.x) / dt,
        y: (pos.y - prev.pos.y) / dt,
        z: (pos.z - prev.pos.z) / dt,
      };
      this.isStationary = speed < 0.5;

      // Detect teleport
      if (speed > TELEPORT_THRESHOLD && ts - this.lastTeleportTs > 500) {
        this.lastTeleportTs = ts;
        event = { type: 'camera.teleport', peerId: this.peerId, from: prev.pos, to: pos, dist, speed };
      }
    }

    this.samples.push({ pos, yaw, pitch, fov, ts });
    if (this.samples.length > MAX_TRAJECTORY_SAMPLES) this.samples.shift();

    return event;
  }

  /**
   * Interpolate camera position at a given timestamp using Catmull-Rom spline.
   * @param {number} ts  milliseconds
   * @returns {{pos, yaw, pitch}} or null if not enough data
   */
  sampleAt(ts) {
    if (this.samples.length < 2) return this.samples.at(-1) ?? null;

    // Find the two samples that bracket ts
    let i = this.samples.length - 1;
    while (i > 0 && this.samples[i-1].ts > ts) i--;
    if (i === 0) return this.samples[0];
    if (i >= this.samples.length) return this.samples.at(-1);

    const s0 = this.samples[Math.max(0, i-2)];
    const s1 = this.samples[i-1];
    const s2 = this.samples[i];
    const s3 = this.samples[Math.min(this.samples.length-1, i+1)];

    const t = (ts - s1.ts) / Math.max(1, s2.ts - s1.ts);
    const pos = catmullRom(s0.pos, s1.pos, s2.pos, s3.pos, Math.max(0, Math.min(1, t)));

    return {
      pos,
      yaw:   s1.yaw   + (s2.yaw   - s1.yaw)   * t,
      pitch: s1.pitch + (s2.pitch - s1.pitch) * t,
      fov:   s1.fov   + (s2.fov   - s1.fov)   * t,
    };
  }

  /**
   * Predict camera position PREDICTION_HORIZON_MS in the future.
   * Uses velocity extrapolation smoothed with last spline tangent.
   */
  predict(aheadMs = PREDICTION_HORIZON_MS) {
    const last = this.samples.at(-1);
    if (!last) return null;

    const aheadS = aheadMs / 1000;

    // Simple linear extrapolation + mild damping
    const damping = Math.exp(-aheadS * 2);  // damp over 500ms
    return {
      pos: {
        x: last.pos.x + this.velocity.x * aheadS * damping,
        y: last.pos.y + this.velocity.y * aheadS * damping,
        z: last.pos.z + this.velocity.z * aheadS * damping,
      },
      yaw:   last.yaw,
      pitch: last.pitch,
      fov:   last.fov,
      confidence: Math.max(0, 1 - aheadS * 2),  // confidence drops with time
    };
  }

  /**
   * LOD bias for this camera's current motion.
   * Fast movement = lower LOD (motion blur hides detail).
   * Stationary = full LOD.
   */
  get lodBias() {
    if (this.isStationary) return 0;
    if (this.speed > HIGH_VELOCITY) return 2;
    if (this.speed > HIGH_VELOCITY / 2) return 1;
    return 0;
  }

  age() {
    const last = this.samples.at(-1);
    return last ? Date.now() - last.ts : Infinity;
  }
}

// ── TemporalAnchor ────────────────────────────────────────────────────────────

/**
 * A temporal anchor is a shared snapshot of world state used to align
 * all tile renderers within the same frame batch.
 *
 * Without this: each tile renderer uses its own local timestamp →
 * world position drifts between tiles → seams at tile boundaries.
 *
 * With this: all tiles render against the SAME anchor snapshot.
 */
class TemporalAnchorManager {
  constructor() {
    this.current  = null;  // current anchor
    this.history  = [];    // last 30 anchors
    this._seq     = 0;
  }

  /**
   * Create a new temporal anchor from the current global consistency state.
   */
  createAnchor(consistencyState, globalTick, worldStateHash) {
    this._seq++;
    const anchor = {
      seq:         this._seq,
      ts:          Date.now(),
      tick:        globalTick,
      stateHash:   worldStateHash ?? '0'.repeat(16),
      frameIndex:  consistencyState?.frameIndex ?? this._seq,
      jitterX:     consistencyState?.jitterX    ?? 0,
      jitterY:     consistencyState?.jitterY    ?? 0,
      timeOfDay:   consistencyState?.timeOfDay  ?? 0.5,
      sunDirection:consistencyState?.sunDirection ?? [0.4, 0.8, 0.3],
      fogNear:     consistencyState?.fogNear    ?? 150,
      fogFar:      consistencyState?.fogFar     ?? 600,
      // All tile renderers MUST use these exact values for this frame
      locked:      true,
    };

    this.current = anchor;
    this.history.push(anchor);
    if (this.history.length > 30) this.history.shift();

    return anchor;
  }

  getAnchor(seq) {
    if (seq === undefined) return this.current;
    return this.history.find(a => a.seq === seq) ?? this.current;
  }

  /** Anchor age in ms — tells renderers how stale their reference is */
  get anchorAge() { return this.current ? Date.now() - this.current.ts : Infinity; }
}

// ── TemporalCoherenceLayer ────────────────────────────────────────────────────

export class TemporalCoherenceLayer extends EventEmitter {
  constructor() {
    super();
    this.trajectories = new Map();  // peerId → CameraTrajectory
    this.anchors      = new TemporalAnchorManager();
    this._timer       = null;
    this._running     = false;

    this.stats = {
      teleports:     0,
      anchorsCreated:0,
      peersTracked:  0,
      avgPredictionError: 0,  // measured when actual pos arrives after prediction
      _errorSum: 0, _errorCount: 0,
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(consistencyLayer = null, clusterMgr = null) {
    if (this._running) return this;
    this._running       = true;
    this._consistency   = consistencyLayer;
    this._clusterMgr    = clusterMgr;
    this._timer = setInterval(() => this._tick(), ANCHOR_INTERVAL_MS);
    this._timer.unref?.();
    return this;
  }

  stop() {
    this._running = false;
    clearInterval(this._timer);
  }

  // ── Camera sample ingestion ───────────────────────────────────────────────

  /**
   * Record a camera sample from a peer.
   * Called when peer sends a move/camera update.
   *
   * @param {string} peerId
   * @param {object} camera  { pos:{x,y,z}, yaw, pitch, fov }
   * @param {number} ts
   */
  recordCamera(peerId, camera, ts = Date.now()) {
    let traj = this.trajectories.get(peerId);
    if (!traj) {
      traj = new CameraTrajectory(peerId);
      this.trajectories.set(peerId, traj);
      this.stats.peersTracked++;
    }

    const event = traj.record(camera.pos ?? vec3(), camera.yaw ?? 0, camera.pitch ?? 0, camera.fov ?? 70, ts);

    if (event?.type === 'camera.teleport') {
      this.stats.teleports++;
      this._broadcastToPeer(peerId, event);
      this.emit('camera.teleport', event);
    }

    return traj;
  }

  /**
   * Measure prediction accuracy when actual position arrives.
   * Called after recording a new sample to compare with last prediction.
   */
  measurePredictionError(peerId, actualPos) {
    const traj = this.trajectories.get(peerId);
    if (!traj || traj.samples.length < 2) return;

    const predictedTs = traj.samples.at(-2)?.ts ?? Date.now();
    const predicted   = traj.sampleAt(predictedTs + PREDICTION_HORIZON_MS);
    if (!predicted) return;

    const err = distVec3(actualPos, predicted.pos);
    this.stats._errorSum   += err;
    this.stats._errorCount++;
    this.stats.avgPredictionError = +(this.stats._errorSum / this.stats._errorCount).toFixed(2);
  }

  // ── Trajectory queries ────────────────────────────────────────────────────

  /** Get smooth interpolated camera state for a peer at a given timestamp */
  getCameraAt(peerId, ts) {
    return this.trajectories.get(peerId)?.sampleAt(ts) ?? null;
  }

  /** Predict where a peer's camera will be in the future */
  predictCamera(peerId, aheadMs = PREDICTION_HORIZON_MS) {
    return this.trajectories.get(peerId)?.predict(aheadMs) ?? null;
  }

  /** LOD bias: how much to reduce detail based on motion speed */
  getLODBias(peerId) {
    return this.trajectories.get(peerId)?.lodBias ?? 0;
  }

  /**
   * Compute the "shared view frustum" — the intersection of all active peers'
   * predicted view frustums. Chunks outside this volume don't need streaming.
   */
  sharedFrustumBounds() {
    const preds = [];
    for (const traj of this.trajectories.values()) {
      const p = traj.predict(PREDICTION_HORIZON_MS);
      if (p) preds.push(p);
    }
    if (!preds.length) return null;

    // AABB around all predicted positions + view distance
    const VIEW_DIST = 300;
    let minX=Infinity, minY=Infinity, minZ=Infinity;
    let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
    for (const p of preds) {
      minX = Math.min(minX, p.pos.x - VIEW_DIST);
      minY = Math.min(minY, p.pos.y - VIEW_DIST);
      minZ = Math.min(minZ, p.pos.z - VIEW_DIST);
      maxX = Math.max(maxX, p.pos.x + VIEW_DIST);
      maxY = Math.max(maxY, p.pos.y + VIEW_DIST);
      maxZ = Math.max(maxZ, p.pos.z + VIEW_DIST);
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }

  // ── Anchor tick ───────────────────────────────────────────────────────────

  _tick() {
    const consistencyState = this._consistency?.state ?? null;
    const globalTick       = this._clusterMgr?.globalTick ?? 0;

    const anchor = this.anchors.createAnchor(consistencyState, globalTick, null);
    this.stats.anchorsCreated++;

    // Broadcast anchor to all peers
    const msg = JSON.stringify({ type: 'temporal.anchor', anchor });
    for (const peer of peerRegistry.peers.values()) {
      if (peer.ws?.readyState === 1) {
        try { peer.ws.send(msg); } catch { /**/ }
      }
    }

    // Clean up stale trajectories
    for (const [peerId, traj] of this.trajectories) {
      if (traj.age() > 30_000) this.trajectories.delete(peerId);
    }

    this.emit('anchor', anchor);
  }

  _broadcastToPeer(peerId, msg) {
    const peer = peerRegistry.getPeer(peerId);
    if (peer?.ws?.readyState === 1) {
      try { peer.ws.send(JSON.stringify(msg)); } catch { /**/ }
    }
  }

  // ── Snapshot ───────────────────────────────────────────────────────────────

  snapshot() {
    const trajectoryList = [...this.trajectories.entries()].map(([id, t]) => ({
      peerId:    id,
      speed:     +t.speed.toFixed(2),
      lodBias:   t.lodBias,
      isStationary: t.isStationary,
      samples:   t.samples.length,
      ageMs:     Math.round(t.age()),
    }));

    return {
      running:      this._running,
      anchorSeq:    this.anchors.current?.seq ?? 0,
      anchorAge:    Math.round(this.anchors.anchorAge),
      peersTracked: this.trajectories.size,
      stats:        { ...this.stats },
      trajectories: trajectoryList,
      frustumBounds:this.sharedFrustumBounds(),
    };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const temporalCoherence = new TemporalCoherenceLayer();
