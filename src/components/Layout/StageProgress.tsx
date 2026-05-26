/**
 * src/components/Layout/StageProgress.tsx
 * Crystalline stage stepper — Atlantis Cyberpunk design.
 * Hidden on home and agenthub.
 */
import { type Stage } from '@/types';
import { useAppState } from '@/context/AppContext';
import { CheckCircle } from 'lucide-react';

const STAGES = [
  { id: 'stufe1'   as Stage, label: 'Plan',     n: 1 },
  { id: 'stufe1_5' as Stage, label: 'Validate', n: 2 },
  { id: 'stufe2'   as Stage, label: 'Bundle',   n: 3 },
  { id: 'stufe3'   as Stage, label: 'Code',     n: 4 },
];
const ORDER: Stage[] = ['home', 'stufe1', 'stufe1_5', 'stufe2', 'stufe3'];

export function StageProgress() {
  const { state, dispatch } = useAppState();

  if (state.stage === 'home' || state.stage === 'agenthub') return null;

  const curIdx = ORDER.indexOf(state.stage);

  return (
    <nav className="flex items-center gap-0" aria-label="Stages">
      {STAGES.map((s, i) => {
        const active  = s.id === state.stage;
        const done    = ORDER.indexOf(s.id) < curIdx;
        const col     = active ? '#00e5ff' : done ? '#00e5a0' : '#0d2a40';
        const textCol = active ? '#00e5ff' : done ? '#00e5a0' : '#4a6880';

        return (
          <div key={s.id} className="flex items-center">
            {/* Connector line */}
            {i > 0 && (
              <div
                className="w-5 md:w-8 h-px transition-all duration-500"
                style={{
                  background: done
                    ? 'linear-gradient(90deg, rgba(0,229,160,0.6), rgba(0,229,255,0.4))'
                    : 'rgba(13,42,64,0.8)',
                }}
              />
            )}

            <button
              onClick={() => done && dispatch({ type: 'SET_STAGE', stage: s.id })}
              disabled={!done}
              className="flex items-center gap-1.5 px-1.5 md:px-2 py-1.5 rounded-lg transition-all duration-200 text-xs group"
              style={{ cursor: done ? 'pointer' : 'default' }}
            >
              {/* Numbered node */}
              <div
                className="relative w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300"
                style={{
                  background: active
                    ? 'rgba(0,229,255,0.15)'
                    : done ? 'rgba(0,229,160,0.12)' : 'rgba(13,42,64,0.8)',
                  border: `1px solid ${col}`,
                  boxShadow: active ? `0 0 8px rgba(0,229,255,0.4)` : 'none',
                }}
              >
                {done && !active ? (
                  <CheckCircle size={10} style={{ color: '#00e5a0' }}/>
                ) : (
                  <span
                    className="text-[10px] font-bold leading-none"
                    style={{ color: textCol }}
                  >
                    {s.n}
                  </span>
                )}

                {/* Active pulse ring */}
                {active && (
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      border: '1px solid rgba(0,229,255,0.3)',
                      animation: 'glowPulse 2s ease-in-out infinite',
                    }}
                  />
                )}
              </div>

              {/* Label (desktop only) */}
              <span
                className="hidden md:inline font-semibold tracking-wide transition-colors duration-200 text-[11px]"
                style={{ color: textCol }}
              >
                {s.label}
              </span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
