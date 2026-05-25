/**
 * src/components/Admin/EmbeddingsLab.tsx
 *
 * Semantic similarity playground — computes cosine similarity between texts
 * using either WebGPU (web-llm engine.embeddings) or the node-llama-cpp
 * server (/v1/similarity and /v1/embeddings).
 *
 * Features:
 *   • One reference text vs. N comparison texts (rank by similarity)
 *   • Single pair mode with animated similarity gauge
 *   • Batch mode: paste a list, rank them all
 *   • Shows embedding dimension, cosine score, coloured heatmap bar
 *   • Works with any loaded WebGPU model or llama-cpp server
 */
import { useState, useCallback } from 'react';
import {
  Plus, Trash2, Zap, RefreshCw, Info, ChevronUp, Cpu, Loader2,
} from 'lucide-react';
import {
  computeSemanticSimilarity, createEmbeddings, isEngineReady,
  isEngineLoading, ensureEngine, loadedModelId,
  MODEL_OPTIONS, DEFAULT_MODEL_ID,
} from '@/lib/webllm';
import type { BackendConfig, EngineProgress } from '@/types';

// ── Backend helpers ───────────────────────────────────────────────────────────

async function similarityViaServer(
  base: string,
  text1: string,
  text2: string,
): Promise<number> {
  const r = await fetch(`${base}/v1/similarity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text1, text2 }),
  });
  if (!r.ok) throw new Error(`Server returned ${r.status}`);
  const d = await r.json() as { similarity: number };
  return d.similarity;
}

async function embeddingsViaServer(
  base: string,
  texts: string[],
): Promise<number[][]> {
  const r = await fetch(`${base}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: texts }),
  });
  if (!r.ok) throw new Error(`Server returned ${r.status}`);
  const d = await r.json() as { data: Array<{ index: number; embedding: number[] }> };
  return d.data.sort((a, b) => a.index - b.index).map(e => e.embedding);
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, mA = 0, mB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; mA += a[i]*a[i]; mB += b[i]*b[i]; }
  const d = Math.sqrt(mA) * Math.sqrt(mB);
  return d === 0 ? 0 : dot / d;
}

// ── Similarity bar ────────────────────────────────────────────────────────────

