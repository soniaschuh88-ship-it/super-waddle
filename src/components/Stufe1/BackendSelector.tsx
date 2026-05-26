/**
 * src/components/Stufe1/BackendSelector.tsx
 *
 * Backend picker with LIVE model discovery:
 *   • Ollama   → GET /api/tags  → shows only actually-installed models
 *   • llama-cpp → GET /v1/models → shows only GGUF files on disk
 *   • WebGPU   → marks cached vs needs-download with cache size indicator
 *
 * Falls back to a static recommended list when the server is unreachable.
 */
import { useState, useCallback, useEffect } from 'react';
import {
  Cpu, Server, HardDrive, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Loader2, RefreshCw, AlertTriangle,
} from 'lucide-react';
import { useAppState } from '@/context/AppContext';
import {
  MODEL_OPTIONS, DEFAULT_MODEL_ID, getCachedModelIds, isEngineLoading,
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

// ── Types ─────────────────────────────────────────────────────────────────────

interface BackendDef {
  type:         BackendType;
  label:        string;
  tagline:      string;
  icon:         React.FC<{ size?: number; className?: string }>;
  defaultUrl:   string;
  defaultModel: string;
}

const DEFS: BackendDef[] = [
  {
    type: 'webgpu', label: 'WebGPU',
    tagline: 'In-browser · no server needed · Chrome/Edge',
    icon: Cpu, defaultUrl: '', defaultModel: DEFAULT_MODEL_ID,
  },
  {
    type: 'ollama', label: 'Ollama',
    tagline: 'Local server · ollama pull · auto GPU',
    icon: Server, defaultUrl: 'http://localhost:11434', defaultModel: 'qwen2.5:1.5b',
  },
  {
    type: 'llama-cpp', label: 'node-llama-cpp',
    tagline: 'Local GGUF · server/index.js · CPU/GPU',
    icon: HardDrive, defaultUrl: 'http://localhost:8001', defaultModel: '',
  },
];

// ── Indeterminate progress bar ────────────────────────────────────────────────

function Shimmer() {
  return (
    <div className="relative h-1 rounded-full bg-border overflow-hidden">
      <div className="absolute inset-y-0 left-0 w-1/3 bg-accent/60 rounded-full animate-[shimmer_1.4s_ease-in-out_infinite]"/>
      <style>{`@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>
    </div>
  );
}

// ── Connection badge ──────────────────────────────────────────────────────────

type PingState = 'idle' | 'checking' | 'ok' | 'fail';

function ConnBadge({ state, onCheck }: { state: PingState; onCheck: () => void }) {
  return (
    <button
      onClick={onCheck}
      disabled={state === 'checking'}
      className={[
        'flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors',
        state === 'ok'       ? 'border-success/40 bg-success/10 text-green-400'
        : state === 'fail'   ? 'border-error/40 bg-error/10 text-red-400'
        : state === 'checking' ? 'border-accent/30 bg-accent/10 text-accent cursor-wait'
        : 'border-border bg-surface text-muted hover:border-accent/30 hover:text-accent cursor-pointer',
      ].join(' ')}
    >
      {state === 'checking' && <Loader2 size={11} className="animate-spin"/>}
      {state === 'ok'       && <CheckCircle size={11}/>}
      {state === 'fail'     && <XCircle size={11}/>}
      {state === 'idle'     && <Server size={11}/>}
      <span>
        {state === 'checking' ? 'Checking…'
          : state === 'ok'   ? 'Reachable'
          : state === 'fail' ? 'Unreachable — click to retry'
          : 'Test connection'}
      </span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BackendSelector() {
  const { state, dispatch } = useAppState();
  const { backendConfig } = state;

  const [expanded,    setExpanded]    = useState(false);
  const [draftUrl,    setDraftUrl]    = useState(backendConfig.serverUrl);
  const [draftModel,  setDraftModel]  = useState(backendConfig.modelId);
  const [onlySmall,   setOnlySmall]   = useState(true);
  const [ping,        setPing]        = useState<PingState>('idle');
  const [loadingModels, setLoadingModels] = useState(false);
  const [cachedIds,   setCachedIds]   = useState<string[]>([]);

  // Live model lists from running servers
  const [ollamaModels,  setOllamaModels]  = useState<string[] | null>(null); // null = not fetched
  const [llamaModels,   setLlamaModels]   = useState<string[] | null>(null);

  // ── Fetch real model lists ──────────────────────────────────────────────────

  const fetchOllamaModels = useCallback(async (url: string) => {
    setLoadingModels(true);
    const list = await ollamaListModels(url);
    setOllamaModels(list.length > 0 ? list.map(m => m.name) : []);
    setLoadingModels(false);
  }, []);

  const fetchLlamaModels = useCallback(async (url: string) => {
    setLoadingModels(true);
    const list = await llamaCppListModels(url);
    setLlamaModels(list.length > 0 ? list.map(m => m.id) : []);
    setLoadingModels(false);
  }, []);

  const fetchWebLLMCache = useCallback(async () => {
    try { setCachedIds(await getCachedModelIds()); } catch { /**/ }
  }, []);

  // Fetch when panel opens or URL changes
  useEffect(() => {
    if (!expanded) return;
    if (backendConfig.type === 'ollama')    void fetchOllamaModels(draftUrl);
    if (backendConfig.type === 'llama-cpp') void fetchLlamaModels(draftUrl);
    if (backendConfig.type === 'webgpu')    void fetchWebLLMCache();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, backendConfig.type]);

  // ── Commit helpers ──────────────────────────────────────────────────────────

  const commit = useCallback((partial: Partial<BackendConfig>) => {
    dispatch({
      type: 'SET_BACKEND',
      config: {
        type:      partial.type      ?? backendConfig.type,
        serverUrl: partial.serverUrl ?? draftUrl,
        modelId:   partial.modelId   ?? draftModel,
      },
    });
  }, [backendConfig.type, draftUrl, draftModel, dispatch]);

  const selectType = (def: BackendDef) => {
    const url   = def.type === 'webgpu' ? '' : (draftUrl || def.defaultUrl);
    const model = def.type === 'webgpu' ? def.defaultModel : (draftModel || def.defaultModel);
    setDraftUrl(url); setDraftModel(model); setPing('idle');
    setOllamaModels(null); setLlamaModels(null);
    dispatch({ type: 'SET_BACKEND', config: { type: def.type, serverUrl: url, modelId: model } });
    // Auto-fetch after type switch
    if (def.type === 'ollama')    setTimeout(() => void fetchOllamaModels(url), 100);
    if (def.type === 'llama-cpp') setTimeout(() => void fetchLlamaModels(url), 100);
    if (def.type === 'webgpu')    setTimeout(() => void fetchWebLLMCache(), 100);
  };

  const handlePing = async () => {
    if (!draftUrl.trim()) return;
    setPing('checking');
    setPing(await pingRestBackend(draftUrl) ? 'ok' : 'fail');
    // Refresh model list after successful ping
    if (backendConfig.type === 'ollama')    void fetchOllamaModels(draftUrl);
    if (backendConfig.type === 'llama-cpp') void fetchLlamaModels(draftUrl);
  };

  const refreshModels = () => {
    if (backendConfig.type === 'ollama')    void fetchOllamaModels(draftUrl);
    if (backendConfig.type === 'llama-cpp') void fetchLlamaModels(draftUrl);
    if (backendConfig.type === 'webgpu')    void fetchWebLLMCache();
  };

  // ── Derived values ──────────────────────────────────────────────────────────

  const active = DEFS.find(d => d.type === backendConfig.type)!;
  const Icon   = active.icon;
  const isRest = backendConfig.type !== 'webgpu';
  const engineLoading = isEngineLoading();

  // WebGPU: filter by size, mark cached
  const webgpuList = (onlySmall ? filterByMaxSize(MODEL_OPTIONS, 1.0) : MODEL_OPTIONS);

  // Ollama: use live list if available, else fall back to popular list
  const ollamaList: { name: string; description: string; isReal: boolean }[] =
    ollamaModels !== null
      ? ollamaModels.map(n => ({ name: n, description: 'Installed on server', isReal: true }))
      : (onlySmall ? filterByMaxSize(OLLAMA_POPULAR_MODELS, 1.0) : OLLAMA_POPULAR_MODELS)
          .map(m => ({ name: m.name, description: m.description, isReal: false }));

  const ollamaEmpty = ollamaModels !== null && ollamaModels.length === 0;

  // llama-cpp: use live list if available, else recommended
  const llamaList: { id: string; label: string; isReal: boolean }[] =
    llamaModels !== null
      ? llamaModels.map(id => ({ id, label: id, isReal: true }))
      : (onlySmall ? filterByMaxSize(LLAMA_CPP_RECOMMENDED, 1.0) : LLAMA_CPP_RECOMMENDED)
          .map(m => ({ id: m.uri, label: m.label, isReal: false }));

  const llamaEmpty = llamaModels !== null && llamaModels.length === 0;

  // Active model label for collapsed view
  const activeModelLabel =
    backendConfig.type === 'webgpu'
      ? MODEL_OPTIONS.find(m => m.id === draftModel)?.label ?? draftModel
      : draftModel || '(auto)';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">

      {/* ── Collapsed bar ── */}
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-panel transition-colors"
      >
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-accent/10 border border-accent/20">
          <Icon size={13} className={engineLoading ? 'text-accent animate-spin' : 'text-accent'}/>
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-text-primary">{active.label}</span>
          {draftModel && (
            <span className="ml-2 text-[11px] text-muted font-mono truncate">· {activeModelLabel}</span>
          )}
        </div>
        <span className="text-[10px] font-medium text-muted uppercase tracking-wider mr-1">Backend</span>
        {expanded ? <ChevronUp size={13} className="text-muted flex-shrink-0"/> : <ChevronDown size={13} className="text-muted flex-shrink-0"/>}
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
            <button
              onClick={refreshModels}
              disabled={loadingModels}
              className="text-[11px] text-muted hover:text-accent transition-colors flex items-center gap-1"
            >
              <RefreshCw size={11} className={loadingModels ? 'animate-spin' : ''}/>
              {loadingModels ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {/* Loading shimmer */}
          {loadingModels && <Shimmer/>}

          {/* Backend type pills */}
          <div className="flex gap-2 flex-wrap">
            {DEFS.map(def => {
              const DIcon = def.icon;
              const isActive = def.type === backendConfig.type;
              return (
                <button
                  key={def.type}
                  onClick={() => selectType(def)}
                  className={[
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                    isActive
                      ? 'bg-accent/15 border-accent/50 text-accent'
                      : 'bg-base border-border text-muted hover:border-accent/30 hover:text-text-primary',
                  ].join(' ')}
                >
                  <DIcon size={12}/>{def.label}
                </button>
              );
            })}
          </div>

          {/* ── WebGPU model picker ── */}
          {backendConfig.type === 'webgpu' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-muted uppercase tracking-wider">
                Model — {webgpuList.length} available
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-1">
                {webgpuList.map(m => {
                  const isCached = cachedIds.includes(m.id);
                  const isSelected = draftModel === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => { setDraftModel(m.id); commit({ modelId: m.id }); }}
                      className={[
                        'text-left px-3 py-2 rounded-lg border transition-all',
                        isSelected
                          ? 'bg-accent/15 border-accent/40'
                          : 'bg-base border-border hover:border-accent/30',
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-semibold ${isSelected ? 'text-accent' : 'text-text-primary'}`}>
                          {m.label}
                        </span>
                        {isCached && (
                          <CheckCircle size={10} className="text-success flex-shrink-0" aria-label="Cached in browser"/>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[11px] text-muted/70">{m.description}</span>
                        <span className={`text-[10px] font-mono ${isCached ? 'text-success/70' : 'text-muted/40'}`}>
                          {isCached ? '✓ cached' : `~${m.sizeMb} MB`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted/50">
                Cached models load instantly; uncached models download to browser on first use.
              </p>
            </div>
          )}

          {/* ── Ollama model picker ── */}
          {backendConfig.type === 'ollama' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-muted uppercase tracking-wider flex items-center gap-2">
                {ollamaModels !== null
                  ? <><CheckCircle size={10} className="text-success"/> {ollamaModels.length} models on server</>
                  : 'Model (popular options — connect server to see installed)'}
              </label>

              {ollamaEmpty && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-warning/30 bg-warning/5 text-xs text-yellow-400">
                  <AlertTriangle size={13}/>
                  No models installed on the Ollama server. Run{' '}
                  <code className="font-mono bg-border/60 px-1 rounded">ollama pull qwen2.5:1.5b</code>{' '}
                  or use Admin → Ollama Manager.
                </div>
              )}

              {!ollamaEmpty && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-52 overflow-y-auto pr-1">
                  {ollamaList.map(m => {
                    const isSelected = draftModel === m.name;
                    return (
                      <button
                        key={m.name}
                        onClick={() => { setDraftModel(m.name); commit({ modelId: m.name }); }}
                        className={[
                          'px-2.5 py-2 rounded-lg text-left border transition-colors',
                          isSelected
                            ? 'bg-accent/15 border-accent/40'
                            : 'bg-base border-border hover:border-accent/30',
                          !m.isReal ? 'opacity-60' : '',
                        ].join(' ')}
                      >
                        <div className="flex items-center gap-1">
                          {m.isReal && <CheckCircle size={10} className="text-success flex-shrink-0"/>}
                          <span className={`text-[11px] font-mono font-semibold truncate ${isSelected ? 'text-accent' : 'text-text-primary'}`}>
                            {m.name}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted/60 mt-0.5">{m.description}</p>
                      </button>
                    );
                  })}
                </div>
              )}

              {ollamaModels === null && !loadingModels && (
                <p className="text-[11px] text-muted/60">
                  Pull models via Admin → Ollama Manager or{' '}
                  <code className="font-mono bg-border/50 px-1 rounded text-[10px]">ollama pull &lt;name&gt;</code>.
                </p>
              )}
            </div>
          )}

          {/* ── llama-cpp model picker ── */}
          {backendConfig.type === 'llama-cpp' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-muted uppercase tracking-wider flex items-center gap-2">
                {llamaModels !== null
                  ? <><CheckCircle size={10} className="text-success"/> {llamaModels.length} GGUF files on server</>
                  : 'GGUF model (connect server to see available files)'}
              </label>

              {llamaEmpty && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-warning/30 bg-warning/5 text-xs text-yellow-400">
                  <AlertTriangle size={13}/>
                  No GGUF files found in server/models/. Pull one via Admin → Download Models or{' '}
                  <code className="font-mono bg-border/60 px-1 rounded">cd server && npm run pull hf:bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M</code>
                </div>
              )}

              {!llamaEmpty && (
                <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto pr-1">
                  {llamaList.map(m => {
                    const isSelected = draftModel === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => { setDraftModel(m.id); commit({ modelId: m.id }); }}
                        className={[
                          'flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors',
                          isSelected
                            ? 'bg-accent/15 border-accent/40'
                            : 'bg-base border-border hover:border-accent/30',
                          !m.isReal ? 'opacity-60' : '',
                        ].join(' ')}
                      >
                        {m.isReal && <CheckCircle size={11} className="text-success flex-shrink-0"/>}
                        {!m.isReal && <HardDrive size={11} className="text-muted/50 flex-shrink-0"/>}
                        <span className={`text-xs font-mono font-semibold truncate ${isSelected ? 'text-accent' : 'text-text-primary'}`}>
                          {m.label}
                        </span>
                        {!m.isReal && (
                          <span className="ml-auto text-[10px] text-muted/50 flex-shrink-0">not downloaded</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <input
                type="text"
                value={draftModel}
                onChange={e => setDraftModel(e.target.value)}
                onBlur={() => commit({ modelId: draftModel })}
                placeholder="Or type a custom model path / HF URI…"
                className="bg-base border border-border text-text-primary text-xs font-mono rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent/60 placeholder:text-muted/30"
              />
            </div>
          )}

          {/* ── REST fields + ping ── */}
          {isRest && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted uppercase tracking-wider">Server URL</label>
                <input
                  type="url"
                  value={draftUrl}
                  onChange={e => { setDraftUrl(e.target.value); setPing('idle'); setOllamaModels(null); setLlamaModels(null); }}
                  onBlur={() => commit({ serverUrl: draftUrl })}
                  placeholder={active.defaultUrl}
                  className="bg-base border border-border text-text-primary text-xs font-mono rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent/60 placeholder:text-muted/40"
                />
              </div>
              <div className="flex items-center gap-3">
                <ConnBadge state={ping} onCheck={handlePing}/>
                <p className="text-[11px] text-muted/60">
                  {backendConfig.type === 'ollama'
                    ? 'Start: ollama serve'
                    : 'Start: cd server && node index.js'}
                </p>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// end of BackendSelector
