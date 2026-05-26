/**
 * src/engine/vsl-sync.ts
 *
 * bKG VSL Client — Voxel State Ledger Sync
 *
 * Connects P2PMesh to the VLDB storage layer.
 * Handles:
 *   • Subscribing to zone VSL events via SSE (/vldb/events)
 *   • Broadcasting local mutations to zone peers via P2PMesh
 *   • Merging remote events into local VLDB state
 *   • Authority rotation tracking + UI notification
 *   • Emergent NPC scheduler (client-side deterministic engine)
 *   • Render offload registry (delegate mesh generation to peers)
 */

import type { P2PMesh, VoxelEvent, MeshMessage }  from './p2p-mesh';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ZoneSyncState {
  zoneId:     string;
  worldId:    string;
  tick:       number;
  authority:  string | null;    // current authority peer ID
  stateHash:  string;
  peerCount:  number;
  eventsSent: number;
  eventsRecv: number;
}

export interface NPC {
  seed:    number;
  zoneId:  string;
  wx:      number;
  wy:      number;
  wz:      number;
  state:   string;
  tick:    number;
}

export interface RenderOffloadTask {
  chunkId:    string;
  lod:        number;
  assignedTo: string;
  priority:   number;
}

export type AuthorityEvent = {
  type:       'authority.rotated';
  zoneId:     string;
  oldPeer:    string | null;
  newPeer:    string;
  tick:       number;
};

export type SyncEvent =
  | { type: 'voxel.set';      wx: number; wy: number; wz: number; mat: number; from: string }
  | { type: 'npc.update';     npcs: NPC[]; zoneId: string }
  | { type: 'tick';           tick: number; stateHash: string }
  | AuthorityEvent;

export type SyncHandler = (event: SyncEvent) => void;

// ── Constants ─────────────────────────────────────────────────────────────────

const AUTHORITY_EPOCH = 100;

// NPC emergence constants (must match server: cluster-manager.js)
const NPC_SPAWN_TICK_MOD  = 10;
const NPC_THRESHOLD       = 3;
const MAX_NPCS_PER_ZONE   = 12;
const NPC_SEEDS_PER_ZONE  = 20;
const BEHAVIOR_PHASE_TICKS = 200;

// ── Utility ───────────────────────────────────────────────────────────────────

/** Deterministic hash (sync version, simplified) */
function deterministicHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

/** Should an NPC with this seed exist at this world state + tick? */
function npcShouldExist(stateHash: string, tick: number, seed: number, threshold = NPC_THRESHOLD): boolean {
  const h = deterministicHash(`${stateHash}:${tick}:${seed}`);
  return (h % 1000) < threshold;
}

/** NPC position from seed + zone */
function npcPosition(seed: number, zoneId: string): { wx: number; wy: number; wz: number } {
  const [zxStr, zyStr, zzStr] = zoneId.split(':');
  const zx = parseInt(zxStr, 10), zy = parseInt(zyStr, 10), zz = parseInt(zzStr, 10);
  const rng = (salt: number) => Math.abs(Math.sin(seed * 9301 + salt * 49297) * 233280) % 1;
  return {
    wx: zx * 128 + Math.floor(rng(1) * 128),
    wy: zy * 128 + Math.floor(rng(2) * 16) + 2,
    wz: zz * 128 + Math.floor(rng(3) * 128),
  };
}

const BEHAVIOR_STATES = ['wander', 'idle', 'patrol', 'flee', 'attack', 'gather'];

function npcBehavior(seed: number, tick: number): string {
  const phase = Math.floor(tick / BEHAVIOR_PHASE_TICKS);
  const h     = deterministicHash(`${seed}:${phase}`);
  return BEHAVIOR_STATES[h % BEHAVIOR_STATES.length];
}

// ── NPCScheduler ──────────────────────────────────────────────────────────────

class NPCScheduler {
  private npcs    = new Map<number, NPC>();  // seed → NPC
  private zoneId: string;

  constructor(zoneId: string) {
    this.zoneId = zoneId;
  }

  update(tick: number, stateHash: string): NPC[] {

    if (tick % NPC_SPAWN_TICK_MOD !== 0) return [...this.npcs.values()];

    const zoneHashSeed = deterministicHash(this.zoneId);
    const active = new Set<number>();

    for (let i = 0; i < NPC_SEEDS_PER_ZONE; i++) {
      const seed = zoneHashSeed + i * 1337;
      if (this.npcs.size >= MAX_NPCS_PER_ZONE && !this.npcs.has(seed)) continue;

      if (npcShouldExist(stateHash, tick, seed)) {
        active.add(seed);
        if (!this.npcs.has(seed)) {
          const pos = npcPosition(seed, this.zoneId);
          this.npcs.set(seed, { seed, zoneId: this.zoneId, ...pos, state: npcBehavior(seed, tick), tick });
        } else {
          const npc   = this.npcs.get(seed)!;
          npc.state   = npcBehavior(seed, tick);
          npc.tick    = tick;
        }
      }
    }

    // Despawn NPCs no longer matching condition
    for (const [seed] of this.npcs) {
      if (!active.has(seed)) this.npcs.delete(seed);
    }

    return [...this.npcs.values()];
  }