function SimilarityBar({ score }: { score: number }) {
  const pct  = Math.round(score * 100);
  const color =
    pct >= 80 ? 'bg-success'
    : pct >= 60 ? 'bg-accent'
    : pct >= 40 ? 'bg-warning'
    : 'bg-error';

  const label =
    pct >= 85 ? 'Very similar'
    : pct >= 65 ? 'Related'
    : pct >= 45 ? 'Somewhat related'
    : pct >= 25 ? 'Loosely related'
    : 'Dissimilar';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-text-primary">
          Similarity: <span className="tabular-nums">{pct}%</span>
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          pct >= 80 ? 'bg-success/15 text-green-400'
          : pct >= 60 ? 'bg-accent/15 text-accent'
          : pct >= 40 ? 'bg-warning/15 text-yellow-400'
          : 'bg-error/15 text-red-400'
        }`}>{label}</span>
      </div>
      <div className="h-3 rounded-full bg-border overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-muted/60 font-mono">
        cosine score: {score.toFixed(6)}
      </p>
    </div>
  );
}

// ── Ranked result row ─────────────────────────────────────────────────────────

function RankedRow({ rank, text, score }: { rank: number; text: string; score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-panel">
      <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
        rank === 1 ? 'bg-accent text-base' : 'bg-border text-muted'
      }`}>{rank}</span>
      <p className="flex-1 text-sm text-text-primary truncate">{text}</p>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-20 h-1.5 rounded-full bg-border overflow-hidden">
          <div
            className={`h-full rounded-full ${pct >= 70 ? 'bg-accent' : pct >= 45 ? 'bg-warning' : 'bg-error'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs font-mono tabular-nums text-muted w-10 text-right">{pct}%</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  backendConfig?: BackendConfig;
}

type Mode = 'pair' | 'rank';

export function EmbeddingsLab({ backendConfig }: Props) {
  const [mode, setMode]               = useState<Mode>('pair');
  const [refText, setRefText]         = useState('');
  const [pairText, setPairText]       = useState('');
  const [candidates, setCandidates]   = useState<string[]>(['', '']);
  const [pairScore, setPairScore]     = useState<number | null>(null);
  const [ranked, setRanked]           = useState<Array<{ text: string; score: number }>>([]);
  const [loading, setLoading]           = useState(false);
  const [err, setErr]                   = useState('');
  const [embDim, setEmbDim]             = useState<number | null>(null);
  const [showInfo, setShowInfo]         = useState(false);
  // WebLLM loader state
  const [modelToLoad, setModelToLoad]   = useState(DEFAULT_MODEL_ID);
  const [loadProgress, setLoadProgress] = useState<EngineProgress | null>(null);
  const [loadErr, setLoadErr]           = useState('');

  const useWebGpu = !backendConfig || backendConfig.type === 'webgpu';
  const serverUrl = backendConfig?.serverUrl ?? 'http://localhost:8001';
  const engineReady   = isEngineReady();
  const engineLoading = isEngineLoading();
  const activeModel   = loadedModelId();

  const handleLoadEngine = useCallback(async () => {
    setLoadErr(''); setLoadProgress({ progress: 0, text: 'Starting…' });
    try {
      await ensureEngine(modelToLoad, p => setLoadProgress(p));
      setLoadProgress(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Load failed');
      setLoadProgress(null);
    }
  }, [modelToLoad]);

  const canRun = refText.trim().length > 0 &&
    (mode === 'pair' ? pairText.trim().length > 0 : candidates.some(c => c.trim().length > 0)) &&
    (useWebGpu ? engineReady : true);

  // ── Pair mode ───────────────────────────────────────────────────────────────

  const runPair = useCallback(async () => {
    setLoading(true); setErr(''); setPairScore(null);
    try {
      let score: number;
      if (useWebGpu) {
        score = await computeSemanticSimilarity(refText.trim(), pairText.trim());
        // Also peek at embedding dimension
        const [v] = await createEmbeddings([refText.trim()]);
        setEmbDim(v.length);
      } else {
        score = await similarityViaServer(serverUrl, refText.trim(), pairText.trim());
      }
      setPairScore(score);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to compute similarity');
    }
    setLoading(false);
  }, [refText, pairText, useWebGpu, serverUrl]);

  // ── Rank mode ───────────────────────────────────────────────────────────────

  const runRank = useCallback(async () => {
    const valid = [refText.trim(), ...candidates.filter(c => c.trim())];
    if (valid.length < 2) { setErr('Add at least one comparison text.'); return; }
    setLoading(true); setErr(''); setRanked([]);

    try {
      let vectors: number[][];
      if (useWebGpu) {
        vectors = await createEmbeddings(valid);
        setEmbDim(vectors[0].length);
      } else {
        vectors = await embeddingsViaServer(serverUrl, valid);
        setEmbDim(vectors[0].length);
      }

      const ref      = vectors[0];
      const compTexts  = candidates.filter(c => c.trim());
      const compVecs   = vectors.slice(1);
      const results    = compTexts.map((text, i) => ({
        text,
        score: cosine(ref, compVecs[i]),
      }));
      results.sort((a, b) => b.score - a.score);
      setRanked(results);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ranking failed');
    }
    setLoading(false);
  }, [refText, candidates, useWebGpu, serverUrl]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">
      {/* Header + info */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted leading-relaxed">
            Compute semantic similarity between texts using neural embeddings.
            Cosine similarity ranges from 0 (unrelated) to 1 (identical meaning).
          </p>
        </div>
        <button onClick={() => setShowInfo(p => !p)} className="flex-shrink-0 text-muted hover:text-accent transition-colors mt-0.5">
          {showInfo ? <ChevronUp size={16}/> : <Info size={16}/>}
        </button>
      </div>

      {/* Info box */}
      {showInfo && (
        <div className="rounded-lg border border-border bg-panel p-4 text-sm text-muted/80 leading-relaxed animate-fade-in">
          <p className="font-semibold text-text-primary mb-1.5">How embeddings work</p>
          <p>Each text is converted to a high-dimensional vector (e.g. 1536 floats) that captures its semantic meaning. Cosine similarity measures the angle between vectors — 1.0 = same direction (same meaning), 0 = orthogonal (unrelated), negative = opposite.</p>
          <p className="mt-2">
            <strong className="text-text-primary">WebGPU backend</strong>: uses <code className="font-mono text-[11px] bg-border/60 px-1 rounded">engine.embeddings.create()</code> from web-llm.<br/>
            <strong className="text-text-primary">Server backend</strong>: calls <code className="font-mono text-[11px] bg-border/60 px-1 rounded">POST /v1/similarity</code> on the node-llama-cpp server.
          </p>
          {embDim !== null && (
            <p className="mt-2 font-mono text-[11px] text-accent">Embedding dimension: {embDim}</p>
          )}
        </div>
      )}

      {/* Backend badge */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
          useWebGpu
            ? 'bg-accent/10 border-accent/30 text-accent'
            : 'bg-info/10 border-info/30 text-blue-400'
        }`}>
          {useWebGpu
            ? `WebGPU (web-llm)${activeModel ? ` · ${activeModel.split('/').pop()}` : ''}`
            : `llama-cpp server · ${serverUrl}`}
        </span>
        {useWebGpu && engineReady  && <span className="text-[11px] text-success">✓ engine ready</span>}
        {useWebGpu && engineLoading && <span className="text-[11px] text-accent flex items-center gap-1"><Loader2 size={10} className="animate-spin"/>loading…</span>}
      </div>

      {/* ── Inline WebLLM loader (shown when WebGPU is selected but engine not loaded) ── */}
      {useWebGpu && !engineReady && !engineLoading && (
        <div className="rounded-xl border border-border bg-panel p-4 flex flex-col gap-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-accent"/>
            <span className="text-sm font-semibold text-text-primary">Load WebLLM Model</span>
            <span className="text-xs text-muted ml-1">— required to use embeddings in-browser</span>
          </div>

          <p className="text-xs text-muted leading-relaxed">
            Select a model and click Load. The model downloads to your browser cache (~210 MB – 2 GB depending on selection).
            Alternatively, switch to the <strong className="text-text-primary">Ollama</strong> or{' '}
            <strong className="text-text-primary">node-llama-cpp</strong> backend which requires no download here.
          </p>

          <div className="flex gap-2">
            <select value={modelToLoad} onChange={e => setModelToLoad(e.target.value)}
              className="flex-1 bg-base border border-border text-text-primary text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60">
              {MODEL_OPTIONS.map(m => (
                <option key={m.id} value={m.id}>{m.label} (~{m.sizeMb} MB)</option>
              ))}
            </select>
            <button onClick={handleLoadEngine}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-accent text-base hover:bg-accent-dim btn-glow rounded-lg transition-colors cursor-pointer">
              <Cpu size={13}/>Load Model
            </button>
          </div>

          {/* Load progress */}
          {loadProgress && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted font-mono">{loadProgress.text || 'Loading…'}</span>
                <span className="text-accent font-mono font-semibold tabular-nums">{loadProgress.progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-border overflow-hidden">
                <div className="h-full bg-accent rounded-full transition-all duration-300"
                  style={{ width: `${loadProgress.progress}%` }}/>
              </div>
            </div>
          )}

          {loadErr && <p className="text-xs text-error">{loadErr}</p>}
        </div>
      )}

      {/* Loading spinner when engine is initialising */}
      {useWebGpu && engineLoading && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 flex items-center gap-3 animate-fade-in">
          <Loader2 size={18} className="text-accent animate-spin flex-shrink-0"/>
          <div>
            <p className="text-sm font-medium text-text-primary">
              {loadProgress ? loadProgress.text : 'Loading model…'}
            </p>
            {loadProgress && (
              <div className="mt-1.5 h-1.5 rounded-full bg-border overflow-hidden w-48">
                <div className="h-full bg-accent rounded-full transition-all duration-300"
                  style={{ width: `${loadProgress.progress}%` }}/>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mode tabs */}
      <div className="flex gap-2">
        {(['pair', 'rank'] as Mode[]).map(m => (
          <button key={m} onClick={() => { setMode(m); setPairScore(null); setRanked([]); setErr(''); }}
            className={['px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
              mode === m ? 'bg-accent/15 border-accent/50 text-accent' : 'bg-base border-border text-muted hover:border-accent/30'].join(' ')}>
            {m === 'pair' ? '⇄ Pair comparison' : '▦ Rank many texts'}
          </button>
        ))}
      </div>

      {/* Reference text (both modes) */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Reference text</label>
        <textarea
          value={refText}
          onChange={e => setRefText(e.target.value)}
          rows={3}
          placeholder="Enter the reference text to compare against…"
          className="bg-base border border-border text-text-primary text-sm rounded-lg p-3 resize-none focus:outline-none focus:border-accent/60 placeholder:text-muted/30"
        />
      </div>

      {/* Pair mode */}
      {mode === 'pair' && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Comparison text</label>
          <textarea
            value={pairText}
            onChange={e => setPairText(e.target.value)}
            rows={3}
            placeholder="Enter a second text to compare against the reference…"
            className="bg-base border border-border text-text-primary text-sm rounded-lg p-3 resize-none focus:outline-none focus:border-accent/60 placeholder:text-muted/30"
          />
        </div>
      )}

      {/* Rank mode */}
      {mode === 'rank' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">
              Candidate texts ({candidates.length})
            </label>
            <button onClick={() => setCandidates(p => [...p, ''])}
              className="flex items-center gap-1 text-[11px] text-muted hover:text-accent transition-colors">
              <Plus size={11}/>Add
            </button>
          </div>
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
            {candidates.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-2.5 text-[11px] text-muted/50 font-mono w-4 flex-shrink-0 text-right">{i+1}</span>
                <textarea
                  value={c}
                  onChange={e => {
                    const next = [...candidates];
                    next[i] = e.target.value;
                    setCandidates(next);
                  }}
                  rows={2}
                  placeholder={`Candidate ${i+1}…`}
                  className="flex-1 bg-base border border-border text-text-primary text-sm rounded-lg p-2.5 resize-none focus:outline-none focus:border-accent/60 placeholder:text-muted/30"
                />
                {candidates.length > 1 && (
                  <button onClick={() => setCandidates(p => p.filter((_, j) => j !== i))}
                    className="mt-2 text-muted/40 hover:text-error transition-colors">
                    <Trash2 size={13}/>
                  </button>
                )}
              </div>
            ))}
          </div>
          {/* Quick paste area */}
          <button
            onClick={() => {
              const text = window.prompt('Paste texts separated by newlines:');
              if (text) {
                const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
                setCandidates(lines);
              }
            }}
            className="text-[11px] text-muted hover:text-accent transition-colors self-start"
          >
            📋 Paste multiple lines at once
          </button>
        </div>
      )}

      {/* Error */}
      {err && <p className="text-sm text-error">{err}</p>}

      {/* Run button */}
      <button
        onClick={mode === 'pair' ? runPair : runRank}
        disabled={!canRun || loading}
        className={['flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm tracking-wide transition-all',
          canRun && !loading
            ? 'bg-accent text-base hover:bg-accent-dim btn-glow cursor-pointer'
            : 'bg-surface border border-border text-muted cursor-not-allowed'].join(' ')}>
        {loading
          ? <><RefreshCw size={14} className="animate-spin"/>Computing embeddings…</>
          : <><Zap size={14}/>{mode === 'pair' ? 'Compute similarity' : 'Rank by similarity'}</>}
      </button>

      {/* Pair result */}
      {mode === 'pair' && pairScore !== null && !loading && (
        <div className="rounded-xl border border-border bg-panel p-4 animate-slide-in">
          <SimilarityBar score={pairScore}/>
          {embDim !== null && (
            <p className="text-[11px] text-muted/50 font-mono mt-2">
              embedding dim: {embDim} · model: {useWebGpu ? 'WebGPU' : 'llama-cpp'}
            </p>
          )}
        </div>
      )}

      {/* Rank results */}
      {mode === 'rank' && ranked.length > 0 && !loading && (
        <div className="flex flex-col gap-2 animate-slide-in">
          <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">
            Ranked by similarity to reference ({ranked.length} texts)
          </p>
          {ranked.map((r, i) => (
            <RankedRow key={i} rank={i+1} text={r.text} score={r.score}/>
          ))}
          {embDim !== null && (
            <p className="text-[11px] text-muted/50 font-mono">
              embedding dim: {embDim} · model: {useWebGpu ? 'WebGPU' : 'llama-cpp'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
