/**
 * src/components/UserDashboard/Dashboard.tsx
 *
 * User-facing home screen — no raw server URLs anywhere.
 *
 * Sections:
 *   1. Model status cards  (WebGPU / Ollama / llama-cpp)
 *   2. Quick actions       (New Plan, Code Studio, Model Test)
 *   3. Recent projects     (last 5 from SQLite)
 *   4. Stats strip         (plans generated, backend breakdown)
 */

import { useState, useEffect } from 'react';
import {
  Cpu, Server, HardDrive,
  Plus, Code2, FlaskConical,
  CheckCircle, XCircle, Loader2, Zap,
  FolderOpen, ChevronRight, BarChart2,
} from 'lucide-react';
import { useAppState }              from '@/context/AppContext';
import { pingRestBackend,
         ollamaListModels,
         llamaCppListModels }        from '@/lib/llm-client';
import { getCachedModelIds }         from '@/lib/webllm';
import { listProjects, getStats,
         openDb }                    from '@/lib/db';
import type { Project }              from '@/types';

// ── Model status card ─────────────────────────────────────────────────────────

interface ModelStatus {
  type:    'webgpu' | 'ollama' | 'llama-cpp';
  online:  boolean | null;   // null = checking
  models:  string[];
  cached:  string[];         // webgpu: cached model ids
}

function ModelCard({
  status,
  onSelect,
  isActive,
}: {
  status:   ModelStatus;
  onSelect: () => void;
  isActive: boolean;
}) {
  const icons   = { webgpu: Cpu, ollama: Server, 'llama-cpp': HardDrive };
  const labels  = { webgpu: 'WebGPU', ollama: 'Ollama', 'llama-cpp': 'node-llama-cpp' };
  const hints   = { webgpu: 'In-browser · Chrome/Edge', ollama: 'Local server', 'llama-cpp': 'Local GGUF' };
  const Icon    = icons[status.type];
  const online  = status.online;
  const isWGPU  = status.type === 'webgpu';
  const modelCount = isWGPU ? status.cached.length : status.models.length;

  return (
    <button
      onClick={onSelect}
      className={[
        'flex flex-col gap-3 p-4 rounded-xl border text-left transition-all',
        isActive
          ? 'border-accent/50 bg-accent/8 shadow-lg'
          : online === false
          ? 'border-border bg-panel opacity-70 hover:opacity-90'
          : 'border-border bg-panel hover:border-accent/30 hover:bg-surface',
      ].join(' ')}
      style={isActive ? { background: 'rgba(0,212,170,0.06)' } : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={[
            'w-8 h-8 rounded-lg flex items-center justify-center border',
            isActive       ? 'bg-accent/20 border-accent/40'
            : online        ? 'bg-surface border-border'
            : 'bg-border/40 border-border/50',
          ].join(' ')}>
            <Icon size={16} className={isActive ? 'text-accent' : online ? 'text-text-primary' : 'text-muted/50'}/>
          </div>
          <div>
            <p className={`text-sm font-semibold ${isActive ? 'text-accent' : 'text-text-primary'}`}>
              {labels[status.type]}
            </p>
            <p className="text-[11px] text-muted/60">{hints[status.type]}</p>
          </div>
        </div>

        {/* Status indicator */}
        {online === null && <Loader2 size={14} className="text-muted/50 animate-spin"/>}
        {online === true  && <CheckCircle size={14} className="text-success"/>}
        {online === false && !isWGPU && <XCircle size={14} className="text-error/60"/>}
        {isWGPU && online === null && <Loader2 size={14} className="text-muted/50 animate-spin"/>}
      </div>

      {/* Models available */}
      {(isWGPU || online) && (
        <div className="flex flex-col gap-1">
          {isWGPU ? (
            <>
              <p className="text-[11px] text-muted/70">
                {status.cached.length > 0
                  ? `${status.cached.length} model${status.cached.length !== 1 ? 's' : ''} cached`
                  : '9 models available · click to download'}
              </p>
              {status.cached.slice(0, 3).map(id => (
                <span key={id} className="text-[10px] font-mono text-muted/50 truncate">{id.split('-Instruct')[0]}</span>
              ))}
            </>
          ) : (
            <>
              <p className="text-[11px] text-muted/70">
                {modelCount > 0
                  ? `${modelCount} model${modelCount !== 1 ? 's' : ''} ready`
                  : 'No models — pull one in Admin'}
              </p>
              {status.models.slice(0, 3).map(m => (
                <span key={m} className="text-[10px] font-mono text-muted/50 truncate">{m}</span>
              ))}
            </>
          )}
        </div>
      )}

      {!isWGPU && online === false && (
        <p className="text-[11px] text-error/60">
          Server offline — start it in <span className="font-semibold">Admin → Server Manager</span>
        </p>
      )}

      {isActive && (
        <p className="text-[10px] text-accent/70 font-semibold uppercase tracking-wider">Selected</p>
      )}
    </button>
  );
}

// ── Quick action card ─────────────────────────────────────────────────────────

function ActionCard({
  icon: Icon, label, description, accent, onClick,
}: {
  icon:        React.FC<{ size?: number; className?: string }>;
  label:       string;
  description: string;
  accent?:     boolean;
  onClick:     () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-start gap-3 p-4 rounded-xl border text-left transition-all group',
        accent
          ? 'bg-accent text-base border-accent hover:bg-accent-dim btn-glow cursor-pointer'
          : 'bg-panel border-border hover:border-accent/30 hover:bg-surface cursor-pointer',
      ].join(' ')}
    >
      <div className={[
        'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center',
        accent ? 'bg-base/20' : 'bg-surface border border-border group-hover:border-accent/30',
      ].join(' ')}>
        <Icon size={16} className={accent ? 'text-base' : 'text-muted group-hover:text-accent'}/>
      </div>
      <div>
        <p className={`text-sm font-semibold ${accent ? 'text-base' : 'text-text-primary'}`}>{label}</p>
        <p className={`text-[11px] mt-0.5 ${accent ? 'text-base/70' : 'text-muted/70'}`}>{description}</p>
      </div>
    </button>
  );
}

