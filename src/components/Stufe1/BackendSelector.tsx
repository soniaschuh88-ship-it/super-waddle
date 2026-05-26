/**
 * src/components/Stufe1/BackendSelector.tsx
 *
 * Mode-aware model/backend picker for the wizard.
 *
 * PRIVATE MODE: WebGPU / Ollama / node-llama-cpp (local only)
 *   — Only shows models from online servers
 *   — Server URLs never displayed to users
 *
 * CLOUD MODE: Free provider selection (Groq, NVIDIA, OpenRouter, etc.)
 *   — Routes through /providers/proxy on serve.js
 *   — Uses user's API keys → admin global → anon/free
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Cpu, Server, HardDrive, Cloud, Lock,
  ChevronDown, ChevronUp, CheckCircle,
  Loader2, RefreshCw, AlertTriangle, WifiOff, Wifi, Key,
} from 'lucide-react';
import { useAppState }   from '@/context/AppContext';
import {
  MODEL_OPTIONS, DEFAULT_MODEL_ID, getCachedModelIds, isEngineLoading,
} from '@/lib/webllm';
import {
  pingRestBackend, ollamaListModels, llamaCppListModels,
  OLLAMA_POPULAR_MODELS, LLAMA_CPP_RECOMMENDED, filterByMaxSize,
} from '@/lib/llm-client';
import type { BackendType, BackendConfig } from '@/types';

// ── Shimmer bar ───────────────────────────────────────────────────────────────

function Shimmer() {
  return (
    <div className="h-0.5 w-full rounded-full bg-border/40 overflow-hidden relative">
      <div className="absolute inset-y-0 w-2/5 bg-accent/40 rounded-full"
        style={{ animation: 'progressShimmer 1.4s ease-in-out infinite', left: '-40%' }}/>
    </div>
  );
}

// ── Local backend definitions ─────────────────────────────────────────────────

const LOCAL_DEFS = [
  { type: 'webgpu'    as BackendType, label: 'WebGPU',      Icon: Cpu,       color: '#00e5ff', hint: 'In-browser' },
  { type: 'ollama'    as BackendType, label: 'Ollama',       Icon: Server,    color: '#a855f7', hint: 'Local API'  },
  { type: 'llama-cpp' as BackendType, label: 'llama-cpp',    Icon: HardDrive, color: '#3b82f6', hint: 'Local GGUF' },
];

// ── Cloud provider tiers for wizard ──────────────────────────────────────────

interface ProviderDef {
  id:         string;
  name:       string;
  tier:       string;
  hasKey:     boolean;
  anonAccess: boolean;
  source:     string;
}

const DEFAULT_CLOUD_MODELS: Record<string, string> = {
  groq:          'llama-3.3-70b-versatile',
  nvidia:        'meta/llama-3.1-8b-instruct',
  openrouter:    'meta-llama/llama-3.2-1b-instruct:free',
  mistral:       'mistral-small-latest',
  sambanova:     'Meta-Llama-3.3-70B-Instruct',
  llm7:          'default',
  kilo:          'kilo-mini',
  cerebras:      'llama3.1-8b',
  together:      'meta-llama/Llama-3.2-3B-Instruct-Turbo',
};

const TIER_COLOR: Record<string, string> = {
  free:     '#00e5a0',
  freemium: '#00e5ff',
  dynamic:  '#3b82f6',
  paid:     '#ffb300',
};

// ── Main component ────────────────────────────────────────────────────────────

export function BackendSelector() {
  const { state, dispatch } = useAppState();
  const { backendConfig, mode } = state;
  const isPrivate = mode !== 'cloud';

  const [expanded,       setExpanded]       = useState(false);
  const [onlySmall,      setOnlySmall]      = useState(true);
  const [loadingModels,  setLoadingModels]  = useState(false);
  const [serverOnline,   setServerOnline]   = useState<boolean | null>(null);
  const [cachedIds,      setCachedIds]      = useState<string[]>([]);
  const [ollamaModels,   setOllamaModels]   = useState<string[] | null>(null);
  const [llamaModels,    setLlamaModels]    = useState<string[] | null>(null);
  const [cloudProviders, setCloudProviders] = useState<ProviderDef[]>([]);

  // ── Fetch helpers ──────────────────────────────────────────────────────────

  const checkAndFetch = useCallback(async (cfg: BackendConfig) => {
    if (!isPrivate) return;
    if (cfg.type === 'webgpu') {
      try { setCachedIds(await getCachedModelIds()); } catch { /**/ }
      return;
    }
    setLoadingModels(true);
    const ok = await pingRestBackend(cfg.serverUrl);
    setServerOnline(ok);
    if (ok) {
      if (cfg.type === 'ollama') {
        const list = await ollamaListModels(cfg.serverUrl);
        setOllamaModels(list.map(m => m.name));
      } else {
        const list = await llamaCppListModels(cfg.serverUrl);
        setLlamaModels(list.map(m => m.id));
      }
    } else {
      if (cfg.type === 'ollama')    setOllamaModels([]);
      if (cfg.type === 'llama-cpp') setLlamaModels([]);
    }
    setLoadingModels(false);
  }, [isPrivate]);

  const fetchCloudProviders = useCallback(async () => {
    try {
      const r = await fetch('/providers/list');
      if (!r.ok) return;
      const d = await r.json() as { providers: ProviderDef[] };
      setCloudProviders(d.providers ?? []);
    } catch { /**/ }
  }, []);

  useEffect(() => {
    if (!expanded) return;
    if (!isPrivate) {
      void fetchCloudProviders();
    } else {
      setOllamaModels(null); setLlamaModels(null); setServerOnline(null);
      void checkAndFetch(backendConfig);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, backendConfig.type, backendConfig.serverUrl, mode]);

  // ── Selection helpers ──────────────────────────────────────────────────────

  const setModel = (modelId: string) =>
    dispatch({ type: 'SET_BACKEND', config: { ...backendConfig, modelId } });

  const setLocalType = (type: BackendType) => {
    const defaults: Record<BackendType, string> = {
      webgpu:       DEFAULT_MODEL_ID,
      ollama:       ollamaModels?.[0] ?? 'qwen2.5:1.5b',
      'llama-cpp':  llamaModels?.[0] ?? '',
      cloud:        '',
    };
    dispatch({ type: 'SET_BACKEND', config: { ...backendConfig, type, modelId: defaults[type] } });
    setOllamaModels(null); setLlamaModels(null); setServerOnline(null);
  };

  const setCloudProvider = (providerId: string, modelId?: string) => {
    const model = modelId ?? DEFAULT_CLOUD_MODELS[providerId] ?? 'default';
    dispatch({
      type: 'SET_BACKEND',
      config: { ...backendConfig, type: 'cloud', modelId: `${providerId}/${model}`, providerId },
    });
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  const active         = LOCAL_DEFS.find(d => d.type === backendConfig.type);
  const engineLoading  = isEngineLoading();

  const webgpuList     = onlySmall ? filterByMaxSize(MODEL_OPTIONS, 1.0) : MODEL_OPTIONS;
  const ollamaDisplay  = ollamaModels !== null && ollamaModels.length > 0
    ? ollamaModels
    : (onlySmall ? filterByMaxSize(OLLAMA_POPULAR_MODELS, 1.0) : OLLAMA_POPULAR_MODELS).map(m => m.name);
  const llamaDisplay   = llamaModels !== null && llamaModels.length > 0
    ? llamaModels.map(id => ({ id, label: id, real: true }))
    : (onlySmall ? filterByMaxSize(LLAMA_CPP_RECOMMENDED, 1.0) : LLAMA_CPP_RECOMMENDED).map(m => ({ id: m.uri, label: m.label, real: false }));

  // Cloud label
  const cloudLabel = backendConfig.type === 'cloud'
    ? backendConfig.modelId ?? 'Select provider'
    : 'No cloud model selected';

  // Private label
  const privateLabel = backendConfig.type !== 'cloud'
    ? (backendConfig.type === 'webgpu'
        ? (MODEL_OPTIONS.find(m => m.id === backendConfig.modelId)?.label ?? backendConfig.modelId)
        : backendConfig.modelId || '(auto)')
    : '';

  const isCloud = backendConfig.type === 'cloud';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="rounded-2xl border overflow-hidden transition-all"
      style={{
        borderColor: expanded ? 'rgba(0,229,255,0.2)' : 'rgba(13,42,64,0.8)',
        background: 'rgba(6,15,30,0.85)',
        boxShadow: expanded ? '0 0 20px rgba(0,229,255,0.06)' : undefined,
      }}
    >
      {/* Collapsed bar */}
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/2 transition-colors"
      >
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 border"
          style={{
            background: 'rgba(0,229,255,0.08)',
            borderColor: 'rgba(0,229,255,0.2)',
          }}
        >
          {isPrivate
            ? <Lock size={13} className={engineLoading ? 'text-amber animate-pulse' : 'text-amber'}/>
            : <Cloud size={13} className="text-accent"/>}
        </div>

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-xs font-semibold text-text-primary">
            {isPrivate ? 'Private Mode' : 'Cloud Mode'}
          </span>
          <span className="text-[10px] font-mono text-muted/60 truncate hidden sm:inline">
            · {isPrivate ? (active?.label ?? '') + ' · ' + (privateLabel.slice(0, 32)) : cloudLabel.slice(0, 40)}
          </span>
        </div>

        <span className="text-[10px] text-muted/40 uppercase tracking-wider flex-shrink-0">Model</span>
        {expanded ? <ChevronUp size={12} className="text-muted/50 flex-shrink-0"/> : <ChevronDown size={12} className="text-muted/50 flex-shrink-0"/>}
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-accent/8 px-4 py-4 flex flex-col gap-4">

          {/* Loading bar */}
          {loadingModels && <Shimmer/>}

          {/* ── PRIVATE MODE ── */}
          {isPrivate && (
            <>
              {/* Size filter */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setOnlySmall(p => !p)}
                  className={[
                    'flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold rounded-full border transition-all',
                    onlySmall
                      ? 'bg-accent/15 border-accent/40 text-accent'
                      : 'bg-base/80 border-border text-muted hover:border-accent/30',
                  ].join(' ')}
                >
                  {onlySmall ? '≤ 1B models' : 'All sizes'}
                </button>
                {backendConfig.type !== 'webgpu' && (
                  <button
                    onClick={() => void checkAndFetch(backendConfig)}
                    disabled={loadingModels}
                    className="text-[11px] text-muted/50 hover:text-accent transition-colors flex items-center gap-1"
                  >
                    <RefreshCw size={10} className={loadingModels ? 'animate-spin' : ''}/>
                    {loadingModels ? 'Checking…' : 'Refresh'}
                  </button>
                )}
                {backendConfig.type !== 'webgpu' && serverOnline !== null && (
                  <span className={[
                    'text-[11px] flex items-center gap-1',
                    serverOnline ? 'text-success' : 'text-error/70',
                  ].join(' ')}>
                    {serverOnline ? <><Wifi size={10}/>Online</> : <><WifiOff size={10}/>Offline</>}
                  </span>
                )}
              </div>

              {/* Backend type pills */}
              <div className="flex gap-2 flex-wrap">
                {LOCAL_DEFS.map(def => {
                  const isActive = def.type === backendConfig.type;
                  return (
                    <button
                      key={def.type}
                      onClick={() => setLocalType(def.type)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all"
                      style={{
                        background: isActive ? `${def.color}15` : 'rgba(6,15,30,0.8)',
                        borderColor: isActive ? `${def.color}40` : 'rgba(13,42,64,0.8)',
                        color: isActive ? def.color : '#4a6880',
                        boxShadow: isActive ? `0 0 8px ${def.color}20` : undefined,
                      }}
                    >
                      <def.Icon size={12}/>{def.label}
                    </button>
                  );
                })}
              </div>

              {/* ── WebGPU models ── */}
              {backendConfig.type === 'webgpu' && (
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-bold text-muted/60 uppercase tracking-wider">
                    {webgpuList.length} models · {cachedIds.length} cached
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">
                    {webgpuList.map(m => {
                      const isCached = cachedIds.includes(m.id);
                      const sel      = backendConfig.modelId === m.id;
                      return (
                        <button key={m.id} onClick={() => setModel(m.id)}
                          className="text-left px-3 py-2 rounded-xl border transition-all"
                          style={{
                            background: sel ? 'rgba(0,229,255,0.08)' : 'rgba(3,8,16,0.8)',
                            borderColor: sel ? 'rgba(0,229,255,0.3)' : 'rgba(13,42,64,0.6)',
                          }}>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold" style={{ color: sel ? '#00e5ff' : '#e8f4f8' }}>
                              {m.label}
                            </span>
                            {isCached && <CheckCircle size={9} className="text-success flex-shrink-0"/>}
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[10px] text-muted/50">{m.description}</span>
                            <span className="text-[10px] font-mono" style={{ color: isCached ? '#00e5a060' : '#4a688060' }}>
                              {isCached ? '✓ cached' : `~${m.sizeMb}M`}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Ollama models ── */}
              {backendConfig.type === 'ollama' && (
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-bold text-muted/60 uppercase tracking-wider flex items-center gap-1.5">
                    {ollamaModels !== null && ollamaModels.length > 0
                      ? <><CheckCircle size={9} className="text-success"/>{ollamaModels.length} installed</>
                      : ollamaModels !== null ? 'No models installed'
                      : 'Ollama models'}
                  </label>
                  {serverOnline === false && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-error/20 bg-error/5 text-xs text-red-400/80">
                      <WifiOff size={12} className="mt-0.5 flex-shrink-0"/>
                      Ollama offline. Start via <strong>Admin → Server Manager</strong>.
                    </div>
                  )}
                  {serverOnline && ollamaModels?.length === 0 && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-warning/20 bg-warning/5 text-xs text-amber/80">
                      <AlertTriangle size={12} className="mt-0.5 flex-shrink-0"/>
                      No models. Pull one via <strong>Admin → Ollama Manager</strong>.
                    </div>
                  )}
                  {serverOnline && (ollamaModels?.length ?? 0) > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
                      {ollamaDisplay.filter(name => ollamaModels?.includes(name)).map(name => {
                        const sel = backendConfig.modelId === name;
                        return (
                          <button key={name} onClick={() => setModel(name)}
                            className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl border transition-all"
                            style={{
                              background: sel ? 'rgba(168,85,247,0.08)' : 'rgba(3,8,16,0.8)',
                              borderColor: sel ? 'rgba(168,85,247,0.3)' : 'rgba(13,42,64,0.6)',
                            }}>
                            <CheckCircle size={9} className="text-success flex-shrink-0"/>
                            <span className="text-[11px] font-mono font-semibold truncate"
                              style={{ color: sel ? '#a855f7' : '#e8f4f8' }}>
                              {name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── llama-cpp models ── */}
              {backendConfig.type === 'llama-cpp' && (
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-bold text-muted/60 uppercase tracking-wider flex items-center gap-1.5">
                    {llamaModels !== null && llamaModels.length > 0
                      ? <><CheckCircle size={9} className="text-success"/>{llamaModels.length} GGUF files</>
                      : llamaModels !== null ? 'No GGUF files'
                      : 'GGUF models'}
                  </label>
                  {serverOnline === false && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-error/20 bg-error/5 text-xs text-red-400/80">
                      <WifiOff size={12} className="mt-0.5 flex-shrink-0"/>
                      llama-cpp offline. Start via <strong>Admin → Server Manager</strong>.
                    </div>
                  )}
                  {serverOnline && llamaDisplay.filter(m => m.real).length > 0 && (
                    <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                      {llamaDisplay.filter(m => m.real).map(m => {
                        const sel = backendConfig.modelId === m.id;
                        return (
                          <button key={m.id} onClick={() => setModel(m.id)}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl border transition-all"
                            style={{
                              background: sel ? 'rgba(59,130,246,0.08)' : 'rgba(3,8,16,0.8)',
                              borderColor: sel ? 'rgba(59,130,246,0.3)' : 'rgba(13,42,64,0.6)',
                            }}>
                            <CheckCircle size={10} className="text-success flex-shrink-0"/>
                            <span className="text-xs font-mono font-semibold truncate flex-1"
                              style={{ color: sel ? '#3b82f6' : '#e8f4f8' }}>
                              {m.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Server config hint */}
              {backendConfig.type !== 'webgpu' && (
                <p className="text-[10px] text-muted/30 border-t border-accent/6 pt-2">
                  Server address configured in{' '}
                  <a href="/admin" className="text-accent/60 hover:text-accent hover:underline">Admin → Agent Settings</a>
                </p>
              )}
            </>
          )}

          {/* ── CLOUD MODE ── */}
          {!isPrivate && (
            <div className="flex flex-col gap-3">
              <p className="text-[11px] text-muted/60">
                Select a free provider. Keys are resolved: yours → admin global → anonymous.
              </p>

              {cloudProviders.length === 0 ? (
                <div className="flex items-center gap-2 text-muted/40 text-xs py-4">
                  <Loader2 size={12} className="animate-spin"/>Loading providers…
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  {cloudProviders.filter(p => p.hasKey || p.anonAccess).map(p => {
                    const isSelected = isCloud && backendConfig.modelId?.startsWith(p.id + '/');
                    const col = TIER_COLOR[p.tier] ?? '#4a6880';
                    return (
                      <button
                        key={p.id}
                        onClick={() => setCloudProvider(p.id)}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all"
                        style={{
                          background: isSelected ? `${col}10` : 'rgba(3,8,16,0.8)',
                          borderColor: isSelected ? `${col}35` : 'rgba(13,42,64,0.6)',
                          boxShadow: isSelected ? `0 0 8px ${col}20` : undefined,
                        }}
                      >
                        <div className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: p.anonAccess ? '#00e5a0' : p.hasKey ? '#00e5ff' : '#4a6880' }}/>
                        <span className="flex-1 text-xs font-semibold" style={{ color: isSelected ? col : '#e8f4f8' }}>
                          {p.name}
                        </span>
                        {p.anonAccess && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full border font-bold"
                            style={{ borderColor: '#00e5a030', color: '#00e5a0', background: '#00e5a010' }}>
                            FREE
                          </span>
                        )}
                        {p.hasKey && !p.anonAccess && (
                          <Key size={9} style={{ color: col + '80' }}/>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* No available providers */}
              {cloudProviders.length > 0 && cloudProviders.filter(p => p.hasKey || p.anonAccess).length === 0 && (
                <div className="flex items-start gap-2 px-3 py-3 rounded-xl border border-warning/20 bg-warning/5 text-xs text-amber/80">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0"/>
                  <span>
                    No configured providers. Add API keys in <a href="/#settings" className="underline">My Keys</a> or ask the admin to set global keys.
                  </span>
                </div>
              )}

              {/* Model input for selected provider */}
              {isCloud && backendConfig.modelId && (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted/50 uppercase tracking-wider">Model ID</label>
                  <input
                    type="text"
                    value={backendConfig.modelId.split('/').slice(1).join('/') || ''}
                    onChange={e => {
                      const providerId = backendConfig.modelId?.split('/')[0] ?? '';
                      setModel(`${providerId}/${e.target.value}`);
                    }}
                    placeholder="e.g. llama-3.3-70b-versatile"
                    className="bg-base/80 border border-border rounded-xl px-3 py-2 text-xs font-mono text-text-primary focus:outline-none focus:border-accent/40"
                    style={{ boxShadow: 'none' }}
                  />
                </div>
              )}

              <p className="text-[10px] text-muted/30 border-t border-accent/6 pt-2">
                Add more keys in <a href="/#settings" className="text-accent/60 hover:text-accent hover:underline">Dashboard → My Keys</a> ·
                Global fallbacks in <a href="/admin" className="text-accent/60 hover:text-accent hover:underline">Admin → Global Providers</a>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
