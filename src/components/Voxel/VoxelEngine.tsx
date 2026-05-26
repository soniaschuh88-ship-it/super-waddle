/**
 * src/components/Voxel/VoxelEngine.tsx
 *
 * bKG VLDB — Full Voxel Engine UI
 *
 * Panels:
 *   Viewport   — WebGL canvas, greedy-mesh render, free-fly camera
 *   Inspector  — real-time stats (FPS, draw calls, tris, chunks in RAM)
 *   World      — create/load/delete worlds, flush dirty chunks
 *   Editor     — paint voxel by material, fill region, clear selection
 *   bKG        — link Flow tasks → voxel regions, agent mutation feed
 *   Delta Log  — live SSE event stream from L3 event log
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Globe, Layers, RefreshCw, Plus,
  Activity, Zap, Box, Database,
  FlaskConical, Save, X, Wifi, WifiOff,
} from 'lucide-react';
import { VoxelRenderer, type RenderInfo } from './VoxelRenderer';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VLDBWorld {
  id:       string;
  name:     string;
  seed:     number;
  bpp:      number;
  tick?:    number;
  createdAt?: number;
  inMemory?: boolean;
}

interface VLDBStats {
  worlds:    number;
  cache:     { size: number; hits: number; misses: number; hitRate: string };
  disk:      { chunks: number; eventLogBytes: number; deltaCount: number };
  kernel:    string;
  bpp:       number;
  chunkBytes: number;
  compression: string;
}

interface DeltaEvent {
  type:    string;
  worldId?: string;
  wx?: number; wy?: number; wz?: number;
  mat?: number;
  ts:      number;
  src?:    string;
}

const MAT_NAMES = [
  'AIR','SOLID','GLASS','EMISSIVE','FLUID','TERRAIN',
  'CRYSTAL','METAL','WOOD','ORGANIC','DATA_CORE','LOGIC',
  'MEMORY','TASK_VOXEL','AGENT_MARK','BEDROCK',
];

const MAT_COLORS = [
  'transparent','#888','#9cf','#f60','#39c','#4a4',
  '#0ef','#aab','#963','#583','#a5f','#2fa',
  '#88f','#0bd','#fa0','#222',
];

type Panel = 'viewport' | 'inspector' | 'world' | 'editor' | 'bkg' | 'delta';

// ── API helpers ───────────────────────────────────────────────────────────────

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
  async put<T>(path: string, body?: unknown): Promise<T> {
    const r = await fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json() as Promise<T>;
  },
};

// ── Chunk loader (fetch + upload to renderer) ─────────────────────────────────

async function loadChunkToRenderer(
  renderer: VoxelRenderer,
  worldId: string,
  cx: number, cy: number, cz: number,
) {
  const data = await api.get<{
    voxels: Array<{ lx: number; ly: number; lz: number; mat: number }>;
  }>(`/vldb/chunk/${worldId}?cx=${cx}&cy=${cy}&cz=${cz}`);

  renderer.uploadChunk(cx, cy, cz, data.voxels ?? []);
}

// ── Material swatch ───────────────────────────────────────────────────────────

function MatSwatch({ mat, selected, onClick }: { mat: number; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={MAT_NAMES[mat] ?? `MAT_${mat}`}
      className="w-7 h-7 rounded-lg border-2 transition-all flex-shrink-0 hover:scale-110"
      style={{
        background:  MAT_COLORS[mat] ?? '#666',
        borderColor: selected ? '#00e5ff' : 'rgba(13,42,64,0.8)',
        boxShadow:   selected ? '0 0 8px rgba(0,229,255,0.5)' : undefined,
        opacity:     mat === 0 ? 0.3 : 1,
      }}
    />
  );
}

// ── Stat bar ──────────────────────────────────────────────────────────────────

function StatBar({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 rounded-xl border border-border/40 bg-panel/50">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted/50">{label}</p>
      <p className="text-sm font-bold text-text-primary font-mono tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-muted/40 font-mono">{sub}</p>}
    </div>
  );
}

// ── Main VoxelEngine ──────────────────────────────────────────────────────────

export function VoxelEngine() {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<VoxelRenderer | null>(null);
  const esRef      = useRef<EventSource | null>(null);

  const [panel,       setPanel]       = useState<Panel>('viewport');
  const [renderInfo,  setRenderInfo]  = useState<RenderInfo | null>(null);
  const [vldbStats,   setVLDBStats]   = useState<VLDBStats | null>(null);
  const [worlds,      setWorlds]      = useState<VLDBWorld[]>([]);
  const [activeWorld, setActiveWorld] = useState<string>('');
  const [loading,     setLoading]     = useState(false);
  const [err,         setErr]         = useState('');
  const [rendererOn,  setRendererOn]  = useState(false);

  // Editor state
  const [paintMat,   setPaintMat]   = useState(1);
  const [editX,      setEditX]      = useState(16);
  const [editY,      setEditY]      = useState(12);
  const [editZ,      setEditZ]      = useState(16);
  const [regX1,      setRegX1]      = useState(0);
  const [regY1,      setRegY1]      = useState(0);
  const [regZ1,      setRegZ1]      = useState(0);
  const [regX2,      setRegX2]      = useState(7);
  const [regY2,      setRegY2]      = useState(7);
  const [regZ2,      setRegZ2]      = useState(7);

  // Delta log
  const [deltaLog,   setDeltaLog]   = useState<DeltaEvent[]>([]);
  const deltaRef     = useRef<HTMLDivElement>(null);

  // bKG Flow tasks
  const [flowTasks,  setFlowTasks]  = useState<Array<{ id: string; title: string; status: string }>>([]);

  // Chunks loaded in renderer
  const [loadedChunks, setLoadedChunks] = useState<string[]>([]);
  const [newWorldName, setNewWorldName] = useState('');

  // ── Load data ─────────────────────────────────────────────────────────────

  const loadWorlds = useCallback(async () => {
    try {
      const ws = await api.get<VLDBWorld[]>('/vldb/worlds');
      setWorlds(ws);
    } catch { /**/ }
  }, []);

  const loadStats = useCallback(async () => {
    try { setVLDBStats(await api.get<VLDBStats>('/vldb/stats')); }
    catch { /**/ }
  }, []);

  const loadFlowTasks = useCallback(async () => {
    try {
      const tasks = await api.get<Array<{ id: string; title: string; status: string }>>('/flow/tasks?projectId=default');
      setFlowTasks(tasks.slice(0, 20));
    } catch { /**/ }
  }, []);

  useEffect(() => {
    void loadWorlds();
    void loadStats();
    void loadFlowTasks();
    const iv = setInterval(() => { void loadStats(); }, 5000);
    return () => clearInterval(iv);
  }, [loadWorlds, loadStats, loadFlowTasks]);

  // ── Init WebGL renderer ───────────────────────────────────────────────────

  useEffect(() => {
    if (!canvasRef.current || rendererRef.current) return;
    try {
      const r = new VoxelRenderer();
      r.init(canvasRef.current, info => setRenderInfo(info));
      r.start();
      rendererRef.current = r;
      setRendererOn(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'WebGL init failed');
    }
    return () => { rendererRef.current?.dispose(); rendererRef.current = null; };
  }, []);

  // ── SSE delta stream ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeWorld) return;
    esRef.current?.close();
    const es = new EventSource(`/vldb/events?worldId=${activeWorld}`);
    es.addEventListener('voxel.set',     e => addDelta(JSON.parse(e.data)));
    es.addEventListener('batch.applied', e => addDelta(JSON.parse(e.data)));
    esRef.current = es;
    return () => es.close();
  }, [activeWorld]);

  const addDelta = (evt: DeltaEvent) => {
    setDeltaLog(prev => [evt, ...prev.slice(0, 199)]);
    // Auto-scroll
    setTimeout(() => deltaRef.current?.scrollTo(0, 0), 50);
  };

  // ── World operations ───────────────────────────────────────────────────────

  const createWorld = async () => {
    if (!newWorldName.trim()) return;
    setLoading(true);
    try {
      const w = await api.post<VLDBWorld>('/vldb/worlds', {
        name: newWorldName.trim(),
        seed: Math.floor(Math.random() * 99999),
        bpp:  4,
      });
      setWorlds(ws => [w, ...ws]);
      setNewWorldName('');
      await activateWorld(w.id);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Create failed'); }
    setLoading(false);
  };

  const activateWorld = async (id: string) => {
    setActiveWorld(id);
    setLoading(true);
    const renderer = rendererRef.current;
    if (!renderer) { setLoading(false); return; }

    renderer.clearChunks();
    setLoadedChunks([]);

    // Load a 3×3×2 area around spawn
    const toLoad: [number, number, number][] = [];
    for (let cy = 0; cy <= 1; cy++)
      for (let cz = -1; cz <= 1; cz++)
        for (let cx = -1; cx <= 1; cx++)
          toLoad.push([cx, cy, cz]);

    const loaded: string[] = [];
    await Promise.all(toLoad.map(async ([cx, cy, cz]) => {
      try {
        await loadChunkToRenderer(renderer, id, cx, cy, cz);
        loaded.push(`${cx}|${cy}|${cz}`);
      } catch { /**/ }
    }));

    setLoadedChunks(loaded);
    setLoading(false);
  };

  const loadMoreChunks = async (radius: number) => {
    if (!activeWorld || !rendererRef.current) return;
    setLoading(true);
    const toLoad: [number,number,number][] = [];
    for (let cy = -1; cy <= 2; cy++)
      for (let cz = -radius; cz <= radius; cz++)
        for (let cx = -radius; cx <= radius; cx++)
          toLoad.push([cx,cy,cz]);

    const newKeys: string[] = [...loadedChunks];
    await Promise.all(toLoad.map(async ([cx,cy,cz]) => {
      const k = `${cx}|${cy}|${cz}`;
      if (newKeys.includes(k)) return;
      try {
        await loadChunkToRenderer(rendererRef.current!, activeWorld, cx, cy, cz);
        newKeys.push(k);
      } catch { /**/ }
    }));
    setLoadedChunks(newKeys);
    setLoading(false);
  };

  const flushChunks = async () => {
    if (!activeWorld) return;
    try { await api.post(`/vldb/world/${activeWorld}/flush`); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Flush failed'); }
  };

  // ── Editor operations ─────────────────────────────────────────────────────

  const paintVoxel = async () => {
    if (!activeWorld) return;
    try {
      await api.post(`/vldb/voxel/${activeWorld}`, { wx: editX, wy: editY, wz: editZ, mat: paintMat });
      // Reload affected chunk
      const cx = editX >> 5, cy = editY >> 5, cz = editZ >> 5;
      if (rendererRef.current) await loadChunkToRenderer(rendererRef.current, activeWorld, cx, cy, cz);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Paint failed'); }
  };

  const fillRegion = async () => {
    if (!activeWorld) return;
    setLoading(true);
    try {
      await api.put(`/vldb/region/${activeWorld}`, {
        x1: regX1, y1: regY1, z1: regZ1, x2: regX2, y2: regY2, z2: regZ2,
        mat: paintMat,
      });
      // Reload all affected chunks
      const cx1 = regX1 >> 5, cy1 = regY1 >> 5, cz1 = regZ1 >> 5;
      const cx2 = regX2 >> 5, cy2 = regY2 >> 5, cz2 = regZ2 >> 5;
      const reloads: Promise<void>[] = [];
      for (let cy = cy1; cy <= cy2; cy++)
        for (let cz = cz1; cz <= cz2; cz++)
          for (let cx = cx1; cx <= cx2; cx++)
            if (rendererRef.current)
              reloads.push(loadChunkToRenderer(rendererRef.current, activeWorld, cx, cy, cz));
      await Promise.all(reloads);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Fill failed'); }
    setLoading(false);
  };

  const clearChunkInView = async (cx: number, cy: number, cz: number) => {
    if (!activeWorld) return;
    // Fill with air
    await api.put(`/vldb/region/${activeWorld}`, {
      x1: cx*32, y1: cy*32, z1: cz*32,
      x2: cx*32+31, y2: cy*32+31, z2: cz*32+31,
      mat: 0,
    });
    rendererRef.current?.removeChunk(cx, cy, cz);
    setLoadedChunks(prev => prev.filter(k => k !== `${cx}|${cy}|${cz}`));
  };

  // ── bKG: map task to voxel region ─────────────────────────────────────────

  const mapTaskToRegion = async (taskId: string, idx: number) => {
    if (!activeWorld) return;
    const cx = (idx % 5) * 2;
    const cz = Math.floor(idx / 5) * 2;
    try {
      await api.post(`/voxel/worlds/${activeWorld}/task-region`, { taskId, cx, cy: 0, cz, radius: 1 });
      if (rendererRef.current) {
        for (let dc = -1; dc <= 1; dc++)
          for (let dz = -1; dz <= 1; dz++)
            await loadChunkToRenderer(rendererRef.current, activeWorld, cx+dc, 0, cz+dz).catch(() => {});
      }
    } catch { /**/ }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const curWorld = worlds.find(w => w.id === activeWorld);

  const PANELS: { id: Panel; label: string; Icon: typeof Globe }[] = [
    { id:'viewport',  label:'View',      Icon: Layers    },
    { id:'inspector', label:'Stats',     Icon: Activity  },
    { id:'world',     label:'Worlds',    Icon: Globe     },
    { id:'editor',    label:'Edit',      Icon: Box       },
    { id:'bkg',       label:'bKG',       Icon: Zap       },
    { id:'delta',     label:'Deltas',    Icon: Database  },
  ];

  const ACCENT = '#00e5ff';

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#030810' }}>

      {/* ── Header ── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 border-b"
        style={{ background: 'rgba(6,15,30,0.95)', borderColor: 'rgba(0,229,255,0.08)', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center border"
            style={{ background: 'rgba(0,229,255,0.08)', borderColor: 'rgba(0,229,255,0.2)' }}>
            <Layers size={15} className="text-accent"/>
          </div>
          <div>
            <p className="text-[13px] font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif", letterSpacing:'0.05em' }}>VLDB</p>
            <p className="text-[9px] font-mono text-muted/50 tracking-widest uppercase">
              {rendererOn ? 'WebGL2 ●' : 'No WebGL ○'} · {loadedChunks.length} chunks · {vldbStats?.cache.hitRate ?? '–'} hit
            </p>
          </div>
        </div>

        {/* World selector */}
        {activeWorld && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-semibold"
            style={{ background: 'rgba(0,229,255,0.06)', borderColor: 'rgba(0,229,255,0.2)', color: ACCENT }}>
            <Globe size={10}/>{curWorld?.name ?? activeWorld.slice(0,8)}
          </div>
        )}

        {/* Panel tabs */}
        <div className="flex items-center gap-0.5 bg-base/80 rounded-lg p-0.5 border border-border/30 ml-auto">
          {PANELS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setPanel(id)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all"
              style={{
                background: panel === id ? 'rgba(0,229,255,0.1)' : 'transparent',
                color:      panel === id ? ACCENT : '#4a6880',
              }}>
              <Icon size={11}/><span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-1.5">
          {activeWorld && (
            <>
              <button onClick={() => void loadMoreChunks(2)} disabled={loading}
                className="text-muted/50 hover:text-accent text-xs flex items-center gap-1 px-2 py-1 rounded-lg border border-border/40 hover:border-accent/30 transition-all">
                <Plus size={11}/><span className="hidden sm:inline">+chunks</span>
              </button>
              <button onClick={flushChunks}
                className="text-muted/50 hover:text-success text-xs flex items-center gap-1 px-2 py-1 rounded-lg border border-border/40 hover:border-success/30 transition-all">
                <Save size={11}/><span className="hidden sm:inline">flush</span>
              </button>
            </>
          )}
          {loading && <RefreshCw size={14} className="text-accent animate-spin flex-shrink-0 mt-1"/>}
        </div>
      </div>

      {/* Error bar */}
      {err && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 text-xs text-red-400 bg-error/10 border-b border-error/20">
          {err}
          <button onClick={() => setErr('')} className="ml-auto text-muted/50 hover:text-muted"><X size={12}/></button>
        </div>
      )}

      {/* ── Body: canvas always present, panels overlay ── */}
      <div className="flex-1 min-h-0 relative">

        {/* WebGL canvas — always rendered */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{
            display:  panel === 'viewport' ? 'block' : 'none',
            outline:  'none',
          }}
          tabIndex={0}
        />

        {/* No world selected overlay on viewport */}
        {panel === 'viewport' && !activeWorld && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center"
            style={{ background: 'rgba(3,8,16,0.85)' }}>
            <Layers size={48} strokeWidth={1} className="text-muted/20"/>
            <div>
              <p className="text-sm font-bold text-text-primary/60">No world loaded</p>
              <p className="text-xs text-muted/40 mt-1">Create or select a world in the <strong className="text-text-primary/50">Worlds</strong> tab</p>
            </div>
            <button onClick={() => setPanel('world')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-base bg-accent btn-glow cursor-pointer hover:brightness-110 transition-all">
              <Globe size={14}/>Open Worlds
            </button>
          </div>
        )}

        {/* Camera hint on viewport */}
        {panel === 'viewport' && activeWorld && !loading && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none"
            style={{ background: 'rgba(6,15,30,0.7)', backdropFilter: 'blur(8px)', borderRadius: '12px', padding: '6px 14px' }}>
            <p className="text-[10px] text-muted/50 font-mono text-center">
              WASD · Space/C · Shift=fast · Drag=look
            </p>
          </div>
        )}

        {/* Viewport stats overlay */}
        {panel === 'viewport' && renderInfo && (
          <div className="absolute top-3 right-3 pointer-events-none rounded-xl border px-3 py-2"
            style={{ background: 'rgba(6,15,30,0.8)', borderColor: 'rgba(0,229,255,0.1)', backdropFilter: 'blur(4px)' }}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] font-mono text-muted/70">
              <span>FPS</span>     <span className="text-accent font-bold">{renderInfo.fps}</span>
              <span>Tris</span>    <span className="text-text-primary/80">{renderInfo.triangles.toLocaleString()}</span>
              <span>Chunks</span>  <span className="text-text-primary/80">{renderInfo.chunks}</span>
              <span>Calls</span>   <span className="text-text-primary/80">{renderInfo.drawCalls}</span>
            </div>
          </div>
        )}

        {/* ── Inspector panel ── */}
        {panel === 'inspector' && (
          <div className="absolute inset-0 overflow-y-auto p-4">
            <div className="max-w-xl flex flex-col gap-4">
              <h2 className="text-sm font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif" }}>Engine Stats</h2>

              {renderInfo && (
                <div>
                  <p className="text-[10px] font-bold text-muted/50 uppercase tracking-wider mb-2">Renderer</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <StatBar label="FPS"       value={renderInfo.fps}/>
                    <StatBar label="Triangles" value={renderInfo.triangles.toLocaleString()}/>
                    <StatBar label="Draw calls" value={renderInfo.drawCalls}/>
                    <StatBar label="Chunks"    value={renderInfo.chunks}/>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-mono text-muted/50">
                    <span>Cam X: {renderInfo.camPos[0].toFixed(1)}</span>
                    <span>Cam Y: {renderInfo.camPos[1].toFixed(1)}</span>
                    <span>Cam Z: {renderInfo.camPos[2].toFixed(1)}</span>
                  </div>
                </div>
              )}

              {vldbStats && (
                <>
                  <div>
                    <p className="text-[10px] font-bold text-muted/50 uppercase tracking-wider mb-2">LRU Cache (L1)</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <StatBar label="Cached" value={vldbStats.cache.size} sub="chunks"/>
                      <StatBar label="Hit rate" value={`${(parseFloat(vldbStats.cache.hitRate)*100).toFixed(0)}%`}/>
                      <StatBar label="Hits" value={vldbStats.cache.hits}/>
                      <StatBar label="Misses" value={vldbStats.cache.misses}/>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted/50 uppercase tracking-wider mb-2">Disk (L2 + L3)</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <StatBar label="Chunk files" value={vldbStats.disk.chunks} sub=".bin"/>
                      <StatBar label="Event log" value={`${(vldbStats.disk.eventLogBytes/1024).toFixed(1)} KB`} sub="L3 JSONL"/>
                      <StatBar label="Deltas" value={vldbStats.disk.deltaCount}/>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted/50 uppercase tracking-wider mb-2">Configuration</p>
                    <div className="grid grid-cols-3 gap-2">
                      <StatBar label="Kernel"   value={vldbStats.kernel}/>
                      <StatBar label="BPP"      value={vldbStats.bpp} sub="bits/voxel"/>
                      <StatBar label="Chunk"    value={`${(vldbStats.chunkBytes/1024).toFixed(0)} KB`} sub={vldbStats.compression}/>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── World panel ── */}
        {panel === 'world' && (
          <div className="absolute inset-0 overflow-y-auto p-4">
            <div className="max-w-xl flex flex-col gap-4">
              <h2 className="text-sm font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif" }}>Worlds</h2>

              {/* Create */}
              <div className="flex gap-2">
                <input value={newWorldName} onChange={e => setNewWorldName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && void createWorld()}
                  placeholder="New world name…"
                  className="flex-1 bg-base/80 border border-border text-text-primary text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-accent/40"
                />
                <button onClick={() => void createWorld()} disabled={!newWorldName.trim() || loading}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-base bg-accent btn-glow cursor-pointer disabled:opacity-50">
                  <Plus size={12}/>Create
                </button>
              </div>

              {/* World list */}
              {worlds.length === 0 ? (
                <p className="text-sm text-muted/40 italic text-center py-8">No worlds yet. Create one above.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {worlds.map(w => {
                    const isActive = w.id === activeWorld;
                    return (
                      <div key={w.id}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer"
                        style={{
                          background:  isActive ? 'rgba(0,229,255,0.06)' : 'rgba(9,22,40,0.6)',
                          borderColor: isActive ? 'rgba(0,229,255,0.3)' : 'rgba(13,42,64,0.8)',
                        }}
                        onClick={() => void activateWorld(w.id)}
                      >
                        <Globe size={14} style={{ color: isActive ? ACCENT : '#4a6880' }}/>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-text-primary truncate">{w.name}</p>
                          <p className="text-[10px] font-mono text-muted/40">
                            seed:{w.seed} · {w.bpp}bpp · {w.inMemory ? 'RAM' : 'disk'}
                          </p>
                        </div>
                        {isActive && (
                          <div className="flex items-center gap-1 text-[10px] text-accent">
                            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"/>
                            active
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Editor panel ── */}
        {panel === 'editor' && (
          <div className="absolute inset-0 overflow-y-auto p-4">
            <div className="max-w-xl flex flex-col gap-5">
              <h2 className="text-sm font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif" }}>Voxel Editor</h2>

              {!activeWorld && (
                <p className="text-xs text-muted/50 italic">Select a world in the Worlds tab first.</p>
              )}

              {/* Material palette */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted/50">Material ({MAT_NAMES[paintMat]})</label>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: 16 }, (_, i) => (
                    <MatSwatch key={i} mat={i} selected={paintMat === i} onClick={() => setPaintMat(i)}/>
                  ))}
                </div>
              </div>

              {/* Single voxel paint */}
              <div className="flex flex-col gap-2 p-3 rounded-xl border border-border/40 bg-panel/40">
                <p className="text-[11px] font-bold text-text-primary">Paint Voxel</p>
                <div className="grid grid-cols-3 gap-2">
                  {[['X', editX, setEditX], ['Y', editY, setEditY], ['Z', editZ, setEditZ]].map(([axis, val, setter]) => (
                    <div key={axis as string} className="flex flex-col gap-1">
                      <label className="text-[10px] text-muted/50">{axis as string}</label>
                      <input type="number" value={val as number}
                        onChange={e => (setter as (v: number) => void)(+e.target.value)}
                        className="bg-base/80 border border-border text-text-primary text-xs font-mono rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent/40"/>
                    </div>
                  ))}
                </div>
                <button onClick={paintVoxel} disabled={!activeWorld}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold text-base bg-accent btn-glow cursor-pointer disabled:opacity-40">
                  <Box size={12}/>Paint ({MAT_NAMES[paintMat]})
                </button>
              </div>

              {/* Region fill */}
              <div className="flex flex-col gap-2 p-3 rounded-xl border border-border/40 bg-panel/40">
                <p className="text-[11px] font-bold text-text-primary">Fill Region</p>
                <div className="grid grid-cols-3 gap-2">
                  {[['X1',regX1,setRegX1],['Y1',regY1,setRegY1],['Z1',regZ1,setRegZ1],
                    ['X2',regX2,setRegX2],['Y2',regY2,setRegY2],['Z2',regZ2,setRegZ2]].map(([l,v,s]) => (
                    <div key={l as string} className="flex flex-col gap-1">
                      <label className="text-[10px] text-muted/50">{l as string}</label>
                      <input type="number" value={v as number}
                        onChange={e => (s as (n:number)=>void)(+e.target.value)}
                        className="bg-base/80 border border-border text-text-primary text-xs font-mono rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent/40"/>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted/40">
                  Volume: {(Math.abs(regX2-regX1)+1) * (Math.abs(regY2-regY1)+1) * (Math.abs(regZ2-regZ1)+1)} voxels
                </p>
                <button onClick={fillRegion} disabled={!activeWorld || loading}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer disabled:opacity-40"
                  style={{ background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.3)', color: '#a855f7' }}>
                  {loading ? <RefreshCw size={12} className="animate-spin"/> : <FlaskConical size={12}/>}
                  Fill with {MAT_NAMES[paintMat]}
                </button>
              </div>

              {/* Loaded chunks */}
              {loadedChunks.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted/50">
                    Loaded chunks ({loadedChunks.length})
                  </p>
                  <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                    {loadedChunks.map(k => {
                      const [cx,cy,cz] = k.split('|').map(Number);
                      return (
                        <span key={k}
                          className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border"
                          style={{ borderColor: 'rgba(0,229,255,0.2)', color: '#4a6880', background: 'rgba(6,15,30,0.8)' }}>
                          {k}
                          <button onClick={() => void clearChunkInView(cx,cy,cz)}
                            className="text-muted/30 hover:text-error transition-colors">
                            <X size={8}/>
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── bKG Integration panel ── */}
        {panel === 'bkg' && (
          <div className="absolute inset-0 overflow-y-auto p-4">
            <div className="max-w-xl flex flex-col gap-5">
              <h2 className="text-sm font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif" }}>bKG Integration</h2>
              <p className="text-xs text-muted/50">Flow tasks → voxel regions · Agent mutations → deltas</p>

              {/* Task → region mapping */}
              <div className="flex flex-col gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted/50">
                  Flow Tasks → Voxel Regions
                </p>
                {!activeWorld && (
                  <p className="text-xs text-muted/40 italic">Select a world first.</p>
                )}
                {flowTasks.length === 0 && activeWorld && (
                  <p className="text-xs text-muted/40 italic">No tasks in default project.</p>
                )}
                <div className="flex flex-col gap-1.5">
                  {flowTasks.map((t, i) => {
                    const statusColors: Record<string, string> = {
                      planning: '#a855f7', todo: '#4a6880',
                      'in-progress': '#00e5ff', review: '#ffb300',
                      done: '#00e5a0', archived: '#222',
                    };
                    const col = statusColors[t.status] ?? '#4a6880';
                    return (
                      <div key={t.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/40 bg-panel/40">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: col }}/>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-text-primary truncate">{t.title}</p>
                          <p className="text-[10px] font-mono text-muted/40">Chunk ({(i%5)*2}, 0, {Math.floor(i/5)*2})</p>
                        </div>
                        <button
                          onClick={() => void mapTaskToRegion(t.id, i)}
                          disabled={!activeWorld}
                          className="text-[10px] text-accent/70 hover:text-accent border border-accent/20 hover:border-accent/40 px-2 py-1 rounded-lg transition-all disabled:opacity-30"
                        >
                          Map
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Material legend */}
              <div className="rounded-xl border border-border/40 bg-panel/40 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted/50 mb-2">Task Status → Voxel Type</p>
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  {[
                    ['planning', '#a855f7', 'CRYSTAL'],
                    ['todo', '#00b8d4', 'TASK_VOXEL'],
                    ['in-progress', '#a855f7', 'DATA_CORE'],
                    ['review', '#3b82f6', 'QUERY_FIELD'],
                    ['done', '#00e5a0', 'CRYSTAL (bright)'],
                    ['archived', '#888', 'STONE'],
                  ].map(([s, c, v]) => (
                    <div key={s} className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded flex-shrink-0" style={{ background: c }}/>
                      <span className="text-muted/60 capitalize">{s}</span>
                      <span className="text-muted/30">→</span>
                      <span className="font-mono text-[9px] text-text-primary/50">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Architecture diagram (text) */}
              <div className="rounded-xl border border-border/40 bg-panel/40 p-3 font-mono text-[10px] text-muted/50 leading-relaxed">
                <p className="text-accent/70 font-bold mb-1">Pipeline</p>
                <pre>{`Flow Task  →  Voxel Region (cx,cy,cz)
PROMPT.md  →  World Rules (compilePrompt)
Agent HUB  →  Delta Stream (agent-mutate)
Eval Score →  Spatial Coherence Metric
L3 Log     →  Deterministic Replay`}</pre>
              </div>
            </div>
          </div>
        )}

        {/* ── Delta log panel ── */}
        {panel === 'delta' && (
          <div className="absolute inset-0 flex flex-col">
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-border/30">
              <div className="flex items-center gap-2">
                <Database size={13} className="text-accent/60"/>
                <span className="text-xs font-bold text-text-primary">Delta Event Stream (L3)</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted/50">
                {activeWorld
                  ? <><Wifi size={10} className="text-success"/><span>Live {activeWorld.slice(0,8)}</span></>
                  : <><WifiOff size={10}/><span>No world selected</span></>}
                <button onClick={() => setDeltaLog([])} className="text-muted/30 hover:text-muted ml-2">Clear</button>
              </div>
            </div>
            <div ref={deltaRef} className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[11px] flex flex-col gap-0.5"
              style={{ background: '#020710' }}>
              {deltaLog.length === 0 && (
                <p className="text-muted/25 italic py-4 text-center">Waiting for deltas…</p>
              )}
              {deltaLog.map((evt, i) => {
                const col =
                  evt.type === 'voxel.set'     ? '#00e5ff' :
                  evt.type === 'batch.applied'  ? '#00e5a0' :
                  '#4a6880';
                return (
                  <div key={i} className="flex items-baseline gap-2 py-0.5 border-b border-border/10">
                    <span className="text-muted/30 flex-shrink-0 w-16 text-[9px]">
                      {new Date(evt.ts).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="font-bold text-[10px] flex-shrink-0" style={{ color: col }}>{evt.type}</span>
                    {evt.type === 'voxel.set' && (
                      <span className="text-muted/50">
                        ({evt.wx},{evt.wy},{evt.wz}) → {MAT_NAMES[evt.mat ?? 0]}
                        <span className="text-muted/30 ml-2">{evt.src}</span>
                      </span>
                    )}
                    {evt.type === 'batch.applied' && (
                      <span className="text-muted/50">
                        {(evt as { count?: number }).count ?? '?'} mutations
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
