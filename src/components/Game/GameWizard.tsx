/**
 * src/components/Game/GameWizard.tsx
 *
 * bKG Game Creation Wizard
 *
 * Multi-step game design pipeline:
 *   Step 1: Engine + Genre + Tone
 *   Step 2: World Building  → AI → WORLD.md
 *   Step 3: Story Design    → AI → STORY.md
 *   Step 4: NPC Creator     → AI → NPCS.md
 *   Step 5: Quest Designer  → AI → QUESTS.md
 *   Step 6: Technical Plan  → AI → GAMEPLAN.md
 *   Step 7: Create Task → Flow → Run with Agent
 *
 * Design: Atlantis Cyberpunk with amber/gaming accent tones
 */

import { useState, useCallback } from 'react';
import {
  Gamepad2, Globe, BookOpen, Users, Sword, Cpu, Zap,
  ChevronRight, ChevronLeft, Loader2, CheckCircle,
  Plus, Trash2, ArrowRight, Bot, Sparkles,
} from 'lucide-react';
import { useAppState } from '@/context/AppContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GameGenre  { id: string; label: string; desc: string }
interface GameTone   { id: string; label: string; color: string }
interface GameEngine { id: string; label: string; lang: string; free: boolean }

interface NPC   { name: string; role: string; description: string }
interface Quest { title: string; type: 'main'|'side'|'hidden'; description: string }

interface GameDesign {
  world:  { title: string; genre: string; tone: string; concept: string; factions: string; geography: string; magicSystem: string; locations: string };
  story:  { structure: string; theme: string; protagonist: string; antagonist: string; conflict: string; openingScene: string; climax: string; ending: string };
  npcs:   { characters: NPC[] };
  quests: { quests: Quest[] };
  engine: GameEngine | null;
  docs:   { world: string; story: string; npcs: string; quests: string; gameplan: string };
}

// ── Minimal Markdown ──────────────────────────────────────────────────────────

