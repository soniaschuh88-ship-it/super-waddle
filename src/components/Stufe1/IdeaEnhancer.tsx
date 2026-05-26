/**
 * src/components/Stufe1/IdeaEnhancer.tsx
 *
 * "Enhance with AI" button with animated progress bar while running.
 */
import { useState } from 'react';
import { Wand2, Loader2, Sparkles } from 'lucide-react';
import { generateJson } from '@/lib/llm-client';
import { ENHANCE_IDEA_SYSTEM, buildEnhanceIdeaUserPrompt } from '@/lib/prompts';
import { useAppState } from '@/context/AppContext';

interface IdeaEnhancerProps {
  ideaText:   string;
  onEnhanced: (text: string) => void;
  disabled?:  boolean;
}

/** Indeterminate progress bar — visible while work is in progress. */
function ProgressBar() {
  return (
    <div className="relative h-0.5 rounded-full bg-border/60 overflow-hidden w-24">
      <div
        className="absolute inset-y-0 w-1/2 bg-accent/70 rounded-full"
        style={{ animation: 'progressSlide 1.6s ease-in-out infinite' }}
      />
      <style>{`
        @keyframes progressSlide {
          0%   { left: -50%; }
          100% { left: 150%; }
        }
      `}</style>
    </div>
  );
}

export function IdeaEnhancer({ ideaText, onEnhanced, disabled }: IdeaEnhancerProps) {
  const { state }  = useAppState();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [done,    setDone]    = useState(false);
  const canEnhance = ideaText.trim().length >= 20 && !disabled && !loading;

  const handleEnhance = async () => {
    if (!canEnhance) return;
    setLoading(true); setError(''); setDone(false);
    try {
      const raw = await generateJson<{ enhanced: string } | string>(
        ENHANCE_IDEA_SYSTEM + '\n\nReturn your output as: {"enhanced":"<text here>"}',
        buildEnhanceIdeaUserPrompt(ideaText),
        state.backendConfig,
      );

      let enhanced = '';
      if (typeof raw === 'string') {
        enhanced = raw;
      } else if (raw && typeof raw === 'object' && 'enhanced' in raw) {
        enhanced = (raw as { enhanced: string }).enhanced;
      }

      if (enhanced.trim()) {
        onEnhanced(enhanced.trim());
        setDone(true);
        setTimeout(() => setDone(false), 3000);
      } else {
        setError('Enhancement returned empty. Try again.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enhancement failed.');
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col gap-1.5 items-end">
      <div className="flex items-center gap-2.5">
        {/* Success flash */}
        {done && !loading && (
          <span className="text-[11px] text-success flex items-center gap-1">
            <Sparkles size={11}/>Enhanced!
          </span>
        )}
        {/* Error */}
        {error && !loading && (
          <span className="text-[11px] text-error truncate max-w-[200px]">{error}</span>
        )}
        {/* Hint when idle */}
        {!error && !loading && !done && (
          <span className="text-[11px] text-muted/40">AI rewrites as a detailed brief</span>
        )}

        <button
          onClick={handleEnhance}
          disabled={!canEnhance}
          className={[
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
            canEnhance
              ? 'border-accent/40 text-accent hover:bg-accent/15 cursor-pointer'
              : 'border-border bg-surface text-muted/50 cursor-not-allowed',
          ].join(' ')}
          style={canEnhance ? { background: 'rgba(0,212,170,0.06)' } : undefined}
          title="Let AI rewrite your idea as a detailed product brief"
        >
          {loading
            ? <Loader2 size={12} className="animate-spin" />
            : <Wand2 size={12} />
          }
          {loading ? 'Enhancing…' : 'Enhance with AI'}
        </button>
      </div>

      {/* Indeterminate progress bar while running */}
      {loading && <ProgressBar />}
    </div>
  );
}
