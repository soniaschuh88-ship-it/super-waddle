/** src/components/Stufe3/ExecutorSimulation.tsx */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, RotateCcw, Terminal } from 'lucide-react';
import { TerminalConsole } from './TerminalConsole';
import { VirtualFileTree, buildVirtualTree } from './VirtualFileTree';
import { useAppState } from '@/context/AppContext';
import { buildSimulationTimeline, createSimulationController, type SimulationController } from '@/lib/simulation';
import type { SimulationLogEntry, FileTreeNode } from '@/types';

export function ExecutorSimulation() {
  const { state, dispatch } = useAppState();
  const { editableBundle } = state;

  const [logs, setLogs] = useState<SimulationLogEntry[]>([]);
  const [nodes, setNodes] = useState<FileTreeNode[]>([]);
  const [newFiles, setNewFiles] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const ctrl = useRef<SimulationController | null>(null);
  const timeline = useRef<SimulationLogEntry[]>([]);

  useEffect(()=>{ if (editableBundle&&timeline.current.length===0) timeline.current=buildSimulationTimeline(editableBundle); }, [editableBundle]);

  const onEntry = useCallback((e: SimulationLogEntry) => {
    setLogs(prev=>[...prev,e]);
    if ((e.action==='write'||e.action==='create')&&e.filePath) {
      const fp=e.filePath;
      setNewFiles(prev=>{ const n=new Set(prev); n.add(fp); return n; });
      setLogs(prev=>{ const paths=[...new Set(prev.filter(l=>(l.action==='write'||l.action==='create')&&l.filePath).map(l=>l.filePath as string).concat(fp))]; setNodes(buildVirtualTree(paths)); return prev; });
      setTimeout(()=>setNewFiles(prev=>{ const n=new Set(prev); n.delete(fp); return n; }),1500);
    }
  }, []);

  const onComplete = useCallback(()=>{ setRunning(false); setDone(true); dispatch({type:'SET_SIMULATION_RUNNING',running:false}); }, [dispatch]);

  const play = useCallback(()=>{
    if (!editableBundle) return;
    if (!ctrl.current) ctrl.current=createSimulationController(timeline.current,onEntry,onComplete,120);
    ctrl.current.play(); setRunning(true); setDone(false);
    dispatch({type:'SET_SIMULATION_RUNNING',running:true});
  }, [editableBundle,onEntry,onComplete,dispatch]);

  const pause = useCallback(()=>{ ctrl.current?.pause(); setRunning(false); dispatch({type:'SET_SIMULATION_RUNNING',running:false}); }, [dispatch]);

  const reset = useCallback(()=>{
    ctrl.current?.reset(); ctrl.current=null;
    setLogs([]); setNodes([]); setNewFiles(new Set()); setRunning(false); setDone(false);
    dispatch({type:'CLEAR_SIMULATION'});
  }, [dispatch]);

  if (!editableBundle) return <div className="flex items-center justify-center h-full py-24"><p className="text-muted text-sm">No bundle — complete Stufe 1 first.</p></div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 border-b border-border bg-panel">
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-accent/15 border border-accent/30"><Terminal size={15} className="text-accent"/></div>
        <div className="flex-1"><h2 className="text-sm font-semibold text-text-primary tracking-tight">Executor Simulation</h2><p className="text-[11px] text-muted">Mock downstream agent consuming the generated bundle</p></div>
        <div className="flex items-center gap-2">
          <button onClick={reset} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted hover:text-text-primary border border-border hover:border-border/80 rounded-lg transition-colors"><RotateCcw size={12}/><span>Reset</span></button>
          {running
            ? <button onClick={pause} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-warning/15 border border-warning/30 text-yellow-400 hover:bg-warning/20 rounded-lg transition-colors"><Pause size={12}/><span>Pause</span></button>
            : <button onClick={play} disabled={done} className={['flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors',done?'bg-success/15 border border-success/30 text-green-400 cursor-default':'bg-accent text-base hover:bg-accent-dim btn-glow cursor-pointer'].join(' ')}><Play size={12}/><span>{done?'Complete':logs.length===0?'Run Simulation':'Resume'}</span></button>
          }
        </div>
      </div>
      <div className="flex flex-1 min-h-0 gap-4 p-4 overflow-hidden">
        <div className="flex-[3] min-w-0 min-h-0"><TerminalConsole logs={logs} isRunning={running}/></div>
        <div className="flex-[2] min-w-0 min-h-0"><VirtualFileTree nodes={nodes} newFiles={newFiles}/></div>
      </div>
    </div>
  );
}
