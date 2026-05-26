/** src/components/Layout/StageProgress.tsx – Horizontal stage stepper (hidden on home). */
import { type Stage } from '@/types';
import { useAppState } from '@/context/AppContext';

const STAGES = [
  { id:'stufe1'   as Stage, label:'Plan',       n:1 },
  { id:'stufe1_5' as Stage, label:'Validate',   n:2 },
  { id:'stufe2'   as Stage, label:'Bundle',     n:3 },
  { id:'stufe3'   as Stage, label:'Code',       n:4 },
];
const ORDER: Stage[] = ['home','stufe1','stufe1_5','stufe2','stufe3'];

export function StageProgress() {
  const { state, dispatch } = useAppState();

  // Don't show the stepper on the home dashboard
  if (state.stage === 'home') return null;

  const cur = ORDER.indexOf(state.stage);
  return (
    <nav className="flex items-center gap-0">
      {STAGES.map((s, i) => {
        const active = s.id === state.stage;
        const done   = ORDER.indexOf(s.id) < cur;
        return (
          <div key={s.id} className="flex items-center">
            {i > 0 && (
              <div className={`h-px w-6 md:w-10 transition-colors ${done ? 'bg-accent' : 'bg-border'}`}/>
            )}
            <button
              onClick={() => done && dispatch({ type:'SET_STAGE', stage: s.id })}
              disabled={!done}
              className={['flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all text-xs',
                active ? 'bg-accent/15 border border-accent/40 text-accent'
                : done  ? 'text-accent/70 hover:text-accent hover:bg-accent/10 cursor-pointer'
                : 'text-muted cursor-default'].join(' ')}
            >
              <span className={['w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors',
                active ? 'bg-accent text-base' : done ? 'bg-accent/30 text-accent' : 'bg-border text-muted'].join(' ')}>
                {s.n}
              </span>
              <span className="hidden sm:inline font-medium tracking-wide">{s.label}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
