/**
 * server/cluster-manager.js — bKG Distributed Voxel Consensus: Cluster Orchestration
 *
 * Sits above vsl-reducer.js and bkg-p2p.js.
 * Owns the world → zone → cluster lifecycle.
 *
 * Responsibilities:
 *   ① Zone grid           world position → stable zone assignment
 *   ② Cluster lifecycle   create / merge / split / dissolve
 *   ③ Tick coordination   global 20 Hz loop → per-zone VSL tick advance
 *   ④ Cross-zone routing  events that span zone boundaries
 *   ⑤ Failover            detect dead authority, promote backup
 *   ⑥ NPC emergence       hash-based deterministic spawn (no server entity)
 *   ⑦ Compute farming     distribute simulation tasks to idle peers
 *   ⑧ Health monitoring   lag, bandwidth, peer count metrics
 */

import { createHash }   from 'crypto';
import { EventEmitter } from 'events';
import {
  chunkToZone, zoneCoords, zoneNeighbours,
  PEER_ROLE, peerRegistry,
  npcConsensus, proofChain,
} from './bkg-p2p.js';
import {
  getLedger, makeVSLEvent, AUTHORITY_EPOCH,
} from './vsl-reducer.js';

// ── Config ────────────────────────────────────────────────────────────────────

const TICK_HZ            = 20;         // simulation ticks per second
const TICK_MS            = 1000 / TICK_HZ;
const MERGE_THRESHOLD    = 2;          // merge clusters with ≤ N peers
const SPLIT_THRESHOLD    = 60;         // split clusters with ≥ N peers
const DEAD_TIMEOUT_MS    = 10_000;     // zone considered dead after N ms no activity
const NPC_SPAWN_TICK_MOD = 10;         // check NPC spawn every N ticks
const NPC_THRESHOLD      = 3;          // spawn if hash(state+tick+seed) % 1000 < N
const MAX_NPCS_PER_ZONE  = 12;         // hard cap on emergent NPCs per zone
const COMPUTE_BATCH      = 50;         // voxels per compute-farm task

// ── NPC Emergent Spawn Engine ─────────────────────────────────────────────────

/**
 * Pure function: returns true if an NPC with this seed should exist
 * at this world state + tick combination.
 *
 * hash(worldStateHash + tick + seed) % 1000 < threshold
 *
 * Consequences:
 *  • No entity persistence — NPC "lives" only as long as condition holds
 *  • All peers compute identically — no server authority needed
 *  • Emergent density scales with threshold
 */
function npcShouldExist(worldStateHash, tick, npcSeed, threshold = NPC_THRESHOLD) {
  const h = createHash('sha256')
    .update(`${worldStateHash}:${tick}:${npcSeed}`)
    .digest('hex');
  return (parseInt(h.slice(0, 8), 16) % 1000) < threshold;
}

/** Generate deterministic NPC position from seed + zone */
function npcPosition(npcSeed, zoneId) {
  const { zx, zy, zz } = zoneCoords(zoneId);
  const rng = (salt) =>
    Math.abs(Math.sin(npcSeed * 9301 + salt * 49297) * 233280) % 1;
  return {
    wx: zx * 128 + Math.floor(rng(1) * 128),
    wy: zy * 128 + Math.floor(rng(2) * 16) + 2,
    wz: zz * 128 + Math.floor(rng(3) * 128),
  };
}

/** Deterministic NPC behavior state from seed + tick */
function npcBehaviorState(npcSeed, tick) {
  const phase = Math.floor(tick / 200);  // behavior changes every 10s
  const h = parseInt(
    createHash('sha256').update(`${npcSeed}:${phase}`).digest('hex').slice(0, 8), 16,
  );
  const STATES = ['wander', 'idle', 'patrol', 'flee', 'attack', 'gather'];
  return STATES[h % STATES.length];
}

// ── ZoneCluster ───────────────────────────────────────────────────────────────

class ZoneCluster {
  constructor(zoneId, worldId) {
    this.zoneId    = zoneId;
    this.worldId   = worldId;
    this.ledger    = getLedger(worldId, zoneId);
    this.tick      = 0;
    this.lastActivity = Date.now();
    this.metrics   = {
      ticksTotal:    0,
      eventsIngested: 0,
      crossZoneOut:  0,
      crossZoneIn:   0,
      npcCount:      0,
      computeJobs:   0,
    };
    this.npcs = new Map();  // npcSeed → { seed, zoneId, wx, wy, wz, state, tick }
  }

  get peers() { return peerRegistry.getZonePeers(this.zoneId); }
  get peerCount() { return this.peers.length; }

