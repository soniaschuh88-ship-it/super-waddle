/**
 * server/bkg-p2p.js — bKG Distributed MMO Engine: P2P Coordination Layer
 *
 * Implements:
 *   ① Peer registry     — peers join/leave, report capabilities
 *   ② Zone partitioner  — spatial hash → dynamic cluster grouping
 *   ③ Cluster roles     — SIMULATION_NODE / RENDER_NODE / RELAY_NODE / BACKUP_NODE
 *   ④ WebSocket relay   — fallback when WebRTC can't pierce NAT
 *   ⑤ WebRTC signaling  — offer/answer/ICE exchange via server relay
 *   ⑥ State proof chain — tamper-evident tick-state hash chain
 *   ⑦ NPC consensus     — lightweight peer vote for zone-local NPC spawn
 *   ⑧ Compute farming   — idle peer contribution registry
 *
 * Architecture:
 *   World → spatial hash grid → zones (8³ chunks each)
 *   Zone  → cluster (10-80 peers) → role assignment
 *   Roles → distributed simulation responsibility
 */

import { createHash, randomBytes } from 'crypto';
import { WebSocketServer }         from 'ws';

// ── Constants ─────────────────────────────────────────────────────────────────

export const ZONE_CHUNKS    = 4;   // zone = 4³ chunk area (128³ world voxels)
export const MAX_ZONE_PEERS = 80;
export const MIN_ZONE_PEERS = 3;   // below this, zone goes to backup
export const TICK_INTERVAL  = 50;  // 20 Hz simulation ticks
export const PROOF_INTERVAL = 200; // emit state proof every N ticks

// Peer roles
export const PEER_ROLE = Object.freeze({
  SIMULATION_NODE: 'sim',    // runs physics + NPC for zone
  RENDER_NODE:     'render', // generates/streams mesh tiles
  RELAY_NODE:      'relay',  // forwards state diffs to slow peers
  BACKUP_NODE:     'backup', // hot standby for sim node
  IDLE:            'idle',   // in compute-farm mode
});

// ── Spatial hash helpers ──────────────────────────────────────────────────────

/**
 * Hash a chunk coordinate to a zone ID string.
 * Zone = 4³ chunk cube = 128³ world-voxel area.
 */
export function chunkToZone(cx, cy, cz) {
  const zx = Math.floor(cx / ZONE_CHUNKS);
  const zy = Math.floor(cy / ZONE_CHUNKS);
  const zz = Math.floor(cz / ZONE_CHUNKS);
  return `${zx}:${zy}:${zz}`;
}

/** Parse zone ID back to integer coordinates */
export function zoneCoords(zoneId) {
  const [zx, zy, zz] = zoneId.split(':').map(Number);
  return { zx, zy, zz };
}

/** Get neighbouring zone IDs (26 neighbours, Moore neighbourhood) */
export function zoneNeighbours(zoneId) {
  const { zx, zy, zz } = zoneCoords(zoneId);
  const out = [];
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (dx || dy || dz) out.push(`${zx+dx}:${zy+dy}:${zz+dz}`);
  return out;
}

// ── Proof chain ───────────────────────────────────────────────────────────────

/**
 * State proof block — tamper-evident hash chain.
 * Prevents desync, replay attacks, and invalid state injection.
 *
 * Block structure:
 *   prevHash      — previous block hash (chain it)
 *   tick          — simulation tick number
 *   zoneId        — zone this proof covers
 *   stateHash     — hash of chunk diffs in this tick
 *   peerSigs      — contributing peer IDs (sorted)
 */
function hashBlock(prevHash, tick, zoneId, stateHash, peerIds) {
  return createHash('sha256')
    .update(`${prevHash}:${tick}:${zoneId}:${stateHash}:${peerIds.sort().join(',')}`)
    .digest('hex');
}

function hashState(chunkDiffs) {
  return createHash('sha256')
    .update(JSON.stringify(chunkDiffs))
    .digest('hex');
}

// ── Peer registry ─────────────────────────────────────────────────────────────

