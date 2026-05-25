/** src/components/Stufe1/GenerationProgress.tsx – Streaming generation display. */
import { CheckCircle, Circle, Loader2, FileText } from 'lucide-react';
import type { BundleFileName, EngineStatus } from '@/types';
import { useAppState } from '@/context/AppContext';

const DOC_ORDER: BundleFileName[] = ['agent.md','architecture.md','roadmap.md','tasks.md','manifest.json'];
const DOC_LABELS: Record<BundleFileName,string> = { 'agent.md':'Agent Guide','architecture.md':'Architecture','roadmap.md':'Roadmap','tasks.md':'Tasks','manifest.json':'Manifest' };

function ModelLoadBar({ status, progress, text }: { status:EngineStatus; progress:number; text:string }) {
  if (status==='ready'||status==='generating') return null;
  return (
    <div className="flex flex-col gap-2 mb-5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted font-mono">{status==='loading'?'Loading model…':'Initialising…'}</span>
        <span className="text-accent font-mono font-semibold tabular-nums">{progress}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-border overflow-hidden">
        <div className="h-full bg-accent rounded-full transition-all duration-300" style={{width:`${progress}%`}}/>
      </div>
      {text&&<p className="text-[11px] text-muted/60 font-mono truncate">{text}</p>}
    </div>
  );
}

function DocRow({ fileName, current, finished }: { fileName:BundleFileName; current:BundleFileName|null; finished:Set<BundleFileName> }) {
  const isGen=current===fileName; const isDone=finished.has(fileName);
  return (
    <div className={['flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all',isGen?'bg-accent/10 border border-accent/20':'border border-transparent'].join(' ')}>
      <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
        {isDone?<CheckCircle size={18} className="text-accent"/>:isGen?<Loader2 size={18} className="text-accent animate-spin"/>:<Circle size={18} className="text-border"/>}
      </div>
      <FileText size={13} className={isDone?'text-accent/60':isGen?'text-accent':'text-border'}/>
      <span className={['flex-1 text-sm font-mono',isDone?'text-accent/70 line-through':isGen?'text-accent':'text-muted/50'].join(' ')}>{fileName}</span>
      <span className={`text-xs ${isDone||isGen?'text-muted':'text-muted/30'}`}>{DOC_LABELS[fileName]}</span>
    </div>
  );
}

export function GenerationProgress() {
  const { state } = useAppState();
  const { engineStatus, engineProgress, generatingFileName, streamBuffer, project } = state;
  const finished = new Set<BundleFileName>();
  if (project?.generated_bundle) {
    for (const k of Object.keys(project.generated_bundle) as BundleFileName[]) {
      if (k!==generatingFileName) finished.add(k);
    }
  }
  const done = finished.size===DOC_ORDER.length&&!generatingFileName;

  return (
    <div className="flex flex-col gap-4">
      <ModelLoadBar status={engineStatus} progress={engineProgress.progress} text={engineProgress.text}/>
      <div className="flex flex-col gap-0.5">
        {DOC_ORDER.map(f=><DocRow key={f} fileName={f} current={generatingFileName} finished={finished}/>)}
      </div>
      {generatingFileName&&streamBuffer&&(
        <div className="rounded-lg bg-base border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-surface/50">
            <div className="flex gap-1"><span className="w-2.5 h-2.5 rounded-full bg-error/60"/><span className="w-2.5 h-2.5 rounded-full bg-warning/60"/><span className="w-2.5 h-2.5 rounded-full bg-success/60"/></div>
            <span className="text-[10px] font-mono text-muted">output stream</span>
          </div>
          <pre className="font-mono text-[11px] text-accent/80 p-3 whitespace-pre-wrap leading-relaxed max-h-32 overflow-hidden">
            {streamBuffer.length>300?'…'+streamBuffer.slice(-300):streamBuffer}<span className="animate-blink">▌</span>
          </pre>
        </div>
      )}
      {done&&(
        <div className="animate-fade-in flex items-center gap-2 px-3 py-2.5 rounded-lg bg-success/10 border border-success/30 text-sm text-green-400">
          <CheckCircle size={16}/><span>All documents generated — proceeding to validation…</span>
        </div>
      )}
    </div>
  );
}
