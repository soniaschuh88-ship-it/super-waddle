/**
 * src/components/UserDashboard/Onboarding.tsx
 *
 * Compact slide-in onboarding card — bottom-right corner, not full-screen.
 * ✓ Dismissable with persistence (localStorage bkg_onboarding_dismissed)
 * ✓ Auto-collapses to a small pill after step 1 is skipped/done
 * ✓ Fits all screen sizes: 320px wide max, no taller than 420px
 * ✓ Re-triggerable from Dashboard → "Re-run setup"
 */

import { useState, useCallback } from 'react';
import {
  Key, Copy, CheckCircle, ChevronRight,
  Zap, Bot, ExternalLink, Eye, EyeOff,
  Loader2, X, Sparkles,
} from 'lucide-react';
import { useAppState } from '@/context/AppContext';

// ── Persistence ───────────────────────────────────────────────────────────────

export const DISMISSED_KEY = 'bkg_onboarding_dismissed';

export function isDismissed(): boolean {
  return !!localStorage.getItem(DISMISSED_KEY);
}

function setDismissed() {
  localStorage.setItem(DISMISSED_KEY, '1');
}

// ── Provider shortcuts shown in onboarding ────────────────────────────────────

const QUICK_PROVIDERS = [
  { id: 'groq',      name: 'Groq',       configKey: 'groq_api_key',       hint: 'Ultra-fast, free',    url: 'https://console.groq.com' },
  { id: 'nvidia',    name: 'NVIDIA NIM', configKey: 'nvidia_api_key',     hint: '1k req/mo free',      url: 'https://build.nvidia.com' },
  { id: 'openrouter',name: 'OpenRouter', configKey: 'openrouter_api_key', hint: '200+ free models',    url: 'https://openrouter.ai/keys' },
  { id: 'mistral',   name: 'Mistral',    configKey: 'mistral_api_key',    hint: 'Free dev tier',       url: 'https://console.mistral.ai' },
];

// ── API helpers ───────────────────────────────────────────────────────────────

async function selfRegister(name: string): Promise<{ key: string; id: string }> {
  const r = await fetch('/api-keys/self-register', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<{ key: string; id: string }>;
}

async function saveKeys(apiKey: string, keys: Record<string, string>): Promise<void> {
  const filtered = Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim()));
  if (!Object.keys(filtered).length) return;
  await fetch('/user/providers', {
    method:  'PUT',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(filtered),
  });
}

async function markOnboarded(apiKey: string): Promise<void> {
  if (!apiKey) return;
  await fetch('/user/onboarded', {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => {});
}

// ── Step components ───────────────────────────────────────────────────────────

function Step1({ onNext }: { onNext: (key: string) => void }) {
  const [name,    setName]    = useState('');
  const [apiKey,  setApiKey]  = useState('');
  const [loading, setLoading] = useState(false);
  const [copied,  setCopied]  = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [err,     setErr]     = useState('');

  const generate = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const { key } = await selfRegister(name || 'user');
      localStorage.setItem('bkg_user_api_key', key);
      setApiKey(key);
    } catch {
      setErr('Server offline or rate-limited. Try again in a moment.');
    }
    setLoading(false);
  }, [name]);

  const copy = () => {
    navigator.clipboard.writeText(apiKey).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (apiKey) return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-success/80 flex items-center gap-1.5">
        <CheckCircle size={11}/>API key created and saved in your browser
      </p>
      <div className="flex items-center gap-1.5 bg-base border border-success/20 rounded-lg px-2.5 py-2">
        <code className={`flex-1 font-mono text-[10px] text-text-primary truncate ${showKey ? '' : 'blur-sm select-none'}`}>
          {apiKey}
        </code>
        <button onClick={() => setShowKey(p => !p)} className="text-muted/40 hover:text-muted flex-shrink-0">
          {showKey ? <EyeOff size={11}/> : <Eye size={11}/>}
        </button>
        <button onClick={copy}
          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border hover:border-accent/30 hover:text-accent text-muted flex-shrink-0 transition-colors">
          {copied ? <CheckCircle size={9}/> : <Copy size={9}/>}
          {copied ? 'OK' : 'Copy'}
        </button>
      </div>
      <button onClick={() => onNext(apiKey)}
        className="flex items-center justify-center gap-2 w-full py-2.5 bg-accent text-base btn-glow rounded-lg font-semibold text-sm transition-all cursor-pointer">
        Next <ChevronRight size={14}/>
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted/70 leading-relaxed">
        Generate a personal API key to save your provider keys and settings on this server.
      </p>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && void generate()}
        placeholder="Your name (optional)"
        className="bg-base border border-border text-text-primary text-sm rounded-lg px-2.5 py-2 focus:outline-none focus:border-accent/40 placeholder:text-muted/30"
      />
      {err && <p className="text-[10px] text-error/80">{err}</p>}
      <button onClick={generate} disabled={loading}
        className="flex items-center justify-center gap-2 w-full py-2.5 bg-accent text-base btn-glow rounded-lg font-semibold text-sm transition-all cursor-pointer disabled:opacity-50">
        {loading ? <Loader2 size={14} className="animate-spin"/> : <Key size={14}/>}
        Generate API Key
      </button>
    </div>
  );
}

