/**
 * src/components/Admin/MMOCreator.tsx
 *
 * Admin panel for MMO world management:
 * - Create MMO blueprints (world + all game systems)
 * - AI-generate each section with live streaming
 * - Edit sections inline or re-generate
 * - Publish / unpublish worlds for users to join
 * - Shows all blueprints (single-player + MMO)
 */

import { useState, useEffect, useRef } from 'react';
import {
  Globe, Plus, Trash2, ChevronRight, Loader2, CheckCircle,
  Sparkles, AlertCircle, Users, Skull,
  Sword, Package, TrendingUp, Map, BookOpen, Zap,
  Radio, RadioTower, Settings, RefreshCw,
} from 'lucide-react';
import { getToken } from './AdminAuth';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BPSummary {
  id: string; name: string; mode: string; genre: string; tone: string;
  status: string; worldId: string|null; createdAt: number; updatedAt: number;
  sections: string[]; npcCount: number; monsterCount: number;
  questCount: number; zoneCount: number;
  engine?: { label: string };
}

interface FullBP {
  id: string; name: string; mode: string; genre: string; tone: string;
  status: string; generatedSections: string[];
  docs: Record<string,string>;
  world: Record<string,unknown>; story: Record<string,unknown>;
  npcs: Record<string,unknown>[]; monsters: Record<string,unknown>[];
  quests: Record<string,unknown>[]; loot: Record<string,unknown>;
  levels: Record<string,unknown>; zones: Record<string,unknown>[];
  engine: { id:string; label:string; lang:string }|null;
  mmo: Record<string,unknown>|null;
}

