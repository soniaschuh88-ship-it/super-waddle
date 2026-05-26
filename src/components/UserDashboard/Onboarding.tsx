/**
 * src/components/UserDashboard/Onboarding.tsx
 *
 * User onboarding wizard — shown on first visit.
 *
 * Step 1: Welcome + generates a bKG API key via /api-keys/self-register
 * Step 2: Provider setup — enter optional free provider keys
 * Step 3: Done — links to New Plan and Agent Hub
 *
 * The raw key is stored in localStorage under 'bkg_user_api_key'.
 * Provider keys are saved to the server via /user/providers.
 */
import { useState, useCallback } from 'react';
import {
  Cpu, Key, Copy, CheckCircle, ChevronRight,
  Zap, Bot, ExternalLink, Eye, EyeOff, Loader2,
  Shield, Globe, X,
} from 'lucide-react';
import { useAppState } from '@/context/AppContext';

// ── Free providers to feature in onboarding ───────────────────────────────────
// Only the no-credit-card providers are shown in onboarding; others in full settings

interface FeaturedProvider {
  id:         string;
  name:       string;
  configKey:  string;
  tier:       string;
  badge:      string;
  hint:       string;
  signupUrl:  string;
  required:   boolean;
}

const FEATURED_PROVIDERS: FeaturedProvider[] = [
  {
    id: 'groq', name: 'Groq', configKey: 'groq_api_key',
    tier: 'dynamic', badge: '🔧 Free tier',
    hint: 'Ultra-fast inference. Free account — no credit card.',
    signupUrl: 'https://console.groq.com',
    required: false,
  },
  {
    id: 'nvidia', name: 'NVIDIA NIM', configKey: 'nvidia_api_key',
    tier: 'freemium', badge: '🔄 1,000 free req/mo',
    hint: 'Llama 4, DeepSeek R1, Qwen 3 — 1000 free requests/month.',
    signupUrl: 'https://build.nvidia.com',
    required: false,
  },
  {
    id: 'openrouter', name: 'OpenRouter', configKey: 'openrouter_api_key',
    tier: 'free', badge: '✅ Free models',
    hint: '200+ models, many free. Requires free account.',
    signupUrl: 'https://openrouter.ai/keys',
    required: false,
  },
  {
    id: 'mistral', name: 'Mistral', configKey: 'mistral_api_key',
    tier: 'dynamic', badge: '🔧 Free dev tier',
    hint: 'Mistral 7B, Codestral. Free dev tier, no card.',
    signupUrl: 'https://console.mistral.ai',
    required: false,
  },
  {
    id: 'sambanova', name: 'SambaNova', configKey: 'sambanova_api_key',
    tier: 'freemium', badge: '🔄 Free, no card',
    hint: 'Llama 3.3 70B, DeepSeek. 20–480 req/min free.',
    signupUrl: 'https://cloud.sambanova.ai',
    required: false,
  },
];

// ── helpers ───────────────────────────────────────────────────────────────────

async function selfRegister(name: string): Promise<{ key: string; id: string }> {
  const r = await fetch('/api-keys/self-register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<{ key: string; id: string }>;
}

async function saveUserProviderKeys(apiKey: string, keys: Record<string, string>): Promise<void> {
  if (!Object.keys(keys).length) return;
  await fetch('/user/providers', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(keys),
  });
}

