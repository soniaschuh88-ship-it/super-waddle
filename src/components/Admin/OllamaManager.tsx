/**
 * src/components/Admin/OllamaManager.tsx
 * Manage Ollama models: list installed, one-click pull, delete.
 */
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Download, Trash2, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { ollamaListModels, ollamaPullModel, ollamaDeleteModel, OLLAMA_POPULAR_MODELS, type OllamaModel } from '@/lib/llm-client';

const DEFAULT_URL = localStorage.getItem('bkg_ollama_url') ?? 'http://localhost:11434';

function fmtBytes(b: number): string {
  if (b<1073741824) return `${(b/1048576).toFixed(1)} MB`;
  return `${(b/1073741824).toFixed(2)} GB`;
}

interface PullState { status: string; pct: number; }

export function OllamaManager() {
  const [url, setUrl]           = useState(DEFAULT_URL);
  const [models, setModels]     = useState<OllamaModel[]>([]);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState('');
  const [pulling, setPulling]   = useState<Record<string, PullState>>({});
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true); setErr('');
    const list = await ollamaListModels(url);
    setModels(list);
    if (!list.length) setErr('No models found — is Ollama running?');
    setLoading(false);
  }, [url]);

  useEffect(() => { refresh(); }, [refresh]);

  const handlePull = async (name: string) => {
    setPulling(p=>({...p,[name]:{status:'Starting…',pct:0}}));
    try {
      await ollamaPullModel(url, name, (status,pct)=>setPulling(p=>({...p,[name]:{status,pct}})));
      await refresh();
    } catch (e) {
      setPulling(p=>({...p,[name]:{status:`Error: ${e instanceof Error?e.message:'failed'}`,pct:0}}));
    }
    setTimeout(()=>setPulling(p=>{const n={...p};delete n[name];return n;}),3000);
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete ${name}? This removes it from Ollama.`)) return;
    setDeleting(d=>{const n=new Set(d);n.add(name);return n;});
    try { await ollamaDeleteModel(url, name); await refresh(); }
    catch (e) { setErr(`Delete failed: ${e instanceof Error?e.message:'unknown'}`); }
    finally { setDeleting(d=>{const n=new Set(d);n.delete(name);return n;}); }
  };

  const installedNames = new Set(models.map(m=>m.name));

  return (
    <div className="flex flex-col gap-6">
      {/* URL config */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-[11px] font-semibold text-muted uppercase tracking-wider block mb-1">Ollama Server URL</label>
          <input type="url" value={url} onChange={e=>{ setUrl(e.target.value); localStorage.setItem('bkg_ollama_url',e.target.value); }}
            className="w-full bg-base border border-border text-text-primary text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60"/>
        </div>
        <button onClick={refresh} disabled={loading} className="mt-5 flex items-center gap-1.5 px-3 py-2 text-sm border border-border text-muted hover:text-accent hover:border-accent/40 rounded-lg transition-colors">
          <RefreshCw size={14} className={loading?'animate-spin':''}/>Refresh
        </button>
      </div>

      {err&&<div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-error/10 border border-error/30 text-sm text-red-400"><AlertCircle size={14}/>{err}</div>}

      {/* Installed models */}
      {models.length>0&&(
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-3">Installed ({models.length})</h3>
          <div className="flex flex-col gap-2">
            {models.map(m=>(
              <div key={m.name} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-panel">
                <CheckCircle size={16} className="text-success flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono font-semibold text-text-primary truncate">{m.name}</p>
                  <p className="text-[11px] text-muted">{fmtBytes(m.size)} · updated {new Date(m.modified_at).toLocaleDateString()}</p>
                </div>
                <button onClick={()=>handleDelete(m.name)} disabled={deleting.has(m.name)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted hover:text-error border border-transparent hover:border-error/30 rounded-lg transition-colors">
                  {deleting.has(m.name)?<Loader2 size={13} className="animate-spin"/>:<Trash2 size={13}/>}
                  <span>Delete</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Popular models to pull */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-3">Popular Models</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {OLLAMA_POPULAR_MODELS.map(m=>{
            const installed=installedNames.has(m.name);
            const pullState=pulling[m.name];
            return (
              <div key={m.name} className={['flex items-center gap-3 px-4 py-3 rounded-lg border transition-all',installed?'border-success/30 bg-success/5':'border-border bg-panel'].join(' ')}>
                {installed?<CheckCircle size={16} className="text-success flex-shrink-0"/>:<Download size={16} className="text-muted/50 flex-shrink-0"/>}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono font-semibold text-text-primary truncate">{m.name}</p>
                  <p className="text-[11px] text-muted">{m.description}</p>
                  {pullState&&(
                    <div className="mt-1.5">
                      <div className="h-1 rounded-full bg-border overflow-hidden"><div className="h-full bg-accent rounded-full transition-all" style={{width:`${pullState.pct}%`}}/></div>
                      <p className="text-[10px] text-muted/60 mt-0.5 font-mono truncate">{pullState.status}</p>
                    </div>
                  )}
                </div>
                {!installed&&!pullState&&(
                  <button onClick={()=>handlePull(m.name)}
                    className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded-lg transition-colors">
                    <Download size={12}/>Pull
                  </button>
                )}
                {pullState&&<Loader2 size={14} className="text-accent animate-spin flex-shrink-0"/>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
