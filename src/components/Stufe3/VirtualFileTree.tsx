/** src/components/Stufe3/VirtualFileTree.tsx */
import { useState } from 'react';
import { Folder, FolderOpen, FileText, FileJson, FileCode, ChevronRight, ChevronDown } from 'lucide-react';
import type { FileTreeNode } from '@/types';

export function buildVirtualTree(paths: string[]): FileTreeNode[] {
  const root = new Map<string, FileTreeNode>();
  for (const p of paths) {
    const parts = p.split('/');
    let map = root;
    for (let i=0;i<parts.length;i++) {
      const name=parts[i]; const isLast=i===parts.length-1; const pathSoFar=parts.slice(0,i+1).join('/');
      if (!map.has(name)) {
        map.set(name, { name, path:pathSoFar, type:isLast?'file':'directory', isNew:isLast, children:isLast?undefined:[] });
      }
      if (!isLast) {
        const dir=map.get(name)!; if (!dir.children) dir.children=[];
        const childMap=new Map<string,FileTreeNode>(); for(const c of dir.children) childMap.set(c.name,c);
        map=childMap; dir.children=Array.from(childMap.values());
      }
    }
  }
  return Array.from(root.values());
}

function FileIcon({ name }: { name:string }) {
  const ext=name.split('.').pop()?.toLowerCase()??'';
  if (ext==='json') return <FileJson size={13} className="text-yellow-500/70"/>;
  if (['ts','tsx','js','jsx','py','go'].includes(ext)) return <FileCode size={13} className="text-blue-400/70"/>;
  return <FileText size={13} className="text-muted/60"/>;
}

function Node({ node, depth, newFiles }: { node:FileTreeNode; depth:number; newFiles:Set<string> }) {
  const [open, setOpen] = useState(true);
  const isNew=newFiles.has(node.path);
  const pl=8+depth*14;

  if (node.type==='directory') return (
    <div>
      <button onClick={()=>setOpen(p=>!p)} className="flex items-center gap-1.5 w-full py-0.5 px-2 text-left hover:bg-surface transition-colors rounded" style={{paddingLeft:`${pl}px`}}>
        {open?<ChevronDown size={11} className="text-muted/50 flex-shrink-0"/>:<ChevronRight size={11} className="text-muted/50 flex-shrink-0"/>}
        {open?<FolderOpen size={13} className="text-accent/60 flex-shrink-0"/>:<Folder size={13} className="text-accent/40 flex-shrink-0"/>}
        <span className="text-[12px] font-mono text-muted/80">{node.name}</span>
      </button>
      {open&&node.children&&<div>{node.children.map(c=><Node key={c.path} node={c} depth={depth+1} newFiles={newFiles}/>)}</div>}
    </div>
  );

  return (
    <div className={['flex items-center gap-1.5 py-0.5 px-2 rounded transition-all duration-300',isNew?'bg-accent/10 animate-slide-in':''].join(' ')} style={{paddingLeft:`${pl}px`}}>
      <span className="w-[11px]" aria-hidden/>
      <FileIcon name={node.name}/>
      <span className={`text-[12px] font-mono transition-colors ${isNew?'text-accent':'text-muted/70'}`}>{node.name}</span>
    </div>
  );
}

export function VirtualFileTree({ nodes, newFiles }: { nodes:FileTreeNode[]; newFiles:Set<string> }) {
  return (
    <div className="flex flex-col h-full overflow-hidden rounded-lg border border-border bg-panel">
      <div className="flex-shrink-0 px-3 py-2 border-b border-border bg-surface/50">
        <p className="text-[10px] font-semibold font-mono text-muted/60 uppercase tracking-widest">project/</p>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {nodes.length===0?<p className="text-[12px] font-mono text-muted/30 italic px-3 py-2">(empty)</p>:nodes.map(n=><Node key={n.path} node={n} depth={0} newFiles={newFiles}/>)}
      </div>
      {nodes.length>0&&<div className="flex-shrink-0 px-3 py-1.5 border-t border-border"><p className="text-[10px] font-mono text-muted/40">{newFiles.size} file{newFiles.size!==1?'s':''} created</p></div>}
    </div>
  );
}