  getNPCs(): NPC[] { return [...this.npcs.values()]; }
}

// ── RenderOffloadRegistry ─────────────────────────────────────────────────────

class RenderOffloadRegistry {
  private tasks = new Map<string, RenderOffloadTask>();

  register(chunkId: string, lod: number, availablePeers: string[]): RenderOffloadTask | null {
    if (!availablePeers.length) return null;
    // Assign to peer with lowest current task count
    const assignedTo = availablePeers[Math.floor(Math.random() * availablePeers.length)];
    const task: RenderOffloadTask = { chunkId, lod, assignedTo, priority: Date.now() };
    this.tasks.set(chunkId, task);
    return task;
  }

  complete(chunkId: string) { this.tasks.delete(chunkId); }
  pending()                 { return [...this.tasks.values()]; }
}

// ── VSLSync ────────────────────────────────────────────────────────────────────

export class VSLSync {
  private mesh:         P2PMesh;
  private worldId:      string;
  private zoneId:       string;
  private handlers:     Set<SyncHandler> = new Set();
  private sseSource:    EventSource | null = null;
  private npcScheduler: NPCScheduler;
  private renderOffload = new RenderOffloadRegistry();

  private state: ZoneSyncState = {
    zoneId: '', worldId: '', tick: 0, authority: null,
    stateHash: '0'.repeat(64), peerCount: 0,
    eventsSent: 0, eventsRecv: 0,
  };

  private _unsubMesh: (() => void) | null = null;

