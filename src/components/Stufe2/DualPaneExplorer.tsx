/** src/components/Stufe2/DualPaneExplorer.tsx */
import { useState } from 'react';
import { FolderOpen, ArrowRight } from 'lucide-react';
import { BundleFileTree } from './BundleFileTree';
import { BundleEditor } from './BundleEditor';
import { ZipCompiler } from './ZipCompiler';
import { useAppState } from '@/context/AppContext';
import type { BundleFileName } from '@/types';

export function DualPaneExplorer() {
  const { state, dispatch } = useAppState();
  const [selected, setSelected] = useState<BundleFileName>('agent.md');

  if (!state.editableBundle) return <div className="flex items-center justify-center h-full py-24"><p className="text-muted text-sm">No bundle — complete Stufe 1 first.</p></div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 border-b border-border bg-panel">
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-accent/15 border border-accent/30"><FolderOpen size={15} className="text-accent"/></div>
        <div className="flex-1"><h2 className="text-sm font-semibold text-text-primary tracking-tight">Bundle Explorer</h2><p className="text-[11px] text-muted">Inspect and edit generated documents, then package for download</p></div>
        <button onClick={()=>dispatch({type:'SET_STAGE',stage:'stufe3'})} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted hover:text-accent border border-border hover:border-accent/40 rounded-lg transition-colors">
          Continue to Simulation<ArrowRight size={12}/>
        </button>
      </div>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <BundleFileTree selected={selected} onSelect={setSelected}/>
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-base">
          <BundleEditor fileName={selected}/>
          <ZipCompiler/>
        </div>
      </div>
    </div>
  );
}
