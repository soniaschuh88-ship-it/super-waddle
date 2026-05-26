/**
 * src/components/Flow/FlowTask.tsx
 *
 * bKG Flow — Task Detail Modal
 *
 * Shows full task data: PROMPT.md, workflow steps, comments, logs,
 * evaluations. Supports inline editing, AI planning, status moves.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, CheckSquare, Square, Plus,
  Zap, MessageSquare, Terminal, BarChart2,
  Edit3, Save, Loader2, Code2, Bot,
  GitBranch, Tag, ArrowRight, CheckCircle2,
} from 'lucide-react';
import type { FlowTask } from './FlowBoard';
import { useAppState } from '@/context/AppContext';

interface Comment {
  id:         string;
  author:     string;
  body:       string;
  created_at: number;
}

interface WorkflowStep {
  id:          string;
  title:       string;
  phase:       string;
  status:      string;
  output:      string;
  order_index: number;
}

interface LogEntry {
  id:         string;
  level:      'info' | 'warn' | 'error';
  message:    string;
  created_at: number;
}

interface Eval {
  id:         string;
  score:      number;
  band:       string;
  evidence:   Record<string, unknown>;
  created_at: number;
}

type Tab = 'overview' | 'plan' | 'steps' | 'comments' | 'logs' | 'evals';

// ── Status flow ───────────────────────────────────────────────────────────────

const STATUS_NEXT: Record<string, string> = {
  planning:     'todo',
  todo:         'in-progress',
  'in-progress': 'review',
  review:       'done',
  done:         'archived',
};

const STATUS_COLORS: Record<string, string> = {
  planning:     '#a855f7',
  todo:         '#4a6880',
  'in-progress': '#00e5ff',
  review:       '#ffb300',
  done:         '#00e5a0',
  archived:     '#2a3a4a',
};

const PRIORITY_LABELS = ['Low','','','','','Medium','','','','','High'];

// ── Markdown renderer (minimal) ───────────────────────────────────────────────

function MarkdownView({ md }: { md: string }) {
  const lines = md.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('### ')) { elements.push(<h3 key={i} className="text-sm font-bold text-text-primary mt-4 mb-1.5">{l.slice(4)}</h3>); }
    else if (l.startsWith('## ')) { elements.push(<h2 key={i} className="text-base font-bold text-accent mt-5 mb-2" style={{ fontFamily: "'Orbitron',sans-serif", letterSpacing:'0.04em' }}>{l.slice(3)}</h2>); }
    else if (l.startsWith('# ')) { elements.push(<h1 key={i} className="text-lg font-bold text-text-primary mt-2 mb-3" style={{ fontFamily: "'Orbitron',sans-serif" }}>{l.slice(2)}</h1>); }
    else if (l.startsWith('- [ ] ')) { elements.push(<div key={i} className="flex items-center gap-2 py-0.5"><Square size={12} className="text-muted/50 flex-shrink-0"/><span className="text-sm text-text-primary/80">{l.slice(6)}</span></div>); }
    else if (l.startsWith('- [x] ')) { elements.push(<div key={i} className="flex items-center gap-2 py-0.5"><CheckSquare size={12} className="text-success flex-shrink-0"/><span className="text-sm text-text-primary/60 line-through">{l.slice(6)}</span></div>); }
    else if (l.startsWith('- ')) { elements.push(<div key={i} className="flex items-start gap-2 py-0.5"><div className="w-1 h-1 rounded-full bg-accent/50 mt-2 flex-shrink-0"/><span className="text-sm text-text-primary/80">{l.slice(2)}</span></div>); }
    else if (/^\d+\. /.test(l)) {
      const num = l.match(/^(\d+)\. /)?.[1] ?? '1';
      elements.push(<div key={i} className="flex items-start gap-2 py-0.5"><span className="text-[11px] font-mono text-accent/60 mt-0.5 flex-shrink-0">{num}.</span><span className="text-sm text-text-primary/80">{l.replace(/^\d+\. /, '')}</span></div>);
    }
    else if (l.trim() === '') { elements.push(<div key={i} className="h-2"/>); }
    else { elements.push(<p key={i} className="text-sm text-text-primary/80 leading-relaxed">{l}</p>); }
    i++;
  }
  return <div className="flex flex-col gap-0">{elements}</div>;
}

// ── Main FlowTask modal ───────────────────────────────────────────────────────

export function FlowTask({
  task,
  onClose,
  onUpdate,
}: {
  task:     FlowTask;
  onClose:  () => void;
  onUpdate: (updated: FlowTask) => void;
}) {
  const [tab,         setTab]         = useState<Tab>('overview');
  const [t,           setT]           = useState<FlowTask>(task);
  const [editing,     setEditing]     = useState<'title' | 'description' | null>(null);
  const [editDraft,   setEditDraft]   = useState('');
  const [comments,    setComments]    = useState<Comment[]>([]);
  const [steps,       setSteps]       = useState<WorkflowStep[]>([]);
  const [logs,        setLogs]        = useState<LogEntry[]>([]);
  const [evals,       setEvals]       = useState<Eval[]>([]);
  const [commentDraft,setCommentDraft]= useState('');
  const [stepDraft,   setStepDraft]   = useState('');
  const [busy,        setBusy]        = useState(false);
  const [planning,    setPlanning]    = useState(false);
  const [running,     setRunning]     = useState(false);

  const { dispatch } = useAppState();
  const logsRef = useRef<HTMLDivElement>(null);

  // ── Load related data ───────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (tab === 'comments') {
      const r = await fetch(`/flow/tasks/${t.id}/comments`).then(r => r.json()).catch(() => []);
      setComments(r as Comment[]);
    }
    if (tab === 'steps') {
      const r = await fetch(`/flow/tasks/${t.id}/steps`).then(r => r.json()).catch(() => []);
      setSteps(r as WorkflowStep[]);
    }
    if (tab === 'logs') {
      const r = await fetch(`/flow/tasks/${t.id}/logs`).then(r => r.json()).catch(() => []);
      setLogs(r as LogEntry[]);
    }
    if (tab === 'evals') {
      const r = await fetch(`/flow/tasks/${t.id}/evals`).then(r => r.json()).catch(() => []);
      setEvals(r as Eval[]);
    }
  }, [tab, t.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    logsRef.current?.scrollTo(0, logsRef.current.scrollHeight);
  }, [logs.length]);

  // ── Mutations ───────────────────────────────────────────────────────────────

  const save = async (updates: Partial<FlowTask>) => {
    const r = await fetch(`/flow/tasks/${t.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (r.ok) {
      const updated = await r.json() as FlowTask;
      setT(updated); onUpdate(updated);
    }
  };

  const moveNext = async () => {
    const next = STATUS_NEXT[t.status];
    if (!next) return;
    setBusy(true);
    await save({ status: next as FlowTask['status'] });
    setBusy(false);
  };

  const planWithAI = async () => {
    setPlanning(true);
    const userKey = localStorage.getItem('bkg_user_api_key');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userKey) headers['Authorization'] = `Bearer ${userKey}`;

    const r = await fetch(`/flow/tasks/${t.id}/plan`, {
      method: 'POST', headers,
      body: JSON.stringify({ providerId: 'groq', model: 'llama-3.3-70b-versatile' }),
    });
    if (r.ok) {
      const updated = await r.json() as FlowTask;
      setT(updated); onUpdate(updated); setTab('plan');
    }
    setPlanning(false);
  };

  // E3 — Run task with Agent Hub (creates a Hub session seeded with PROMPT.md)
  const runWithAgent = async () => {
    if (!t.prompt_md) {
      alert('Generate an AI Plan first (Overview tab → Generate AI Plan).');
      return;
    }
    setRunning(true);
    const userKey = localStorage.getItem('bkg_user_api_key');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userKey) headers['Authorization'] = `Bearer ${userKey}`;

    try {
      const r = await fetch('/hub/sessions', {
        method:  'POST',
        headers,
        body: JSON.stringify({
          id:             `task-${t.id.slice(0, 8)}`,
          agent:          'pi',
          agentMode:      'default',
          initialMessage: `You are executing the following development plan. Read it carefully and start implementing:\n\n${t.prompt_md}`,
          cwd:            undefined,   // Hub creates workspace automatically
        }),
      });
      if (r.ok) {
        const session = await r.json() as { id: string };
        // Link session to task
        await fetch(`/flow/tasks/${t.id}`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json', ...(userKey ? { Authorization: `Bearer ${userKey}` } : {}) },
          body: JSON.stringify({ agent_session: session.id, status: 'in-progress' as const }),
        });
        const updated = await fetch(`/flow/tasks/${t.id}`).then(r => r.json()) as FlowTask;
        setT(updated); onUpdate(updated);
        // Navigate to Agent Hub
        dispatch({ type: 'SET_STAGE', stage: 'agenthub' });
        onClose();
      }
    } catch (e) {
      console.error('runWithAgent failed:', e);
    }
    setRunning(false);
  };

  const addComment = async () => {
    if (!commentDraft.trim()) return;
    const r = await fetch(`/flow/tasks/${t.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: commentDraft.trim() }),
    });
    if (r.ok) { setCommentDraft(''); void load(); }
  };

  const addStep = async () => {
    if (!stepDraft.trim()) return;
    await fetch(`/flow/tasks/${t.id}/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: stepDraft.trim(), phase: 'execute' }),
    });
    setStepDraft(''); void load();
  };

  const toggleStep = async (step: WorkflowStep) => {
    const next = step.status === 'done' ? 'pending' : 'done';
    await fetch(`/flow/steps/${step.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next, done_at: next === 'done' ? Date.now() : null }),
    });
    void load();
  };

  const submitEval = async (score: number) => {
    await fetch(`/flow/tasks/${t.id}/evals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score }),
    });
    void load();
  };

  // ── Tab content ─────────────────────────────────────────────────────────────

  const statusCol  = STATUS_COLORS[t.status] ?? '#4a6880';
  const doneSteps  = steps.filter(s => s.status === 'done').length;
  const nextStatus = STATUS_NEXT[t.status];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      style={{ background: 'rgba(3,8,16,0.88)', backdropFilter: 'blur(8px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative flex flex-col w-full max-w-2xl max-h-[90vh] rounded-2xl border overflow-hidden shadow-2xl"
        style={{
          background: 'linear-gradient(135deg, rgba(9,22,40,0.98) 0%, rgba(6,15,30,0.99) 100%)',
          borderColor: `${statusCol}30`,
          boxShadow:   `0 0 40px ${statusCol}12`,
        }}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-start gap-3 px-5 py-4 border-b" style={{ borderColor: `${statusCol}15` }}>
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-2.5" style={{ background: statusCol }}/>
          <div className="flex-1 min-w-0">
            {editing === 'title' ? (
              <div className="flex gap-2">
                <input
                  value={editDraft}
                  onChange={e => setEditDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { void save({ title: editDraft }); setEditing(null); } if (e.key === 'Escape') setEditing(null); }}
                  className="flex-1 bg-base/80 border border-accent/40 text-text-primary text-sm font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none"
                  autoFocus
                />
                <button onClick={() => { void save({ title: editDraft }); setEditing(null); }}
                  className="text-success hover:text-success/80 transition-colors"><Save size={14}/></button>
              </div>
            ) : (
              <h2
                className="text-base font-bold text-text-primary leading-snug cursor-pointer group flex items-center gap-2"
                onClick={() => { setEditDraft(t.title); setEditing('title'); }}
              >
                {t.title}
                <Edit3 size={11} className="opacity-0 group-hover:opacity-50 text-muted transition-opacity"/>
              </h2>
            )}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-[10px] px-2 py-0.5 rounded-full border font-semibold"
                style={{ background: `${statusCol}12`, borderColor: `${statusCol}30`, color: statusCol }}>
                {t.status}
              </span>
              {t.labels?.map(l => (
                <span key={l} className="flex items-center gap-1 text-[10px] text-muted/70">
                  <Tag size={8}/>{l}
                </span>
              ))}
              {steps.length > 0 && (
                <span className="text-[10px] text-muted/50">
                  {doneSteps}/{steps.length} steps
                </span>
              )}
              <span className="text-[10px] font-mono text-muted/30">{t.id}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {nextStatus && (
              <button onClick={moveNext} disabled={busy}
                className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-xl border transition-all cursor-pointer"
                style={{
                  background: `${STATUS_COLORS[nextStatus]}12`,
                  borderColor:`${STATUS_COLORS[nextStatus]}30`,
                  color:       STATUS_COLORS[nextStatus],
                }}>
                {busy ? <Loader2 size={11} className="animate-spin"/> : <ArrowRight size={11}/>}
                → {nextStatus}
              </button>
            )}
            <button onClick={onClose} className="text-muted/50 hover:text-muted p-1 transition-colors">
              <X size={16}/>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex-shrink-0 flex gap-0.5 px-5 pt-3 pb-0 border-b" style={{ borderColor: `${statusCol}10` }}>
          {([
            ['overview', 'Overview', Edit3],
            ['plan',     'Plan',     Code2],
            ['steps',    'Steps',    CheckSquare],
            ['comments', 'Comments', MessageSquare],
            ['logs',     'Logs',     Terminal],
            ['evals',    'Evals',    BarChart2],
          ] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)}
              className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold border-b-2 transition-all"
              style={{
                borderColor: tab === id ? statusCol : 'transparent',
                color:       tab === id ? statusCol : '#4a6880',
              }}>
              <Icon size={11}/><span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Overview */}
          {tab === 'overview' && (
            <div className="flex flex-col gap-4">
              {/* Description */}
              {editing === 'description' ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={editDraft}
                    onChange={e => setEditDraft(e.target.value)}
                    rows={5}
                    className="bg-base/80 border border-accent/30 text-text-primary text-sm rounded-xl px-3 py-2.5 focus:outline-none resize-none"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button onClick={() => { void save({ description: editDraft }); setEditing(null); }}
                      className="flex items-center gap-1 text-xs text-success border border-success/30 px-3 py-1.5 rounded-lg hover:bg-success/8 transition-all">
                      <Save size={11}/>Save
                    </button>
                    <button onClick={() => setEditing(null)} className="text-xs text-muted px-3 py-1.5 rounded-lg hover:bg-white/4 transition-all">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="text-sm text-text-primary/70 leading-relaxed min-h-[3rem] cursor-pointer rounded-xl p-2.5 hover:bg-white/3 transition-colors group"
                  onClick={() => { setEditDraft(t.description); setEditing('description'); }}
                >
                  {t.description || <span className="text-muted/30 italic">Add description… (click to edit)</span>}
                  <Edit3 size={10} className="inline ml-2 opacity-0 group-hover:opacity-30 text-muted transition-opacity"/>
                </div>
              )}

              {/* Meta grid */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-border/40 bg-panel/40 p-3">
                  <p className="text-[10px] text-muted/50 font-semibold uppercase tracking-wider mb-1">Branch</p>
                  <p className="font-mono text-[11px] text-accent/70 flex items-center gap-1.5">
                    <GitBranch size={10}/>{t.branch || `flow/${t.id.slice(0,8)}`}
                  </p>
                </div>
                <div className="rounded-xl border border-border/40 bg-panel/40 p-3">
                  <p className="text-[10px] text-muted/50 font-semibold uppercase tracking-wider mb-1">Priority</p>
                  <p className="text-[11px] text-text-primary">{PRIORITY_LABELS[Math.floor((t.priority ?? 50) / 10)] || 'Medium'}</p>
                </div>
              </div>

              {/* AI Plan button */}
              <button onClick={planWithAI} disabled={planning || running}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border text-sm font-semibold transition-all cursor-pointer"
                style={{
                  background:  planning ? 'rgba(0,229,255,0.04)' : 'rgba(0,229,255,0.08)',
                  borderColor: 'rgba(0,229,255,0.25)',
                  color:       '#00e5ff',
                  boxShadow:   planning ? undefined : '0 0 12px rgba(0,229,255,0.08)',
                }}>
                {planning ? <Loader2 size={14} className="animate-spin"/> : <Zap size={14}/>}
                {planning ? 'Generating Plan…' : t.prompt_md ? 'Regenerate AI Plan' : 'Generate AI Plan (PROMPT.md)'}
              </button>

              {/* E3 — Run with Agent Hub */}
              <button onClick={runWithAgent} disabled={running || planning}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border text-sm font-semibold transition-all cursor-pointer"
                style={{
                  background:  running ? 'rgba(168,85,247,0.04)' : t.prompt_md ? 'rgba(168,85,247,0.1)' : 'rgba(13,42,64,0.5)',
                  borderColor: t.prompt_md ? 'rgba(168,85,247,0.35)' : 'rgba(13,42,64,0.6)',
                  color:       t.prompt_md ? '#a855f7' : '#4a6880',
                  boxShadow:   t.prompt_md && !running ? '0 0 12px rgba(168,85,247,0.1)' : undefined,
                }}>
                {running ? <Loader2 size={14} className="animate-spin"/> : <Bot size={14}/>}
                {running ? 'Starting Agent…' : t.agent_session ? `Resume Agent Session` : 'Run with Agent Hub'}
              </button>

              {/* Show agent session ID if linked */}
              {t.agent_session && (
                <p className="text-[11px] font-mono text-muted/50 flex items-center gap-1.5">
                  <Bot size={10}/>Session: {t.agent_session}
                </p>
              )}
            </div>
          )}

          {/* Plan tab */}
          {tab === 'plan' && (
            <div>
              {t.prompt_md ? (
                <MarkdownView md={t.prompt_md}/>
              ) : (
                <div className="flex flex-col items-center gap-4 py-12 text-center">
                  <Code2 size={36} strokeWidth={1} className="text-muted/20"/>
                  <div>
                    <p className="text-sm font-semibold text-text-primary/50">No plan yet</p>
                    <p className="text-xs text-muted/40 mt-1">Click "Generate AI Plan" in Overview</p>
                  </div>
                  <button onClick={planWithAI} disabled={planning}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-base bg-accent btn-glow cursor-pointer">
                    <Zap size={13}/>Generate Plan
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Steps tab */}
          {tab === 'steps' && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                {steps.length === 0 ? (
                  <p className="text-sm text-muted/40 italic py-4 text-center">No workflow steps</p>
                ) : (
                  steps.map(s => (
                    <div key={s.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/40 hover:border-accent/20 transition-all cursor-pointer"
                      onClick={() => void toggleStep(s)}
                    >
                      {s.status === 'done'
                        ? <CheckCircle2 size={14} className="text-success flex-shrink-0"/>
                        : <Square size={14} className="text-muted/40 flex-shrink-0"/>}
                      <span className={`text-sm flex-1 ${s.status === 'done' ? 'text-muted/50 line-through' : 'text-text-primary'}`}>
                        {s.title}
                      </span>
                      <span className="text-[10px] text-muted/30 font-mono">{s.phase}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={stepDraft}
                  onChange={e => setStepDraft(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && void addStep()}
                  placeholder="Add a workflow step…"
                  className="flex-1 bg-base/80 border border-border text-text-primary text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-accent/40 placeholder:text-muted/30"
                />
                <button onClick={addStep}
                  className="text-accent border border-accent/30 px-3 py-2 rounded-xl hover:bg-accent/8 transition-all">
                  <Plus size={14}/>
                </button>
              </div>
            </div>
          )}

          {/* Comments tab */}
          {tab === 'comments' && (
            <div className="flex flex-col gap-3">
              {comments.length === 0 ? (
                <p className="text-sm text-muted/40 italic py-4 text-center">No comments yet</p>
              ) : (
                comments.map(c => (
                  <div key={c.id} className="flex flex-col gap-1 px-3 py-3 rounded-xl border border-border/40 bg-panel/30">
                    <div className="flex items-center gap-2 text-[11px] text-muted/50">
                      <span className="font-semibold text-accent/60">{c.author}</span>
                      <span>·</span>
                      <span>{new Date(c.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-text-primary/80">{c.body}</p>
                  </div>
                ))
              )}
              <div className="flex gap-2">
                <input
                  value={commentDraft}
                  onChange={e => setCommentDraft(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && void addComment()}
                  placeholder="Add a comment…"
                  className="flex-1 bg-base/80 border border-border text-text-primary text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-accent/40 placeholder:text-muted/30"
                />
                <button onClick={addComment}
                  className="text-accent border border-accent/30 px-3 py-2 rounded-xl hover:bg-accent/8 transition-all">
                  <Plus size={14}/>
                </button>
              </div>
            </div>
          )}

          {/* Logs tab */}
          {tab === 'logs' && (
            <div ref={logsRef} className="flex flex-col gap-0.5 font-mono text-[11px] max-h-80 overflow-y-auto">
              {logs.length === 0 ? (
                <p className="text-muted/30 italic py-4 text-center">No logs yet</p>
              ) : (
                logs.map(l => (
                  <div key={l.id} className={`flex items-start gap-2 py-0.5 ${l.level === 'error' ? 'text-red-400/80' : l.level === 'warn' ? 'text-amber/70' : 'text-text-primary/60'}`}>
                    <span className="text-muted/30 flex-shrink-0">{new Date(l.created_at).toLocaleTimeString()}</span>
                    <span className="flex-1">{l.message}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Evals tab */}
          {tab === 'evals' && (
            <div className="flex flex-col gap-4">
              {evals.length === 0 ? (
                <p className="text-sm text-muted/40 italic py-4 text-center">No evaluations yet</p>
              ) : (
                evals.map(e => (
                  <div key={e.id} className="flex items-center gap-3 px-3 py-3 rounded-xl border border-border/40 bg-panel/30">
                    <div className={`text-2xl font-bold tabular-nums ${e.band === 'excellent' ? 'text-success' : e.band === 'good' ? 'text-accent' : e.band === 'fair' ? 'text-amber' : 'text-error/70'}`}>
                      {e.score.toFixed(0)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-text-primary capitalize">{e.band}</p>
                      <p className="text-[11px] text-muted/50">{new Date(e.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                ))
              )}
              <div>
                <p className="text-xs text-muted/50 mb-2">Submit evaluation score (0-100):</p>
                <div className="flex gap-2">
                  {[25, 50, 75, 90, 100].map(s => (
                    <button key={s} onClick={() => void submitEval(s)}
                      className="flex-1 py-2 rounded-xl border border-border/50 text-xs font-semibold text-muted hover:border-accent/30 hover:text-accent transition-all">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
