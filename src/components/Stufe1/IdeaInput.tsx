/** src/components/Stufe1/IdeaInput.tsx – Textarea + preset cards + AI enhancer with progress. */
import { useState } from 'react';
import { Zap } from 'lucide-react';
import { PRESET_IDEAS } from '@/lib/prompts';
import { IdeaEnhancer } from './IdeaEnhancer';

interface IdeaInputProps {
  value:      string;
  onChange:   (t: string) => void;
  onSubmit:   () => void;
  isLoading:  boolean;
  /** 0-100 when we know a progress value, -1 for indeterminate, undefined when idle */
  loadProgress?: number;
  loadText?:  string;
}

/** Horizontal progress bar — determinate or indeterminate. */
function ProgressBar({ value, text }: { value: number; text?: string }) {
  const isIndet = value < 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-1 rounded-full bg-border overflow-hidden">
        {isIndet ? (
          <div
            className="absolute inset-y-0 w-1/3 bg-accent/70 rounded-full"
            style={{ animation: 'progressSlide 1.6s ease-in-out infinite' }}
          />
        ) : (
          <div
            className="h-full bg-accent rounded-full transition-all duration-500"
            style={{ width: `${Math.max(4, value)}%` }}
          />
        )}
        <style>{`@keyframes progressSlide{0%{left:-33%}100%{left:133%}}`}</style>
      </div>
      {text && (
        <p className="text-[11px] text-muted/70 font-mono truncate">{text}</p>
      )}
    </div>
  );
}

export function IdeaInput({
  value, onChange, onSubmit, isLoading, loadProgress, loadText,
}: IdeaInputProps) {
  const [chars, setChars] = useState(value.length);
  const empty = value.trim().length < 20;

  const showProgress = isLoading && loadProgress !== undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* Quick-load cards */}
      <div>
        <p className="text-[11px] font-medium text-muted uppercase tracking-wider mb-2">
          Quick-load examples
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {PRESET_IDEAS.map(p => (
            <button
              key={p.title}
              onClick={() => { onChange(p.text); setChars(p.text.length); }}
              disabled={isLoading}
              className="text-left p-3 rounded-lg border border-border bg-surface hover:border-accent/50 hover:bg-accent/5 transition-all group disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div className="flex items-start gap-2">
                <Zap size={14} className="mt-0.5 flex-shrink-0 text-muted group-hover:text-accent transition-colors" />
                <div>
                  <p className="text-xs font-semibold text-text-primary group-hover:text-accent transition-colors leading-tight">
                    {p.title}
                  </p>
                  <p className="text-[11px] text-muted mt-0.5 leading-tight">{p.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Idea textarea */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="idea-input" className="text-[11px] font-medium text-muted uppercase tracking-wider">
          Your product idea
        </label>
        <textarea
          id="idea-input"
          value={value}
          rows={8}
          disabled={isLoading}
          onChange={e => { onChange(e.target.value); setChars(e.target.value.length); }}
          placeholder={
            'Describe the product or system you want to build.\n' +
            'The more detail, the better the generated plan.\n\n' +
            'e.g. "A mobile app that helps users track their daily mood and receive\nAI-generated coping suggestions based on emotional patterns..."'
          }
          className={[
            'font-mono text-sm resize-none rounded-lg p-3.5',
            'bg-base border border-border text-text-primary',
            'placeholder:text-muted/40',
            'focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20',
            'transition-colors',
            isLoading ? 'opacity-50 cursor-not-allowed' : '',
          ].join(' ')}
        />
        <div className="flex items-center justify-between gap-3">
          <span className={`text-[11px] font-mono ${chars < 20 ? 'text-muted/50' : 'text-muted'}`}>
            {chars} chars{chars < 20 ? ' · minimum 20' : ''}
          </span>
          {!isLoading && chars >= 10 && (
            <IdeaEnhancer
              ideaText={value}
              onEnhanced={text => { onChange(text); setChars(text.length); }}
              disabled={isLoading}
            />
          )}
        </div>
      </div>

      {/* Submit button + progress */}
      <div className="flex flex-col gap-2">
        <button
          onClick={onSubmit}
          disabled={empty || isLoading}
          className={[
            'w-full py-3 rounded-lg font-semibold text-sm tracking-wide transition-all relative overflow-hidden',
            empty || isLoading
              ? 'bg-surface border border-border text-muted cursor-not-allowed'
              : 'bg-accent text-base hover:bg-accent-dim btn-glow cursor-pointer',
          ].join(' ')}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-muted/30 border-t-muted rounded-full animate-spin"/>
              {loadText ?? 'Proposing features…'}
            </span>
          ) : 'Propose Features →'}
        </button>

        {/* Progress bar — shown while loading */}
        {showProgress && (
          <ProgressBar value={loadProgress} text={loadText}/>
        )}
      </div>
    </div>
  );
}
