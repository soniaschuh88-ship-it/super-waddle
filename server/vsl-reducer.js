/**
 * server/vsl-reducer.js — bKG Voxel State Ledger (VSL)
 *
 * The canonical truth engine for distributed voxel worlds.
 *
 * Three problems solved here:
 *   1. AUTHORITY — who decides when peers conflict?
 *   2. MERGE     — deterministic reduction of parallel events to canonical state
 *   3. LEDGER    — tamper-evident, deduplicated, P2P-syncable event chain
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  VOXEL EVENT (VSL record)
 *
 *  VoxelEvent {
 *    tick:    u64       simulation tick (monotonic)
 *    chunkId: string    chunk being mutated
 *    op:      "set" | "fill" | "clear"
 *    lx/ly/lz: u8      local voxel position (0-31 each)
 *    value:   u8        material ID (0-255)
 *    actor:   peerId    who applied it
 *    sig:     sha256    hash(tick+chunkId+op+pos+value+actor)
 *  }
 *
 *  DETERMINISTIC MERGE RULE:
 *    sort by tick ASC → sig ASC (tie-break)
 *    apply in order → last-write-wins per (chunkId, lx, ly, lz)
 *    → all peers compute identical canonical state
 *
 *  AUTHORITY ROTATION:
 *    authorPeer = sortedZonePeers[globalTick % peerCount]
 *    Non-author events are ACCEPTED but marked advisory.
 *    On merge: author events win over advisory at same tick.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash }  from 'crypto';
import { join }        from 'path';
import { homedir }     from 'os';
import {
  mkdirSync, existsSync, readFileSync,
  writeFileSync, appendFileSync,
} from 'fs';

// ── Config ────────────────────────────────────────────────────────────────────

const BKG_DIR   = process.env.BKG_DIR ?? join(homedir(), '.bkg');
const VSL_DIR   = join(BKG_DIR, 'vsl');
mkdirSync(VSL_DIR, { recursive: true });

export const AUTHORITY_EPOCH = 100; // ticks per authority slot
export const MAX_LEDGER_EVENTS = 50_000; // per zone, in-memory ring

// ── Deterministic hash ────────────────────────────────────────────────────────

function eventSig(e) {
  return createHash('sha256')
    .update(`${e.tick}:${e.chunkId}:${e.op}:${e.lx}:${e.ly}:${e.lz}:${e.value}:${e.actor}`)
    .digest('hex');
}

function stateSig(voxelMap) {
  // Deterministic hash of the entire reduced state (sorted by key)
  const entries = [...voxelMap.entries()].sort(([a], [b]) => a < b ? -1 : 1);
  return createHash('sha256')
    .update(JSON.stringify(entries))
    .digest('hex');
}

// ── VSL Event factory ─────────────────────────────────────────────────────────

export function makeVSLEvent(tick, chunkId, op, lx, ly, lz, value, actor) {
  const e = { tick, chunkId, op, lx: lx|0, ly: ly|0, lz: lz|0, value: value|0, actor, sig: '' };
  e.sig = eventSig(e);
  return e;
}

/** Verify an event's signature has not been tampered with */
export function verifyEvent(e) {
  return eventSig({ ...e, sig: '' }) === e.sig;
}

// ── Deterministic merge engine ────────────────────────────────────────────────

/**
 * The canonical reduction algorithm.
 *
 * Given an unordered set of VSL events from multiple peers,
 * ALL nodes that apply this function arrive at IDENTICAL chunk state.
 *
 * Order:
 *   1. tick ASC           — earlier events applied first
 *   2. authority flag     — authoritative beats advisory at same tick
 *   3. sig ASC            — deterministic tie-break (lexicographic)
 *
 * @param {VoxelEvent[]} events  — raw events (possibly from multiple peers)
 * @param {string}       zoneId — zone being reduced
 * @param {number}       globalTick
 * @param {string[]}     zonePeers — sorted peer list (for authority calc)
 * @returns {{ voxelMap: Map, appliedCount, droppedCount, stateHash }}
 */
