/** src/components/Layout/AppShell.tsx – Top-level layout with fixed header. */
import { type ReactNode } from 'react';
import { Cpu, X, Settings } from 'lucide-react';
import { StageProgress } from './StageProgress';
import { useAppState } from '@/context/AppContext';

export function AppShell({ children }: { children: ReactNode }) {
  const { state, dispatch } = useAppState();
  return (
    <div className="flex flex-col h-screen bg-base text-text-primary overflow-hidden">
      <header className="flex-shrink-0 h-14 flex items-center justify-between px-4 md:px-6 border-b border-border glass z-20">
        <div className="flex items-center gap-2.5 select-none">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/15 border border-accent/30">
            <Cpu size={18} className="text-accent" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold text-text-primary tracking-tight">ICADP</span>
            <span className="text-[10px] text-accent font-mono tracking-widest">v3.0</span>
          </div>
          {state.project && (
            <>
              <span className="text-border mx-1">·</span>
              <span className="text-xs text-muted truncate max-w-[160px] md:max-w-xs font-mono">
                {state.project.idea_text.slice(0,60)}{state.project.idea_text.length>60?'…':''}
              </span>
            </>
          )}
        </div>
        <StageProgress />
        <div className="flex items-center gap-2">
          <a href="/admin" className="hidden md:flex items-center gap-1 text-xs text-muted hover:text-accent px-2 py-1 rounded hover:bg-surface transition-colors" title="Admin Dashboard">
            <Settings size={13}/><span>Admin</span>
          </a>
          {state.project && (
            <button onClick={()=>dispatch({type:'CLEAR_PROJECT'})} className="hidden md:flex items-center gap-1 text-xs text-muted hover:text-text-primary px-2 py-1 rounded hover:bg-surface transition-colors">
              New
            </button>
          )}
        </div>
      </header>
      {state.globalError && (
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 bg-error/10 border-b border-error/30 text-sm text-red-300">
          <span>{state.globalError}</span>
          <button onClick={()=>dispatch({type:'CLEAR_ERROR'})} className="hover:text-white transition-colors"><X size={16}/></button>
        </div>
      )}
      <main className="flex-1 overflow-auto min-h-0">{children}</main>
    </div>
  );
}
