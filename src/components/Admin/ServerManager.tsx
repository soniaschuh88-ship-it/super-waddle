/**
 * src/components/Admin/ServerManager.tsx
 *
 * Start / stop the two model servers from the admin dashboard.
 *
 * Calls /api/* endpoints on the SAME origin as the app — these are served by
 * server/serve.js which combines static file serving with the manager API.
 * No separate manager process or URL config needed.
 *
 * To use: run `cd server && node serve.js` instead of the Python static server.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play, Square, RefreshCw, Terminal, AlertCircle,
  CheckCircle, XCircle, Cpu, Server, Copy, ChevronDown, ChevronUp,
} from 'lucide-react';

// ── API helpers (relative /api/ — same origin as the served app) ──────────────

const API = '/api';

interface ServerStatus {
  name: string; pid: number | null; running: boolean; reachable: boolean; port: number;
}

async function apiStatus(): Promise<{ llama: ServerStatus; ollama: ServerStatus } | null> {
  try {
    const r = await fetch(`${API}/status`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

async function apiLogs(server: 'llama' | 'ollama'): Promise<string[]> {
  try {
    const r = await fetch(`${API}/logs/${server}`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const d = await r.json() as { lines: string[] };
    return d.lines ?? [];
  } catch { return []; }
}

async function apiStartLlama(opts: { modelPath?: string } = {}): Promise<{ pid?: number; error?: string }> {
  const r = await fetch(`${API}/llama/start`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(opts) });
  return r.json();
}
async function apiStopLlama():   Promise<{ ok?: boolean; error?: string }> { return (await fetch(`${API}/llama/stop`,   { method:'POST' })).json(); }
async function apiStartOllama(): Promise<{ pid?: number; error?: string }> { return (await fetch(`${API}/ollama/start`, { method:'POST' })).json(); }
async function apiStopOllama():  Promise<{ ok?: boolean; error?: string }> { return (await fetch(`${API}/ollama/stop`,  { method:'POST' })).json(); }

interface SystemdUnits {
  llama:  { unitFile: string; content: string; commands: string[] };
  ollama: { unitFile?: string; installCommand?: string; commands: string[] };
}

async function apiSystemdUnits(): Promise<SystemdUnits | null> {
  try {
    const r = await fetch(`${API}/systemd-units`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    return r.json() as Promise<SystemdUnits>;
  } catch { return null; }
}

// ── Server card ───────────────────────────────────────────────────────────────

interface ServerCardProps {
  name:      'llama' | 'ollama';
  label:     string;
  icon:      React.FC<{size?:number;className?:string}>;
  status:    ServerStatus | null;
  onRefresh: () => void;
}

function ServerCard({ name, label, icon: Icon, status, onRefresh }: ServerCardProps) {
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState('');
  const [logs,      setLogs]      = useState<string[]>([]);
  const [showLogs,  setShowLogs]  = useState(false);
  const [modelPath, setModelPath] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const loadLogs = useCallback(async () => {
    setLogs(await apiLogs(name));
    setTimeout(() => logRef.current?.scrollTo({ top: 1e9, behavior:'smooth' }), 50);
  }, [name]);

  useEffect(() => { if (showLogs) void loadLogs(); }, [showLogs, loadLogs]);

  const handleStart = async () => {
    setBusy(true); setErr('');
    try {
      const r = name === 'llama'
        ? await apiStartLlama(modelPath ? { modelPath } : {})
        : await apiStartOllama();
      if (r.error) setErr(r.error);
      else setTimeout(onRefresh, 1500);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    setBusy(false);
  };

  const handleStop = async () => {
    setBusy(true); setErr('');
    try {
      const r = name === 'llama' ? await apiStopLlama() : await apiStopOllama();
      if (r.error) setErr(r.error);
      else setTimeout(onRefresh, 500);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    setBusy(false);
  };

  const running   = status?.running   ?? false;
  const reachable = status?.reachable ?? false;
  const pid       = status?.pid;
  const port      = status?.port;

  return (
    <div className={['rounded-xl border transition-all',
      running && reachable ? 'border-success/40 bg-success/3' : 'border-border bg-panel'].join(' ')}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={['w-8 h-8 rounded-lg flex items-center justify-center border',
          running ? 'bg-success/10 border-success/30' : 'bg-surface border-border'].join(' ')}>
          <Icon size={16} className={running ? 'text-success' : 'text-muted'}/>
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-text-primary">{label}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {running && reachable  && <span className="flex items-center gap-1 text-[11px] text-green-400"><CheckCircle size={10}/>Running · PID {pid} · :{port}</span>}
            {running && !reachable && <span className="flex items-center gap-1 text-[11px] text-yellow-400"><AlertCircle size={10}/>Starting… PID {pid}</span>}
            {!running && reachable && <span className="flex items-center gap-1 text-[11px] text-yellow-400"><AlertCircle size={10}/>Port :{port} in use (external process)</span>}
            {!running && !reachable && <span className="flex items-center gap-1 text-[11px] text-muted"><XCircle size={10}/>Stopped</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <button onClick={handleStop} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-error/10 hover:bg-error/20 border border-error/30 text-red-400 rounded-lg transition-colors disabled:opacity-50">
              {busy ? <RefreshCw size={12} className="animate-spin"/> : <Square size={12}/>}Stop
            </button>
          ) : (
            <button onClick={handleStart} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent/10 hover:bg-accent/20 border border-accent/30 text-accent rounded-lg transition-colors disabled:opacity-50">
              {busy ? <RefreshCw size={12} className="animate-spin"/> : <Play size={12}/>}Start
            </button>
          )}
          <button onClick={() => { setShowLogs(p=>!p); if (!showLogs) void loadLogs(); }}
            className="px-2 py-1.5 text-xs text-muted hover:text-text-primary border border-border rounded-lg transition-colors">
            <Terminal size={12}/>
          </button>
        </div>
      </div>

      {/* Model path input for llama (when not running) */}
      {name === 'llama' && !running && (
        <div className="px-4 pb-3">
          <input type="text" value={modelPath} onChange={e=>setModelPath(e.target.value)}
            placeholder="Optional: /path/to/model.gguf (auto-selects if blank)"
            className="w-full bg-base border border-border text-text-primary text-xs font-mono rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent/60 placeholder:text-muted/30"/>
        </div>
      )}

      {err && <p className="px-4 pb-2 text-xs text-error">{err}</p>}

      {/* Log tail */}
      {showLogs && (
        <div className="mx-4 mb-3 rounded-lg border border-border overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 bg-surface border-b border-border">
            <span className="text-[10px] font-mono text-muted/60">{label} · last {logs.length} lines</span>
            <button onClick={loadLogs} className="text-[10px] text-muted hover:text-accent"><RefreshCw size={10}/></button>
          </div>
          <div ref={logRef} className="bg-[#0d0d16] p-2 max-h-48 overflow-y-auto font-mono text-[11px] text-accent/80 space-y-0.5">
            {logs.length === 0 ? <span className="text-muted/40 italic">No logs yet</span>
              : logs.map((l,i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Systemd section ───────────────────────────────────────────────────────────

function SystemdSection({ units }: { units: SystemdUnits }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key); setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button onClick={() => setOpen(p=>!p)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-surface transition-colors">
        <Terminal size={14} className="text-muted"/>
        <span className="text-sm font-semibold text-text-primary">Ubuntu / systemd Setup</span>
        <span className="text-xs text-muted ml-1">— run servers as background services</span>
        {open ? <ChevronUp size={13} className="ml-auto text-muted"/> : <ChevronDown size={13} className="ml-auto text-muted"/>}
      </button>
      {open && (
        <div className="px-4 pb-4 flex flex-col gap-4 border-t border-border">
          {/* Ollama */}
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mt-3 mb-1.5">Ollama</p>
            <div className="bg-[#0d0d16] rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
                <span className="text-[10px] font-mono text-muted/60">install + enable</span>
                <button onClick={() => copy(units.ollama.commands.join('\n'), 'ollama')} className="text-[10px] text-muted hover:text-accent flex items-center gap-1">
                  <Copy size={10}/>{copied==='ollama'?'Copied!':'Copy'}
                </button>
              </div>
              <pre className="px-3 py-2 text-[11px] font-mono text-accent/80 whitespace-pre-wrap">{units.ollama.commands.join('\n')}</pre>
            </div>
          </div>
          {/* llama-cpp */}
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
              node-llama-cpp ({units.llama.unitFile})
            </p>
            <div className="bg-[#0d0d16] rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
                <span className="text-[10px] font-mono text-muted/60">systemd unit file</span>
                <button onClick={() => copy(units.llama.content, 'llama-unit')} className="text-[10px] text-muted hover:text-accent flex items-center gap-1">
                  <Copy size={10}/>{copied==='llama-unit'?'Copied!':'Copy'}
                </button>
              </div>
              <pre className="px-3 py-2 text-[11px] font-mono text-green-400/80 whitespace-pre-wrap max-h-48 overflow-y-auto">{units.llama.content}</pre>
            </div>
            <div className="bg-[#0d0d16] rounded-lg overflow-hidden mt-2">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
                <span className="text-[10px] font-mono text-muted/60">install commands</span>
                <button onClick={() => copy(units.llama.commands.join('\n'), 'llama-cmds')} className="text-[10px] text-muted hover:text-accent flex items-center gap-1">
                  <Copy size={10}/>{copied==='llama-cmds'?'Copied!':'Copy'}
                </button>
              </div>
              <pre className="px-3 py-2 text-[11px] font-mono text-accent/80 whitespace-pre-wrap">{units.llama.commands.join('\n')}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ServerManager() {
  const [status, setStatus] = useState<{ llama: ServerStatus; ollama: ServerStatus } | null>(null);
  const [units,  setUnits]  = useState<SystemdUnits | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiErr,  setApiErr]  = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setApiErr('');
    const s = await apiStatus();
    setStatus(s);
    if (!s) setApiErr(
      'Manager API unreachable. Run the app with: cd server && node serve.js\n' +
      'This serves the app AND exposes /api/ control endpoints on the same port.'
    );
    setLoading(false);
  }, []);

  const loadUnits = useCallback(async () => {
    const u = await apiSystemdUnits();
    setUnits(u);
  }, []);

  useEffect(() => { void refresh(); void loadUnits(); }, [refresh, loadUnits]);

  return (
    <div className="flex flex-col gap-5">
      {/* How-to notice */}
      <div className="rounded-xl border border-border bg-panel px-4 py-3">
        <p className="text-xs text-muted leading-relaxed">
          <span className="font-semibold text-text-primary">How this works:</span>{' '}
          Run{' '}
          <code className="font-mono text-[11px] bg-border/60 px-1 py-0.5 rounded">cd server && node serve.js</code>
          {' '}to serve the app and expose the <code className="font-mono text-[11px] bg-border/60 px-1 rounded">/api/</code> control
          endpoints on the same port. Then click Start to launch the inference servers.
        </p>
      </div>

      {/* Refresh */}
      <div className="flex justify-end">
        <button onClick={refresh} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border text-muted hover:text-accent hover:border-accent/40 rounded-lg transition-colors">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/>Refresh
        </button>
      </div>

      {/* Unreachable notice */}
      {apiErr && (
        <div className="flex flex-col gap-2 px-4 py-3 rounded-xl border border-warning/30 bg-warning/5">
          <p className="text-sm text-yellow-400 flex items-start gap-2">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>
            <span className="whitespace-pre-line">{apiErr}</span>
          </p>
        </div>
      )}

      {/* Server cards */}
      {status && (
        <>
          <ServerCard name="llama" label="node-llama-cpp Inference Server" icon={Cpu}
            status={status.llama} onRefresh={refresh}/>
          <ServerCard name="ollama" label="Ollama" icon={Server}
            status={status.ollama} onRefresh={refresh}/>
        </>
      )}

      {/* Ubuntu / systemd */}
      {units && <SystemdSection units={units}/>}
    </div>
  );
}
