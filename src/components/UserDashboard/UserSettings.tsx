/**
 * src/components/UserDashboard/UserSettings.tsx
 *
 * User-facing provider key manager.
 * Users enter their own API keys for free/paid providers.
 * Fallback chain: user key → admin global key → free/anon access.
 *
 * Groups providers by tier (Free / Freemium / Dynamic / Paid).
 * Shows source badge (yours / shared / free) for each configured provider.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Key, Save, RefreshCw, CheckCircle, Eye, EyeOff,
  ExternalLink, ChevronDown, ChevronUp, Info, X,
  Shield, Globe,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProviderStatus {
  id:          string;
  name:        string;
  tier:        'free' | 'freemium' | 'dynamic' | 'paid';
  description: string;
  signupUrl:   string;
  anonAccess:  boolean;
  source:      'user' | 'global' | 'env' | 'anon' | 'none';
  hasKey:      boolean;
  userHasKey:  boolean;
}

const TIER_LABELS: Record<string, { label: string; color: string; badge: string }> = {
  free:     { label: 'Free',     color: 'text-success', badge: '✅ Free — no key needed' },
  freemium: { label: 'Freemium', color: 'text-blue-400', badge: '🔄 Free tier available' },
  dynamic:  { label: 'API Key',  color: 'text-accent',   badge: '🔧 Requires API key' },
  paid:     { label: 'Paid',     color: 'text-yellow-400', badge: '💳 Credits required' },
};

const TIER_ORDER = ['free', 'freemium', 'dynamic', 'paid'];

const SOURCE_BADGES: Record<string, { label: string; cls: string }> = {
  user:   { label: 'Your key',    cls: 'text-success border-success/30 bg-success/5' },
  global: { label: 'Shared key',  cls: 'text-blue-400 border-blue-400/30 bg-blue-400/5' },
  env:    { label: 'Env config',  cls: 'text-muted border-border bg-base/60' },
  anon:   { label: 'Free access', cls: 'text-success/70 border-success/20 bg-base/60' },
  none:   { label: 'Not set',     cls: 'text-muted/50 border-border/50 bg-base/40' },
};

// Map provider id → configKey
function configKey(id: string): string {
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

// ── API helpers ───────────────────────────────────────────────────────────────

function getApiKey(): string | null {
  return localStorage.getItem('bkg_user_api_key');
}

function makeHeaders(): Record<string, string> {
  const k = getApiKey();
  const h: Record<string, string> = {};
  if (k) h['Authorization'] = `Bearer ${k}`;
  return h;
}

async function fetchProviderStatus(): Promise<ProviderStatus[]> {
  const r = await fetch('/user/providers', { headers: makeHeaders() });
  if (!r.ok) {
    // Unauthenticated — fall back to public provider list
    const r2 = await fetch('/providers/list');
    if (!r2.ok) return [];
    const d = await r2.json() as { providers: ProviderStatus[] };
    return d.providers ?? [];
  }
  return r.json() as Promise<ProviderStatus[]>;
}

async function saveProviderKeys(keys: Record<string, string>): Promise<boolean> {
  const r = await fetch('/user/providers', {
    method: 'PUT',
    headers: { ...makeHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(keys),
  });
  return r.ok;
}

// ── Single provider row ───────────────────────────────────────────────────────

function ProviderRow({
  provider,
  pendingValue,
  onChange,
  onClear,
}: {
  provider:     ProviderStatus;
  pendingValue: string | null;
  onChange:     (key: string, value: string) => void;
  onClear:      (key: string) => void;
}) {
  const [show,    setShow]    = useState(false);
  const [focused, setFocused] = useState(false);

  const ck   = configKey(provider.id);
  const src  = SOURCE_BADGES[provider.source] ?? SOURCE_BADGES.none;
  const isUserSet = provider.userHasKey || (pendingValue != null && pendingValue !== '');
  const hasAnyAccess = provider.hasKey || provider.anonAccess;
  const inputDraft = pendingValue ?? '';

  return (
    <div className={[
      'flex flex-col gap-2 px-3 py-3 rounded-xl border transition-colors',
      isUserSet
        ? 'border-success/20 bg-success/3'
        : hasAnyAccess
        ? 'border-border/60 bg-panel'
        : 'border-border/40 bg-panel opacity-80',
    ].join(' ')}
    style={isUserSet ? { background: 'rgba(0,212,100,0.03)' } : undefined}
    >
      {/* Row header */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Status dot */}
        <div className={[
          'w-2 h-2 rounded-full flex-shrink-0',
          isUserSet ? 'bg-success' : hasAnyAccess ? 'bg-accent/60' : 'bg-border',
        ].join(' ')}/>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-text-primary">{provider.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 border rounded-full font-medium ${src.cls}`}>
              {src.label}
            </span>
            {provider.anonAccess && !isUserSet && (
              <span className="text-[10px] text-success/60">works without key</span>
            )}
          </div>
          <p className="text-[11px] text-muted/60 truncate">{provider.description}</p>
        </div>

        {/* Signup link */}
        <a
          href={provider.signupUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 text-muted/40 hover:text-accent transition-colors"
          title={`Get ${provider.name} API key`}
        >
          <ExternalLink size={12}/>
        </a>
      </div>

      {/* Key input */}
      {focused || isUserSet ? (
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <input
              type={show ? 'text' : 'password'}
              value={isUserSet && !focused ? '••••••••' : inputDraft}
              onChange={e => onChange(ck, e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={`Enter ${provider.name} API key…`}
              className="w-full bg-base border border-border text-text-primary text-[11px] font-mono rounded-lg px-2.5 py-1.5 pr-8 focus:outline-none focus:border-accent/60 placeholder:text-muted/30"
            />
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => setShow(p => !p)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted/40 hover:text-muted"
            >
              {show ? <EyeOff size={11}/> : <Eye size={11}/>}
            </button>
          </div>
          {isUserSet && (
            <button
              onClick={() => { onClear(ck); setFocused(false); }}
              className="text-muted/40 hover:text-error transition-colors flex-shrink-0"
              title="Remove your key (falls back to global)"
            >
              <X size={13}/>
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={() => setFocused(true)}
          className="self-start text-[11px] text-accent/70 hover:text-accent transition-colors"
        >
          + Add your key
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface UserSettingsProps {
  onClose?: () => void;
}

export function UserSettings({ onClose }: UserSettingsProps) {
  const [providers,   setProviders]  = useState<ProviderStatus[]>([]);
  const [pending,     setPending]    = useState<Record<string, string>>({});
  const [loading,     setLoading]    = useState(true);
  const [saving,      setSaving]     = useState(false);
  const [saved,       setSaved]      = useState(false);
  const [err,         setErr]        = useState('');
  const [openTiers,   setOpenTiers]  = useState<Set<string>>(new Set(TIER_ORDER));

  const load = useCallback(async () => {
    setLoading(true);
    try { setProviders(await fetchProviderStatus()); }
    catch { setProviders([]); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleChange = (key: string, value: string) => {
    setPending(p => ({ ...p, [key]: value }));
    // Update the display source optimistically
    setProviders(prev => prev.map(pr => {
      if (configKey(pr.id) !== key) return pr;
      return { ...pr, userHasKey: !!value, source: value ? 'user' : pr.source };
    }));
  };

  const handleClear = (key: string) => {
    setPending(p => ({ ...p, [key]: '' }));
    setProviders(prev => prev.map(pr => {
      if (configKey(pr.id) !== key) return pr;
      return { ...pr, userHasKey: false, source: pr.anonAccess ? 'anon' : 'none' };
    }));
  };

  const handleSave = async () => {
    if (!Object.keys(pending).length) return;
    setSaving(true); setErr('');
    const ok = await saveProviderKeys(pending).catch(() => false);
    if (ok) {
      setPending({});
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      await load();
    } else {
      setErr('Could not save — check that the bKG server is running');
    }
    setSaving(false);
  };

  const toggleTier = (t: string) =>
    setOpenTiers(s => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const byTier: Record<string, ProviderStatus[]> = {};
  for (const t of TIER_ORDER) byTier[t] = providers.filter(p => p.tier === t);

  const configuredCount = providers.filter(p => p.userHasKey).length;
  const hasAccess       = providers.filter(p => p.hasKey || p.anonAccess).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-6 py-4 border-b border-border bg-panel">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/15 border border-accent/30">
          <Key size={16} className="text-accent"/>
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-text-primary">My Provider Keys</h2>
          <p className="text-xs text-muted/70">
            {loading
              ? 'Loading…'
              : `${configuredCount} personal · ${hasAccess} accessible (yours + shared)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-success flex items-center gap-1">
              <CheckCircle size={11}/>Saved
            </span>
          )}
          {Object.keys(pending).length > 0 && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-accent text-base hover:bg-accent-dim btn-glow rounded-lg transition-all disabled:opacity-50 cursor-pointer"
            >
              {saving ? <RefreshCw size={11} className="animate-spin"/> : <Save size={11}/>}
              Save Keys
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className="text-muted hover:text-text-primary transition-colors">
              <X size={16}/>
            </button>
          )}
        </div>
      </div>

      {/* Info strip */}
      <div className="flex-shrink-0 px-6 py-2.5 bg-base border-b border-border text-[11px] text-muted/70 flex items-start gap-1.5">
        <Shield size={11} className="flex-shrink-0 mt-0.5 text-accent/60"/>
        <span>
          Your keys are stored privately on this server and never shared. When you have no key for a provider,
          the system uses a <Globe size={10} className="inline"/> shared admin key (if set) or free/anonymous access.
        </span>
      </div>

      {err && (
        <div className="flex-shrink-0 px-6 py-2 bg-error/10 border-b border-error/30 text-xs text-red-400">
          {err}
        </div>
      )}

      {/* Provider list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
        {loading ? (
          <div className="flex items-center gap-2 text-muted text-sm py-8">
            <RefreshCw size={14} className="animate-spin"/>Loading providers…
          </div>
        ) : (
          TIER_ORDER.map(tier => {
            const list = byTier[tier] ?? [];
            if (!list.length) return null;
            const tDef = TIER_LABELS[tier];
            const isOpen = openTiers.has(tier);
            const setCount = list.filter(p => p.userHasKey).length;
            const accCount = list.filter(p => p.hasKey || p.anonAccess).length;

            return (
              <div key={tier} className="rounded-xl border border-border overflow-hidden">
                <button
                  onClick={() => toggleTier(tier)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-panel hover:bg-surface transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-semibold text-text-primary">
                      {tDef.badge}
                    </span>
                    <span className="text-[11px] text-muted/60">
                      {setCount > 0
                        ? `${setCount}/${list.length} configured`
                        : accCount > 0
                        ? `${accCount} accessible`
                        : `${list.length} providers`}
                    </span>
                  </div>
                  {isOpen
                    ? <ChevronUp size={14} className="text-muted"/>
                    : <ChevronDown size={14} className="text-muted"/>}
                </button>

                {isOpen && (
                  <div className="flex flex-col gap-2 px-3 py-3 border-t border-border">
                    {list.map(p => (
                      <ProviderRow
                        key={p.id}
                        provider={p}
                        pendingValue={pending[configKey(p.id)] ?? null}
                        onChange={handleChange}
                        onClear={handleClear}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Bottom info */}
        {!loading && (
          <div className="rounded-xl border border-border bg-panel p-4 text-xs text-muted/70 mt-2">
            <p className="font-semibold text-text-primary mb-1 flex items-center gap-1.5">
              <Info size={12} className="text-accent/60"/>Fallback chain
            </p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li><strong className="text-text-primary">Your key</strong> — highest priority, private to you</li>
              <li><strong className="text-text-primary">Shared key</strong> — set by admin, used when you have none</li>
              <li><strong className="text-text-primary">Env variable</strong> — server-configured key</li>
              <li><strong className="text-text-primary">Anonymous</strong> — free tier (Kilo, LLM7 only)</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
