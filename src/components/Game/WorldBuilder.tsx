/**
 * src/components/Game/WorldBuilder.tsx
 *
 * WorldBuilder — Create a voxel world from a game blueprint.
 * Links the game blueprint system to the VLDB engine:
 *   1. User selects or creates a blueprint
 *   2. WorldBuilder seeds the VLDB world gen using blueprint parameters
 *   3. The world is previewed in the VoxelEngine viewer
 *
 * Blueprint parameters drive world generation:
 *   - biomes from blueprint.world.biomes
 *   - seed from blueprint.world.seed
 *   - world size from blueprint.world.size
 *   - zone layout from blueprint.zones
 */

import { useState, useEffect } from 'react';
import {
  Map, Globe, Loader2, ChevronRight, CheckCircle,
  Layers, RefreshCw, AlertCircle, Plus,
} from 'lucide-react';
import { useAppState } from '@/context/AppContext';

interface BPSummary {
  id: string; name: string; mode: string; genre: string;
  sections: string[]; zoneCount: number; worldId: string|null;
}
interface World {
  id: string; name: string; seed: number; chunkCount: number;
}

const apiH = () => {
  const h: Record<string,string> = { 'Content-Type':'application/json' };
  const k = localStorage.getItem('bkg_user_api_key');
  if(k) h['Authorization'] = `Bearer ${k}`;
  return h;
};

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS = [
  { id:0, label:'Choose Blueprint' },
  { id:1, label:'Configure World'  },
  { id:2, label:'Generate'         },
  { id:3, label:'Open in Voxel'    },
];

// ── Main Component ────────────────────────────────────────────────────────────

