/**
 * src/components/Stufe1/IdeaEnhancer.tsx
 *
 * "Enhance with AI" button shown below the idea textarea.
 * Sends the current text to the LLM and replaces it with a more detailed brief.
 */
import { useState } from 'react';
import { Wand2, Loader2 } from 'lucide-react';
import { generateJson } from '@/lib/llm-client';
import { ENHANCE_IDEA_SYSTEM, buildEnhanceIdeaUserPrompt } from '@/lib/prompts';
import { useAppState } from '@/context/AppContext';

interface IdeaEnhancerProps {
  ideaText:  string;
  onEnhanced: (text: string) => void;
  disabled?: boolean;
}

export function IdeaEnhancer({ ideaText, onEnhanced, disabled }: IdeaEnhancerProps) {
  const { state } = useAppState();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const canEnhance = ideaText.trim().length >= 20 && !disabled && !loading;

  const handleEnhance = async () => {
    if (!canEnhance) return;
    setLoading(true); setError('');
    try {
      // Use generateJson to get a plain string back (we ask for JSON-wrapped text
      // to keep the response clean, then unwrap it)
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
      } else {
        setError('Enhancement returned empty. Try again.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enhancement failed.');
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleEnhance}
        disabled={!canEnhance}
        className={[
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
          canEnhance
            ? 'border-accent/40 bg-accent/8 text-accent hover:bg-accent/15 cursor-pointer'
            : 'border-border bg-surface text-muted/50 cursor-not-allowed',
        ].join(' ')}
        title="Let AI rewrite your idea as a detailed product brief"
        style={canEnhance ? { background: 'rgba(0,212,170,0.06)' } : undefined}
      >
        {loading
          ? <Loader2 size={12} className="animate-spin" />
          : <Wand2 size={12} />
        }
        {loading ? 'Enhancing…' : 'Enhance with AI'}
      </button>

      {error && (
        <span className="text-[11px] text-error truncate max-w-xs">{error}</span>
      )}

      {!error && (
        <span className="text-[11px] text-muted/50">
          AI rewrites your idea as a detailed product brief
        </span>
      )}
    </div>
  );
}
