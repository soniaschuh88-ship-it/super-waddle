/**
 * src/components/Layout/AppShell.tsx
 *
 * Full-screen responsive layout shell.
 * Mobile: hamburger → slide-in drawer nav
 * Desktop: horizontal header with inline nav
 *
 * Design: Atlantis Cyberpunk — deep ocean darkness,
 * bioluminescent cyan glows, rune geometry.
 */
import { type ReactNode, useState, useEffect, useRef } from 'react';
import {
  Cpu, X, Settings, LayoutDashboard, Plus, Bot,
  Menu, ChevronRight, Lock, Cloud,
} from 'lucide-react';
import { StageProgress }  from './StageProgress';
import { useAppState }    from '@/context/AppContext';

// ── Rune corner decoration ────────────────────────────────────────────────────

// ── Logo mark ─────────────────────────────────────────────────────────────────

function BKGLogo({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative flex items-center gap-2.5 group select-none"
      title="bKG Dashboard"
    >
      {/* Hex icon */}
      <div className="relative w-9 h-9 flex items-center justify-center flex-shrink-0">
        <svg width="36" height="36" viewBox="0 0 36 36" className="absolute inset-0">
          <polygon
            points="18,2 33,10.5 33,25.5 18,34 3,25.5 3,10.5"
            fill="none"
            stroke="rgba(0,229,255,0.6)"
            strokeWidth="1"
            className="group-hover:stroke-[rgba(0,229,255,0.9)] transition-all duration-300"
          />
          <polygon
            points="18,7 28,12.5 28,23.5 18,29 8,23.5 8,12.5"
            fill="rgba(0,229,255,0.05)"
            stroke="rgba(0,229,255,0.2)"
            strokeWidth="0.5"
          />
        </svg>
        <Cpu size={15} className="text-accent group-hover:scale-110 transition-transform duration-300 relative z-10"/>
        {/* Orbital ring */}
        <div
          className="absolute inset-0 rounded-full border border-accent/10 group-hover:border-accent/25"
          style={{ animation: 'glowPulse 3s ease-in-out infinite' }}
        />
      </div>

      {/* Text */}
      <div className="flex flex-col leading-none">
        <span
          className="text-base font-bold tracking-wider"
          style={{
            fontFamily: "'Orbitron', sans-serif",
            background: 'linear-gradient(135deg, #00e5ff 0%, #a855f7 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            textShadow: 'none',
          }}
        >
          bKG
        </span>
        <span className="text-[9px] text-accent/50 font-mono tracking-[0.25em] uppercase mt-0.5">
          best Known Garbage
        </span>
      </div>
    </button>
  );
}

// ── Mode badge (Private / Cloud) ──────────────────────────────────────────────

function ModeBadge({ mode, onClick }: { mode: 'private' | 'cloud'; onClick: () => void }) {
  const isPrivate = mode === 'private';
  return (
    <button
      onClick={onClick}
      className={[
        'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold',
        'transition-all duration-200 cursor-pointer',
        isPrivate
          ? 'bg-amber/8 border-amber/30 text-amber hover:bg-amber/15 hover:border-amber/50'
          : 'bg-accent/8 border-accent/30 text-accent hover:bg-accent/15 hover:border-accent/50',
      ].join(' ')}
      style={{
        boxShadow: isPrivate
          ? '0 0 8px rgba(255,179,0,0.15)'
          : '0 0 8px rgba(0,229,255,0.15)',
      }}
      title="Switch mode"
    >
      {isPrivate ? <Lock size={10}/> : <Cloud size={10}/>}
      {isPrivate ? 'PRIVATE' : 'CLOUD'}
    </button>
  );
}

// ── Mobile drawer overlay ─────────────────────────────────────────────────────

interface DrawerProps {
  open:     boolean;
  onClose:  () => void;
  stage:    string;
  onNav:    (s: string) => void;
  mode:     'private' | 'cloud';
  onMode:   () => void;
}

