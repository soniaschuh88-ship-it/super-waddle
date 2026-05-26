/**
 * src/engine/p2p-mesh.ts
 *
 * bKG P2P Mesh — WebRTC + WebSocket relay client
 *
 * Architecture:
 *   ┌──────────────────────────────────────────────────────┐
 *   │  P2PMesh                                             │
 *   │  ├── SignalingClient  (WebSocket → /mmo/ws)          │
 *   │  ├── RTCPeerMap       peerId → RTCPeerConnection     │
 *   │  ├── DataChannelMap   peerId → RTCDataChannel        │
 *   │  └── RelayFallback    WS relay when WebRTC fails     │
 *   └──────────────────────────────────────────────────────┘
 *
 * Message protocol (over data channel or WS relay):
 *   { type: 'vsl.event',    event: VoxelEvent }
 *   { type: 'vsl.batch',    events: VoxelEvent[], fromTick, toTick }
 *   { type: 'vsl.sync_req', sinceTickk, zoneId }
 *   { type: 'vsl.sync_res', events: VoxelEvent[] }
 *   { type: 'zone.npcs',    npcs: NPC[], zoneId, tick }
 *   { type: 'zone.state',   stateHash, tick, zoneId }
 *   { type: 'authority',    peerId, tick, zoneId }
 *
 * Fast path:  WebRTC data channel (RTCDataChannel, SCTP)
 * Slow path:  WebSocket relay via server at /mmo/ws
 * Cold sync:  HTTP GET /mmo/bootstrap/:worldId
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PeerInfo {
  peerId:   string;
  role:     string;
  gpuTier:  number;
  zoneId:   string;
  latency:  number;  // measured RTT ms
}

export interface VoxelEvent {
  tick:    number;
  chunkId: string;
  op:      'set' | 'fill' | 'clear';
  lx:      number;
  ly:      number;
  lz:      number;
  value:   number;
  actor:   string;
  sig:     string;
}

export interface MeshMessage {
  type:    string;
  from?:   string;
  [key: string]: unknown;
}

export type MessageHandler = (msg: MeshMessage, from: string, via: 'rtc' | 'relay') => void;

// ── ICE server config ─────────────────────────────────────────────────────────

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// ── SignalingClient ────────────────────────────────────────────────────────────

class SignalingClient extends EventTarget {
  private ws:       WebSocket | null = null;
  private url:      string;
  private _reconnTimer: ReturnType<typeof setTimeout> | null = null;
  private _open     = false;
  public  peerId    = '';
  public  zoneId    = '';
  public  role      = '';

  constructor(url: string) {
    super();
    this.url = url;
  }

  connect(joinParams: {
    gpuTier?: number; lat?: number; bw?: number;
    cx?: number; cy?: number; cz?: number;
  }) {
    return new Promise<void>((resolve, reject) => {
      const ws  = new WebSocket(this.url);
      this.ws   = ws;

      ws.onopen = () => {
        this._open = true;
        ws.send(JSON.stringify({ type: 'join', ...joinParams }));
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as MeshMessage;
          if (msg.type === 'joined') {
            this.peerId = msg.peerId as string;
            this.zoneId = msg.zoneId as string;
            this.role   = msg.role   as string;
            resolve();
          }
          this.dispatchEvent(new CustomEvent('message', { detail: msg }));
        } catch { /**/ }
      };

      ws.onclose = () => {
        this._open = false;
        this.dispatchEvent(new CustomEvent('disconnected', {}));
        // Exponential back-off reconnect
        this._reconnTimer = setTimeout(() => this.connect(joinParams), 3000);
      };

      ws.onerror = () => { ws.close(); reject(new Error('WS error')); };
    });
  }

  send(msg: MeshMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...msg, from: this.peerId }));
    }
  }

  disconnect() {
    if (this._reconnTimer) clearTimeout(this._reconnTimer);
    this.ws?.close();
    this._open = false;
  }

  get isOpen() { return this._open; }

  ping() {
    this.send({ type: 'ping' });
  }
}

// ── RTCPeerChannel — one peer connection ─────────────────────────────────────

interface RTCPeerChannel {
  conn:    RTCPeerConnection;
  channel: RTCDataChannel | null;
  peerId:  string;
  latency: number;
  state:   'connecting' | 'connected' | 'failed' | 'closed';
  _pingTs: number;
}

// ── P2PMesh ────────────────────────────────────────────────────────────────────

export class P2PMesh {
  readonly localPeerId: string;
  private signaling:    SignalingClient;
  private peers:        Map<string, RTCPeerChannel> = new Map();
  private handlers:     Set<MessageHandler> = new Set();
  private _zoneId       = '';
  private _role         = '';

