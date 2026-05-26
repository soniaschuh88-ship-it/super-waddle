/**
 * server/speculative-replay.js — Optimistic Execution + Forward Correction
 *
 * The key insight: traditional conflict resolution rolls BACK to fork point,
 * replays from there. This causes world state jumps that break immersion.
 *
 * We do the opposite: FORWARD CORRECTION.
 *
 *   1. Apply events speculatively (immediate, no waiting)
 *   2. Track which voxels were touched speculatively
 *   3. When authority confirms state: compute diff only
 *   4. Patch ONLY diverged voxels forward
 *   5. Continuous world — no rewind, no jumps
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  TIMELINE MODEL:
 *
 *  confirmed ──────────────────────────────►
 *  speculative   ──────────────────►
 *                ↑ fork point       ↑ now
 *
 *  forward merge: canonical - speculative = patch set
 *  apply patch:   only changed voxels updated (not full state)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  VOXEL OWNERSHIP LEDGER:
 *
 *  Each voxel position tracks: { value, lastWriter, tick, confidence }
 *  confidence:
 *    CONFIRMED   — from authoritative peer, fully trusted
 *    SPECULATIVE — applied locally, pending confirmation
 *    CONTESTED   — two peers wrote different values at same tick
 *
 *  On correction: CONTESTED + SPECULATIVE entries get authority value.
 *  CONFIRMED entries never downgraded.
 */

import { createHash } from 'crypto';

// ── Confidence levels ─────────────────────────────────────────────────────────

export const CONFIDENCE = Object.freeze({
  CONFIRMED:   2,  // authoritative peer, verified
  SPECULATIVE: 1,  // applied locally, unconfirmed
  CONTESTED:   0,  // conflict detected, awaiting resolution
});

export const CONFIDENCE_NAME = { 2:'CONFIRMED', 1:'SPECULATIVE', 0:'CONTESTED' };

// ── Speculative window config ─────────────────────────────────────────────────

const MAX_SPECULATIVE_TICKS = 40;   // ~2s at 20 Hz — don't speculate further
const MAX_SPECULATIVE_VOXELS = 8192; // cap on pending speculative mutations
const CORRECTION_BATCH_SIZE  = 512;  // patch voxels per correction pass

// ── VoxelOwnershipLedger ──────────────────────────────────────────────────────

/**
 * Per-voxel ownership record.
 * Key: "chunkId:lx:ly:lz"
 * Value: OwnerEntry { value, lastWriter, tick, confidence, speculativeValue? }
 */
class VoxelOwnershipLedger {
  constructor() {
    this._entries = new Map();
    this.stats = {
      confirmed:   0,
      speculative: 0,
      contested:   0,
    };
  }

  get(key) { return this._entries.get(key); }

  /**
   * Record a confirmed write (from authority or verified proof).
   * Never overwritten by a speculative entry.
   */
  confirm(key, value, tick, writer) {
    const existing = this._entries.get(key);
    if (existing && existing.confidence === CONFIDENCE.CONFIRMED && existing.tick > tick) return;

    const wasSpec = existing?.confidence === CONFIDENCE.SPECULATIVE;
    this._entries.set(key, { value, lastWriter: writer, tick, confidence: CONFIDENCE.CONFIRMED });

    if (wasSpec) this.stats.speculative = Math.max(0, this.stats.speculative - 1);
    this.stats.confirmed++;
  }

  /**
   * Record a speculative write (local, unconfirmed).
   * Stores original value so we can detect divergence.
   */
  speculate(key, value, tick, writer) {
    const existing = this._entries.get(key);

    // Don't overwrite confirmed with speculative
    if (existing?.confidence === CONFIDENCE.CONFIRMED && existing.tick >= tick) return false;

    // Detect contest: another speculation at same tick
    if (existing?.confidence === CONFIDENCE.SPECULATIVE && existing.tick === tick && existing.lastWriter !== writer) {
      this._entries.set(key, {
        value:          existing.value,  // keep first (will be resolved)
        lastWriter:     existing.lastWriter,
        tick,
        confidence:     CONFIDENCE.CONTESTED,
        speculativeValue: value,
        contestedBy:    writer,
      });
      this.stats.contested++;
      return false;
    }

    const origValue = existing?.value;
    this._entries.set(key, {
      value,
      lastWriter:    writer,
      tick,
      confidence:    CONFIDENCE.SPECULATIVE,
      originalValue: origValue,
    });
    this.stats.speculative++;
    return true;
  }

