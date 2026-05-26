/**
 * server/vsl-conflict-resolver.js — Deterministic Fork Resolution
 *
 * Solves the mass-PvP desync problem:
 *
 * SCENARIO: 100 players in same zone all edit voxels simultaneously.
 *           Network partitions → two groups see different world states.
 *           Without resolver → permanent divergence.
 *
 * SOLUTION: Detect forks → collect both branches → deterministic re-merge.
 *
 * Fork detection:
 *   Two peers report different stateHash at the same tick for the same zone.
 *   → Fork point = last tick where hashes matched.
 *
 * Fork resolution (3 steps):
 *   1. COLLECT  — gather all events from both branches since fork point
 *   2. MERGE    — apply deterministic reduce() (vsl-reducer.js)
 *   3. BROADCAST — emit canonical resolved state to all zone peers
 *
 * Replay safety:
 *   Events are sorted by tick → authority_weight → sig before merge.
 *   Same algorithm on every peer → identical canonical state guaranteed.
 *
 * Mass-PvP handling:
 *   Combat events (authority_weight=2 for authoritative peer) win ties.
 *   Latency compensation: events within ±5 ticks are considered concurrent.
 */

import { EventEmitter }  from 'events';
import { createHash }    from 'crypto';
import { reduce }        from './vsl-reducer.js';

// ── Constants ─────────────────────────────────────────────────────────────────

export const FORK_TICK_TOLERANCE   = 5;    // events within ±5 ticks are concurrent
export const FORK_DETECTION_WINDOW = 200;  // remember stateHash reports for N ticks
export const MAX_FORK_EVENTS       = 5000; // max events to reconcile per fork
export const MAX_ACTIVE_FORKS      = 20;   // prevent DoS from fork spam

// ── Fork record ───────────────────────────────────────────────────────────────

class Fork {
  constructor(zoneId, tick) {
    this.id       = createHash('sha256').update(`${zoneId}:${tick}:${Date.now()}`).digest('hex').slice(0, 16);
    this.zoneId   = zoneId;
    this.forkTick = tick;
    this.anchorTick = tick;       // last known-good tick
    this.branches = new Map();    // peerId → { events, stateHash, tick }
    this.resolved = false;
    this.result   = null;         // { canonical: Map, stateHash, appliedCount }
    this.ts       = Date.now();
    this.resolvedAt = null;
  }

  addBranch(peerId, events, stateHash, atTick) {
    this.branches.set(peerId, { events: [...events], stateHash, atTick });
  }

  age() { return Date.now() - this.ts; }
}

// ── ConflictResolver ──────────────────────────────────────────────────────────

export class ConflictResolver extends EventEmitter {
  constructor() {
    super();

    // Recent stateHash reports: zoneId → [{ peerId, stateHash, tick, ts }]
    this._hashReports  = new Map();

    // Active forks: forkId → Fork
    this.activeForks   = new Map();

    // Resolved forks history (last 100)
    this.resolvedForks = [];

    // Stats
    this.stats = {
      forksDetected: 0,
      forksResolved: 0,
      forksFailed:   0,
      totalEvents:   0,
    };
  }

  // ── Report peer state ──────────────────────────────────────────────────

  /**
   * Call this when a peer reports its current stateHash.
   * If it disagrees with another recent report for the same zone + tick,
   * a fork is detected.
   *
   * @param {string} zoneId
   * @param {string} peerId
   * @param {string} stateHash
   * @param {number} atTick
   * @returns {Fork | null}  — detected fork, or null if no conflict
   */
  reportState(zoneId, peerId, stateHash, atTick) {
    if (!this._hashReports.has(zoneId)) {
      this._hashReports.set(zoneId, []);
    }

    const reports = this._hashReports.get(zoneId);
    reports.push({ peerId, stateHash, atTick, ts: Date.now() });

    // Keep only recent FORK_DETECTION_WINDOW ticks
    const cutoff = atTick - FORK_DETECTION_WINDOW;
    this._hashReports.set(zoneId, reports.filter(r => r.atTick >= cutoff));

    // Check for fork: another peer reported a different hash at same ± tolerance tick
    const conflict = reports.find(r =>
      r.peerId    !== peerId &&
      r.stateHash !== stateHash &&
      Math.abs(r.atTick - atTick) <= FORK_TICK_TOLERANCE,
    );

    if (conflict) {
      return this._handleForkDetected(zoneId, conflict, { peerId, stateHash, atTick });
    }

    return null;
  }

  _handleForkDetected(zoneId, reportA, reportB) {
    // Don't create duplicate fork for same zone + tick window
    for (const fork of this.activeForks.values()) {
      if (fork.zoneId === zoneId &&
          Math.abs(fork.forkTick - reportA.atTick) <= FORK_TICK_TOLERANCE * 2) {
        return fork;
      }
    }

    // Cap active forks
    if (this.activeForks.size >= MAX_ACTIVE_FORKS) {
      // Remove oldest unresolved fork
      const oldest = [...this.activeForks.values()].sort((a, b) => a.ts - b.ts)[0];
      this.activeForks.delete(oldest.id);
    }

    const forkTick = Math.min(reportA.atTick, reportB.atTick);
    const fork     = new Fork(zoneId, forkTick);

    this.activeForks.set(fork.id, fork);
    this.stats.forksDetected++;

    this.emit('fork.detected', {
      forkId:   fork.id,
      zoneId,
      forkTick,
      peerA:    reportA.peerId,
      hashA:    reportA.stateHash,
      peerB:    reportB.peerId,
      hashB:    reportB.stateHash,
    });

    return fork;
  }

