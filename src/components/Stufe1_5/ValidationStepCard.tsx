/** src/components/Stufe1_5/ValidationStepCard.tsx */
import { CheckCircle, AlertTriangle, XCircle, Loader2, Circle } from 'lucide-react';
import type { ValidationStep } from '@/types';

const CFG = {
  pending: { Icon:Circle,       ic:'text-border',              badge:'bg-border/50 text-muted',                          border:'border-border',       bg:'' },
  running: { Icon:Loader2,      ic:'text-accent animate-spin', badge:'bg-accent/15 text-accent border border-accent/30',  border:'border-accent/30',    bg:'bg-accent/3' },
  pass:    { Icon:CheckCircle,  ic:'text-success',             badge:'bg-success/10 text-green-400 border border-success/30', border:'border-success/20',bg:'bg-success/3' },
  warn:    { Icon:AlertTriangle,ic:'text-warning',             badge:'bg-warning/10 text-yellow-400 border border-warning/30',border:'border-warning/20',bg:'bg-warning/3' },
  fail:    { Icon:XCircle,      ic:'text-error',               badge:'bg-error/10 text-red-400 border border-error/30',   border:'border-error/20',     bg:'bg-error/3' },
} as const;

const BADGE_TEXT = { pending:'Pending', running:'Running…', pass:'Pass', warn:'Warning', fail:'Fail' };

export function ValidationStepCard({ step, index }: { step:ValidationStep; index:number }) {
  const { Icon, ic, badge, border, bg } = CFG[step.status];
  return (
    <div className={['rounded-lg border px-4 py-3 transition-all duration-300', border, bg, step.status!=='pending'?'animate-slide-in opacity-100':'opacity-40'].join(' ')} style={{animationDelay:`${index*60}ms`}}>
      <div className="flex items-center gap-3">
        <Icon size={18} className={`flex-shrink-0 ${ic}`}/>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary leading-tight">{step.title}</p>
          <p className="text-[11px] text-muted mt-0.5 leading-relaxed">{step.description}</p>
        </div>
        <span className={`flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${badge}`}>{BADGE_TEXT[step.status]}</span>
      </div>
      {step.findings.length>0&&(
        <ul className="mt-2.5 pl-7 flex flex-col gap-1">
          {step.findings.map((f,i)=>(
            <li key={i} className="text-[12px] text-muted/80 leading-relaxed flex items-start gap-1.5">
              <span className="mt-1.5 flex-shrink-0 w-1 h-1 rounded-full bg-muted/50"/>
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
