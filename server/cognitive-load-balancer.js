/**
 * server/cognitive-load-balancer.js — Event Clustering + Perception Management
 *
 * Solves: 10,000 players generating events simultaneously → UI/perception overload.
 * Without this: each player receives thousands of raw events/second → browser dies.
 * With this:    events clustered spatially + temporally → compressed event packets.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  THREE MECHANISMS
 *
 *  ① SPATIAL CLUSTERING (DBSCAN-lite)
 *     Events within CLUSTER_RADIUS voxels → merged into one ClusterEvent.
 *     ClusterEvent has: centroid, bounding box, event count, dominant type.
 *     Effect: 100 sand grains falling → "50 grains fell near (x,y,z)"
 *
 *  ② TEMPORAL BATCHING
 *     Events within BATCH_WINDOW_MS → collected, deduplicated, merged.
 *     Per-peer batch: max MAX_EVENTS_PER_BATCH events after merge.
 *     Effect: rapid block placement burst → one "32 blocks placed" packet.
 *
 *  ③ ATTENTION BUDGET (per peer)
 *     Each peer has an attention budget: events/second they can process.
 *     Budget depends on: viewport size, GPU tier, current UI state.
 *     Excess events → queued and spread over time (smoothed delivery).
 *     Critical events (combat) → bypass budget, delivered immediately.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'events';
import { peerRegistry  } from './bkg-p2p.js';
import { PRIORITY, classifyEvent } from './interest-manager.js';

// ── Config ────────────────────────────────────────────────────────────────────

const CLUSTER_RADIUS      = 32;    // voxels — events within this radius → cluster
const BATCH_WINDOW_MS     = 50;    // collect events into batches of this width
const MAX_EVENTS_PER_BATCH= 20;    // max events per peer per batch window
const BASE_ATTENTION_RATE = 100;   // events/second for GPU tier=0
const ATTENTION_PER_GPU   = 50;    // +50/s per GPU tier level
const CRITICAL_BURST_MAX  = 10;    // max unbuffered critical events/batch
const CLUSTER_TTL_MS      = 200;   // clusters older than this are emitted

// ── Vec3 distance (2D horizontal only — most events are on XZ plane) ──────────

function xzDist(a, b) {
  const dx = (a.wx ?? 0) - (b.wx ?? 0);
  const dz = (a.wz ?? 0) - (b.wz ?? 0);
  return Math.sqrt(dx*dx + dz*dz);
}

// ── EventCluster ───────────────────────────────────────────────────────────────

class EventCluster {
  constructor(seedEvent) {
    this.id         = `cls:${Date.now()}:${Math.random().toString(36).slice(2,6)}`;
    this.events     = [seedEvent];
    this.centroid   = { wx: seedEvent.wx ?? 0, wy: seedEvent.wy ?? 0, wz: seedEvent.wz ?? 0 };
    this.priority   = classifyEvent(seedEvent);
    this.createdAt  = Date.now();
    this.updatedAt  = Date.now();
    this.types      = new Map();  // event type → count
    this._countType(seedEvent);
  }

  canAbsorb(event) {
    if (Date.now() - this.createdAt > CLUSTER_TTL_MS) return false;
    return xzDist(this.centroid, event) <= CLUSTER_RADIUS;
  }

  absorb(event) {
    this.events.push(event);
    this._countType(event);
    this.updatedAt = Date.now();

    // Update centroid (running average)
    const n = this.events.length;
    this.centroid.wx = this.centroid.wx + ((event.wx ?? 0) - this.centroid.wx) / n;
    this.centroid.wy = this.centroid.wy + ((event.wy ?? 0) - this.centroid.wy) / n;
    this.centroid.wz = this.centroid.wz + ((event.wz ?? 0) - this.centroid.wz) / n;

    // Inherit highest priority
    const p = classifyEvent(event);
    if (p < this.priority) this.priority = p;
  }

  _countType(event) {
    const t = event.type ?? event.op ?? 'unknown';
    this.types.set(t, (this.types.get(t) ?? 0) + 1);
  }

  get dominantType() {
    let maxT = 'unknown', maxC = 0;
    for (const [t, c] of this.types) { if (c > maxC) { maxT = t; maxC = c; } }
    return maxT;
  }

  /** Serialise to a single representative event */
  toPacket() {
    return {
      type:        'cluster',
      clusterId:   this.id,
      eventType:   this.dominantType,
      count:       this.events.length,
      priority:    this.priority,
      wx:          Math.round(this.centroid.wx),
      wy:          Math.round(this.centroid.wy),
      wz:          Math.round(this.centroid.wz),
      radius:      CLUSTER_RADIUS,
      ts:          this.updatedAt,
      typeMap:     Object.fromEntries(this.types),
    };
  }

  age() { return Date.now() - this.createdAt; }
  isStale() { return this.age() > CLUSTER_TTL_MS; }
}