export function reduce(events, zoneId, globalTick, zonePeers = []) {
  // Build authority index: tick → authoritative peerId
  const authorOf = (tick) => {
    if (!zonePeers.length) return null;
    const slot  = Math.floor(tick / AUTHORITY_EPOCH);
    return zonePeers[slot % zonePeers.length] ?? null;
  };

  // Tag each event with authority weight
  const tagged = events
    .filter(e => verifyEvent(e))          // drop tampered events
    .map(e => ({
      ...e,
      _auth: authorOf(e.tick) === e.actor ? 2 : 1,  // 2=authoritative 1=advisory
    }));

  // Deterministic sort: tick → auth DESC → sig ASC
  tagged.sort((a, b) =>
    a.tick  - b.tick  ||
    b._auth - a._auth ||
    a.sig   < b.sig ? -1 : 1,
  );

  // voxelMap: "chunkId:lx:ly:lz" → { value, tick, sig, actor }
  const voxelMap = new Map();
  let applied = 0, dropped = 0;

  for (const e of tagged) {
    const key = `${e.chunkId}:${e.lx}:${e.ly}:${e.lz}`;

    switch (e.op) {
      case 'set': {
        const existing = voxelMap.get(key);
        // Apply only if newer or same-tick with higher authority/sig
        if (!existing ||
            e.tick > existing.tick ||
            (e.tick === existing.tick && e._auth > existing._auth) ||
            (e.tick === existing.tick && e._auth === existing._auth && e.sig > existing.sig)) {
          voxelMap.set(key, { value: e.value, tick: e.tick, sig: e.sig, actor: e.actor, auth: e._auth });
          applied++;
        } else {
          dropped++;
        }
        break;
      }
      case 'clear': {
        voxelMap.set(key, { value: 0, tick: e.tick, sig: e.sig, actor: e.actor, auth: e._auth });
        applied++;
        break;
      }
      case 'fill': {
        // fill op: value packed as material, lx/ly/lz are fill extents
        // For the reducer treat as multiple set ops (already pre-expanded by sender)
        const existing = voxelMap.get(key);
        if (!existing || e.tick >= existing.tick) {
          voxelMap.set(key, { value: e.value, tick: e.tick, sig: e.sig, actor: e.actor, auth: e._auth });
          applied++;
        } else { dropped++; }
        break;
      }
    }
  }

  return {
    voxelMap,
    appliedCount: applied,
    droppedCount: dropped,
    stateHash:    stateSig(voxelMap),
    tick:         globalTick,
  };
}

/**
 * Merge two already-reduced voxelMaps.
 * Used when a peer reconnects and needs to reconcile with peers.
 */
export function mergeStates(mapA, mapB) {
  const result = new Map(mapA);
  for (const [key, b] of mapB) {
    const a = result.get(key);
    if (!a ||
        b.tick > a.tick ||
        (b.tick === a.tick && b.auth > a.auth) ||
        (b.tick === a.tick && b.auth === a.auth && b.sig > a.sig)) {
      result.set(key, b);
    }
  }
  return result;
}

// ── Authority rotation ─────────────────────────────────────────────────────────

export class AuthorityScheduler {
  /**
   * @param {string}   zoneId
   * @param {string[]} peers      sorted peer IDs (stable across cluster)
   * @param {number}   initialTick
   */
  constructor(zoneId, peers = [], initialTick = 0) {
    this.zoneId   = zoneId;
    this.peers    = [...peers].sort();  // deterministic sort
    this.tick     = initialTick;
    this.history  = [];               // { slot, peerId, startTick, endTick }
  }

  /** Add / remove peers (re-sorts deterministically) */
  setPeers(peers) {
    this.peers = [...peers].sort();
  }

  /** Current authoritative peer */
  get currentAuthority() {
    if (!this.peers.length) return null;
    const slot = Math.floor(this.tick / AUTHORITY_EPOCH);
    return this.peers[slot % this.peers.length];
  }

  /** Authority at a specific tick */
  authorityAt(tick) {
    if (!this.peers.length) return null;
    const slot = Math.floor(tick / AUTHORITY_EPOCH);
    return this.peers[slot % this.peers.length];
  }