// ── Recent project row ────────────────────────────────────────────────────────

function ProjectRow({
  project,
  onOpen,
}: {
  project: Project;
  onOpen:  () => void;
}) {
  const features = project.proposed_features.filter(f => f.accepted).length;
  const hasCode  = !!project.generated_bundle;
  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-panel hover:border-accent/30 hover:bg-surface transition-all text-left group"
    >
      <FolderOpen size={15} className="text-muted/50 group-hover:text-accent flex-shrink-0 transition-colors"/>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary font-medium truncate">
          {project.idea_text.slice(0, 60)}{project.idea_text.length > 60 ? '…' : ''}
        </p>
        <p className="text-[11px] text-muted/60 mt-0.5">
          {features} features · {hasCode ? 'Plan generated' : 'Draft'} ·{' '}
          {new Date(project.created_at).toLocaleDateString()}
        </p>
      </div>
      <ChevronRight size={14} className="text-muted/30 group-hover:text-accent flex-shrink-0 transition-colors"/>
    </button>
  );
}

// ── Stats strip ───────────────────────────────────────────────────────────────

function StatsStrip({ total, today }: { total: number; today: number }) {
  if (!total) return null;
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg bg-panel border border-border text-[11px] text-muted">
      <BarChart2 size={13} className="text-accent/60"/>
      <span><strong className="text-text-primary tabular-nums">{total}</strong> plans generated</span>
      {today > 0 && (
        <span><strong className="text-text-primary tabular-nums">{today}</strong> today</span>
      )}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function Dashboard({ onTestModel }: { onTestModel?: () => void }) {
  const { state, dispatch } = useAppState();
  const { backendConfig }   = state;

  const [modelStatuses, setModelStatuses] = useState<ModelStatus[]>([
    { type:'webgpu',    online: null, models: [], cached: [] },
    { type:'ollama',    online: null, models: [], cached: [] },
    { type:'llama-cpp', online: null, models: [], cached: [] },
  ]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [stats,    setStats]    = useState<{ totalGenerations: number; today: number } | null>(null);

  // ── Load data on mount ──────────────────────────────────────────────────────

  useEffect(() => {
    // Load recent projects + stats from SQLite
    void (async () => {
      try {
        await openDb();
        const [recent, s] = await Promise.all([listProjects(), getStats()]);
        setProjects(recent.slice(0, 5));
        setStats(s);
      } catch { /**/ }
    })();

    // Check model availability in parallel (silently, no URLs shown)
    void (async () => {
      // WebGPU
      try {
        const cached = await getCachedModelIds();
        setModelStatuses(prev => prev.map(s =>
          s.type === 'webgpu' ? { ...s, online: true, cached } : s,
        ));
      } catch {
        setModelStatuses(prev => prev.map(s =>
          s.type === 'webgpu' ? { ...s, online: true } : s,
        ));
      }

      // Ollama (use serverUrl from config, never displayed)
      const ollamaUrl = backendConfig.type === 'ollama'
        ? backendConfig.serverUrl
        : 'http://localhost:11434';
      try {
        const ok = await pingRestBackend(ollamaUrl);
        if (ok) {
          const list = await ollamaListModels(ollamaUrl);
          setModelStatuses(prev => prev.map(s =>
            s.type === 'ollama' ? { ...s, online: true, models: list.map(m => m.name) } : s,
          ));
        } else {
          setModelStatuses(prev => prev.map(s =>
            s.type === 'ollama' ? { ...s, online: false } : s,
          ));
        }
      } catch {
        setModelStatuses(prev => prev.map(s =>
          s.type === 'ollama' ? { ...s, online: false } : s,
        ));
      }

      // llama-cpp (use serverUrl from config, never displayed)
      const llamaUrl = backendConfig.type === 'llama-cpp'
        ? backendConfig.serverUrl
        : 'http://localhost:8001';
      try {
        const ok = await pingRestBackend(llamaUrl);
        if (ok) {
          const list = await llamaCppListModels(llamaUrl);
          setModelStatuses(prev => prev.map(s =>
            s.type === 'llama-cpp' ? { ...s, online: true, models: list.map(m => m.id) } : s,
          ));
        } else {
          setModelStatuses(prev => prev.map(s =>
            s.type === 'llama-cpp' ? { ...s, online: false } : s,
          ));
        }
      } catch {
        setModelStatuses(prev => prev.map(s =>
          s.type === 'llama-cpp' ? { ...s, online: false } : s,
        ));
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Select a backend from the dashboard ────────────────────────────────────

  const selectBackend = (type: 'webgpu' | 'ollama' | 'llama-cpp') => {
    const defaults: Record<string, string> = {
      webgpu:       'Llama-3.2-1B-Instruct-q4f32_1-MLC',
      ollama:       modelStatuses.find(s=>s.type==='ollama')?.models[0] ?? 'qwen2.5:1.5b',
      'llama-cpp':  modelStatuses.find(s=>s.type==='llama-cpp')?.models[0] ?? '',
    };
    dispatch({
      type: 'SET_BACKEND',
      config: { ...backendConfig, type, modelId: defaults[type] },
    });
  };

  const goNewPlan = () => {
    dispatch({ type: 'CLEAR_PROJECT' });
    dispatch({ type: 'SET_STAGE', stage: 'stufe1' });
  };

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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-8">

      {/* Welcome headline */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">
          ICADP 3.0
        </h1>
        <p className="text-sm text-muted mt-1">
          Interactive Computer-Aided Development Plan — AI coding agent powered by local models.
        </p>
      </div>

      {/* Model status */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
            AI Backends
          </h2>
          <a href="/admin" className="text-[11px] text-muted hover:text-accent transition-colors">
            Configure in Admin →
          </a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {modelStatuses.map(s => (
            <ModelCard
              key={s.type}
              status={s}
              isActive={backendConfig.type === s.type}
              onSelect={() => selectBackend(s.type)}
            />
          ))}
        </div>
      </section>

      {/* Quick actions */}
      <section>
        <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-3">
          Get Started
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ActionCard
            icon={Plus}
            label="New Plan"
            description="Describe your idea and generate a complete plan with the AI"
            accent
            onClick={goNewPlan}
          />
          <ActionCard
            icon={Code2}
            label="Code Studio"
            description="Open the pi coding agent with real tools to implement a project"
            onClick={() => dispatch({ type: 'SET_STAGE', stage: 'stufe3' })}
          />
          <ActionCard
            icon={FlaskConical}
            label="Test Models"
            description="Chat with any available model to verify it's working correctly"
            onClick={() => onTestModel?.()}
          />
        </div>
      </section>

      {/* Recent projects */}
      {projects.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider mb-3">
            Recent Projects
          </h2>
          <div className="flex flex-col gap-2">
            {projects.map(p => (
              <ProjectRow key={p.id} project={p} onOpen={() => openProject(p)}/>
            ))}
          </div>
        </section>
      )}

      {/* Stats */}
      {stats && stats.totalGenerations > 0 && (
        <StatsStrip total={stats.totalGenerations} today={stats.today}/>
      )}

      {/* Empty state if brand new */}
      {projects.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Zap size={40} strokeWidth={1} className="text-muted/20"/>
          <p className="text-sm text-muted">No projects yet. Create your first plan above.</p>
        </div>
      )}

    </div>
  );
}
