/** src/components/Admin/AdminAuth.tsx – Simple password gate for the admin dashboard. */
import { useState } from 'react';
import { Lock, Eye, EyeOff, Cpu } from 'lucide-react';

const DEFAULT_PASSWORD = 'icadp3admin';
const STORAGE_KEY      = 'icadp_admin_hash';

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/** Initialise the stored hash on first visit. Returns the hash. */
async function ensureDefaultHash(): Promise<string> {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;
  const h = await sha256(DEFAULT_PASSWORD);
  localStorage.setItem(STORAGE_KEY, h);
  return h;
}

export async function checkPassword(input: string): Promise<boolean> {
  const stored = await ensureDefaultHash();
  return (await sha256(input)) === stored;
}

export async function changePassword(newPassword: string): Promise<void> {
  localStorage.setItem(STORAGE_KEY, await sha256(newPassword));
}

interface AdminAuthProps { onUnlock: () => void; }

export function AdminAuth({ onUnlock }: AdminAuthProps) {
  const [pw, setPw]     = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr]   = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const ok = await checkPassword(pw);
    setBusy(false);
    if (ok) { onUnlock(); } else { setErr('Wrong password.'); setPw(''); }
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
              <h1 className="text-base font-semibold text-text-primary">ICADP 3.0 Admin</h1>
              <p className="text-xs text-muted mt-0.5">Enter password to continue</p>
            </div>
          </div>

          <form onSubmit={submit} className="px-8 py-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/50"/>
                <input type={show?'text':'password'} value={pw} onChange={e=>setPw(e.target.value)}
                  className="w-full bg-base border border-border text-text-primary text-sm rounded-lg pl-9 pr-10 py-2.5 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20"
                  placeholder="Enter password" autoFocus/>
                <button type="button" onClick={()=>setShow(p=>!p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-primary transition-colors">
                  {show?<EyeOff size={14}/>:<Eye size={14}/>}
                </button>
              </div>
              {err && <p className="text-xs text-error">{err}</p>}
            </div>

            <button type="submit" disabled={!pw.trim()||busy}
              className={['w-full py-2.5 rounded-lg font-semibold text-sm tracking-wide transition-all',
                pw.trim()&&!busy?'bg-accent text-base hover:bg-accent-dim btn-glow cursor-pointer':'bg-surface border border-border text-muted cursor-not-allowed'].join(' ')}>
              {busy?'Checking…':'Unlock Dashboard'}
            </button>

            <p className="text-center text-[11px] text-muted/60">
              Default password: <code className="font-mono bg-border/50 px-1 py-0.5 rounded">{DEFAULT_PASSWORD}</code>
            </p>
          </form>
        </div>
        <p className="text-center mt-4 text-xs text-muted/40">
          <a href="/" className="hover:text-muted transition-colors">← Back to ICADP 3.0</a>
        </p>
      </div>
    </div>
  );
}
