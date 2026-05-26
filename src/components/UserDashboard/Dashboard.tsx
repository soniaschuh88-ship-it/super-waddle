/**
 * src/components/UserDashboard/Dashboard.tsx
 *
 * bKG Home Dashboard — Atlantis Cyberpunk design
 *
 * Mode-aware:
 *   PRIVATE — shows local backends (WebGPU, Ollama, node-llama-cpp)
 *   CLOUD   — shows free cloud providers (Groq, NVIDIA, OpenRouter, etc.)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Cpu, Server, HardDrive, Plus, Code2, FlaskConical, Key,
  CheckCircle, Loader2, Zap, FolderOpen, ChevronRight,
  Cloud, Lock, Globe, RefreshCw, Wifi, WifiOff, Sparkles, Gamepad2,
} from 'lucide-react';
import { useAppState }           from '@/context/AppContext';
import { pingRestBackend, ollamaListModels, llamaCppListModels } from '@/lib/llm-client';
import { getCachedModelIds }      from '@/lib/webllm';
import { openDb }                 from '@/lib/db';
import type { Project }           from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LocalModelStatus {
  type:   'webgpu' | 'ollama' | 'llama-cpp';
  online: boolean | null;
  models: string[];
  cached: string[];
}

interface CloudProviderStatus {
  id:     string;
  name:   string;
  tier:   string;
  source: string;
  hasKey: boolean;
}

// ── Local model card ──────────────────────────────────────────────────────────

function LocalModelCard({
  status, isActive, onSelect,
}: {
  status:   LocalModelStatus;
  isActive: boolean;
  onSelect: () => void;
}) {
  const META = {
    webgpu:     { label: 'WebGPU',        hint: 'In-browser', Icon: Cpu,       color: 'accent' },
    ollama:     { label: 'Ollama',         hint: 'Local API',  Icon: Server,    color: 'mystic' },
    'llama-cpp':{ label: 'llama-cpp',      hint: 'GGUF local', Icon: HardDrive, color: 'info'   },
  } as const;

  const { label, hint, Icon, color } = META[status.type];
  const isWGPU  = status.type === 'webgpu';
  const online  = status.online;
  const count   = isWGPU ? status.cached.length : status.models.length;
  const isOff   = !isWGPU && online === false;
  const checking = online === null;

  // Color maps
  const glowMap    = { accent: 'rgba(0,229,255,0.2)', mystic: 'rgba(168,85,247,0.2)', info: 'rgba(59,130,246,0.2)' };
  const colorMap   = { accent: '#00e5ff', mystic: '#a855f7', info: '#3b82f6' };
  const borderMap  = { accent: 'rgba(0,229,255,0.25)', mystic: 'rgba(168,85,247,0.25)', info: 'rgba(59,130,246,0.25)' };
  const glow       = glowMap[color];
  const col        = colorMap[color];
  const bdr        = borderMap[color];

  return (
    <button
      onClick={onSelect}
      disabled={isOff}
      className={[
        'relative flex flex-col gap-3 p-4 rounded-2xl border text-left transition-all duration-300',
        'overflow-hidden',
        isActive
          ? 'border-[var(--active-bdr)] shadow-[var(--active-glow)]'
          : isOff
          ? 'border-border/40 opacity-50 cursor-not-allowed'
          : 'border-border/60 hover:border-[var(--active-bdr)] hover:shadow-[var(--hover-glow)] cursor-pointer',
      ].join(' ')}
      style={{
        background: isActive
          ? `linear-gradient(135deg, rgba(9,22,40,0.95) 0%, rgba(6,15,30,0.98) 100%)`
          : 'rgba(9,22,40,0.7)',
        '--active-bdr': bdr,
        '--active-glow': `0 0 20px ${glow}, 0 0 40px ${glow}50`,
        '--hover-glow': `0 0 10px ${glow}80`,
        boxShadow: isActive ? `0 0 20px ${glow}, 0 0 40px ${glow}50` : undefined,
      } as React.CSSProperties}
    >
      {/* Active selection glow pulse */}
      {isActive && (
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 50% 0%, ${glow} 0%, transparent 60%)`,
            animation: 'glowPulse 3s ease-in-out infinite',
          }}
        />
      )}

      {/* Corner rune (active) */}
      {isActive && (
        <>
          <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l rounded-tl"
            style={{ borderColor: col }}/>
          <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r rounded-br"
            style={{ borderColor: col }}/>
        </>
      )}

      {/* Header row */}
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {/* Icon hex */}
          <div className={[
            'relative w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border',
            isActive ? 'bg-opacity-20' : 'bg-surface',
          ].join(' ')}
          style={{
            background: isActive ? `${glow}` : 'rgba(6,15,30,0.8)',
            borderColor: isActive ? bdr : 'rgba(13,42,64,0.8)',
            boxShadow: isActive ? `0 0 8px ${glow}` : undefined,
          }}>
            <Icon size={17} style={{ color: isActive ? col : checking ? '#4a6880' : col + 'aa' }}/>
          </div>
          <div>
            <p className="text-sm font-bold tracking-wide" style={{ color: isActive ? col : '#e8f4f8' }}>
              {label}
            </p>
            <p className="text-[10px] text-muted/60 font-mono">{hint}</p>
          </div>
        </div>

        {/* Status pill */}
        <div className={[
          'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0',
          checking      ? 'bg-muted/10 text-muted'
          : !isWGPU && isOff ? 'badge-offline'
          : 'badge-online',
        ].join(' ')}>
          {checking      ? <Loader2 size={9} className="animate-spin"/>
          : isWGPU       ? <Wifi size={9}/>
          : online        ? <Wifi size={9}/>
          : <WifiOff size={9}/>}
          {checking ? '…' : isWGPU ? 'Ready' : online ? 'Online' : 'Offline'}
        </div>
      </div>

      {/* Model list */}
      <div className="relative flex flex-col gap-1 min-h-[44px]">
        {checking && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted/50">
            <RefreshCw size={10} className="animate-spin"/>Checking…
          </div>
        )}
        {!checking && isWGPU && (
          <>
            <p className="text-[11px] text-muted/70">
              {count > 0 ? `${count} cached locally` : '9 models available'}
            </p>
            {status.cached.slice(0, 2).map(id => (
              <span key={id} className="font-mono text-[10px] truncate" style={{ color: col + '70' }}>
                {id.replace(/-MLC$/, '').split('-Instruct')[0]}
              </span>
            ))}
          </>
        )}
        {!checking && !isWGPU && online && (
          <>
            <p className="text-[11px] text-muted/70">
              {count > 0 ? `${count} model${count !== 1 ? 's' : ''} available` : 'No models installed'}
            </p>
            {status.models.slice(0, 2).map(m => (
              <span key={m} className="font-mono text-[10px] truncate" style={{ color: col + '70' }}>{m}</span>
            ))}
          </>
        )}
        {!checking && !isWGPU && isOff && (
          <p className="text-[11px] text-red-400/70">Start via <strong>Admin → Server Manager</strong></p>
        )}
      </div>

      {/* Selected indicator */}
      {isActive && (
        <div className="flex items-center gap-1 text-[10px] font-bold tracking-widest uppercase"
          style={{ color: col }}>
          <CheckCircle size={10}/>Active backend
        </div>
      )}
    </button>
  );
}

// ── Cloud provider chip ───────────────────────────────────────────────────────

const TIER_BADGE: Record<string, { label: string; cls: string }> = {
  free:     { label: '✅ Free',     cls: 'bg-success/10 text-success/80 border-success/20' },
  freemium: { label: '🔄 Freemium', cls: 'bg-accent/10 text-accent/80 border-accent/20' },
  dynamic:  { label: '🔧 Key',      cls: 'bg-info/10 text-blue-400/80 border-info/20' },
  paid:     { label: '💳 Paid',     cls: 'bg-amber/10 text-amber/80 border-amber/20' },
};

function CloudProviderCard({
  provider,
  onConfigure,
}: {
  provider:    CloudProviderStatus;
  onConfigure: () => void;
}) {
  const badge = TIER_BADGE[provider.tier] ?? TIER_BADGE.free;
  const isKey = provider.source === 'user';
  const isGlobal = provider.source === 'global' || provider.source === 'env';
  const isFree = provider.source === 'anon';

  return (
    <div
      className={[
        'relative flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all',
        provider.hasKey
          ? 'border-success/20 bg-success/3'
          : 'border-border/40 bg-panel/50',
      ].join(' ')}
      style={provider.hasKey ? { background: 'rgba(0,229,160,0.03)' } : undefined}
    >
      <div className={[
        'w-2 h-2 rounded-full flex-shrink-0',
        isFree ? 'bg-success animate-pulse'
        : isKey || isGlobal ? 'bg-success'
        : 'bg-border',
      ].join(' ')}/>

      <span className="flex-1 text-xs font-semibold text-text-primary truncate">{provider.name}</span>

      <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium flex-shrink-0 ${badge.cls}`}>
        {badge.label}
      </span>

      {!provider.hasKey && !isFree && (
        <button
          onClick={onConfigure}
          className="text-[10px] text-accent/60 hover:text-accent transition-colors flex-shrink-0"
        >
          Add key
        </button>
      )}
    </div>
  );
}

