/**
 * src/components/Stufe1/BackendSelector.tsx
 * Backend picker: WebGPU | Ollama | node-llama-cpp
 */
import { useState, useCallback } from 'react';
import { Cpu, Server, HardDrive, ChevronDown, ChevronUp, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useAppState } from '@/context/AppContext';
import { MODEL_OPTIONS } from '@/lib/webllm';
import { pingRestBackend, OLLAMA_POPULAR_MODELS, LLAMA_CPP_RECOMMENDED, filterByMaxSize } from '@/lib/llm-client';
import type { BackendType, BackendConfig } from '@/types';

interface Def { type: BackendType; label: string; tagline: string; icon: React.FC<{size?:number;className?:string}>; defaultUrl: string; defaultModel: string; }

const DEFS: Def[] = [
  { type:'webgpu',    label:'WebGPU',          tagline:'In-browser · no server needed · Chrome/Edge',    icon:Cpu,       defaultUrl:'',                       defaultModel:'Qwen2.5-1.5B-Instruct-q4f16_1-MLC' },
  { type:'ollama',    label:'Ollama',           tagline:'Local server · ollama pull · auto GPU',          icon:Server,    defaultUrl:'http://localhost:11434',  defaultModel:'qwen2.5:1.5b' },
  { type:'llama-cpp', label:'node-llama-cpp',   tagline:'Local server · GGUF · Metal/CUDA/Vulkan/CPU',    icon:HardDrive, defaultUrl:'http://localhost:8001',   defaultModel:'' },
];

type Ping = 'idle'|'checking'|'ok'|'fail';