  get authority() {
    return this.ledger.authority.currentAuthority;
  }

  isActive() {
    return Date.now() - this.lastActivity < DEAD_TIMEOUT_MS;
  }

  tick_() {
    this.tick++;
    this.lastActivity = Date.now();
    const rotation = this.ledger.advanceTick(1);
    this.metrics.ticksTotal++;

    // Update authority in ledger
    const peerIds = this.peers.map(p => p.id).sort();
    this.ledger.authority.setPeers(peerIds);

    // Emergent NPC check every NPC_SPAWN_TICK_MOD ticks
    if (this.tick % NPC_SPAWN_TICK_MOD === 0) {
      this._updateNPCs();
    }

    return rotation;
  }

  _updateNPCs() {
    const stateHash = this.ledger.stateHash || '0'.repeat(64);
    const seeds     = Array.from({ length: 20 }, (_, i) => (this.zoneId.hashCode?.() ?? 0) + i * 1337 + parseInt(this.zoneId.replace(/[^0-9]/g,'').slice(0,4) || '0', 10));

    const active = new Set();

    for (const seed of seeds) {
      if (this.npcs.size >= MAX_NPCS_PER_ZONE && !this.npcs.has(seed)) continue;

      if (npcShouldExist(stateHash, this.tick, seed)) {
        active.add(seed);
        if (!this.npcs.has(seed)) {
          const pos   = npcPosition(seed, this.zoneId);
          const state = npcBehaviorState(seed, this.tick);
          this.npcs.set(seed, { seed, zoneId: this.zoneId, ...pos, state, spawnTick: this.tick });
        } else {
          // Update behavior state
          const npc = this.npcs.get(seed);
          npc.state    = npcBehaviorState(seed, this.tick);
          npc.lastTick = this.tick;
        }
      }
    }

    // Despawn NPCs whose condition no longer holds
    for (const [seed, npc] of this.npcs) {
      if (!active.has(seed)) this.npcs.delete(seed);
    }

    this.metrics.npcCount = this.npcs.size;
  }

  getNPCs() { return [...this.npcs.values()]; }

  ingestEvent(event) {
    const result = this.ledger.ingest(event);
    if (result.accepted) {
      this.lastActivity = Date.now();
      this.metrics.eventsIngested++;
    }
    return result;
  }

  snapshot() {
    return {
      zoneId:    this.zoneId,
      worldId:   this.worldId,
      tick:      this.tick,
      peerCount: this.peerCount,
      authority: this.authority,
      stateHash: this.ledger.stateHash?.slice(0, 16) ?? '?',
      npcs:      this.npcs.size,
      metrics:   { ...this.metrics },
      active:    this.isActive(),
      ledger:    this.ledger.snapshot(),
    };
  }
}