async function markUserOnboarded(apiKey: string): Promise<void> {
  await fetch('/user/onboarded', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

// ── Step 1: Welcome + key generation ─────────────────────────────────────────

function Step1({
  onNext,
}: {
  onNext: (key: string, id: string) => void;
}) {
  const [name,    setName]    = useState('');
  const [apiKey,  setApiKey]  = useState<string | null>(null);
  const [keyId,   setKeyId]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied,  setCopied]  = useState(false);
  const [err,     setErr]     = useState('');
  const [showKey, setShowKey] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const { key, id } = await selfRegister(name || 'user');
      localStorage.setItem('bkg_user_api_key', key);
      localStorage.setItem('bkg_user_key_id', id);
      setApiKey(key);
      setKeyId(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not generate key — is the bKG server running?');
    }
    setLoading(false);
  }, [name]);

  const copy = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="w-16 h-16 rounded-2xl bg-accent/15 border border-accent/30 flex items-center justify-center">
          <Cpu size={32} className="text-accent"/>
        </div>
        <div>
          <h2 className="text-xl font-bold text-text-primary">Welcome to bKG</h2>
          <p className="text-sm text-muted mt-1">
            best Known Garbage — your local AI coding workspace
          </p>
        </div>
      </div>

      <div className="bg-panel border border-border rounded-xl p-4 text-sm text-muted/80 leading-relaxed">
        Your <strong className="text-text-primary">bKG API key</strong> lets you use the plan generator
        and coding agent. It's stored in your browser and ties your settings to this server.
      </div>

      {/* Name input */}
      {!apiKey && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted uppercase tracking-wider">Your name (optional)</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Sonia"
            className="bg-base border border-border text-text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent/60 placeholder:text-muted/30"
          />
        </div>
      )}

      {err && <p className="text-xs text-error">{err}</p>}

      {/* Key display */}
      {apiKey ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-success">
            <CheckCircle size={15}/>Your bKG API key is ready
          </div>
          <div className="flex items-center gap-2 bg-base border border-success/30 rounded-xl px-3 py-2.5">
            <code className={`flex-1 font-mono text-xs text-text-primary truncate ${showKey ? '' : 'blur-sm select-none'}`}>
              {apiKey}
            </code>
            <button onClick={() => setShowKey(p => !p)} className="text-muted/40 hover:text-muted">
              {showKey ? <EyeOff size={13}/> : <Eye size={13}/>}
            </button>
            <button onClick={copy} className="flex items-center gap-1 text-xs text-muted border border-border hover:border-accent/30 hover:text-accent px-2 py-0.5 rounded transition-colors">
              {copied ? <><CheckCircle size={11}/>Copied</> : <><Copy size={11}/>Copy</>}
            </button>
          </div>
          <p className="text-[11px] text-warning/80 flex items-center gap-1">
            <Shield size={10}/>Stored in your browser automatically. Copy it for use in external tools.
          </p>
          <button
            onClick={() => onNext(apiKey, keyId!)}
            className="flex items-center justify-center gap-2 w-full py-3 bg-accent text-base hover:bg-accent-dim btn-glow rounded-xl font-semibold transition-all cursor-pointer"
          >
            Continue <ChevronRight size={16}/>
          </button>
        </div>
      ) : (
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center justify-center gap-2 w-full py-3 bg-accent text-base hover:bg-accent-dim btn-glow rounded-xl font-semibold transition-all cursor-pointer disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin"/> : <Key size={16}/>}
          Generate My API Key
        </button>
      )}
    </div>
  );
}

// ── Step 2: Provider key setup ─────────────────────────────────────────────────