  constructor(mesh: P2PMesh, worldId: string, zoneId: string) {
    this.mesh         = mesh;
    this.worldId      = worldId;
    this.zoneId       = zoneId;
    this.npcScheduler = new NPCScheduler(zoneId);

    this.state.zoneId  = zoneId;
    this.state.worldId = worldId;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start() {
    // Subscribe to P2P mesh messages
    this._unsubMesh = this.mesh.onMessage((msg, from, via) => {
      this._onMeshMessage(msg, from, via);
    });

    // Subscribe to server SSE delta stream
    this._openSSE();

    return this;
  }

  stop() {
    this._unsubMesh?.();
    this.sseSource?.close();
    this.sseSource = null;
  }

  // ── SSE stream ────────────────────────────────────────────────────────────

  private _openSSE() {
    const url = `/vldb/events?worldId=${this.worldId}`;
    const es  = new EventSource(url);
    this.sseSource = es;

    es.addEventListener('voxel.set', (e) => {
      const evt = JSON.parse(e.data) as { wx: number; wy: number; wz: number; mat: number; src: string };
      if (!evt.src?.startsWith('agent:') && !evt.src?.startsWith('p2p:')) {
        // Emit to consumers
        this._emit({ type: 'voxel.set', wx: evt.wx, wy: evt.wy, wz: evt.wz, mat: evt.mat, from: evt.src ?? 'server' });
      }
      this.state.eventsRecv++;
    });

    es.addEventListener('batch.applied', () => { this.state.eventsRecv++; });

    es.onerror = () => {
      // Reconnect after 3s
      setTimeout(() => this._openSSE(), 3000);
    };
  }

  // ── Voxel mutation (local peer → broadcast) ───────────────────────────────

  /**
   * Apply a local voxel mutation:
   *   1. POST to VLDB server (L3 persistence)
   *   2. Broadcast VSL event to zone peers via P2PMesh
   */
  async setVoxel(wx: number, wy: number, wz: number, mat: number) {
    // Determine if we are the authority for this tick
    const isAuth = this._isAuthority();

    // Build VSL event
    const event: VoxelEvent = {
      tick:    this.state.tick,
      chunkId: this._chunkIdForWorld(wx, wy, wz),
      op:      'set',
      lx:      wx & 31,
      ly:      wy & 31,
      lz:      wz & 31,
      value:   mat,
      actor:   this.mesh.peerId,
      sig:     '',   // server will verify/assign
    };

    // Broadcast to peers
    this.mesh.broadcast({ type: 'vsl.event', event, auth: isAuth });
    this.state.eventsSent++;

    // POST to server for L3 persistence
    await fetch(`/vldb/voxel/${this.worldId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wx, wy, wz, mat, source: `p2p:${this.mesh.peerId}` }),
    }).catch(() => {});

    this._emit({ type: 'voxel.set', wx, wy, wz, mat, from: this.mesh.peerId });
    return event;
  }

  /** Broadcast a batch of mutations (e.g. from fill/generation) */
  async batchMutate(mutations: Array<{ wx: number; wy: number; wz: number; mat: number }>) {
    this.mesh.broadcast({ type: 'vsl.batch', mutations, tick: this.state.tick, from: this.mesh.peerId });
    this.state.eventsSent++;

    await fetch(`/vldb/world/${this.worldId}/agent-mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.mesh.peerId, mutations: mutations.map(m => ({ type: 'voxel.set', ...m })) }),
    }).catch(() => {});
  }

  // ── Tick advance ───────────────────────────────────────────────────────────

  /**
   * Advance local tick (called by game loop).
   * Updates NPC scheduler and emits NPC/tick events.
   */
  tick(steps = 1) {
    this.state.tick += steps;
    const tick = this.state.tick;

    // Advance authority slot
    const newAuth = this._authorityAt(tick);
    if (newAuth !== this.state.authority) {
      const old = this.state.authority;
      this.state.authority = newAuth;
      this._emit({ type: 'authority.rotated', zoneId: this.zoneId, oldPeer: old, newPeer: newAuth ?? '', tick });
    }

    // Emergent NPC update
    if (tick % NPC_SPAWN_TICK_MOD === 0) {
      const npcs = this.npcScheduler.update(tick, this.state.stateHash);
      this._emit({ type: 'npc.update', npcs, zoneId: this.zoneId });
    }

    this._emit({ type: 'tick', tick, stateHash: this.state.stateHash });
  }

  // ── Request sync from peers ───────────────────────────────────────────────

  async requestSync(fromTick = 0) {
    // Ask all peers for events since fromTick
    this.mesh.broadcast({ type: 'vsl.sync_req', sinceTickk: fromTick, zoneId: this.zoneId });

    // Also cold-sync from server
    try {
      const data = await fetch(`/vldb/world/${this.worldId}/replay?cx=0&cy=0&cz=0`)
        .then(r => r.json()) as { deltasApplied: number; stateHash?: string };
      if (data.stateHash) this.state.stateHash = data.stateHash;
    } catch { /**/ }
  }

  // ── Render offload ────────────────────────────────────────────────────────

  offloadMeshGeneration(chunkId: string, lod = 0): RenderOffloadTask | null {
    const peers = this.mesh.getPeerList().map(p => p.peerId);
    return this.renderOffload.register(chunkId, lod, peers);
  }

  // ── Handler registry ──────────────────────────────────────────────────────

  on(fn: SyncHandler)  { this.handlers.add(fn); return () => this.handlers.delete(fn); }

  private _emit(event: SyncEvent) {
    for (const fn of this.handlers) { try { fn(event); } catch { /**/ } }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _onMeshMessage(msg: MeshMessage, from: string, _via: 'rtc' | 'relay') {
    this.state.eventsRecv++;

    switch (msg.type) {
      case 'vsl.event': {
        const e = msg.event as VoxelEvent;
        if (!e) break;
        const wx = (e.chunkId.split(':')[0] ? parseInt(e.chunkId.split(':')[0], 16) : 0) * 32 + e.lx;
        const wy = e.ly;
        const wz = e.lz;
        this._emit({ type: 'voxel.set', wx, wy, wz, mat: e.value, from });
        break;
      }
      case 'vsl.batch': {
        const mutations = msg.mutations as Array<{ wx: number; wy: number; wz: number; mat: number }> ?? [];
        for (const m of mutations) {
          this._emit({ type: 'voxel.set', wx: m.wx, wy: m.wy, wz: m.wz, mat: m.mat, from });
        }
        break;
      }
      case 'vsl.sync_req': {
        // Peer wants our events — send last known state hash
        this.mesh.sendToPeer(from, {
          type: 'vsl.sync_res',
          stateHash: this.state.stateHash,
          tick:      this.state.tick,
          zoneId:    this.zoneId,
        });
        break;
      }
      case 'authority': {
        const peer = msg.peerId as string;
        const tick = msg.tick   as number;
        if (peer && tick !== undefined) {
          this.state.authority = peer;
          this._emit({ type: 'authority.rotated', zoneId: this.zoneId, oldPeer: this.state.authority, newPeer: peer, tick });
        }
        break;
      }
      case 'zone.state': {
        this.state.stateHash = msg.stateHash as string ?? this.state.stateHash;
        this.state.peerCount = msg.peerCount as number ?? this.state.peerCount;
        break;
      }
    }
  }

  private _isAuthority(): boolean {
    return this._authorityAt(this.state.tick) === this.mesh.peerId;
  }

  private _authorityAt(tick: number): string | null {
    const peers = this.mesh.getPeerList().map(p => p.peerId).sort();
    if (!peers.length) return null;
    return peers[Math.floor(tick / AUTHORITY_EPOCH) % peers.length];
  }

  private _chunkIdForWorld(wx: number, wy: number, wz: number): string {
    const cx = wx >> 5, cy = wy >> 5, cz = wz >> 5;
    return `${cx.toString(16).padStart(4,'0')}${cy.toString(16).padStart(4,'0')}${cz.toString(16).padStart(4,'0')}`;
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  getState()       { return { ...this.state }; }
  getNPCs()        { return this.npcScheduler.getNPCs(); }
  getPendingRender(){ return this.renderOffload.pending(); }
  updatePeerCount(n: number) { this.state.peerCount = n; }
}