  /**
   * Compute the set of voxels that need patching to reach canonicalMap.
   * Returns only the keys that ACTUALLY differ.
   */
  computePatchSet(canonicalMap) {
    const patches = [];
    for (const [key, canonical] of canonicalMap) {
      const mine = this._entries.get(key);
      const myVal = mine?.value ?? 0;
      if (canonical.value !== myVal) {
        patches.push({
          key,
          myValue:        myVal,
          canonicalValue: canonical.value,
          myConfidence:   mine?.confidence ?? CONFIDENCE.SPECULATIVE,
          myWriter:       mine?.lastWriter ?? null,
          canonicalWriter:canonical.actor ?? null,
          tick:           canonical.tick,
        });
      }
    }
    return patches;
  }

  /** Apply a patch set (from forward correction) */
  applyPatches(patches) {
    let applied = 0;
    for (const p of patches.slice(0, CORRECTION_BATCH_SIZE)) {
      this.confirm(p.key, p.canonicalValue, p.tick, p.canonicalWriter ?? 'authority');
      applied++;
    }
    return applied;
  }

  /** Confirm all speculative entries up to tick (they're now known-good) */
  confirmUpTo(tick, authorityPeer) {
    let confirmed = 0;
    for (const [key, entry] of this._entries) {
      if (entry.confidence === CONFIDENCE.SPECULATIVE && entry.tick <= tick) {
        entry.confidence = CONFIDENCE.CONFIRMED;
        this.stats.speculative = Math.max(0, this.stats.speculative - 1);
        this.stats.confirmed++;
        confirmed++;
      }
    }
    return confirmed;
  }

