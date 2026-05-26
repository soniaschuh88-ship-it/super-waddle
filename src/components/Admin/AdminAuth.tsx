/**
 * src/components/Admin/AdminAuth.tsx
 *
 * Admin password gate backed by /auth/login (bcrypt).
 * On first run, auto-generates a random password shown in terminal + /admin/install-key.
 * Token stored in sessionStorage — expires after 7 days (server-enforced).
 */
import { useState, useEffect } from 'react';
import { Lock, Eye, EyeOff, Cpu, AlertCircle, Key, Copy, CheckCircle } from 'lucide-react';

const TOKEN_KEY = 'bkg_admin_token';

// ── Auth helpers ──────────────────────────────────────────────────────────────

export async function login(password: string): Promise<string> {
  const r = await fetch('/auth/login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ password }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? 'Login failed');
  }
  const { token } = await r.json() as { token: string };
  sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}

export function logout(): void { sessionStorage.removeItem(TOKEN_KEY); }
export function getToken(): string { return sessionStorage.getItem(TOKEN_KEY) ?? ''; }

export async function verifyStoredToken(): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  try {
    const r = await fetch('/auth/verify', {
      headers: { Authorization: `Bearer ${token}` },
      signal:  AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch { return false; }
}

// Legacy compat
export async function checkPassword(input: string): Promise<boolean> {
  try { await login(input); return true; } catch { return false; }
}
export async function changePassword(_newPw: string): Promise<void> {
  // Managed via BKG_ADMIN_PASSWORD_HASH or auto-generated on first run
}

// ── Install key (first-run, one-time) ─────────────────────────────────────────

async function fetchInstallKey(): Promise<string | null> {
  try {
    const r = await fetch('/admin/install-key', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const d = await r.json() as { key: string | null };
    return d.key;
  } catch { return null; }
}

// ── Login UI ──────────────────────────────────────────────────────────────────

interface AdminAuthProps { onUnlock: () => void; }

export function AdminAuth({ onUnlock }: AdminAuthProps) {
  const [pw,         setPw]         = useState('');
  const [show,       setShow]       = useState(false);
  const [err,        setErr]        = useState('');
  const [busy,       setBusy]       = useState(false);
  const [noServer,   setNoServer]   = useState(false);
  const [installKey, setInstallKey] = useState<string | null>(null);
  const [keyCopied,  setKeyCopied]  = useState(false);
  const [keyFetched, setKeyFetched] = useState(false);

  // Check for first-run install key on mount (one-time, server deletes after serving)
  useEffect(() => {
    if (keyFetched) return;
    setKeyFetched(true);
    fetchInstallKey().then(k => {
      if (k) { setInstallKey(k); setPw(k); }   // pre-fill password field
    });
  }, [keyFetched]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(''); setNoServer(false);
    try {
      await login(pw);
      onUnlock();
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : 'Login failed';
      if (msg.includes('fetch') || msg.includes('network') || msg.includes('connect')) {
        setNoServer(true);
        setErr('Cannot reach bKG server. Is it running?');
      } else {
        setErr(msg);
        setPw('');
      }
    }
    setBusy(false);
  };

  const copyKey = () => {
    if (!installKey) return;
    navigator.clipboard.writeText(installKey).catch(() => {});
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm flex flex-col gap-4">

        {/* First-run install key banner */}
        {installKey && (
          <div className="rounded-xl border border-amber/30 bg-amber/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Key size={13} className="text-amber flex-shrink-0"/>
              <p className="text-sm font-bold text-amber">First Run — Admin Key</p>
            </div>
            <p className="text-[11px] text-muted/80 mb-3 leading-relaxed">
              bKG auto-generated this password. It was also shown in your terminal and saved to
              <code className="mx-1 font-mono text-muted/60">~/.bkg/install.key</code>.
              Save it now — this banner won't appear after you sign in.
            </p>
            <div className="flex items-center gap-2 bg-base/80 border border-amber/25 rounded-lg px-3 py-2">
              <code className="flex-1 font-mono text-xs text-amber tracking-wider">{installKey}</code>
              <button onClick={copyKey}
                className="text-muted/40 hover:text-amber transition-colors flex-shrink-0 p-0.5">
                {keyCopied ? <CheckCircle size={12}/> : <Copy size={12}/>}
              </button>
            </div>
          </div>
        )}

        {/* Login card */}
        <div className="rounded-xl border border-border bg-surface shadow-2xl overflow-hidden">
          <div className="flex flex-col items-center gap-3 px-6 pt-6 pb-5 border-b border-border bg-panel">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent/15 border border-accent/30">
              <Cpu size={24} className="text-accent"/>
            </div>
            <div className="text-center">
              <h1 className="text-base font-semibold text-text-primary">bKG Admin</h1>
              <p className="text-xs text-muted mt-0.5">
                {installKey ? 'Password pre-filled — click Sign In' : 'Enter admin password'}
              </p>
            </div>
          </div>

          <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/50"/>
                <input
                  type={show ? 'text' : 'password'}
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                  className="w-full bg-base border border-border text-text-primary text-sm rounded-lg pl-9 pr-10 py-2.5 focus:outline-none focus:border-accent/60"
                  placeholder="Enter admin password"
                  autoFocus
                />
                <button type="button" onClick={() => setShow(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-primary transition-colors">
                  {show ? <EyeOff size={14}/> : <Eye size={14}/>}
                </button>
              </div>
              {err && (
                <p className="text-xs text-error flex items-center gap-1">
                  <AlertCircle size={11}/>{err}
                </p>
              )}
            </div>

            <button type="submit" disabled={!pw.trim() || busy}
              className={[
                'w-full py-2.5 rounded-lg font-semibold text-sm tracking-wide transition-all',
                pw.trim() && !busy
                  ? 'bg-accent text-base hover:bg-accent-dim btn-glow cursor-pointer'
                  : 'bg-surface border border-border text-muted cursor-not-allowed',
              ].join(' ')}>
              {busy ? 'Verifying…' : installKey ? 'Sign In →' : 'Unlock Dashboard'}
            </button>

            {noServer ? (
              <p className="text-center text-[11px] text-warning">
                Start the server: <code className="font-mono bg-border/50 px-1 rounded">./bkg.sh start</code>
                {' '}or run <code className="font-mono bg-border/50 px-1 rounded">node server/serve.js</code>
              </p>
            ) : !installKey && (
              <p className="text-center text-[11px] text-muted/50">
                Password in <code className="font-mono bg-border/50 px-1 rounded">~/.bkg/admin.env</code>
                {' '}· set <code className="font-mono bg-border/50 px-1 rounded">BKG_ADMIN_PASSWORD_HASH</code> to override
              </p>
            )}
          </form>
        </div>

        <p className="text-center text-xs text-muted/40">
          <a href="/" className="hover:text-muted transition-colors">← Back to bKG</a>
        </p>
      </div>
    </div>
  );
}
