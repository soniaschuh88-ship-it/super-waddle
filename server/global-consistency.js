/**
 * server/global-consistency.js — Global Visual Consistency Layer
 *
 * Solves: distributed tiles rendered by different peers look mismatched.
 *   Without this: each peer computes its own lighting/fog/tonemap → seams visible
 *   With this:    all peers share a single authoritative render state → coherent frame
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  WHAT IS BROADCAST
 *
 *  Lighting state:
 *    ambientColor    vec3   sky/ambient light colour
 *    sunDirection    vec3   normalised sun vector (world space)
 *    sunColor        vec3   direct light colour
 *    sunIntensity    float  0–2 (day/night cycle)
 *    fogColor        vec3   atmosphere colour
 *    fogNear         float  fog start distance
 *    fogFar          float  fog end distance
 *
 *  Temporal Anti-Aliasing (TAA) jitter:
 *    frameIndex      uint   monotonic render frame counter
 *    jitterX/Y       float  sub-pixel jitter offset from Halton(2,3) sequence
 *    haltonSeqLen    uint   jitter period (default 8)
 *
 *  Tone mapping:
 *    exposure        float  camera exposure (EV100)
 *    gamma           float  output gamma (2.2)
 *    saturation      float  colour saturation multiplier
 *
 *  Motion / temporal:
 *    deltaTime       float  seconds since last frame
 *    tick            uint   simulation tick (matches VSL tick)
 *    timeOfDay       float  0–1 (0=midnight, 0.5=noon, 1=midnight)
 *
 * All values must be identical on every peer rendering a tile in the same frame.
 * Server is the authority — computed once per render frame, broadcast to all peers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'events';
import { peerRegistry  } from './bkg-p2p.js';

// ── Halton low-discrepancy sequence (TAA jitter) ───────────────────────────────

/**
 * Halton sequence: b=2 for X, b=3 for Y.
 * Gives maximally spread sub-pixel sample positions.
 */
