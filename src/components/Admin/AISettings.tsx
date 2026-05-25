/** src/components/Admin/AISettings.tsx – Default model and token limit settings. */
import { useState } from 'react';
import { Save, Settings } from 'lucide-react';
import { MODEL_OPTIONS } from '@/lib/webllm';
import { OLLAMA_POPULAR_MODELS } from '@/lib/llm-client';
import type { BackendType, BackendConfig } from '@/types';

const SETTINGS_KEY = 'icadp_default_settings';

interface SavedSettings {
  backendType: BackendType;
  modelId: string;
  serverUrl: string;
  maxTokens: number;
}

function load(): SavedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as SavedSettings;
  } catch { /**/ }
  return { backendType:'webgpu', modelId:'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', serverUrl:'http://localhost:11434', maxTokens:4096 };
}

function save(s: SavedSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/** Called by main app on startup to read admin-configured defaults. */
export function getDefaultBackendConfig(): BackendConfig {
  const s = load();
  return { type:s.backendType, serverUrl:s.serverUrl, modelId:s.modelId };
}

export function AISettings() {
  const [cfg, setCfg]   = useState<SavedSettings>(load);
  const [saved, setSaved] = useState(false);

  const handleSave = () => { save(cfg); setSaved(true); setTimeout(()=>setSaved(false),2000); };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2"><Settings size={16} className="text-accent"/><h3 className="text-sm font-semibold text-text-primary">Default AI Settings</h3></div>
      <p className="text-sm text-muted -mt-3">These settings are applied when the app loads. Users can override them in the wizard.</p>

      <div className="flex flex-col gap-4">
        {/* Default backend */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Default Backend</label>
          <div className="flex gap-2 flex-wrap">
            {(['webgpu','ollama','mlc-server','llama-node'] as BackendType[]).map(t=>(
              <button key={t} onClick={()=>setCfg(p=>({...p,backendType:t}))}
                className={['px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                  cfg.backendType===t?'bg-accent/15 border-accent/50 text-accent':'bg-base border-border text-muted hover:border-accent/30 hover:text-text-primary'].join(' ')}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Default model */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">
            {cfg.backendType==='webgpu'?'Default Web-LLM Model':cfg.backendType==='ollama'?'Default Ollama Model':'Default Model ID'}
          </label>
          {cfg.backendType==='webgpu' ? (
            <select value={cfg.modelId} onChange={e=>setCfg(p=>({...p,modelId:e.target.value}))}
              className="bg-base border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60">
              {MODEL_OPTIONS.map(m=><option key={m.id} value={m.id}>{m.label} (~{m.sizeMb} MB)</option>)}
            </select>
          ) : cfg.backendType==='ollama' ? (
            <select value={cfg.modelId} onChange={e=>setCfg(p=>({...p,modelId:e.target.value}))}
              className="bg-base border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60">
              {OLLAMA_POPULAR_MODELS.map(m=><option key={m.name} value={m.name}>{m.name} — {m.description}</option>)}
            </select>
          ) : (
            <input type="text" value={cfg.modelId} onChange={e=>setCfg(p=>({...p,modelId:e.target.value}))}
              className="bg-base border border-border text-text-primary text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60"/>
          )}
        </div>

        {/* Server URL (for REST backends) */}
        {cfg.backendType!=='webgpu'&&(
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Server URL</label>
            <input type="url" value={cfg.serverUrl} onChange={e=>setCfg(p=>({...p,serverUrl:e.target.value}))}
              className="bg-base border border-border text-text-primary text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60"/>
          </div>
        )}

        {/* Max tokens */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Max Tokens per Document</label>
          <div className="flex items-center gap-3">
            <input type="range" min={512} max={8192} step={256} value={cfg.maxTokens} onChange={e=>setCfg(p=>({...p,maxTokens:parseInt(e.target.value)}))}
              className="flex-1 accent-[#00d4aa]"/>
            <span className="text-sm font-mono text-text-primary w-12 tabular-nums">{cfg.maxTokens}</span>
          </div>
          <p className="text-[11px] text-muted/60">Higher = more detailed plans but slower generation. Recommended: 3000–5000.</p>
        </div>

        <button onClick={handleSave}
          className={['flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm tracking-wide transition-all w-fit',
            saved?'bg-success/15 border border-success/30 text-green-400':'bg-accent text-base hover:bg-accent-dim btn-glow'].join(' ')}>
          <Save size={14}/>{saved?'Saved!':'Save Settings'}
        </button>
      </div>
    </div>
  );
}
