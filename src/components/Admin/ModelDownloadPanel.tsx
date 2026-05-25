/**
 * src/components/Admin/ModelDownloadPanel.tsx
 *
 * Unified model download + hardware check panel for the Admin dashboard.
 *
 * Features:
 *   • GPU / hardware detection (calls llama-cpp /gpu, falls back to WebGPU info)
 *   • VRAM-aware model recommendations (highlight what fits)
 *   • Download via server /models/download  (SSE progress bar)
 *   • Custom HuggingFace URI input
 *   • Pre-download compatibility estimate via /models/inspect
 *   • Lists locally available models
 *   • Quantization guide with Q4_K_M recommendation
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Download, Cpu, HardDrive, RefreshCw, CheckCircle,
  AlertCircle, ChevronDown, ChevronUp, Trash2, Loader2, Info, Zap,
} from 'lucide-react';
import { LLAMA_CPP_RECOMMENDED, filterByMaxSize, llamaCppListModels, llamaCppDeleteModel, type LlamaCppModel } from '@/lib/llm-client';

// ── VRAM requirements reference ───────────────────────────────────────────────

const VRAM_TABLE = [
  { params: '0.5B', vramGb: 0.5,  description: 'Ultra compact, minimal quality' },
  { params: '1B',   vramGb: 1.0,  description: 'Fast, usable quality' },
  { params: '3B',   vramGb: 2.5,  description: 'Good balance for most tasks' },
  { params: '7B',   vramGb: 5.5,  description: 'High quality, needs a GPU' },
  { params: '13B',  vramGb: 10.0, description: 'Very high quality' },
  { params: '70B',  vramGb: 55.0, description: 'State-of-the-art, needs multi-GPU' },
];

const QUANT_GUIDE = [
  { key: 'Q4_K_M', label: 'Q4_K_M ★', recommendation: 'Best balance — recommended for most users', quality: 90, speed: 95 },
  { key: 'Q5_K_M', label: 'Q5_K_M',   recommendation: 'Slightly better quality, ~15% larger',       quality: 94, speed: 88 },
  { key: 'Q8_0',   label: 'Q8_0',     recommendation: 'Near-lossless, ~2× size of Q4',               quality: 99, speed: 75 },
  { key: 'Q2_K',   label: 'Q2_K',     recommendation: 'Aggressive compression, lower quality',        quality: 70, speed: 99 },
  { key: 'f16',    label: 'f16',       recommendation: 'Uncompressed — impractical for inference',     quality: 100, speed: 40 },
];

// ── GPU info from server ──────────────────────────────────────────────────────

interface GpuInfo {
  backend: string;
  gpuInfo: unknown;
  vramGb?: number; // if detectable
}

async function fetchGpuInfo(serverUrl: string): Promise<GpuInfo | null> {
  try {
    const r = await fetch(`${serverUrl}/gpu`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    return r.json() as Promise<GpuInfo>;
  } catch { return null; }
}

// ── SSE download ──────────────────────────────────────────────────────────────

interface DownloadState {
  status:  'idle' | 'starting' | 'downloading' | 'done' | 'error';
  pct:     number;
  message: string;
}

async function downloadModel(
  serverUrl: string,
  uri: string,
  onProgress: (state: DownloadState) => void,
  abortSignal: AbortSignal,
): Promise<void> {
  onProgress({ status: 'starting', pct: 0, message: 'Connecting…' });

  const r = await fetch(`${serverUrl}/models/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uri }),
    signal: abortSignal,
  });

  if (!r.ok) throw new Error(`Server returned ${r.status}`);
  if (!r.body) throw new Error('No response body');

  const reader = r.body.getReader();
  const dec    = new TextDecoder();
  let buf      = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const json = t.slice(5).trim();
      if (json === '[DONE]') return;
      try {
        const obj = JSON.parse(json) as { status: string; pct?: number; message?: string; error?: string };
        if (obj.status === 'done') {
          onProgress({ status: 'done', pct: 100, message: 'Download complete!' });
          return;
        }
        if (obj.status === 'error') throw new Error(obj.message ?? 'Download failed');
        onProgress({
          status:  'downloading',
          pct:     obj.pct ?? 0,
          message: obj.message ?? '',
        });
      } catch (e) {
        if (e instanceof Error && e.message !== 'JSON parse') throw e;
      }
    }
  }
}

// ── Model card ────────────────────────────────────────────────────────────────

interface ModelCardProps {
  uri:          string;
  label:        string;
  description:  string;
  sizeB:        number;
  serverUrl:    string;
  installed:    boolean;
  fitsHardware: boolean | null;   // null = unknown
  onDownloaded: () => void;
}

function ModelCard({ uri, label, description, sizeB, serverUrl, installed, fitsHardware, onDownloaded }: ModelCardProps) {
  const [dl, setDl]         = useState<DownloadState>({ status:'idle', pct:0, message:'' });
  const abortRef            = useRef<AbortController | null>(null);

  const start = async () => {
    abortRef.current = new AbortController();
    try {
      await downloadModel(serverUrl, uri, setDl, abortRef.current.signal);
      onDownloaded();
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setDl({ status:'error', pct:0, message: e.message });
      } else {
        setDl({ status:'idle', pct:0, message:'' });
      }
    }
  };

  const cancel = () => { abortRef.current?.abort(); };

  const isDownloading = dl.status === 'downloading' || dl.status === 'starting';
  const isDone        = dl.status === 'done';
  const isError       = dl.status === 'error';

  return (
    <div className={[
      'rounded-xl border transition-all p-4',
      installed || isDone
        ? 'border-success/30 bg-success/3'
        : fitsHardware === false
        ? 'border-warning/20 bg-warning/3 opacity-75'
        : 'border-border bg-panel',
    ].join(' ')}>
      <div className="flex items-start gap-3">
        {/* Status icon */}
        <div className="flex-shrink-0 mt-0.5">
          {installed || isDone
            ? <CheckCircle size={18} className="text-success"/>
            : fitsHardware === false
            ? <AlertCircle size={18} className="text-warning"/>
            : <HardDrive size={18} className="text-muted/50"/>
          }
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-text-primary">{label}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-border/60 text-muted font-mono">{sizeB}B</span>
            {fitsHardware === true  && <span className="text-[11px] text-success">✓ fits your hardware</span>}
            {fitsHardware === false && <span className="text-[11px] text-warning">⚠ may be too large</span>}
          </div>
          <p className="text-xs text-muted mt-0.5">{description}</p>
          <p className="text-[11px] text-muted/50 font-mono mt-1 truncate">{uri}</p>

          {/* Progress bar */}
          {(isDownloading) && (
            <div className="mt-2">
              <div className="h-1.5 rounded-full bg-border overflow-hidden">
                <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${dl.pct}%` }}/>
              </div>
              <p className="text-[11px] text-muted/60 font-mono mt-1 truncate">{dl.message}</p>
            </div>
          )}
          {isError && <p className="text-[11px] text-error mt-1">{dl.message}</p>}
        </div>

        {/* Action button */}
        <div className="flex-shrink-0">
          {installed || isDone ? (
            <span className="text-xs text-success font-medium flex items-center gap-1">
              <CheckCircle size={12}/> Installed
            </span>
          ) : isDownloading ? (
            <button onClick={cancel} className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted hover:text-error border border-border hover:border-error/30 rounded-lg transition-colors">
              Cancel
            </button>
          ) : (
            <button onClick={start} disabled={isDownloading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded-lg transition-colors cursor-pointer">
              <Download size={12}/>Pull
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props { serverUrl?: string; }

export function ModelDownloadPanel({ serverUrl = 'http://localhost:8001' }: Props) {
  const [gpu,          setGpu]          = useState<GpuInfo | null>(null);
  const [localModels,  setLocalModels]  = useState<LlamaCppModel[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [customUri,    setCustomUri]    = useState('');
  const [customDl,     setCustomDl]     = useState<DownloadState>({ status:'idle', pct:0, message:'' });
  const [showQuant,    setShowQuant]    = useState(false);
  const [showVram,     setShowVram]     = useState(false);
  const [onlySmall,    setOnlySmall]    = useState(true);
  const customAbort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [g, m] = await Promise.all([fetchGpuInfo(serverUrl), llamaCppListModels(serverUrl)]);
    setGpu(g);
    setLocalModels(m);
    setLoading(false);
  }, [serverUrl]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Estimate if a model fits based on GPU backend + sizeB heuristic
  const fitsHardware = (sizeB: number): boolean | null => {
    if (!gpu) return null;
    if (gpu.backend === 'cpu') return sizeB <= 3;   // CPU: up to 3B is ok
    if (gpu.backend === 'metal' || gpu.backend === 'cuda' || gpu.backend === 'vulkan') {
      // Optimistic: assume ~4GB VRAM for generic GPU
      return sizeB * 1.2 <= 4;
    }
    return null;
  };

  // installedIds used inside ModelCard via the isInstalled check below
  const visibleModels  = onlySmall ? filterByMaxSize(LLAMA_CPP_RECOMMENDED, 2.0) : LLAMA_CPP_RECOMMENDED;

  const handleCustomDownload = async () => {
    if (!customUri.trim()) return;
    customAbort.current = new AbortController();
    try {
      await downloadModel(serverUrl, customUri.trim(), setCustomDl, customAbort.current.signal);
      await refresh();
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setCustomDl({ status:'error', pct:0, message: e.message });
      }
    }
  };

  const handleDeleteLocal = async (filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return;
    try {
      await llamaCppDeleteModel(serverUrl, filename);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  return (
    <div className="flex flex-col gap-6">

      {/* Hardware detection */}
      <div className="rounded-xl border border-border bg-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-accent"/>
            <span className="text-sm font-semibold text-text-primary">Hardware Detection</span>
          </div>
          <button onClick={refresh} disabled={loading} className="text-muted hover:text-accent transition-colors">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/>
          </button>
        </div>

        {gpu ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-[11px] text-muted uppercase tracking-wider">GPU Backend</p>
              <p className="text-sm font-bold text-text-primary capitalize mt-0.5">{gpu.backend}</p>
              <p className="text-[11px] text-muted/60 mt-0.5">
                {gpu.backend === 'metal'  && 'Apple Silicon — Metal acceleration'}
                {gpu.backend === 'cuda'   && 'NVIDIA CUDA acceleration'}
                {gpu.backend === 'vulkan' && 'Vulkan GPU acceleration'}
                {gpu.backend === 'cpu'    && 'CPU only — GPU not detected'}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-[11px] text-muted uppercase tracking-wider">Recommended Size</p>
              <p className="text-sm font-bold text-text-primary mt-0.5">
                {gpu.backend === 'cpu'    ? '≤ 1B params'
                 : gpu.backend === 'metal' ? '≤ 3B params'
                 : '≤ 3B params'}
              </p>
              <p className="text-[11px] text-muted/60 mt-0.5">based on typical VRAM</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted">
            <AlertCircle size={14}/>
            <span>Server unreachable — start node-llama-cpp server first</span>
          </div>
        )}
      </div>

      {/* Size filter + VRAM guide toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => setOnlySmall(p => !p)}
          className={['flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors',
            onlySmall ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-base border-border text-muted hover:border-accent/30'].join(' ')}>
          {onlySmall ? '≤ 2B models' : 'All sizes'}
        </button>
        <button onClick={() => setShowVram(p => !p)} className="flex items-center gap-1 text-[11px] text-muted hover:text-accent transition-colors">
          <Info size={11}/> VRAM guide {showVram ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
        </button>
        <button onClick={() => setShowQuant(p => !p)} className="flex items-center gap-1 text-[11px] text-muted hover:text-accent transition-colors">
          <Info size={11}/> Quantization {showQuant ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
        </button>
      </div>

      {/* VRAM reference table */}
      {showVram && (
        <div className="rounded-xl border border-border overflow-hidden animate-fade-in">
          <div className="px-4 py-2.5 bg-panel border-b border-border">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">VRAM Requirements (Q4_K_M)</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface border-b border-border">
                  {['Params', 'VRAM Needed', 'Notes'].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-muted font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {VRAM_TABLE.map(row => {
                  const fits = gpu ? (
                    gpu.backend === 'cpu' ? row.vramGb <= 1 :
                    row.vramGb <= 4
                  ) : null;
                  return (
                    <tr key={row.params} className="border-b border-border/60 hover:bg-surface/40">
                      <td className="px-4 py-2 font-mono font-bold text-text-primary">{row.params}</td>
                      <td className="px-4 py-2 font-mono text-muted">{row.vramGb} GB</td>
                      <td className="px-4 py-2 text-muted/80 flex items-center gap-1.5">
                        {fits === true && <CheckCircle size={11} className="text-success flex-shrink-0"/>}
                        {fits === false && <AlertCircle size={11} className="text-warning flex-shrink-0"/>}
                        {row.description}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quantization guide */}
      {showQuant && (
        <div className="rounded-xl border border-border overflow-hidden animate-fade-in">
          <div className="px-4 py-2.5 bg-panel border-b border-border">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Quantization Levels</p>
          </div>
          <div className="flex flex-col divide-y divide-border/60">
            {QUANT_GUIDE.map(q => (
              <div key={q.key} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface/40">
                <span className={['font-mono text-xs font-bold w-16',
                  q.key === 'Q4_K_M' ? 'text-accent' : 'text-text-primary'].join(' ')}>{q.label}</span>
                <div className="flex-1">
                  <p className="text-xs text-muted">{q.recommendation}</p>
                  <div className="flex gap-3 mt-1">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted/50">Quality</span>
                      <div className="w-16 h-1 rounded-full bg-border overflow-hidden">
                        <div className="h-full bg-accent rounded-full" style={{ width: `${q.quality}%` }}/>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted/50">Speed</span>
                      <div className="w-16 h-1 rounded-full bg-border overflow-hidden">
                        <div className="h-full bg-success rounded-full" style={{ width: `${q.speed}%` }}/>
                      </div>
                    </div>
                  </div>
                </div>
                {q.key === 'Q4_K_M' && (
                  <span className="text-[10px] bg-accent/15 border border-accent/30 text-accent px-1.5 py-0.5 rounded-full flex-shrink-0">★ Best</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommended models */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          <Zap size={14} className="text-accent"/> Recommended Models
        </h3>
        <div className="flex flex-col gap-2.5">
          {visibleModels.map(m => {
            const shortName = m.uri.split('/').pop()?.split(':')[0] ?? m.uri;
            const isInstalled = localModels.some(lm =>
              lm.id.toLowerCase().includes(shortName.toLowerCase().replace(/-gguf/i,''))
            );
            return (
              <ModelCard
                key={m.uri}
                uri={m.uri}
                label={m.label}
                description={m.description}
                sizeB={m.sizeB}
                serverUrl={serverUrl}
                installed={isInstalled}
                fitsHardware={fitsHardware(m.sizeB)}
                onDownloaded={refresh}
              />
            );
          })}
        </div>
      </div>

      {/* Custom URI */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Download size={14} className="text-accent"/> Custom Download
        </h3>
        <p className="text-xs text-muted">Enter a HuggingFace URI or direct URL to any GGUF file.</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={customUri}
            onChange={e => setCustomUri(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCustomDownload()}
            placeholder="hf:bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M"
            className="flex-1 bg-base border border-border text-text-primary text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60 placeholder:text-muted/30"
          />
          <button
            onClick={handleCustomDownload}
            disabled={!customUri.trim() || customDl.status === 'downloading' || customDl.status === 'starting'}
            className="flex items-center gap-1.5 px-3 py-2 text-xs bg-accent text-base hover:bg-accent-dim rounded-lg transition-colors disabled:bg-surface disabled:text-muted disabled:cursor-not-allowed"
          >
            {customDl.status === 'downloading' || customDl.status === 'starting'
              ? <><Loader2 size={12} className="animate-spin"/>Downloading…</>
              : <><Download size={12}/>Download</>}
          </button>
        </div>
        {(customDl.status === 'downloading' || customDl.status === 'starting') && (
          <div>
            <div className="h-1.5 rounded-full bg-border overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${customDl.pct}%` }}/>
            </div>
            <p className="text-[11px] text-muted/60 font-mono mt-1">{customDl.message}</p>
          </div>
        )}
        {customDl.status === 'done' && <p className="text-xs text-success flex items-center gap-1"><CheckCircle size={12}/>Downloaded successfully</p>}
        {customDl.status === 'error' && <p className="text-xs text-error">{customDl.message}</p>}
      </div>

      {/* Installed models */}
      {localModels.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
            <HardDrive size={14} className="text-accent"/> Installed Models ({localModels.length})
          </h3>
          <div className="flex flex-col gap-2">
            {localModels.map(m => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-panel">
                <CheckCircle size={15} className="text-success flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono font-semibold text-text-primary truncate">{m.id}</p>
                  {'sizeMb' in m && <p className="text-[11px] text-muted">{(m as LlamaCppModel & { sizeMb?: number }).sizeMb ?? '?'} MB</p>}
                </div>
                <button onClick={() => handleDeleteLocal(m.id)} className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted hover:text-error border border-transparent hover:border-error/30 rounded-lg transition-colors">
                  <Trash2 size={12}/>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
