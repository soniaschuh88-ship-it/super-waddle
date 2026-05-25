/** src/components/Stufe3/TerminalConsole.tsx */
import { useEffect, useRef } from 'react';
import type { SimulationLogEntry } from '@/types';

const ACTION_CLASS: Record<SimulationLogEntry['action'], string> = {
  info:    'text-text-primary/80',
  create:  'text-blue-400',
  write:   'text-accent/90',
  success: 'text-green-400',
  error:   'text-error',
};

export function TerminalConsole({ logs, isRunning }: { logs:SimulationLogEntry[]; isRunning:boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{ bottomRef.current?.scrollIntoView({ behavior:'smooth' }); }, [logs.length]);

  return (
    <div className="flex flex-col h-full overflow-hidden rounded-lg border border-border bg-[#0d0d16]">
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 bg-panel border-b border-border">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-error/60"/><span className="w-3 h-3 rounded-full bg-warning/60"/><span className="w-3 h-3 rounded-full bg-success/60"/>
        </div>
        <span className="flex-1 text-center text-[11px] font-mono text-muted/60">icadp-executor — zsh</span>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isRunning?'text-accent bg-accent/10 animate-pulse-slow':'text-muted bg-border/50'}`}>
          {isRunning?'● RUN':'● IDLE'}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {logs.length===0&&<div className="font-mono text-[12px] text-muted/40 italic">Awaiting executor start…</div>}
        {logs.map(e=>(
          <div key={e.id} className={`font-mono text-[12px] leading-relaxed ${ACTION_CLASS[e.action]}`}>
            <span className="text-muted/40 select-none mr-2">{String(e.timestamp).padStart(6,' ')}ms</span>
            {e.message}
          </div>
        ))}
        {isRunning&&<div className="pt-0.5"><span className="inline-block font-mono text-accent text-sm animate-blink select-none">▌</span></div>}
        <div ref={bottomRef}/>
      </div>
    </div>
  );
}
