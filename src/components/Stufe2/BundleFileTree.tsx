/** src/components/Stufe2/BundleFileTree.tsx */
import { FileText, FileJson, FilePen } from 'lucide-react';
import type { BundleFileName } from '@/types';
import { useAppState } from '@/context/AppContext';

const ORDER: BundleFileName[] = ['agent.md','architecture.md','roadmap.md','tasks.md','manifest.json'];

function FileIcon({ name }: { name:BundleFileName }) {
  if (name.endsWith('.json')) return <FileJson size={14} className="text-yellow-500/70"/>;
  return <FileText size={14} className="text-blue-400/70"/>;
}

export function BundleFileTree({ selected, onSelect }: { selected:BundleFileName; onSelect:(f:BundleFileName)=>void }) {
  const { state } = useAppState();
  const { editableBundle, modifiedFiles } = state;
  if (!editableBundle) return null;

  return (
    <aside className="flex flex-col w-52 flex-shrink-0 border-r border-border bg-panel overflow-y-auto">
      <div className="px-3 py-2.5 border-b border-border"><p className="text-[10px] font-semibold text-muted uppercase tracking-widest">Bundle Files</p></div>
      <nav className="flex flex-col py-1">
        {ORDER.map(f=>{
          const isSelected=f===selected; const isMod=modifiedFiles.has(f);
          return (
            <button key={f} onClick={()=>onSelect(f)}
              className={['flex items-center gap-2.5 px-3 py-2 text-left transition-colors border-l-2',
                isSelected?'bg-accent/10 border-accent text-text-primary':'border-transparent text-muted hover:bg-surface hover:text-text-primary'].join(' ')}>
              <FileIcon name={f}/>
              <span className="flex-1 text-xs font-mono truncate">{f}</span>
              {isMod&&<FilePen size={11} className="flex-shrink-0 text-warning/70" aria-label="Modified"/>}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto px-3 py-2.5 border-t border-border">
        <p className="text-[10px] text-muted/50 flex items-center gap-1"><FilePen size={10} className="text-warning/50"/> Modified</p>
      </div>
    </aside>
  );
}
