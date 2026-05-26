/**
 * src/components/Admin/GlobalProviders.tsx
 *
 * Admin control panel for global/fallback API provider configuration.
 * Keys set here are used when a user hasn't configured their own key —
 * the fallback chain is: user key → global key → env var → anon.
 *
 * Also sets the global default model and default provider.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Globe, Save, RefreshCw, CheckCircle, Eye, EyeOff,
  Info, ChevronDown, ChevronUp, Layers, Settings2,
} from 'lucide-react';
import { getToken } from './AdminAuth';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProviderDef {
  id:          string;
  name:        string;
  tier:        'free' | 'freemium' | 'dynamic' | 'paid';
  description: string;
  signupUrl:   string;
  anonAccess:  boolean;
  configKey:   string;
}

interface GlobalConfig {
  providerKeys:    Record<string, string>;
  defaultModel:    string;
  defaultProvider: string;
  freeOnly:        boolean;
  updatedAt:       string | null;
}

const TIER_LABELS: Record<string, string> = {
  free:     '✅ Free',
  freemium: '🔄 Freemium',
  dynamic:  '🔧 Dynamic',
  paid:     '💳 Paid',
};
const TIER_ORDER = ['free', 'freemium', 'dynamic', 'paid'];

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function authHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function fetchProviders(): Promise<ProviderDef[]> {
  // Pull from /providers/list (public endpoint) to get the full list
  const r = await fetch('/providers/list', { headers: authHeader() });
  if (!r.ok) return [];
  const d = await r.json() as { providers: Array<ProviderDef & { source: string; userHasKey: boolean }> };
  // Use the meta from providers list (augment with configKey from known mappings)
  return (d.providers ?? []).map(p => ({
    ...p,
    configKey: providerConfigKey(p.id),
  }));
}

async function fetchGlobals(): Promise<GlobalConfig> {
  const r = await fetch('/admin/globals', { headers: authHeader() });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<GlobalConfig>;
}

async function saveGlobals(body: Partial<GlobalConfig>): Promise<void> {
  const r = await fetch('/admin/globals', {
    method: 'PUT',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status}`);
}

async function saveProviderKeys(keys: Record<string, string>): Promise<void> {
  const r = await fetch('/admin/globals/providers', {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerKeys: keys }),
  });
  if (!r.ok) throw new Error(`${r.status}`);
}

// Map provider id → configKey (mirrors server/providers.js)
function providerConfigKey(id: string): string {
  const MAP: Record<string, string> = {
    kilo: 'kilo_api_key', llm7: 'llm7_api_key', openrouter: 'openrouter_api_key',
    cline: 'cline_api_key', nvidia: 'nvidia_api_key', sambanova: 'sambanova_api_key',
    'ollama-cloud': 'ollama_api_key', groq: 'groq_api_key', mistral: 'mistral_api_key',
    cerebras: 'cerebras_api_key', xai: 'xai_api_key', huggingface: 'hf_token',
    fastrouter: 'fastrouter_api_key', codestral: 'codestral_api_key',
    deepinfra: 'deepinfra_api_key', together: 'together_api_key',
    zenmux: 'zenmux_api_key', crofai: 'crofai_api_key', novita: 'novita_api_key',
  };
  return MAP[id] ?? `${id}_api_key`;
}

// ── Provider key row ──────────────────────────────────────────────────────────

function ProviderKeyRow({
  provider,
  existing,
  onChange,
}: {
  provider:  ProviderDef;
  existing:  string;
  onChange:  (key: string, value: string) => void;
}) {
  const [show, setShow] = useState(false);
  const [draft, setDraft] = useState('');

  const isSet = !!existing && existing !== '';

  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border hover:border-accent/20 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-text-primary">{provider.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-panel font-medium text-muted/70 border-border">
            {TIER_LABELS[provider.tier]}
          </span>
          {isSet && <CheckCircle size={10} className="text-success"/>}
          {provider.anonAccess && !isSet && (
            <span className="text-[10px] text-success/70">works without key</span>
          )}
        </div>
        <p className="text-[11px] text-muted/60 mt-0.5">{provider.description}</p>
        {!isSet && (
          <a href={provider.signupUrl} target="_blank" rel="noopener noreferrer"
            className="text-[11px] text-accent/70 hover:text-accent hover:underline">
            Get API key →
          </a>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0 w-52">
        {isSet ? (
          <div className="flex items-center gap-1 flex-1 bg-base border border-success/20 rounded-lg px-2 py-1">
            <span className="flex-1 font-mono text-[11px] text-success/70">
              {show ? existing : '••••••••'}
            </span>
            <button onClick={() => setShow(p => !p)} className="text-muted hover:text-accent">
              {show ? <EyeOff size={11}/> : <Eye size={11}/>}
            </button>
          </div>
        ) : (
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { if (draft.trim()) onChange(provider.configKey, draft.trim()); }}
            onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) { onChange(provider.configKey, draft.trim()); setDraft(''); }}}
            placeholder="Paste key…"
            className="flex-1 bg-base border border-border text-text-primary text-[11px] font-mono rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent/60 placeholder:text-muted/30"
          />
        )}
        {isSet && (
          <button
            onClick={() => onChange(provider.configKey, '')}
            className="text-[11px] text-muted/60 hover:text-error transition-colors px-1"
            title="Remove key"
          >✕</button>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GlobalProviders() {
  const [providers,    setProviders]   = useState<ProviderDef[]>([]);
  const [config,       setConfig]      = useState<GlobalConfig | null>(null);
  const [pendingKeys,  setPendingKeys] = useState<Record<string, string>>({});
  const [loading,      setLoading]     = useState(true);
  const [saving,       setSaving]      = useState(false);
  const [saved,        setSaved]       = useState(false);
  const [err,          setErr]         = useState('');
  const [openTiers,    setOpenTiers]   = useState<Set<string>>(new Set(['free','freemium']));

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [provList, cfg] = await Promise.all([fetchProviders(), fetchGlobals()]);
      setProviders(provList);
      setConfig(cfg);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleKeyChange = (configKey: string, value: string) => {
    setPendingKeys(p => ({ ...p, [configKey]: value }));
    // Optimistic update in config display
    setConfig(c => c ? { ...c, providerKeys: { ...c.providerKeys, [configKey]: value } } : c);
  };

  const handleSaveKeys = async () => {
    if (!Object.keys(pendingKeys).length) return;
    setSaving(true); setErr('');
    try {
      await saveProviderKeys(pendingKeys);
      setPendingKeys({});
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); }
    setSaving(false);
  };

  const handleSaveSettings = async () => {
    if (!config) return;
    setSaving(true); setErr('');
    try {
      await saveGlobals({
        defaultModel: config.defaultModel,
        defaultProvider: config.defaultProvider,
        freeOnly: config.freeOnly,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); }
    setSaving(false);
  };

  const toggleTier = (tier: string) => {
    setOpenTiers(s => {
      const n = new Set(s);
      if (n.has(tier)) n.delete(tier); else n.add(tier);
      return n;
    });
  };

  const byTier = TIER_ORDER.reduce<Record<string, ProviderDef[]>>((acc, t) => {
    acc[t] = providers.filter(p => p.tier === t);
    return acc;
  }, {});

  if (loading) return (
    <div className="flex items-center gap-2 text-muted text-sm py-8">
      <RefreshCw size={14} className="animate-spin"/>Loading provider config…
    </div>
  );

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Globe size={14} className="text-accent"/>Global Provider Configuration
          </h2>
          <p className="text-xs text-muted/70 mt-1">
            Set API keys that apply to all users as a fallback.
            Fallback chain: <strong className="text-text-primary">user key</strong> → <strong className="text-text-primary">global key</strong> → env var → anonymous
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-success flex items-center gap-1"><CheckCircle size={11}/>Saved</span>}
          <button onClick={handleSaveKeys} disabled={saving || !Object.keys(pendingKeys).length}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-base hover:bg-accent-dim btn-glow rounded-lg transition-all disabled:opacity-40">
            {saving ? <RefreshCw size={11} className="animate-spin"/> : <Save size={11}/>}
            Save Keys
          </button>
        </div>
      </div>

      {err && <p className="text-sm text-error">{err}</p>}

      {/* Global settings */}
      <div className="rounded-xl border border-border bg-panel p-4 flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
          <Settings2 size={12} className="text-accent"/>Global Settings
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted">Default Provider</label>
            <select
              value={config?.defaultProvider ?? 'groq'}
              onChange={e => setConfig(c => c ? { ...c, defaultProvider: e.target.value } : c)}
              className="bg-base border border-border text-text-primary text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent/60"
            >
              {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted">Default Model ID</label>
            <input
              value={config?.defaultModel ?? ''}
              onChange={e => setConfig(c => c ? { ...c, defaultModel: e.target.value } : c)}
              placeholder="e.g. groq/llama-3.3-70b-versatile"
              className="bg-base border border-border text-text-primary text-sm font-mono rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent/60 placeholder:text-muted/30"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={config?.freeOnly ?? true}
            onChange={e => setConfig(c => c ? { ...c, freeOnly: e.target.checked } : c)}
            className="rounded border-border accent-accent"
          />
          <span className="text-text-primary">Free-only mode</span>
          <span className="text-xs text-muted/60">(only free/freemium providers shown to users)</span>
        </label>
        <button onClick={handleSaveSettings} disabled={saving}
          className="self-start flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border hover:border-accent/30 text-muted hover:text-text-primary rounded-lg transition-colors">
          <Save size={11}/>Save Settings
        </button>
      </div>

      {/* Provider keys by tier */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1.5">
          <Layers size={13} className="text-accent"/>
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">Provider API Keys (Global Fallback)</h3>
        </div>
        <div className="rounded-xl border border-border bg-panel p-3 text-xs text-muted/70">
          <Info size={11} className="inline mr-1 text-accent/60"/>
          Keys entered here act as a global fallback. A user's own key always takes priority.
          Keys are stored encrypted in <code className="font-mono bg-border/50 px-1 rounded">~/.bkg/global-providers.json</code>.
        </div>

        {TIER_ORDER.map(tier => {
          const list = byTier[tier] ?? [];
          if (!list.length) return null;
          const isOpen = openTiers.has(tier);
          return (
            <div key={tier} className="rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => toggleTier(tier)}
                className="w-full flex items-center justify-between px-4 py-3 bg-panel hover:bg-surface transition-colors"
              >
                <span className="text-sm font-semibold text-text-primary">
                  {TIER_LABELS[tier]}
                  <span className="text-muted font-normal ml-2 text-xs">({list.length} providers)</span>
                </span>
                {isOpen ? <ChevronUp size={14} className="text-muted"/> : <ChevronDown size={14} className="text-muted"/>}
              </button>
              {isOpen && (
                <div className="flex flex-col gap-1.5 px-3 py-2 border-t border-border">
                  {list.map(p => (
                    <ProviderKeyRow
                      key={p.id}
                      provider={p}
                      existing={config?.providerKeys[p.configKey ?? providerConfigKey(p.id)] ?? ''}
                      onChange={handleKeyChange}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