// ── Action card ───────────────────────────────────────────────────────────────

function ActionCard({
  icon: Icon, label, description, primary, color, onClick,
}: {
  icon:        React.FC<{ size?: number; className?: string; style?: React.CSSProperties }>;
  label:       string;
  description: string;
  primary?:    boolean;
  color?:      string;  // hex or rgba
  onClick:     () => void;
}) {
  const accentColor = color ?? '#00e5ff';
  return (
    <button
      onClick={onClick}
      className={[
        'group relative flex flex-col gap-3 p-4 rounded-2xl border text-left transition-all duration-300 overflow-hidden cursor-pointer',
        primary
          ? 'border-accent/40 hover:border-accent/70'
          : 'border-border/50 hover:border-accent/25',
      ].join(' ')}
      style={{
        background: primary
          ? 'linear-gradient(135deg, rgba(0,229,255,0.12) 0%, rgba(0,184,212,0.06) 100%)'
          : 'rgba(9,22,40,0.6)',
        boxShadow: primary ? '0 0 20px rgba(0,229,255,0.1)' : undefined,
      }}
    >
      {/* Ambient top gradient */}
      <div
        className="absolute inset-x-0 top-0 h-px opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: `linear-gradient(90deg, transparent, ${accentColor}50, transparent)` }}
      />

      {/* Icon */}
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center border flex-shrink-0 transition-all group-hover:scale-105"
        style={{
          background: `${accentColor}15`,
          borderColor: `${accentColor}30`,
          boxShadow: primary ? `0 0 12px ${accentColor}20` : undefined,
        }}
      >
        <Icon size={18} style={{ color: accentColor }}/>
      </div>

      <div>
        <p className={[
          'text-sm font-bold',
          primary ? 'text-accent' : 'text-text-primary',
        ].join(' ')}>
          {label}
        </p>
        <p className="text-[11px] text-muted/60 mt-0.5 leading-relaxed">{description}</p>
      </div>
    </button>
  );
}

