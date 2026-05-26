/**
 * src/components/UserDashboard/ModelTester.tsx
 *
 * Inline chat playground — lets users verify a model is responding correctly
 * before committing to it for plan generation.
 *
 * Works with all three backends:
 *   WebGPU   → generateStreaming() via webllm.ts (auto-loads if needed)
 *   Ollama   → POST /v1/chat/completions on configured server
 *   llama-cpp → POST /v1/chat/completions on configured server
 *
 * No server URLs shown — uses backendConfig.serverUrl transparently.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, RotateCcw, Bot, User, Loader2, Cpu, Server, HardDrive, Zap } from 'lucide-react';
import { useAppState }        from '@/context/AppContext';
import { generateStreaming }   from '@/lib/llm-client';
import { ensureEngine }       from '@/lib/webllm';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMsg {
  id:      string;
  role:    'user' | 'assistant';
  content: string;
  done?:   boolean;
}

const STARTERS = [
  'Say hello in one sentence.',
  'What can you help me with?',
  'Write a short haiku about coding.',
  'Explain recursion in one sentence.',
  'What is 42 × 17?',
];

const BACKEND_ICONS: Record<string, React.FC<{ size?: number; className?: string }>> = {
  webgpu:     Cpu,
  ollama:     Server,
  'llama-cpp': HardDrive,
};

const BACKEND_LABELS: Record<string, string> = {
  webgpu:     'WebGPU',
  ollama:     'Ollama',
  'llama-cpp': 'llama-cpp',
};

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }

// ── Message bubble ────────────────────────────────────────────────────────────

function Bubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={[
        'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5',
        isUser ? 'bg-surface border border-border' : 'bg-accent/20',
      ].join(' ')}>
        {isUser
          ? <User size={12} className="text-muted"/>
          : <Bot  size={12} className="text-accent"/>}
      </div>
      <div className={[
        'max-w-[82%] rounded-xl px-3 py-2 text-sm leading-relaxed',
        isUser
          ? 'bg-surface border border-border text-text-primary'
          : 'bg-accent/8 border border-accent/20 text-text-primary',
      ].join(' ')}
      style={!isUser ? { background: 'rgba(0,212,170,0.06)' } : undefined}
      >
        {msg.content || (
          <span className="inline-block font-mono text-accent animate-blink">▌</span>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ModelTester() {
  const { state, dispatch } = useAppState();
  const { backendConfig }   = state;

  const [messages,  setMessages]  = useState<ChatMsg[]>([]);
  const [draft,     setDraft]     = useState('');
  const [sending,   setSending]   = useState(false);
  const [loadMsg,   setLoadMsg]   = useState('');
  const [error,     setError]     = useState('');

  const inputRef   = useRef<HTMLInputElement>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const abortRef   = useRef<AbortController | null>(null);

  const BackIcon  = BACKEND_ICONS[backendConfig.type] ?? Cpu;
  const backLabel = BACKEND_LABELS[backendConfig.type] ?? backendConfig.type;
  const modelName = backendConfig.modelId
    ? backendConfig.modelId.split('/').pop()?.split(':')[0] ?? backendConfig.modelId
    : 'auto';

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages.at(-1)?.content.length]);

  // ── Send a message ──────────────────────────────────────────────────────────

  const send = useCallback(async (text: string) => {
    if (!text.trim() || sending) return;
    setError('');

    const userMsg: ChatMsg = { id: uid(), role: 'user',      content: text, done: true };
    const botMsg:  ChatMsg = { id: uid(), role: 'assistant', content: '',   done: false };

    setMessages(prev => [...prev, userMsg, botMsg]);
    setDraft('');
    setSending(true);

    abortRef.current = new AbortController();

    // If WebGPU, ensure engine is loaded first with progress feedback
    if (backendConfig.type === 'webgpu') {
      setLoadMsg('Loading model…');
      try {
        await ensureEngine(backendConfig.modelId, (p) => {
          setLoadMsg(p.progress < 100 ? `${p.text || 'Loading…'} ${p.progress}%` : '');
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load engine');
        setMessages(prev => prev.filter(m => m.id !== botMsg.id));
        setSending(false);
        setLoadMsg('');
        return;
      }
      setLoadMsg('');
    }

    try {
      const system = 'You are a helpful AI assistant. Be concise and clear.';

      await generateStreaming(
        system,
        text,
        (chunk) => {
          setMessages(prev =>
            prev.map(m => m.id === botMsg.id
              ? { ...m, content: m.content + chunk }
              : m,
            ),
          );
        },
        1024,
        backendConfig,
      );

      setMessages(prev =>
        prev.map(m => m.id === botMsg.id ? { ...m, done: true } : m),
      );
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setMessages(prev =>
          prev.map(m => m.id === botMsg.id ? { ...m, done: true, content: m.content + ' [stopped]' } : m),
        );
      } else {
        const msg = e instanceof Error ? e.message : 'Generation failed';
        setError(msg);
        setMessages(prev => prev.map(m => m.id === botMsg.id ? { ...m, done: true, content: `Error: ${msg}` } : m));
      }
    }

    setSending(false);
    setLoadMsg('');
    inputRef.current?.focus();
  }, [backendConfig, sending]);

  const stop = () => {
    abortRef.current?.abort();
    setSending(false);
    setLoadMsg('');
  };

  const reset = () => {
    stop();
    setMessages([]);
    setError('');
    inputRef.current?.focus();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto px-4 py-6 gap-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
            <FlaskConical size={16} className="text-accent"/>
            Model Test
          </h2>
          <div className="flex items-center gap-1.5 mt-0.5">
            <BackIcon size={12} className="text-muted/60"/>
            <span className="text-[11px] text-muted font-mono">{backLabel} · {modelName}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button onClick={reset} className="flex items-center gap-1 text-xs text-muted hover:text-text-primary px-2 py-1.5 border border-border rounded-lg transition-colors">
              <RotateCcw size={11}/>Clear
            </button>
          )}
          <button
            onClick={() => dispatch({ type: 'SET_STAGE', stage: 'stufe1' })}
            className="flex items-center gap-1 text-xs bg-accent text-base hover:bg-accent-dim btn-glow px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <Zap size={11}/>New Plan
          </button>
        </div>
      </div>

      {/* Loading progress */}
      {loadMsg && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/8 border border-accent/20 text-xs text-accent">
          <Loader2 size={12} className="animate-spin flex-shrink-0"/>
          {loadMsg}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-3 py-2 rounded-lg bg-error/10 border border-error/30 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Chat area */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 py-2">
        {messages.length === 0 ? (
          /* Empty state with starter prompts */
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20">
              <Bot size={28} className="text-accent"/>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-text-primary">
                {backLabel} · {modelName}
              </p>
              <p className="text-xs text-muted mt-1">
                Test the model before generating a plan
              </p>
            </div>

            {/* Starter chips */}
            <div className="flex flex-wrap gap-2 justify-center max-w-md">
              {STARTERS.map(s => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  disabled={sending}
                  className="px-3 py-1.5 text-xs text-muted border border-border rounded-full hover:border-accent/40 hover:text-accent transition-colors disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(m => <Bubble key={m.id} msg={m}/>)
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input bar */}
      <form
        onSubmit={e => { e.preventDefault(); void send(draft); }}
        className="flex items-center gap-2 border border-border rounded-xl bg-surface px-3 py-2 focus-within:border-accent/60 transition-colors"
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={sending ? 'Generating…' : 'Type a message to test the model…'}
          disabled={sending && !loadMsg}
          className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-muted/40 focus:outline-none"
          autoFocus
        />
        {sending ? (
          <button type="button" onClick={stop}
            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs text-warning border border-warning/30 rounded-lg hover:bg-warning/10 transition-colors">
            <span className="w-1.5 h-1.5 rounded-sm bg-warning animate-pulse"/>Stop
          </button>
        ) : (
          <button type="submit" disabled={!draft.trim()}
            className={['flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
              draft.trim() ? 'bg-accent text-base hover:bg-accent-dim cursor-pointer' : 'bg-border/50 text-muted/30 cursor-not-allowed'].join(' ')}>
            <Send size={14}/>
          </button>
        )}
      </form>

      <p className="text-center text-[10px] text-muted/30">
        Testing model only — no plan data is saved during this chat
      </p>
    </div>
  );
}

// re-export icon used in Dashboard.tsx
import { FlaskConical } from 'lucide-react';
