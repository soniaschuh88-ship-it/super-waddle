/**
 * src/components/CodeStudio/CodeStudio.tsx
 *
 * bKG Code Studio — powered by @earendil-works/pi-agent-core
 *
 * The agent runs server-side via serve.js with real tools:
 *   bash • read • write • edit • grep • find • ls
 *
 * The studio streams events from the agent via long-polling and shows:
 *   • A live terminal log of tool calls and agent output
 *   • Monaco editor with the most recently written file
 *   • A file tree that grows as the agent creates files
 *   • A chat bar to send messages mid-session
 *
 * The agent receives the full plan bundle as context and implements the
 * project from scratch using real file writes and bash commands.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Square, RotateCcw, Terminal, GitBranch, Download, Bot,
  Send, Loader2, CheckCircle, AlertCircle,
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import { useAppState } from '@/context/AppContext';
import {
  agentStartSession, agentSendMessage, agentAbort,
  agentDispose, agentPollEvents,
} from '@/lib/llm-client';
import { downloadBundleZip } from '@/lib/zip';
import { detectLanguage } from '@/lib/codegen';
import type { AgentEvent, GeneratedBundle } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LiveFile {
  path:     string;
  content:  string;
  language: string;
}

interface LogEntry {
  id:      string;
  kind:    'text' | 'tool_call' | 'tool_result' | 'system';
  text:    string;
  toolName?: string;
  isError?: boolean;
  ts:      number;
}

// ── Build the initial prompt from the planning bundle ─────────────────────────

function buildInitialPrompt(bundle: GeneratedBundle, cwd: string): string {
  return `You are an expert software engineer. Implement the following software project from scratch in the directory: ${cwd}

Use the \`write\` tool to create source files, the \`bash\` tool to run commands (npm init, mkdir, etc.), and \`edit\` to modify files.

Work through the implementation systematically — foundation first (package.json, .env, README), then core modules, then features.

---
## Project Plan

### agent.md
${bundle['agent.md'].slice(0, 3000)}

### architecture.md
${bundle['architecture.md'].slice(0, 2000)}

### tasks.md
${bundle['tasks.md'].slice(0, 2000)}

### manifest.json (files to create)
${bundle['manifest.json'].slice(0, 1000)}
---

Start implementing the project now. Write all files needed for a complete, working MVP.`;
}

// ── Log line component ────────────────────────────────────────────────────────

function LogLine({ entry }: { entry: LogEntry }) {
  const cls = {
    text:        'text-text-primary/80',
    tool_call:   'text-accent/90',
    tool_result: 'text-green-400/80',
    system:      'text-muted/60 italic',
  }[entry.kind];

  return (
    <div className={`font-mono text-[12px] leading-relaxed ${entry.isError ? 'text-error' : cls}`}>
      <span className="text-muted/30 select-none mr-2 tabular-nums">
        {new Date(entry.ts).toISOString().slice(11, 19)}
      </span>
      {entry.toolName && (
        <span className="text-accent/60 mr-1">[{entry.toolName}]</span>
      )}
      {entry.text}
    </div>
  );
}

// ── File tree ─────────────────────────────────────────────────────────────────

function FileTree({
  files,
  selected,
  onSelect,
}: {
  files: LiveFile[];
  selected: string | null;
  onSelect: (p: string) => void;
}) {
  if (!files.length) {
    return (
      <div className="text-[11px] text-muted/30 italic px-3 py-2">
        Files created by the agent will appear here…
      </div>
    );
  }
  return (
    <div className="flex flex-col py-1">
      {files.map(f => (
        <button
          key={f.path}
          onClick={() => onSelect(f.path)}
          className={[
            'text-left px-3 py-1.5 text-[11px] font-mono transition-colors border-l-2 truncate',
            f.path === selected
              ? 'bg-accent/10 border-accent text-text-primary'
              : 'border-transparent text-muted hover:bg-surface hover:text-text-primary',
          ].join(' ')}
        >
          {f.path}
        </button>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CodeStudio() {
  const { state } = useAppState();
  const { editableBundle } = state;

  // Agent session state
  const [sessionId,  setSessionId]  = useState<string | null>(null);
  const [running,    setRunning]    = useState(false);
  const [done,       setDone]       = useState(false);
  const [startErr,   setStartErr]   = useState('');

  // Live output
  const [logs,       setLogs]       = useState<LogEntry[]>([]);
  const [files,      setFiles]      = useState<LiveFile[]>([]);
  const [selected,   setSelected]   = useState<string | null>(null);
  const [chatDraft,  setChatDraft]  = useState('');

  // Polling
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventIdx   = useRef(0);
  const logBottom  = useRef<HTMLDivElement>(null);

  // Auto-scroll log
  useEffect(() => {
    logBottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  // ── Event processing ───────────────────────────────────────────────────────

  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const addLog = useCallback((entry: Omit<LogEntry, 'id' | 'ts'>) => {
    setLogs(prev => [...prev, { ...entry, id: uid(), ts: Date.now() }]);
  }, []);

  const processEvent = useCallback((ev: AgentEvent) => {
    // ── Text streaming ──────────────────────────────────────────────────────
    if (ev.type === 'message_update' && ev.assistantMessageEvent?.type === 'text_delta') {
      const delta = ev.assistantMessageEvent.delta ?? '';
      if (delta) {
        setLogs(prev => {
          const last = prev[prev.length - 1];
          if (last?.kind === 'text') {
            return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
          }
          return [...prev, { id: uid(), kind: 'text', text: delta, ts: Date.now() }];
        });
      }
    }

    // ── Tool calls ──────────────────────────────────────────────────────────
    if (ev.type === 'tool_call') {
      const name    = ev.toolName ?? 'unknown';
      const input   = ev.input   ?? {};
      let   summary = '';
      if (name === 'write') summary = `write → ${input.path as string ?? '?'}`;
      else if (name === 'bash')  summary = `bash → ${(input.command as string ?? '?').slice(0, 80)}`;
      else if (name === 'read')  summary = `read → ${input.path as string ?? '?'}`;
      else if (name === 'edit')  summary = `edit → ${input.path as string ?? '?'}`;
      else if (name === 'grep')  summary = `grep → "${input.pattern as string ?? '?'}"`;
      else if (name === 'find')  summary = `find → ${input.path as string ?? '.'}`;
      else if (name === 'ls')    summary = `ls → ${input.path as string ?? '.'}`;
      else summary = `${name}(${JSON.stringify(input).slice(0, 60)})`;

      addLog({ kind: 'tool_call', text: summary, toolName: name });

      // Pre-create file entry for write calls
      if (name === 'write' && input.path) {
        const path    = input.path as string;
        const content = (input.content as string) ?? '';
        setFiles(prev => {
          const exists = prev.findIndex(f => f.path === path);
          const entry: LiveFile = { path, content, language: detectLanguage(path) };
          if (exists >= 0) {
            const next = [...prev]; next[exists] = entry; return next;
          }
          return [...prev, entry];
        });
        setSelected(path);
      }
    }

    // ── Tool results ────────────────────────────────────────────────────────
    if (ev.type === 'tool_result') {
      const name    = ev.toolName ?? '';
      const content = ev.result?.content ?? [];
      const isErr   = ev.result?.isError ?? false;
      const text    = content.map((c: { type: string; text?: string }) => c.text ?? '').join('').slice(0, 200);

      if (isErr) {
        addLog({ kind: 'tool_result', text: `error: ${text}`, toolName: name, isError: true });
      } else if (name === 'write') {
        addLog({ kind: 'tool_result', text: '✓ file written', toolName: name });
      } else if (text.trim()) {
        addLog({ kind: 'tool_result', text: text.trim().slice(0, 120), toolName: name });
      }
    }

    // ── Agent done ──────────────────────────────────────────────────────────
    if (ev.type === 'agent_end') {
      setRunning(false);
      setDone(true);
      addLog({ kind: 'system', text: '✅ Agent finished' });
    }
  }, [addLog]);

  // ── Start polling ──────────────────────────────────────────────────────────

  const startPolling = useCallback((sid: string) => {
    eventIdx.current = 0;
    pollRef.current = setInterval(async () => {
      const { events, total } = await agentPollEvents(sid, eventIdx.current);
      if (events.length > 0) {
        events.forEach(processEvent);
        eventIdx.current = total;
      }
    }, 600);
  }, [processEvent]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // ── Controls ───────────────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    if (!editableBundle) return;
    setStartErr('');
    setLogs([]); setFiles([]); setSelected(null);
    setDone(false); setRunning(true);

    addLog({ kind: 'system', text: '🚀 Starting bKG Coding Agent (pi-agent-core)…' });

    try {
      const prompt    = buildInitialPrompt(editableBundle, process.cwd?.() ?? '/tmp/bkg-project');
      const { sessionId: sid } = await agentStartSession({
        initialMessage: prompt,
        tools: ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'],
      });
      setSessionId(sid);
      addLog({ kind: 'system', text: `Session started: ${sid}` });
      startPolling(sid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to start agent';
      setStartErr(msg);
      setRunning(false);
      addLog({ kind: 'system', text: `Error: ${msg}`, isError: true });
    }
  }, [editableBundle, addLog, startPolling]);

  const handleStop = useCallback(async () => {
    stopPolling();
    if (sessionId) {
      await agentAbort(sessionId).catch(() => {});
      addLog({ kind: 'system', text: '⏹ Agent stopped by user' });
    }
    setRunning(false);
  }, [sessionId, stopPolling, addLog]);

  const handleReset = useCallback(async () => {
    stopPolling();
    if (sessionId) await agentDispose(sessionId).catch(() => {});
    setSessionId(null); setRunning(false); setDone(false);
    setLogs([]); setFiles([]); setSelected(null); setStartErr('');
  }, [sessionId, stopPolling]);

  const handleChat = useCallback(async () => {
    const msg = chatDraft.trim();
    if (!msg || !sessionId) return;
    setChatDraft('');
    addLog({ kind: 'system', text: `You: ${msg}` });
    try {
      await agentSendMessage(sessionId, msg);
      if (!running) { setRunning(true); startPolling(sessionId); }
    } catch (e) {
      addLog({ kind: 'system', text: `Send failed: ${e instanceof Error ? e.message : '?'}`, isError: true });
    }
  }, [chatDraft, sessionId, running, addLog, startPolling]);

  // Cleanup on unmount
  useEffect(() => () => { stopPolling(); }, [stopPolling]);

  const handleDownload = useCallback(async () => {
    if (!editableBundle || !files.length) return;
    const extra: Record<string, string> = {};
    for (const f of files) extra[f.path] = f.content;
    await downloadBundleZip({ ...editableBundle, ...extra } as Parameters<typeof downloadBundleZip>[0]);
  }, [editableBundle, files]);

  // ── Selected file content ──────────────────────────────────────────────────

  const currentFile = selected ? files.find(f => f.path === selected) : files[files.length - 1];

  if (!editableBundle) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <p className="text-muted text-sm">Complete the planning stages first.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 border-b border-border bg-panel">
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-accent/15 border border-accent/30">
          <Terminal size={15} className="text-accent"/>
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-text-primary tracking-tight">
            Code Studio — pi-agent-core
          </h2>
          <p className="text-[11px] text-muted">
            {running   ? `Agent running… ${files.length} files written`
             : done    ? `Complete — ${files.length} files`
             : startErr ? `Error: ${startErr.slice(0,60)}`
             : 'Real coding agent with bash, write, edit, grep, find, ls tools'}
          </p>
        </div>

        {/* Status */}
        {running && <Loader2 size={14} className="text-accent animate-spin"/>}
        {done    && <CheckCircle size={14} className="text-success"/>}
        {startErr && <AlertCircle size={14} className="text-error"/>}

        {files.length > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-muted font-mono">
            <GitBranch size={12}/>{files.length} files
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center gap-2">
          {files.length > 0 && (
            <button onClick={handleDownload} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted hover:text-accent border border-border hover:border-accent/40 rounded-lg transition-colors">
              <Download size={12}/>ZIP
            </button>
          )}
          {running ? (
            <button onClick={handleStop} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-error/15 border border-error/30 text-red-400 hover:bg-error/20 rounded-lg transition-colors">
              <Square size={12}/>Stop
            </button>
          ) : (
            <>
              {(logs.length > 0 || files.length > 0) && (
                <button onClick={handleReset} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted hover:text-text-primary border border-border rounded-lg transition-colors">
                  <RotateCcw size={12}/>
                </button>
              )}
              <button onClick={handleStart}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-accent text-base hover:bg-accent-dim btn-glow rounded-lg transition-colors cursor-pointer">
                <Play size={12}/>
                {done ? 'Run Again' : logs.length > 0 ? 'Continue' : 'Start Agent'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Main layout ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* File tree sidebar */}
        <aside className="flex flex-col w-48 flex-shrink-0 border-r border-border bg-panel overflow-y-auto">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[10px] font-semibold text-muted uppercase tracking-widest">Files</p>
          </div>
          <FileTree files={files} selected={selected ?? null} onSelect={setSelected}/>
        </aside>

        {/* Monaco editor */}
        <div className="flex flex-col flex-[3] min-w-0 min-h-0 overflow-hidden">
          {currentFile ? (
            <>
              <div className="flex-shrink-0 px-3 py-1.5 bg-panel border-b border-border flex items-center gap-2">
                <span className="text-xs font-mono text-text-primary">{currentFile.path}</span>
                <span className="text-[10px] text-muted/50 font-mono ml-auto">{currentFile.language}</span>
              </div>
              <div className="flex-1 min-h-0">
                <Editor
                  height="100%"
                  language={currentFile.language}
                  value={currentFile.content}
                  theme="vs-dark"
                  options={{
                    readOnly: false,
                    minimap: { enabled: false },
                    fontSize: 13,
                    fontFamily: 'JetBrains Mono, monospace',
                    wordWrap: 'on',
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    folding: true,
                    tabSize: 2,
                    scrollbar: { verticalScrollbarSize: 6 },
                  }}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted/30">
              <Terminal size={40} strokeWidth={1}/>
              <p className="text-sm">Files created by the agent appear here</p>
            </div>
          )}
        </div>

        {/* Terminal + chat */}
        <div className="flex flex-col flex-[2] min-w-0 border-l border-border bg-[#0d0d16] overflow-hidden">
          {/* Terminal header */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 bg-panel border-b border-border">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-error/60"/>
              <span className="w-3 h-3 rounded-full bg-warning/60"/>
              <span className="w-3 h-3 rounded-full bg-success/60"/>
            </div>
            <span className="flex-1 text-center text-[11px] font-mono text-muted/60">bkg-agent</span>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${running ? 'text-accent bg-accent/10 animate-pulse-slow' : 'text-muted bg-border/50'}`}>
              {running ? '● RUN' : done ? '● DONE' : '● IDLE'}
            </span>
          </div>

          {/* Log stream */}
          <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
            {!logs.length && (
              <div className="font-mono text-[12px] text-muted/30 italic">
                Agent output will stream here…
              </div>
            )}
            {logs.map(entry => <LogLine key={entry.id} entry={entry}/>)}
            {running && <div className="pt-0.5"><span className="inline-block font-mono text-accent text-sm animate-blink">▌</span></div>}
            <div ref={logBottom}/>
          </div>

          {/* Chat input */}
          <div className="flex-shrink-0 flex items-center gap-2 p-2 border-t border-border">
            <Bot size={13} className="text-muted/50 flex-shrink-0"/>
            <input
              value={chatDraft}
              onChange={e => setChatDraft(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && void handleChat()}
              placeholder={sessionId ? 'Steer the agent…' : 'Start a session first'}
              disabled={!sessionId}
              className="flex-1 bg-transparent text-xs text-text-primary font-mono placeholder:text-muted/30 focus:outline-none"
            />
            <button onClick={() => void handleChat()} disabled={!chatDraft.trim() || !sessionId}
              className={['p-1.5 rounded transition-colors', chatDraft.trim() && sessionId ? 'text-accent hover:bg-accent/10 cursor-pointer' : 'text-muted/20 cursor-not-allowed'].join(' ')}>
              <Send size={12}/>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
