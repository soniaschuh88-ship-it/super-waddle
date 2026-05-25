/**
 * src/components/Stufe1/FeatureTable.tsx
 *
 * Excel-style editable feature grid — replaces the chip-card FeatureProposals UI.
 *
 * Columns: # | ✓ | Feature Name | Description / Rationale | Priority | Complexity | Tech Hint
 *
 * Features:
 *   • Inline editing for Name, Rationale, TechHint cells
 *   • Dropdown pickers for Priority and Complexity
 *   • Row-level checkbox (include / exclude from plan)
 *   • Add blank row button
 *   • Delete row button (hover reveal)
 *   • Select-all / deselect-all shortcuts
 *   • Keyboard: Tab moves right, Shift+Tab left, Enter confirms cell
 */

import { useRef, useState, useCallback } from 'react';
import { Plus, Trash2, ChevronDown, CheckSquare, Square } from 'lucide-react';
import type { FeatureProposal, FeaturePriority, FeatureComplexity } from '@/types';
import { useAppState } from '@/context/AppContext';

// ── Constants ─────────────────────────────────────────────────────────────────

const PRIORITIES:  FeaturePriority[]  = ['high', 'medium', 'low'];
const COMPLEXITIES: FeatureComplexity[] = ['XS', 'S', 'M', 'L', 'XL'];

const PRI_STYLE: Record<FeaturePriority, string> = {
  high:   'bg-error/15 text-red-400 border-error/30',
  medium: 'bg-warning/15 text-yellow-400 border-warning/30',
  low:    'bg-border/60 text-muted border-border',
};

const COMP_STYLE: Record<FeatureComplexity, string> = {
  XS: 'bg-success/10 text-green-400',
  S:  'bg-success/10 text-green-400',
  M:  'bg-info/10 text-blue-400',
  L:  'bg-warning/15 text-yellow-400',
  XL: 'bg-error/15 text-red-400',
};

// ── Inline editable cell ──────────────────────────────────────────────────────

function EditableCell({
  value,
  onChange,
  placeholder = '',
  mono = false,
  dim = false,
}: {
  value:       string;
  onChange:    (v: string) => void;
  placeholder?: string;
  mono?:        boolean;
  dim?:         boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => { onChange(draft); setEditing(false); };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        autoFocus
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { commit(); } }}
        className={[
          'w-full bg-base border border-accent/40 rounded px-1.5 py-0.5 text-xs outline-none text-text-primary',
          mono ? 'font-mono' : '',
        ].join(' ')}
      />
    );
  }

  return (
    <div
      onClick={() => { setDraft(value); setEditing(true); }}
      className={[
        'cursor-text rounded px-1.5 py-0.5 text-xs truncate hover:bg-surface transition-colors',
        dim ? 'text-muted/70 italic' : 'text-text-primary',
        mono ? 'font-mono' : '',
        !value ? 'text-muted/30' : '',
      ].join(' ')}
    >
      {value || placeholder}
    </div>
  );
}

// ── Dropdown cell ─────────────────────────────────────────────────────────────

