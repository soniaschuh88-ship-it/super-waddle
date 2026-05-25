/** src/components/Stufe1/IdeaInput.tsx – Textarea + preset cards for Step 1. */
import { useState } from 'react';
import { Zap } from 'lucide-react';
import { PRESET_IDEAS } from '@/lib/prompts';

interface IdeaInputProps { value:string; onChange:(t:string)=>void; onSubmit:()=>void; isLoading:boolean; }

export function IdeaInput({ value, onChange, onSubmit, isLoading }: IdeaInputProps) {
  const [chars, setChars] = useState(value.length);
  const empty = value.trim().length < 20;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[11px] font-medium text-muted uppercase tracking-wider mb-2">Quick-load examples</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {PRESET_IDEAS.map(p => (
            <button key={p.title} onClick={()=>{onChange(p.text);setChars(p.text.length);}}
              className="text-left p-3 rounded-lg border border-border bg-surface hover:border-accent/50 hover:bg-accent/5 transition-all group">
              <div className="flex items-start gap-2">
                <Zap size={14} className="mt-0.5 flex-shrink-0 text-muted group-hover:text-accent transition-colors"/>
                <div>
                  <p className="text-xs font-semibold text-text-primary group-hover:text-accent transition-colors leading-tight">{p.title}</p>
                  <p className="text-[11px] text-muted mt-0.5 leading-tight">{p.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="idea-input" className="text-[11px] font-medium text-muted uppercase tracking-wider">Your product idea</label>
        <textarea id="idea-input" value={value} rows={9} disabled={isLoading}
          onChange={e=>{onChange(e.target.value);setChars(e.target.value.length);}}
          placeholder={'Describe the product or system you want to build.\nThe more detail, the better the plan.\n\ne.g. "A mobile app where users log their daily mood and get AI-generated coping suggestions..."'}
          className={['font-mono text-sm resize-none rounded-lg p-3.5 bg-base border border-border text-text-primary placeholder:text-muted/40 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-colors', isLoading?'opacity-50 cursor-not-allowed':''].join(' ')}/>
        <span className={`text-[11px] font-mono ${chars<20?'text-muted/50':'text-muted'}`}>{chars} chars{chars<20?' · minimum 20':''}</span>
      </div>

      <button onClick={onSubmit} disabled={empty||isLoading}
        className={['w-full py-3 rounded-lg font-semibold text-sm tracking-wide transition-all',
          empty||isLoading?'bg-surface border border-border text-muted cursor-not-allowed':'bg-accent text-base hover:bg-accent-dim btn-glow cursor-pointer'].join(' ')}>
        {isLoading?'Proposing features…':'Propose Features →'}
      </button>
    </div>
  );
}