const H = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${getToken()}`,
});

const SECTIONS = [
  { key:'world',    label:'World',    icon:Globe       },
  { key:'story',    label:'Story',    icon:BookOpen    },
  { key:'npcs',     label:'NPCs',     icon:Users       },
  { key:'monsters', label:'Monsters', icon:Skull       },
  { key:'quests',   label:'Quests',   icon:Sword       },
  { key:'loot',     label:'Loot',     icon:Package     },
  { key:'levels',   label:'Levels',   icon:TrendingUp  },
  { key:'zones',    label:'Zones',    icon:Map         },
  { key:'gameplan', label:'Gameplan', icon:Zap         },
];

// ── Streaming helper ──────────────────────────────────────────────────────────

async function streamSection(
  bpId: string, section: string,
  onTok: (t:string)=>void, onDone:(p:unknown)=>void, onErr:(e:string)=>void,
) {
  const r = await fetch(`/game/blueprint/${bpId}/generate/${section}`, {
    method:'POST', headers:H(), body:JSON.stringify({}),
  });
  if (!r.ok || !r.body) { onErr(`${r.status}`); return; }
  const rd=r.body.getReader(), dec=new TextDecoder(); let buf='';
  while(true) {
    const {done,value}=await rd.read(); if(done) break;
    buf+=dec.decode(value,{stream:true});
    const lines=buf.split('\n'); buf=lines.pop()??'';
    for(const l of lines) {
      if(!l.startsWith('data:')) continue;
      try {
        const ev=JSON.parse(l.slice(5).trim()) as {type:string;data:{token?:string;parsedData?:unknown;error?:string}};
        if(ev.type==='chunk'&&ev.data.token) onTok(ev.data.token);
        if(ev.type==='done')  onDone(ev.data.parsedData);
        if(ev.type==='error') onErr(ev.data.error??'AI error');
      } catch{/**/ }
    }
  }
}

// ── Create Modal ──────────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreate }: { onClose:()=>void; onCreate:(bp:FullBP)=>void }) {
  const [name,    setName]    = useState('');
  const [genre,   setGenre]   = useState('rpg');
  const [tone,    setTone]    = useState('dark');
  const [concept, setConcept] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(100);
  const [pvp,     setPvp]     = useState(false);
  const [busy,    setBusy]    = useState(false);

  const genres = ['rpg','fps','survival','horror','sci-fi','fantasy','strategy','sandbox'];
  const tones  = ['dark','heroic','comedic','gritty','epic','mysterious','post-apocalyptic','anime'];

  const create = async () => {
    if(!name.trim()) return;
    setBusy(true);
    const r = await fetch('/game/blueprint/create', {
      method:'POST', headers:H(),
      body:JSON.stringify({ name, mode:'mmo', genre, tone, world:{ description:concept }, maxPlayers, pvpEnabled:pvp }),
    });
    const bp = await r.json() as FullBP;
    onCreate(bp);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{background:'rgba(3,8,16,0.9)',backdropFilter:'blur(8px)'}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-panel">
          <Globe size={16} className="text-accent"/>
          <h2 className="text-sm font-bold text-text-primary">Create MMO World</h2>
          <button onClick={onClose} className="ml-auto text-muted/40 hover:text-muted">✕</button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">World Name</label>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="Eternal Realm"
              className="bg-base border border-border text-text-primary text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-accent/40"/>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">Concept</label>
            <textarea value={concept} onChange={e=>setConcept(e.target.value)} rows={2}
              placeholder="A persistent fantasy world where hundreds of players share a living, breathing universe…"
              className="bg-base border border-border text-text-primary text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-accent/40 resize-none"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">Genre</label>
              <select value={genre} onChange={e=>setGenre(e.target.value)}
                className="bg-base border border-border text-text-primary text-sm rounded-xl px-3 py-2 focus:outline-none">
                {genres.map(g=><option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">Tone</label>
              <select value={tone} onChange={e=>setTone(e.target.value)}
                className="bg-base border border-border text-text-primary text-sm rounded-xl px-3 py-2 focus:outline-none">
                {tones.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">Max Players</label>
              <input type="number" value={maxPlayers} onChange={e=>setMaxPlayers(Number(e.target.value))} min={2} max={10000}
                className="bg-base border border-border text-text-primary text-sm rounded-xl px-3 py-2.5 focus:outline-none"/>
            </div>
            <div className="flex items-center gap-3 pt-5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={pvp} onChange={e=>setPvp(e.target.checked)} className="accent-accent"/>
                <span className="text-sm text-muted/70">PvP enabled</span>
              </label>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 border border-border text-muted/70 rounded-xl text-sm hover:text-text-primary transition-colors">Cancel</button>
            <button onClick={()=>void create()} disabled={busy||!name.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-accent text-base rounded-xl text-sm font-bold btn-glow hover:brightness-110 transition-all disabled:opacity-40">
              {busy?<Loader2 size={13} className="animate-spin"/>:<Plus size={13}/>}Create World
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Blueprint Detail Pane ──────────────────────────────────────────────────────

function BPDetail({ bp: initial, onUpdate, onClose }: { bp:FullBP; onUpdate:(bp:FullBP)=>void; onClose:()=>void }) {
  const [bp,      setBp]     = useState<FullBP>(initial);
  const [busy,    setBusy]   = useState(false);
  const [curSec,  setCurSec] = useState('');
  const [stream,  setStream] = useState('');
  const [err,     setErr]    = useState('');
  const [actSec,  setActSec] = useState<string|null>(null);
  const [editJson,setEditJson]= useState('');
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{ if(streamRef.current) streamRef.current.scrollTop=streamRef.current.scrollHeight; },[stream]);

  const refresh = async () => {
    const r = await fetch(`/game/blueprint/${bp.id}`,{headers:H()});
    const b = await r.json() as FullBP; setBp(b); onUpdate(b); return b;
  };

  const gen = async (section:string) => {
    setErr(''); setBusy(true); setCurSec(section); setStream(''); setActSec(section);
    try {
      await streamSection(bp.id, section,
        t=>setStream(s=>s+t),
        ()=>void refresh(),
        e=>setErr(e),
      );
    } catch(e) { setErr(e instanceof Error?e.message:'Error'); }
    setBusy(false); setCurSec('');
  };

  const saveEdit = async () => {
    if(!actSec) return;
    try {
      const data = JSON.parse(editJson);
      await fetch(`/game/blueprint/${bp.id}/section/${actSec}`, {
        method:'PATCH', headers:H(), body:JSON.stringify(data),
      });
      await refresh();
      setActSec(null); setEditJson('');
    } catch(e) { setErr('Invalid JSON: '+(e instanceof Error?e.message:'parse error')); }
  };

  const publish = async () => {
    const action = bp.status==='published' ? 'unpublish' : 'publish';
    const r = await fetch(`/game/mmo/${action}/${bp.id}`,{ method:'POST', headers:H() });
    if(r.ok) await refresh();
  };

  const done = (s:string) => bp.generatedSections.includes(s);
  const completion = Math.round(SECTIONS.filter(s=>done(s.key)).length/SECTIONS.length*100);

  const openEdit = (section:string) => {
    const data = (['npcs','monsters','quests','zones'].includes(section)
      ? bp[section as keyof FullBP]
      : (bp[section as keyof FullBP] ?? {}));
    setEditJson(JSON.stringify(data, null, 2));
    setActSec(section);
    setStream('');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-border bg-panel">
        <button onClick={onClose} className="text-muted/50 hover:text-muted text-xs flex items-center gap-1">
          ← Back
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-text-primary truncate">{bp.name}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold uppercase ${bp.status==='published'?'border-success/40 text-success bg-success/10':'border-amber/30 text-amber/70 bg-amber/5'}`}>
              {bp.status}
            </span>
            <span className="text-[9px] text-muted/40">{bp.mode} · {bp.genre} · {bp.tone}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="h-1 w-24 rounded-full bg-border/40 overflow-hidden">
              <div className="h-full bg-accent/60 rounded-full" style={{width:`${completion}%`}}/>
            </div>
            <span className="text-[9px] text-muted/40">{completion}% generated</span>
          </div>
        </div>
        {bp.mode==='mmo'&&(
          <button onClick={()=>void publish()}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${bp.status==='published'?'border-error/30 text-error/80 hover:bg-error/10':'border-success/30 text-success hover:bg-success/10'}`}>
            {bp.status==='published'?<><RadioTower size={11}/>Unpublish</>:<><Radio size={11}/>Publish</>}
          </button>
        )}
      </div>

      {err&&<div className="flex-shrink-0 flex items-center gap-2 px-5 py-2 bg-error/10 border-b border-error/20 text-error/80 text-xs"><AlertCircle size={11}/>{err}<button onClick={()=>setErr('')} className="ml-auto">✕</button></div>}

      {/* Section grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-5">
          {SECTIONS.map(s=>{
            const isDone  = done(s.key);
            const isActive= actSec===s.key;
            const isBusy  = busy&&curSec===s.key;
            const Icon    = s.icon;
            const count   = Array.isArray((bp as unknown as Record<string,unknown>)[s.key])
              ? ((bp as unknown as Record<string,unknown>)[s.key] as unknown[]).length : null;

            return (
              <div key={s.key} className={`rounded-xl border flex flex-col gap-3 p-4 transition-all ${isActive?'border-accent/40 bg-accent/5':'border-border/40 bg-panel/30'}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center border flex-shrink-0 ${isDone?'border-success/30 bg-success/10':'border-border/40 bg-base/40'}`}>
                    <Icon size={12} className={isDone?'text-success':'text-muted/50'}/>
                  </div>
                  <span className="text-xs font-bold text-text-primary flex-1">{s.label}</span>
                  {isDone&&<CheckCircle size={11} className="text-success/70 flex-shrink-0"/>}
                  {count!==null&&count>0&&<span className="text-[9px] text-muted/50">{count}</span>}
                </div>

                {isBusy&&(
                  <div ref={streamRef} className="text-[10px] font-mono text-text-primary/50 leading-snug whitespace-pre-wrap max-h-24 overflow-y-auto bg-base/60 border border-border/30 rounded-lg p-2">
                    {stream||'Generating…'}
                    <span className="inline-block w-1 h-2.5 bg-accent/70 ml-0.5 animate-pulse"/>
                  </div>
                )}

                {isActive&&!isBusy&&editJson&&(
                  <div className="flex flex-col gap-2">
                    <textarea value={editJson} onChange={e=>setEditJson(e.target.value)} rows={6}
                      className="w-full bg-base border border-border text-text-primary text-[10px] font-mono rounded-lg px-2 py-2 focus:outline-none focus:border-accent/40 resize-y"/>
                    <div className="flex gap-2">
                      <button onClick={()=>{setActSec(null);setEditJson('');}} className="flex-1 py-1.5 border border-border/50 text-muted/70 rounded-lg text-xs hover:text-text-primary transition-colors">Cancel</button>
                      <button onClick={()=>void saveEdit()} className="flex-1 py-1.5 bg-accent/20 border border-accent/30 text-accent rounded-lg text-xs font-bold hover:bg-accent/30 transition-all">Save</button>
                    </div>
                  </div>
                )}

                {(!isActive||!editJson)&&!isBusy&&(
                  <div className="flex gap-1.5">
                    <button onClick={()=>void gen(s.key)} disabled={busy}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-accent/20 text-accent/70 hover:border-accent/50 hover:text-accent text-[10px] font-semibold transition-all disabled:opacity-40">
                      <Sparkles size={9}/>{isDone?'Regen':'Generate'}
                    </button>
                    {isDone&&(
                      <button onClick={()=>openEdit(s.key)}
                        className="px-2 py-1.5 rounded-lg border border-border/40 text-muted/50 hover:text-accent hover:border-accent/30 text-[10px] transition-all">
                        <Settings size={9}/>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Blueprint List ─────────────────────────────────────────────────────────────

function BPList({ blueprints, onSelect, onDelete, onRefresh }: {
  blueprints: BPSummary[];
  onSelect: (id:string)=>void;
  onDelete: (id:string)=>void;
  onRefresh: ()=>void;
}) {
  const all  = blueprints;
  const mmo  = all.filter(b=>b.mode==='mmo');
  const solo = all.filter(b=>b.mode==='singleplayer');

  const Row = ({ b }: { b:BPSummary }) => {
    const pct = Math.round(b.sections.length / 8 * 100);
    return (
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-white/4 rounded-xl transition-all cursor-pointer group" onClick={()=>onSelect(b.id)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-text-primary truncate">{b.name}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold uppercase flex-shrink-0 ${b.status==='published'?'border-success/40 text-success':b.status==='draft'?'border-amber/30 text-amber/70':'border-border/40 text-muted/50'}`}>
              {b.status}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted/50">
            <span>{b.genre} · {b.tone}</span>
            <span>{b.npcCount} NPCs · {b.monsterCount} monsters · {b.questCount} quests</span>
            <div className="flex items-center gap-1 ml-auto">
              <div className="h-1 w-16 rounded-full bg-border/40 overflow-hidden"><div className="h-full bg-accent/50" style={{width:`${pct}%`}}/></div>
              <span>{pct}%</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <ChevronRight size={14} className="text-muted/40"/>
          <button onClick={e=>{e.stopPropagation();onDelete(b.id);}} className="w-6 h-6 flex items-center justify-center text-muted/30 hover:text-error transition-colors">
            <Trash2 size={11}/>
          </button>
        </div>
      </div>
    );
  };

  if(!all.length) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
      <Globe size={32} strokeWidth={1} className="text-muted/20"/>
      <p className="text-sm text-muted/40">No blueprints yet</p>
      <p className="text-xs text-muted/30">Create an MMO world or have users create single-player games</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 p-4">
      {mmo.length>0&&(
        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <Globe size={12} className="text-accent/60"/>
            <span className="text-xs font-bold text-muted/60 uppercase tracking-wider">MMO Worlds ({mmo.length})</span>
            <button onClick={onRefresh} className="ml-auto text-muted/30 hover:text-muted"><RefreshCw size={10}/></button>
          </div>
          <div className="flex flex-col gap-1">{mmo.map(b=><Row key={b.id} b={b}/>)}</div>
        </div>
      )}
      {solo.length>0&&(
        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-xs font-bold text-muted/60 uppercase tracking-wider">Single-Player Blueprints ({solo.length})</span>
          </div>
          <div className="flex flex-col gap-1">{solo.map(b=><Row key={b.id} b={b}/>)}</div>
        </div>
      )}
    </div>
  );
}