function DropdownCell<T extends string>({
  value,
  options,
  onChange,
  styleMap,
}: {
  value:    T;
  options:  T[];
  onChange: (v: T) => void;
  styleMap: Record<string, string>;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        className={[
          'appearance-none cursor-pointer rounded px-1.5 py-0.5 pr-5 text-[11px] font-semibold border',
          'bg-transparent outline-none transition-colors',
          styleMap[value] ?? '',
        ].join(' ')}
      >
        {options.map(o => (
          <option key={o} value={o} className="bg-panel text-text-primary">{o}</option>
        ))}
      </select>
      <ChevronDown size={9} className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none text-muted/50" />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface FeatureTableProps {
  features:    FeatureProposal[];
  onGenerate:  () => void;
  isLoading:   boolean;
}

export function FeatureTable({ features, onGenerate, isLoading }: FeatureTableProps) {
  const { dispatch } = useAppState();

  const acceptedCount = features.filter(f => f.accepted).length;
  const canGenerate   = acceptedCount >= 1 && !isLoading;

  // ── Row mutations ───────────────────────────────────────────────────────────

  const updateFeature = useCallback((id: string, patch: Partial<FeatureProposal>) => {
    dispatch({
      type: 'SET_FEATURES',
      features: features.map(f => f.id === id ? { ...f, ...patch } : f),
    });
  }, [features, dispatch]);

  const deleteFeature = useCallback((id: string) => {
    dispatch({ type: 'SET_FEATURES', features: features.filter(f => f.id !== id) });
  }, [features, dispatch]);

  const addRow = useCallback(() => {
    const newFeature: FeatureProposal = {
      id:         `custom-${Date.now()}`,
      title:      '',
      rationale:  '',
      accepted:   true,
      priority:   'medium',
      complexity: 'M',
    };
    dispatch({ type: 'SET_FEATURES', features: [...features, newFeature] });
  }, [features, dispatch]);

  const selectAll = () => dispatch({ type: 'SET_FEATURES', features: features.map(f => ({ ...f, accepted: true })) });
  const clearAll  = () => dispatch({ type: 'SET_FEATURES', features: features.map(f => ({ ...f, accepted: false })) });

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted">
            {acceptedCount} / {features.length} selected
          </span>
          <button onClick={selectAll} disabled={isLoading} className="text-[11px] text-muted hover:text-accent px-1.5 py-0.5 rounded transition-colors">All</button>
          <button onClick={clearAll}  disabled={isLoading} className="text-[11px] text-muted hover:text-error px-1.5 py-0.5 rounded transition-colors">None</button>
        </div>
        <button onClick={addRow} disabled={isLoading} className="flex items-center gap-1 text-[11px] text-muted hover:text-text-primary border border-border hover:border-accent/40 px-2 py-1 rounded-lg transition-colors">
          <Plus size={11} /> Add feature
        </button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-panel border-b border-border">
              <th className="w-8 px-2 py-2 text-center text-muted font-medium">#</th>
              <th className="w-8 px-2 py-2 text-center text-muted font-medium">✓</th>
              <th className="px-2 py-2 text-left text-muted font-medium min-w-[140px]">Feature</th>
              <th className="px-2 py-2 text-left text-muted font-medium min-w-[200px]">Description</th>
              <th className="px-2 py-2 text-center text-muted font-medium w-24">Priority</th>
              <th className="px-2 py-2 text-center text-muted font-medium w-20">Complexity</th>
              <th className="px-2 py-2 text-left text-muted font-medium min-w-[100px]">Tech Hint</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {features.map((f, i) => (
              <tr
                key={f.id}
                className={[
                  'border-b border-border/60 group transition-colors',
                  f.accepted ? 'bg-base hover:bg-surface/40' : 'bg-base/60 opacity-50 hover:opacity-70',
                ].join(' ')}
              >
                {/* Row number */}
                <td className="px-2 py-1.5 text-center text-muted/40 font-mono select-none">{i + 1}</td>

                {/* Include checkbox */}
                <td className="px-2 py-1.5 text-center">
                  <button
                    onClick={() => updateFeature(f.id, { accepted: !f.accepted })}
                    disabled={isLoading}
                    className="text-accent hover:scale-110 transition-transform"
                  >
                    {f.accepted
                      ? <CheckSquare size={14} className="text-accent" />
                      : <Square     size={14} className="text-muted/40" />
                    }
                  </button>
                </td>

                {/* Feature name */}
                <td className="px-1 py-1">
                  <EditableCell
                    value={f.title}
                    onChange={v => updateFeature(f.id, { title: v })}
                    placeholder="Feature name"
                  />
                </td>

                {/* Description / rationale */}
                <td className="px-1 py-1">
                  <EditableCell
                    value={f.rationale}
                    onChange={v => updateFeature(f.id, { rationale: v })}
                    placeholder="Add description…"
                    dim
                  />
                </td>

                {/* Priority */}
                <td className="px-1 py-1 text-center">
                  <DropdownCell<FeaturePriority>
                    value={f.priority}
                    options={PRIORITIES}
                    onChange={v => updateFeature(f.id, { priority: v })}
                    styleMap={PRI_STYLE}
                  />
                </td>

                {/* Complexity */}
                <td className="px-1 py-1 text-center">
                  <DropdownCell<FeatureComplexity>
                    value={f.complexity}
                    options={COMPLEXITIES}
                    onChange={v => updateFeature(f.id, { complexity: v })}
                    styleMap={COMP_STYLE}
                  />
                </td>

                {/* Tech hint */}
                <td className="px-1 py-1">
                  <EditableCell
                    value={f.techHint ?? ''}
                    onChange={v => updateFeature(f.id, { techHint: v || undefined })}
                    placeholder="e.g. Redis, React Query"
                    mono
                    dim
                  />
                </td>

                {/* Delete */}
                <td className="px-1 py-1 text-center">
                  <button
                    onClick={() => deleteFeature(f.id)}
                    disabled={isLoading}
                    className="opacity-0 group-hover:opacity-100 text-muted/50 hover:text-error transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {features.length === 0 && (
        <p className="text-center text-sm text-muted py-4">
          No features yet — <button onClick={addRow} className="text-accent hover:underline">add one manually</button>
        </p>
      )}

      {/* Generate button */}
      <div className="flex justify-end pt-1">
        <button
          onClick={onGenerate}
          disabled={!canGenerate}
          className={[
            'px-6 py-2.5 rounded-lg font-semibold text-sm tracking-wide transition-all',
            canGenerate
              ? 'bg-accent text-base hover:bg-accent-dim btn-glow cursor-pointer'
              : 'bg-surface border border-border text-muted cursor-not-allowed',
          ].join(' ')}
        >
          {isLoading ? 'Generating plan…' : `Generate Plan with ${acceptedCount} feature${acceptedCount !== 1 ? 's' : ''} →`}
        </button>
      </div>
    </div>
  );
}
