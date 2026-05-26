/**
 * src/components/Admin/AdminAuth.tsx
 *
 * Admin password gate backed by the server-side /auth/login endpoint.
 * Password is verified against the bcrypt hash in .env (BKG_ADMIN_PASSWORD_HASH).
 * Falls back to default "bkg_admin_2024" if no hash is configured.
 * Token stored in sessionStorage — expires after 7 days (server-enforced).
 */
import { useState } from 'react';
import { Lock, Eye, EyeOff, Cpu, AlertCircle } from 'lucide-react';

const TOKEN_KEY = 'bkg_admin_token';
const DEFAULT_PW = 'bkg_admin_2024';

// ── Auth helpers ──────────────────────────────────────────────────────────────

export async function login(password: string): Promise<string> {
  const r = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? 'Login failed');
  }
  const { token } = await r.json() as { token: string };
  sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}

export function logout(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export async function verifyStoredToken(): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  try {
    const r = await fetch('/auth/verify', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch { return false; }
}

// Legacy compat (some existing components call checkPassword / changePassword)
export async function checkPassword(input: string): Promise<boolean> {
  try { await login(input); return true; } catch { return false; }
}
export async function changePassword(_newPw: string): Promise<void> {
  // No-op: password is set via BKG_ADMIN_PASSWORD_HASH in .env
}

// ── Login UI ──────────────────────────────────────────────────────────────────

interface AdminAuthProps { onUnlock: () => void; }

export function AdminAuth({ onUnlock }: AdminAuthProps) {
  const [pw,       setPw]       = useState('');
  const [show,     setShow]     = useState(false);
  const [err,      setErr]      = useState('');
  const [busy,     setBusy]     = useState(false);
  const [noServer, setNoServer] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(''); setNoServer(false);
    try {
      await login(pw);
      onUnlock();
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : 'Login failed';
      if (msg.includes('fetch') || msg.includes('network')) {
        setNoServer(true);
        setErr('Cannot reach bKG server. Is it running?');
      } else {
        setErr(msg);
        setPw('');
      }
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-border bg-surface shadow-2xl overflow-hidden">
          <div className="flex flex-col items-center gap-3 px-8 pt-8 pb-6 border-b border-border bg-panel">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent/15 border border-accent/30">
              <Cpu size={24} className="text-accent"/>
            </div>
            <div className="text-center">
              <h1 className="text-base font-semibold text-text-primary">bKG Admin</h1>
              <p className="text-xs text-muted mt-0.5">Enter password to continue</p>
            </div>
          </div>

          <form onSubmit={submit} className="px-8 py-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/50"/>
                <input
                  type={show ? 'text' : 'password'}
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                  className="w-full bg-base border border-border text-text-primary text-sm rounded-lg pl-9 pr-10 py-2.5 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20"
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
                  <AlertCircle size={11}/>
                  {err}
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
              {busy ? 'Verifying…' : 'Unlock Dashboard'}
            </button>

            {noServer ? (
              <p className="text-center text-[11px] text-warning">
                Start the server: <code className="font-mono bg-border/50 px-1 rounded">./bkg.sh start</code>
              </p>
            ) : (
              <p className="text-center text-[11px] text-muted/60">
                Default: <code className="font-mono bg-border/50 px-1 py-0.5 rounded">{DEFAULT_PW}</code>
                {' '}· set <code className="font-mono bg-border/50 px-1 rounded">BKG_ADMIN_PASSWORD_HASH</code> in .env
              </p>
            )}
          </form>
        </div>
        <p className="text-center mt-4 text-xs text-muted/40">
          <a href="/" className="hover:text-muted transition-colors">← Back to bKG</a>
        </p>
      </div>
    </div>
  );
}
