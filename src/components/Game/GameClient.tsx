/**
 * src/components/Game/GameClient.tsx
 *
 * User-facing MMO Game Client
 * - Browse published MMO worlds
 * - See player counts, world info, blueprint stats
 * - Join button (opens MMO engine for that world)
 * - Create single-player game (links to GameWizard)
 */

import { useState, useEffect } from 'react';
import {
  Globe, Users, Sword, Map, Trophy, Loader2,
  ChevronRight, Gamepad2, Plus, RefreshCw, Radio,
  Package, TrendingUp,
} from 'lucide-react';
import { useAppState } from '@/context/AppContext';

interface World {
  id: string; name: string; genre: string; tone: string; status: string;
  npcCount: number; monsterCount: number; questCount: number; zoneCount: number;
  sections: string[]; updatedAt: number;
}

const apiH = () => {
  const h: Record<string,string> = {};
  const k = localStorage.getItem('bkg_user_api_key');
  if(k) h['Authorization'] = `Bearer ${k}`;
  return h;
};

// ── World Card ────────────────────────────────────────────────────────────────

function WorldCard({ world, onJoin }: { world: World; onJoin: ()=>void }) {
  const pct = Math.round(world.sections.length / 8 * 100);

  const GENRE_COLORS: Record<string,string> = {
    rpg:'#a855f7', fps:'#ef4444', survival:'#22c55e', horror:'#dc2626',
    'sci-fi':'#00e5ff', fantasy:'#ffb300', strategy:'#3b82f6', sandbox:'#f97316',
  };
  const color = GENRE_COLORS[world.genre] ?? '#00e5ff';

  return (
    <div className="group flex flex-col gap-4 p-5 rounded-2xl border transition-all hover:scale-[1.01]"
      style={{ borderColor:`${color}25`, background:`${color}05`, boxShadow:`0 0 0 1px ${color}15` }}>

      {/* Top row */}
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center border flex-shrink-0"
          style={{ background:`${color}12`, borderColor:`${color}30` }}>
          <Globe size={22} style={{ color }}/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-base font-bold text-text-primary truncate">{world.name}</h3>
            <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full border border-success/40 text-success/80 bg-success/10 flex-shrink-0">
              <Radio size={7} className="animate-pulse"/>LIVE
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted/60">
            <span className="capitalize">{world.genre}</span>
            <span>·</span>
            <span className="capitalize">{world.tone}</span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { icon:Users,     label:'NPCs',     val:world.npcCount    },
          { icon:Sword,     label:'Monsters', val:world.monsterCount},
          { icon:Trophy,    label:'Quests',   val:world.questCount  },
          { icon:Map,       label:'Zones',    val:world.zoneCount   },
        ].map(s=>(
          <div key={s.label} className="flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl bg-base/40 border border-border/30">
            <s.icon size={12} className="text-muted/50"/>
            <span className="text-sm font-bold text-text-primary">{s.val}</span>
            <span className="text-[9px] text-muted/40">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Completion bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-border/30 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width:`${pct}%`, background:color }}/>
        </div>
        <span className="text-[10px] text-muted/40 flex-shrink-0">{pct}% built</span>
      </div>

      {/* Join button */}
      <button onClick={onJoin}
        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm transition-all"
        style={{ background:`${color}18`, border:`1px solid ${color}40`, color }}>
        <Gamepad2 size={15}/>Enter World
        <ChevronRight size={13} className="ml-auto opacity-60"/>
      </button>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function GameClient() {
  const { dispatch }        = useAppState();
  const [worlds, setWorlds] = useState<World[]>([]);
  const [loading, setLoading]= useState(true);
  const [err,    setErr]     = useState('');

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const r = await fetch('/game/mmo/worlds', { headers: apiH() });
      if(!r.ok) throw new Error(`${r.status}`);
      const d = await r.json() as { worlds: World[] };
      setWorlds(d.worlds);
    } catch(e) { setErr(e instanceof Error ? e.message : 'Failed to load worlds'); }
    setLoading(false);
  };

  useEffect(()=>{ void load(); },[]);

  const joinWorld = (world: World) => {
    dispatch({ type:'SET_STAGE', stage:'mmo' });
    console.log('[GameClient] joining world', world.id, world.name);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background:'#030810' }}>

      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-4 border-b"
        style={{ background:'rgba(6,15,30,0.95)', borderColor:'rgba(0,229,255,0.08)', backdropFilter:'blur(12px)' }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center border flex-shrink-0"
          style={{ background:'rgba(0,229,255,0.08)', borderColor:'rgba(0,229,255,0.20)' }}>
          <Globe size={18} className="text-accent"/>
        </div>
        <div className="flex-1">
          <h1 className="text-sm font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif", letterSpacing:'0.06em' }}>
            Game Client
          </h1>
          <p className="text-[10px] text-muted/50">Live MMO worlds · {worlds.length} available</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={()=>void load()} className="text-muted/40 hover:text-muted p-1.5 transition-colors">
            <RefreshCw size={13}/>
          </button>
          <button
            onClick={()=>dispatch({ type:'SET_STAGE', stage:'game' })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber/30 text-amber/70 hover:text-amber hover:border-amber/60 text-xs font-semibold transition-all">
            <Plus size={11}/>Create Single-Player
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
        {err && (
          <div className="flex items-center gap-2 px-3 py-2.5 mb-4 rounded-xl border border-error/30 bg-error/8 text-error/80 text-xs">
            {err}
            <button onClick={()=>void load()} className="ml-auto text-error/50 hover:text-error flex items-center gap-1">
              <RefreshCw size={10}/>Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-48 gap-2 text-muted/40">
            <Loader2 size={18} className="animate-spin"/>Loading worlds…
          </div>
        ) : worlds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl border border-border/30 flex items-center justify-center">
              <Globe size={28} strokeWidth={1} className="text-muted/20"/>
            </div>
            <div>
              <p className="text-base font-bold text-text-primary/60">No live worlds yet</p>
              <p className="text-sm text-muted/40 mt-1">The admin hasn't published any MMO worlds.</p>
              <p className="text-xs text-muted/30 mt-1">Or create your own single-player game below.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={()=>dispatch({ type:'SET_STAGE', stage:'game' })}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber/30 text-amber/70 hover:text-amber text-sm font-semibold transition-all">
                <Gamepad2 size={14}/>Create Single-Player Game
              </button>
              <button onClick={()=>void load()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border/40 text-muted/60 hover:text-text-primary text-sm transition-all">
                <RefreshCw size={13}/>Refresh
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {worlds.map(w=>(
                <WorldCard key={w.id} world={w} onJoin={()=>joinWorld(w)}/>
              ))}
            </div>

            {/* Info bar */}
            <div className="mt-8 flex flex-col sm:flex-row items-center gap-4 px-5 py-4 rounded-2xl border border-border/30 bg-panel/20 text-sm text-muted/60">
              <div className="flex items-center gap-2">
                <Gamepad2 size={16} className="text-amber/60 flex-shrink-0"/>
                <span>Want to build your own game?</span>
              </div>
              <button onClick={()=>dispatch({ type:'SET_STAGE', stage:'game' })}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-amber/30 text-amber/70 hover:text-amber text-xs font-semibold transition-all ml-auto">
                <Plus size={11}/>Create Single-Player Game
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Feature tiles */}
      {!loading && worlds.length > 0 && (
        <div className="flex-shrink-0 grid grid-cols-3 gap-0 border-t border-border/30"
          style={{ background:'rgba(6,15,30,0.6)' }}>
          {[
            { icon:Package,    label:'Items & Loot',   desc:'Full loot tables' },
            { icon:TrendingUp, label:'Progression',    desc:'Classes & skills'  },
            { icon:Map,        label:'Open World',     desc:'Zones & dungeons'  },
          ].map((f,i)=>(
            <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i>0?'border-l border-border/30':''}`}>
              <f.icon size={14} className="text-accent/40 flex-shrink-0"/>
              <div>
                <p className="text-[11px] font-semibold text-text-primary/70">{f.label}</p>
                <p className="text-[10px] text-muted/40">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