// ── Project row ───────────────────────────────────────────────────────────────

function ProjectRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const features = project.proposed_features.filter(f => f.accepted).length;
  const hasCode  = !!project.generated_bundle;
  return (
    <button
      onClick={onOpen}
      className="group flex items-center gap-3 px-4 py-3 rounded-xl border border-border/50 bg-panel/60 hover:border-accent/25 transition-all text-left"
      style={{ backdropFilter: 'blur(4px)' }}
    >
      <FolderOpen size={14} className="text-muted/40 group-hover:text-accent flex-shrink-0 transition-colors"/>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary font-medium truncate group-hover:text-accent/90 transition-colors">
          {project.idea_text.slice(0, 60)}{project.idea_text.length > 60 ? '…' : ''}
        </p>
        <p className="text-[10px] font-mono text-muted/50 mt-0.5">
          {features} features · {hasCode ? 'Complete' : 'Draft'} · {new Date(project.created_at).toLocaleDateString()}
        </p>
      </div>
      <ChevronRight size={13} className="text-muted/20 group-hover:text-accent/60 flex-shrink-0 transition-all group-hover:translate-x-0.5"/>
    </button>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function Dashboard({
  onTestModel,
  onOpenSettings,
}: {
  onTestModel?:    () => void;
  onOpenSettings?: () => void;
}) {
  const { state, dispatch } = useAppState();
  const { backendConfig, mode } = state;
  const isPrivate = mode === 'private';

  // Local model states
  const [localStatuses, setLocalStatuses] = useState<LocalModelStatus[]>([
    { type:'webgpu',    online: null, models: [], cached: [] },
    { type:'ollama',    online: null, models: [], cached: [] },
    { type:'llama-cpp', online: null, models: [], cached: [] },
  ]);

  // Cloud provider states
  const [cloudProviders, setCloudProviders] = useState<CloudProviderStatus[]>([]);

  const [projects,    setProjects]   = useState<Project[]>([]);
  const [totalPlans,  setTotalPlans] = useState(0);
  const [refreshing,  setRefreshing] = useState(false);

  // ── Fetch local backend status ─────────────────────────────────────────────

  const checkLocalBackends = useCallback(async () => {
    setRefreshing(true);

    // WebGPU
    try {
      const cached = await getCachedModelIds();
      setLocalStatuses(p => p.map(s => s.type === 'webgpu' ? { ...s, online: true, cached } : s));
    } catch {
      setLocalStatuses(p => p.map(s => s.type === 'webgpu' ? { ...s, online: true } : s));
    }

    // All local backend calls go through the bKG server proxy — never direct localhost
    const ollamaUrl = 'http://localhost:11434';  // value used only to select which proxy endpoint
    const llamaUrl  = 'http://localhost:8001';   // pingRestBackend detects localhost and uses /api/proxy/ping

    const [ollamaOk, llamaOk] = await Promise.all([
      pingRestBackend(ollamaUrl).catch(() => false),
      pingRestBackend(llamaUrl).catch(() => false),
    ]);

    if (ollamaOk) {
      const list = await ollamaListModels(ollamaUrl).catch(() => []);
      setLocalStatuses(p => p.map(s => s.type === 'ollama' ? { ...s, online: true, models: list.map(m => m.name) } : s));
    } else {
      setLocalStatuses(p => p.map(s => s.type === 'ollama' ? { ...s, online: false } : s));
    }

    if (llamaOk) {
      const list = await llamaCppListModels(llamaUrl).catch(() => []);
      setLocalStatuses(p => p.map(s => s.type === 'llama-cpp' ? { ...s, online: true, models: list.map(m => m.id) } : s));
    } else {
      setLocalStatuses(p => p.map(s => s.type === 'llama-cpp' ? { ...s, online: false } : s));
    }

    setRefreshing(false);
  }, [backendConfig]);

  // ── Fetch cloud providers ──────────────────────────────────────────────────

  const fetchCloudProviders = useCallback(async () => {
    try {
      const r = await fetch('/providers/list');
      if (!r.ok) return;
      const d = await r.json() as { providers: CloudProviderStatus[] };
      setCloudProviders((d.providers ?? []).slice(0, 12));
    } catch { /**/ }
  }, []);

  // ── Mount ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    void checkLocalBackends();
    void fetchCloudProviders();
    void (async () => {
      try {
        await openDb();
        const { listProjects: lp, getStats } = await import('@/lib/db');
        const [recent, stats] = await Promise.all([lp(), getStats()]);
        setProjects(recent.slice(0, 5));
        setTotalPlans(stats.totalGenerations);
      } catch { /**/ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-check when mode changes
  useEffect(() => {
    if (!isPrivate) void fetchCloudProviders();
    else void checkLocalBackends();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ── Backend selection ──────────────────────────────────────────────────────

  const selectBackend = (type: 'webgpu' | 'ollama' | 'llama-cpp') => {
    const s = localStatuses.find(ms => ms.type === type);
    if (type !== 'webgpu' && s?.online === false) return;
    const defaults: Record<string, string> = {
      webgpu:       'Llama-3.2-1B-Instruct-q4f32_1-MLC',
      ollama:       localStatuses.find(ms=>ms.type==='ollama')?.models[0] ?? 'qwen2.5:1.5b',
      'llama-cpp':  localStatuses.find(ms=>ms.type==='llama-cpp')?.models[0] ?? '',
    };
    dispatch({ type: 'SET_BACKEND', config: { ...backendConfig, type, modelId: defaults[type] } });
  };

  const goNewPlan = () => { dispatch({ type: 'CLEAR_PROJECT' }); dispatch({ type: 'SET_STAGE', stage: 'stufe1' }); };

  const openProject = (project: Project) => {
    dispatch({ type: 'SET_PROJECT', project });
    if (project.generated_bundle) {
      dispatch({ type: 'SET_BUNDLE', bundle: project.generated_bundle });
      dispatch({ type: 'SET_STAGE', stage: 'stufe2' });
    } else {
      dispatch({ type: 'SET_STUFE1_STEP', step: 'features' });
      dispatch({ type: 'SET_STAGE', stage: 'stufe1' });
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative h-full overflow-y-auto">
      {/* Ambient background orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full opacity-30"
          style={{ background: 'radial-gradient(ellipse, rgba(0,229,255,0.08) 0%, transparent 70%)' }}/>
        <div className="absolute bottom-0 right-0 w-[400px] h-[300px] opacity-20"
          style={{ background: 'radial-gradient(ellipse, rgba(168,85,247,0.1) 0%, transparent 70%)' }}/>
      </div>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-8 pb-16">

        {/* ── Hero ── */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1
              className="text-3xl sm:text-4xl font-bold tracking-wider leading-none"
              style={{
                fontFamily: "'Orbitron', sans-serif",
                background: 'linear-gradient(135deg, #00e5ff 0%, #a855f7 60%, #00e5ff 100%)',
                backgroundSize: '200%',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                animation: 'gradientShift 5s ease-in-out infinite',
              }}
            >
              bKG
            </h1>
            <p className="text-[13px] text-muted/60 mt-1 font-mono tracking-widest uppercase">
              {isPrivate ? '🔒 Private · Local AI' : '☁ Cloud · Free Providers'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {totalPlans > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted/60 font-mono">
                <Sparkles size={11} className="text-accent/50"/>
                <span><strong className="text-text-primary tabular-nums">{totalPlans}</strong> plans</span>
              </div>
            )}
            <button
              onClick={goNewPlan}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm bg-accent text-base cursor-pointer btn-glow hover:brightness-110 transition-all"
            >
              <Plus size={14}/>New Plan
            </button>
          </div>
        </div>

        {/* ── Rune divider ── */}
        <div className="rune-divider"/>

        {/* ── Backend section ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {isPrivate ? <Lock size={14} className="text-amber"/> : <Cloud size={14} className="text-accent"/>}
              <h2 className="text-xs font-bold text-text-primary uppercase tracking-[0.15em]">
                {isPrivate ? 'Local AI Backends' : 'Cloud Providers'}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {isPrivate && (
                <button
                  onClick={() => void checkLocalBackends()}
                  disabled={refreshing}
                  className="text-[11px] text-muted/50 hover:text-accent transition-colors flex items-center gap-1"
                >
                  <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''}/>
                  {refreshing ? 'Checking…' : 'Refresh'}
                </button>
              )}
              <a href="/admin" className="text-[11px] text-muted/40 hover:text-accent transition-colors">
                Configure →
              </a>
            </div>
          </div>

          {isPrivate ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {localStatuses.map(s => (
                <LocalModelCard
                  key={s.type}
                  status={s}
                  isActive={backendConfig.type === s.type}
                  onSelect={() => selectBackend(s.type)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-border/50 bg-panel/40 p-4"
              style={{ backdropFilter: 'blur(8px)' }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-muted/70">
                  {cloudProviders.filter(p=>p.hasKey).length} providers configured ·{' '}
                  {cloudProviders.filter(p=>p.source==='anon').length} free (no key needed)
                </p>
                <button
                  onClick={onOpenSettings}
                  className="text-[11px] text-accent/70 hover:text-accent flex items-center gap-1 transition-colors"
                >
                  <Key size={10}/>Manage keys
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {cloudProviders.map(p => (
                  <CloudProviderCard
                    key={p.id}
                    provider={p}
                    onConfigure={() => onOpenSettings?.()}
                  />
                ))}
              </div>
              {cloudProviders.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <Globe size={32} strokeWidth={1} className="text-muted/20"/>
                  <p className="text-sm text-muted/50">Loading provider list…</p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Quick actions ── */}
        <section>
          <h2 className="text-xs font-bold text-text-primary uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
            <Zap size={12} className="text-accent"/>Quick Actions
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <ActionCard
              icon={Plus}
              label="New Plan"
              description="Generate an AI development plan from your idea"
              primary
              onClick={goNewPlan}
            />
            <ActionCard
              icon={Code2}
              label="Code Studio"
              description="Open the pi coding agent with real execution tools"
              color="#a855f7"
              onClick={() => dispatch({ type: 'SET_STAGE', stage: 'stufe3' })}
            />
            <ActionCard
              icon={FlaskConical}
              label="Test Model"
              description="Chat with any backend to verify it responds correctly"
              color="#3b82f6"
              onClick={() => onTestModel?.()}
            />
            <ActionCard
              icon={Key}
              label="My Keys"
              description={isPrivate ? 'View local backend status' : 'Configure free provider API keys'}
              color="#ffb300"
              onClick={() => onOpenSettings?.()}
            />
            <ActionCard
              icon={Gamepad2}
              label="Game Studio"
              description="Create a full production-ready game with world, story, NPCs and quests"
              color="#a855f7"
              onClick={() => dispatch({ type: 'SET_STAGE', stage: 'game' })}
            />
          </div>
        </section>

        {/* ── Recent projects ── */}
        {projects.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-text-primary uppercase tracking-[0.15em] flex items-center gap-2">
                <FolderOpen size={12} className="text-muted/50"/>Recent Projects
              </h2>
            </div>
            <div className="flex flex-col gap-2">
              {projects.map(p => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  onOpen={() => openProject(p)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {projects.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center"
              style={{
                background: 'radial-gradient(ellipse, rgba(0,229,255,0.08) 0%, transparent 70%)',
                border: '1px solid rgba(0,229,255,0.1)',
              }}
            >
              <Zap size={32} strokeWidth={1} className="text-accent/30" style={{ animation: 'float 4s ease-in-out infinite' }}/>
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary/60">No projects yet</p>
              <p className="text-xs text-muted/40 mt-1">Create your first plan to begin</p>
            </div>
            <button onClick={goNewPlan}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-accent text-base btn-glow hover:brightness-110 transition-all cursor-pointer">
              <Plus size={14}/>Start a Plan
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