function MarkdownPreview({ md }: { md: string }) {
  return (
    <div className="text-xs text-text-primary/70 leading-relaxed font-mono whitespace-pre-wrap max-h-64 overflow-y-auto p-3 rounded-xl border border-border/40 bg-base/60">
      {md || <span className="text-muted/30 italic">No content yet — click Generate</span>}
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────

const STEPS = [
  { id: 0, label: 'Setup',   icon: Gamepad2  },
  { id: 1, label: 'World',   icon: Globe     },
  { id: 2, label: 'Story',   icon: BookOpen  },
  { id: 3, label: 'NPCs',    icon: Users     },
  { id: 4, label: 'Quests',  icon: Sword     },
  { id: 5, label: 'Tech',    icon: Cpu       },
  { id: 6, label: 'Launch',  icon: Zap       },
];

const ACCENT = '#ffb300';  // amber — gaming accent

// ── AI generate helper ────────────────────────────────────────────────────────

async function generateDoc(endpoint: string, payload: unknown): Promise<string> {
  const userKey = localStorage.getItem('bkg_user_api_key');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userKey) headers['Authorization'] = `Bearer ${userKey}`;
  const r = await fetch(`/game/generate/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  const d = await r.json() as { doc: string };
  return d.doc;
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export function GameWizard() {
  const { dispatch } = useAppState();

  const [step,    setStep]    = useState(0);
  const [busy,    setBusy]    = useState(false);
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);

  // Config data from server
  const [genres,  setGenres]  = useState<GameGenre[]>([]);
  const [tones,   setTones]   = useState<GameTone[]>([]);
  const [engines, setEngines] = useState<GameEngine[]>([]);
  const [configLoaded, setConfigLoaded] = useState(false);

  const [design, setDesign] = useState<GameDesign>({
    world:  { title:'', genre:'rpg', tone:'heroic', concept:'', factions:'', geography:'', magicSystem:'', locations:'' },
    story:  { structure:'3-act', theme:'', protagonist:'', antagonist:'', conflict:'', openingScene:'', climax:'', ending:'' },
    npcs:   { characters:[] },
    quests: { quests:[] },
    engine: null,
    docs:   { world:'', story:'', npcs:'', quests:'', gameplan:'' },
  });

  const loadConfig = useCallback(async () => {
    if (configLoaded) return;
    const r = await fetch('/game/config').then(r => r.json()).catch(() => ({ genres:[], tones:[], engines:[] })) as { genres: GameGenre[]; tones: GameTone[]; engines: GameEngine[] };
    setGenres(r.genres);
    setTones(r.tones);
    setEngines(r.engines);
    setDesign(d => ({ ...d, engine: r.engines[0] ?? null }));
    setConfigLoaded(true);
  }, [configLoaded]);

  useState(() => { void loadConfig(); });

  const updateWorld  = (f: Partial<GameDesign['world']>)  => setDesign(d => ({ ...d, world:  { ...d.world, ...f } }));
  const updateStory  = (f: Partial<GameDesign['story']>)  => setDesign(d => ({ ...d, story:  { ...d.story, ...f } }));
  const updateNPCs   = (characters: NPC[])                 => setDesign(d => ({ ...d, npcs:   { characters } }));
  const updateQuests = (quests: Quest[])                   => setDesign(d => ({ ...d, quests: { quests } }));
  const setDoc       = (key: keyof GameDesign['docs'], val: string) =>
    setDesign(d => ({ ...d, docs: { ...d.docs, [key]: val } }));

  const generate = async (docKey: keyof GameDesign['docs'], endpoint: string, payload: unknown) => {
    setBusy(true);
    try {
      const doc = await generateDoc(endpoint, payload);
      setDoc(docKey, doc);
    } catch (e) {
      setDoc(docKey, `Error: ${e instanceof Error ? e.message : 'Generation failed'}`);
    }
    setBusy(false);
  };

  const createGameTask = async () => {
    setBusy(true);
    try {
      const userKey = localStorage.getItem('bkg_user_api_key');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (userKey) headers['Authorization'] = `Bearer ${userKey}`;
      const r = await fetch('/game/create-task', {
        method: 'POST',
        headers,
        body: JSON.stringify({ design, projectId: 'default' }),
      });
      if (r.ok) {
        const task = await r.json() as { id: string; title: string };
        setCreated(task);
      }
    } catch { /**/ }
    setBusy(false);
  };

  const runWithAgent = () => {
    dispatch({ type: 'SET_STAGE', stage: 'agenthub' });
  };

  const goToFlow = () => {
    dispatch({ type: 'SET_STAGE', stage: 'flow' });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#030810' }}>

      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b"
        style={{ background: 'rgba(6,15,30,0.95)', borderColor: `${ACCENT}15`, backdropFilter: 'blur(12px)' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center border flex-shrink-0"
          style={{ background: `${ACCENT}12`, borderColor: `${ACCENT}30` }}>
          <Gamepad2 size={18} style={{ color: ACCENT }}/>
        </div>
        <div>
          <h1 className="text-sm font-bold text-text-primary" style={{ fontFamily: "'Orbitron',sans-serif", letterSpacing:'0.06em' }}>
            bKG Game Studio
          </h1>
          <p className="text-[10px] font-mono tracking-widest uppercase" style={{ color: ACCENT + '70' }}>
            Full Game Creation Pipeline
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => dispatch({ type:'SET_STAGE', stage:'home' })}
            className="text-xs text-muted/50 hover:text-muted px-2 py-1 transition-colors">
            ← Exit
          </button>
        </div>
      </div>

      {/* Step progress */}
      <div className="flex-shrink-0 flex items-center gap-0 px-4 py-3 border-b overflow-x-auto"
        style={{ borderColor: `${ACCENT}10`, background: 'rgba(9,22,40,0.5)' }}>
        {STEPS.map((s, i) => {
          const Icon    = s.icon;
          const active  = step === s.id;
          const done    = step > s.id;
          const col     = active ? ACCENT : done ? '#00e5a0' : '#0d2a40';
          return (
            <div key={s.id} className="flex items-center">
              {i > 0 && (
                <div className="w-6 h-px mx-0.5 transition-all" style={{ background: done ? '#00e5a060' : '#0d2a40' }}/>
              )}
              <button
                onClick={() => done && setStep(s.id)}
                className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-all flex-shrink-0"
                style={{ cursor: done ? 'pointer' : 'default' }}
              >
                <div className="w-6 h-6 rounded-full flex items-center justify-center border transition-all"
                  style={{
                    background:  active ? `${ACCENT}20` : done ? 'rgba(0,229,160,0.1)' : 'rgba(13,42,64,0.8)',
                    borderColor: col,
                    boxShadow:   active ? `0 0 8px ${ACCENT}40` : 'none',
                  }}>
                  {done && !active
                    ? <CheckCircle size={12} style={{ color: '#00e5a0' }}/>
                    : <Icon size={11} style={{ color: col }}/>}
                </div>
                <span className="text-[9px] font-medium hidden sm:block" style={{ color: active ? ACCENT : done ? '#00e5a0' : '#4a6880' }}>
                  {s.label}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-5 py-5">

        {/* Step 0: Engine + Genre + Tone */}
        {step === 0 && (
          <div className="flex flex-col gap-6 max-w-2xl">
            <div>
              <h2 className="text-base font-bold text-text-primary mb-1" style={{ fontFamily:"'Orbitron',sans-serif" }}>
                Game Setup
              </h2>
              <p className="text-xs text-muted/60">Choose your game title, engine, genre, and tone.</p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">Game Title</label>
              <input value={design.world.title} onChange={e => updateWorld({ title: e.target.value })}
                placeholder="My Epic Game"
                className="bg-base/80 border border-border text-text-primary font-semibold text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-accent/40"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">Engine</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {engines.map(e => (
                  <button key={e.id} onClick={() => setDesign(d => ({ ...d, engine: e }))}
                    className="flex flex-col gap-0.5 px-3 py-2.5 rounded-xl border text-left transition-all"
                    style={{
                      background:   design.engine?.id === e.id ? `${ACCENT}10` : 'rgba(9,22,40,0.8)',
                      borderColor:  design.engine?.id === e.id ? `${ACCENT}40` : 'rgba(13,42,64,0.8)',
                      boxShadow:    design.engine?.id === e.id ? `0 0 8px ${ACCENT}20` : undefined,
                    }}>
                    <span className="text-xs font-bold" style={{ color: design.engine?.id === e.id ? ACCENT : '#e8f4f8' }}>{e.label}</span>
                    <span className="text-[10px] text-muted/50">{e.lang}</span>
                    {e.free && <span className="text-[9px] text-green-400/60">Free</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">Genre</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {genres.map(g => (
                  <button key={g.id} onClick={() => updateWorld({ genre: g.id })}
                    className="px-3 py-2 rounded-xl border text-left transition-all"
                    style={{
                      background:  design.world.genre === g.id ? `${ACCENT}10` : 'rgba(9,22,40,0.8)',
                      borderColor: design.world.genre === g.id ? `${ACCENT}35` : 'rgba(13,42,64,0.8)',
                    }}>
                    <p className="text-xs font-semibold" style={{ color: design.world.genre === g.id ? ACCENT : '#e8f4f8' }}>{g.label}</p>
                    <p className="text-[10px] text-muted/40">{g.desc.slice(0,28)}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted/60">Tone</label>
              <div className="flex flex-wrap gap-2">
                {tones.map(t => (
                  <button key={t.id} onClick={() => updateWorld({ tone: t.id })}
                    className="px-3 py-1.5 rounded-full border text-xs font-semibold transition-all"
                    style={{
                      background:  design.world.tone === t.id ? t.color + '30' : 'rgba(9,22,40,0.8)',
                      borderColor: design.world.tone === t.id ? t.color + '80' : 'rgba(13,42,64,0.8)',
                      color:       design.world.tone === t.id ? '#e8f4f8' : '#4a6880',
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 1: World Building */}
        {step === 1 && (
          <div className="flex flex-col gap-5 max-w-2xl">
            <div>
              <h2 className="text-base font-bold text-text-primary mb-1" style={{ fontFamily:"'Orbitron',sans-serif" }}>
                World Building
              </h2>
              <p className="text-xs text-muted/60">Define your game world. AI will generate a detailed WORLD.md.</p>
            </div>
            {([
              ['concept',     'World Concept',       'A world where magic is dying and technology is rising…'],
              ['geography',   'Geography',           'Three continents: northern tundra, central empire, southern jungles…'],
              ['factions',    'Factions / Groups',   'The Mage Council, The Iron Empire, The Resistance…'],
              ['magicSystem', 'Magic / Tech System', 'Magic flows through ley lines; technology drains them…'],
              ['locations',   'Key Locations',       'The Crystal Spire, The Iron Capital, The Ancient Ruins…'],
            ] as [keyof GameDesign['world'], string, string][]).map(([key, label, placeholder]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-muted/70 uppercase tracking-wider">{label}</label>
                <textarea value={design.world[key] as string}
                  onChange={e => updateWorld({ [key]: e.target.value })}
                  placeholder={placeholder}
                  rows={2}
                  className="bg-base/80 border border-border text-text-primary text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-accent/40 resize-none"
                />
              </div>
            ))}
            <button onClick={() => void generate('world', 'world', { ...design.world, title: design.world.title || 'Untitled', engine: design.engine?.label })}
              disabled={busy}
              className="flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-bold cursor-pointer transition-all"
              style={{ background: `${ACCENT}10`, borderColor: `${ACCENT}30`, color: ACCENT }}>
              {busy ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}
              {design.docs.world ? 'Regenerate WORLD.md' : 'Generate WORLD.md with AI'}
            </button>
            {design.docs.world && <MarkdownPreview md={design.docs.world.slice(0, 600) + '…'}/>}
          </div>
        )}

        {/* Step 2: Story */}
        {step === 2 && (
          <div className="flex flex-col gap-5 max-w-2xl">
            <div>
              <h2 className="text-base font-bold text-text-primary mb-1" style={{ fontFamily:"'Orbitron',sans-serif" }}>Story Design</h2>
              <p className="text-xs text-muted/60">Define your narrative arc. AI generates STORY.md.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-semibold text-muted/70 uppercase tracking-wider">Story Structure</label>
              <div className="flex gap-2 flex-wrap">
                {['3-act','5-act',"hero's journey",'non-linear','episodic'].map(s => (
                  <button key={s} onClick={() => updateStory({ structure: s })}
                    className="px-3 py-1 rounded-full border text-xs font-semibold transition-all"
                    style={{
                      background:  design.story.structure === s ? `${ACCENT}15` : 'rgba(9,22,40,0.8)',
                      borderColor: design.story.structure === s ? `${ACCENT}40` : 'rgba(13,42,64,0.8)',
                      color:       design.story.structure === s ? ACCENT : '#4a6880',
                    }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            {([
              ['theme',       'Theme',           'Redemption, sacrifice, found family…'],
              ['protagonist', 'Protagonist',     'A disgraced knight seeking redemption…'],
              ['antagonist',  'Antagonist',      'The corrupt archmage who killed the king…'],
              ['conflict',    'Core Conflict',   'Restore the magical balance before the world ends…'],
              ['climax',      'Climax',          'Final battle at the Crystal Spire…'],
              ['ending',      'Ending',          'Multiple endings based on player choices…'],
            ] as [keyof GameDesign['story'], string, string][]).map(([key, label, placeholder]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-muted/70 uppercase tracking-wider">{label}</label>
                <input value={design.story[key] as string}
                  onChange={e => updateStory({ [key]: e.target.value })}
                  placeholder={placeholder}
                  className="bg-base/80 border border-border text-text-primary text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-accent/40"
                />
              </div>
            ))}
            <button onClick={() => void generate('story', 'story', { story: design.story, world: design.world })}
              disabled={busy}
              className="flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-bold cursor-pointer transition-all"
              style={{ background: `${ACCENT}10`, borderColor: `${ACCENT}30`, color: ACCENT }}>
              {busy ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}
              {design.docs.story ? 'Regenerate STORY.md' : 'Generate STORY.md with AI'}
            </button>
            {design.docs.story && <MarkdownPreview md={design.docs.story.slice(0,600)+'…'}/>}
          </div>
        )}

        {/* Step 3: NPCs */}
        {step === 3 && (
          <div className="flex flex-col gap-5 max-w-2xl">
            <div>
              <h2 className="text-base font-bold text-text-primary mb-1" style={{ fontFamily:"'Orbitron',sans-serif" }}>NPC Creator</h2>
              <p className="text-xs text-muted/60">Add key characters. AI generates full NPC profiles in NPCS.md.</p>
            </div>
            <div className="flex flex-col gap-2">
              {design.npcs.characters.map((npc, i) => (
                <div key={i} className="flex gap-2 items-start p-3 rounded-xl border border-border/40 bg-panel/40">
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <input value={npc.name} onChange={e => {
                      const c = [...design.npcs.characters]; c[i] = { ...c[i], name: e.target.value }; updateNPCs(c);
                    }} placeholder="Name" className="bg-base/80 border border-border text-text-primary text-xs rounded-lg px-2 py-1.5 focus:outline-none"/>
                    <input value={npc.role} onChange={e => {
                      const c = [...design.npcs.characters]; c[i] = { ...c[i], role: e.target.value }; updateNPCs(c);
                    }} placeholder="Role (hero/merchant/villain…)" className="bg-base/80 border border-border text-text-primary text-xs rounded-lg px-2 py-1.5 focus:outline-none"/>
                    <input value={npc.description} onChange={e => {
                      const c = [...design.npcs.characters]; c[i] = { ...c[i], description: e.target.value }; updateNPCs(c);
                    }} placeholder="Brief description" className="bg-base/80 border border-border text-text-primary text-xs rounded-lg px-2 py-1.5 focus:outline-none col-span-2"/>
                  </div>
                  <button onClick={() => updateNPCs(design.npcs.characters.filter((_, j) => j !== i))}
                    className="text-muted/30 hover:text-error transition-colors mt-1"><Trash2 size={12}/></button>
                </div>
              ))}
              <button onClick={() => updateNPCs([...design.npcs.characters, { name:'', role:'', description:'' }])}
                className="flex items-center gap-1.5 text-xs text-accent/70 hover:text-accent transition-colors">
                <Plus size={12}/>Add NPC
              </button>
            </div>
            <button onClick={() => void generate('npcs', 'npcs', { npcs: design.npcs, world: design.world, story: design.story })}
              disabled={busy}
              className="flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-bold cursor-pointer transition-all"
              style={{ background: `${ACCENT}10`, borderColor: `${ACCENT}30`, color: ACCENT }}>
              {busy ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}
              {design.docs.npcs ? 'Regenerate NPCS.md' : 'Generate NPCS.md with AI'}
            </button>
            {design.docs.npcs && <MarkdownPreview md={design.docs.npcs.slice(0,600)+'…'}/>}
          </div>
        )}

        {/* Step 4: Quests */}
        {step === 4 && (
          <div className="flex flex-col gap-5 max-w-2xl">
            <div>
              <h2 className="text-base font-bold text-text-primary mb-1" style={{ fontFamily:"'Orbitron',sans-serif" }}>Quest Designer</h2>
              <p className="text-xs text-muted/60">Define quests. AI generates QUESTS.md + JSON data.</p>
            </div>
            <div className="flex flex-col gap-2">
              {design.quests.quests.map((q, i) => (
                <div key={i} className="flex gap-2 items-start p-3 rounded-xl border border-border/40 bg-panel/40">
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <input value={q.title} onChange={e => {
                      const qs = [...design.quests.quests]; qs[i] = { ...qs[i], title: e.target.value }; updateQuests(qs);
                    }} placeholder="Quest title" className="bg-base/80 border border-border text-text-primary text-xs rounded-lg px-2 py-1.5 focus:outline-none"/>
                    <select value={q.type} onChange={e => {
                      const qs = [...design.quests.quests]; qs[i] = { ...qs[i], type: e.target.value as Quest['type'] }; updateQuests(qs);
                    }} className="bg-base/80 border border-border text-text-primary text-xs rounded-lg px-2 py-1.5 focus:outline-none">
                      <option value="main">Main</option>
                      <option value="side">Side</option>
                      <option value="hidden">Hidden</option>
                    </select>
                    <input value={q.description} onChange={e => {
                      const qs = [...design.quests.quests]; qs[i] = { ...qs[i], description: e.target.value }; updateQuests(qs);
                    }} placeholder="Objective / description" className="bg-base/80 border border-border text-text-primary text-xs rounded-lg px-2 py-1.5 focus:outline-none col-span-2"/>
                  </div>
                  <button onClick={() => updateQuests(design.quests.quests.filter((_,j)=>j!==i))}
                    className="text-muted/30 hover:text-error transition-colors mt-1"><Trash2 size={12}/></button>
                </div>
              ))}
              <button onClick={() => updateQuests([...design.quests.quests, { title:'', type:'side', description:'' }])}
                className="flex items-center gap-1.5 text-xs text-accent/70 hover:text-accent transition-colors">
                <Plus size={12}/>Add Quest
              </button>
            </div>
            <button onClick={() => void generate('quests', 'quests', { quests: design.quests, world: design.world, story: design.story })}
              disabled={busy}
              className="flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-bold cursor-pointer transition-all"
              style={{ background: `${ACCENT}10`, borderColor: `${ACCENT}30`, color: ACCENT }}>
              {busy ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}
              {design.docs.quests ? 'Regenerate QUESTS.md' : 'Generate QUESTS.md with AI'}
            </button>
            {design.docs.quests && <MarkdownPreview md={design.docs.quests.slice(0,600)+'…'}/>}
          </div>
        )}

        {/* Step 5: Technical Plan */}
        {step === 5 && (
          <div className="flex flex-col gap-5 max-w-2xl">
            <div>
              <h2 className="text-base font-bold text-text-primary mb-1" style={{ fontFamily:"'Orbitron',sans-serif" }}>Technical Game Plan</h2>
              <p className="text-xs text-muted/60">
                AI generates the complete GAMEPLAN.md — architecture, systems, and step-by-step coding instructions for the agent.
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-panel/40 p-4 text-xs text-muted/70 leading-relaxed">
              <p className="font-bold text-text-primary/80 mb-2">This will generate:</p>
              <ul className="space-y-1 list-none">
                {['Project structure + engine setup','Entity Component System design','Core systems: physics, combat, inventory, dialogue, quests','Asset pipeline (procedural placeholders)','Save/Load system','UI: HUD, menus, dialogue, quest log','Implementation order for the coding agent'].map(item => (
                  <li key={item} className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: ACCENT }}/>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <button onClick={() => void generate('gameplan', 'gameplan', { ...design, projectTitle: design.world.title })}
              disabled={busy}
              className="flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-bold cursor-pointer transition-all"
              style={{ background: `${ACCENT}10`, borderColor: `${ACCENT}30`, color: ACCENT }}>
              {busy ? <Loader2 size={14} className="animate-spin"/> : <Cpu size={14}/>}
              {design.docs.gameplan ? 'Regenerate GAMEPLAN.md' : 'Generate Full Technical Plan'}
            </button>
            {design.docs.gameplan && <MarkdownPreview md={design.docs.gameplan.slice(0,800)+'…'}/>}
          </div>
        )}

        {/* Step 6: Launch */}
        {step === 6 && (
          <div className="flex flex-col gap-6 max-w-2xl items-center text-center">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center border"
              style={{ background: `${ACCENT}12`, borderColor: `${ACCENT}30`, boxShadow: `0 0 30px ${ACCENT}15` }}>
              <Gamepad2 size={36} style={{ color: ACCENT }}/>
            </div>
            <div>
              <h2 className="text-xl font-bold text-text-primary" style={{ fontFamily:"'Orbitron',sans-serif" }}>
                {created ? 'Game Project Created!' : 'Ready to Build'}
              </h2>
              <p className="text-sm text-muted/60 mt-2">
                {created
                  ? `"${created.title}" is now in your Flow board.`
                  : `All design documents ready. Create a Flow task to start coding "${design.world.title || 'your game'}".`}
              </p>
            </div>

            {/* Document checklist */}
            <div className="w-full grid grid-cols-2 sm:grid-cols-3 gap-2 text-left">
              {([
                ['world',    'WORLD.md',    '🌍'],
                ['story',    'STORY.md',    '📖'],
                ['npcs',     'NPCS.md',     '👥'],
                ['quests',   'QUESTS.md',   '⚔️'],
                ['gameplan', 'GAMEPLAN.md', '🛠️'],
              ] as [keyof GameDesign['docs'], string, string][]).map(([key, name, emoji]) => (
                <div key={key} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border/40 bg-panel/40">
                  <span className="text-sm">{emoji}</span>
                  <span className="text-xs font-mono text-text-primary/80">{name}</span>
                  {design.docs[key]
                    ? <CheckCircle size={11} className="text-success ml-auto flex-shrink-0"/>
                    : <div className="w-2 h-2 rounded-full bg-border ml-auto flex-shrink-0"/>}
                </div>
              ))}
            </div>

            {!created ? (
              <button onClick={createGameTask} disabled={busy}
                className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl text-sm font-bold cursor-pointer transition-all"
                style={{ background: `linear-gradient(135deg, ${ACCENT} 0%, #e67e00 100%)`, color: '#020a12', boxShadow: `0 0 20px ${ACCENT}40` }}>
                {busy ? <Loader2 size={16} className="animate-spin"/> : <Zap size={16}/>}
                Create Game Project in Flow Board
              </button>
            ) : (
              <div className="flex flex-col gap-2.5 w-full">
                <button onClick={runWithAgent}
                  className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-bold cursor-pointer transition-all"
                  style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#a855f7', boxShadow: '0 0 16px rgba(168,85,247,0.15)' }}>
                  <Bot size={15}/>Run with Agent Hub — Start Coding
                </button>
                <button onClick={goToFlow}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold border border-border/50 text-muted/70 hover:text-text-primary hover:border-accent/30 transition-all cursor-pointer">
                  <ArrowRight size={13}/>View in Flow Board
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation footer */}
      {step < 6 && (
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-t"
          style={{ borderColor: `${ACCENT}10`, background: 'rgba(9,22,40,0.6)' }}>
          <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-muted hover:text-text-primary border border-border/50 hover:border-accent/30 rounded-xl transition-all disabled:opacity-30">
            <ChevronLeft size={12}/>Back
          </button>
          <span className="text-[11px] text-muted/40 font-mono">{step + 1} / {STEPS.length}</span>
          <button onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer"
            style={{ background: `${ACCENT}12`, border: `1px solid ${ACCENT}30`, color: ACCENT }}>
            {step === STEPS.length - 2 ? 'Launch' : 'Next'}<ChevronRight size={12}/>
          </button>
        </div>
      )}
    </div>
  );
}