export class PeerRegistry {
  constructor() {
    // peerId → PeerInfo
    this.peers = new Map();
    // zoneId → Set<peerId>
    this.zones = new Map();
    // zoneId → { simNode, renderNode, relayNodes, backupNode }
    this.clusterRoles = new Map();
  }

  /**
   * Register a new peer.
   * @param {object} opts
   * @param opts.peerId   — caller-provided ID (or generate one)
   * @param opts.gpuTier  — 0=none 1=low 2=mid 3=high
   * @param opts.lat      — estimated latency to server (ms)
   * @param opts.bw       — available bandwidth (Mbps, estimated)
   * @param opts.cx/cy/cz — current chunk position
   */
  join({ peerId, gpuTier = 0, lat = 999, bw = 1, cx = 0, cy = 0, cz = 0 }) {
    const id = peerId ?? randomBytes(6).toString('hex');
    const zoneId = chunkToZone(cx, cy, cz);

    const peer = {
      id,
      gpuTier,
      lat,
      bw,
      cx, cy, cz,
      zoneId,
      role:        PEER_ROLE.IDLE,
      joinedAt:    Date.now(),
      lastSeen:    Date.now(),
      computeFarm: false,
      ws:          null,   // WebSocket connection (set by WS handler)
    };

    this.peers.set(id, peer);
    this._addToZone(id, zoneId);
    this._rebalanceZone(zoneId);

    return { peerId: id, zoneId, role: peer.role };
  }

  leave(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this._removeFromZone(peerId, peer.zoneId);
    this.peers.delete(peerId);
    this._rebalanceZone(peer.zoneId);
  }