function halton(index, base) {
  let f = 1, r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** Pre-compute one period of TAA jitter (len samples) */
function buildHaltonSeq(len = 8) {
  const seq = [];
  for (let i = 0; i < len; i++) {
    seq.push({ x: halton(i + 1, 2) - 0.5, y: halton(i + 1, 3) - 0.5 });
  }
  return seq;
}

const HALTON_SEQ = buildHaltonSeq(16);

// ── Day/night cycle ────────────────────────────────────────────────────────────

/**
 * Compute sun position + sky colour from time-of-day [0,1].
 * Simplified Preetham sky model analogue — no external deps.
 *
 * Returns { sunDir, sunColor, sunIntensity, ambientColor, fogColor }
 */
function skyFromTime(t) {
  // Convert time to angle: noon=0.5 → zenith, midnight=0/1 → nadir
  const angle   = (t - 0.25) * Math.PI * 2;  // -π/2 at dawn, π/2 at dusk
  const elevation = Math.sin(angle);            // -1..1

  const dayBlend  = Math.max(0, elevation);     // 0 at/below horizon
  const dawnDusk  = Math.max(0, 1 - Math.abs(elevation) * 3);  // peaks at horizon

  // Sun direction (Y=up world space)
  const sunDir = [
    Math.cos(angle) * 0.7,
    Math.sin(angle),
    Math.cos(angle) * 0.3,
  ];

  // Sun colour: cool white at noon, warm orange at dawn/dusk
  const sunColor = [
    0.95 + dawnDusk * 0.05,
    0.90 + dayBlend * 0.10 - dawnDusk * 0.1,
    0.85 - dawnDusk * 0.4,
  ];
  const sunIntensity = Math.max(0.05, elevation * 1.3);

  // Ambient: deep blue at night, desaturated blue-white at day
  const ambientColor = [
    0.03 + dayBlend * 0.20 + dawnDusk * 0.10,
    0.04 + dayBlend * 0.22,
    0.08 + dayBlend * 0.25 + dawnDusk * 0.02,
  ];

  // Fog: dark-blue night → sky-blue day → orange dusk
  const fogColor = [
    0.02 + dayBlend * 0.45 + dawnDusk * 0.35,
    0.03 + dayBlend * 0.60,
    0.06 + dayBlend * 0.80 - dawnDusk * 0.15,
  ];

  return {
    sunDir:    sunDir.map(v => +v.toFixed(4)),
    sunColor:  sunColor.map(v => +Math.min(1, Math.max(0, v)).toFixed(4)),
    sunIntensity: +sunIntensity.toFixed(4),
    ambientColor: ambientColor.map(v => +Math.min(1, Math.max(0, v)).toFixed(4)),
    fogColor:  fogColor.map(v => +Math.min(1, Math.max(0, v)).toFixed(4)),
  };
}

// ── GlobalConsistencyLayer ─────────────────────────────────────────────────────

export class GlobalConsistencyLayer extends EventEmitter {
  constructor(options = {}) {
    super();

    // Master render frame counter — incremented at TARGET_FPS
    this.frameIndex     = 0;
    this.targetFps      = options.targetFps  ?? 60;
    this.haltonSeqLen   = options.haltonLen  ?? 16;

    // Day/night cycle speed: 1 real second = `daySpeed` in-world seconds
    // Default: 1 real minute = 1 full day
    this.daySpeed       = options.daySpeed   ?? (1 / 60);
    this.timeOfDay      = options.startTime  ?? 0.5;   // start at noon

    // Manual override for lighting (null = use procedural)
    this._lightOverride = null;

    // Tone mapping
    this.exposure    = 1.0;
    this.gamma       = 2.2;
    this.saturation  = 1.0;

    // Fog distances
    this.fogNear     = 150;
    this.fogFar      = 600;

    // Frame timing
    this._lastTick   = Date.now();
    this._timer      = null;
    this._running    = false;

    // Current render state (broadcast to all peers)
    this.state       = this._build();

    // History ring (last 30 states, for temporal effects)
    this._history    = [];
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start() {
    if (this._running) return this;
    this._running = true;
    const interval = Math.floor(1000 / this.targetFps);
    this._timer = setInterval(() => this._tick(), interval);
    this._timer.unref?.();
    return this;
  }

  stop() {
    this._running = false;
    clearInterval(this._timer);
  }

  // ── Tick ───────────────────────────────────────────────────────────────────

  _tick() {
    const now      = Date.now();
    const deltaMs  = now - this._lastTick;
    this._lastTick = now;

    const deltaTime = deltaMs / 1000;

    // Advance time of day
    this.timeOfDay = (this.timeOfDay + deltaTime * this.daySpeed) % 1;

    // Advance frame counter + TAA jitter
    this.frameIndex = (this.frameIndex + 1) >>> 0;

    // Build new state
    this.state = this._build(deltaTime);

    // Keep history ring
    this._history.push({ ...this.state, _ts: now });
    if (this._history.length > 30) this._history.shift();

    // Broadcast to connected peers
    this._broadcast();

    this.emit('frame', this.state);
  }

  // ── State construction ──────────────────────────────────────────────────────

  _build(deltaTime = 0) {
    const jitterIdx  = this.frameIndex % this.haltonSeqLen;
    const jitter     = HALTON_SEQ[jitterIdx];

    const sky = this._lightOverride ?? skyFromTime(this.timeOfDay);

    return {
      // Frame identity
      frameIndex:   this.frameIndex,
      tick:         this.frameIndex,  // aligned to render frames
      deltaTime:    +deltaTime.toFixed(4),
      timeOfDay:    +this.timeOfDay.toFixed(4),
      timestamp:    Date.now(),

      // TAA jitter (sub-pixel, normalised to [-0.5,+0.5])
      jitterX:      +jitter.x.toFixed(6),
      jitterY:      +jitter.y.toFixed(6),
      haltonSeqLen: this.haltonSeqLen,

      // Lighting
      ambientColor: sky.ambientColor,
      sunDirection: sky.sunDir,
      sunColor:     sky.sunColor,
      sunIntensity: sky.sunIntensity,

      // Atmosphere
      fogColor:     sky.fogColor,
      fogNear:      this.fogNear,
      fogFar:       this.fogFar,

      // Tone mapping
      exposure:     +this.exposure.toFixed(3),
      gamma:        +this.gamma.toFixed(3),
      saturation:   +this.saturation.toFixed(3),
    };
  }

  // ── Broadcast to all peers ──────────────────────────────────────────────────

  _broadcast() {
    const msg = JSON.stringify({ type: 'render.consistency', state: this.state });
    for (const peer of peerRegistry.peers.values()) {
      const ws = peer.ws;
      if (ws?.readyState === 1) {
        try { ws.send(msg); } catch { /**/ }
      }
    }
  }

  // ── Manual overrides ────────────────────────────────────────────────────────

  /**
   * Override lighting completely (for cut-scenes, interiors, etc.)
   * Pass null to return to procedural sky.
   */
  setLightOverride(params) {
    if (!params) { this._lightOverride = null; return; }
    this._lightOverride = {
      sunDir:       params.sunDir       ?? [0.4, 0.8, 0.3],
      sunColor:     params.sunColor     ?? [1, 0.95, 0.85],
      sunIntensity: params.sunIntensity ?? 1.0,
      ambientColor: params.ambientColor ?? [0.2, 0.22, 0.28],
      fogColor:     params.fogColor     ?? [0.45, 0.60, 0.80],
    };
  }

  setFog(near, far)      { this.fogNear = near; this.fogFar = far; }
  setExposure(ev)        { this.exposure   = Math.max(0.1, Math.min(10, ev)); }
  setTimeOfDay(t)        { this.timeOfDay  = ((t % 1) + 1) % 1; }
  setDaySpeed(s)         { this.daySpeed   = s; }

  // ── Previous frame for motion blur ─────────────────────────────────────────

  /**
   * Get the render state N frames ago.
   * Used for motion vector computation (TAA, motion blur).
   */
  prevState(nFramesBack = 1) {
    const idx = this._history.length - 1 - nFramesBack;
    return idx >= 0 ? this._history[idx] : this.state;
  }

  /**
   * Compute per-pixel motion vectors:
   *   reprojectedUV = project(prevVP * inv(curVP) * screenPos)
   * Returns the matrices needed — actual per-pixel math runs in the fragment shader.
   */
  motionBlurParams() {
    return {
      curFrameIndex:  this.frameIndex,
      prevFrameIndex: Math.max(0, this.frameIndex - 1),
      jitterCur:      { x: this.state.jitterX, y: this.state.jitterY },
      jitterPrev:     (() => {
        const idx = (this.frameIndex - 1 + this.haltonSeqLen) % this.haltonSeqLen;
        return HALTON_SEQ[idx];
      })(),
      shutterSpeed:   this.state.deltaTime,
    };
  }

  // ── Snapshot ────────────────────────────────────────────────────────────────

  snapshot() {
    return {
      running:    this._running,
      frameIndex: this.frameIndex,
      targetFps:  this.targetFps,
      timeOfDay:  +this.timeOfDay.toFixed(4),
      daySpeed:   this.daySpeed,
      state:      this.state,
      historyLen: this._history.length,
    };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const globalConsistency = new GlobalConsistencyLayer({
  targetFps: 60,
  haltonLen: 16,
  daySpeed:  1 / 60,    // 1 real minute = full day
  startTime: 0.5,       // start at noon
});
