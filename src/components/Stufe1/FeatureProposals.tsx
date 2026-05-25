/** src/components/Stufe1/FeatureProposals.tsx – AI-proposed feature selection grid. */
import { Check, X, Cpu } from 'lucide-react';
import type { FeatureProposal } from '@/types';
import { useAppState } from '@/context/AppContext';

interface Props { features:FeatureProposal[]; onGenerate:()=>void; isLoading:boolean; }

function FeatureCard({ feature, onToggle, disabled }: { feature:FeatureProposal; onToggle:()=>void; disabled:boolean }) {
  return (
    <button onClick={onToggle} disabled={disabled}
      className={['text-left p-3.5 rounded-lg border transition-all group',
        feature.accepted?'border-accent/50 bg-accent/5 hover:border-accent/70':'border-border bg-surface/60 opacity-60 hover:opacity-75',
        disabled?'cursor-not-allowed':'cursor-pointer'].join(' ')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold leading-tight mb-1 ${feature.accepted?'text-text-primary':'text-muted'}`}>{feature.title}</p>
          <p className="text-[12px] text-muted leading-relaxed">{feature.rationale}</p>
          {feature.techHint && <span className="inline-block mt-1.5 px-1.5 py-0.5 text-[10px] font-mono rounded bg-border/80 text-muted">{feature.techHint}</span>}
        </div>
        <div className={['flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors',
          feature.accepted?'bg-accent text-base':'bg-border text-muted'].join(' ')}>
          {feature.accepted?<Check size={11} strokeWidth={3}/>:<X size={11}/>}
        </div>
      </div>
    </button>
  );
}

export function FeatureProposals({ features, onGenerate, isLoading }: Props) {
  const { dispatch } = useAppState();
  const accepted = features.filter(f=>f.accepted).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium text-muted uppercase tracking-wider mb-0.5">Proposed features</p>
          <p className="text-xs text-muted/70">{accepted} of {features.length} selected</p>
        </div>
        <div className="flex items-center gap-1.5"><Cpu size={14} className="text-accent"/><span className="text-[11px] text-accent font-mono">AI-generated</span></div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto pr-1">
        {features.map(f=><FeatureCard key={f.id} feature={f} disabled={isLoading} onToggle={()=>dispatch({type:'TOGGLE_FEATURE',id:f.id})}/>)}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={()=>dispatch({type:'SET_FEATURES',features:features.map(f=>({...f,accepted:true}))})} disabled={isLoading} className="text-xs text-muted hover:text-accent transition-colors py-1 px-2">Select all</button>
        <button onClick={()=>dispatch({type:'SET_FEATURES',features:features.map(f=>({...f,accepted:false}))})} disabled={isLoading} className="text-xs text-muted hover:text-error transition-colors py-1 px-2">Clear all</button>
        <div className="flex-1"/>
        <button onClick={onGenerate} disabled={accepted<1||isLoading}
          className={['px-5 py-2.5 rounded-lg font-semibold text-sm tracking-wide transition-all',
            accepted>=1&&!isLoading?'bg-accent text-base hover:bg-accent-dim btn-glow cursor-pointer':'bg-surface border border-border text-muted cursor-not-allowed'].join(' ')}>
          {isLoading?'Generating…':`Generate Plan (${accepted}) →`}
        </button>
      </div>
    </div>
  );
}
