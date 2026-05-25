/**
 * src/components/Admin/ServerManager.tsx
 *
 * Start / stop the two model servers from the admin dashboard.
 * Connects to server/manager.js (default: http://localhost:4001).
 *
 * Also shows Ubuntu/systemd setup instructions for running servers as
 * background services on Linux.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play, Square, RefreshCw, Terminal, AlertCircle,
  CheckCircle, XCircle, Cpu, Server, Copy, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  managerGetStatus, managerStartLlama, managerStopLlama,
  managerStartOllama, managerStopOllama, managerGetLogs,
  managerGetSystemdUnits,
  type ManagerServerStatus, type SystemdUnits,
} from '@/lib/llm-client';

const DEFAULT_MANAGER = localStorage.getItem('icadp_manager_url') ?? 'http://localhost:4001';

// ── Server card ───────────────────────────────────────────────────────────────

interface ServerCardProps {
  name:       'llama' | 'ollama';
  label:      string;
  icon:       React.FC<{size?:number;className?:string}>;
  status:     ManagerServerStatus | null;
  managerUrl: string;
  onRefresh:  () => void;
}

function ServerCard({ name, label, icon: Icon, status, managerUrl, onRefresh }: ServerCardProps) {
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState('');
  const [logs, setLogs]         = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [modelPath, setModelPath] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const loadLogs = useCallback(async () => {
    const lines = await managerGetLogs(managerUrl, name);
    setLogs(lines);
    setTimeout(() => logRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }), 50);
  }, [managerUrl, name]);

  useEffect(() => {
    if (showLogs) void loadLogs();
  }, [showLogs, loadLogs]);

  const handleStart = async () => {
    setBusy(true); setErr('');
    try {
      const result = name === 'llama'
        ? await managerStartLlama(managerUrl, modelPath ? { modelPath } : {})
        : await managerStartOllama(managerUrl);
      if (result.error) setErr(result.error);
      else { setTimeout(onRefresh, 1500); }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    setBusy(false);
  };

  const handleStop = async () => {
    setBusy(true); setErr('');
    try {
      const result = name === 'llama'
        ? await managerStopLlama(managerUrl)
        : await managerStopOllama(managerUrl);
      if (result.error) setErr(result.error);
      else { setTimeout(onRefresh, 500); }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    setBusy(false);
  };

  const running   = status?.running   ?? false;
  const reachable = status?.reachable  ?? false;
  const pid       = status?.pid;
  const port      = status?.port;

  return (
    <div className={[
      'rounded-xl border transition-all',
      running && reachable ? 'border-success/40 bg-success/3' : 'border-border bg-panel',
    ].join(' ')}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={['w-8 h-8 rounded-lg flex items-center justify-center border',
          running ? 'bg-success/10 border-success/30' : 'bg-surface border-border'].join(' ')}>
          <Icon size={16} className={running ? 'text-success' : 'text-muted'}/>
        </div>

        <div className="flex-1">
          <p className="text-sm font-semibold text-text-primary">{label}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {running && reachable && <span className="flex items-center gap-1 text-[11px] text-green-400"><CheckCircle size={10}/>Running · PID {pid} · :{port}</span>}
            {running && !reachable && <span className="flex items-center gap-1 text-[11px] text-yellow-400"><AlertCircle size={10}/>Starting… PID {pid}</span>}
            {!running && reachable && <span className="flex items-center gap-1 text-[11px] text-yellow-400"><AlertCircle size={10}/>Port :{port} in use (external process)</span>}
            {!running && !reachable && <span className="flex items-center gap-1 text-[11px] text-muted"><XCircle size={10}/>Stopped</span>}
          </div>
        </div>

        {/* Controls */}
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
          <button onClick={() => { setShowLogs(p => !p); if (!showLogs) void loadLogs(); }}
            className="px-2 py-1.5 text-xs text-muted hover:text-text-primary border border-border rounded-lg transition-colors">
            {showLogs ? <ChevronUp size={12}/> : <Terminal size={12}/>}
          </button>
        </div>
      </div>

      {/* Model path input (llama only, not running) */}
      {name === 'llama' && !running && (
        <div className="px-4 pb-3">
          <input type="text" value={modelPath} onChange={e => setModelPath(e.target.value)}
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
            <button onClick={loadLogs} className="text-[10px] text-muted hover:text-accent transition-colors"><RefreshCw size={10}/></button>
          </div>
          <div ref={logRef} className="bg-[#0d0d16] p-2 max-h-40 overflow-y-auto font-mono text-[11px] text-accent/80 space-y-0.5">
            {logs.length === 0 ? <span className="text-muted/40 italic">No logs yet</span> : logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Systemd instructions ──────────────────────────────────────────────────────

function SystemdSection({ units }: { units: SystemdUnits }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState('');

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button onClick={() => setOpen(p => !p)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-surface transition-colors">
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
                  <Copy size={10}/>{copied === 'ollama' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="px-3 py-2 text-[11px] font-mono text-accent/80 whitespace-pre-wrap">{units.ollama.commands.join('\n')}</pre>
            </div>
          </div>

          {/* llama-cpp */}
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">node-llama-cpp ({units.llama.unitFile})</p>
            <div className="bg-[#0d0d16] rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
                <span className="text-[10px] font-mono text-muted/60">systemd unit file</span>
                <button onClick={() => copy(units.llama.content, 'llama-unit')} className="text-[10px] text-muted hover:text-accent flex items-center gap-1">
                  <Copy size={10}/>{copied === 'llama-unit' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="px-3 py-2 text-[11px] font-mono text-green-400/80 whitespace-pre-wrap max-h-48 overflow-y-auto">{units.llama.content}</pre>
            </div>
            <div className="bg-[#0d0d16] rounded-lg overflow-hidden mt-2">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
                <span className="text-[10px] font-mono text-muted/60">install commands</span>
                <button onClick={() => copy(units.llama.commands.join('\n'), 'llama-cmds')} className="text-[10px] text-muted hover:text-accent flex items-center gap-1">
                  <Copy size={10}/>{copied === 'llama-cmds' ? 'Copied!' : 'Copy'}
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
  const [managerUrl, setManagerUrl] = useState(DEFAULT_MANAGER);
  const [status, setStatus]         = useState<{ llama: ManagerServerStatus; ollama: ManagerServerStatus } | null>(null);
  const [units,  setUnits]          = useState<SystemdUnits | null>(null);
  const [loading, setLoading]       = useState(false);
  const [managerErr, setManagerErr] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setManagerErr('');
    const s = await managerGetStatus(managerUrl);
    setStatus(s);
    if (!s) setManagerErr(`Manager unreachable at ${managerUrl}. Run: cd server && node manager.js`);
    setLoading(false);
  }, [managerUrl]);

  const loadUnits = useCallback(async () => {
    const u = await managerGetSystemdUnits(managerUrl);
    setUnits(u);
  }, [managerUrl]);

  useEffect(() => { void refresh(); void loadUnits(); }, [refresh, loadUnits]);

  return (
    <div className="flex flex-col gap-5">
      {/* Manager URL + refresh */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-[11px] font-semibold text-muted uppercase tracking-wider block mb-1">
            Manager Server URL
          </label>
          <input type="url" value={managerUrl}
            onChange={e => { setManagerUrl(e.target.value); localStorage.setItem('icadp_manager_url', e.target.value); }}
            className="w-full bg-base border border-border text-text-primary text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60"/>
        </div>
        <button onClick={() => { void refresh(); void loadUnits(); }} disabled={loading}
          className="mt-5 flex items-center gap-1.5 px-3 py-2 text-sm border border-border text-muted hover:text-accent hover:border-accent/40 rounded-lg transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>Refresh
        </button>
      </div>

      {/* Manager unreachable notice */}
      {managerErr && (
        <div className="flex flex-col gap-2 px-4 py-3 rounded-xl border border-warning/30 bg-warning/5">
          <p className="text-sm text-yellow-400 flex items-center gap-2"><AlertCircle size={14}/>{managerErr}</p>
          <div className="bg-[#0d0d16] rounded-lg px-3 py-2 font-mono text-xs text-accent/80">
            cd server<br/>
            node manager.js
          </div>
          <p className="text-[11px] text-muted/70">
            The manager runs on <strong>port 4001</strong> and controls the two model servers.
            It must be running locally alongside the app.
          </p>
        </div>
      )}

      {/* Server cards */}
      {status && (
        <>
          <ServerCard
            name="llama" label="node-llama-cpp Inference Server"
            icon={Cpu}
            status={status.llama} managerUrl={managerUrl}
            onRefresh={refresh}
          />
          <ServerCard
            name="ollama" label="Ollama"
            icon={Server}
            status={status.ollama} managerUrl={managerUrl}
            onRefresh={refresh}
          />
        </>
      )}

      {/* Ubuntu / systemd instructions */}
      {units && <SystemdSection units={units}/>}
    </div>
  );
}