// ── Main Export ────────────────────────────────────────────────────────────────

export function MMOCreator() {
  const [blueprints, setBlueprints]   = useState<BPSummary[]>([]);
  const [selected,   setSelected]     = useState<FullBP|null>(null);
  const [showCreate, setShowCreate]   = useState(false);
  const [loading,    setLoading]      = useState(true);

  const load = async () => {
    setLoading(true);
    const r = await fetch('/game/blueprint/list',{headers:H()});
    const d = await r.json() as { blueprints:BPSummary[] };
    setBlueprints(d.blueprints);
    setLoading(false);
  };

  useEffect(()=>{ void load(); },[]);

  const openBlueprint = async (id:string) => {
    const r = await fetch(`/game/blueprint/${id}`,{headers:H()});
    const bp = await r.json() as FullBP;
    setSelected(bp);
  };

  const deleteBlueprint = async (id:string) => {
    await fetch(`/game/blueprint/${id}`,{ method:'DELETE', headers:H() });
    setBlueprints(bs=>bs.filter(b=>b.id!==id));
    if(selected?.id===id) setSelected(null);
  };

  const handleCreated = (bp:FullBP) => {
    setShowCreate(false);
    setSelected(bp);
    void load();
  };

  if(selected) return (
    <div className="flex flex-col h-full overflow-hidden">
      <BPDetail
        bp={selected}
        onUpdate={updated=>{ setSelected(updated); void load(); }}
        onClose={()=>setSelected(null)}
      />
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-border bg-panel">
        <Globe size={16} className="text-accent"/>
        <div>
          <h2 className="text-sm font-bold text-text-primary">Game Blueprint Manager</h2>
          <p className="text-[11px] text-muted/50">Create MMO worlds · manage blueprints · publish for players</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={()=>void load()} className="text-muted/40 hover:text-muted transition-colors p-1.5"><RefreshCw size={13}/></button>
          <button onClick={()=>setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-base text-xs font-bold btn-glow hover:brightness-110 transition-all">
            <Plus size={12}/>New MMO World
          </button>
        </div>
      </div>

      {/* Published worlds summary */}
      {blueprints.filter(b=>b.mode==='mmo'&&b.status==='published').length>0&&(
        <div className="flex-shrink-0 flex items-center gap-3 px-5 py-2.5 border-b border-success/20 bg-success/5">
          <Radio size={11} className="text-success animate-pulse"/>
          <span className="text-[11px] font-semibold text-success/80">
            {blueprints.filter(b=>b.mode==='mmo'&&b.status==='published').length} MMO world{blueprints.filter(b=>b.mode==='mmo'&&b.status==='published').length!==1?'s':''} LIVE
            {' · '}{blueprints.filter(b=>b.mode==='mmo'&&b.status==='published').map(b=>b.name).join(', ')}
          </span>
          <span className="text-[10px] text-muted/40 ml-auto">Visible to users in Game Client</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-muted/40">
            <Loader2 size={16} className="animate-spin"/>Loading blueprints…
          </div>
        ) : (
          <BPList blueprints={blueprints} onSelect={id=>void openBlueprint(id)} onDelete={id=>void deleteBlueprint(id)} onRefresh={()=>void load()}/>
        )}
      </div>

      {showCreate&&<CreateModal onClose={()=>setShowCreate(false)} onCreate={handleCreated}/>}
    </div>
  );
}
