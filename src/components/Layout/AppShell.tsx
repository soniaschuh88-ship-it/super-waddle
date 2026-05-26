/** src/components/Layout/AppShell.tsx – Top-level layout with fixed header. */
import { type ReactNode } from 'react';
import { Cpu, X, Settings, LayoutDashboard, Plus, Bot } from 'lucide-react';
import { StageProgress } from './StageProgress';
import { useAppState }   from '@/context/AppContext';

export function AppShell({ children }: { children: ReactNode }) {
  const { state, dispatch } = useAppState();
  const isHome = state.stage === 'home';

  return (
    <div className="flex flex-col h-screen bg-base text-text-primary overflow-hidden">
      <header className="flex-shrink-0 h-14 flex items-center justify-between px-4 md:px-6 border-b border-border glass z-20">

        {/* Logo + breadcrumb */}
        <div className="flex items-center gap-2.5 select-none">
          <button
            onClick={() => dispatch({ type: 'SET_STAGE', stage: 'home' })}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            title="Go to dashboard"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/15 border border-accent/30">
              <Cpu size={18} className="text-accent"/>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-semibold text-text-primary tracking-tight">bKG</span>
              <span className="text-[10px] text-accent font-mono tracking-widest">best Known Garbage</span>
            </div>
          </button>

          {/* Active project breadcrumb */}
          {state.project && !isHome && (
            <>
              <span className="text-border mx-0.5">/</span>
              <span className="text-xs text-muted truncate max-w-[130px] md:max-w-xs font-mono">
                {state.project.idea_text.slice(0, 50)}{state.project.idea_text.length > 50 ? '…' : ''}
              </span>
            </>
          )}
        </div>

        {/* Stage progress stepper (hidden on home) */}
        <StageProgress/>

        {/* Right-side nav */}
        <div className="flex items-center gap-1">
          {/* Back to dashboard */}
          {!isHome && (
            <button
              onClick={() => dispatch({ type: 'SET_STAGE', stage: 'home' })}
              className="flex items-center gap-1 text-xs text-muted hover:text-text-primary px-2 py-1.5 rounded hover:bg-surface transition-colors"
            >
              <LayoutDashboard size={13}/>
              <span className="hidden sm:inline">Dashboard</span>
            </button>
          )}

          {/* New plan shortcut (when on dashboard) */}
          {isHome && (
            <button
              onClick={() => dispatch({ type: 'SET_STAGE', stage: 'stufe1' })}
              className="flex items-center gap-1 text-xs text-accent border border-accent/30 bg-accent/8 hover:bg-accent/15 px-2.5 py-1.5 rounded-lg transition-colors"
              style={{ background: 'rgba(0,212,170,0.06)' }}
            >
              <Plus size={12}/>
              <span>New Plan</span>
            </button>
          )}

          {/* Agent Hub link */}
          <button
            onClick={() => dispatch({ type: 'SET_STAGE', stage: 'agenthub' })}
            className={['flex items-center gap-1 text-xs px-2 py-1.5 rounded hover:bg-surface transition-colors',
              state.stage === 'agenthub' ? 'text-accent' : 'text-muted hover:text-text-primary'].join(' ')}
          >
            <Bot size={13}/>
            <span className="hidden sm:inline">Agents</span>
          </button>

          {/* Admin link (shows label on larger screens) */}
          <a
            href="/admin"
            className="flex items-center gap-1 text-xs text-muted hover:text-accent px-2 py-1.5 rounded hover:bg-surface transition-colors"
            title="Admin Dashboard"
          >
            <Settings size={13}/>
            <span className="hidden md:inline">Admin</span>
          </a>
        </div>
      </header>

      {/* Global error banner */}
      {state.globalError && (
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 bg-error/10 border-b border-error/30 text-sm text-red-300">
          <span>{state.globalError}</span>
          <button onClick={() => dispatch({ type: 'CLEAR_ERROR' })} className="hover:text-white transition-colors">
            <X size={16}/>
          </button>
        </div>
      )}

      <main className="flex-1 overflow-auto min-h-0">{children}</main>
    </div>
  );
}
