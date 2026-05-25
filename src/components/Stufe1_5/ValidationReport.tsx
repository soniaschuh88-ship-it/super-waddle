/** src/components/Stufe1_5/ValidationReport.tsx */
import { CheckCircle, AlertTriangle, XCircle, ArrowRight } from 'lucide-react';
import type { ValidationResult } from '@/types';

const COLOURS = { pass:'bg-success/10 text-green-400 border-success/20', warn:'bg-warning/10 text-yellow-400 border-warning/20', fail:'bg-error/10 text-red-400 border-error/20', pending:'bg-border/50 text-muted border-border/50', running:'bg-accent/10 text-accent border-accent/20' };

export function ValidationReport({ result, onContinue }: { result:ValidationResult; onContinue:()=>void }) {
  const hasFail = result.steps.some(s=>s.status==='fail');
  const warnCount = result.steps.filter(s=>s.status==='warn').length;
  const passCount = result.steps.filter(s=>s.status==='pass').length;
  const overall = hasFail?'fail':warnCount>0?'warn':'pass';

  const msgs = {
    pass: { Icon:CheckCircle, ic:'text-success', title:'All checks passed', body:`${passCount} checks passed. The plan is well-structured and MVP-scoped.`, card:'border-success/30 bg-success/5' },
    warn: { Icon:AlertTriangle, ic:'text-warning', title:`${warnCount} advisory finding${warnCount>1?'s':''}`, body:'Valid plan with advisory notes. Review findings and edit in the next step if needed.', card:'border-warning/30 bg-warning/5' },
    fail: { Icon:XCircle, ic:'text-error', title:'One or more checks failed', body:'Structural issues found. Continue to the editor to fix them manually.', card:'border-error/30 bg-error/5' },
  };

  const { Icon, ic, title, body, card } = msgs[overall];

  return (
    <div className="animate-slide-in flex flex-col gap-4 pt-2 border-t border-border mt-4">
      <div className={`rounded-lg border p-4 ${card}`}>
        <div className="flex items-start gap-3">
          <Icon size={20} className={`flex-shrink-0 mt-0.5 ${ic}`}/>
          <div><p className="text-sm font-semibold text-text-primary">{title}</p><p className="text-xs text-muted mt-1 leading-relaxed">{body}</p></div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {result.steps.map(s=>(
          <span key={s.id} className={`text-[11px] px-2.5 py-0.5 rounded-full border font-medium ${COLOURS[s.status]}`}>{s.title}</span>
        ))}
      </div>
      <button onClick={onContinue} className="flex items-center justify-center gap-2 w-full py-3 rounded-lg bg-accent text-base font-semibold text-sm tracking-wide hover:bg-accent-dim btn-glow transition-all">
        Accept and continue to Bundle Explorer<ArrowRight size={16}/>
      </button>
      {result.completedAt&&<p className="text-center text-[10px] text-muted/50 font-mono">Validated at {new Date(result.completedAt).toLocaleTimeString()}</p>}
    </div>
  );
}