  updatePosition(peerId, cx, cy, cz) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    const newZone = chunkToZone(cx, cy, cz);
    if (newZone !== peer.zoneId) {
      this._removeFromZone(peerId, peer.zoneId);
      peer.zoneId = newZone;
      peer.cx = cx; peer.cy = cy; peer.cz = cz;
      this._addToZone(peerId, newZone);
      this._rebalanceZone(newZone);
    } else {
      peer.cx = cx; peer.cy = cy; peer.cz = cz;
    }
    peer.lastSeen = Date.now();
  }

  getPeer(peerId)       { return this.peers.get(peerId) ?? null; }
  getZonePeers(zoneId)  { return [...(this.zones.get(zoneId) ?? [])].map(id => this.peers.get(id)).filter(Boolean); }
  getCluster(zoneId)    { return this.clusterRoles.get(zoneId) ?? null; }

  /** All peers currently in simulation nodes across all zones */
  getSimNodes() {
    return [...this.peers.values()].filter(p => p.role === PEER_ROLE.SIMULATION_NODE);
  }

  listZones() {
    return [...this.zones.entries()]
      .filter(([, s]) => s.size > 0)
      .map(([zoneId, peerSet]) => ({
        zoneId,
        peerCount: peerSet.size,
        cluster:   this.clusterRoles.get(zoneId) ?? null,
      }));
  }

  stats() {
    return {
      peers:   this.peers.size,
      zones:   this.zones.size,
      simNodes:   this.getSimNodes().length,
      idlePeers:  [...this.peers.values()].filter(p => p.role === PEER_ROLE.IDLE).length,
      farmPeers:  [...this.peers.values()].filter(p => p.computeFarm).length,
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _addToZone(peerId, zoneId) {
    if (!this.zones.has(zoneId)) this.zones.set(zoneId, new Set());
    this.zones.get(zoneId).add(peerId);
  }

  _removeFromZone(peerId, zoneId) {
    this.zones.get(zoneId)?.delete(peerId);
    if (this.zones.get(zoneId)?.size === 0) this.zones.delete(zoneId);
  }

  /**
   * Role assignment algorithm:
   * Sort zone peers by (gpuTier DESC, lat ASC, bw DESC)
   * Best  → SIMULATION_NODE (runs physics+NPC)
   * 2nd   → BACKUP_NODE     (hot standby)
   * Next  → RENDER_NODE     (mesh generation)
   * Rest  → RELAY_NODE      (state forwarding)
   */
  _rebalanceZone(zoneId) {
    const peerSet = this.zones.get(zoneId);
    if (!peerSet || peerSet.size === 0) {
      this.clusterRoles.delete(zoneId);
      return;
    }

    const peers = [...peerSet]
      .map(id => this.peers.get(id))
      .filter(Boolean)
      .sort((a, b) =>
        b.gpuTier - a.gpuTier ||
        a.lat     - b.lat     ||
        b.bw      - a.bw,
      );

    // Reset all to idle first
    for (const p of peers) p.role = PEER_ROLE.IDLE;

    const cluster = {
      simNode:     null,
      backupNode:  null,
      renderNodes: [],
      relayNodes:  [],
    };

    for (let i = 0; i < peers.length; i++) {
      if (i === 0) {
        peers[i].role  = PEER_ROLE.SIMULATION_NODE;
        cluster.simNode = peers[i].id;
      } else if (i === 1 && peers.length >= MIN_ZONE_PEERS) {
        peers[i].role  = PEER_ROLE.BACKUP_NODE;
        cluster.backupNode = peers[i].id;
      } else if (i <= 3) {
        peers[i].role  = PEER_ROLE.RENDER_NODE;
        cluster.renderNodes.push(peers[i].id);
      } else {
        peers[i].role  = PEER_ROLE.RELAY_NODE;
        cluster.relayNodes.push(peers[i].id);
      }
    }

    this.clusterRoles.set(zoneId, cluster);
  }

  /** Mark idle peers as compute-farm contributors */
  activateComputeFarm(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    peer.computeFarm = true;
    if (peer.role === PEER_ROLE.IDLE) peer.role = PEER_ROLE.RELAY_NODE;
    return true;
  }

  /** Evict peers not seen in >30s */
  evictStale() {
    const threshold = Date.now() - 30_000;
    const evicted   = [];
    for (const [id, peer] of this.peers) {
      if (peer.lastSeen < threshold) { this.leave(id); evicted.push(id); }
    }
    return evicted;
  }
}

// ── NPC Consensus ─────────────────────────────────────────────────────────────

/**
 * Lightweight NPC spawn vote — zone peers vote on whether to spawn/despawn NPCs.
 * Uses simple majority; deterministic tie-break via seed.
 */
export class NPCConsensus {
  constructor() {
    this.votes   = new Map();  // voteId → { yea: Set<peerId>, nay: Set<peerId>, resolved, result }
    this.npcs    = new Map();  // npcId  → NPC state
  }

  /** Propose spawning an NPC in a zone */
  proposeSpawn(zoneId, npcSeed, peerCount) {
    const voteId = `spawn:${zoneId}:${npcSeed}`;
    if (this.votes.has(voteId)) return voteId;
    this.votes.set(voteId, {
      zoneId, npcSeed, peerCount,
      yea:      new Set(),
      nay:      new Set(),
      resolved: false,
      result:   null,
      ts:       Date.now(),
    });
    return voteId;
  }

  vote(voteId, peerId, choice) {
    const vote = this.votes.get(voteId);
    if (!vote || vote.resolved) return null;

    choice ? vote.yea.add(peerId) : vote.nay.add(peerId);

    // Majority threshold: >50% of zone peers
    const threshold = Math.ceil(vote.peerCount / 2);
    if (vote.yea.size >= threshold) {
      vote.resolved = true;
      vote.result   = 'spawn';
      this._spawnNPC(vote.zoneId, vote.npcSeed);
    } else if (vote.nay.size >= threshold) {
      vote.resolved = true;
      vote.result   = 'reject';
    }

    return vote;
  }

  _spawnNPC(zoneId, seed) {
    const id = `npc:${zoneId}:${seed}`;
    if (this.npcs.has(id)) return;
    const { zx, zy, zz } = zoneCoords(zoneId);
    // Deterministic spawn position from seed
    const rng  = (n) => Math.abs(Math.sin(n * 9301 + seed * 49297) * 233280) % 1;
    this.npcs.set(id, {
      id,
      zoneId,
      seed,
      x: zx * 128 + Math.floor(rng(1) * 128),
      y: zy * 128 + Math.floor(rng(2) * 16),
      z: zz * 128 + Math.floor(rng(3) * 128),
      type:       Math.floor(rng(4) * 10),
      health:     100,
      state:      'wander',
      behaviorTs: Date.now(),
    });
  }

  getZoneNPCs(zoneId) {
    return [...this.npcs.values()].filter(n => n.zoneId === zoneId);
  }

  /** Update NPC state (called by SIMULATION_NODE) */
  updateNPC(npcId, updates) {
    const npc = this.npcs.get(npcId);
    if (!npc) return;
    Object.assign(npc, updates, { behaviorTs: Date.now() });
    return npc;
  }
}

// ── State Proof Chain ─────────────────────────────────────────────────────────

export class ProofChain {
  constructor() {
    this.chains  = new Map();  // zoneId → Block[]
    this.tick    = 0;
  }

  addBlock(zoneId, chunkDiffs, peerIds) {
    this.tick++;
    if (!this.chains.has(zoneId)) this.chains.set(zoneId, []);
    const chain  = this.chains.get(zoneId);
    const prev   = chain.at(-1);
    const stHash = hashState(chunkDiffs);
    const hash   = hashBlock(prev?.hash ?? '0'.repeat(64), this.tick, zoneId, stHash, peerIds);

    const block = {
      index:     chain.length,
      tick:      this.tick,
      zoneId,
      stateHash: stHash,
      hash,
      prevHash:  prev?.hash ?? '0'.repeat(64),
      peerIds:   [...peerIds].sort(),
      ts:        Date.now(),
    };

    // Keep only last 100 blocks per zone
    if (chain.length >= 100) chain.shift();
    chain.push(block);
    return block;
  }

  verify(zoneId) {
    const chain = this.chains.get(zoneId) ?? [];
    for (let i = 1; i < chain.length; i++) {
      const b = chain[i], prev = chain[i-1];
      const expected = hashBlock(prev.hash, b.tick, b.zoneId, b.stateHash, b.peerIds);
      if (expected !== b.hash) return { valid: false, at: i };
    }
    return { valid: true, length: chain.length };
  }

  getChain(zoneId, tail = 10) {
    return (this.chains.get(zoneId) ?? []).slice(-tail);
  }

  stats() {
    return {
      tick:      this.tick,
      zones:     this.chains.size,
      blocks:    [...this.chains.values()].reduce((s, c) => s + c.length, 0),
    };
  }
}

// ── WebSocket Relay + Signaling ───────────────────────────────────────────────

/**
 * Attach a WebSocket server to an existing HTTP server.
 *
 * Message protocol (JSON):
 *   { type: 'join', peerId?, gpuTier, lat, bw, cx, cy, cz }
 *   { type: 'offer',   to: peerId, sdp }
 *   { type: 'answer',  to: peerId, sdp }
 *   { type: 'ice',     to: peerId, candidate }
 *   { type: 'delta',   zoneId, diffs, tick }
 *   { type: 'vote',    voteId, choice }
 *   { type: 'move',    cx, cy, cz }
 *   { type: 'ping' }
 *   { type: 'farm' }   — activate compute farm mode
 */
export function attachMMOWebSocket(httpServer, registry, npcConsensus, proofChain) {
  const wss = new WebSocketServer({ server: httpServer, path: '/mmo/ws' });
  const wsMap = new Map();  // peerId → WebSocket

  wss.on('connection', (ws) => {
    let myPeerId = null;

    const send = (data) => { try { ws.send(JSON.stringify(data)); } catch { /**/ } };
    const broadcast = (zoneId, data, excludeId) => {
      const zone = registry.getZonePeers(zoneId);
      for (const peer of zone) {
        if (peer.id === excludeId) continue;
        const peerWs = wsMap.get(peer.id);
        if (peerWs?.readyState === 1) try { peerWs.send(JSON.stringify(data)); } catch { /**/ }
      }
    };

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.type) {
        case 'join': {
          const { peerId: id, zoneId, role } = registry.join({ ...msg });
          myPeerId   = id;
          ws.peerId  = id;
          wsMap.set(id, ws);
          registry.getPeer(id).ws = ws;

          send({ type: 'joined', peerId: id, zoneId, role });

          // Inform zone neighbours
          broadcast(zoneId, { type: 'peer.joined', peerId: id, role }, id);

          // Send zone peer list
          const zonePeers = registry.getZonePeers(zoneId).map(p => ({
            peerId: p.id, role: p.role, gpuTier: p.gpuTier,
          }));
          send({ type: 'zone.peers', zoneId, peers: zonePeers });
          break;
        }

        case 'move': {
          if (!myPeerId) break;
          const { cx=0, cy=0, cz=0 } = msg;
          registry.updatePosition(myPeerId, cx, cy, cz);
          break;
        }

        // WebRTC signaling passthrough
        case 'offer':
        case 'answer':
        case 'ice': {
          const target = wsMap.get(msg.to);
          if (target?.readyState === 1) {
            target.send(JSON.stringify({ ...msg, from: myPeerId }));
          }
          break;
        }

        // Zone state delta relay
        case 'delta': {
          if (!myPeerId) break;
          const peer = registry.getPeer(myPeerId);
          if (!peer) break;

          // Only SIMULATION_NODE or RELAY_NODE should broadcast
          if (peer.role !== PEER_ROLE.SIMULATION_NODE && peer.role !== PEER_ROLE.RELAY_NODE) break;

          const { zoneId, diffs = [], tick } = msg;
          broadcast(zoneId, { type: 'delta', from: myPeerId, zoneId, diffs, tick }, myPeerId);

          // Add proof block
          if (diffs.length > 0 && peer.role === PEER_ROLE.SIMULATION_NODE) {
            const block = proofChain.addBlock(zoneId, diffs, [myPeerId]);
            send({ type: 'proof', block });
          }
          break;
        }

        // NPC spawn vote
        case 'vote': {
          if (!myPeerId) break;
          const { voteId, choice } = msg;
          const vote = npcConsensus.vote(voteId, myPeerId, choice);
          if (vote?.resolved) {
            const peer = registry.getPeer(myPeerId);
            if (peer) broadcast(peer.zoneId, { type: 'vote.resolved', voteId, result: vote.result, npcs: npcConsensus.getZoneNPCs(peer.zoneId) }, null);
          }
          break;
        }

        // Compute farm mode
        case 'farm': {
          if (myPeerId) { registry.activateComputeFarm(myPeerId); send({ type: 'farm.ok' }); }
          break;
        }

        case 'ping': {
          if (myPeerId) registry.getPeer(myPeerId).lastSeen = Date.now();
          send({ type: 'pong', ts: Date.now() });
          break;
        }
      }
    });

    ws.on('close', () => {
      if (myPeerId) {
        const peer = registry.getPeer(myPeerId);
        if (peer) broadcast(peer.zoneId, { type: 'peer.left', peerId: myPeerId }, myPeerId);
        registry.leave(myPeerId);
        wsMap.delete(myPeerId);
      }
    });

    ws.on('error', () => {
      if (myPeerId) { registry.leave(myPeerId); wsMap.delete(myPeerId); }
    });

    // Greet
    send({ type: 'hello', version: '1.0', protocol: 'bkg-mmo' });
  });

  // Evict stale peers every 30s
  setInterval(() => {
    const evicted = registry.evictStale();
    for (const id of evicted) wsMap.delete(id);
  }, 30_000);

  return wss;
}

// ── Singletons ────────────────────────────────────────────────────────────────

export const peerRegistry  = new PeerRegistry();
export const npcConsensus  = new NPCConsensus();
export const proofChain    = new ProofChain();
