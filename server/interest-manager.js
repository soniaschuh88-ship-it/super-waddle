/**
 * server/interest-manager.js — Per-Peer Event Interest Filtering
 *
 * The bandwidth explosion problem solved:
 *   Without this: every event → every peer → O(n²) network load
 *   With this:    every event → only interested peers → O(n·k), k≈5-15
 *
 * Interest is determined by 3 orthogonal factors:
 *
 *   ① SPATIAL   — distance from event to peer (zone + radius)
 *   ② PRIORITY  — event class determines broadcast radius
 *   ③ FRUSTUM   — peers only receive what their view direction faces
 *                 (approximated as half-sphere in movement direction)
 *
 * Event priority classes and their interest radii (world voxels):
 *
 *   CRITICAL  — auth changes, proof forks, cluster migrations  → all zone peers
 *   COMBAT    — attacks, deaths, explosions                    → 512 voxels
 *   PHYSICS   — gravity, fluid sim, structural collapse        → 256 voxels
 *   TERRAIN   — player-placed/removed blocks                   → 192 voxels
 *   NPC       — NPC movement, behavior state changes           → 128 voxels
 *   AMBIENT   — grass growth, water ripple, fire spread        → 64  voxels
 *   BACKGROUND— world sim updates, unused chunks               → 32  voxels
 *
 * Subscription model:
 *   Peer subscribes to a set of zones (primary + adjacent).
 *   InterestManager maintains per-peer subscription set.
 *   On event: classify → get radius → find all peers within radius.
 *   Returns the set of peer IDs that should receive the event.
 */

import { zoneCoords, zoneNeighbours, chunkToZone } from './bkg-p2p.js';

// ── Interest radii (world voxels) ─────────────────────────────────────────────

export const PRIORITY = Object.freeze({
  CRITICAL:   0,
  COMBAT:     1,
  PHYSICS:    2,
  TERRAIN:    3,
  NPC:        4,
  AMBIENT:    5,
  BACKGROUND: 6,
});

export const INTEREST_RADIUS = Object.freeze({
  [PRIORITY.CRITICAL]:   Infinity,  // all zone peers, no distance limit
  [PRIORITY.COMBAT]:     512,
  [PRIORITY.PHYSICS]:    256,
  [PRIORITY.TERRAIN]:    192,
  [PRIORITY.NPC]:        128,
  [PRIORITY.AMBIENT]:    64,
  [PRIORITY.BACKGROUND]: 32,
});

// Priority label map (for debugging / API)
export const PRIORITY_NAME = ['CRITICAL','COMBAT','PHYSICS','TERRAIN','NPC','AMBIENT','BACKGROUND'];

// ── Event classification ──────────────────────────────────────────────────────

/**
 * Classify a VSL event into a priority class.
 * Rules derived from op type, voxel material, and metadata.
 *
 * @param {object} event — VSL event or mesh message
 * @returns {number} PRIORITY constant
 */
export function classifyEvent(event) {
  const type = event.type ?? '';
  const op   = event.op   ?? '';
  const mat  = event.value ?? event.mat ?? 0;

  // Auth / cluster events are always critical
  if (type === 'authority.rotated' || type === 'proof.block' ||
      type === 'cluster.split'     || type === 'cluster.merge' ||
      type === 'fork.detected'     || type === 'fork.resolved')
    return PRIORITY.CRITICAL;

  // Combat: fire, lava, explosion, kill materials
  if (mat === 0x03 /* EMISSIVE/lava */ || mat === 0x08 /* LAVA */ ||
      mat === 0x12 /* FIRE */          || type === 'combat.hit' ||
      type === 'entity.death'          || type === 'explosion')
    return PRIORITY.COMBAT;

  // Physics ops
  if (type === 'physics.gravity' || type === 'physics.fluid' ||
      op   === 'fill'            || type === 'structural.collapse')
    return PRIORITY.PHYSICS;

  // NPC events
  if (type === 'npc.spawn' || type === 'npc.update' || type === 'npc.death')
    return PRIORITY.NPC;

  // Terrain: explicit set/clear by a player
  if ((op === 'set' || op === 'clear') && event.actor && event.actor !== 'sim')
    return PRIORITY.TERRAIN;

  // Ambient: sim-driven changes (growth, decay, water spread)
  if (op === 'set' && event.actor === 'sim')
    return PRIORITY.AMBIENT;

  return PRIORITY.BACKGROUND;
}

// ── World position helpers ────────────────────────────────────────────────────

/** Convert chunk + local voxel coords to world position */
function eventWorldPos(event) {
  // chunkId is hex-encoded cx (4 chars) + cy (4 chars) + cz (4 chars)
  const chunkId = event.chunkId ?? '000000000000';
  const cx = parseInt(chunkId.slice(0,  4), 16) << 0;
  const cy = parseInt(chunkId.slice(4,  8), 16) << 0;
  const cz = parseInt(chunkId.slice(8, 12), 16) << 0;
  return {
    wx: cx * 32 + (event.lx ?? 0),
    wy: cy * 32 + (event.ly ?? 0),
    wz: cz * 32 + (event.lz ?? 0),
  };
}