  /** Advance tick; returns { rotated, newAuthority, oldAuthority } if rotation occurred */
  advance(steps = 1) {
    const prevSlot = Math.floor(this.tick / AUTHORITY_EPOCH);
    this.tick += steps;
    const newSlot  = Math.floor(this.tick / AUTHORITY_EPOCH);

    if (newSlot !== prevSlot && this.peers.length) {
      const old = this.peers[prevSlot % this.peers.length];
      const next = this.peers[newSlot  % this.peers.length];
      const record = {
        slot: newSlot, peerId: next,
        startTick: newSlot * AUTHORITY_EPOCH,
        endTick:   (newSlot + 1) * AUTHORITY_EPOCH - 1,
      };
      this.history.push(record);
      if (this.history.length > 100) this.history.shift();
      return { rotated: true, newAuthority: next, oldAuthority: old, tick: this.tick };
    }
    return { rotated: false, authority: this.currentAuthority, tick: this.tick };
  }

  /** Time until next rotation (in ticks) */
  get ticksUntilRotation() {
    const nextSlotStart = (Math.floor(this.tick / AUTHORITY_EPOCH) + 1) * AUTHORITY_EPOCH;
    return nextSlotStart - this.tick;
  }

  toJSON() {
    return {
      zoneId:      this.zoneId,
      tick:        this.tick,
      authority:   this.currentAuthority,
      peers:       this.peers,
      epochLength: AUTHORITY_EPOCH,
      nextRotation:this.ticksUntilRotation,
      history:     this.history.slice(-5),
    };
  }
}

// ── VSL Ledger (per-zone) ─────────────────────────────────────────────────────

export class VSLedger {
  /**
   * @param {string} zoneId
   * @param {string} worldId
   */
  constructor(zoneId, worldId = 'default') {
    this.zoneId    = zoneId;
    this.worldId   = worldId;
    this.events    = [];       // in-memory ring (MAX_LEDGER_EVENTS)
    this.voxelMap  = new Map(); // reduced state: key → voxelEntry
    this.stateHash = '0'.repeat(64);
    this.tick      = 0;
    this.authority = new AuthorityScheduler(zoneId);
    this._logPath  = join(VSL_DIR, `${worldId}-${zoneId.replace(/:/g,'-')}.vsl`);
    this._dirty    = false;
    this._subscribers = new Set();
  }

  // ── Ingest ──────────────────────────────────────────────────────────────────

  /**
   * Ingest a single event (from local peer or remote).
   * Returns { accepted, reason, stateHash }.
   */
  ingest(event) {
    if (!verifyEvent(event)) return { accepted: false, reason: 'bad_sig' };

    // Deduplicate by sig
    if (this.events.some(e => e.sig === event.sig)) {
      return { accepted: false, reason: 'duplicate' };
    }

    this.events.push(event);
    if (this.events.length > MAX_LEDGER_EVENTS) this.events.shift();

    // Append to persistent L3 log
    try { appendFileSync(this._logPath, JSON.stringify(event) + '\n'); } catch { /**/ }

    // Incrementally apply (hot path — no full re-reduce needed for ordered events)
    this._applyOne(event);
    this._dirty = true;

    // Notify subscribers
    this._emit({ type: 'event', event, stateHash: this.stateHash });

    return { accepted: true, stateHash: this.stateHash };
  }

  /**
   * Ingest a batch (e.g. from reconnecting peer).
   * Full re-reduce for correctness.
   */
  ingestBatch(events) {
    let newCount = 0;
    const existingSigs = new Set(this.events.map(e => e.sig));

    for (const e of events) {
      if (!verifyEvent(e)) continue;
      if (existingSigs.has(e.sig)) continue;
      this.events.push(e);
      existingSigs.add(e.sig);
      newCount++;
      try { appendFileSync(this._logPath, JSON.stringify(e) + '\n'); } catch { /**/ }
    }

    if (newCount > 0) {
      this._fullReduce();
      this._emit({ type: 'batch', count: newCount, stateHash: this.stateHash });
    }

    return { ingested: newCount, stateHash: this.stateHash };
  }

  // ── State access ────────────────────────────────────────────────────────────

  getVoxel(chunkId, lx, ly, lz) {
    return this.voxelMap.get(`${chunkId}:${lx}:${ly}:${lz}`)?.value ?? 0;
  }

  getChunkState(chunkId) {
    const result = {};
    for (const [key, val] of this.voxelMap) {
      if (key.startsWith(chunkId + ':')) {
        const [, lx, ly, lz] = key.split(':');
        result[`${lx}:${ly}:${lz}`] = val.value;
      }
    }
    return result;
  }

  /** Get events since a tick (for peer sync catch-up) */
  eventsSince(tick, limit = 1000) {
    return this.events
      .filter(e => e.tick > tick)
      .slice(-limit);
  }