  // ── Submit events for resolution ─────────────────────────────────────────

  /**
   * Submit a branch of events for an active fork.
   * When all expected branches are submitted, resolution begins.
   *
   * @param {string}        forkId
   * @param {string}        peerId    — which peer this branch comes from
   * @param {object[]}      events    — VSL events from this peer's view
   * @param {string}        stateHash — this peer's current state hash
   * @param {number}        atTick
   * @param {string[]}      zonePeers — sorted zone peer list (for authority)
   */
  submitBranch(forkId, peerId, events, stateHash, atTick, zonePeers = []) {
    const fork = this.activeForks.get(forkId);
    if (!fork || fork.resolved) return null;

    fork.addBranch(peerId, events.slice(0, MAX_FORK_EVENTS), stateHash, atTick);
    this.stats.totalEvents += events.length;

    // Attempt resolution when we have at least 2 branches
    if (fork.branches.size >= 2) {
      return this._resolve(fork, zonePeers);
    }

    return null;
  }

  /**
   * Force resolution with the events we have (called after timeout).
   */
  forceResolve(forkId, zonePeers = []) {
    const fork = this.activeForks.get(forkId);
    if (!fork || fork.resolved) return null;
    return this._resolve(fork, zonePeers);
  }

  // ── Deterministic resolution ──────────────────────────────────────────────

  _resolve(fork, zonePeers) {
    // Collect all events from all branches
    const allEvents = [];
    for (const { events } of fork.branches.values()) {
      allEvents.push(...events);
    }

    if (!allEvents.length) {
      fork.resolved = true;
      fork.result   = { canonical: new Map(), stateHash: '0'.repeat(64), appliedCount: 0 };
      this.stats.forksFailed++;
      this.activeForks.delete(fork.id);
      return fork.result;
    }

    // Apply deterministic reduce (same algorithm used by every peer)
    const maxTick = Math.max(...allEvents.map(e => e.tick));
    const result  = reduce(allEvents, fork.zoneId, maxTick, zonePeers);

    fork.resolved   = true;
    fork.resolvedAt = Date.now();
    fork.result     = result;

    this.activeForks.delete(fork.id);
    this.resolvedForks.push({
      id:           fork.id,
      zoneId:       fork.zoneId,
      forkTick:     fork.forkTick,
      resolvedAt:   fork.resolvedAt,
      branchCount:  fork.branches.size,
      eventsTotal:  allEvents.length,
      appliedCount: result.appliedCount,
      droppedCount: result.droppedCount,
      stateHash:    result.stateHash,
      durationMs:   fork.resolvedAt - fork.ts,
    });
    if (this.resolvedForks.length > 100) this.resolvedForks.shift();

    this.stats.forksResolved++;

    this.emit('fork.resolved', {
      forkId:      fork.id,
      zoneId:      fork.zoneId,
      stateHash:   result.stateHash,
      appliedCount:result.appliedCount,
      droppedCount:result.droppedCount,
      durationMs:  fork.resolvedAt - fork.ts,
    });

    return result;
  }

  // ── Canonical state application ─────────────────────────────────────────

  /**
   * Apply a resolved canonical state back to a VSLedger.
   * Rebuilds the ledger's voxelMap from the canonical merge result.
   *
   * @param {VSLedger} ledger
   * @param {Map}      canonicalMap  — from resolve() result.voxelMap
   * @param {string}   stateHash
   */
  applyToLedger(ledger, canonicalMap, stateHash) {
    ledger.voxelMap  = new Map(canonicalMap);
    ledger.stateHash = stateHash;
    // Emit reconcile event for subscribers
    ledger._emit?.({ type: 'reconcile', stateHash, voxelCount: canonicalMap.size });
  }

  // ── Timeout cleanup ────────────────────────────────────────────────────

  /**
   * Clean up forks that have been pending too long (> 30s).
   * Forces resolution with whatever branches we have.
   */
  cleanup() {
    const timeout = 30_000;
    for (const [id, fork] of this.activeForks) {
      if (fork.age() > timeout) {
        this.forceResolve(id);
        if (fork.branches.size === 0) {
          this.activeForks.delete(id);
          this.stats.forksFailed++;
        }
      }
    }
  }

  // ── Accessors ─────────────────────────────────────────────────────────

  getActiveForks() {
    return [...this.activeForks.values()].map(f => ({
      id:         f.id,
      zoneId:     f.zoneId,
      forkTick:   f.forkTick,
      branches:   f.branches.size,
      ageMs:      f.age(),
    }));
  }

  getRecentResolutions(n = 10) {
    return this.resolvedForks.slice(-n);
  }

  getStats() {
    return {
      ...this.stats,
      activeForks:    this.activeForks.size,
      resolvedHistory:this.resolvedForks.length,
      avgResolutionMs:this.resolvedForks.length
        ? Math.round(this.resolvedForks.reduce((s, f) => s + f.durationMs, 0) / this.resolvedForks.length)
        : 0,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const conflictResolver = new ConflictResolver();

// Cleanup loop every 30s
setInterval(() => conflictResolver.cleanup(), 30_000).unref();