export function BackendSelector() {
  const { state, dispatch } = useAppState();
  const { backendConfig } = state;
  const [expanded, setExpanded]     = useState(false);
  const [draftUrl, setDraftUrl]     = useState(backendConfig.serverUrl);
  const [draftModel, setDraftModel] = useState(backendConfig.modelId);
  const [ping, setPing]             = useState<Ping>('idle');
  const [onlySmall, setOnlySmall]   = useState(true); // ≤1B filter on by default

  const commit = useCallback((p: Partial<BackendConfig>) => {
    dispatch({ type:'SET_BACKEND', config:{ type:p.type??backendConfig.type, serverUrl:p.serverUrl??draftUrl, modelId:p.modelId??draftModel } });
  }, [backendConfig.type, draftUrl, draftModel, dispatch]);

  const selectType = (d: Def) => {
    const url   = d.type==='webgpu' ? '' : draftUrl||d.defaultUrl;
    const model = d.type==='webgpu' ? d.defaultModel : draftModel||d.defaultModel;
    setDraftUrl(url); setDraftModel(model); setPing('idle');
    dispatch({ type:'SET_BACKEND', config:{ type:d.type, serverUrl:url, modelId:model } });
  };

  const handlePing = async () => {
    if (!draftUrl.trim()) return;
    setPing('checking');
    setPing(await pingRestBackend(draftUrl) ? 'ok' : 'fail');
  };

  const active = DEFS.find(d=>d.type===backendConfig.type)!;
  const Icon = active.icon;
  const isRest = backendConfig.type !== 'webgpu';

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      {/* Collapsed bar */}
      <button onClick={()=>setExpanded(p=>!p)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-panel transition-colors">
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-accent/10 border border-accent/20">
          <Icon size={13} className="text-accent"/>
        </div>
        <span className="text-xs font-semibold text-text-primary">{active.label}</span>
        <span className="text-[11px] text-muted">{active.tagline}</span>
        <span className="ml-auto text-[10px] font-medium text-muted uppercase tracking-wider mr-1">Backend</span>
        {expanded ? <ChevronUp size={13} className="text-muted flex-shrink-0"/> : <ChevronDown size={13} className="text-muted flex-shrink-0"/>}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 flex flex-col gap-3">
          {/* Size filter toggle */}
          <div className="flex items-center gap-2">
            <button onClick={() => setOnlySmall(p => !p)}
              className={['flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors',
                onlySmall
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-base border-border text-muted hover:border-accent/30'].join(' ')}>
              {onlySmall ? '≤ 1B models' : 'All sizes'}
            </button>
            <span className="text-[11px] text-muted/50">
              {onlySmall ? 'Showing compact models only' : 'Showing all model sizes'}
            </span>
          </div>

          {/* Type pills */}
          <div className="flex gap-2 flex-wrap">
            {DEFS.map(d=>{
              const DIcon=d.icon; const a=d.type===backendConfig.type;
              return (
                <button key={d.type} onClick={()=>selectType(d)}
                  className={['flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                    a?'bg-accent/15 border-accent/50 text-accent':'bg-base border-border text-muted hover:border-accent/30 hover:text-text-primary'].join(' ')}>
                  <DIcon size={12}/>{d.label}
                </button>
              );
            })}
          </div>

          {/* WebGPU model picker */}
          {backendConfig.type==='webgpu' && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted uppercase tracking-wider">Model ({MODEL_OPTIONS.length} available)</label>
              <select value={draftModel} onChange={e=>{setDraftModel(e.target.value);commit({modelId:e.target.value});}}
                className="bg-base border border-border text-text-primary text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent/60">
                {(onlySmall ? filterByMaxSize(MODEL_OPTIONS, 1.0) : MODEL_OPTIONS).map(m=><option key={m.id} value={m.id}>{m.label} (~{m.sizeMb} MB)</option>)}
              </select>
              <p className="text-[11px] text-muted/60">{MODEL_OPTIONS.find(m=>m.id===draftModel)?.description}</p>
            </div>
          )}

          {/* Ollama model picker */}
          {backendConfig.type==='ollama' && (
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-semibold text-muted uppercase tracking-wider">Model</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {(onlySmall ? filterByMaxSize(OLLAMA_POPULAR_MODELS, 1.0) : OLLAMA_POPULAR_MODELS).map(m=>(
                  <button key={m.name} onClick={()=>{setDraftModel(m.name);commit({modelId:m.name});}}
                    className={['px-2 py-1.5 rounded-lg text-[11px] font-mono border transition-colors text-left',
                      draftModel===m.name?'bg-accent/15 border-accent/40 text-accent':'bg-base border-border text-muted hover:border-accent/30'].join(' ')}>
                    <div className="font-semibold">{m.name}</div>
                    <div className="text-muted/60 text-[10px]">{m.description}</div>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted/60">Pull models in the <a href="/admin" className="text-accent hover:underline">Admin → Ollama</a> tab.</p>
            </div>
          )}

          {/* node-llama-cpp model picker */}
          {backendConfig.type==='llama-cpp' && (
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-semibold text-muted uppercase tracking-wider">GGUF Model (server picks first available if blank)</label>
              <input type="text" value={draftModel} onChange={e=>setDraftModel(e.target.value)} onBlur={()=>commit({modelId:draftModel})}
                placeholder="Leave blank for auto, or: /path/to/model.gguf"
                className="bg-base border border-border text-text-primary text-xs font-mono rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent/60 placeholder:text-muted/40"/>
              <div className="flex flex-wrap gap-1.5">
                {(onlySmall ? filterByMaxSize(LLAMA_CPP_RECOMMENDED, 1.0) : LLAMA_CPP_RECOMMENDED).map(m=>(
                  <button key={m.uri} onClick={()=>{setDraftModel(m.uri);commit({modelId:m.uri});}}
                    title={`${m.description}\nURI: ${m.uri}`}
                    className={['px-2 py-1 rounded text-[11px] border transition-colors',
                      draftModel===m.uri?'bg-accent/15 border-accent/40 text-accent':'bg-base border-border text-muted hover:border-accent/30'].join(' ')}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted/60">Pull models in <a href="/admin" className="text-accent hover:underline">Admin → node-llama-cpp</a>.</p>
            </div>
          )}

          {/* REST fields: URL + ping */}
          {isRest && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted uppercase tracking-wider">Server URL</label>
                <input type="url" value={draftUrl} onChange={e=>{setDraftUrl(e.target.value);setPing('idle');}} onBlur={()=>commit({serverUrl:draftUrl})}
                  placeholder={active.defaultUrl}
                  className="bg-base border border-border text-text-primary text-xs font-mono rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent/60 placeholder:text-muted/40"/>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={handlePing} disabled={ping==='checking'}
                  className={['flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors',
                    ping==='ok'?'border-success/40 bg-success/10 text-green-400':ping==='fail'?'border-error/40 bg-error/10 text-red-400':ping==='checking'?'border-accent/30 bg-accent/10 text-accent cursor-wait':'border-border bg-surface text-muted hover:border-accent/30 hover:text-accent cursor-pointer'].join(' ')}>
                  {ping==='checking'&&<Loader2 size={11} className="animate-spin"/>}
                  {ping==='ok'&&<CheckCircle size={11}/>}
                  {ping==='fail'&&<XCircle size={11}/>}
                  {ping==='idle'&&<Server size={11}/>}
                  <span>{ping==='checking'?'Checking…':ping==='ok'?'Reachable':ping==='fail'?'Unreachable':'Test connection'}</span>
                </button>
                <p className="text-[11px] text-muted/60">
                  {backendConfig.type==='ollama'?'Start: ollama serve':'Start: cd server && node index.js'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
