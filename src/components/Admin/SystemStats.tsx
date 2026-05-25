/** src/components/Admin/SystemStats.tsx – Generation stats from the local SQLite DB. */
import { useState, useEffect } from 'react';
import { Activity, Zap, RefreshCw } from 'lucide-react';
import { getStats, listProjects } from '@/lib/db';
import { openDb } from '@/lib/db';

export function SystemStats() {
  const [stats, setStats]     = useState<{ totalGenerations:number; today:number; byBackend:Record<string,number> } | null>(null);
  const [projectCount, setProjectCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    await openDb(); // ensure DB is open
    const [s, projects] = await Promise.all([getStats(), listProjects()]);
    setStats(s);
    setProjectCount(projects.length);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const BACKEND_LABELS: Record<string, string> = {
    webgpu: 'WebGPU', ollama: 'Ollama', 'mlc-server': 'MLC-LLM', 'llama-node': 'llama.node',
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Activity size={16} className="text-accent"/><h3 className="text-sm font-semibold text-text-primary">Usage Statistics</h3></div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border text-muted hover:text-accent hover:border-accent/40 rounded-lg transition-colors">
          <RefreshCw size={13} className={loading?'animate-spin':''}/>Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8"><RefreshCw size={20} className="text-muted animate-spin"/></div>
      ) : stats ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label:'Total Plans', value:stats.totalGenerations, icon:Zap, color:'text-accent' },
              { label:'Plans Today',  value:stats.today,             icon:Activity, color:'text-success' },
              { label:'Projects',    value:projectCount,             icon:Activity, color:'text-info' },
            ].map(({ label, value, icon:Icon, color })=>(
              <div key={label} className="rounded-lg border border-border bg-panel p-4 flex flex-col gap-1">
                <div className="flex items-center gap-2"><Icon size={14} className={color}/><span className="text-[11px] text-muted uppercase tracking-wider">{label}</span></div>
                <p className="text-2xl font-bold text-text-primary tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          {/* By backend */}
          {Object.keys(stats.byBackend).length>0&&(
            <div>
              <h4 className="text-sm font-semibold text-text-primary mb-3">Plans by Backend</h4>
              <div className="flex flex-col gap-2">
                {Object.entries(stats.byBackend).sort((a,b)=>b[1]-a[1]).map(([key,n])=>{
                  const pct = stats.totalGenerations>0 ? Math.round(n/stats.totalGenerations*100) : 0;
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <span className="text-xs text-muted w-28 truncate">{BACKEND_LABELS[key]??key}</span>
                      <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
                        <div className="h-full bg-accent rounded-full transition-all" style={{width:`${pct}%`}}/>
                      </div>
                      <span className="text-xs font-mono text-muted tabular-nums w-12 text-right">{n} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {stats.totalGenerations===0&&(
            <div className="text-center py-8">
              <Zap size={32} className="text-muted/30 mx-auto mb-2"/>
              <p className="text-sm text-muted">No generations recorded yet.</p>
              <p className="text-xs text-muted/60 mt-1">Use the main app to generate your first plan.</p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