function Step2({
  apiKey,
  onNext,
  onSkip,
}: {
  apiKey:  string;
  onNext:  (keys: Record<string, string>) => void;
  onSkip:  () => void;
}) {
  const [keys,    setKeys]    = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [saving,  setSaving]  = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const filtered = Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim()));
    await saveUserProviderKeys(apiKey, filtered);
    setSaving(false);
    onNext(filtered);
  };

  const toggleVis = (id: string) =>
    setVisible(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="flex flex-col gap-5">
      <div className="text-center">
        <h2 className="text-lg font-bold text-text-primary">Set Up Free Providers</h2>
        <p className="text-sm text-muted mt-1">
          Add API keys for free/freemium AI providers. All optional — skip to use built-in free models.
        </p>
      </div>

      <div className="bg-panel border border-border rounded-xl p-3 text-xs text-muted/70 flex items-start gap-1.5">
        <Globe size={11} className="flex-shrink-0 mt-0.5 text-accent/60"/>
        If you skip, the admin may have shared global keys you can use automatically.
      </div>

      <div className="flex flex-col gap-2.5">
        {FEATURED_PROVIDERS.map(p => (
          <div key={p.id} className="flex flex-col gap-1.5 p-3 rounded-xl border border-border bg-panel">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-text-primary">{p.name}</span>
                  <span className="text-[10px] text-muted/60 border border-border rounded-full px-1.5 py-0.5">{p.badge}</span>
                </div>
                <p className="text-[11px] text-muted/60">{p.hint}</p>
              </div>
              <a href={p.signupUrl} target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-accent/70 hover:text-accent flex items-center gap-0.5 flex-shrink-0">
                Get key <ExternalLink size={10}/>
              </a>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type={visible.has(p.id) ? 'text' : 'password'}
                value={keys[p.configKey] ?? ''}
                onChange={e => setKeys(k => ({ ...k, [p.configKey]: e.target.value }))}
                placeholder={`Optional — paste ${p.name} key`}
                className="flex-1 bg-base border border-border text-text-primary text-[11px] font-mono rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent/60 placeholder:text-muted/30"
              />
              {keys[p.configKey] && (
                <button onClick={() => toggleVis(p.id)} className="text-muted/40 hover:text-muted">
                  {visible.has(p.id) ? <EyeOff size={12}/> : <Eye size={12}/>}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button onClick={onSkip}
          className="flex-1 py-2.5 border border-border text-muted hover:text-text-primary hover:border-accent/30 rounded-xl text-sm transition-colors">
          Skip for now
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-accent text-base hover:bg-accent-dim btn-glow rounded-xl font-semibold text-sm transition-all cursor-pointer disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle size={14}/>}
          Save & Continue
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Done ───────────────────────────────────────────────────────────────

function Step3({ configuredCount, onNewPlan, onAgentHub }:
  { configuredCount: number; onNewPlan: () => void; onAgentHub: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-success/15 border border-success/30 flex items-center justify-center">
        <CheckCircle size={32} className="text-success"/>
      </div>
      <div>
        <h2 className="text-xl font-bold text-text-primary">You're ready!</h2>
        <p className="text-sm text-muted mt-1">
          {configuredCount > 0
            ? `${configuredCount} provider${configuredCount !== 1 ? 's' : ''} configured. You can add more in Settings anytime.`
            : 'Using free/shared providers. Add your own keys in Settings anytime.'}
        </p>
      </div>
      <div className="w-full flex flex-col gap-2.5">
        <button onClick={onNewPlan}
          className="flex items-center justify-center gap-2 w-full py-3.5 bg-accent text-base hover:bg-accent-dim btn-glow rounded-xl font-bold text-base transition-all cursor-pointer">
          <Zap size={18}/>Create My First Plan
        </button>
        <button onClick={onAgentHub}
          className="flex items-center justify-center gap-2 w-full py-3 border border-border text-muted hover:text-text-primary hover:border-accent/30 rounded-xl text-sm transition-colors">
          <Bot size={15}/>Open Agent Hub
        </button>
      </div>
      <p className="text-xs text-muted/50">
        You can add more provider keys in <strong className="text-text-primary">Dashboard → My Keys</strong> at any time.
      </p>
    </div>
  );
}

// ── Main Onboarding modal ─────────────────────────────────────────────────────

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const { dispatch }            = useAppState();
  const [step,            setStep]           = useState<1 | 2 | 3>(1);
  const [generatedKey,    setGeneratedKey]   = useState('');
  const [configuredCount, setConfiguredCount] = useState(0);

  const handleStep1Done = (key: string, _id: string) => {
    setGeneratedKey(key);
    setStep(2);
  };

  const handleStep2Done = async (keys: Record<string, string>) => {
    setConfiguredCount(Object.keys(keys).length);
    if (generatedKey) await markUserOnboarded(generatedKey).catch(() => {});
    setStep(3);
  };

  const handleSkip = async () => {
    if (generatedKey) await markUserOnboarded(generatedKey).catch(() => {});
    setStep(3);
  };

  const handleNewPlan = () => {
    dispatch({ type: 'CLEAR_PROJECT' });
    dispatch({ type: 'SET_STAGE', stage: 'stufe1' });
    onComplete();
  };

  const handleAgentHub = () => {
    dispatch({ type: 'SET_STAGE', stage: 'agenthub' });
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/90 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden">
        {/* Progress dots */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-panel">
          <div className="flex items-center gap-2">
            {[1,2,3].map(s => (
              <div key={s} className={[
                'w-2 h-2 rounded-full transition-all',
                step === s ? 'bg-accent w-5' : step > s ? 'bg-success' : 'bg-border',
              ].join(' ')}/>
            ))}
          </div>
          <span className="text-xs text-muted">Step {step} of 3</span>
          <button
            onClick={() => { markUserOnboarded(generatedKey).catch(()=>{}); onComplete(); }}
            className="text-muted/40 hover:text-muted transition-colors"
            title="Skip setup"
          >
            <X size={14}/>
          </button>
        </div>

        {/* Step content */}
        <div className="px-8 py-6">
          {step === 1 && <Step1 onNext={handleStep1Done}/>}
          {step === 2 && (
            <Step2
              apiKey={generatedKey}
              onNext={keys => void handleStep2Done(keys)}
              onSkip={() => void handleSkip()}
            />
          )}
          {step === 3 && (
            <Step3
              configuredCount={configuredCount}
              onNewPlan={handleNewPlan}
              onAgentHub={handleAgentHub}
            />
          )}
        </div>
      </div>
    </div>
  );
}
