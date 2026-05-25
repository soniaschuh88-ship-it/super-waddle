/**
 * src/components/CodeStudio/MilestoneDialog.tsx
 * Fullscreen overlay shown when the agent pauses at a milestone.
 */
import { useState } from 'react';
import { Flag, Sparkles, ArrowRight, Plus } from 'lucide-react';
import type { MilestoneState } from '@/types';
import { useAppState } from '@/context/AppContext';

interface Props {
  milestone:  MilestoneState;
  onContinue: (userNotes: string) => void;
}

export function MilestoneDialog({ milestone, onContinue }: Props) {
  const { state } = useAppState();
  const { versions, projectFiles } = state;
  const [notes, setNotes] = useState('');

  const doneFiles   = projectFiles.filter(f => !f.isStreaming).length;
  const totalFiles  = milestone.totalFiles;
  const pct         = totalFiles > 0 ? Math.round(doneFiles / totalFiles * 100) : 0;

  return (
    <div className="absolute inset-0 z-50 bg-base/90 backdrop-blur-md flex items-center justify-center p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden animate-slide-in">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-5 bg-panel border-b border-border">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent/15 border border-accent/30">
            <Flag size={20} className="text-accent"/>
          </div>
          <div>
            <h2 className="text-base font-bold text-text-primary">{milestone.label}</h2>
            <p className="text-sm text-muted">Phase {milestone.phase} checkpoint</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-2xl font-bold text-accent tabular-nums">{pct}%</p>
            <p className="text-xs text-muted">{doneFiles} / {totalFiles} files</p>
          </div>
        </div>

        <div className="p-6 flex flex-col gap-5">
          {/* Progress bar */}
          <div className="h-2 rounded-full bg-border overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width:`${pct}%` }}/>
          </div>

          {/* Version snapshot info */}
          {versions.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-success/30 bg-success/5 text-sm text-green-400">
              <Plus size={14}/>
              Version {versions.length} snapshot saved — you can always roll back
            </div>
          )}

          {/* AI suggestions */}
          {milestone.suggestedFeatures.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-text-primary flex items-center gap-2 mb-2">
                <Sparkles size={14} className="text-accent"/> Agent suggestions for next features
              </p>
              <ul className="flex flex-col gap-1.5">
                {milestone.suggestedFeatures.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent/15 text-accent text-[11px] flex items-center justify-center mt-0.5">{i+1}</span>
                    <button
                      className="text-left hover:text-text-primary transition-colors"
                      onClick={() => setNotes(prev => prev ? `${prev}\n${s}` : s)}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted/50 mt-1">Click a suggestion to add it to your notes below</p>
            </div>
          )}

          {/* User notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">
              Your feedback / new instructions (optional)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Add feature requests, corrections, or style preferences for the remaining files… Leave blank to continue as-is."
              className="bg-base border border-border text-text-primary text-sm font-mono rounded-lg p-3 resize-none focus:outline-none focus:border-accent/60 placeholder:text-muted/30"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => onContinue(notes)}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-accent text-base font-semibold text-sm tracking-wide hover:bg-accent-dim btn-glow transition-all"
            >
              {notes.trim() ? 'Apply feedback & continue' : 'Continue generating code'}
              <ArrowRight size={16}/>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
