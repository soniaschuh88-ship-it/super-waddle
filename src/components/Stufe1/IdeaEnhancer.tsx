/**
 * src/components/Stufe1/IdeaEnhancer.tsx
 *
 * "Enhance with AI" button.
 * If WebGPU backend is selected and the engine isn't loaded yet,
 * it first shows a determinate download progress bar while the model
 * is fetched, then runs the enhancement — fully automatic, no user action needed.
 */
import { useState } from 'react';
import { Wand2, Loader2, Sparkles } from 'lucide-react';
import { generateJson }    from '@/lib/llm-client';
import { ensureEngine, isEngineReady } from '@/lib/webllm';
import { ENHANCE_IDEA_SYSTEM, buildEnhanceIdeaUserPrompt } from '@/lib/prompts';
import { useAppState }     from '@/context/AppContext';
import type { EngineProgress } from '@/types';

interface IdeaEnhancerProps {
  ideaText:   string;
  onEnhanced: (text: string) => void;
  disabled?:  boolean;
}

/** Animated progress bar — determinate when progress 0-100, else indeterminate. */
function ProgressBar({ value = -1, label = '' }: { value?: number; label?: string }) {
  const indet = value < 0;
  return (
    <div className="flex flex-col gap-0.5 w-32">
      <div className="relative h-0.5 rounded-full bg-border/60 overflow-hidden">
        {indet ? (
          <div
            className="absolute inset-y-0 w-1/2 bg-accent/70 rounded-full"
            style={{ animation: 'enhSlide 1.6s ease-in-out infinite' }}
          />
        ) : (
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${Math.max(4, value)}%` }}
          />
        )}
        <style>{`@keyframes enhSlide{0%{left:-50%}100%{left:150%}}`}</style>
      </div>
      {label && (
        <span className="text-[10px] text-muted/50 font-mono truncate">{label}</span>
      )}
    </div>
  );
}

export function IdeaEnhancer({ ideaText, onEnhanced, disabled }: IdeaEnhancerProps) {
  const { state }    = useAppState();
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [done,       setDone]       = useState(false);
  const [engProgress, setEngProg]   = useState<EngineProgress | null>(null);

  const isWebGpu   = state.backendConfig.type === 'webgpu';
  const canEnhance = ideaText.trim().length >= 20 && !disabled && !loading;

  const handleEnhance = async () => {
    if (!canEnhance) return;
    setLoading(true); setError(''); setDone(false); setEngProg(null);

    try {
      // ── Phase 1: Ensure WebGPU engine is loaded (with visible progress) ──
      if (isWebGpu && !isEngineReady()) {
        setEngProg({ progress: 0, text: 'Loading model…' });
        await ensureEngine(state.backendConfig.modelId, (p) => {
          setEngProg(p);
        });
        setEngProg(null);
      }

      // ── Phase 2: Run the enhancement ─────────────────────────────────────
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
    setEngProg(null);
  };

  const btnLabel = engProgress
    ? `Loading model… ${engProgress.progress}%`
    : loading
    ? 'Enhancing…'
    : 'Enhance with AI';

  return (
    <div className="flex flex-col gap-1.5 items-end">
      <div className="flex items-center gap-2.5">
        {done  && !loading && <span className="text-[11px] text-success flex items-center gap-1"><Sparkles size={11}/>Enhanced!</span>}
        {error && !loading && <span className="text-[11px] text-error truncate max-w-[200px]">{error}</span>}
        {!error && !loading && !done && <span className="text-[11px] text-muted/40">AI rewrites as a detailed brief</span>}

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
          {loading ? <Loader2 size={12} className="animate-spin"/> : <Wand2 size={12}/>}
          {btnLabel}
        </button>
      </div>

      {/* Progress bar — determinate for model download, indeterminate for generation */}
      {loading && (
        <ProgressBar
          value={engProgress ? engProgress.progress : -1}
          label={engProgress ? engProgress.text : ''}
        />
      )}
    </div>
  );
}
