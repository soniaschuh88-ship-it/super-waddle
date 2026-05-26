/**
 * src/components/Admin/AgentSettings.tsx
 * Configure the ICADP coding agent (pi-agent-core settings).
 */
import { useState, useEffect, useCallback } from 'react';
import { Save, RefreshCw, Bot, Terminal, Cpu, Server } from 'lucide-react';
import { getAgentSettings, saveAgentSettings } from '@/lib/llm-client';
import type { AgentSettings } from '@/types';

const DEFAULT: AgentSettings = {
  backendType:        'llama-cpp',
  serverUrl:          'http://localhost:8001',
  modelId:            'local',
  tools:              ['read','write','edit','bash','grep','find','ls'],
  systemPromptPrefix: '',
  defaultCwd:         '',
  contextWindow:      4096,
  maxTokens:          4096,
};

const ALL_TOOLS = ['read','write','edit','bash','grep','find','ls'];

const TOOL_DESC: Record<string,string> = {
  read:  'Read file contents',
  write: 'Create / overwrite files',
  edit:  'Apply diff-based edits',
  bash:  'Execute shell commands',
  grep:  'Search file patterns',
  find:  'Find files by name',
  ls:    'List directory contents',
};

export function AgentSettings() {
  const [cfg,     setCfg]     = useState<AgentSettings>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [err,     setErr]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const s = await getAgentSettings();
    if (s) setCfg(s);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    setSaving(true); setErr(''); setSaved(false);
    try {
      const updated = await saveAgentSettings(cfg);
      setCfg(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    }
    setSaving(false);
  };

  const toggleTool = (tool: string) => {
    setCfg(p => ({
      ...p,
      tools: p.tools.includes(tool)
        ? p.tools.filter(t => t !== tool)
        : [...p.tools, tool],
    }));
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-muted text-sm py-8">
      <RefreshCw size={14} className="animate-spin"/>Loading settings…
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-border bg-panel p-4 flex items-start gap-3">
        <Bot size={18} className="text-accent flex-shrink-0 mt-0.5"/>
        <div>
          <p className="text-sm font-semibold text-text-primary">ICADP Coding Agent</p>
          <p className="text-xs text-muted mt-0.5 leading-relaxed">
            Powered by <code className="font-mono bg-border/60 px-1 rounded text-[11px]">@earendil-works/pi-agent-core</code>.
            Settings are stored at <code className="font-mono bg-border/60 px-1 rounded text-[11px]">~/.icadp/settings.json</code>.
          </p>
        </div>
      </div>

      {/* Backend */}
      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Backend</label>
        <div className="flex gap-2">
          {(['llama-cpp','ollama'] as const).map(t => (
            <button key={t} onClick={() => setCfg(p => ({ ...p, backendType: t }))}
              className={['flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors',
                cfg.backendType === t ? 'bg-accent/15 border-accent/50 text-accent' : 'bg-base border-border text-muted hover:border-accent/30'].join(' ')}>
              {t === 'llama-cpp' ? <Cpu size={14}/> : <Server size={14}/>}
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Server URL + Model */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Server URL</label>
          <input type="url" value={cfg.serverUrl}
            onChange={e => setCfg(p => ({ ...p, serverUrl: e.target.value }))}
            placeholder="http://localhost:8001"
            className="bg-base border border-border text-text-primary text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60"/>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Model ID</label>
          <input type="text" value={cfg.modelId}
            onChange={e => setCfg(p => ({ ...p, modelId: e.target.value }))}
            placeholder="local"
            className="bg-base border border-border text-text-primary text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60"/>
          <p className="text-[11px] text-muted/60">Use "local" to auto-select the first loaded GGUF model.</p>
        </div>
      </div>

      {/* Tools */}
      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Enabled Tools</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ALL_TOOLS.map(tool => {
            const enabled = cfg.tools.includes(tool);
            return (
              <button key={tool} onClick={() => toggleTool(tool)}
                className={['flex flex-col gap-0.5 p-2.5 rounded-lg border text-left transition-colors',
                  enabled ? 'bg-accent/8 border-accent/40' : 'bg-base border-border opacity-50 hover:opacity-75'].join(' ')}
                style={enabled ? { background: 'rgba(0,212,170,0.06)' } : undefined}>
                <span className={`flex items-center gap-1.5 text-xs font-semibold ${enabled ? 'text-accent' : 'text-muted'}`}>
                  <Terminal size={11}/>
                  {tool}
                </span>
                <span className="text-[10px] text-muted/60">{TOOL_DESC[tool]}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted/60">
          Disable <code className="font-mono bg-border/50 px-1 rounded">write</code> / <code className="font-mono bg-border/50 px-1 rounded">bash</code> for read-only sessions.
        </p>
      </div>

      {/* System prompt prefix */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">
          System Prompt Prefix <span className="normal-case text-muted/50">(prepended to pi's default)</span>
        </label>
        <textarea
          value={cfg.systemPromptPrefix}
          onChange={e => setCfg(p => ({ ...p, systemPromptPrefix: e.target.value }))}
          rows={4}
          placeholder="You are an expert software engineer specialising in TypeScript and Node.js..."
          className="bg-base border border-border text-text-primary text-sm font-mono rounded-lg p-3 resize-none focus:outline-none focus:border-accent/60 placeholder:text-muted/30"/>
      </div>

      {/* Working directory */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Default Working Directory</label>
        <input type="text" value={cfg.defaultCwd}
          onChange={e => setCfg(p => ({ ...p, defaultCwd: e.target.value }))}
          placeholder="/home/user/projects  (blank = server cwd)"
          className="bg-base border border-border text-text-primary text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60 placeholder:text-muted/40"/>
      </div>

      {/* Context + max tokens */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { key: 'contextWindow' as const, label: 'Context Window (tokens)', min: 512, max: 131072, step: 512 },
          { key: 'maxTokens'    as const, label: 'Max Output Tokens',       min: 256, max: 16384,  step: 256 },
        ].map(({ key, label, min, max, step }) => (
          <div key={key} className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">{label}</label>
            <div className="flex items-center gap-3">
              <input type="range" min={min} max={max} step={step} value={cfg[key]}
                onChange={e => setCfg(p => ({ ...p, [key]: parseInt(e.target.value) }))}
                className="flex-1 accent-[#00d4aa]"/>
              <span className="text-sm font-mono text-text-primary w-16 tabular-nums text-right">
                {cfg[key].toLocaleString()}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Error */}
      {err && <p className="text-sm text-error">{err}</p>}

      {/* Save */}
      <button onClick={handleSave} disabled={saving}
        className={['flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold text-sm tracking-wide w-fit transition-all',
          saved   ? 'bg-success/15 border border-success/30 text-green-400'
          : saving ? 'bg-surface border border-border text-muted cursor-not-allowed'
          : 'bg-accent text-base hover:bg-accent-dim btn-glow'].join(' ')}>
        <Save size={14}/>{saved ? 'Saved!' : saving ? 'Saving…' : 'Save Settings'}
      </button>

      <p className="text-[11px] text-muted/50 -mt-3">
        Changes take effect on the next agent session. Restart serve.js to pick up tool changes.
      </p>
    </div>
  );
}
