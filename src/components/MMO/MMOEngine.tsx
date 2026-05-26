/**
 * src/components/MMO/MMOEngine.tsx
 *
 * bKG Distributed Voxel Consensus Engine — MMO Control Panel
 *
 * Panels:
 *   World     — Live 2D zone map (canvas), zone stats, world state
 *   Peers     — Connected peers, roles, latency, GPU tier
 *   Authority — VSL authority rotation schedule per zone
 *   NPCs      — Emergent NPC spawn status (deterministic)
 *   Proof     — State proof chain inspector
 *   Farm      — Compute farm toggle + task queue
 *
 * Architecture note:
 *   This UI connects to the server REST/SSE endpoints directly.
 *   Full P2P mesh (P2PMesh + VSLSync) is available but requires
 *   a real HTTPS/WSS deployment for WebRTC. In dev mode the
 *   WS relay path is used automatically.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Globe, Users, Shield, Bot,
  Link2, FlaskConical, RefreshCw,
  Wifi, WifiOff, Zap, Activity,
  Play, Pause,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ZoneInfo {
  zoneId:    string;
  peerCount: number;
  authority: string | null;
  stateHash: string;
  npcs:      number;
  active:    boolean;
  metrics?:  { ticksTotal: number; eventsIngested: number };
}

interface PeerInfo {
  id:          string;
  role:        string;
  gpuTier:     number;
  zoneId:      string;
  latency?:    number;
  computeFarm: boolean;
  joinedAt:    number;
}

interface ProofBlock {
  index:     number;
  tick:      number;
  zoneId:    string;
  hash:      string;
  prevHash:  string;
  stateHash: string;
  peerIds:   string[];
  ts:        number;
}

interface ClusterStats {
  worldId:    string;
  globalTick: number;
  running:    boolean;
  clusters:   { total: number; active: number };
  peers:      { peers: number; simNodes: number; idlePeers: number };
  proof:      { tick: number; zones: number; blocks: number };
  totalNPCs:  number;
}

interface NPC {
  seed:   number;
  zoneId: string;
  wx:     number;
  wy:     number;
  wz:     number;
  state:  string;
  tick:   number;
}

interface FarmTask {
  type:        string;
  zoneId?:     string;
  assignedTo?: string;
  ts:          number;
  completedBy?: string;
}

interface DeltaEvent {
  type:    string;
  zoneId?: string;
  wx?: number; wy?: number; wz?: number;
  mat?: number; src?: string; ts: number;
}

type Panel = 'world' | 'peers' | 'authority' | 'npcs' | 'proof' | 'farm';

const ROLE_COLOR: Record<string, string> = {
  sim:    '#00e5ff',
  render: '#a855f7',
  relay:  '#ffb300',
  backup: '#00e5a0',
  idle:   '#4a6880',
};

const ROLE_LABEL: Record<string, string> = {
  sim:    'SIM NODE',
  render: 'RENDER',
  relay:  'RELAY',
  backup: 'BACKUP',
  idle:   'IDLE',
};

// ── API ───────────────────────────────────────────────────────────────────────

const api = {
  async get<T>(path: string): Promise<T> {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json() as Promise<T>;
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json() as Promise<T>;
  },
};

// ── Zone Map Canvas ───────────────────────────────────────────────────────────

function ZoneMapCanvas({ zones }: { zones: ZoneInfo[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx    = canvas.getContext('2d');
    if (!ctx)    return;

    const W = canvas.width  = canvas.clientWidth;
    const H = canvas.height = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#030810';
    ctx.fillRect(0, 0, W, H);

    if (!zones.length) {
      ctx.fillStyle = 'rgba(74,104,128,0.3)';
      ctx.font      = '11px monospace';
      ctx.fillText('No active zones', W/2 - 50, H/2);
      return;
    }

    // Find bounds
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const z of zones) {
      const [zxStr,,zzStr] = z.zoneId.split(':');
      const zx = parseInt(zxStr, 10), zz = parseInt(zzStr, 10);
      minX = Math.min(minX, zx); maxX = Math.max(maxX, zx);
      minZ = Math.min(minZ, zz); maxZ = Math.max(maxZ, zz);
    }

    const rangeX = Math.max(1, maxX - minX + 1);
    const rangeZ = Math.max(1, maxZ - minZ + 1);
    const cellW  = Math.min(48, Math.floor((W - 20) / rangeX));
    const cellH  = Math.min(48, Math.floor((H - 20) / rangeZ));
    const offX   = (W - cellW * rangeX) / 2;
    const offZ   = (H - cellH * rangeZ) / 2;

    for (const z of zones) {
      const [zxStr,,zzStr] = z.zoneId.split(':');
      const zx  = parseInt(zxStr, 10), zz = parseInt(zzStr, 10);
      const px  = offX + (zx - minX) * cellW;
      const pz  = offZ + (zz - minZ) * cellH;

      // Cell background: color by peer density
      const heat  = Math.min(1, z.peerCount / 10);
      const r     = Math.round(3  + heat * 0);
      const g     = Math.round(8  + heat * 100);
      const b     = Math.round(16 + heat * 50);
      ctx.fillStyle = z.active ? `rgba(${r},${g+20},${b+60},${0.5 + heat * 0.5})` : 'rgba(13,30,50,0.4)';
      ctx.fillRect(px + 1, pz + 1, cellW - 2, cellH - 2);

      // Border
      ctx.strokeStyle = z.authority ? 'rgba(0,229,255,0.6)' : 'rgba(13,42,64,0.8)';
      ctx.lineWidth   = z.authority ? 1.5 : 0.5;
      ctx.strokeRect(px + 1, pz + 1, cellW - 2, cellH - 2);

      // Zone ID label
      ctx.fillStyle = 'rgba(74,104,128,0.8)';
      ctx.font      = `${Math.max(7, cellW / 5)}px monospace`;
      ctx.fillText(z.zoneId, px + 3, pz + 11);

      // Peer count
      if (z.peerCount > 0) {
        ctx.fillStyle = '#00e5ff';
        ctx.font      = `bold ${Math.max(9, cellW / 4)}px monospace`;
        ctx.fillText(String(z.peerCount), px + cellW/2 - 5, pz + cellH/2 + 5);
      }

      // NPC dots
      if (z.npcs > 0) {
        ctx.fillStyle = '#ffb300';
        for (let i = 0; i < Math.min(z.npcs, 6); i++) {
          const dx = 3 + i * 6;
          ctx.beginPath();
          ctx.arc(px + dx, pz + cellH - 6, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Legend
    ctx.fillStyle = 'rgba(74,104,128,0.6)';
    ctx.font      = '9px monospace';
    ctx.fillText('■ peer count  ● NPC  ─ authority', 8, H - 6);
  }, [zones]);

  return (
    <canvas ref={canvasRef} className="w-full h-full" style={{ cursor: 'crosshair' }}/>
  );
}

// ── Stat item ─────────────────────────────────────────────────────────────────

function StatItem({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-2.5 py-2 rounded-lg border border-border/30 bg-panel/40">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted/50">{label}</p>
      <p className="text-sm font-bold tabular-nums font-mono" style={{ color: color ?? '#e8f4f8' }}>{value}</p>
    </div>
  );
}

// ── Main MMOEngine ────────────────────────────────────────────────────────────

export function MMOEngine() {
  const [panel,      setPanel]      = useState<Panel>('world');
  const [stats,      setStats]      = useState<ClusterStats | null>(null);
  const [zones,      setZones]      = useState<ZoneInfo[]>([]);
  const [peers,      setPeers]      = useState<PeerInfo[]>([]);
  const [proofBlocks,setProofBlocks]= useState<ProofBlock[]>([]);
  const [farmTasks,  setFarmTasks]  = useState<FarmTask[]>([]);
  const [npcs,       setNPCs]       = useState<NPC[]>([]);
  const [deltaLog,   setDeltaLog]   = useState<DeltaEvent[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [connected,  setConnected]  = useState(false);
  const [worldId]    = useState('default');
  const [tickTimer,  setTickTimer]  = useState<ReturnType<typeof setInterval>|null>(null);
  const [localTick,  setLocalTick]  = useState(0);

  const esRef  = useRef<EventSource | null>(null);
  const deltaRef = useRef<HTMLDivElement>(null);

  // ── Load data ─────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      const [s, z, p] = await Promise.all([
        api.get<ClusterStats>(`/mmo/stats`).catch(() => null),
        api.get<ZoneInfo[]>(`/mmo/zones`).catch(() => []),
        api.get<PeerInfo[]>(`/mmo/peers`).catch(() => []),
      ]);
      if (s) setStats(s);
      setZones(z as ZoneInfo[]);
      setPeers(p as PeerInfo[]);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  const loadProof = async () => {
    try {
      const data = await api.get<{ chains: Record<string, ProofBlock[]> }>('/mmo/proof');
      const blocks: ProofBlock[] = [];
      for (const chain of Object.values(data.chains ?? {})) {
        blocks.push(...chain.slice(-5));
      }
      setProofBlocks(blocks.sort((a, b) => b.ts - a.ts).slice(0, 30));
    } catch { /**/ }
  };

  const loadFarm = async () => {
    try {
      const data = await api.get<{ tasks: FarmTask[] }>('/mmo/farm');
      setFarmTasks(data.tasks ?? []);
    } catch { /**/ }
  };

  const loadNPCs = async () => {
    try {
      const data = await api.get<{ npcs: NPC[] }>(`/mmo/npcs?worldId=${worldId}`);
      setNPCs(data.npcs ?? []);
    } catch { /**/ }
  };

  useEffect(() => {
    void refresh();
    const iv = setInterval(refresh, 3000);
    return () => clearInterval(iv);
  }, [refresh]);

  useEffect(() => {
    if (panel === 'proof') void loadProof();
    if (panel === 'farm')  void loadFarm();
    if (panel === 'npcs')  void loadNPCs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  // ── VSL SSE delta stream ──────────────────────────────────────────────────

  useEffect(() => {
    esRef.current?.close();
    const es = new EventSource(`/vldb/events?worldId=${worldId}`);
    esRef.current = es;

    const add = (evt: DeltaEvent) => {
      setDeltaLog(prev => [evt, ...prev.slice(0, 99)]);
    };

    es.addEventListener('voxel.set',     e => add(JSON.parse(e.data)));
    es.addEventListener('batch.applied', e => add(JSON.parse(e.data)));

    return () => es.close();
  }, [worldId]);

  // ── Local tick simulation ─────────────────────────────────────────────────

  const startTick = () => {
    if (tickTimer) return;
    const t = setInterval(() => setLocalTick(n => n + 1), 50);  // 20 Hz
    setTickTimer(t);
  };

  const stopTick = () => {
    if (tickTimer) { clearInterval(tickTimer); setTickTimer(null); }
  };

  // ── Actions ────────────────────────────────────────────────────────────────

  const joinAsFarmer = async () => {
    setLoading(true);
    try { await api.post('/mmo/join', { farm: true }); await refresh(); }
    catch { /**/ }
    setLoading(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const PANELS: { id: Panel; label: string; Icon: typeof Globe }[] = [
    { id: 'world',     label: 'World',    Icon: Globe      },
    { id: 'peers',     label: 'Peers',    Icon: Users      },
    { id: 'authority', label: 'Auth',     Icon: Shield     },
    { id: 'npcs',      label: 'NPCs',     Icon: Bot        },
    { id: 'proof',     label: 'Proof',    Icon: Link2      },
    { id: 'farm',      label: 'Farm',     Icon: FlaskConical},
  ];

  const ACCENT = '#00e5ff';

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#030810' }}>

      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 border-b"
        style={{ background: 'rgba(6,15,30,0.95)', borderColor: 'rgba(0,229,255,0.08)', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center border relative"
            style={{ background: 'rgba(0,229,255,0.06)', borderColor: 'rgba(0,229,255,0.2)' }}>
            <Globe size={14} className="text-accent"/>
            {connected && (
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-success animate-pulse"/>
            )}
          </div>
          <div>
            <p className="text-[12px] font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif", letterSpacing:'0.04em' }}>
              VSL MMO
            </p>
            <p className="text-[9px] font-mono text-muted/40 tracking-wider uppercase">
              {connected ? `t=${localTick} · ${stats?.clusters.active ?? 0} zones` : 'disconnected'}
            </p>
          </div>
        </div>

        {/* Stats strip */}
        {stats && (
          <div className="hidden sm:flex items-center gap-3 text-[11px] font-mono text-muted/50">
            <span className="text-accent font-bold">{stats.peers.peers} peers</span>
            <span>·</span>
            <span>{stats.peers.simNodes} sim</span>
            <span>·</span>
            <span className="text-mystic">{stats.totalNPCs} NPC</span>
            <span>·</span>
            <span>{stats.proof.blocks} proofs</span>
          </div>
        )}

        {/* Panel tabs */}
        <div className="flex items-center gap-0.5 bg-base/80 rounded-lg p-0.5 border border-border/30 ml-auto">
          {PANELS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setPanel(id)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-all"
              style={{ background: panel === id ? 'rgba(0,229,255,0.1)' : 'transparent', color: panel === id ? ACCENT : '#4a6880' }}>
              <Icon size={11}/><span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Tick controls */}
        <div className="flex items-center gap-1.5">
          <button onClick={tickTimer ? stopTick : startTick}
            className="text-muted/50 hover:text-accent flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border/40 hover:border-accent/30 text-xs transition-all">
            {tickTimer ? <Pause size={10}/> : <Play size={10}/>}
          </button>
          <button onClick={refresh} disabled={loading}
            className="text-muted/40 hover:text-accent transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''}/>
          </button>
          {connected
            ? <Wifi size={12} className="text-success/60 flex-shrink-0"/>
            : <WifiOff size={12} className="text-error/60 flex-shrink-0"/>}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">

        {/* ── World panel ── */}
        {panel === 'world' && (
          <div className="flex-1 flex flex-col gap-0 overflow-hidden">
            {/* Stats row */}
            <div className="flex-shrink-0 grid grid-cols-4 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-border/20">
              <StatItem label="Global tick"  value={stats?.globalTick ?? localTick} color={ACCENT}/>
              <StatItem label="Active zones" value={stats?.clusters.active ?? 0}/>
              <StatItem label="Total peers"  value={stats?.peers.peers ?? 0} color="#00e5ff"/>
              <StatItem label="Sim nodes"    value={stats?.peers.simNodes ?? 0} color="#00e5ff"/>
              <StatItem label="NPCs"         value={stats?.totalNPCs ?? 0} color="#ffb300"/>
              <StatItem label="Proof blocks" value={stats?.proof.blocks ?? 0} color="#a855f7"/>
            </div>
            {/* Zone map + delta log side by side */}
            <div className="flex-1 min-h-0 flex gap-0">
              <div className="flex-1 min-w-0 p-3">
                {zones.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center gap-4">
                    <Globe size={48} strokeWidth={1} className="text-muted/15"/>
                    <div className="text-center">
                      <p className="text-sm text-text-primary/50 font-semibold">No peers in world</p>
                      <p className="text-xs text-muted/40 mt-1">Zones appear as players join</p>
                    </div>
                  </div>
                ) : (
                  <ZoneMapCanvas zones={zones}/>
                )}
              </div>
              {/* Delta log sidebar */}
              <div className="w-64 flex-shrink-0 border-l border-border/20 flex flex-col">
                <div className="flex-shrink-0 px-3 py-2 border-b border-border/20">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted/50 flex items-center gap-1.5">
                    <Activity size={9}/>Live Delta Stream
                  </p>
                </div>
                <div ref={deltaRef} className="flex-1 overflow-y-auto px-2 py-2 text-[10px] font-mono flex flex-col gap-0.5">
                  {deltaLog.length === 0 && (
                    <p className="text-muted/25 italic py-4 text-center">No events yet</p>
                  )}
                  {deltaLog.map((d, i) => (
                    <div key={i} className="flex items-center gap-1.5 border-b border-border/10 pb-0.5">
                      <span className="text-[9px] text-muted/30 flex-shrink-0">
                        {new Date(d.ts).toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                      </span>
                      <span className="text-accent/70 flex-shrink-0">{d.type.split('.').pop()}</span>
                      {d.wx !== undefined && (
                        <span className="text-muted/50 truncate">{d.wx},{d.wy},{d.wz}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Peers panel ── */}
        {panel === 'peers' && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-3 max-w-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif" }}>
                  Connected Peers
                </h2>
                <span className="text-xs text-muted/50 font-mono">{peers.length} total</span>
              </div>

              {peers.length === 0 && (
                <p className="text-sm text-muted/40 italic text-center py-8">No peers yet. Start a world to see connections.</p>
              )}

              <div className="flex flex-col gap-2">
                {peers.map(p => {
                  const rc = ROLE_COLOR[p.role] ?? '#4a6880';
                  const rl = ROLE_LABEL[p.role] ?? p.role.toUpperCase();
                  return (
                    <div key={p.id}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border/40 bg-panel/40">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: rc }}/>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-mono font-bold text-text-primary">{p.id.slice(0,12)}</p>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: rc + '20', color: rc }}>{rl}</span>
                          {p.computeFarm && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-mystic/20 text-mystic">FARM</span>
                          )}
                        </div>
                        <p className="text-[10px] font-mono text-muted/40 mt-0.5">
                          zone:{p.zoneId} · GPU:{p.gpuTier} · {p.latency ?? '?'}ms
                        </p>
                      </div>
                      <div className="text-[10px] font-mono text-muted/30 text-right">
                        <p>{new Date(p.joinedAt).toLocaleTimeString('en',{hour12:false})}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Role legend */}
              <div className="rounded-xl border border-border/30 bg-panel/30 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted/50 mb-2">Cluster Roles</p>
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  {Object.entries(ROLE_LABEL).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ROLE_COLOR[k] }}/>
                      <span className="font-mono font-bold" style={{ color: ROLE_COLOR[k] }}>{v}</span>
                      <span className="text-muted/40">—</span>
                      <span className="text-muted/50 text-[10px]">
                        {k === 'sim'    && 'runs physics+NPC'}
                        {k === 'render' && 'generates mesh tiles'}
                        {k === 'relay'  && 'forwards state diffs'}
                        {k === 'backup' && 'hot standby'}
                        {k === 'idle'   && 'available for farm'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Authority panel ── */}
        {panel === 'authority' && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-4 max-w-2xl">
              <div>
                <h2 className="text-sm font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif" }}>
                  Authority Rotation
                </h2>
                <p className="text-xs text-muted/50 mt-1">
                  VSL authority rotates every 100 ticks (~5s). Deterministic — all peers compute identically.
                </p>
              </div>

              {/* Authority schedule per zone */}
              {zones.length === 0 && <p className="text-sm text-muted/40 italic py-6 text-center">No active zones.</p>}

              <div className="flex flex-col gap-2">
                {zones.map(z => {
                  const epoch  = 100;
                  const slot   = Math.floor((stats?.globalTick ?? 0) / epoch);
                  const remaining = epoch - ((stats?.globalTick ?? 0) % epoch);

                  return (
                    <div key={z.zoneId}
                      className="px-4 py-3 rounded-xl border border-border/40 bg-panel/40">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"/>
                        <p className="text-xs font-mono font-bold text-text-primary">{z.zoneId}</p>
                        <span className="text-[10px] text-muted/40">{z.peerCount} peers</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Shield size={11} className="text-accent flex-shrink-0"/>
                        <p className="text-xs font-mono text-accent">
                          {z.authority ? z.authority.slice(0,12) + '…' : 'no authority'}
                        </p>
                        <span className="text-[10px] text-muted/40 ml-auto">
                          slot {slot} · {remaining} ticks left
                        </span>
                      </div>
                      {/* Rotation timeline bar */}
                      <div className="mt-2 h-1 rounded-full bg-border/40 overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{
                            width:      `${((epoch - remaining) / epoch) * 100}%`,
                            background: `linear-gradient(90deg, #00e5ff40, #00e5ff)`,
                          }}/>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Protocol explanation */}
              <div className="rounded-xl border border-border/30 bg-panel/30 p-4 font-mono text-[10px] text-muted/50 leading-relaxed">
                <p className="text-accent/70 font-bold mb-2">VSL Merge Protocol</p>
                <pre>{`sort events: tick ASC → authority_weight DESC → sig ASC
apply in order: last-write-wins per (chunkId, lx, ly, lz)
authority_weight: 2 if actor==authorityPeer else 1
result: identical canonical state on all peers`}</pre>
              </div>
            </div>
          </div>
        )}

        {/* ── NPCs panel ── */}
        {panel === 'npcs' && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-4 max-w-2xl">
              <div>
                <h2 className="text-sm font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif" }}>
                  Emergent NPCs
                </h2>
                <p className="text-xs text-muted/50 mt-1">
                  NPCs are not stored. They exist only when <code className="text-accent/80">sha256(worldState + tick + seed) % 1000 &lt; threshold</code>
                </p>
              </div>

              <div className="rounded-xl border border-border/30 bg-panel/30 p-3 font-mono text-[10px]">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-muted/40">Total NPCs</p>
                    <p className="text-xl font-bold text-mystic">{stats?.totalNPCs ?? npcs.length}</p>
                  </div>
                  <div>
                    <p className="text-muted/40">Zones w/ NPCs</p>
                    <p className="text-xl font-bold text-amber/80">{zones.filter(z => z.npcs > 0).length}</p>
                  </div>
                  <div>
                    <p className="text-muted/40">Spawn threshold</p>
                    <p className="text-xl font-bold text-accent">3 / 1000</p>
                  </div>
                </div>
              </div>

              {/* Per-zone NPC list */}
              {zones.filter(z => z.npcs > 0).map(z => (
                <div key={z.zoneId} className="rounded-xl border border-border/40 bg-panel/40 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Bot size={11} className="text-mystic/70"/>
                    <p className="text-xs font-mono text-text-primary">Zone {z.zoneId}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-mystic/15 text-mystic font-bold ml-auto">
                      {z.npcs} NPC{z.npcs !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted/40 font-mono">
                    Deterministic · seed-based · no server entity storage
                  </p>
                </div>
              ))}

              {npcs.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {npcs.slice(0, 20).map(npc => (
                    <div key={npc.seed} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/30 bg-panel/30">
                      <Bot size={10} className="text-mystic/60 flex-shrink-0"/>
                      <p className="text-[10px] font-mono text-text-primary/70">
                        seed:{npc.seed.toString(16).padStart(8,'0')}
                      </p>
                      <p className="text-[10px] text-muted/40">{npc.wx},{npc.wy},{npc.wz}</p>
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full border"
                        style={{ borderColor: 'rgba(168,85,247,0.3)', color: '#a855f7', background: 'rgba(168,85,247,0.1)' }}>
                        {npc.state}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Proof chain panel ── */}
        {panel === 'proof' && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-4 max-w-2xl">
              <div>
                <h2 className="text-sm font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif" }}>
                  State Proof Chain
                </h2>
                <p className="text-xs text-muted/50 mt-1">
                  Tamper-evident hash chain. sha256(prevHash + tick + zoneId + stateHash + peers).
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <StatItem label="Total blocks"  value={stats?.proof.blocks ?? 0} color="#a855f7"/>
                <StatItem label="Zones tracked" value={stats?.proof.zones ?? 0}/>
                <StatItem label="Tick"          value={stats?.proof.tick ?? 0} color={ACCENT}/>
              </div>

              <div className="flex flex-col gap-2">
                {proofBlocks.length === 0 && (
                  <p className="text-sm text-muted/40 italic text-center py-6">No proof blocks yet. Simulation must be active.</p>
                )}
                {proofBlocks.map(b => (
                  <div key={b.hash} className="px-3 py-3 rounded-xl border border-border/30 bg-panel/30 font-mono text-[10px]">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Link2 size={10} className="text-mystic/60"/>
                      <span className="text-mystic font-bold">#{b.index}</span>
                      <span className="text-muted/40">tick {b.tick}</span>
                      <span className="text-muted/40">zone {b.zoneId}</span>
                    </div>
                    <div className="space-y-0.5 text-[9px]">
                      <div className="flex gap-2">
                        <span className="text-muted/40 w-16">hash</span>
                        <span className="text-accent/70 truncate">{b.hash.slice(0,32)}…</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-muted/40 w-16">prev</span>
                        <span className="text-muted/50 truncate">{b.prevHash.slice(0,32)}…</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-muted/40 w-16">state</span>
                        <span className="text-success/60 truncate">{b.stateHash.slice(0,32)}…</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-muted/40 w-16">peers</span>
                        <span className="text-text-primary/50">{b.peerIds.slice(0,3).join(', ')}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Compute farm panel ── */}
        {panel === 'farm' && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-4 max-w-2xl">
              <div>
                <h2 className="text-sm font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif" }}>
                  Compute Farm
                </h2>
                <p className="text-xs text-muted/50 mt-1">
                  Idle peers contribute compute to orphaned zones, mesh generation, and state compression.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <StatItem label="Farm peers" value={stats?.peers.idlePeers ?? 0} color="#00e5a0"/>
                <StatItem label="Queued tasks" value={farmTasks.length}/>
                <StatItem label="Idle peers"   value={stats?.peers.idlePeers ?? 0}/>
              </div>

              {/* Join farm button */}
              <button onClick={joinAsFarmer} disabled={loading}
                className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold cursor-pointer transition-all"
                style={{ background: 'rgba(0,229,160,0.1)', border: '1px solid rgba(0,229,160,0.3)', color: '#00e5a0' }}>
                {loading ? <RefreshCw size={14} className="animate-spin"/> : <FlaskConical size={14}/>}
                Join Compute Farm (donate idle GPU)
              </button>

              {/* Task queue */}
              <div className="flex flex-col gap-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted/50">Task Queue</p>
                {farmTasks.length === 0 ? (
                  <p className="text-xs text-muted/40 italic py-4 text-center">No pending tasks</p>
                ) : (
                  farmTasks.map((task, i) => (
                    <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/30 bg-panel/30 text-[11px]">
                      <Zap size={10} className="text-accent/60 flex-shrink-0"/>
                      <span className="font-mono text-text-primary/70 font-semibold">{task.type}</span>
                      {task.zoneId && <span className="text-muted/40">zone:{task.zoneId}</span>}
                      <span className="ml-auto text-[10px]">
                        {task.completedBy
                          ? <span className="text-success/60">✓ done</span>
                          : task.assignedTo
                          ? <span className="text-amber/60">→ {task.assignedTo.slice(0,8)}</span>
                          : <span className="text-muted/30">queued</span>}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Architecture diagram */}
              <div className="rounded-xl border border-border/30 bg-panel/30 p-4 font-mono text-[10px] text-muted/50 leading-relaxed">
                <p className="text-success/70 font-bold mb-2">Compute Farm Model</p>
                <pre>{`Player idle  →  donate 10-20% GPU
                →  simulate orphaned zones
                →  generate mesh tiles for others
                →  compress state diffs
                →  LOD baking for far chunks
Result: real "shared MMO brain"
        world simulates itself via peer grid`}</pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