export function WorldBuilder() {
  const { dispatch }              = useAppState();
  const [step,     setStep]       = useState(0);
  const [blueprints, setBlueprints] = useState<BPSummary[]>([]);
  const [selected, setSelected]   = useState<BPSummary|null>(null);
  const [worldName, setWorldName] = useState('');
  const [seed,     setSeed]       = useState(() => Math.floor(Math.random() * 999999));
  const [busy,     setBusy]       = useState(false);
  const [world,    setWorld]      = useState<World|null>(null);
  const [err,      setErr]        = useState('');
  const [loading,  setLoading]    = useState(true);

  useEffect(() => {
    fetch('/game/blueprint/list', { headers: apiH() })
      .then(r => r.json() as Promise<{ blueprints: BPSummary[] }>)
      .then(d => { setBlueprints(d.blueprints); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const createWorld = async () => {
    if(!selected) return;
    setErr(''); setBusy(true);
    try {
      // Read blueprint world config
      const bpResp = await fetch(`/game/blueprint/${selected.id}`, { headers: apiH() });
      const bp = await bpResp.json() as { world: Record<string,unknown> };
      const bpWorld = bp.world ?? {};
      const biomes  = (bpWorld.biomes as string[] | undefined) ?? ['plains','forest','mountains'];

      // Create VLDB world using blueprint parameters
      const r = await fetch('/vldb/worlds', {
        method: 'POST', headers: apiH(),
        body: JSON.stringify({
          name:   worldName || selected.name,
          seed,
          width:  (bpWorld.size as Record<string,number>)?.width  ?? 1024,
          height: (bpWorld.size as Record<string,number>)?.height ?? 512,
          depth:  (bpWorld.size as Record<string,number>)?.depth  ?? 1024,
          biome:  biomes[0] ?? 'plains',
          metadata: { blueprintId: selected.id, blueprintName: selected.name, genre: selected.genre },
        }),
      });
      if(!r.ok) { const e = await r.json() as { error:string }; throw new Error(e.error); }
      const w = await r.json() as World;
      setWorld(w);

      // Link worldId back to blueprint
      await fetch(`/game/blueprint/${selected.id}`, {
        method:'PUT', headers:apiH(),
        body: JSON.stringify({ worldId: w.id }),
      });

      setStep(3);
    } catch(e) { setErr(e instanceof Error ? e.message : 'World creation failed'); }
    setBusy(false);
  };

  const openInVoxel = () => dispatch({ type:'SET_STAGE', stage:'voxel' });

  const ACCENT = '#00e5ff';

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background:'#030810' }}>

      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-4 border-b"
        style={{ background:'rgba(6,15,30,0.95)', borderColor:`${ACCENT}08`, backdropFilter:'blur(12px)' }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center border"
          style={{ background:`${ACCENT}08`, borderColor:`${ACCENT}20` }}>
          <Map size={18} style={{ color:ACCENT }}/>
        </div>
        <div className="flex-1">
          <h1 className="text-sm font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif", letterSpacing:'0.06em' }}>
            World Builder
          </h1>
          <p className="text-[10px] text-muted/50">Turn a game blueprint into a voxel world</p>
        </div>
        <button onClick={()=>dispatch({ type:'SET_STAGE', stage:'home' })} className="text-xs text-muted/50 hover:text-muted px-2 py-1 transition-colors">
          ← Exit
        </button>
      </div>

      {/* Step bar */}
      <div className="flex-shrink-0 flex items-center gap-0 px-4 py-2.5 border-b overflow-x-auto"
        style={{ borderColor:`${ACCENT}10`, background:'rgba(9,22,40,0.5)' }}>
        {STEPS.map((s,i) => {
          const done  = step > s.id, active = step === s.id;
          const col   = active ? ACCENT : done ? '#00e5a0' : '#0d2a40';
          return (
            <div key={s.id} className="flex items-center flex-shrink-0">
              {i>0&&<div className="w-8 h-px mx-1" style={{ background:done?'#00e5a040':'#0d2a40' }}/>}
              <div className="flex items-center gap-2 px-2 py-1">
                <div className="w-5 h-5 rounded-full flex items-center justify-center border"
                  style={{ background:active?`${ACCENT}20`:done?'rgba(0,229,160,0.1)':'rgba(13,42,64,0.8)', borderColor:col }}>
                  {done?<CheckCircle size={10} style={{color:'#00e5a0'}}/>
                       :<span className="text-[8px] font-bold" style={{color:col}}>{s.id+1}</span>}
                </div>
                <span className="text-[10px] font-medium hidden sm:block" style={{ color:active?ACCENT:done?'#00e5a0':'#4a6880' }}>{s.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
        {err && (
          <div className="flex items-center gap-2 px-3 py-2.5 mb-4 rounded-xl border border-error/30 bg-error/8 text-error/80 text-xs">
            <AlertCircle size={12}/>
            {err}
            <button onClick={()=>setErr('')} className="ml-auto">✕</button>
          </div>
        )}

        {/* Step 0: Choose blueprint */}
        {step===0&&(
          <div className="flex flex-col gap-4 max-w-2xl">
            <div>
              <h2 className="text-base font-bold text-text-primary">Choose a Blueprint</h2>
              <p className="text-xs text-muted/60 mt-0.5">Select a game blueprint to seed the world generator.</p>
            </div>
            {loading ? <div className="flex items-center gap-2 text-muted/40"><Loader2 size={14} className="animate-spin"/>Loading blueprints…</div>
            : blueprints.length===0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <Globe size={28} strokeWidth={1} className="text-muted/20"/>
                <p className="text-sm text-muted/50">No blueprints yet</p>
                <button onClick={()=>dispatch({ type:'SET_STAGE', stage:'game' })}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-amber/30 text-amber/70 hover:text-amber text-sm font-semibold transition-all">
                  <Plus size={12}/>Create Game Blueprint First
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {blueprints.map(b=>(
                  <button key={b.id} onClick={()=>{ setSelected(b); setWorldName(b.name); setStep(1); }}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all hover:scale-[1.005] ${selected?.id===b.id?'border-accent/40 bg-accent/8':'border-border/40 bg-panel/30 hover:border-accent/25'}`}>
                    <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                      <Globe size={14} className="text-accent/60"/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{b.name}</p>
                      <p className="text-[10px] text-muted/50">{b.genre} · {b.mode} · {b.sections.length}/8 sections · {b.zoneCount} zones</p>
                    </div>
                    {b.worldId&&<span className="text-[9px] text-success/60 border border-success/20 px-1.5 py-0.5 rounded flex-shrink-0">Has World</span>}
                    <ChevronRight size={13} className="text-muted/30 flex-shrink-0"/>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 1: Configure */}
        {step===1&&selected&&(
          <div className="flex flex-col gap-5 max-w-xl">
            <div>
              <h2 className="text-base font-bold text-text-primary">Configure World</h2>
              <p className="text-xs text-muted/60 mt-0.5">From blueprint: <strong className="text-text-primary">{selected.name}</strong></p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">World Name</label>
              <input value={worldName} onChange={e=>setWorldName(e.target.value)}
                className="bg-base border border-border text-text-primary text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-accent/40"/>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">World Seed</label>
              <div className="flex gap-2">
                <input type="number" value={seed} onChange={e=>setSeed(Number(e.target.value))}
                  className="flex-1 bg-base border border-border text-text-primary text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-accent/40 font-mono"/>
                <button onClick={()=>setSeed(Math.floor(Math.random()*999999))}
                  className="px-3 py-2.5 rounded-xl border border-border text-muted/60 hover:text-accent hover:border-accent/30 transition-all">
                  <RefreshCw size={13}/>
                </button>
              </div>
              <p className="text-[10px] text-muted/40">Same seed = same world layout. Different seed = new world.</p>
            </div>
            <div className="rounded-xl border border-border/40 bg-panel/30 px-4 py-3 text-[11px] text-muted/60 flex flex-col gap-1.5">
              <p className="font-bold text-text-primary/70 text-xs mb-1">This will generate:</p>
              <div className="grid grid-cols-2 gap-1">
                {['Terrain from blueprint biomes','Zone placement from zone list','Dungeon structures (if zones have them)','NPC spawn points','Monster territories','Resource nodes'].map(i=>(
                  <div key={i} className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-accent/40 flex-shrink-0"/>{i}</div>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={()=>setStep(0)} className="px-4 py-2.5 border border-border text-muted/70 rounded-xl text-sm hover:text-text-primary transition-all">← Back</button>
              <button onClick={()=>setStep(2)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-accent text-base rounded-xl text-sm font-bold btn-glow hover:brightness-110 transition-all">
                <Layers size={14}/>Generate World<ChevronRight size={13}/>
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Generating */}
        {step===2&&(
          <div className="flex flex-col items-center gap-5 max-w-md mx-auto py-8 text-center">
            <div className="w-20 h-20 rounded-2xl border border-accent/30 flex items-center justify-center"
              style={{ background:'rgba(0,229,255,0.06)' }}>
              {busy?<Loader2 size={36} className="text-accent animate-spin"/>:<Map size={36} className="text-accent/60"/>}
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">
                {busy ? 'Generating World…' : 'Ready to Generate'}
              </h2>
              <p className="text-sm text-muted/60 mt-1">
                {busy ? `Creating "${worldName}" (seed: ${seed})` : `Click below to create "${worldName}".`}
              </p>
            </div>
            {!busy&&(
              <button onClick={()=>void createWorld()}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-accent text-base font-bold text-sm btn-glow hover:brightness-110 transition-all">
                <Layers size={15}/>Create World Now
              </button>
            )}
            {busy&&(
              <div className="w-full h-1.5 rounded-full bg-border/30 overflow-hidden">
                <div className="h-full rounded-full bg-accent/60 animate-pulse" style={{ width:'60%' }}/>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Done */}
        {step===3&&world&&(
          <div className="flex flex-col items-center gap-5 max-w-md mx-auto py-8 text-center">
            <div className="w-20 h-20 rounded-2xl border border-success/30 flex items-center justify-center"
              style={{ background:'rgba(0,229,160,0.06)' }}>
              <CheckCircle size={38} className="text-success"/>
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">World Created!</h2>
              <p className="text-sm text-muted/60 mt-1">
                "{world.name}" is ready · seed {world.seed}
              </p>
            </div>
            <div className="w-full flex flex-col gap-2">
              <button onClick={openInVoxel}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-accent text-base font-bold text-sm btn-glow hover:brightness-110 transition-all">
                <Layers size={14}/>Open in Voxel Engine
              </button>
              <button onClick={()=>{ setStep(0); setWorld(null); setSelected(null); }}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-border/50 text-muted/70 hover:text-text-primary text-sm transition-all">
                <Globe size={13}/>Build Another World
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
