/**
 * src/components/Game/GameWizard.tsx
 *
 * bKG Game Studio — Single-Player Blueprint Wizard
 *
 * 9-step pipeline:  Setup → World → Story → NPCs → Monsters →
 *                   Quests → Loot → Levels → Zones → Launch
 *
 * Each step uses SSE streaming AI generation via:
 *   POST /game/blueprint/:id/generate/:section
 *
 * Blueprint stored server-side; admin can promote to MMO from Admin panel.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Gamepad2, Globe, BookOpen, Users, Skull, Sword,
  Package, TrendingUp, Map, Zap, ChevronRight, ChevronLeft,
  Loader2, CheckCircle, Sparkles, Bot, ArrowRight,
  AlertCircle, Eye, EyeOff,
} from 'lucide-react';
import { useAppState } from '@/context/AppContext';

const ACCENT = '#ffb300';

const STEPS = [
  { id:0, label:'Setup',    icon:Gamepad2   },
  { id:1, label:'World',    icon:Globe      },
  { id:2, label:'Story',    icon:BookOpen   },
  { id:3, label:'NPCs',     icon:Users      },
  { id:4, label:'Monsters', icon:Skull      },
  { id:5, label:'Quests',   icon:Sword      },
  { id:6, label:'Loot',     icon:Package    },
  { id:7, label:'Levels',   icon:TrendingUp },
  { id:8, label:'Zones',    icon:Map        },
  { id:9, label:'Launch',   icon:Zap        },
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Engine { id:string; label:string; lang:string; free:boolean }
interface Genre  { id:string; label:string; desc:string }
interface Tone   { id:string; label:string; color:string }
interface BP {
  id:string; name:string; mode:string; genre:string; tone:string; status:string;
  generatedSections:string[];
  docs:Record<string,string>;
  world:Record<string,unknown>; story:Record<string,unknown>;
  npcs:Record<string,unknown>[]; monsters:Record<string,unknown>[];
  quests:Record<string,unknown>[]; loot:Record<string,unknown>;
  levels:Record<string,unknown>; zones:Record<string,unknown>[];
  engine:Engine|null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const apiH = (): Record<string,string> => {
  const h: Record<string,string> = { 'Content-Type':'application/json' };
  const k = localStorage.getItem('bkg_user_api_key');
  if (k) h['Authorization'] = `Bearer ${k}`;
  return h;
};

async function streamGenerate(
  bpId: string, section: string,
  onToken: (t:string)=>void, onDone: (parsed:unknown)=>void, onErr:(e:string)=>void,
) {
  const r = await fetch(`/game/blueprint/${bpId}/generate/${section}`, {
    method:'POST', headers:apiH(), body:JSON.stringify({}),
  });
  if (!r.ok || !r.body) { onErr(`${r.status}`); return; }
  const rd=r.body.getReader(), dec=new TextDecoder(); let buf='';
  while(true) {
    const {done,value} = await rd.read(); if(done) break;
    buf += dec.decode(value,{stream:true});
    const lines=buf.split('\n'); buf=lines.pop()??'';
    for(const l of lines) {
      if(!l.startsWith('data:')) continue;
      try {
        const ev = JSON.parse(l.slice(5).trim()) as {type:string;data:{token?:string;parsedData?:unknown;error?:string}};
        if(ev.type==='chunk' && ev.data.token) onToken(ev.data.token);
        if(ev.type==='done')  onDone(ev.data.parsedData);
        if(ev.type==='error') onErr(ev.data.error ?? 'AI error');
      } catch{/**/ }
    }
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StreamBox({ text, busy }: { text:string; busy:boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(()=>{ if(ref.current) ref.current.scrollTop=ref.current.scrollHeight; },[text]);
  if(!text && !busy) return null;
  return (
    <div ref={ref} className="text-[11px] font-mono text-text-primary/60 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto p-3 rounded-xl border border-border/40 bg-base/60">
      {text||<span className="text-muted/30">Generating…</span>}
      {busy&&<span className="inline-block w-1 h-3 bg-accent/70 ml-0.5 animate-pulse"/>}
    </div>
  );
}

function GenBtn({ label, done, busy, onClick }: { label:string; done:boolean; busy:boolean; onClick:()=>void }) {
  return (
    <button onClick={onClick} disabled={busy}
      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border text-sm font-bold transition-all disabled:opacity-40"
      style={{ background:`${ACCENT}10`, borderColor:`${ACCENT}30`, color:ACCENT }}>
      {busy ? <Loader2 size={13} className="animate-spin"/> : <Sparkles size={13}/>}
      {busy ? 'Generating…' : done ? `Re-generate ${label}` : `AI Generate ${label}`}
    </button>
  );
}

function Badge({ done }:{ done:boolean }) {
  return done
    ? <span className="flex items-center gap-1 text-[9px] text-success/80 font-bold uppercase tracking-wider"><CheckCircle size={9}/>Done</span>
    : <span className="text-[9px] text-muted/40 uppercase tracking-wider">Pending</span>;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function GameWizard() {
  const { dispatch } = useAppState();

  const [step,    setStep]   = useState(0);
  const [config,  setConfig] = useState<{ genres:Genre[]; tones:Tone[]; engines:Engine[] }>({ genres:[], tones:[], engines:[] });
  const [bp,      setBp]     = useState<BP|null>(null);
  const [busy,    setBusy]   = useState(false);
  const [curSec,  setCurSec] = useState('');
  const [stream,  setStream] = useState('');
  const [err,     setErr]    = useState('');
  const [created, setCreated]= useState<{id:string;title:string}|null>(null);
  const [showJson,setJson]   = useState(false);

  // Form
  const [name,    setName]   = useState('');
  const [genre,   setGenre]  = useState('rpg');
  const [tone,    setTone]   = useState('dark');
  const [engine,  setEngine] = useState('');
  const [concept, setConcept]= useState('');

  useEffect(() => {
    fetch('/game/config').then(r=>r.json()).then((c:{ genres:Genre[]; tones:Tone[]; engines:Engine[] })=>{
      setConfig(c); if(c.engines[0]) setEngine(c.engines[0].id);
    }).catch(()=>{});
  },[]);

  const ensureBp = async (): Promise<BP> => {
    if(bp) return bp;
    const eng = config.engines.find(e=>e.id===engine) ?? config.engines[0] ?? { id:'godot4',label:'Godot 4',lang:'GDScript',free:true };
    const r = await fetch('/game/blueprint/create', {
      method:'POST', headers:apiH(),
      body:JSON.stringify({ name:name||'My Game', mode:'singleplayer', genre, tone, engine:eng, world:{ description:concept } }),
    });
    const b = await r.json() as BP;
    setBp(b); return b;
  };

  const refresh = async (id:string) => {
    const r = await fetch(`/game/blueprint/${id}`,{headers:apiH()});
    const b = await r.json() as BP; setBp(b); return b;
  };

  const gen = async (section:string) => {
    setErr(''); setBusy(true); setCurSec(section); setStream('');
    try {
      const cur = await ensureBp();
      await streamGenerate(cur.id, section,
        tok => setStream(t=>t+tok),
        _parsed => { void refresh(cur.id); },
        e => setErr(e),
      );
    } catch(e) { setErr(e instanceof Error ? e.message : 'Error'); }
    setBusy(false); setCurSec('');
  };

  const done = (s:string) => bp?.generatedSections.includes(s) ?? false;
  const cnt  = (k:keyof BP) => Array.isArray(bp?.[k]) ? (bp![k] as unknown[]).length : 0;

  const makeTask = async () => {
    if(!bp) return;
    setBusy(true);
    try {
      const r = await fetch('/game/create-task', {
        method:'POST', headers:apiH(),
        body:JSON.stringify({ design:{ world:{...bp.world,title:bp.name,genre:bp.genre,tone:bp.tone}, story:bp.story, npcs:{characters:bp.npcs}, quests:{quests:bp.quests}, engine:bp.engine, docs:bp.docs }, projectId:'default', blueprintId:bp.id }),
      });
      if(r.ok) setCreated(await r.json() as {id:string;title:string});
    } catch{ setErr('Failed to create task'); }
    setBusy(false);
  };

  // ── Steps ─────────────────────────────────────────────────────────────────

  const steps: Record<number, React.ReactElement> = {

    0: (
      <div className="flex flex-col gap-5 max-w-2xl">
        <div>
          <h2 className="text-base font-bold text-text-primary" style={{fontFamily:"'Orbitron',sans-serif"}}>Game Setup</h2>
          <p className="text-xs text-muted/60 mt-0.5">Single-player game — you own the blueprint. AI builds every system.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">Game Title</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Shattered Kingdoms"
            className="bg-base/80 border border-border text-text-primary font-semibold text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-accent/40"/>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">World Concept</label>
          <textarea value={concept} onChange={e=>setConcept(e.target.value)} rows={3}
            placeholder="A crumbling empire where ancient machines are waking up and magic is dying…"
            className="bg-base/80 border border-border text-text-primary text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-accent/40 resize-none"/>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">Engine</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {config.engines.map(e=>(
              <button key={e.id} onClick={()=>setEngine(e.id)}
                className="flex flex-col gap-0.5 px-3 py-2.5 rounded-xl border text-left transition-all"
                style={{ background:engine===e.id?`${ACCENT}10`:'rgba(9,22,40,0.8)', borderColor:engine===e.id?`${ACCENT}40`:'rgba(13,42,64,0.8)', boxShadow:engine===e.id?`0 0 8px ${ACCENT}20`:undefined }}>
                <span className="text-xs font-bold" style={{color:engine===e.id?ACCENT:'#e8f4f8'}}>{e.label}</span>
                <span className="text-[10px] text-muted/50">{e.lang}{e.free&&' · Free'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">Genre</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {config.genres.map(g=>(
              <button key={g.id} onClick={()=>setGenre(g.id)}
                className="px-3 py-2 rounded-xl border text-left transition-all"
                style={{ background:genre===g.id?`${ACCENT}10`:'rgba(9,22,40,0.8)', borderColor:genre===g.id?`${ACCENT}35`:'rgba(13,42,64,0.8)' }}>
                <p className="text-xs font-semibold" style={{color:genre===g.id?ACCENT:'#e8f4f8'}}>{g.label}</p>
                <p className="text-[10px] text-muted/40 truncate">{g.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">Tone</label>
          <div className="flex flex-wrap gap-2">
            {config.tones.map(t=>(
              <button key={t.id} onClick={()=>setTone(t.id)}
                className="px-3 py-1.5 rounded-full border text-xs font-semibold transition-all"
                style={{ background:tone===t.id?t.color+'30':'rgba(9,22,40,0.8)', borderColor:tone===t.id?t.color+'80':'rgba(13,42,64,0.8)', color:tone===t.id?'#e8f4f8':'#4a6880' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    ),

    1: (
      <div className="flex flex-col gap-4 max-w-2xl">
        <div className="flex items-center justify-between"><div><h2 className="text-base font-bold text-text-primary" style={{fontFamily:"'Orbitron',sans-serif"}}>World Building</h2><p className="text-xs text-muted/60">Geography, factions, magic/tech system, lore.</p></div><Badge done={done('world')}/></div>
        <GenBtn label="World" done={done('world')} busy={busy&&curSec==='world'} onClick={()=>void gen('world')}/>
        <StreamBox text={curSec==='world'?stream:(done('world')?(bp?.docs.world?.slice(0,600)??'')+'…':'')} busy={busy&&curSec==='world'}/>
      </div>
    ),

    2: (
      <div className="flex flex-col gap-4 max-w-2xl">
        <div className="flex items-center justify-between"><div><h2 className="text-base font-bold text-text-primary" style={{fontFamily:"'Orbitron',sans-serif"}}>Story Design</h2><p className="text-xs text-muted/60">3-act narrative, protagonist arc, antagonist, endings.</p></div><Badge done={done('story')}/></div>
        <GenBtn label="Story" done={done('story')} busy={busy&&curSec==='story'} onClick={()=>void gen('story')}/>
        <StreamBox text={curSec==='story'?stream:(done('story')?(bp?.docs.story?.slice(0,600)??'')+'…':'')} busy={busy&&curSec==='story'}/>
      </div>
    ),

    3: (
      <div className="flex flex-col gap-4 max-w-2xl">
        <div className="flex items-center justify-between">
          <div><h2 className="text-base font-bold text-text-primary" style={{fontFamily:"'Orbitron',sans-serif"}}>NPCs</h2><p className="text-xs text-muted/60">Merchants, quest-givers, companions, guards.</p></div>
          <div className="flex items-center gap-2">{cnt('npcs')>0&&<span className="text-[10px] text-accent/70">{cnt('npcs')} chars</span>}<Badge done={done('npcs')}/></div>
        </div>
        <GenBtn label="NPC Roster" done={done('npcs')} busy={busy&&curSec==='npcs'} onClick={()=>void gen('npcs')}/>
        {busy&&curSec==='npcs'&&<StreamBox text={stream} busy/>}
        {cnt('npcs')>0&&(
          <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
            {(bp!.npcs as Record<string,unknown>[]).slice(0,15).map((n,i)=>(
              <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-border/30 bg-panel/30">
                <div className="w-6 h-6 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0"><Users size={11} className="text-accent/60"/></div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-text-primary truncate">{String(n.name??'—')}</p>
                  <p className="text-[10px] text-muted/50">{String(n.type??'')} · {String(n.faction??'')}</p>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-border/40 text-muted/50">Lv.{String(n.level??1)}</span>
              </div>
            ))}
            {cnt('npcs')>15&&<p className="text-[10px] text-muted/40 text-center">+{cnt('npcs')-15} more</p>}
          </div>
        )}
      </div>
    ),

    4: (
      <div className="flex flex-col gap-4 max-w-2xl">
        <div className="flex items-center justify-between">
          <div><h2 className="text-base font-bold text-text-primary" style={{fontFamily:"'Orbitron',sans-serif"}}>Monsters</h2><p className="text-xs text-muted/60">Beasts, undead, demons, bosses, world bosses.</p></div>
          <div className="flex items-center gap-2">{cnt('monsters')>0&&<span className="text-[10px] text-error/60">{cnt('monsters')} monsters</span>}<Badge done={done('monsters')}/></div>
        </div>
        <GenBtn label="Monster Roster" done={done('monsters')} busy={busy&&curSec==='monsters'} onClick={()=>void gen('monsters')}/>
        {busy&&curSec==='monsters'&&<StreamBox text={stream} busy/>}
        {cnt('monsters')>0&&(
          <div className="overflow-x-auto rounded-xl border border-border/30">
            <table className="w-full text-[10px]">
              <thead className="bg-panel/60">
                <tr className="border-b border-border/40">
                  {['Name','Type','Lv','Tier','HP','XP','Biomes'].map(h=><th key={h} className="px-2 py-2 text-left font-bold text-muted/60 uppercase tracking-wider whitespace-nowrap text-[9px]">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {(bp!.monsters as Record<string,unknown>[]).slice(0,12).map((m,i)=>{
                  const s=m.stats as Record<string,unknown>??{};
                  const tc:Record<string,string>={ common:'#aaa',uncommon:'#1eff00',elite:'#0070dd',champion:'#a335ee',boss:'#ff8000',worldboss:'#e6cc80' };
                  const tier=String(m.tier??'common');
                  return (
                    <tr key={i} className={`border-b border-border/20 ${i%2===0?'bg-base/20':''}`}>
                      <td className="px-2 py-1.5 font-semibold text-text-primary truncate max-w-[100px]">{String(m.name??'—')}</td>
                      <td className="px-2 py-1.5 text-muted/60">{String(m.type??'—')}</td>
                      <td className="px-2 py-1.5 text-center text-accent/70">{String(m.level??1)}</td>
                      <td className="px-2 py-1.5" style={{color:tc[tier]??'#aaa'}}>{tier}</td>
                      <td className="px-2 py-1.5 text-muted/50">{String(s.hp??'—')}</td>
                      <td className="px-2 py-1.5 text-success/60">{String(s.xpReward??'—')}</td>
                      <td className="px-2 py-1.5 text-muted/40 truncate max-w-[80px]">{((m.biomes as string[]??[])).slice(0,2).join(', ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {cnt('monsters')>12&&<p className="text-[10px] text-muted/40 text-center py-2">+{cnt('monsters')-12} more</p>}
          </div>
        )}
      </div>
    ),

    5: (
      <div className="flex flex-col gap-4 max-w-2xl">
        <div className="flex items-center justify-between">
          <div><h2 className="text-base font-bold text-text-primary" style={{fontFamily:"'Orbitron',sans-serif"}}>Quest System</h2><p className="text-xs text-muted/60">Main chain, side quests, hidden secrets.</p></div>
          <div className="flex items-center gap-2">{cnt('quests')>0&&<span className="text-[10px] text-mystic/60">{cnt('quests')} quests</span>}<Badge done={done('quests')}/></div>
        </div>
        <GenBtn label="Quest Log" done={done('quests')} busy={busy&&curSec==='quests'} onClick={()=>void gen('quests')}/>
        {busy&&curSec==='quests'&&<StreamBox text={stream} busy/>}
        {cnt('quests')>0&&(
          <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
            {(bp!.quests as Record<string,unknown>[]).slice(0,15).map((q,i)=>{
              const tc:Record<string,string>={ main:'#ffb300',side:'#00e5ff',hidden:'#a855f7',daily:'#00e5a0',legendary:'#ff8000' };
              const t=String(q.type??'side');
              return (
                <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-border/30 bg-panel/30">
                  <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{background:tc[t]??'#4a6880'}}/>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-text-primary truncate">{String(q.title??'—')}</p>
                    <p className="text-[10px] text-muted/50 truncate">{String(q.summary??q.description??'')}</p>
                  </div>
                  <span className="text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap flex-shrink-0" style={{color:tc[t]??'#4a6880',borderColor:(tc[t]??'#4a6880')+'30'}}>{t}</span>
                </div>
              );
            })}
            {cnt('quests')>15&&<p className="text-[10px] text-muted/40 text-center">+{cnt('quests')-15} more</p>}
          </div>
        )}
      </div>
    ),

    6: (
      <div className="flex flex-col gap-4 max-w-2xl">
        <div className="flex items-center justify-between">
          <div><h2 className="text-base font-bold text-text-primary" style={{fontFamily:"'Orbitron',sans-serif"}}>Loot System</h2><p className="text-xs text-muted/60">Items, weapons, armor, consumables, legendaries.</p></div>
          <div className="flex items-center gap-2">{done('loot')&&<span className="text-[10px] text-accent/70">{(bp?.loot?.items as unknown[])?.length??0} items</span>}<Badge done={done('loot')}/></div>
        </div>
        <GenBtn label="Item Database" done={done('loot')} busy={busy&&curSec==='loot'} onClick={()=>void gen('loot')}/>
        {busy&&curSec==='loot'&&<StreamBox text={stream} busy/>}
        {done('loot')&&bp?.loot&&(
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(bp.loot.itemTiers as Record<string,unknown>[]??[]).map(t=>(
                <span key={String(t.id)} className="text-[10px] px-2 py-0.5 rounded-full border"
                  style={{color:String(t.color),borderColor:String(t.color)+'30',background:String(t.color)+'10'}}>
                  {String(t.name)} · {((t.dropMult as number)*100).toFixed(1)}%
                </span>
              ))}
            </div>
            {(bp.loot.items as Record<string,unknown>[]??[]).slice(0,20).map((item,i)=>{
              const tc:Record<string,string>={common:'#aaa',uncommon:'#1eff00',rare:'#0070dd',epic:'#a335ee',legendary:'#ff8000',artifact:'#e6cc80'};
              return (
                <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border/20 bg-base/20 text-[10px]">
                  <span className="font-bold truncate flex-1" style={{color:tc[String(item.tier??'common')]}}>{String(item.name??'—')}</span>
                  <span className="text-muted/50">{String(item.type??'')} · {String(item.subtype??'')}</span>
                  <span className="text-muted/40">⟁{String(item.value??0)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    ),

    7: (
      <div className="flex flex-col gap-4 max-w-2xl">
        <div className="flex items-center justify-between"><div><h2 className="text-base font-bold text-text-primary" style={{fontFamily:"'Orbitron',sans-serif"}}>Level Progression</h2><p className="text-xs text-muted/60">Player classes, skill trees, XP curves, base stats.</p></div><Badge done={done('levels')}/></div>
        <GenBtn label="Progression" done={done('levels')} busy={busy&&curSec==='levels'} onClick={()=>void gen('levels')}/>
        {busy&&curSec==='levels'&&<StreamBox text={stream} busy/>}
        {done('levels')&&bp?.levels&&(
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              {(['maxLevel','xpFormula'] as const).map(k=>(
                <div key={k} className="px-2.5 py-2 rounded-xl border border-border/30 bg-panel/30 text-[10px] col-span-1">
                  <p className="text-muted/50 mb-0.5 uppercase tracking-wider text-[9px]">{k}</p>
                  <p className="text-text-primary font-semibold truncate">{String((bp.levels as Record<string,unknown>)[k]??'—')}</p>
                </div>
              ))}
              <div className="px-2.5 py-2 rounded-xl border border-border/30 bg-panel/30 text-[10px]">
                <p className="text-muted/50 mb-0.5 uppercase tracking-wider text-[9px]">Slots</p>
                <p className="text-text-primary font-semibold">{(bp.levels.equipSlots as string[]??[]).length}</p>
              </div>
            </div>
            {(bp.levels.classes as Record<string,unknown>[]??[]).length>0&&(
              <div className="flex flex-wrap gap-1.5">
                {(bp.levels.classes as Record<string,unknown>[]).map((c,i)=>(
                  <span key={i} className="text-xs px-2.5 py-1 rounded-full border border-accent/25 text-accent/70 bg-accent/5">{String(c.name??c.id??'?')}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    ),

    8: (
      <div className="flex flex-col gap-4 max-w-2xl">
        <div className="flex items-center justify-between">
          <div><h2 className="text-base font-bold text-text-primary" style={{fontFamily:"'Orbitron',sans-serif"}}>World Zones</h2><p className="text-xs text-muted/60">Regions, dungeons, cities, caves, boss lairs.</p></div>
          <div className="flex items-center gap-2">{cnt('zones')>0&&<span className="text-[10px] text-success/60">{cnt('zones')} zones</span>}<Badge done={done('zones')}/></div>
        </div>
        <GenBtn label="Zone Map" done={done('zones')} busy={busy&&curSec==='zones'} onClick={()=>void gen('zones')}/>
        {busy&&curSec==='zones'&&<StreamBox text={stream} busy/>}
        {cnt('zones')>0&&(
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
            {(bp!.zones as Record<string,unknown>[]).map((z,i)=>{
              const tc:Record<string,string>={ overworld:'#00e5ff',dungeon:'#ff3d6b',city:'#ffb300',cave:'#a855f7',sky:'#00e5a0',underwater:'#0070dd' };
              const zt=String(z.type??'overworld');
              const lr=z.levelRange as Record<string,unknown>??{};
              return (
                <div key={i} className="px-3 py-2 rounded-xl border border-border/30 bg-panel/30">
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:tc[zt]??'#4a6880'}}/>
                    <p className="text-xs font-bold text-text-primary truncate flex-1">{String(z.name??'—')}</p>
                    <span className="text-[9px] text-muted/40 flex-shrink-0">Lv.{String(lr.min??1)}-{String(lr.max??10)}</span>
                  </div>
                  <p className="text-[10px] text-muted/50 truncate pl-3.5">{String(z.description??'').slice(0,60)}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    ),

    9: (
      <div className="flex flex-col gap-5 max-w-2xl items-center text-center">
        <div className="relative">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center border"
            style={{ background:`${ACCENT}12`, borderColor:`${ACCENT}30`, boxShadow:`0 0 30px ${ACCENT}15` }}>
            <Gamepad2 size={38} style={{color:ACCENT}}/>
          </div>
          <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full border-2 flex items-center justify-center text-[10px] font-bold"
            style={{ background:'#030810', borderColor:ACCENT, color:ACCENT }}>
            {Math.round((['world','story','npcs','monsters','quests','loot','levels','zones'].filter(s=>done(s)).length/8)*100)}%
          </div>
        </div>

        <div>
          <h2 className="text-xl font-bold text-text-primary" style={{fontFamily:"'Orbitron',sans-serif"}}>
            {created ? 'Blueprint Created!' : `"${name||bp?.name||'Your Game'}"`}
          </h2>
          <p className="text-sm text-muted/60 mt-1">
            {created ? 'Flow task created. Run with AI Agent to code the full game.'
              : `${['world','story','npcs','monsters','quests','loot','levels','zones'].filter(s=>done(s)).length}/8 sections ready.`}
          </p>
        </div>

        {/* Section checklist */}
        <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-2 text-left">
          {['world','story','npcs','monsters','quests','loot','levels','zones'].map(s=>(
            <div key={s} className="flex items-center gap-2 px-2.5 py-2 rounded-xl border border-border/40 bg-panel/40">
              {done(s)?<CheckCircle size={11} className="text-success flex-shrink-0"/>:<div className="w-2.5 h-2.5 rounded-full border border-border/60 flex-shrink-0"/>}
              <span className="text-[11px] font-medium text-text-primary/80 capitalize">{s}</span>
              {['npcs','monsters','quests','zones'].includes(s)&&cnt(s as keyof BP)>0&&<span className="text-[9px] text-muted/40 ml-auto">{cnt(s as keyof BP)}</span>}
            </div>
          ))}
        </div>

        {/* JSON preview */}
        {bp&&(
          <div className="w-full">
            <button onClick={()=>setJson(p=>!p)} className="flex items-center gap-1.5 text-[11px] text-muted/50 hover:text-muted transition-colors mb-2 mx-auto">
              {showJson?<EyeOff size={10}/>:<Eye size={10}/>}{showJson?'Hide':'View'} Blueprint JSON
            </button>
            {showJson&&<pre className="text-[9px] font-mono text-text-primary/40 bg-base/60 border border-border/30 rounded-xl p-3 max-h-36 overflow-y-auto text-left">{JSON.stringify({id:bp.id,name:bp.name,mode:bp.mode,sections:bp.generatedSections,npcs:cnt('npcs'),monsters:cnt('monsters'),quests:cnt('quests'),zones:cnt('zones')},null,2)}</pre>}
          </div>
        )}

        {!created?(
          <div className="flex flex-col gap-3 w-full">
            <button onClick={()=>void makeTask()} disabled={busy||!bp}
              className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl text-sm font-bold transition-all"
              style={{ background:`linear-gradient(135deg, ${ACCENT} 0%, #e67e00 100%)`, color:'#020a12', boxShadow:`0 0 20px ${ACCENT}40`, opacity:busy||!bp?0.5:1 }}>
              {busy?<Loader2 size={16} className="animate-spin"/>:<Zap size={16}/>}
              Create Game in Flow Board
            </button>
            <button onClick={()=>dispatch({ type:'SET_STAGE', stage:'voxel' as import('@/types').Stage })}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-success/30 text-success/80 hover:text-success hover:border-success/50 text-sm font-semibold transition-all">
              <Globe size={14}/>Build World in Voxel Engine
            </button>
          </div>
        ):(
          <div className="flex flex-col gap-2.5 w-full">
            <button onClick={()=>dispatch({ type:'SET_STAGE', stage:'agenthub' as import('@/types').Stage })}
              className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-bold"
              style={{ background:'rgba(168,85,247,0.15)', border:'1px solid rgba(168,85,247,0.4)', color:'#a855f7' }}>
              <Bot size={15}/>Run with Agent — Start Coding
            </button>
            <button onClick={()=>dispatch({ type:'SET_STAGE', stage:'flow' as import('@/types').Stage })}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-border/50 text-muted/70 hover:text-text-primary hover:border-accent/30 transition-all text-sm font-semibold">
              <ArrowRight size={13}/>View in Flow Board
            </button>
          </div>
        )}
      </div>
    ),
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{background:'#030810'}}>

      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b"
        style={{background:'rgba(6,15,30,0.95)',borderColor:`${ACCENT}15`,backdropFilter:'blur(12px)'}}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center border flex-shrink-0"
          style={{background:`${ACCENT}12`,borderColor:`${ACCENT}30`}}>
          <Gamepad2 size={18} style={{color:ACCENT}}/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-text-primary" style={{fontFamily:"'Orbitron',sans-serif",letterSpacing:'0.06em'}}>
              bKG Game Studio
            </h1>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-amber/30 text-amber/70">SINGLE-PLAYER</span>
          </div>
          {bp&&<p className="text-[10px] text-muted/40 truncate">Blueprint: {bp.name} · {bp.generatedSections.length}/8 sections</p>}
        </div>
        <button onClick={()=>dispatch({type:'SET_STAGE',stage:'home'})} className="text-xs text-muted/50 hover:text-muted px-2 py-1 transition-colors flex-shrink-0">← Exit</button>
      </div>

      {/* Step progress */}
      <div className="flex-shrink-0 flex items-center gap-0 px-3 py-2.5 border-b overflow-x-auto"
        style={{borderColor:`${ACCENT}10`,background:'rgba(9,22,40,0.5)'}}>
        {STEPS.map((s,i)=>{
          const Icon=s.icon, active=step===s.id, dn=step>s.id;
          const col=active?ACCENT:dn?'#00e5a0':'#0d2a40';
          return (
            <div key={s.id} className="flex items-center flex-shrink-0">
              {i>0&&<div className="w-4 h-px mx-0.5" style={{background:dn?'#00e5a060':'#0d2a40'}}/>}
              <button onClick={()=>(dn||active)&&setStep(s.id)} className="flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-lg transition-all" style={{cursor:dn?'pointer':'default'}}>
                <div className="w-5 h-5 rounded-full flex items-center justify-center border transition-all"
                  style={{background:active?`${ACCENT}20`:dn?'rgba(0,229,160,0.1)':'rgba(13,42,64,0.8)',borderColor:col,boxShadow:active?`0 0 6px ${ACCENT}40`:'none'}}>
                  {dn&&!active?<CheckCircle size={10} style={{color:'#00e5a0'}}/>:<Icon size={9} style={{color:col}}/>}
                </div>
                <span className="text-[8px] font-medium hidden sm:block" style={{color:active?ACCENT:dn?'#00e5a0':'#4a6880'}}>{s.label}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
        {err&&(
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-error/30 bg-error/8 text-error/80 text-xs mb-4">
            <AlertCircle size={13} className="flex-shrink-0"/>{err}
            <button onClick={()=>setErr('')} className="ml-auto text-error/50 hover:text-error">✕</button>
          </div>
        )}
        {steps[step]}
      </div>

      {/* Footer */}
      {step<STEPS.length-1&&(
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-t"
          style={{borderColor:`${ACCENT}10`,background:'rgba(9,22,40,0.6)'}}>
          <button onClick={()=>setStep(s=>Math.max(0,s-1))} disabled={step===0}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-muted hover:text-text-primary border border-border/50 hover:border-accent/30 rounded-xl transition-all disabled:opacity-30">
            <ChevronLeft size={12}/>Back
          </button>
          <span className="text-[10px] text-muted/40 font-mono">{step+1}/{STEPS.length}</span>
          <button
            onClick={async()=>{ if(step===0&&!bp){await ensureBp();} setStep(s=>Math.min(STEPS.length-1,s+1)); }}
            disabled={step===0&&!name.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl transition-all disabled:opacity-40"
            style={{background:`${ACCENT}12`,border:`1px solid ${ACCENT}30`,color:ACCENT}}>
            {step===STEPS.length-2?'Launch':'Next'}<ChevronRight size={12}/>
          </button>
        </div>
      )}
    </div>
  );
}