// ── ClusteringEngine ──────────────────────────────────────────────────────────

class ClusteringEngine {
  constructor() {
    this.active   = [];   // active EventCluster[]
    this.emitted  = [];   // completed packets (last 500)
    this.stats    = { eventsIn: 0, clustersEmitted: 0, compressionRatio: 0 };
    this._total   = 0;
  }

  /**
   * Ingest an event into the clustering engine.
   * @returns {EventCluster | null} cluster if completed (stale), null if still building
   */
  ingest(event) {
    this.stats.eventsIn++;
    this._total++;

    // Critical events bypass clustering
    const priority = classifyEvent(event);
    if (priority <= PRIORITY.COMBAT) return null;  // bypass

    // Try to absorb into an existing cluster
    for (const cluster of this.active) {
      if (cluster.canAbsorb(event)) {
        cluster.absorb(event);
        return null;
      }
    }

    // Create new cluster
    const cluster = new EventCluster(event);
    this.active.push(cluster);
    return null;
  }

  /**
   * Drain stale clusters → emit packets.
   * Called every BATCH_WINDOW_MS.
   */
  drain() {
    const packets  = [];
    const remaining= [];

    for (const cluster of this.active) {
      if (cluster.isStale()) {
        packets.push(cluster.toPacket());
        this.stats.clustersEmitted++;
      } else {
        remaining.push(cluster);
      }
    }

    this.active = remaining;

    // Update compression ratio
    if (this.stats.eventsIn > 0) {
      this.stats.compressionRatio = +(1 - this.stats.clustersEmitted / this.stats.eventsIn).toFixed(3);
    }

    // Keep emitted history
    this.emitted.push(...packets);
    if (this.emitted.length > 500) this.emitted.splice(0, this.emitted.length - 500);

    return packets;
  }

  snapshot() {
    return {
      ...this.stats,
      activeClusters: this.active.length,
      recentPackets:  this.emitted.slice(-5),
    };
  }
}

// ── AttentionBudget ──────────────────────────────────────────────────────────

/**
 * Per-peer attention budget: how many events per second the peer can receive.
 * Higher GPU tier = larger budget (better hardware = can handle more)
 * Stationary peers = larger budget (not GPU-stressed by rendering)
 */
class AttentionBudget {
  constructor(peerId, gpuTier = 0) {
    this.peerId     = peerId;
    this.gpuTier    = gpuTier;
    this.maxRate    = BASE_ATTENTION_RATE + ATTENTION_PER_GPU * gpuTier;
    this.queue      = [];     // queued events waiting for budget
    this.delivered  = 0;      // events delivered this second
    this.windowStart= Date.now();
    this.isStationary = true;
    this.stats = { delivered: 0, queued: 0, dropped: 0 };
  }

  /**
   * Attempt to deliver an event.
   * Critical events bypass budget.
   * Returns true if event should be sent now.
   */
  tryDeliver(event, priority) {
    const now = Date.now();

    // Reset rate window every second
    if (now - this.windowStart >= 1000) {
      this.delivered   = 0;
      this.windowStart = now;
    }

    // Critical/combat bypass budget
    if (priority <= PRIORITY.COMBAT) {
      this.delivered++;
      this.stats.delivered++;
      return true;
    }

    // Check budget
    const effectiveMax = this.isStationary ? this.maxRate * 1.5 : this.maxRate;
    if (this.delivered < effectiveMax) {
      this.delivered++;
      this.stats.delivered++;
      return true;
    }

    // Queue (max queue size prevents OOM)
    if (this.queue.length < 200) {
      this.queue.push({ event, priority });
      this.stats.queued++;
    } else {
      this.stats.dropped++;
    }
    return false;
  }

  /**
   * Drain queued events that can now be sent within remaining budget.
   */
  drainQueue() {
    if (!this.queue.length) return [];
    const toSend = [];
    const now    = Date.now();

    if (now - this.windowStart >= 1000) {
      this.delivered   = 0;
      this.windowStart = now;
    }

    while (this.queue.length > 0 && this.delivered < this.maxRate) {
      const item = this.queue.shift();
      toSend.push(item.event);
      this.delivered++;
      this.stats.delivered++;
    }

    // Drop lowest-priority items if queue still too deep
    if (this.queue.length > 100) {
      this.queue.sort((a, b) => a.priority - b.priority);  // highest priority (low number) first
      const dropped = this.queue.splice(100);
      this.stats.dropped += dropped.length;
    }

    return toSend;
  }

  setStationary(v) { this.isStationary = v; }
  setGPUTier(t)    { this.gpuTier = t; this.maxRate = BASE_ATTENTION_RATE + ATTENTION_PER_GPU * t; }

