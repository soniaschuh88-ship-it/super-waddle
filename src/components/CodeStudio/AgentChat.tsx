/**
 * src/components/CodeStudio/AgentChat.tsx
 * Right panel: chat between user and the coding agent.
 */
import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User } from 'lucide-react';
import { useAppState } from '@/context/AppContext';

export function AgentChat({ onUserMessage }: { onUserMessage?: (msg: string) => void }) {
  const { state } = useAppState();
  const { agentMessages } = state;
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [agentMessages.length]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onUserMessage?.(text);
    setDraft('');
  };

  return (
    <div className="flex flex-col h-full border-l border-border bg-panel w-72 flex-shrink-0">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-border">
        <p className="text-[11px] font-semibold text-muted uppercase tracking-widest flex items-center gap-1.5">
          <Bot size={12} className="text-accent"/> Agent Chat
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {agentMessages.length === 0 && (
          <p className="text-[11px] text-muted/40 italic text-center mt-4">
            The agent will report progress here.<br/>You can ask questions or give feedback.
          </p>
        )}
        {agentMessages.map(msg => (
          <div key={msg.id} className={['flex gap-2', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'].join(' ')}>
            <div className={['flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5',
              msg.role === 'agent' ? 'bg-accent/20' : 'bg-surface border border-border'].join(' ')}>
              {msg.role === 'agent'
                ? <Bot size={12} className="text-accent"/>
                : <User size={12} className="text-muted"/>}
            </div>
            <div className={['max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12px] leading-relaxed',
              msg.role === 'agent'
                ? 'bg-surface border border-border text-text-primary/90'
                : 'bg-accent/10 border border-accent/30 text-text-primary'].join(' ')}>
              {msg.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div className="flex-shrink-0 flex items-center gap-2 p-2 border-t border-border">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submit()}
          placeholder="Ask the agent…"
          className="flex-1 bg-base border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary placeholder:text-muted/40 focus:outline-none focus:border-accent/60"
        />
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className={['p-1.5 rounded-lg transition-colors',
            draft.trim() ? 'bg-accent text-base hover:bg-accent-dim' : 'bg-surface text-muted/30 cursor-not-allowed'].join(' ')}>
          <Send size={13}/>
        </button>
      </div>
    </div>
  );
}