  /** Evict entries older than tick (cleanup) */
  evictBefore(tick) {
    let evicted = 0;
    for (const [key, entry] of this._entries) {
      if (entry.tick < tick - MAX_SPECULATIVE_TICKS) {
        this._entries.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  /** Count by confidence tier */
  countByConfidence() {
    const counts = { confirmed: 0, speculative: 0, contested: 0 };
    for (const e of this._entries.values()) {
      if      (e.confidence === CONFIDENCE.CONFIRMED)   counts.confirmed++;
      else if (e.confidence === CONFIDENCE.SPECULATIVE) counts.speculative++;
      else                                              counts.contested++;
    }
    return counts;
  }

  size() { return this._entries.size; }
}

// ── SpeculativeTimeline ───────────────────────────────────────────────────────

/**
 * Per-zone speculative execution timeline.
 *
 * Maintains two event streams:
 *   confirmed[]   — events verified by authority, source of truth
 *   speculative[] — events applied optimistically, pending confirmation
 *
 * On forward correction:
 *   1. Receive canonicalMap (reduced state from authority)
 *   2. computePatchSet() → which voxels differ
 *   3. applyPatches() → patch only the diverged voxels
 *   4. Drop speculative events that were contradicted
 *   5. Keep the world running — no rewind
 */
export class SpeculativeTimeline {
  /**
   * @param {string} zoneId
   * @param {string} worldId
   */
  constructor(zoneId, worldId = 'default') {
    this.zoneId       = zoneId;
    this.worldId      = worldId;
    this.ownership    = new VoxelOwnershipLedger();

    // Confirmed event log (source of truth)
    this.confirmed    = [];

    // Speculative event buffer (pending confirmation)
    this.speculative  = [];

    // Corrections received from authority
    this.corrections  = [];

    // Timeline stats
    this.stats = {
      eventsConfirmed:   0,
      eventsSpeculative: 0,
      correctionsApplied: 0,
      voxelsPatched:     0,
      contestedResolved: 0,
      evictions:         0,
    };

    this._currentTick = 0;
  }

  // ── Event ingestion ────────────────────────────────────────────────────────

  /**
   * Apply a confirmed event (from authoritative peer / verified proof).
   * Updates ownership ledger with CONFIRMED confidence.
   */
  applyConfirmed(event) {
    this.confirmed.push(event);
    if (this.confirmed.length > 10_000) this.confirmed.shift();

    const key = `${event.chunkId}:${event.lx}:${event.ly}:${event.lz}`;
    this.ownership.confirm(key, event.value, event.tick, event.actor);

    if (event.tick > this._currentTick) this._currentTick = event.tick;
    this.stats.eventsConfirmed++;
  }

  /**
   * Apply a speculative event (local peer, unconfirmed).
   * Returns false if rejected (too far ahead or ledger full).
   */
  applySpeculative(event) {
    // Reject if too far ahead of confirmed timeline
    const ahead = event.tick - this._currentTick;
    if (ahead > MAX_SPECULATIVE_TICKS) return false;

    // Reject if speculative buffer too large
    if (this.speculative.length >= MAX_SPECULATIVE_VOXELS) return false;

    this.speculative.push(event);
    const key = `${event.chunkId}:${event.lx}:${event.ly}:${event.lz}`;
    this.ownership.speculate(key, event.value, event.tick, event.actor);

    this.stats.eventsSpeculative++;
    return true;
  }

  // ── Forward correction ─────────────────────────────────────────────────────

  /**
   * THE CORE ALGORITHM: Forward correction without rollback.
   *
   * @param {Map}    canonicalMap  — from reduce() or VSLedger.voxelMap
   * @param {number} atTick        — tick this canonical state corresponds to
   * @returns {{ patchSet, appliedCount, droppedSpeculative, summary }}
   */
  forwardCorrect(canonicalMap, atTick) {
    // 1. Compute diff: what does canonical say vs what we speculatively applied?
    const patchSet = this.ownership.computePatchSet(canonicalMap);

    // 2. Apply patches — only diverged voxels, moving FORWARD
    const appliedCount = this.ownership.applyPatches(patchSet);

    // 3. Confirm speculative events up to atTick (they were correct)
    const confirmedCount = this.ownership.confirmUpTo(atTick, 'authority');

    // 4. Drop speculative events that were at or before atTick
    //    (they've now been either confirmed or corrected)
    const before = this.speculative.length;
    this.speculative = this.speculative.filter(e => e.tick > atTick);
    const droppedSpeculative = before - this.speculative.length;

    // 5. Record correction
    const correction = {
      atTick,
      patchCount:       patchSet.length,
      appliedCount,
      confirmedCount,
      droppedSpeculative,
      ts: Date.now(),
    };
    this.corrections.push(correction);
    if (this.corrections.length > 50) this.corrections.shift();

    // 6. Update stats
    this.stats.correctionsApplied++;
    this.stats.voxelsPatched += appliedCount;

    return {
      patchSet: patchSet.slice(0, 20),  // sample for logging
      appliedCount,
      droppedSpeculative,
      confirmedCount,
      summary: {
        totalPatched:     this.stats.voxelsPatched,
        specPending:      this.speculative.length,
        ownershipSize:    this.ownership.size(),
        confidence:       this.ownership.countByConfidence(),
      },
    };
  }

  /**
   * Simpler correction: authority confirms a tick range as clean.
   * No diff needed — just promote speculative → confirmed up to tick.
   */
  confirmRange(fromTick, toTick) {
    const confirmedCount = this.ownership.confirmUpTo(toTick, 'authority');
    const before         = this.speculative.length;
    this.speculative     = this.speculative.filter(e => e.tick > toTick);
    const dropped        = before - this.speculative.length;
    this._currentTick    = Math.max(this._currentTick, toTick);
    return { confirmedCount, dropped };
  }

  // ── Speculative lookahead ──────────────────────────────────────────────────

  /**
   * Build a speculative world state map from pending speculative events.
   * Used by render layer to display optimistic world state.
   */
  buildSpeculativeState() {
    const state = new Map();

    // Start from confirmed timeline
    for (const e of this.confirmed.slice(-5000)) {
      state.set(`${e.chunkId}:${e.lx}:${e.ly}:${e.lz}`, {
        value:      e.value,
        tick:       e.tick,
        confidence: CONFIDENCE.CONFIRMED,
      });
    }

    // Layer speculative events on top
    for (const e of this.speculative) {
      const key = `${e.chunkId}:${e.lx}:${e.ly}:${e.lz}`;
      const existing = state.get(key);
      if (!existing || e.tick >= existing.tick) {
        state.set(key, {
          value:      e.value,
          tick:       e.tick,
          confidence: CONFIDENCE.SPECULATIVE,
        });
      }
    }

    return state;
  }

  // ── Contested resolution ───────────────────────────────────────────────────

  /**
   * Resolve contested voxels (two peers wrote different values at same tick).
   * Uses deterministic tie-break: higher sig wins.
   *
   * @param {string[]} zonePeers — sorted authority list
   * @returns {number} resolved count
   */
  resolveContested(zonePeers = []) {
    let resolved = 0;
    for (const [key, entry] of this.ownership._entries) {
      if (entry.confidence !== CONFIDENCE.CONTESTED) continue;

      // Authority peer wins unconditionally
      const epoch    = Math.floor(this._currentTick / 100);
      const authPeer = zonePeers[epoch % zonePeers.length] ?? null;

      let winner = entry.value;
      if (authPeer === entry.lastWriter) {
        winner = entry.value;
      } else if (authPeer === entry.contestedBy) {
        winner = entry.speculativeValue ?? entry.value;
      } else {
        // Deterministic tie-break: higher hash wins
        const hashA = parseInt(createHash('sha256').update(String(entry.value)).digest('hex').slice(0, 8), 16);
        const hashB = parseInt(createHash('sha256').update(String(entry.speculativeValue ?? 0)).digest('hex').slice(0, 8), 16);
        winner = hashA > hashB ? entry.value : (entry.speculativeValue ?? entry.value);
      }

      this.ownership.confirm(key, winner, entry.tick, 'resolver');
      resolved++;
    }

    this.stats.contestedResolved += resolved;
    return resolved;
  }

  // ── Maintenance ────────────────────────────────────────────────────────────

  /** Evict stale entries, trim confirmed log */
  evict() {
    const evicted = this.ownership.evictBefore(this._currentTick);
    if (this.confirmed.length > 10_000) {
      this.confirmed = this.confirmed.slice(-5000);
    }
    this.stats.evictions += evicted;
    return evicted;
  }

  // ── Snapshot ───────────────────────────────────────────────────────────────

  snapshot() {
    return {
      zoneId:          this.zoneId,
      currentTick:     this._currentTick,
      confirmed:       this.confirmed.length,
      speculative:     this.speculative.length,
      ownership:       this.ownership.countByConfidence(),
      ownershipSize:   this.ownership.size(),
      recentCorrections: this.corrections.slice(-3),
      stats:           { ...this.stats },
    };
  }
}

// ── Timeline registry ─────────────────────────────────────────────────────────

const _timelines = new Map();  // `${worldId}:${zoneId}` → SpeculativeTimeline

export function getTimeline(worldId, zoneId) {
  const key = `${worldId}:${zoneId}`;
  if (!_timelines.has(key)) {
    _timelines.set(key, new SpeculativeTimeline(zoneId, worldId));
  }
  return _timelines.get(key);
}

export function listTimelines() {
  return [..._timelines.values()].map(t => t.snapshot());
}

export function speculativeStats() {
  const timelines = [..._timelines.values()];
  return {
    timelines:        timelines.length,
    totalConfirmed:   timelines.reduce((s, t) => s + t.confirmed.length, 0),
    totalSpeculative: timelines.reduce((s, t) => s + t.speculative.length, 0),
    totalPatched:     timelines.reduce((s, t) => s + t.stats.voxelsPatched, 0),
    totalContested:   timelines.reduce((s, t) => s + t.stats.contestedResolved, 0),
  };
}

// Maintenance every 60s
setInterval(() => {
  for (const t of _timelines.values()) t.evict();
}, 60_000).unref();
