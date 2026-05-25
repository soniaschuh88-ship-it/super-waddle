/** src/components/Stufe1_5/ValidationLoop.tsx */
import { ShieldCheck } from 'lucide-react';
import { ValidationStepCard } from './ValidationStepCard';
import { ValidationReport } from './ValidationReport';
import { useAppState } from '@/context/AppContext';
import { updateProject } from '@/lib/db';

export function ValidationLoop() {
  const { state, dispatch } = useAppState();
  const { validationResult, project } = state;

  if (!validationResult) return <div className="flex items-center justify-center h-full py-24"><p className="text-muted text-sm">No validation data — complete Stufe 1 first.</p></div>;

  const done = validationResult.steps.every(s=>s.status==='pass'||s.status==='warn'||s.status==='fail');
  const doneCount = validationResult.steps.filter(s=>s.status==='pass'||s.status==='warn'||s.status==='fail').length;
  const total = validationResult.steps.length;
  const pct = total>0?Math.round(doneCount/total*100):0;

  const handleContinue = async () => {
    if (project&&validationResult) {
      const updated = { ...project, validation_results:validationResult, updated_at:new Date().toISOString() };
      await updateProject(updated);
      dispatch({type:'SET_PROJECT',project:updated});
    }
    dispatch({type:'SET_STAGE',stage:'stufe2'});
  };

  return (
    <div className="flex items-start justify-center min-h-full px-4 py-8">
      <div className="w-full max-w-2xl">
        <div className="rounded-xl border border-border bg-surface shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-panel">
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-accent/15 border border-accent/30"><ShieldCheck size={15} className="text-accent"/></div>
            <div className="flex-1"><h2 className="text-sm font-semibold text-text-primary tracking-tight">Validation Loop</h2><p className="text-[11px] text-muted">Automated QA checks on the generated plan</p></div>
            <span className="text-xs font-mono text-muted tabular-nums">{doneCount} / {total}</span>
          </div>
          <div className="p-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[11px] text-muted"><span>Validation progress</span><span className="font-mono tabular-nums">{pct}%</span></div>
              <div className="h-1.5 rounded-full bg-border overflow-hidden"><div className="h-full bg-accent rounded-full transition-all duration-500" style={{width:`${pct}%`}}/></div>
            </div>
            <div className="flex flex-col gap-2">
              {validationResult.steps.map((s,i)=><ValidationStepCard key={s.id} step={s} index={i}/>)}
            </div>
            {done&&<ValidationReport result={validationResult} onContinue={handleContinue}/>}
          </div>
        </div>
      </div>
    </div>
  );
}