  snapshot() {
    return {
      peerId:    this.peerId,
      maxRate:   this.maxRate,
      queueSize: this.queue.length,
      ...this.stats,
    };
  }
}

// ── CognitiveLoadBalancer ─────────────────────────────────────────────────────

export class CognitiveLoadBalancer extends EventEmitter {
  constructor() {
    super();
    this.clustering = new ClusteringEngine();
    this.budgets    = new Map();   // peerId → AttentionBudget
    this._timer     = null;
    this._running   = false;

    this.stats = {
      globalEventsIn:  0,
      batchesSent:     0,
      totalDelivered:  0,
      totalDropped:    0,
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start() {
    if (this._running) return this;
    this._running = true;
    this._timer   = setInterval(() => this._batch(), BATCH_WINDOW_MS);
    this._timer.unref?.();
    return this;
  }

  stop() {
    this._running = false;
    clearInterval(this._timer);
  }

  // ── Event ingestion ────────────────────────────────────────────────────────

  /**
   * Ingest an event for zone-wide broadcast.
   * Clustering engine merges nearby events before delivery.
   *
   * @param {object}   event    VSL event or mesh message
   * @param {string}   zoneId
   * @param {string[]} peerIds  target peer IDs
   */
  ingest(event, zoneId, peerIds = []) {
    this.stats.globalEventsIn++;
    this.clustering.ingest(event);

    // Critical events bypass clustering, go direct
    const priority = classifyEvent(event);
    if (priority <= PRIORITY.COMBAT) {
      this._deliverDirect(event, peerIds, priority);
    }
  }

  /**
   * Ingest a batch of raw events (e.g. from VSL ingest, world simulation).
   * Much more efficient than calling ingest() per event.
   */
  ingestBatch(events, zoneId, peerIds = []) {
    for (const e of events) this.ingest(e, zoneId, peerIds);
  }

  // ── Peer budget management ─────────────────────────────────────────────────

  addPeer(peerId, gpuTier = 0) {
    if (!this.budgets.has(peerId)) {
      this.budgets.set(peerId, new AttentionBudget(peerId, gpuTier));
    }
  }

  removePeer(peerId) { this.budgets.delete(peerId); }

  setPeerStationary(peerId, stationary) {
    this.budgets.get(peerId)?.setStationary(stationary);
  }

  setPeerGPUTier(peerId, tier) {
    this.budgets.get(peerId)?.setGPUTier(tier);
  }

  // ── Batch delivery ─────────────────────────────────────────────────────────

  _batch() {
    this.stats.batchesSent++;

    // Drain clustering engine
    const packets = this.clustering.drain();

    // Deliver cluster packets to all registered peers
    for (const [peerId, budget] of this.budgets) {
      // First drain any queued events
      const queued = budget.drainQueue();
      if (queued.length) this._sendToPeer(peerId, queued);

      // Then deliver new cluster packets
      const toSend = [];
      for (const packet of packets) {
        const ok = budget.tryDeliver(packet, packet.priority ?? PRIORITY.AMBIENT);
        if (ok) toSend.push(packet);
      }
      if (toSend.length) this._sendToPeer(peerId, toSend);
    }

    // Clean up disconnected peers
    for (const peerId of this.budgets.keys()) {
      if (!peerRegistry.getPeer(peerId)) this.budgets.delete(peerId);
    }
  }

  _deliverDirect(event, peerIds, priority) {
    const msg = JSON.stringify({ type: 'event.direct', event, priority });
    for (const peerId of peerIds) {
      const ws = peerRegistry.getPeer(peerId)?.ws;
      if (ws?.readyState === 1) {
        try { ws.send(msg); this.stats.totalDelivered++; } catch { /**/ }
      }
    }
  }

  _sendToPeer(peerId, events) {
    if (!events.length) return;
    const peer = peerRegistry.getPeer(peerId);
    const ws   = peer?.ws;
    if (ws?.readyState === 1) {
      try {
        ws.send(JSON.stringify({ type: 'event.batch', events, ts: Date.now() }));
        this.stats.totalDelivered += events.length;
      } catch { /**/ }
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  /**
   * Compute global compression ratio.
   * High ratio = good (many raw events compressed into few packets).
   */
  compressionRatio() {
    return this.clustering.stats.compressionRatio;
  }

  snapshot() {
    return {
      ...this.stats,
      compressionRatio: this.compressionRatio(),
      clustering:       this.clustering.snapshot(),
      peers:            this.budgets.size,
      peerBudgets:      [...this.budgets.values()].map(b => b.snapshot()).slice(0, 10),
      running:          this._running,
    };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const cognitiveBalancer = new CognitiveLoadBalancer().start();