  // Metrics
  private metrics = {
    msgSentRTC: 0, msgSentRelay: 0,
    msgRecvRTC: 0, msgRecvRelay: 0,
    bytesSent: 0,  bytesRecv: 0,
  };

  constructor(signalingUrl?: string) {
    this.localPeerId = crypto.randomUUID();
    const wsUrl = signalingUrl
      ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/mmo/ws`;
    this.signaling = new SignalingClient(wsUrl);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async join(opts: {
    cx?: number; cy?: number; cz?: number;
    gpuTier?: number; lat?: number; bw?: number;
  } = {}) {
    await this.signaling.connect(opts);
    this._zoneId = this.signaling.zoneId;
    this._role   = this.signaling.role;

    // Handle signaling messages
    this.signaling.addEventListener('message', (e) => {
      this._onSignalingMessage((e as CustomEvent<MeshMessage>).detail);
    });

    // Heartbeat every 5s
    setInterval(() => this.signaling.ping(), 5000);

    return {
      peerId: this.signaling.peerId,
      zoneId: this._zoneId,
      role:   this._role,
    };
  }

  updatePosition(cx: number, cy: number, cz: number) {
    this.signaling.send({ type: 'move', cx, cy, cz });
  }

  disconnect() {
    for (const p of this.peers.values()) {
      p.conn.close();
    }
    this.peers.clear();
    this.signaling.disconnect();
  }

  // ── Messaging ───────────────────────────────────────────────────────────────

  /**
   * Broadcast a message to all connected peers.
   * Tries WebRTC data channel first; falls back to WS relay.
   */
  broadcast(msg: MeshMessage) {
    const json = JSON.stringify({ ...msg, from: this.signaling.peerId });
    const bytes = json.length;

    for (const peer of this.peers.values()) {
      if (peer.state === 'connected' && peer.channel?.readyState === 'open') {
        try {
          peer.channel.send(json);
          this.metrics.msgSentRTC++;
          this.metrics.bytesSent += bytes;
          continue;
        } catch { /**/ }
      }
      // Relay fallback
      this.signaling.send({ type: 'relay', to: peer.peerId, msg });
      this.metrics.msgSentRelay++;
    }
  }

  /**
   * Send a message to a specific peer.
   */
  sendToPeer(peerId: string, msg: MeshMessage) {
    const peer = this.peers.get(peerId);
    const json = JSON.stringify({ ...msg, from: this.signaling.peerId });

    if (peer?.state === 'connected' && peer.channel?.readyState === 'open') {
      try {
        peer.channel.send(json);
        this.metrics.msgSentRTC++;
        this.metrics.bytesSent += json.length;
        return;
      } catch { /**/ }
    }
    // Relay
    this.signaling.send({ type: 'relay', to: peerId, payload: msg });
    this.metrics.msgSentRelay++;
  }

  /** Register a message handler */
  onMessage(fn: MessageHandler) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  private _dispatch(msg: MeshMessage, from: string, via: 'rtc' | 'relay') {
    for (const fn of this.handlers) { try { fn(msg, from, via); } catch { /**/ } }
  }

  // ── WebRTC negotiation ──────────────────────────────────────────────────────

  private async _initiateConnection(targetPeerId: string) {
    if (this.peers.has(targetPeerId)) return;

    const conn    = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = conn.createDataChannel('vsl', { ordered: false, maxRetransmits: 0 });

    const peerCh: RTCPeerChannel = {
      conn, channel, peerId: targetPeerId, latency: 0, state: 'connecting', _pingTs: 0,
    };
    this.peers.set(targetPeerId, peerCh);

    this._bindChannel(peerCh, channel);
    this._bindICE(conn, targetPeerId);

    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    this.signaling.send({ type: 'offer', to: targetPeerId, sdp: offer });
  }

  private async _handleOffer(fromPeerId: string, sdp: RTCSessionDescriptionInit) {
    if (this.peers.has(fromPeerId)) return;

    const conn     = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peerCh: RTCPeerChannel = {
      conn, channel: null, peerId: fromPeerId, latency: 0, state: 'connecting', _pingTs: 0,
    };
    this.peers.set(fromPeerId, peerCh);

    conn.ondatachannel = (e) => {
      peerCh.channel = e.channel;
      this._bindChannel(peerCh, e.channel);
    };

    this._bindICE(conn, fromPeerId);

    await conn.setRemoteDescription(sdp);
    const answer = await conn.createAnswer();
    await conn.setLocalDescription(answer);
    this.signaling.send({ type: 'answer', to: fromPeerId, sdp: answer });
  }

  private async _handleAnswer(fromPeerId: string, sdp: RTCSessionDescriptionInit) {
    const peer = this.peers.get(fromPeerId);
    if (!peer) return;
    await peer.conn.setRemoteDescription(sdp);
  }

  private async _handleICE(fromPeerId: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(fromPeerId);
    if (!peer) return;
    try { await peer.conn.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /**/ }
  }

  private _bindICE(conn: RTCPeerConnection, targetPeerId: string) {
    conn.onicecandidate = (e) => {
      if (e.candidate) {
        this.signaling.send({ type: 'ice', to: targetPeerId, candidate: e.candidate.toJSON() });
      }
    };
    conn.onconnectionstatechange = () => {
      const peer = this.peers.get(targetPeerId);
      if (!peer) return;
      const state = conn.connectionState;
      if (state === 'connected')    peer.state = 'connected';
      if (state === 'failed')       { peer.state = 'failed'; this._onPeerFailed(targetPeerId); }
      if (state === 'disconnected') peer.state = 'connecting';
    };
  }

  private _bindChannel(peerCh: RTCPeerChannel, ch: RTCDataChannel) {
    ch.onopen = () => {
      peerCh.state = 'connected';
      // Measure latency
      peerCh._pingTs = performance.now();
      ch.send(JSON.stringify({ type: 'ping', ts: peerCh._pingTs, from: this.signaling.peerId }));
    };

    ch.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as MeshMessage;
        this.metrics.msgRecvRTC++;
        this.metrics.bytesRecv += (e.data as string).length;

        // Handle latency ping/pong
        if (msg.type === 'ping') {
          ch.send(JSON.stringify({ type: 'pong', ts: msg.ts, from: this.signaling.peerId }));
          return;
        }
        if (msg.type === 'pong') {
          peerCh.latency = Math.round((performance.now() - (msg.ts as number)) / 2);
          return;
        }

        this._dispatch(msg, peerCh.peerId, 'rtc');
      } catch { /**/ }
    };

    ch.onerror  = () => this._onPeerFailed(peerCh.peerId);
    ch.onclose  = () => { peerCh.state = 'connecting'; peerCh.channel = null; };
  }

  private _onPeerFailed(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) { peer.state = 'failed'; peer.conn.close(); }
    // Will re-establish on next activity
  }

  // ── Signaling handler ───────────────────────────────────────────────────────

  private _onSignalingMessage(msg: MeshMessage) {
    switch (msg.type) {
      case 'zone.peers': {
        // New peer list in zone — initiate WebRTC with unknown peers
        const peerList = (msg.peers as Array<{ peerId: string }>) ?? [];
        for (const { peerId } of peerList) {
          if (peerId !== this.signaling.peerId && !this.peers.has(peerId)) {
            void this._initiateConnection(peerId);
          }
        }
        break;
      }
      case 'peer.joined': {
        const pid = msg.peerId as string;
        if (pid !== this.signaling.peerId) void this._initiateConnection(pid);
        break;
      }
      case 'peer.left': {
        const pid = msg.peerId as string;
        const peer = this.peers.get(pid);
        if (peer) { peer.conn.close(); this.peers.delete(pid); }
        break;
      }
      case 'offer':
        void this._handleOffer(msg.from!, msg.sdp as RTCSessionDescriptionInit);
        break;
      case 'answer':
        void this._handleAnswer(msg.from!, msg.sdp as RTCSessionDescriptionInit);
        break;
      case 'ice':
        void this._handleICE(msg.from!, msg.candidate as RTCIceCandidateInit);
        break;
      case 'relay': {
        // Server-relayed message
        const relayed = msg.msg as MeshMessage ?? msg.payload as MeshMessage;
        if (relayed) {
          this.metrics.msgRecvRelay++;
          this._dispatch(relayed, msg.from ?? 'relay', 'relay');
        }
        break;
      }
      default:
        // Forward unhandled messages (authority, proof, etc.)
        this._dispatch(msg, msg.from ?? 'server', 'relay');
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  get peerId()  { return this.signaling.peerId; }
  get zoneId()  { return this._zoneId; }
  get role()    { return this._role; }

  getPeerList(): PeerInfo[] {
    return [...this.peers.values()].map(p => ({
      peerId:  p.peerId,
      role:    'unknown',
      gpuTier: 0,
      zoneId:  this._zoneId,
      latency: p.latency,
    }));
  }

  getMetrics() {
    return {
      ...this.metrics,
      connectedPeers: [...this.peers.values()].filter(p => p.state === 'connected').length,
      totalPeers:     this.peers.size,
      wsOpen:         this.signaling.isOpen,
    };
  }
}
