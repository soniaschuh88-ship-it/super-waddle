/**
 * src/components/Stufe1/BackendSelector.tsx
 *
 * User-facing model/backend picker.
 *
 * Deliberately hides all raw server URLs — those live exclusively in
 * Admin → Agent Settings.  Users only see:
 *   • Backend type labels  (WebGPU / Ollama / node-llama-cpp)
 *   • Model names          (pulled live from the running server)
 *   • Online / offline status
 *
 * The actual serverUrl is read from state.backendConfig (set by admin)
 * and used silently for API calls.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Cpu, Server, HardDrive,
  ChevronDown, ChevronUp,
  CheckCircle, XCircle, Loader2, RefreshCw, AlertTriangle, Wifi, WifiOff,
} from 'lucide-react';
import { useAppState } from '@/context/AppContext';
import {
  MODEL_OPTIONS, DEFAULT_MODEL_ID,
  getCachedModelIds, isEngineLoading,
} from '@/lib/webllm';
import {
  pingRestBackend,
  ollamaListModels,
  llamaCppListModels,
  OLLAMA_POPULAR_MODELS,
  LLAMA_CPP_RECOMMENDED,
  filterByMaxSize,
} from '@/lib/llm-client';
import type { BackendType, BackendConfig } from '@/types';

// ── Backend definitions (no URLs) ─────────────────────────────────────────────

interface BackendDef {
  type:    BackendType;
  label:   string;
  icon:    React.FC<{ size?: number; className?: string }>;
  hint:    string;           // shown in collapsed bar when offline
}

const DEFS: BackendDef[] = [
  { type:'webgpu',    label:'WebGPU',          icon:Cpu,       hint:'in-browser · Chrome/Edge' },
  { type:'ollama',    label:'Ollama',           icon:Server,    hint:'local server' },
  { type:'llama-cpp', label:'node-llama-cpp',   icon:HardDrive, hint:'local GGUF' },
];

// ── Shimmer (indeterminate loading bar) ───────────────────────────────────────

function Shimmer() {
  return (
    <div className="relative h-1 w-full rounded-full bg-border overflow-hidden">
      <div
        className="absolute inset-y-0 w-1/3 bg-accent/50 rounded-full"
        style={{ animation: 'shimmer 1.4s ease-in-out infinite' }}
      />
      <style>{`@keyframes shimmer{0%{left:-33%}100%{left:133%}}`}</style>
    </div>
  );
}

// ── Online badge ──────────────────────────────────────────────────────────────

function OnlineBadge({ online, loading }: { online: boolean | null; loading?: boolean }) {
  if (loading) return <Loader2 size={12} className="text-accent animate-spin"/>;
  if (online === null) return null;
  return online
    ? <Wifi size={12} className="text-success" aria-label="Server reachable"/>
    : <WifiOff size={12} className="text-error/70" aria-label="Server offline"/>;
}

// ── Main component ────────────────────────────────────────────────────────────

export function BackendSelector() {
  const { state, dispatch } = useAppState();
  const { backendConfig }   = state;

  const [expanded,      setExpanded]      = useState(false);
  const [onlySmall,     setOnlySmall]     = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [serverOnline,  setServerOnline]  = useState<boolean | null>(null);
  const [cachedIds,     setCachedIds]     = useState<string[]>([]);

  // Live model lists (null = not yet fetched)
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [llamaModels,  setLlamaModels]  = useState<string[] | null>(null);

  // ── Fetch helpers ───────────────────────────────────────────────────────────

  const checkAndFetch = useCallback(async (cfg: BackendConfig) => {
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
  }, []);

  // Fetch when expanded or backend changes
  useEffect(() => {
    if (!expanded) return;
    setOllamaModels(null); setLlamaModels(null); setServerOnline(null);
    void checkAndFetch(backendConfig);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, backendConfig.type, backendConfig.serverUrl]);

  // ── Model selection ─────────────────────────────────────────────────────────

  const setModel = (modelId: string) => {
    dispatch({
      type: 'SET_BACKEND',
      config: { ...backendConfig, modelId },
    });
  };

  const setBackendType = (type: BackendType) => {
    // Preserve serverUrl from current config; just change type + pick a sensible default model
    const defaults: Record<BackendType, string> = {
      webgpu:       DEFAULT_MODEL_ID,
      ollama:       'qwen2.5:1.5b',
      'llama-cpp':  '',
    };
    dispatch({
      type: 'SET_BACKEND',
      config: { ...backendConfig, type, modelId: defaults[type] },
    });
    setOllamaModels(null); setLlamaModels(null); setServerOnline(null);
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const active         = DEFS.find(d => d.type === backendConfig.type)!;
  const Icon           = active.icon;
  const engineLoading  = isEngineLoading();

  const webgpuList     = onlySmall
    ? filterByMaxSize(MODEL_OPTIONS, 1.0)
    : MODEL_OPTIONS;

  const ollamaDisplay: string[] =
    ollamaModels !== null && ollamaModels.length > 0
      ? ollamaModels
      : (onlySmall ? filterByMaxSize(OLLAMA_POPULAR_MODELS, 1.0) : OLLAMA_POPULAR_MODELS)
          .map(m => m.name);

  const llamaDisplay: { id: string; label: string; real: boolean }[] =
    llamaModels !== null && llamaModels.length > 0
      ? llamaModels.map(id => ({ id, label: id, real: true }))
      : (onlySmall ? filterByMaxSize(LLAMA_CPP_RECOMMENDED, 1.0) : LLAMA_CPP_RECOMMENDED)
          .map(m => ({ id: m.uri, label: m.label, real: false }));

  // Human-readable model label for the collapsed bar
  const modelLabel =
    backendConfig.type === 'webgpu'
      ? MODEL_OPTIONS.find(m => m.id === backendConfig.modelId)?.label ?? backendConfig.modelId
      : backendConfig.modelId || '(auto-detect)';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">

      {/* ── Collapsed bar ── */}
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-panel transition-colors"
      >
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-accent/10 border border-accent/20 flex-shrink-0">
          <Icon size={13} className={engineLoading ? 'text-accent animate-spin' : 'text-accent'}/>
        </div>

        {/* Backend + model label */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-xs font-semibold text-text-primary">{active.label}</span>
          {backendConfig.type !== 'webgpu' && (
            <OnlineBadge online={serverOnline} loading={loadingModels && !expanded}/>
          )}
          {backendConfig.modelId && (
            <span className="text-[11px] text-muted font-mono truncate hidden sm:inline">
              · {modelLabel}
            </span>
          )}
        </div>

        <span className="text-[10px] font-medium text-muted uppercase tracking-wider flex-shrink-0">Model</span>
        {expanded
          ? <ChevronUp  size={13} className="text-muted flex-shrink-0"/>
          : <ChevronDown size={13} className="text-muted flex-shrink-0"/>}
      </button>

      {/* ── Expanded panel ── */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 flex flex-col gap-3">

          {/* Size filter + refresh */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOnlySmall(p => !p)}
              className={[
                'flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors',
                onlySmall
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-base border-border text-muted hover:border-accent/30',
              ].join(' ')}
            >
              {onlySmall ? '≤ 1B models' : 'All sizes'}
            </button>

            {backendConfig.type !== 'webgpu' && (
              <button
                onClick={() => void checkAndFetch(backendConfig)}
                disabled={loadingModels}
                className="text-[11px] text-muted hover:text-accent transition-colors flex items-center gap-1"
              >
                <RefreshCw size={11} className={loadingModels ? 'animate-spin' : ''}/>
                {loadingModels ? 'Checking…' : 'Refresh'}
              </button>
            )}

            {/* Subtle server status — no URL shown */}
            {backendConfig.type !== 'webgpu' && serverOnline !== null && (
              <span className={`text-[11px] flex items-center gap-1 ${serverOnline ? 'text-success' : 'text-error/70'}`}>
                {serverOnline
                  ? <><CheckCircle size={10}/>Server online</>
                  : <><XCircle size={10}/>Server offline — start it in Admin</>}
              </span>
            )}
          </div>

          {/* Loading bar */}
          {loadingModels && <Shimmer/>}

          {/* ── Backend type pills ── */}
          <div className="flex gap-2 flex-wrap">
            {DEFS.map(def => {
              const DI = def.icon;
              const active_ = def.type === backendConfig.type;
              return (
                <button
                  key={def.type}
                  onClick={() => setBackendType(def.type)}
                  className={[
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                    active_
                      ? 'bg-accent/15 border-accent/50 text-accent'
                      : 'bg-base border-border text-muted hover:border-accent/30 hover:text-text-primary',
                  ].join(' ')}
                >
                  <DI size={12}/>{def.label}
                </button>
              );
            })}
          </div>

          {/* ── WebGPU model grid ── */}
          {backendConfig.type === 'webgpu' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-muted uppercase tracking-wider">
                Select model — {webgpuList.length} available
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-1">
                {webgpuList.map(m => {
                  const isCached = cachedIds.includes(m.id);
                  const sel      = backendConfig.modelId === m.id;
                  return (
                    <button key={m.id} onClick={() => setModel(m.id)}
                      className={[
                        'text-left px-3 py-2 rounded-lg border transition-all',
                        sel ? 'bg-accent/15 border-accent/40' : 'bg-base border-border hover:border-accent/30',
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-semibold ${sel ? 'text-accent' : 'text-text-primary'}`}>
                          {m.label}
                        </span>
                        {isCached && <CheckCircle size={10} className="text-success flex-shrink-0"/>}
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[10px] text-muted/70">{m.description}</span>
                        <span className={`text-[10px] font-mono ${isCached ? 'text-success/70' : 'text-muted/40'}`}>
                          {isCached ? '✓ cached' : `~${m.sizeMb} MB`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted/50">
                Cached = loads instantly. Uncached = downloads to your browser on first use.
              </p>
            </div>
          )}

          {/* ── Ollama model list ── */}
          {backendConfig.type === 'ollama' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
                {ollamaModels !== null && ollamaModels.length > 0
                  ? <><CheckCircle size={10} className="text-success"/>{ollamaModels.length} models installed</>
                  : ollamaModels !== null
                  ? 'No models installed'
                  : 'Available models'}
              </label>

              {/* Empty / offline messages */}
              {serverOnline === false && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-error/20 bg-error/5 text-xs text-red-400">
                  <WifiOff size={13} className="flex-shrink-0 mt-0.5"/>
                  <span>
                    Ollama server is not running.
                    Start it via <strong>Admin → Server Manager</strong>, then refresh.
                  </span>
                </div>
              )}
              {serverOnline && ollamaModels?.length === 0 && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-warning/20 bg-warning/5 text-xs text-yellow-400">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5"/>
                  <span>
                    No models installed. Pull one via <strong>Admin → Ollama Manager</strong>.
                  </span>
                </div>
              )}

              {/* Model buttons — only shown when server is online */}
              {serverOnline && ollamaDisplay.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-1">
                  {ollamaDisplay.map(name => {
                    const isReal = ollamaModels !== null && ollamaModels.includes(name);
                    const sel    = backendConfig.modelId === name;
                    return (
                      <button key={name} onClick={() => setModel(name)}
                        className={[
                          'flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-left transition-colors',
                          sel ? 'bg-accent/15 border-accent/40'
                            : isReal ? 'bg-base border-border hover:border-accent/30'
                            : 'bg-base border-border hover:border-accent/30 opacity-50',
                        ].join(' ')}
                      >
                        {isReal && <CheckCircle size={10} className="text-success flex-shrink-0"/>}
                        {!isReal && <HardDrive size={10} className="text-muted/40 flex-shrink-0"/>}
                        <span className={`text-[11px] font-mono font-semibold truncate ${sel ? 'text-accent' : 'text-text-primary'}`}>
                          {name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {ollamaModels === null && !loadingModels && (
                <p className="text-[11px] text-muted/50">
                  Pull models via <strong className="text-text-primary">Admin → Ollama Manager</strong>.
                </p>
              )}
            </div>
          )}

          {/* ── llama-cpp model list ── */}
          {backendConfig.type === 'llama-cpp' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
                {llamaModels !== null && llamaModels.length > 0
                  ? <><CheckCircle size={10} className="text-success"/>{llamaModels.length} GGUF files available</>
                  : llamaModels !== null ? 'No GGUF files found'
                  : 'Available models'}
              </label>

              {serverOnline === false && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-error/20 bg-error/5 text-xs text-red-400">
                  <WifiOff size={13} className="flex-shrink-0 mt-0.5"/>
                  <span>
                    node-llama-cpp server is not running.
                    Start it via <strong>Admin → Server Manager</strong>, then refresh.
                  </span>
                </div>
              )}
              {serverOnline && llamaModels?.length === 0 && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-warning/20 bg-warning/5 text-xs text-yellow-400">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5"/>
                  <span>
                    No GGUF files in server/models/.
                    Download one via <strong>Admin → Download Models</strong>.
                  </span>
                </div>
              )}

              {/* Model buttons — only shown when server is online with real models */}
              {serverOnline && llamaDisplay.filter(m => m.real).length > 0 && (
                <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                  {llamaDisplay.filter(m => m.real).map(m => {
                    const sel = backendConfig.modelId === m.id;
                    return (
                      <button key={m.id} onClick={() => setModel(m.id)}
                        className={[
                          'flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors',
                          sel ? 'bg-accent/15 border-accent/40' : 'bg-base border-border hover:border-accent/30',
                        ].join(' ')}
                      >
                        <CheckCircle size={11} className="text-success flex-shrink-0"/>
                        <span className={`text-xs font-mono font-semibold truncate flex-1 ${sel ? 'text-accent' : 'text-text-primary'}`}>
                          {m.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {llamaModels === null && !loadingModels && (
                <p className="text-[11px] text-muted/50">
                  Download GGUF files via <strong className="text-text-primary">Admin → Download Models</strong>.
                </p>
              )}
            </div>
          )}

          {/* Server config hint — points to Admin, never shows raw URL */}
          {backendConfig.type !== 'webgpu' && (
            <p className="text-[11px] text-muted/40 border-t border-border/50 pt-2">
              Server address is configured in{' '}
              <a href="/admin" className="text-accent hover:underline">Admin → Agent Settings</a>.
            </p>
          )}

        </div>
      )}
    </div>
  );
}
