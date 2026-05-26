/**
 * src/components/AgentHub/AgentHub.tsx
 *
 * bKG Agent Hub — pure Node.js implementation
 *
 * Based on sandbox-agent (MIT, rivet-dev/sandbox-agent),
 * fully rebranded and rewritten for bKG in Node.js.
 *
 * Agents: Pi · Claude Code · Codex · OpenCode · Amp
 *
 * Features:
 *   • Agent selection with installation status
 *   • Session lifecycle (create / abort / destroy)
 *   • SSE event streaming with offset-resume
 *   • Permission handling (approve / deny)
 *   • File system browser (list / read / write / delete)
 *   • Process execution with streaming output
 *   • Session persistence via server JSONL
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot, Square, Send, Loader2, CheckCircle, XCircle,
  Terminal, FolderOpen, File, Trash2,
  Plus, Shield, ChevronDown, ChevronUp, Code2,
  AlertTriangle, RefreshCw,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentDef {
  id:          string;
  name:        string;
  description: string;
  installed:   boolean;
  version:     string | null;
  modes:       string[];
  requiresKey: string | null;
  local:       boolean;
}

interface HubSession {
  id:          string;
  agentId:     string;
  mode:        string;
  status:      'idle' | 'running' | 'waiting_permission' | 'error' | 'done';
  cwd:         string;
  createdAt:   string;
  eventCount:  number;
  pendingPermission?: {
    prompt:   string;
    options:  string[];
  } | null;
}

interface HubEvent {
  id:        string;
  ts:        number;
  sessionId: string;
  type:      string;
  data:      unknown;
}

interface FsEntry {
  name:     string;
  type:     'file' | 'dir';
  size:     number;
  modified: number;
}

// ── API ───────────────────────────────────────────────────────────────────────

const api = {
  async get<T>(path: string): Promise<T> {
    const r = await fetch(`/hub${path}`);
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json() as Promise<T>;
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    const r = await fetch(`/hub${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(d.error ?? `${r.status}`);
    }
    return r.json() as Promise<T>;
  },
  async put<T>(path: string, body?: unknown): Promise<T> {
    const r = await fetch(`/hub${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json() as Promise<T>;
  },
  async del(path: string): Promise<void> {
    await fetch(`/hub${path}`, { method: 'DELETE' });
  },
};

// ── Event renderer ────────────────────────────────────────────────────────────

function EventLine({ event }: { event: HubEvent }) {
  const data = event.data as Record<string, unknown>;

  switch (event.type) {
    case 'text':
      return (
        <div className="font-mono text-[12px] text-text-primary/90 leading-relaxed">
          {String(data.content ?? '')}
        </div>
      );
    case 'message':
      if ((data.role as string) === 'user') {
        return (
          <div className="flex items-start gap-2 py-1">
            <span className="text-muted/50 text-[10px] mt-0.5 flex-shrink-0">you</span>
            <span className="font-mono text-[12px] text-muted/80">{String(data.content ?? '')}</span>
          </div>
        );
      }
      return null;
    case 'tool_call':
      return (
        <div className="flex items-center gap-2 py-0.5">
          <Code2 size={10} className="text-accent/60 flex-shrink-0"/>
          <span className="font-mono text-[11px]" style={{ color: '#00e5ff80' }}>
            {String(data.name ?? '')}({JSON.stringify(data.params ?? {}).slice(0, 80)})
          </span>
        </div>
      );
    case 'tool_result':
      return (
        <div className="flex items-start gap-2 py-0.5">
          <CheckCircle size={10} className="text-success/60 flex-shrink-0 mt-0.5"/>
          <span className="font-mono text-[11px] text-muted/60 truncate">
            {String(data.name ?? '')} → {JSON.stringify(data.result ?? '').slice(0, 100)}
          </span>
        </div>
      );
    case 'command_start':
      return (
        <div className="flex items-center gap-2 py-0.5 border-t border-border/20 mt-1">
          <Terminal size={10} className="text-amber/60 flex-shrink-0"/>
          <span className="font-mono text-[11px] text-amber/70">$ {String(data.command ?? '')}</span>
        </div>
      );
    case 'command_delta':
      return (
        <div className={`font-mono text-[11px] whitespace-pre-wrap ${(data.stream as string) === 'stderr' ? 'text-red-400/70' : 'text-text-primary/70'}`}>
          {String(data.text ?? '')}
        </div>
      );
    case 'command_done':
      return (
        <div className="flex items-center gap-1.5 py-0.5 text-[10px] text-muted/40 border-b border-border/20 mb-1">
          <span>exit {String(data.exitCode ?? 0)}</span>
        </div>
      );
    case 'file_change':
      return (
        <div className="flex items-center gap-1.5 py-0.5">
          <File size={9} className="text-accent/40 flex-shrink-0"/>
          <span className="font-mono text-[10px] text-muted/50">
            {String(data.action ?? 'write')} {String(data.path ?? '')}
          </span>
        </div>
      );
    case 'error':
      return (
        <div className="flex items-start gap-1.5 py-0.5">
          <XCircle size={10} className="text-error/60 flex-shrink-0 mt-0.5"/>
          <span className="font-mono text-[11px] text-red-400/80">{String(data.message ?? '')}</span>
        </div>
      );
    case 'status':
      if (!data.status || data.status === 'running') return null;
      return (
        <div className="text-[10px] text-muted/40 py-0.5 font-mono">
          [{String(data.status ?? '')}]
        </div>
      );
    default:
      return null;
  }
}

// ── Permission modal ──────────────────────────────────────────────────────────

function PermissionModal({
  session, onDecision,
}: {
  session:    HubSession;
  onDecision: (approved: boolean) => void;
}) {
  const p = session.pendingPermission;
  if (!p) return null;
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center"
      style={{ background: 'rgba(3,8,16,0.85)', backdropFilter: 'blur(6px)' }}
    >
      <div className="rounded-2xl border max-w-sm w-full mx-4 p-5 flex flex-col gap-4"
        style={{
          background: 'linear-gradient(135deg, rgba(9,22,40,0.98) 0%, rgba(6,15,30,0.99) 100%)',
          borderColor: 'rgba(168,85,247,0.3)',
          boxShadow: '0 0 30px rgba(168,85,247,0.15)',
        }}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center border"
            style={{ background: 'rgba(168,85,247,0.12)', borderColor: 'rgba(168,85,247,0.3)' }}>
            <Shield size={16} style={{ color: '#a855f7' }}/>
          </div>
          <div>
            <p className="text-sm font-bold text-text-primary">Permission Request</p>
            <p className="text-[11px] text-muted/60">The agent needs your approval</p>
          </div>
        </div>
        <div className="px-3 py-3 rounded-xl border border-border/60 bg-base/80">
          <p className="text-sm text-text-primary font-mono">{p.prompt}</p>
        </div>
        <div className="flex gap-2.5">
          <button onClick={() => onDecision(false)}
            className="flex-1 py-2.5 rounded-xl border border-error/30 text-red-400 text-sm font-semibold hover:bg-error/10 transition-all">
            Deny
          </button>
          <button onClick={() => onDecision(true)}
            className="flex-1 py-2.5 rounded-xl bg-accent text-base text-sm font-bold hover:brightness-110 btn-glow transition-all cursor-pointer">
            <CheckCircle size={13} className="inline mr-1"/>Approve
          </button>
        </div>
      </div>
    </div>
  );
}

// ── File browser panel ────────────────────────────────────────────────────────

function FileBrowser({ sessionId }: { sessionId: string }) {
  const [path,    setPath]    = useState('.');
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [loading, setLoading] = useState(false);

  const loadDir = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const r = await api.get<{ entries: FsEntry[] }>(`/sessions/${sessionId}/fs?path=${encodeURIComponent(p)}`);
      setEntries(r.entries ?? []);
      setPath(p); setEditing(null);
    } catch { /**/ }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { void loadDir('.'); }, [loadDir]);

  const openFile = async (name: string) => {
    const filePath = path === '.' ? name : `${path}/${name}`;
    try {
      const r = await api.get<{ content?: string }>(`/sessions/${sessionId}/fs/read?path=${encodeURIComponent(filePath)}`);
      setEditing(filePath);
      setEditVal(r.content ?? '');
    } catch { /**/ }
  };

  const saveFile = async () => {
    if (!editing) return;
    await api.put(`/sessions/${sessionId}/fs/write`, { path: editing, content: editVal });
  };

  const deleteFile = async (name: string) => {
    const filePath = path === '.' ? name : `${path}/${name}`;
    await api.del(`/sessions/${sessionId}/fs/delete?path=${encodeURIComponent(filePath)}`);
    void loadDir(path);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Path bar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-accent/8">
        <FolderOpen size={12} className="text-accent/50"/>
        <span className="font-mono text-[11px] text-muted/60 flex-1 truncate">~/{path}</span>
        <button onClick={() => void loadDir('.')} className="text-muted/40 hover:text-accent transition-colors">
          <RefreshCw size={11}/>
        </button>
      </div>

      {editing ? (
        /* File editor */
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-border/30">
            <span className="font-mono text-[11px] text-accent/70">{editing}</span>
            <div className="flex items-center gap-2">
              <button onClick={saveFile} className="text-[11px] text-success hover:text-success/80 flex items-center gap-1">
                <CheckCircle size={10}/>Save
              </button>
              <button onClick={() => setEditing(null)} className="text-muted/40 hover:text-muted">
                <XCircle size={11}/>
              </button>
            </div>
          </div>
          <textarea
            value={editVal}
            onChange={e => setEditVal(e.target.value)}
            className="flex-1 font-mono text-[11px] text-text-primary bg-transparent resize-none p-3 focus:outline-none"
            spellCheck={false}
          />
        </div>
      ) : (
        /* Directory listing */
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-muted/40 text-xs">
              <Loader2 size={12} className="animate-spin"/>Loading…
            </div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-muted/30 italic">Empty workspace</div>
          ) : (
            entries.map(e => (
              <div key={e.name}
                className="group flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/3 transition-colors cursor-pointer"
                onClick={() => e.type === 'dir' ? void loadDir(path === '.' ? e.name : `${path}/${e.name}`) : void openFile(e.name)}
              >
                {e.type === 'dir'
                  ? <FolderOpen size={12} className="text-amber/50 flex-shrink-0"/>
                  : <File size={12} className="text-accent/40 flex-shrink-0"/>}
                <span className="flex-1 text-[12px] font-mono text-text-primary/80 truncate">{e.name}</span>
                {e.type === 'file' && (
                  <span className="text-[10px] text-muted/30">{(e.size / 1024).toFixed(1)}K</span>
                )}
                <button
                  onClick={ev => { ev.stopPropagation(); void deleteFile(e.name); }}
                  className="opacity-0 group-hover:opacity-100 text-muted/30 hover:text-error transition-all"
                >
                  <Trash2 size={10}/>
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main AgentHub ─────────────────────────────────────────────────────────────

type HubPanel = 'terminal' | 'files' | 'sessions';

export function AgentHub() {
  const [agents,       setAgents]       = useState<AgentDef[]>([]);
  const [sessions,     setSessions]     = useState<HubSession[]>([]);
  const [activeSession,setActiveSession]= useState<HubSession | null>(null);
  const [events,       setEvents]       = useState<HubEvent[]>([]);
  const [draft,        setDraft]        = useState('');
  const [busy,         setBusy]         = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [err,          setErr]          = useState('');
  const [panel,        setPanel]        = useState<HubPanel>('terminal');
  const [agentId,      setAgentId]      = useState('pi');
  const [agentMode,    setAgentMode]    = useState('default');
  const [showAgents,   setShowAgents]   = useState(false);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const esRef      = useRef<EventSource | null>(null);
  const eventIdx   = useRef(0);

  // Auto-scroll terminal
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [events.length]);

  // ── Load hub data ───────────────────────────────────────────────────────────

  const loadHub = useCallback(async () => {
    setLoading(true);
    try {
      const [agentList, sessionList] = await Promise.all([
        api.get<AgentDef[]>('/agents').catch(() => []),
        api.get<HubSession[]>('/sessions').catch(() => []),
      ]);
      setAgents(agentList);
      setSessions(sessionList);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reach bKG Hub');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadHub(); }, [loadHub]);

  // ── SSE subscription ────────────────────────────────────────────────────────

  const connectSSE = useCallback((sessionId: string, fromOffset = 0) => {
    esRef.current?.close();
    eventIdx.current = fromOffset;
    const es = new EventSource(`/hub/sessions/${sessionId}/events?offset=${fromOffset}`);
    es.onmessage = ev => {
      try {
        const event = JSON.parse(ev.data) as HubEvent;
        setEvents(prev => [...prev, event]);
        eventIdx.current++;

        // Update session status on status events
        if (event.type === 'status') {
          const d = event.data as { status?: string; pendingPermission?: unknown };
          setActiveSession(s => s ? { ...s, status: (d.status as HubSession['status']) ?? s.status } : s);
          // Reload sessions list
          api.get<HubSession[]>('/sessions').then(setSessions).catch(()=>{});
        }
      } catch { /**/ }
    };
    es.onerror = () => { setBusy(false); };
    esRef.current = es;
  }, []);

  useEffect(() => () => esRef.current?.close(), []);

  // ── Create session ──────────────────────────────────────────────────────────

  const createNewSession = async () => {
    setBusy(true); setErr('');
    try {
      const session = await api.post<HubSession>('/sessions', {
        agent:     agentId,
        agentMode,
      });
      setActiveSession(session);
      setEvents([]);
      eventIdx.current = 0;
      setSessions(prev => [session, ...prev.filter(s => s.id !== session.id)]);
      connectSSE(session.id, 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create session');
    }
    setBusy(false);
  };

  const openSession = (session: HubSession) => {
    setActiveSession(session);
    setEvents([]);
    connectSSE(session.id, 0);
  };

  const destroySession = async (id: string) => {
    await api.del(`/sessions/${id}`);
    if (activeSession?.id === id) { setActiveSession(null); esRef.current?.close(); setEvents([]); }
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  // ── Send message ────────────────────────────────────────────────────────────

  const sendMessage = async () => {
    if (!draft.trim() || !activeSession || busy) return;
    const text = draft.trim();
    setDraft('');
    setBusy(true);
    try {
      await api.post(`/sessions/${activeSession.id}/message`, { message: text });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Send failed');
    }
    setBusy(false);
  };

  // ── Permission ──────────────────────────────────────────────────────────────

  const handlePermission = async (approved: boolean) => {
    if (!activeSession) return;
    await api.post(`/sessions/${activeSession.id}/permission`, { approved });
    setActiveSession(s => s ? { ...s, pendingPermission: null, status: 'running' } : s);
  };

  // ── Abort ───────────────────────────────────────────────────────────────────

  const abort = async () => {
    if (!activeSession) return;
    await api.post(`/sessions/${activeSession.id}/abort`);
    setBusy(false);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const selectedAgent = agents.find(a => a.id === agentId);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#030810' }}>

      {/* ── Header ── */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b z-20"
        style={{
          background: 'rgba(6,15,30,0.9)',
          backdropFilter: 'blur(12px)',
          borderColor: 'rgba(0,229,255,0.08)',
        }}
      >
        {/* Logo */}
        <div className="w-8 h-8 rounded-xl flex items-center justify-center border flex-shrink-0"
          style={{ background: 'rgba(0,229,255,0.08)', borderColor: 'rgba(0,229,255,0.2)' }}>
          <Bot size={16} className="text-accent"/>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-text-primary" style={{ fontFamily: "'Orbitron', sans-serif", letterSpacing: '0.04em' }}>
            bKG Agent Hub
          </p>
          <p className="text-[10px] text-muted/50 font-mono">
            {loading ? 'loading…' : `${agents.filter(a => a.installed).length} agents · ${sessions.length} sessions`}
          </p>
        </div>

        {/* Panel tabs */}
        <div className="flex items-center gap-0.5 bg-base/80 rounded-lg p-0.5 border border-border/40">
          {([['terminal','Terminal',Terminal],['files','Files',FolderOpen],['sessions','Sessions',Bot]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setPanel(id)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all"
              style={{
                background: panel === id ? 'rgba(0,229,255,0.1)' : 'transparent',
                color:      panel === id ? '#00e5ff' : '#4a6880',
              }}>
              <Icon size={11}/><span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* New session button */}
        <button onClick={createNewSession} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-accent text-base btn-glow hover:brightness-110 transition-all cursor-pointer disabled:opacity-50 flex-shrink-0">
          {busy ? <Loader2 size={12} className="animate-spin"/> : <Plus size={12}/>}
          <span className="hidden sm:inline">New Session</span>
        </button>
      </div>

      {/* Error bar */}
      {err && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-error/10 border-b border-error/20 text-xs text-red-400">
          <AlertTriangle size={11}/>
          {err}
          <button onClick={() => setErr('')} className="ml-auto text-muted/50 hover:text-muted">✕</button>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left sidebar: agent + session picker ── */}
        <div className="flex flex-col w-56 flex-shrink-0 border-r overflow-y-auto"
          style={{ borderColor: 'rgba(0,229,255,0.06)', background: 'rgba(9,22,40,0.5)' }}>

          {/* Agent selector */}
          <div className="px-3 py-3 border-b" style={{ borderColor: 'rgba(0,229,255,0.06)' }}>
            <button onClick={() => setShowAgents(p => !p)}
              className="w-full flex items-center justify-between text-left">
              <div className="flex items-center gap-2">
                <Bot size={13} className="text-accent/60"/>
                <div>
                  <p className="text-xs font-semibold text-text-primary">{selectedAgent?.name ?? agentId}</p>
                  <p className="text-[10px] text-muted/50">{agentMode} mode</p>
                </div>
              </div>
              {showAgents ? <ChevronUp size={12} className="text-muted/40"/> : <ChevronDown size={12} className="text-muted/40"/>}
            </button>

            {showAgents && (
              <div className="mt-2 flex flex-col gap-1">
                {agents.map(a => (
                  <button key={a.id} onClick={() => { setAgentId(a.id); setShowAgents(false); }}
                    disabled={!a.installed}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all"
                    style={{
                      background:  agentId === a.id ? 'rgba(0,229,255,0.08)' : 'transparent',
                      borderColor: agentId === a.id ? 'rgba(0,229,255,0.2)'  : 'transparent',
                      opacity: a.installed ? 1 : 0.4,
                    }}>
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.installed ? 'bg-success' : 'bg-border'}`}/>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-text-primary truncate">{a.name}</p>
                      {!a.installed && <p className="text-[9px] text-muted/40">not installed</p>}
                    </div>
                    {a.local && <span className="text-[9px] text-accent/50 font-mono">local</span>}
                  </button>
                ))}

                {/* Mode picker */}
                {(selectedAgent ?? agents.find(a => a.id === agentId)) && (
                  <div className="mt-1 pt-1 border-t border-border/30">
                    <p className="text-[9px] text-muted/40 px-1 mb-1">MODE</p>
                    <div className="flex gap-1 flex-wrap">
                      {(selectedAgent?.modes ?? ['default']).map(m => (
                        <button key={m} onClick={() => setAgentMode(m)}
                          className="px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all"
                          style={{
                            background:   agentMode === m ? 'rgba(0,229,255,0.1)' : 'transparent',
                            borderColor:  agentMode === m ? 'rgba(0,229,255,0.3)' : 'rgba(13,42,64,0.6)',
                            color:        agentMode === m ? '#00e5ff' : '#4a6880',
                          }}>
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sessions list */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            <p className="text-[9px] text-muted/40 font-bold uppercase tracking-wider px-1 mb-1.5">
              Sessions ({sessions.length})
            </p>
            {sessions.length === 0 ? (
              <p className="text-[11px] text-muted/30 px-1 italic">No sessions yet</p>
            ) : (
              sessions.map(s => {
                const isActive = activeSession?.id === s.id;
                const statusColor =
                  s.status === 'running' ? '#00e5ff' :
                  s.status === 'waiting_permission' ? '#a855f7' :
                  s.status === 'error' ? '#ff3d6b' :
                  '#4a6880';
                return (
                  <div key={s.id}
                    className="group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-all mb-0.5"
                    style={{
                      background: isActive ? 'rgba(0,229,255,0.06)' : 'transparent',
                    }}
                    onClick={() => openSession(s)}
                  >
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusColor }}/>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-mono text-text-primary/80 truncate">{s.id.slice(0, 16)}</p>
                      <p className="text-[9px] text-muted/40">{s.agentId} · {s.eventCount} events</p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); void destroySession(s.id); }}
                      className="opacity-0 group-hover:opacity-100 text-muted/30 hover:text-error transition-all"
                    >
                      <Trash2 size={10}/>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right: main panel ── */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden relative">

          {/* Permission modal */}
          {activeSession?.pendingPermission && (
            <PermissionModal session={activeSession} onDecision={handlePermission}/>
          )}

          {/* Panel: Terminal */}
          {panel === 'terminal' && (
            <>
              {/* Terminal header bar */}
              <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b"
                style={{ borderColor: 'rgba(0,229,255,0.06)', background: 'rgba(9,22,40,0.6)' }}>
                <div className="flex gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-error/50"/>
                  <span className="w-2.5 h-2.5 rounded-full bg-warning/50"/>
                  <span className="w-2.5 h-2.5 rounded-full bg-success/50"/>
                </div>
                <span className="flex-1 text-center text-[10px] font-mono text-muted/40">
                  {activeSession ? `${activeSession.agentId} · ${activeSession.id.slice(0, 20)}` : 'bkg-agent-hub'}
                </span>
                <div className="flex items-center gap-2">
                  {activeSession?.status === 'running' && (
                    <Loader2 size={10} className="text-accent animate-spin"/>
                  )}
                  {activeSession && (
                    <button onClick={abort} className="text-muted/30 hover:text-warning transition-colors">
                      <Square size={11}/>
                    </button>
                  )}
                </div>
              </div>

              {/* Events log */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5"
                style={{ background: '#030810' }}>
                {!activeSession ? (
                  <div className="flex flex-col items-center gap-4 py-16 text-center">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center border"
                      style={{ background: 'rgba(0,229,255,0.06)', borderColor: 'rgba(0,229,255,0.12)' }}>
                      <Bot size={28} className="text-accent/40"/>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-text-primary/60">No active session</p>
                      <p className="text-xs text-muted/40 mt-1">
                        Click <strong className="text-text-primary/60">New Session</strong> to start a coding agent
                      </p>
                    </div>
                  </div>
                ) : events.length === 0 ? (
                  <div className="font-mono text-[12px] text-muted/30 italic py-2">
                    Session ready. Send a message to start.
                    <span className="animate-blink">▌</span>
                  </div>
                ) : (
                  events.map((ev, i) => <EventLine key={ev.id ?? i} event={ev}/>)
                )}
                <div ref={bottomRef}/>
              </div>

              {/* Input */}
              <form onSubmit={e => { e.preventDefault(); void sendMessage(); }}
                className="flex-shrink-0 flex items-center gap-2 p-3 border-t"
                style={{ borderColor: 'rgba(0,229,255,0.08)', background: 'rgba(6,15,30,0.8)' }}>
                <input
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  placeholder={activeSession ? 'Message the agent…' : 'Create a session first'}
                  disabled={!activeSession || busy}
                  className="flex-1 font-mono text-sm text-text-primary bg-base/80 border border-border rounded-xl px-3 py-2 focus:outline-none focus:border-accent/40 placeholder:text-muted/30 disabled:opacity-40"
                />
                {busy ? (
                  <button type="button" onClick={abort}
                    className="flex-shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl border border-warning/30 text-amber text-xs font-semibold hover:bg-warning/10 transition-all">
                    <Square size={11}/>Stop
                  </button>
                ) : (
                  <button type="submit" disabled={!draft.trim() || !activeSession}
                    className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-accent text-base btn-glow hover:brightness-110 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
                    <Send size={14}/>
                  </button>
                )}
              </form>
            </>
          )}

          {/* Panel: Files */}
          {panel === 'files' && (
            <div className="flex-1 min-h-0">
              {activeSession ? (
                <FileBrowser sessionId={activeSession.id}/>
              ) : (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <FolderOpen size={32} strokeWidth={1} className="text-muted/20"/>
                  <p className="text-sm text-muted/40">Create a session to browse its workspace</p>
                </div>
              )}
            </div>
          )}

          {/* Panel: Sessions */}
          {panel === 'sessions' && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex flex-col gap-2">
                {sessions.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-16 text-center">
                    <Bot size={32} strokeWidth={1} className="text-muted/20"/>
                    <p className="text-sm text-muted/40">No sessions yet</p>
                  </div>
                ) : (
                  sessions.map(s => (
                    <div key={s.id}
                      className="rounded-xl border p-4 cursor-pointer transition-all hover:border-accent/25"
                      style={{
                        background: activeSession?.id === s.id ? 'rgba(0,229,255,0.04)' : 'rgba(9,22,40,0.6)',
                        borderColor: activeSession?.id === s.id ? 'rgba(0,229,255,0.2)' : 'rgba(13,42,64,0.8)',
                      }}
                      onClick={() => { openSession(s); setPanel('terminal'); }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Bot size={14} className="text-accent/60"/>
                          <span className="text-sm font-bold text-text-primary">{s.agentId}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium"
                            style={{
                              background:  'rgba(0,229,255,0.06)',
                              borderColor: 'rgba(0,229,255,0.15)',
                              color:       '#00e5ff80',
                            }}>{s.mode}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            s.status === 'running' ? 'bg-success animate-pulse' :
                            s.status === 'error'   ? 'bg-error' : 'bg-border'
                          }`}/>
                          <span className="text-[11px] text-muted/50">{s.status}</span>
                          <button onClick={e => { e.stopPropagation(); void destroySession(s.id); }}
                            className="text-muted/30 hover:text-error transition-colors">
                            <Trash2 size={12}/>
                          </button>
                        </div>
                      </div>
                      <p className="font-mono text-[11px] text-muted/40 truncate">{s.id}</p>
                      <p className="text-[11px] text-muted/40 mt-0.5">
                        {s.eventCount} events · created {new Date(s.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