function dist3(ax, ay, az, bx, by, bz) {
  const dx = ax-bx, dy = ay-by, dz = az-bz;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

// ── Frustum approximation ─────────────────────────────────────────────────────

/**
 * Check if an event position is within a peer's approximate view frustum.
 * Approximation: a half-sphere in the peer's facing direction (yaw only).
 *
 * @param {{ wx,wy,wz }}  peer  — peer world position
 * @param {{ yaw }}       peer  — peer facing direction (degrees, 0=north/+z)
 * @param {{ wx,wy,wz }}  event — event world position
 * @param {number}        fov   — half-angle of frustum in degrees (default 120°)
 */
function inFrustum(peer, eventPos, fov = 120) {
  // If peer has no facing info, assume visible
  if (peer.yaw === undefined) return true;

  // Vector from peer to event
  const dx = eventPos.wx - (peer.wx ?? peer.cx * 32 ?? 0);
  const dz = eventPos.wz - (peer.wz ?? peer.cz * 32 ?? 0);
  if (dx === 0 && dz === 0) return true;

  // Peer's facing direction as unit vector
  const yawRad    = (peer.yaw ?? 0) * Math.PI / 180;
  const facingX   = Math.sin(yawRad);
  const facingZ   = Math.cos(yawRad);

  // Dot product (projection onto facing direction)
  const len  = Math.sqrt(dx*dx + dz*dz);
  const dot  = (dx * facingX + dz * facingZ) / len;

  // dot > cos(fov) means within fov/2 of facing direction
  return dot > Math.cos(fov * Math.PI / 180);
}

// ── Per-peer subscription ─────────────────────────────────────────────────────

/**
 * A PeerSubscription tracks which zones a peer is subscribed to
 * and their last-known world position for interest calculations.
 */
class PeerSubscription {
  constructor(peerId) {
    this.peerId    = peerId;
    this.zones     = new Set();    // subscribed zone IDs
    this.wx        = 0;
    this.wy        = 0;
    this.wz        = 0;
    this.yaw       = undefined;    // facing direction (degrees) — optional
    this.msgCount  = 0;            // messages sent to this peer
    this.bytesSent = 0;
    this.lastUpdate = Date.now();
  }

  updatePosition(wx, wy, wz, yaw) {
    this.wx  = wx;
    this.wy  = wy;
    this.wz  = wz;
    if (yaw !== undefined) this.yaw = yaw;
    this.lastUpdate = Date.now();
  }

  recordSent(bytes) {
    this.msgCount++;
    this.bytesSent += bytes;
  }
}

// ── InterestManager ───────────────────────────────────────────────────────────

export class InterestManager {
  constructor() {
    // peerId → PeerSubscription
    this.subscriptions = new Map();

    // zoneId → Set<peerId>  (reverse index for fast zone-based lookup)
    this.zoneIndex = new Map();

    // Metrics
    this.stats = {
      eventsClassified: 0,
      eventsBroadcast:  0,
      eventsFiltered:   0,  // events NOT sent because out of interest
      totalPeers:       0,
    };
  }

  // ── Subscription management ─────────────────────────────────────────────

  /**
   * Register a peer and subscribe them to their primary + adjacent zones.
   * Call this when a peer joins or moves to a new zone.
   */
  subscribe(peerId, wx, wy, wz, yaw) {
    let sub = this.subscriptions.get(peerId);
    if (!sub) {
      sub = new PeerSubscription(peerId);
      this.subscriptions.set(peerId, sub);
    }

    sub.updatePosition(wx, wy, wz, yaw);

    // Determine zone set: primary + 26 Moore neighbours
    const cx      = wx >> 5, cy = wy >> 5, cz = wz >> 5;
    const primary = chunkToZone(cx, cy, cz);
    const newZones = new Set([primary, ...zoneNeighbours(primary)]);

    // Remove from stale zones
    for (const oldZone of sub.zones) {
      if (!newZones.has(oldZone)) {
        this.zoneIndex.get(oldZone)?.delete(peerId);
      }
    }

    // Add to new zones
    sub.zones = newZones;
    for (const z of newZones) {
      if (!this.zoneIndex.has(z)) this.zoneIndex.set(z, new Set());
      this.zoneIndex.get(z).add(peerId);
    }

    this.stats.totalPeers = this.subscriptions.size;
    return primary;
  }

  /** Unsubscribe a peer (on disconnect / leave) */
  unsubscribe(peerId) {
    const sub = this.subscriptions.get(peerId);
    if (!sub) return;
    for (const z of sub.zones) {
      this.zoneIndex.get(z)?.delete(peerId);
    }
    this.subscriptions.delete(peerId);
    this.stats.totalPeers = this.subscriptions.size;
  }

  /** Update peer facing direction for frustum filtering */
  updateFacing(peerId, yaw) {
    const sub = this.subscriptions.get(peerId);
    if (sub) sub.yaw = yaw;
  }

  // ── Interest query ──────────────────────────────────────────────────────

  /**
   * Get the set of peer IDs that should receive this event.
   *
   * Algorithm:
   *   1. Classify event → priority → interest radius
   *   2. Compute event world position
   *   3. Candidate peers = peers subscribed to event's zone + neighbours
   *   4. Filter by distance ≤ radius
   *   5. Filter by frustum (optional, reduces ambient spam)
   *   6. CRITICAL events bypass distance + frustum filters
   *
   * @param {object}  event    — VSL event or mesh message
   * @param {string}  zoneId   — zone where event originated
   * @param {string}  originId — peer who sent the event (excluded from result)
   * @returns {string[]} peer IDs that should receive this event
   */
  getInterestedPeers(event, zoneId, originId = '') {
    this.stats.eventsClassified++;

    const priority = classifyEvent(event);
    const radius   = INTEREST_RADIUS[priority];

    // CRITICAL: all peers subscribed to this zone, no filtering
    if (priority === PRIORITY.CRITICAL) {
      const peers = [...(this.zoneIndex.get(zoneId) ?? [])];
      const result = peers.filter(id => id !== originId);
      this.stats.eventsBroadcast += result.length;
      return result;
    }

    // Compute event world position
    const ePos = event.wx !== undefined
      ? { wx: event.wx, wy: event.wy ?? 0, wz: event.wz ?? 0 }
      : eventWorldPos(event);

    // Gather candidate peers: zone + zone neighbours
    const candidateZones = new Set([zoneId, ...zoneNeighbours(zoneId)]);
    const candidates     = new Set();
    for (const z of candidateZones) {
      for (const pid of (this.zoneIndex.get(z) ?? [])) {
        candidates.add(pid);
      }
    }

    const result = [];
    for (const peerId of candidates) {
      if (peerId === originId) continue;

      const sub = this.subscriptions.get(peerId);
      if (!sub) continue;

      // Distance filter
      const d = dist3(ePos.wx, ePos.wy, ePos.wz, sub.wx, sub.wy, sub.wz);
      if (d > radius) { this.stats.eventsFiltered++; continue; }

      // Frustum filter for ambient/background events only (avoids over-filtering)
      if (priority >= PRIORITY.AMBIENT && !inFrustum(sub, ePos, 150)) {
        this.stats.eventsFiltered++;
        continue;
      }

      result.push(peerId);
    }

    this.stats.eventsBroadcast += result.length;
    return result;
  }

  /**
   * Get peers for a batch of events, grouped by peer.
   * More efficient than calling getInterestedPeers per event.
   *
   * @param {object[]} events
   * @param {string}   zoneId
   * @param {string}   originId
   * @returns {Map<string, object[]>} peerId → events they should receive
   */
  routeBatch(events, zoneId, originId = '') {
    const byPeer = new Map();

    for (const event of events) {
      const interested = this.getInterestedPeers(event, zoneId, originId);
      for (const peerId of interested) {
        if (!byPeer.has(peerId)) byPeer.set(peerId, []);
        byPeer.get(peerId).push(event);
      }
    }

    return byPeer;
  }

  // ── Zone subscription queries ───────────────────────────────────────────

  /** All peers subscribed to a zone (for broadcast) */
  getPeersForZone(zoneId) {
    return [...(this.zoneIndex.get(zoneId) ?? [])];
  }

  /** All zones a peer is subscribed to */
  getPeerZones(peerId) {
    return [...(this.subscriptions.get(peerId)?.zones ?? [])];
  }

  getPeer(peerId) {
    return this.subscriptions.get(peerId) ?? null;
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────

  /**
   * Compute filter efficiency: what % of potential messages were filtered.
   * High number = good (bandwidth savings working)
   */
  filterEfficiency() {
    const total = this.stats.eventsBroadcast + this.stats.eventsFiltered;
    if (!total) return 0;
    return +(this.stats.eventsFiltered / total * 100).toFixed(1);
  }

  getStats() {
    return {
      ...this.stats,
      filterEfficiency: this.filterEfficiency() + '%',
      zones:            this.zoneIndex.size,
    };
  }

  /**
   * Per-peer message stats (for bandwidth diagnostics).
   */
  getPeerStats(limit = 20) {
    return [...this.subscriptions.entries()]
      .sort(([,a], [,b]) => b.msgCount - a.msgCount)
      .slice(0, limit)
      .map(([id, sub]) => ({
        peerId:    id,
        zoneCount: sub.zones.size,
        msgCount:  sub.msgCount,
        bytesSent: sub.bytesSent,
        lastUpdate:sub.lastUpdate,
      }));
  }

  /**
   * Snapshot of current interest zones (for zone-map UI overlay).
   */
  interestSnapshot() {
    const result = {};
    for (const [zoneId, peerSet] of this.zoneIndex) {
      if (peerSet.size > 0) {
        result[zoneId] = peerSet.size;
      }
    }
    return result;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const interestManager = new InterestManager();
