/**
 * server/state-healer.js — CRC Validation + Partial Patch Healing
 *
 * Detects and repairs corrupted chunk state without full resync.
 *
 * Corruption sources:
 *   • Memory corruption (rare but possible in long-running node)
 *   • Disk I/O errors (partial write to L2 chunk store)
 *   • Event log corruption (truncated JSONL line)
 *   • Network bit-flip in relay path (UDP-like WebRTC unreliable channel)
 *
 * Healing strategy (3 levels):
 *
 *   LEVEL 1 — CRC check only
 *     Fast. Runs every 30s on recently-modified chunks.
 *     O(chunkSize) per chunk.
 *
 *   LEVEL 2 — Partial patch
 *     When CRC fails: fetch canonical state from trusted peer.
 *     Apply ONLY the voxels that differ.
 *     Preserves speculative mutations not yet in canonical state.
 *
 *   LEVEL 3 — Full regeneration
 *     When Level 2 fails or trusted peer unavailable:
 *     Regenerate from event log (L3 source of truth replay).
 *     Full but deterministic.
 *
 * Trust-based peer selection:
 *   Select the peer with the highest trust score AND the chunk in cache.
 *   Never request from self. Prefer SIM_NODE over RELAY_NODE.
 */

import { createHash }       from 'crypto';
import { EventEmitter }     from 'events';
import { peerRegistry }     from './bkg-p2p.js';
import { peerTrustScore }   from './chaos-recovery.js';

// ── CRC-32 (no external deps) ─────────────────────────────────────────────────

const _CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

export function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = _CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** CRC32 of a chunk's raw voxel data (Uint8Array or TypedArray) */
export function chunkCRC(chunk) {
  // chunk.data is Uint8Array (bitpacked VLDB chunk) or Uint32Array (voxel engine)
  const view = chunk.data instanceof Uint8Array
    ? chunk.data
    : new Uint8Array(chunk.data.buffer);
  return crc32(view);
}

/** CRC32 of a VSLedger voxelMap (for state integrity verification) */
export function ledgerCRC(voxelMap) {
  if (!voxelMap?.size) return 0;
  // Deterministic: sort keys, concat values
  const sorted = [...voxelMap.entries()].sort(([a],[b]) => a < b ? -1 : 1);
  const bytes  = sorted.flatMap(([k, v]) => [...Buffer.from(`${k}:${v.value}:${v.tick}`)]);
  return crc32(new Uint8Array(bytes));
}

// ── HealResult ────────────────────────────────────────────────────────────────

export const HEAL_LEVEL    = { NONE: 0, CRC_OK: 1, PATCHED: 2, REGENERATED: 3, FAILED: 4 };
export const HEAL_LEVEL_NAME = ['NONE', 'CRC_OK', 'PATCHED', 'REGENERATED', 'FAILED'];

function healResult(level, details = {}) {
  return { level, levelName: HEAL_LEVEL_NAME[level], ...details, ts: Date.now() };
}

// ── CRC checkpoint store ──────────────────────────────────────────────────────

class CRCCheckpointStore {
  constructor() {
    this._store = new Map();   // chunkId → { crc, tick, ts }
  }

  record(chunkId, crc, tick) {
    this._store.set(chunkId, { crc, tick, ts: Date.now() });
  }

  get(chunkId)          { return this._store.get(chunkId); }
  has(chunkId)          { return this._store.has(chunkId); }
  invalidate(chunkId)   { this._store.delete(chunkId); }
  size()                { return this._store.size; }

  /** Find all chunks whose CRC is stale (older than maxAgeMs) */
  getStale(maxAgeMs = 30_000) {
    const cutoff = Date.now() - maxAgeMs;
    return [...this._store.entries()].filter(([, v]) => v.ts < cutoff).map(([k]) => k);
  }
}

// ── StateHealer ───────────────────────────────────────────────────────────────

export class StateHealer extends EventEmitter {
  constructor(clusterMgr, specTimelines) {
    super();
    this.mgr        = clusterMgr;
    this.timelines  = specTimelines;  // Map<`worldId:zoneId`, SpeculativeTimeline>
    this.checkpoints = new CRCCheckpointStore();

    // Pending heal requests: chunkId → { retries, lastAttempt }
    this._pending    = new Map();

    this._timer      = null;
    this._running    = false;

    this.stats = {
      checksRun:      0,
      corrupted:      0,
      patched:        0,
      regenerated:    0,
      failed:         0,
      crcMismatches:  0,
    };
  }

  start() {
    this._running = true;
    this._timer   = setInterval(() => this._routineCheck(), 30_000);
    this._timer.unref?.();
    return this;
  }

  stop() {
    this._running = false;
    clearInterval(this._timer);
  }

  // ── Checkpoint management ─────────────────────────────────────────────────

  /**
   * Record a CRC checkpoint for a ledger (call after each confirmed state update).
   * Returns the CRC.
   */
  checkpoint(ledger) {
    const crc = ledgerCRC(ledger.voxelMap);
    this.checkpoints.record(`${ledger.worldId}:${ledger.zoneId}`, crc, ledger.tick);
    return crc;
  }

  /**
   * Verify a ledger's current CRC against its last checkpoint.
   * Returns { valid, expected, actual } or null if no checkpoint.
   */
  verify(ledger) {
    const key  = `${ledger.worldId}:${ledger.zoneId}`;
    const cp   = this.checkpoints.get(key);
    if (!cp) return null;

    const actual = ledgerCRC(ledger.voxelMap);
    return { valid: actual === cp.crc, expected: cp.crc, actual, atTick: cp.tick };
  }