  /** Full diff between two state hashes (for reconciliation) */
  diff(otherMap) {
    const conflicts = [];
    for (const [key, mine] of this.voxelMap) {
      const theirs = otherMap.get(key);
      if (!theirs || theirs.tick !== mine.tick || theirs.sig !== mine.sig) {
        conflicts.push({ key, mine, theirs: theirs ?? null });
      }
    }
    return conflicts;
  }

  // ── Tick advance ────────────────────────────────────────────────────────────

  advanceTick(steps = 1) {
    const rotation = this.authority.advance(steps);
    this.tick = this.authority.tick;
    if (rotation.rotated) {
      this._emit({ type: 'authority.rotated', ...rotation });
    }
    return rotation;
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  /** Load events from L3 log and re-reduce */
  loadFromDisk() {
    if (!existsSync(this._logPath)) return 0;
    try {
      const lines  = readFileSync(this._logPath, 'utf-8').trim().split('\n').filter(Boolean);
      const loaded = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      this.events  = loaded.slice(-MAX_LEDGER_EVENTS);
      this._fullReduce();
      return this.events.length;
    } catch { return 0; }
  }

  /** Compact log — keep only last N events */
  compact(keepLast = 10_000) {
    if (this.events.length <= keepLast) return 0;
    const removed = this.events.length - keepLast;
    this.events   = this.events.slice(-keepLast);
    writeFileSync(this._logPath, this.events.map(e => JSON.stringify(e)).join('\n') + '\n');
    return removed;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _applyOne(event) {
    const key = `${event.chunkId}:${event.lx}:${event.ly}:${event.lz}`;
    const auth = this.authority.authorityAt(event.tick) === event.actor ? 2 : 1;

    switch (event.op) {
      case 'set':
      case 'fill': {
        const existing = this.voxelMap.get(key);
        if (!existing ||
            event.tick > existing.tick ||
            (event.tick === existing.tick && auth > existing.auth) ||
            (event.tick === existing.tick && auth === existing.auth && event.sig > existing.sig)) {
          this.voxelMap.set(key, { value: event.value, tick: event.tick, sig: event.sig, actor: event.actor, auth });
          this.stateHash = ''; // invalidate; recompute on demand
        }
        break;
      }
      case 'clear':
        this.voxelMap.set(key, { value: 0, tick: event.tick, sig: event.sig, actor: event.actor, auth });
        this.stateHash = '';
        break;
    }
  }

  _fullReduce() {
    const { voxelMap, stateHash } = reduce(
      this.events,
      this.zoneId,
      this.tick,
      this.authority.peers,
    );
    this.voxelMap  = voxelMap;
    this.stateHash = stateHash;
  }

  _emit(event) {
    for (const fn of this._subscribers) { try { fn(event); } catch { /**/ } }
  }

  subscribe(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  snapshot() {
    return {
      zoneId:    this.zoneId,
      worldId:   this.worldId,
      tick:      this.tick,
      stateHash: this.stateHash || stateSig(this.voxelMap),
      eventCount:this.events.length,
      voxelCount:this.voxelMap.size,
      authority: this.authority.toJSON(),
    };
  }
}

// ── Global ledger registry ────────────────────────────────────────────────────

const _ledgers = new Map();  // `${worldId}:${zoneId}` → VSLedger

export function getLedger(worldId, zoneId) {
  const key = `${worldId}:${zoneId}`;
  if (!_ledgers.has(key)) {
    const l = new VSLedger(zoneId, worldId);
    l.loadFromDisk();
    _ledgers.set(key, l);
  }
  return _ledgers.get(key);
}

export function listLedgers() {
  return [..._ledgers.values()].map(l => l.snapshot());
}

export function vsStats() {
  const ledgers = [..._ledgers.values()];
  return {
    ledgers:     ledgers.length,
    totalEvents: ledgers.reduce((s, l) => s + l.events.length, 0),
    totalVoxels: ledgers.reduce((s, l) => s + l.voxelMap.size, 0),
    zones:       [...new Set(ledgers.map(l => l.zoneId))].length,
  };
}

// Auto-compact and flush every 2 minutes
setInterval(() => {
  for (const ledger of _ledgers.values()) {
    ledger.compact(10_000);
    ledger.advanceTick(1);  // advance world time
  }
}, 120_000).unref();