// Polyfill for zone ID hash (used in NPC seed generation)
String.prototype.hashCode = function() {
  let hash = 0;
  for (let i = 0; i < this.length; i++) {
    hash = ((hash << 5) - hash) + this.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

// ── ClusterManager ────────────────────────────────────────────────────────────

export class ClusterManager extends EventEmitter {
  constructor(worldId = 'default') {
    super();
    this.worldId   = worldId;
    this.clusters  = new Map();   // zoneId → ZoneCluster
    this.globalTick = 0;
    this._tickTimer = null;
    this._running   = false;

    // Cross-zone event queue: [{ fromZone, toZone, event }]
    this._crossZoneQueue = [];

    // Compute farm task queue: [{ type, data, assignedPeer }]
    this._farmQueue = [];
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start() {
    if (this._running) return this;
    this._running   = true;
    this._tickTimer = setInterval(() => this._globalTick(), TICK_MS);
    this._tickTimer.unref?.();
    this.emit('started', { worldId: this.worldId, hz: TICK_HZ });
    return this;
  }

  stop() {
    this._running = false;
    clearInterval(this._tickTimer);
    this.emit('stopped');
  }

  // ── Cluster access ─────────────────────────────────────────────────────────

  getCluster(zoneId) {
    if (!this.clusters.has(zoneId)) {
      const c = new ZoneCluster(zoneId, this.worldId);
      this.clusters.set(zoneId, c);
      this.emit('cluster.created', { zoneId, worldId: this.worldId });
    }
    return this.clusters.get(zoneId);
  }

  getOrCreateForChunk(cx, cy, cz) {
    return this.getCluster(chunkToZone(cx, cy, cz));
  }

  listClusters() {
    return [...this.clusters.values()].map(c => c.snapshot());
  }

  activeClusters() {
    return [...this.clusters.values()].filter(c => c.isActive());
  }

  // ── Event routing ──────────────────────────────────────────────────────────

  /**
   * Route a VSL event to the correct zone cluster.
   * If the event affects voxels near a zone border, also forward to neighbours.
   */
  routeEvent(event, fromPeerId) {
    const cluster = this.clusters.get(event.chunkId.split(':')[0]);
    if (!cluster) {
      // Auto-create cluster for unknown zone
      const [cxStr] = event.chunkId.split(':');
      // fallback: use event chunkId as zone (partial)
      return this.getCluster(event.chunkId).ingestEvent(event);
    }
    return cluster.ingestEvent(event);
  }

  /**
   * Ingest a VSL event by chunkId directly.
   * Derives zone from chunk coordinates embedded in chunkId or via position.
   */
  ingestVSLEvent(event) {
    // Find which cluster owns this chunk
    for (const cluster of this.clusters.values()) {
      if (cluster.ledger.events.some(e => e.chunkId === event.chunkId)) {
        return cluster.ingestEvent(event);
      }
    }
    // Default: create cluster for new zone
    return this.getCluster('0:0:0').ingestEvent(event);
  }

  /**
   * Cross-zone event: apply an event that spans a zone boundary.
   * The event is applied to BOTH zones simultaneously.
   */
  crossZoneEvent(fromZoneId, toZoneId, event) {
    const from = this.getCluster(fromZoneId);
    const to   = this.getCluster(toZoneId);
    from.ingestEvent(event);
    to.ingestEvent({ ...event, sig: event.sig + '_xz' }); // distinct sig for other zone
    this._crossZoneQueue.push({ fromZoneId, toZoneId, event, ts: Date.now() });
    from.metrics.crossZoneOut++;
    to.metrics.crossZoneIn++;
    this.emit('cross.zone', { fromZoneId, toZoneId, tick: event.tick });
  }

  // ── Global tick ────────────────────────────────────────────────────────────

  _globalTick() {
    this.globalTick++;
    const rotations = [];

    for (const cluster of this.clusters.values()) {
      if (!cluster.isActive() && cluster.peerCount === 0) continue;
      const rotation = cluster.tick_();
      if (rotation.rotated) rotations.push({ zoneId: cluster.zoneId, ...rotation });
    }

    // Process cross-zone queue
    this._drainCrossZoneQueue();

    // Compute farm dispatch
    if (this.globalTick % 10 === 0) this._dispatchFarmTasks();

    // Maintenance every 5 seconds
    if (this.globalTick % (TICK_HZ * 5) === 0) this._maintenance();

    if (rotations.length > 0) {
      this.emit('authority.rotations', { rotations, tick: this.globalTick });
    }

    this.emit('tick', { tick: this.globalTick });
  }

  _drainCrossZoneQueue() {
    const fresh = Date.now() - 1000;
    // Keep only last second of cross-zone events in queue
    this._crossZoneQueue = this._crossZoneQueue.filter(e => e.ts > fresh);
  }

  // ── Cluster maintenance (merge / split / failover) ─────────────────────────

  _maintenance() {
    for (const [zoneId, cluster] of this.clusters) {
      // 1. Failover: if authority peer gone, promote backup
      this._checkFailover(cluster);

      // 2. Dissolve empty, dead clusters
      if (cluster.peerCount === 0 && !cluster.isActive()) {
        this.clusters.delete(zoneId);
        this.emit('cluster.dissolved', { zoneId });
        continue;
      }

      // 3. Merge tiny clusters with neighbours
      if (cluster.peerCount > 0 && cluster.peerCount <= MERGE_THRESHOLD) {
        this._tryMerge(cluster);
      }

      // 4. Add proof block for active sim nodes
      if (cluster.peerCount > 0) {
        const peerIds = cluster.peers.map(p => p.id);
        proofChain.addBlock(zoneId, cluster.ledger.eventsSince(cluster.tick - 5), peerIds);
      }
    }
  }

  _checkFailover(cluster) {
    const authority = cluster.authority;
    if (!authority) return;

    const authPeer = peerRegistry.getPeer(authority);
    if (!authPeer || Date.now() - authPeer.lastSeen > 15_000) {
      // Authority is gone — promote next in rotation
      const zonePeers = cluster.peers.map(p => p.id).sort();
      if (zonePeers.length > 0) {
        cluster.ledger.authority.setPeers(zonePeers);
        // Force rotation to next slot
        cluster.ledger.authority.tick = Math.ceil(cluster.ledger.authority.tick / AUTHORITY_EPOCH + 1) * AUTHORITY_EPOCH;
        this.emit('failover', {
          zoneId:      cluster.zoneId,
          oldAuthority:authority,
          newAuthority:cluster.authority,
        });
      }
    }
  }

  _tryMerge(cluster) {
    const neighbours = zoneNeighbours(cluster.zoneId);
    for (const nzId of neighbours) {
      const neighbour = this.clusters.get(nzId);
      if (!neighbour) continue;
      const combined = cluster.peerCount + neighbour.peerCount;
      if (combined <= MERGE_THRESHOLD * 3) {
        // Move neighbour's peers to this cluster
        for (const peer of neighbour.peers) {
          peerRegistry.updatePosition(peer.id, cluster.zoneId.split(':')[0] * 128, 0, cluster.zoneId.split(':')[2] * 128);
        }
        // Merge ledger events
        cluster.ledger.ingestBatch(neighbour.ledger.events);
        this.clusters.delete(nzId);
        this.emit('cluster.merged', {
          absorbed: nzId, into: cluster.zoneId,
          peerCount: cluster.peerCount,
        });
        break;
      }
    }
  }

  // ── Compute farming ────────────────────────────────────────────────────────

  /**
   * When peers are idle, they contribute compute to shared tasks:
   *   - Mesh generation for adjacent zones
   *   - NPC behavior evaluation for far zones
   *   - State diff compression
   *   - LOD baking
   */
  _dispatchFarmTasks() {
    const idlePeers = [...peerRegistry.peers.values()]
      .filter(p => p.computeFarm || p.role === PEER_ROLE.IDLE);

    if (!idlePeers.length) return;

    for (const cluster of this.clusters.values()) {
      if (cluster.peerCount === 0) {
        // Assign idle peer to simulate this orphaned zone
        const candidate = idlePeers.shift();
        if (!candidate) break;

        const task = {
          type:     'simulate_orphan',
          zoneId:   cluster.zoneId,
          tick:     cluster.tick,
          stateHash:cluster.ledger.stateHash,
          assignedTo: candidate.id,
          ts:       Date.now(),
        };
        this._farmQueue.push(task);
        cluster.metrics.computeJobs++;

        // Notify peer via WebSocket
        const ws = candidate.ws;
        if (ws?.readyState === 1) {
          try { ws.send(JSON.stringify({ type: 'farm.task', task })); } catch { /**/ }
        }
      }
    }
  }

  addFarmTask(type, data) {
    this._farmQueue.push({ type, data, ts: Date.now(), assignedTo: null });
  }

  completeFarmTask(peerId, taskIndex, result) {
    const task = this._farmQueue[taskIndex];
    if (!task) return false;
    task.completedBy = peerId;
    task.result      = result;
    task.completedAt = Date.now();
    this.emit('farm.complete', { peerId, task });
    return true;
  }

  getFarmQueue(limit = 20) {
    return this._farmQueue.slice(-limit);
  }

  // ── Stats + introspection ──────────────────────────────────────────────────

  stats() {
    const clusters = this.activeClusters();
    const peers    = peerRegistry.stats();
    const proof    = proofChain.stats();

    return {
      worldId:       this.worldId,
      globalTick:    this.globalTick,
      running:       this._running,
      hz:            TICK_HZ,
      clusters:      { total: this.clusters.size, active: clusters.length },
      peers,
      proof,
      crossZone:     this._crossZoneQueue.length,
      farmQueue:     this._farmQueue.length,
      totalNPCs:     clusters.reduce((s, c) => s + (c.npcs ?? 0), 0),
      totalVoxels:   clusters.reduce((s, c) => s + (c.ledger?.voxelCount ?? 0), 0),
    };
  }

  /**
   * Full world snapshot — all zones + their ledger state.
   * Used for new peer bootstrap (cold sync).
   */
  worldBootstrap() {
    return {
      worldId:    this.worldId,
      globalTick: this.globalTick,
      zones:      this.listClusters(),
      peers:      peerRegistry.listZones(),
      proofChain: proofChain.stats(),
    };
  }
}

// ── Singleton per world ───────────────────────────────────────────────────────

const _managers = new Map();

export function getClusterManager(worldId = 'default') {
  if (!_managers.has(worldId)) {
    const mgr = new ClusterManager(worldId);
    mgr.start();
    _managers.set(worldId, mgr);
  }
  return _managers.get(worldId);
}

export function listManagers() {
  return [..._managers.entries()].map(([id, m]) => ({ worldId: id, ...m.stats() }));
}

// ── Exports ───────────────────────────────────────────────────────────────────

export { npcShouldExist, npcPosition, npcBehaviorState, ZoneCluster };