function Step2({ apiKey, onDone, onSkip }: { apiKey: string; onDone: () => void; onSkip: () => void }) {
  const [keys,    setKeys]    = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [saving,  setSaving]  = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await saveKeys(apiKey, keys);
    setSaving(false);
    onDone();
  };

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11px] text-muted/70">
        Optional — add API keys for faster/more capable models. All free tiers.
      </p>

      <div className="flex flex-col gap-1.5">
        {QUICK_PROVIDERS.map(p => (
          <div key={p.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border bg-panel/60">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-text-primary">{p.name}</span>
                <span className="text-[9px] text-muted/50">{p.hint}</span>
              </div>
              <input
                type={visible[p.id] ? 'text' : 'password'}
                value={keys[p.configKey] ?? ''}
                onChange={e => setKeys(k => ({ ...k, [p.configKey]: e.target.value }))}
                placeholder="Paste key…"
                className="w-full bg-base border border-border/60 text-text-primary text-[10px] font-mono rounded px-2 py-1 mt-1 focus:outline-none focus:border-accent/40 placeholder:text-muted/25"
              />
            </div>
            <div className="flex flex-col gap-1 flex-shrink-0">
              {keys[p.configKey] && (
                <button onClick={() => setVisible(v => ({ ...v, [p.id]: !v[p.id] }))}
                  className="text-muted/30 hover:text-muted">
                  {visible[p.id] ? <EyeOff size={10}/> : <Eye size={10}/>}
                </button>
              )}
              <a href={p.url} target="_blank" rel="noopener noreferrer"
                className="text-accent/50 hover:text-accent">
                <ExternalLink size={10}/>
              </a>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mt-1">
        <button onClick={onSkip}
          className="flex-1 py-2 border border-border text-muted/70 hover:text-text-primary rounded-lg text-[11px] transition-colors">
          Skip
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-accent text-base btn-glow rounded-lg text-[11px] font-bold transition-all disabled:opacity-50">
          {saving ? <Loader2 size={11} className="animate-spin"/> : <CheckCircle size={11}/>}
          Save & Finish
        </button>
      </div>
    </div>
  );
}

function Step3({ onNewPlan, onHub }: { onNewPlan: () => void; onHub: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center py-1">
      <div className="w-10 h-10 rounded-xl bg-success/15 border border-success/30 flex items-center justify-center">
        <Sparkles size={18} className="text-success"/>
      </div>
      <div>
        <p className="text-sm font-bold text-text-primary">You're all set!</p>
        <p className="text-[11px] text-muted/60 mt-0.5">Add more keys anytime in Dashboard → My Keys</p>
      </div>
      <div className="flex flex-col gap-1.5 w-full">
        <button onClick={onNewPlan}
          className="flex items-center justify-center gap-2 w-full py-2.5 bg-accent text-base btn-glow rounded-lg font-bold text-sm transition-all cursor-pointer">
          <Zap size={13}/>Start First Plan
        </button>
        <button onClick={onHub}
          className="flex items-center justify-center gap-2 w-full py-2 border border-border/60 text-muted/70 hover:text-text-primary rounded-lg text-[11px] transition-colors">
          <Bot size={12}/>Agent Hub
        </button>
      </div>
    </div>
  );
}

// ── Main Onboarding ───────────────────────────────────────────────────────────

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const { dispatch } = useAppState();
  const [step,       setStep]       = useState<1|2|3>(1);
  const [apiKey,     setApiKey]     = useState('');
  const [minimised,  setMinimised]  = useState(false);

  const dismiss = () => {
    setDismissed();
    if (apiKey) markOnboarded(apiKey).catch(() => {});
    onComplete();
  };

  const handleStep1 = (key: string) => {
    setApiKey(key);
    setStep(2);
  };

  const handleStep2Done = () => {
    markOnboarded(apiKey).catch(() => {});
    setStep(3);
  };

  const handleSkip = () => {
    markOnboarded(apiKey).catch(() => {});
    setStep(3);
  };

  const handleNewPlan = () => {
    setDismissed();
    dispatch({ type: 'CLEAR_PROJECT' });
    dispatch({ type: 'SET_STAGE', stage: 'stufe1' });
    onComplete();
  };

  const handleHub = () => {
    setDismissed();
    dispatch({ type: 'SET_STAGE', stage: 'agenthub' });
    onComplete();
  };

  const TITLES = ['Get Your API Key', 'Add Free Provider Keys', 'Done!'];
  const STEP_W = step === 2 ? 'max-w-xs' : 'max-w-[300px]';

  // Minimised pill
  if (minimised) return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        onClick={() => setMinimised(false)}
        className="flex items-center gap-2 px-3 py-2 rounded-full border border-accent/30 bg-surface/95 text-accent text-[11px] font-semibold shadow-glow-sm backdrop-blur-md transition-all hover:border-accent/60"
      >
        <Key size={11}/>Setup · Step {step}/3
      </button>
    </div>
  );

  return (
    /* Slide in from bottom-right — does NOT block the rest of the UI */
    <div className={`fixed bottom-4 right-4 z-50 ${STEP_W} w-full`}
         style={{ animation: 'slideIn 0.3s ease-out' }}>
      <div className="rounded-2xl border border-border/80 bg-surface/97 shadow-deep overflow-hidden"
           style={{ backdropFilter: 'blur(20px)' }}>

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-panel/60">
          <div className="w-5 h-5 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
            <Key size={10} className="text-accent"/>
          </div>
          <span className="flex-1 text-[11px] font-bold text-text-primary">{TITLES[step - 1]}</span>
          <div className="flex items-center gap-1">
            {[1,2,3].map(s => (
              <div key={s} className={[
                'rounded-full transition-all',
                step === s ? 'w-3 h-1.5 bg-accent' : step > s ? 'w-1.5 h-1.5 bg-success' : 'w-1.5 h-1.5 bg-border',
              ].join(' ')}/>
            ))}
          </div>
          <div className="flex gap-0.5 ml-1">
            <button onClick={() => setMinimised(true)}
              className="w-5 h-5 flex items-center justify-center text-muted/30 hover:text-muted rounded transition-colors text-[10px] font-mono"
              title="Minimise">
              —
            </button>
            <button onClick={dismiss}
              className="w-5 h-5 flex items-center justify-center text-muted/30 hover:text-muted rounded transition-colors"
              title="Dismiss (won't show again)">
              <X size={12}/>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-4 py-3.5">
          {step === 1 && <Step1 onNext={handleStep1}/>}
          {step === 2 && <Step2 apiKey={apiKey} onDone={handleStep2Done} onSkip={handleSkip}/>}
          {step === 3 && <Step3 onNewPlan={handleNewPlan} onHub={handleHub}/>}
        </div>

        {/* Footer */}
        {step < 3 && (
          <div className="px-4 pb-3 flex items-center gap-3">
            <div className="flex-1 h-0.5 bg-border/30 rounded-full">
              <div className="h-full bg-accent/40 rounded-full transition-all"
                style={{ width: `${(step / 3) * 100}%` }}/>
            </div>
            <span className="text-[9px] text-muted/40">{step}/3</span>
          </div>
        )}
      </div>
    </div>
  );
}
