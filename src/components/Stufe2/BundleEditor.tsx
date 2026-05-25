/** src/components/Stufe2/BundleEditor.tsx */
import { useState, useRef, useEffect } from 'react';
import { Edit3, Eye, RotateCcw, FilePen } from 'lucide-react';
import type { BundleFileName } from '@/types';
import { useAppState } from '@/context/AppContext';

function LineNumbers({ n }: { n:number }) {
  return (
    <div aria-hidden className="select-none text-right pr-3 font-mono text-[11px] text-muted/30 leading-[1.6rem] py-3 pl-2 min-w-[3rem]">
      {Array.from({length:n},(_,i)=><div key={i}>{i+1}</div>)}
    </div>
  );
}

export function BundleEditor({ fileName }: { fileName:BundleFileName }) {
  const { state, dispatch } = useAppState();
  const { editableBundle, modifiedFiles } = state;
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const content = editableBundle?.[fileName] ?? '';
  const lines = content.split('\n').length;
  const isMod = modifiedFiles.has(fileName);

  useEffect(()=>{ if(editing) ref.current?.focus(); }, [editing]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-panel">
        <span className="font-mono text-xs text-text-primary flex items-center gap-1.5">
          {isMod&&<FilePen size={12} className="text-warning" aria-label="Modified"/>}
          {fileName}
        </span>
        <div className="flex-1"/>
        {isMod&&<button onClick={()=>{dispatch({type:'RESET_BUNDLE_FILE',fileName});setEditing(false);}} className="flex items-center gap-1 px-2 py-1 text-[11px] text-muted hover:text-warning transition-colors rounded"><RotateCcw size={11}/><span>Reset</span></button>}
        <button onClick={()=>setEditing(p=>!p)}
          className={['flex items-center gap-1 px-2.5 py-1 text-[11px] rounded border transition-colors', editing?'bg-accent/15 border-accent/40 text-accent':'border-border text-muted hover:border-accent/40 hover:text-text-primary'].join(' ')}>
          {editing?<><Eye size={11}/><span>Preview</span></>:<><Edit3 size={11}/><span>Edit</span></>}
        </button>
      </div>
      <div className="flex flex-1 min-h-0 overflow-hidden font-mono text-sm">
        <LineNumbers n={lines}/>
        <div className="flex-1 overflow-auto">
          {editing
            ? <textarea ref={ref} value={content} spellCheck={false} onChange={e=>dispatch({type:'UPDATE_BUNDLE_FILE',fileName,content:e.target.value})}
                className="w-full min-h-full bg-transparent text-text-primary text-[13px] font-mono leading-[1.6rem] resize-none outline-none py-3 pr-4"
                style={{height:`${lines*1.6}rem`}}/>
            : <pre className="text-[13px] text-text-primary/90 leading-[1.6rem] py-3 pr-4 whitespace-pre-wrap break-words">{content}</pre>}
        </div>
      </div>
    </div>
  );
}