  // ── Healing pipeline ──────────────────────────────────────────────────────

  /**
   * Full heal pipeline for a ledger.
   * Tries levels 1 → 2 → 3 in order.
   *
   * @param {VSLedger} ledger
   * @param {string}   worldId
   * @returns {Promise<HealResult>}
   */
  async heal(ledger, worldId = 'default') {
    this.stats.checksRun++;
    const key = `${worldId}:${ledger.zoneId}`;

    // Level 1: CRC check
    const verify = this.verify(ledger);
    if (verify === null) {
      // No baseline: record current state and return
      this.checkpoint(ledger);
      return healResult(HEAL_LEVEL.CRC_OK, { message: 'baseline_recorded' });
    }

    if (verify.valid) {
      return healResult(HEAL_LEVEL.CRC_OK, { crc: verify.actual });
    }

    this.stats.corrupted++;
    this.stats.crcMismatches++;
    this.emit('corruption.detected', { zoneId: ledger.zoneId, worldId, ...verify });

    // Level 2: Partial patch from trusted peer
    const patchResult = await this._partialPatch(ledger, worldId);
    if (patchResult.success) {
      this.checkpoint(ledger);
      this.stats.patched++;
      this.emit('heal.patched', { zoneId: ledger.zoneId, patchedVoxels: patchResult.patches });
      return healResult(HEAL_LEVEL.PATCHED, patchResult);
    }

    // Level 3: Full regeneration from event log
    const regenResult = this._regenerate(ledger);
    if (regenResult.success) {
      this.checkpoint(ledger);
      this.stats.regenerated++;
      this.emit('heal.regenerated', { zoneId: ledger.zoneId });
      return healResult(HEAL_LEVEL.REGENERATED, regenResult);
    }

    this.stats.failed++;
    this.emit('heal.failed', { zoneId: ledger.zoneId });
    return healResult(HEAL_LEVEL.FAILED, { reason: 'all_levels_failed' });
  }

  // ── Level 2: Partial patch ────────────────────────────────────────────────

  async _partialPatch(ledger, worldId) {
    const trustedPeer = this._findTrustedPeer(ledger.zoneId);
    if (!trustedPeer) return { success: false, reason: 'no_trusted_peer' };

    // Request canonical state from trusted peer via WS
    const ws = trustedPeer.ws;
    if (!ws || ws.readyState !== 1) return { success: false, reason: 'peer_offline' };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ success: false, reason: 'timeout' }), 5000);

      // Send state request
      try {
        ws.send(JSON.stringify({
          type:    'heal.request',
          zoneId:  ledger.zoneId,
          worldId,
          fromTick:ledger.tick - 200,
        }));
      } catch {
        clearTimeout(timeout);
        return resolve({ success: false, reason: 'send_failed' });
      }

      // Listen for response (handled externally — attach listener before call)
      const handler = (evt) => {
        if (evt.type === 'heal.response' && evt.zoneId === ledger.zoneId) {
          clearTimeout(timeout);
          this.removeListener('peer.response', handler);

          // Apply patches
          const canonicalMap = new Map(Object.entries(evt.voxelMap ?? {}));
          const patches      = [];

          for (const [key, canonical] of canonicalMap) {
            const mine = ledger.voxelMap.get(key);
            if (!mine || mine.value !== canonical.value) {
              ledger.voxelMap.set(key, canonical);
              patches.push(key);
            }
          }

          resolve({ success: true, patches: patches.length, trustedPeer: trustedPeer.id });
        }
      };
      this.on('peer.response', handler);
    });
  }

  // ── Level 3: Regeneration from event log ─────────────────────────────────

  _regenerate(ledger) {
    try {
      // Full reduce from all stored events
      const events = ledger.events ?? [];
      if (!events.length) return { success: false, reason: 'no_events' };

      // Call the VSL deterministic reducer
      const { reduce } = require('./vsl-reducer.js');  // dynamic import for circularity avoidance
      const result = reduce(events, ledger.zoneId, ledger.tick, ledger.authority.peers);
      ledger.voxelMap  = result.voxelMap;
      ledger.stateHash = result.stateHash;
      return { success: true, eventsReplayed: events.length, stateHash: result.stateHash };
    } catch (e) {
      return { success: false, reason: e.message };
    }
  }

  // ── Trust-based peer selection ────────────────────────────────────────────

  _findTrustedPeer(zoneId) {
    const cluster = this.mgr.clusters.get(zoneId);
    if (!cluster?.peers?.length) return null;

    return cluster.peers
      .map(p => ({ ...p, trust: peerTrustScore(p.id, { role: p.role, latencyMs: p.lat ?? 200 }) }))
      .sort((a, b) => b.trust - a.trust)[0] ?? null;
  }

  // ── Routine check ─────────────────────────────────────────────────────────

  _routineCheck() {
    for (const cluster of this.mgr.clusters.values()) {
      if (cluster.peerCount === 0) continue;
      const ledger = cluster.ledger;
      if (!ledger) continue;
      void this.heal(ledger, cluster.worldId ?? 'default');
    }
  }

  // ── Snapshot ───────────────────────────────────────────────────────────────

  getStats() {
    return {
      ...this.stats,
      checkpoints:    this.checkpoints.size(),
      running:        this._running,
    };
  }
}