function MobileDrawer({ open, onClose, stage, onNav, mode, onMode }: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  const nav = (s: string) => { onNav(s); onClose(); };
  const isPrivate = mode === 'private';

  const NAV_ITEMS = [
    { id: 'home',     icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'stufe1',   icon: Plus,            label: 'New Plan'  },
    { id: 'agenthub', icon: Bot,             label: 'Agents'    },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className={[
          'fixed inset-0 z-40 bg-base/80 backdrop-blur-sm transition-opacity duration-300',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
        aria-hidden
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={[
          'fixed left-0 top-0 h-full w-64 z-50 flex flex-col',
          'bg-surface border-r border-accent/15 shadow-deep',
          'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        style={{ boxShadow: '4px 0 40px rgba(0,229,255,0.08)' }}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-accent/10">
          <BKGLogo onClick={() => nav('home')}/>
          <button onClick={onClose} className="text-muted hover:text-accent p-1.5 rounded-lg transition-colors">
            <X size={16}/>
          </button>
        </div>

        {/* Mode toggle */}
        <div className="px-4 py-3 border-b border-border/50">
          <button
            onClick={onMode}
            className={[
              'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all',
              isPrivate
                ? 'bg-amber/8 border-amber/30 text-amber'
                : 'bg-accent/8 border-accent/30 text-accent',
            ].join(' ')}
          >
            {isPrivate ? <Lock size={14}/> : <Cloud size={14}/>}
            <div className="flex-1 text-left">
              <p className="text-xs font-bold tracking-wider">
                {isPrivate ? 'PRIVATE MODE' : 'CLOUD MODE'}
              </p>
              <p className="text-[10px] opacity-60">
                {isPrivate ? 'Local models only' : 'Free cloud providers'}
              </p>
            </div>
            <ChevronRight size={12} className="opacity-50"/>
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-3 flex flex-col gap-1">
          {NAV_ITEMS.map(item => {
            const Icon   = item.icon;
            const active = stage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => nav(item.id)}
                className={[
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                  active
                    ? 'bg-accent/12 text-accent border border-accent/25'
                    : 'text-muted hover:text-text-primary hover:bg-white/4',
                ].join(' ')}
                style={active ? { boxShadow: '0 0 12px rgba(0,229,255,0.1)' } : undefined}
              >
                <Icon size={16}/>
                {item.label}
                {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent animate-glow-pulse"/>}
              </button>
            );
          })}
        </nav>

        {/* Admin link */}
        <div className="px-3 pb-4 border-t border-border/50 pt-3">
          <a
            href="/admin"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted hover:text-accent hover:bg-accent/6 transition-all"
          >
            <Settings size={16}/>Admin Dashboard
          </a>
        </div>

        {/* Corner decorations */}
        <div className="absolute bottom-0 left-0 w-full h-1"
          style={{ background: 'linear-gradient(90deg, rgba(0,229,255,0.3), rgba(168,85,247,0.2), transparent)' }}
        />
      </div>
    </>
  );
}

// ── Main AppShell ─────────────────────────────────────────────────────────────

export function AppShell({ children }: { children: ReactNode }) {
  const { state, dispatch } = useAppState();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Read mode from localStorage (or default 'private')
  const [mode, setMode] = useState<'private' | 'cloud'>(() => {
    return (localStorage.getItem('bkg_mode') as 'private' | 'cloud') ?? 'private';
  });

  const toggleMode = () => {
    const next = mode === 'private' ? 'cloud' : 'private';
    setMode(next);
    localStorage.setItem('bkg_mode', next);
    // Dispatch mode change
    dispatch({ type: 'SET_MODE', mode: next });
  };

  // Close drawer on stage change
  useEffect(() => { setDrawerOpen(false); }, [state.stage]);

  const goStage = (s: string) => {
    dispatch({ type: 'SET_STAGE', stage: s as import('@/types').Stage });
  };

  const isHome     = state.stage === 'home';
  const isPrivate  = mode === 'private';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-base relative" style={{ maxWidth: '100vw' }}>

      {/* ── Top scan-line ambient ── */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 right-0 h-px z-10"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.5), rgba(168,85,247,0.3), transparent)' }}
      />

      {/* ── Header ── */}
      <header className="glass flex-shrink-0 h-14 flex items-center px-3 sm:px-5 gap-3 z-30 relative">

        {/* Mobile hamburger */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex md:hidden items-center justify-center w-9 h-9 rounded-xl border border-border/60 text-muted hover:text-accent hover:border-accent/40 transition-all"
          aria-label="Open menu"
        >
          <Menu size={18}/>
        </button>

        {/* Logo */}
        <BKGLogo onClick={() => goStage('home')}/>

        {/* Separator */}
        <div className="hidden md:block w-px h-6 bg-accent/10 mx-1"/>

        {/* Breadcrumb / stage badge (desktop) */}
        {!isHome && state.project && (
          <div className="hidden md:flex items-center gap-2 text-xs text-muted/70 overflow-hidden">
            <span className="text-accent/40">/</span>
            <span className="font-mono truncate max-w-[160px] lg:max-w-xs">
              {state.project.idea_text.slice(0, 48)}{state.project.idea_text.length > 48 ? '…' : ''}
            </span>
          </div>
        )}

        {/* Stage progress (centre, desktop only) */}
        <div className="hidden md:flex flex-1 justify-center">
          <StageProgress/>
        </div>

        {/* Right-side controls */}
        <div className="flex items-center gap-1.5 ml-auto">
          {/* Mode badge */}
          <ModeBadge mode={mode} onClick={toggleMode}/>

          {/* Desktop nav links */}
          {!isHome && (
            <button
              onClick={() => goStage('home')}
              className="hidden md:flex items-center gap-1.5 text-xs text-muted hover:text-accent px-2.5 py-1.5 rounded-lg hover:bg-accent/6 transition-all border border-transparent hover:border-accent/15"
            >
              <LayoutDashboard size={13}/>
              <span>Dashboard</span>
            </button>
          )}

          {isHome && (
            <button
              onClick={() => { dispatch({ type: 'CLEAR_PROJECT' }); goStage('stufe1'); }}
              className="hidden md:flex items-center gap-1.5 text-[12px] font-bold text-base bg-accent rounded-lg px-3 py-1.5 hover:brightness-110 transition-all cursor-pointer"
              style={{ boxShadow: '0 0 12px rgba(0,229,255,0.3)' }}
            >
              <Plus size={12}/>New Plan
            </button>
          )}

          {/* Agents */}
          <button
            onClick={() => goStage('agenthub')}
            className={[
              'hidden md:flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all',
              state.stage === 'agenthub'
                ? 'text-accent border-accent/30 bg-accent/8'
                : 'text-muted border-transparent hover:text-accent hover:bg-accent/6 hover:border-accent/15',
            ].join(' ')}
          >
            <Bot size={13}/><span>Agents</span>
          </button>

          {/* Admin */}
          <a
            href="/admin"
            className="hidden md:flex items-center gap-1.5 text-xs text-muted hover:text-accent px-2.5 py-1.5 rounded-lg hover:bg-accent/6 border border-transparent hover:border-accent/15 transition-all"
          >
            <Settings size={13}/><span>Admin</span>
          </a>
        </div>
      </header>

      {/* Mobile mode bar */}
      <div className="flex sm:hidden items-center justify-between px-3 py-1.5 border-b border-border/40"
        style={{ background: 'rgba(6,15,30,0.6)' }}>
        <StageProgress/>
        <button
          onClick={toggleMode}
          className={[
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold',
            isPrivate
              ? 'bg-amber/8 border-amber/30 text-amber'
              : 'bg-accent/8 border-accent/30 text-accent',
          ].join(' ')}
        >
          {isPrivate ? <Lock size={9}/> : <Cloud size={9}/>}
          {isPrivate ? 'PRIVATE' : 'CLOUD'}
        </button>
      </div>

      {/* Global error banner */}
      {state.globalError && (
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2 bg-error/10 border-b border-error/25 text-xs text-red-400">
          <span>{state.globalError}</span>
          <button onClick={() => dispatch({ type: 'CLEAR_ERROR' })} className="hover:text-white transition-colors">
            <X size={14}/>
          </button>
        </div>
      )}

      {/* Mode banner */}
      {isHome && (
        <div
          className="flex-shrink-0 flex items-center gap-2 px-3 sm:px-4 py-1.5 text-[11px] overflow-hidden"
          style={{
            background: isPrivate
              ? 'linear-gradient(90deg, rgba(255,179,0,0.05) 0%, transparent 100%)'
              : 'linear-gradient(90deg, rgba(0,229,255,0.05) 0%, transparent 100%)',
            borderBottom: isPrivate ? '1px solid rgba(255,179,0,0.1)' : '1px solid rgba(0,229,255,0.1)',
          }}
        >
          {isPrivate ? (
            <>
              <Lock size={10} className="text-amber flex-shrink-0"/>
              <span className="text-amber/80 font-bold flex-shrink-0">PRIVATE</span>
              <span className="text-muted/60 truncate hidden xs:block">Local WebGPU · Ollama · llama-cpp</span>
            </>
          ) : (
            <>
              <Cloud size={10} className="text-accent flex-shrink-0"/>
              <span className="text-accent/80 font-bold flex-shrink-0">CLOUD</span>
              <span className="text-muted/60 truncate hidden xs:block">Free providers: Groq · NVIDIA · OpenRouter</span>
            </>
          )}
          <button
            onClick={toggleMode}
            className="ml-auto text-muted/50 hover:text-accent transition-colors text-[10px] underline underline-offset-2"
          >
            Switch
          </button>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto min-h-0 relative">
        {children}
      </main>

      {/* Mobile drawer */}
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        stage={state.stage}
        onNav={goStage}
        mode={mode}
        onMode={toggleMode}
      />

      {/* Bottom ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-0 left-1/2 -translate-x-1/2 w-[60vw] h-px"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(168,85,247,0.3), rgba(0,229,255,0.2), transparent)' }}
      />
    </div>
  );
}
