/**
 * src/components/Admin/WebLLMCache.tsx
 * Manage the browser-side web-llm model cache.
 */
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, Download, Loader2, HardDrive } from 'lucide-react';
import { MODEL_OPTIONS, getCachedModelIds, deleteCachedModel, precacheModel } from '@/lib/webllm';
import type { EngineProgress } from '@/types';

export function WebLLMCache() {
  const [cached, setCached]       = useState<string[]>([]);
  const [loading, setLoading]     = useState(false);
  const [caching, setCaching]     = useState<Record<string, EngineProgress>>({});
  const [deleting, setDeleting]   = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    setCached(await getCachedModelIds());
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCache = async (modelId: string) => {
    setCaching(p=>({...p,[modelId]:{progress:0,text:'Starting…'}}));
    try {
      await precacheModel(modelId, p=>setCaching(prev=>({...prev,[modelId]:p})));
      await refresh();
    } catch (e) {
      setCaching(p=>({...p,[modelId]:{progress:0,text:`Error: ${e instanceof Error?e.message:'failed'}`}}));
    }
    setTimeout(()=>setCaching(p=>{const n={...p};delete n[modelId];return n;}),4000);
  };

  const handleDelete = async (modelId: string) => {
    if (!confirm(`Remove ${modelId} from browser cache?`)) return;
    setDeleting(d=>{const n=new Set(d);n.add(modelId);return n;});
    await deleteCachedModel(modelId);
    await refresh();
    setDeleting(d=>{const n=new Set(d);n.delete(modelId);return n;});
  };

  const totalCachedMB = cached.reduce((sum,id)=>sum+(MODEL_OPTIONS.find(m=>m.id===id)?.sizeMb??0),0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive size={16} className="text-accent"/>
          <p className="text-sm text-text-primary">{cached.length} model{cached.length!==1?'s':''} cached · ~{totalCachedMB} MB</p>
        </div>
        <button onClick={refresh} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border text-muted hover:text-accent hover:border-accent/40 rounded-lg transition-colors">
          <RefreshCw size={13} className={loading?'animate-spin':''}/>Refresh
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {MODEL_OPTIONS.map(m=>{
          const isCached=cached.includes(m.id);
          const prog=caching[m.id];
          return (
            <div key={m.id} className={['flex items-center gap-3 px-4 py-3 rounded-lg border transition-all',isCached?'border-success/30 bg-success/5':'border-border bg-panel'].join(' ')}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-text-primary truncate">{m.label}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isCached?'bg-success/15 text-green-400':'bg-border/60 text-muted'}`}>{isCached?'Cached':'Not cached'}</span>
                </div>
                <p className="text-[11px] text-muted mt-0.5 font-mono">{m.id}</p>
                <p className="text-[11px] text-muted/60">{m.description} · ~{m.sizeMb} MB</p>
                {prog&&(
                  <div className="mt-1.5">
                    <div className="h-1 rounded-full bg-border overflow-hidden"><div className="h-full bg-accent rounded-full transition-all duration-200" style={{width:`${prog.progress}%`}}/></div>
                    <p className="text-[10px] text-muted/60 mt-0.5 font-mono truncate">{prog.text}</p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {!isCached&&!prog&&(
                  <button onClick={()=>handleCache(m.id)} className="flex items-center gap-1 px-2.5 py-1 text-xs bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded-lg transition-colors">
                    <Download size={12}/>Pre-cache
                  </button>
                )}
                {prog&&<Loader2 size={14} className="text-accent animate-spin"/>}
                {isCached&&!deleting.has(m.id)&&(
                  <button onClick={()=>handleDelete(m.id)} className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted hover:text-error border border-transparent hover:border-error/30 rounded-lg transition-colors">
                    <Trash2 size={12}/>Remove
                  </button>
                )}
                {deleting.has(m.id)&&<Loader2 size={14} className="text-muted animate-spin"/>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
