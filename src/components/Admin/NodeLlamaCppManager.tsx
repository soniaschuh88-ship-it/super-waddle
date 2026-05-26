/**
 * src/components/Admin/NodeLlamaCppManager.tsx
 * Manage the node-llama-cpp server: GPU info, model list, pull, delete, hot-swap.
 */
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Download, Trash2, CheckCircle, Loader2, AlertCircle, Cpu, HardDrive, Activity } from 'lucide-react';
import {
  llamaCppListModels, llamaCppGetGpu, llamaCppGetHealth, llamaCppSwapModel,
  llamaCppPullModel, llamaCppDeleteModel, LLAMA_CPP_RECOMMENDED, filterByMaxSize,
  type LlamaCppModel,
} from '@/lib/llm-client';

const MAX_SIZE_B = 1.0; // default max model size in admin recommendations

const DEFAULT_URL = localStorage.getItem('bkg_llamacpp_url') ?? 'http://localhost:8001';

interface PullState { message: string; pct: number; }

export function NodeLlamaCppManager() {
  const [url, setUrl]             = useState(DEFAULT_URL);
  const [models, setModels]       = useState<LlamaCppModel[]>([]);
  const [health, setHealth]       = useState<{ status:string; modelLoaded:boolean; modelPath:string|null } | null>(null);
  const [gpu, setGpu]             = useState<{ backend:string; gpuInfo:unknown } | null>(null);
  const [loading, setLoading]     = useState(false);
  const [err, setErr]             = useState('');
  const [pulling, setPulling]     = useState<Record<string,PullState>>({});
  const [deleting, setDeleting]   = useState<Set<string>>(new Set());
  const [swapping, setSwapping]   = useState<string|null>(null);
  const [pullUri, setPullUri]     = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setErr('');
    const [m, h, g] = await Promise.all([llamaCppListModels(url), llamaCppGetHealth(url), llamaCppGetGpu(url)]);
    setModels(m); setHealth(h); setGpu(g);
    if (!h) setErr('Server unreachable — is node-llama-cpp running? cd server && node index.js');
    setLoading(false);
  }, [url]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleSwap = async (modelPath: string) => {
    setSwapping(modelPath); setErr('');
    try { await llamaCppSwapModel(url, modelPath); await refresh(); }
    catch (e) { setErr(`Swap failed: ${e instanceof Error ? e.message : 'unknown'}`); }
    setSwapping(null);
  };

  const handlePull = async (uri: string) => {
    if (!uri.trim()) return;
    setPulling(p=>({...p,[uri]:{message:'Starting…',pct:0}}));
    try {
      await llamaCppPullModel(url, uri, (msg, pct) => setPulling(p=>({...p,[uri]:{message:msg,pct}})));
      await refresh();
    } catch(e) { setPulling(p=>({...p,[uri]:{message:`Error: ${e instanceof Error?e.message:'failed'}`,pct:0}})); }
    setTimeout(()=>setPulling(p=>{const n={...p};delete n[uri];return n;}),4000);
    setPullUri('');
  };

  const handleDelete = async (filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return;
    setDeleting(d=>{const n=new Set(d);n.add(filename);return n;});
    try { await llamaCppDeleteModel(url, filename); await refresh(); }
    catch (e) { setErr(`Delete failed: ${e instanceof Error?e.message:'unknown'}`); }
    setDeleting(d=>{const n=new Set(d);n.delete(filename);return n;});
  };

  return (
    <div className="flex flex-col gap-6">
      {/* URL + refresh */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-[11px] font-semibold text-muted uppercase tracking-wider block mb-1">Server URL</label>
          <input type="url" value={url} onChange={e=>{ setUrl(e.target.value); localStorage.setItem('bkg_llamacpp_url',e.target.value); }}
            className="w-full bg-base border border-border text-text-primary text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60"/>
        </div>
        <button onClick={refresh} disabled={loading} className="mt-5 flex items-center gap-1.5 px-3 py-2 text-sm border border-border text-muted hover:text-accent hover:border-accent/40 rounded-lg transition-colors">
          <RefreshCw size={14} className={loading?'animate-spin':''}/> Refresh
        </button>
      </div>

      {err && <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-error/10 border border-error/30 text-sm text-red-400"><AlertCircle size={14}/>{err}</div>}

      {/* GPU info */}
      {gpu && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-panel p-3 flex items-center gap-2">
            <Cpu size={16} className="text-accent"/>
            <div>
              <p className="text-[11px] text-muted uppercase tracking-wider">GPU Backend</p>
              <p className="text-sm font-bold text-text-primary capitalize">{gpu.backend}</p>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-panel p-3 flex items-center gap-2">
            <Activity size={16} className={health?.modelLoaded?'text-success':'text-muted'}/>
            <div>
              <p className="text-[11px] text-muted uppercase tracking-wider">Model</p>
              <p className={`text-sm font-bold ${health?.modelLoaded?'text-success':'text-muted'}`}>
                {health?.modelLoaded ? health.modelPath?.split('/').pop() ?? 'Loaded' : 'None loaded'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Local models */}
      {models.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
            <HardDrive size={14} className="text-accent"/> Local GGUF Files ({models.length})
          </h3>
          <div className="flex flex-col gap-2">
            {models.map(m=>{
              const isActive = health?.modelPath?.endsWith(m.id);
              return (
                <div key={m.id} className={['flex items-center gap-3 px-4 py-3 rounded-lg border transition-all',
                  isActive?'border-accent/40 bg-accent/5':'border-border bg-panel'].join(' ')}>
                  {isActive?<CheckCircle size={16} className="text-accent flex-shrink-0"/>:<HardDrive size={16} className="text-muted/50 flex-shrink-0"/>}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono font-semibold text-text-primary truncate">{m.id}</p>
                    {isActive && <p className="text-[11px] text-accent">Active model</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isActive && (
                      <button onClick={()=>handleSwap(m.path)} disabled={swapping===m.path}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded-lg transition-colors">
                        {swapping===m.path?<Loader2 size={12} className="animate-spin"/>:<CheckCircle size={12}/>}
                        Load
                      </button>
                    )}
                    <button onClick={()=>handleDelete(m.id)} disabled={deleting.has(m.id)}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted hover:text-error border border-transparent hover:border-error/30 rounded-lg transition-colors">
                      {deleting.has(m.id)?<Loader2 size={12} className="animate-spin"/>:<Trash2 size={12}/>}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pull recommended */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">Pull from HuggingFace</h3>
        <p className="text-[11px] text-muted/70 mb-3">
          Uses the <code className="font-mono bg-border/60 px-1 rounded">hf:user/repo:quant</code> URI format.
          GPU auto-detected (Metal / CUDA / Vulkan / CPU).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          {filterByMaxSize(LLAMA_CPP_RECOMMENDED, MAX_SIZE_B).concat(LLAMA_CPP_RECOMMENDED.filter(m=>m.sizeB>MAX_SIZE_B)).map(m=>{
            const ps = pulling[m.uri];
            return (
              <div key={m.uri} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-panel">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary">{m.label}</p>
                  <p className="text-[11px] text-muted">{m.description}</p>
                  {ps && (
                    <div className="mt-1.5">
                      <div className="h-1 rounded-full bg-border overflow-hidden"><div className="h-full bg-accent rounded-full transition-all" style={{width:`${ps.pct}%`}}/></div>
                      <p className="text-[10px] text-muted/60 mt-0.5 font-mono truncate">{ps.message}</p>
                    </div>
                  )}
                </div>
                {!ps ? (
                  <button onClick={()=>handlePull(m.uri)} className="flex items-center gap-1 px-2.5 py-1 text-xs bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded-lg transition-colors">
                    <Download size={12}/>Pull
                  </button>
                ) : <Loader2 size={14} className="text-accent animate-spin flex-shrink-0"/>}
              </div>
            );
          })}
        </div>
        {/* Custom URI */}
        <div className="flex gap-2">
          <input value={pullUri} onChange={e=>setPullUri(e.target.value)} placeholder="hf:user/repo:quant or https://..." className="flex-1 bg-base border border-border text-text-primary text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60 placeholder:text-muted/40"/>
          <button onClick={()=>handlePull(pullUri)} disabled={!pullUri.trim()} className="flex items-center gap-1.5 px-3 py-2 text-xs bg-accent text-base hover:bg-accent-dim rounded-lg transition-colors disabled:bg-surface disabled:text-muted disabled:cursor-not-allowed">
            <Download size={12}/>Pull
          </button>
        </div>
      </div>
    </div>
  );
}
