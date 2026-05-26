/**
 * src/components/AgentHub/AgentHub.tsx
 *
 * bKG Agent Hub — powered by sandbox-agent
 * Universal interface to control coding agents:
 *   pi · Claude Code · Codex · OpenCode · Cursor · Amp
 *
 * Based on https://github.com/rivet-dev/sandbox-agent (MIT License)
 * Fully rebranded and integrated into the bKG workspace.
 *
 * Layout:
 *   ┌── header: status + controls ─────────────────────────────────────┐
 *   ├── agent selector (left)  │  session view (right, SSE stream) ────┤
 *   └──────────────────────────────────────────────────────────────────┘
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Square, Bot, Send, Loader2,
  CheckCircle, XCircle, Terminal, ExternalLink,
  RotateCcw, ChevronRight,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SAStatus {
  running:      boolean;
  reachable:    boolean;
  pid:          number | null;
  port:         number;
  base:         string;
  inspectorUrl: string;
}

interface SAAgent {
  id:   string;
  name: string;
}

interface SessionEvent {
  type: string;
  data: unknown;
  id?:  string;
}

// ── API helpers (via /sandbox/* proxy) ───────────────────────────────────────

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`/sandbox${path}`);
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/sandbox${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ running, reachable }: { running: boolean; reachable: boolean }) {
  if (running && reachable) return <span className="flex items-center gap-1 text-[11px] text-success"><CheckCircle size={11}/>Running</span>;
  if (!running && !reachable) return <span className="flex items-center gap-1 text-[11px] text-error/70"><XCircle size={11}/>Stopped</span>;
  return <span className="flex items-center gap-1 text-[11px] text-warning"><Loader2 size={11} className="animate-spin"/>Starting…</span>;
}

// ── Session event row ─────────────────────────────────────────────────────────

function EventRow({ event }: { event: SessionEvent }) {
  const isAssistant = event.type === 'text' || event.type === 'message';
  const isToolCall  = event.type === 'tool_call' || event.type.includes('tool');
  const text = typeof event.data === 'string'
    ? event.data
    : JSON.stringify(event.data ?? {}).slice(0, 200);

  return (
    <div className={[
      'text-[12px] font-mono leading-relaxed',
      isAssistant ? 'text-text-primary/90'
      : isToolCall ? 'text-accent/80'
      : 'text-muted/60',
    ].join(' ')}>
      {isToolCall && <span className="text-accent/50 mr-1">[{event.type}]</span>}
      {text}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AgentHub() {
  const [status,       setStatus]      = useState<SAStatus | null>(null);
  const [agents,       setAgents]      = useState<SAAgent[]>([]);
  const [selectedAgent, setAgent]      = useState('pi');
  const [sessionId,    setSessionId]   = useState<string | null>(null);
  const [events,       setEvents]      = useState<SessionEvent[]>([]);
  const [draft,        setDraft]       = useState('');
  const [busy,         setBusy]        = useState(false);
  const [err,          setErr]         = useState('');
  const [starting,     setStarting]    = useState(false);
  const [logs,         setLogs]        = useState<string[]>([]);
  const [showLogs,     setShowLogs]    = useState(false);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventIdx   = useRef(0);

  // Auto-scroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [events.length]);

  // ── Load status ─────────────────────────────────────────────────────────────

  const loadStatus = useCallback(async () => {
    try {
      const s = await fetch('/sandbox/status').then(r => r.json()) as SAStatus;
      setStatus(s);
      if (s.reachable) {
        // List available agents
        try {
          const a = await apiGet<{ agents: SAAgent[] }>('/agents');
          setAgents(a.agents ?? []);
        } catch { /**/ }
      }
    } catch { setStatus(null); }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  // ── Start sandbox-agent server ───────────────────────────────────────────────

  const handleStart = async () => {
    setStarting(true); setErr('');
    const r = await fetch('/sandbox/start', { method: 'POST' }).then(r => r.json()).catch(() => ({}));
    if ((r as { error?: string }).error) setErr((r as { error: string }).error);
    setTimeout(() => { void loadStatus(); setStarting(false); }, 2000);
  };

  const handleStop = async () => {
    await fetch('/sandbox/stop', { method: 'POST' });
    setSessionId(null); setEvents([]); clearInterval(pollRef.current ?? undefined);
    setTimeout(() => void loadStatus(), 500);
  };

  // ── Load sandbox-agent logs ──────────────────────────────────────────────────

  const loadLogs = async () => {
    const r = await fetch('/sandbox/logs').then(r => r.json()) as { lines: string[] };
    setLogs(r.lines ?? []);
  };

  // ── Create a session ─────────────────────────────────────────────────────────

  const createSession = async () => {
    setBusy(true); setErr(''); setEvents([]); eventIdx.current = 0;
    try {
      const r = await apiPost<{ id: string }>('/sessions', {
        agent:     selectedAgent,
        agentMode: 'default',
      });
      setSessionId(r.id);
      startEventPoll(r.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create session');
    }
    setBusy(false);
  };

  // ── Poll events via list API ─────────────────────────────────────────────────

  const startEventPoll = useCallback((sid: string) => {
    clearInterval(pollRef.current ?? undefined);
    pollRef.current = setInterval(async () => {
      try {
        const r = await apiGet<{ items: SessionEvent[]; total: number }>(`/sessions/${sid}/events?limit=50&offset=${eventIdx.current}`);
        if (r.items?.length) {
          setEvents(prev => [...prev, ...r.items]);
          eventIdx.current += r.items.length;
        }
      } catch { /**/ }
    }, 800);
  }, []);

  useEffect(() => () => clearInterval(pollRef.current ?? undefined), []);

  // ── Send message ─────────────────────────────────────────────────────────────

  const sendMessage = async () => {
    if (!draft.trim() || !sessionId) return;
    const text = draft.trim();
    setDraft('');
    setBusy(true);
    try {
      await apiPost(`/sessions/${sessionId}/message`, { message: text });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Send failed');
    }
    setBusy(false);
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!status) return (
    <div className="flex items-center justify-center h-full py-24">
      <div className="flex items-center gap-2 text-muted text-sm">
        <Loader2 size={16} className="animate-spin"/>Connecting to bKG Agent Hub…
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 border-b border-border bg-panel">
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-accent/15 border border-accent/30">
          <Bot size={15} className="text-accent"/>
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-text-primary">
            bKG Agent Hub
          </h2>
          <div className="flex items-center gap-3">
            <StatusBadge running={status.running} reachable={status.reachable}/>
            {status.reachable && <span className="text-[11px] text-muted/50">port {status.port}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Inspector link */}
          {status.reachable && (
            <a href={status.inspectorUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted hover:text-accent border border-border hover:border-accent/30 px-2 py-1.5 rounded-lg transition-colors">
              <ExternalLink size={12}/>Inspector
            </a>
          )}

          {/* Logs toggle */}
          <button
            onClick={() => { setShowLogs(p => !p); if (!showLogs) void loadLogs(); }}
            className="flex items-center gap-1 text-xs text-muted hover:text-text-primary border border-border px-2 py-1.5 rounded-lg transition-colors">
            <Terminal size={12}/>Logs
          </button>

          {/* Start / Stop */}
          {status.running ? (
            <button onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-error/15 border border-error/30 text-red-400 hover:bg-error/20 rounded-lg transition-colors">
              <Square size={12}/>Stop
            </button>
          ) : (
            <button onClick={handleStart} disabled={starting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-accent text-base hover:bg-accent-dim btn-glow rounded-lg transition-colors disabled:opacity-50">
              {starting ? <Loader2 size={12} className="animate-spin"/> : <Play size={12}/>}
              Start Hub
            </button>
          )}
        </div>
      </div>

      {/* ── Log panel ── */}
      {showLogs && (
        <div className="flex-shrink-0 bg-[#0d0d16] border-b border-border max-h-32 overflow-y-auto p-2">
          {logs.map((l, i) => <div key={i} className="font-mono text-[11px] text-accent/70">{l}</div>)}
        </div>
      )}

      {err && (
        <div className="flex-shrink-0 px-6 py-2 bg-error/10 border-b border-error/30 text-xs text-red-400">
          {err}
        </div>
      )}

      {/* ── Main content ── */}
      {!status.reachable ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center px-6">
          <Bot size={48} strokeWidth={1} className="text-muted/20"/>
          <div>
            <p className="text-sm font-medium text-text-primary">Agent Hub is not running</p>
            <p className="text-xs text-muted mt-1">
              Click <strong>Start Hub</strong> to launch sandbox-agent (universal coding agent harness)
            </p>
            <p className="text-xs text-muted/60 mt-2">
              Supports: pi · Claude Code · Codex · OpenCode · Cursor · Amp
            </p>
          </div>
          <button onClick={handleStart} disabled={starting}
            className="flex items-center gap-2 px-6 py-3 bg-accent text-base hover:bg-accent-dim btn-glow rounded-xl font-semibold text-sm transition-all cursor-pointer">
            {starting ? <Loader2 size={14} className="animate-spin"/> : <Play size={14}/>}
            Start bKG Agent Hub
          </button>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* ── Left: agent + session ── */}
          <div className="flex flex-col w-64 flex-shrink-0 border-r border-border bg-panel overflow-y-auto p-4 gap-4">
            {/* Agent picker */}
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">Coding Agent</p>
              <div className="flex flex-col gap-1.5">
                {(agents.length > 0 ? agents : [
                  { id:'pi', name:'Pi' },
                  { id:'claude-code', name:'Claude Code' },
                  { id:'codex', name:'Codex (OpenAI)' },
                  { id:'opencode', name:'OpenCode' },
                ]).map(a => (
                  <button key={a.id} onClick={() => setAgent(a.id)}
                    className={[
                      'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors',
                      selectedAgent === a.id
                        ? 'bg-accent/15 border-accent/40 text-accent'
                        : 'border-border text-muted hover:border-accent/30 hover:text-text-primary',
                    ].join(' ')}>
                    <Bot size={13}/>
                    {a.name}
                    {selectedAgent === a.id && <ChevronRight size={11} className="ml-auto"/>}
                  </button>
                ))}
              </div>
            </div>

            {/* Session control */}
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">Session</p>
              {sessionId ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] text-muted font-mono truncate">{sessionId}</p>
                  <button onClick={() => { setSessionId(null); setEvents([]); clearInterval(pollRef.current ?? undefined); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted border border-border hover:border-error/30 hover:text-error rounded-lg transition-colors">
                    <RotateCcw size={11}/>End session
                  </button>
                </div>
              ) : (
                <button onClick={createSession} disabled={busy}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded-lg transition-colors disabled:opacity-50">
                  {busy ? <Loader2 size={12} className="animate-spin"/> : <Play size={12}/>}
                  New session
                </button>
              )}
            </div>
          </div>

          {/* ── Right: events + chat ── */}
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-[#0d0d16]">
            {/* Terminal header */}
            <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 bg-panel border-b border-border">
              <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-error/60"/>
                <span className="w-3 h-3 rounded-full bg-warning/60"/>
                <span className="w-3 h-3 rounded-full bg-success/60"/>
              </div>
              <span className="flex-1 text-center text-[11px] font-mono text-muted/60">
                {sessionId ? `session: ${sessionId}` : 'bkg-agent-hub'}
              </span>
              {busy && <Loader2 size={11} className="text-accent animate-spin"/>}
            </div>

            {/* Events log */}
            <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
              {events.length === 0 && sessionId && (
                <div className="font-mono text-[12px] text-muted/30 italic">
                  Session started. Waiting for agent response…<span className="animate-blink">▌</span>
                </div>
              )}
              {!sessionId && (
                <div className="font-mono text-[12px] text-muted/30 italic">
                  Create a session to start sending messages to the agent.
                </div>
              )}
              {events.map((ev, i) => <EventRow key={i} event={ev}/>)}
              <div ref={bottomRef}/>
            </div>

            {/* Chat input */}
            <div className="flex-shrink-0 flex items-center gap-2 p-3 border-t border-border">
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && void sendMessage()}
                placeholder={sessionId ? `Message to ${selectedAgent} agent…` : 'Create a session first'}
                disabled={!sessionId || busy}
                className="flex-1 bg-base/80 border border-border text-sm text-text-primary font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent/50 placeholder:text-muted/30 disabled:opacity-40"
              />
              <button onClick={() => void sendMessage()} disabled={!draft.trim() || !sessionId || busy}
                className={['flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                  draft.trim() && sessionId && !busy
                    ? 'bg-accent text-base hover:bg-accent-dim cursor-pointer'
                    : 'bg-border/50 text-muted/30 cursor-not-allowed'].join(' ')}>
                {busy ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
