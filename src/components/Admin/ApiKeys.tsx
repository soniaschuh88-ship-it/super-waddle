/**
 * src/components/Admin/ApiKeys.tsx
 *
 * Admin tab for creating and managing API keys.
 * Keys are scoped to: inference | agent | admin | readonly
 *
 * The raw key is shown ONCE after creation — admin must copy and store it.
 * Subsequent views only show the key prefix (first 12 chars) for identification.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Key, Plus, Trash2, RefreshCw, Copy, CheckCircle,
  Eye, EyeOff, AlertTriangle, Info, ShieldCheck,
} from 'lucide-react';
import { getToken } from './AdminAuth';

// ── Types ─────────────────────────────────────────────────────────────────────

interface StoredKey {
  id:         string;
  name:       string;
  scope:      'inference' | 'agent' | 'admin' | 'readonly';
  keyPrefix:  string;
  createdAt:  string;
  lastUsedAt: string | null;
  enabled:    boolean;
}

interface NewKey extends StoredKey {
  key: string;     // raw key — shown once
  warning: string;
}

const SCOPE_COLORS = {
  inference: 'bg-accent/10 text-accent border-accent/30',
  agent:     'bg-blue-400/10 text-blue-400 border-blue-400/30',
  admin:     'bg-error/10 text-red-400 border-error/30',
  readonly:  'bg-border/60 text-muted border-border',
};

const SCOPE_LABELS = {
  inference: 'Inference — /v1/* model endpoints',
  agent:     'Agent — /agent/* coding agent',
  admin:     'Admin — full access',
  readonly:  'Read-only — status + sessions',
};

// ── API helpers ───────────────────────────────────────────────────────────────

function authHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function fetchKeys(): Promise<StoredKey[]> {
  const r = await fetch('/api-keys', { headers: authHeader() });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<StoredKey[]>;
}

async function createKey(name: string, scope: string): Promise<NewKey> {
  const r = await fetch('/api-keys', {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, scope }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(d.error ?? `${r.status}`);
  }
  return r.json() as Promise<NewKey>;
}

async function deleteKey(id: string): Promise<void> {
  const r = await fetch(`/api-keys/${id}`, { method: 'DELETE', headers: authHeader() });
  if (!r.ok) throw new Error(`${r.status}`);
}

async function toggleKey(id: string, enabled: boolean): Promise<void> {
  await fetch(`/api-keys/${id}/enabled`, {
    method: 'PUT',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

// ── New key banner ────────────────────────────────────────────────────────────

function NewKeyBanner({ nk, onDismiss }: { nk: NewKey; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(nk.key).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="rounded-xl border border-success/40 bg-success/5 p-4 flex flex-col gap-3 animate-fade-in">
      <div className="flex items-start gap-2">
        <CheckCircle size={16} className="text-success flex-shrink-0 mt-0.5"/>
        <div>
          <p className="text-sm font-semibold text-text-primary">API key created: <span className="font-mono text-accent">{nk.name}</span></p>
          <p className="text-xs text-warning mt-0.5 flex items-center gap-1">
            <AlertTriangle size={11}/>{nk.warning}
          </p>
        </div>
        <button onClick={onDismiss} className="ml-auto text-muted hover:text-text-primary text-xs">✕ Dismiss</button>
      </div>

      <div className="flex items-center gap-2 bg-base border border-border rounded-lg px-3 py-2">
        <code className={`flex-1 font-mono text-xs text-text-primary tracking-wide ${visible ? '' : 'blur-sm select-none'}`}>
          {nk.key}
        </code>
        <button onClick={() => setVisible(p => !p)} className="text-muted hover:text-accent transition-colors flex-shrink-0">
          {visible ? <EyeOff size={14}/> : <Eye size={14}/>}
        </button>
        <button onClick={copy} className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-border hover:border-accent/40 hover:text-accent transition-colors">
          {copied ? <><CheckCircle size={11}/>Copied!</> : <><Copy size={11}/>Copy</>}
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ApiKeys() {
  const [keys,      setKeys]     = useState<StoredKey[]>([]);
  const [loading,   setLoading]  = useState(true);
  const [err,       setErr]      = useState('');
  const [newKey,    setNewKey]   = useState<NewKey | null>(null);
  const [creating,  setCreating] = useState(false);
  const [name,      setName]     = useState('');
  const [scope,     setScope]    = useState<string>('inference');
  const [deleting,  setDeleting] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setKeys(await fetchKeys()); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load keys'); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true); setErr('');
    try {
      const nk = await createKey(name.trim(), scope);
      setNewKey(nk);
      setName('');
      await load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Create failed');
    }
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Revoke this API key? Any services using it will stop working.')) return;
    setDeleting(d => { const n = new Set(d); n.add(id); return n; });
    try { await deleteKey(id); await load(); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : 'Delete failed'); }
    setDeleting(d => { const n = new Set(d); n.delete(id); return n; });
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await toggleKey(id, enabled);
    await load();
  };

  return (
    <div className="flex flex-col gap-6">

      {/* Info */}
      <div className="rounded-xl border border-border bg-panel p-4 text-xs text-muted/80 leading-relaxed">
        <p className="font-semibold text-text-primary mb-1 flex items-center gap-1.5">
          <ShieldCheck size={13} className="text-accent"/>API Key Authentication
        </p>
        <p>
          Create bearer tokens to authenticate requests to model inference (<code className="font-mono bg-border/50 px-1 rounded">/v1/*</code>)
          and coding agent (<code className="font-mono bg-border/50 px-1 rounded">/agent/*</code>) endpoints.
          Use <code className="font-mono bg-border/50 px-1 rounded">Authorization: Bearer &lt;key&gt;</code> in your requests.
        </p>
      </div>

      {/* New key banner */}
      {newKey && <NewKeyBanner nk={newKey} onDismiss={() => setNewKey(null)}/>}

      {/* Error */}
      {err && <p className="text-sm text-error">{err}</p>}

      {/* Create form */}
      <form onSubmit={handleCreate} className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Plus size={14} className="text-accent"/>Create API Key
        </h3>
        <div className="flex gap-2 flex-wrap">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Key name (e.g. my-app, ci-pipeline)"
            maxLength={80}
            className="flex-1 min-w-48 bg-base border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60 placeholder:text-muted/30"
          />
          <select
            value={scope}
            onChange={e => setScope(e.target.value)}
            className="bg-base border border-border text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60"
          >
            {Object.entries(SCOPE_LABELS).map(([s, l]) => (
              <option key={s} value={s}>{l}</option>
            ))}
          </select>
          <button type="submit" disabled={!name.trim() || creating}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-accent text-base hover:bg-accent-dim rounded-lg transition-colors disabled:bg-surface disabled:text-muted disabled:cursor-not-allowed">
            {creating ? <RefreshCw size={13} className="animate-spin"/> : <Key size={13}/>}
            Generate
          </button>
        </div>
      </form>

      {/* Key list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary">
            Active Keys ({keys.filter(k => k.enabled).length} / {keys.length})
          </h3>
          <button onClick={load} disabled={loading} className="text-[11px] text-muted hover:text-accent transition-colors flex items-center gap-1">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''}/>Refresh
          </button>
        </div>

        {!loading && keys.length === 0 && (
          <p className="text-sm text-muted/50 italic">No API keys yet. Create one above.</p>
        )}

        <div className="flex flex-col gap-2">
          {keys.map(k => (
            <div key={k.id}
              className={[
                'flex items-center gap-3 px-4 py-3 rounded-xl border transition-all',
                k.enabled ? 'border-border bg-panel' : 'border-border/50 bg-panel opacity-50',
              ].join(' ')}
            >
              <Key size={14} className={k.enabled ? 'text-accent/60' : 'text-muted/40'}/>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-text-primary">{k.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${SCOPE_COLORS[k.scope]}`}>
                    {k.scope}
                  </span>
                  {!k.enabled && <span className="text-[10px] text-error/60">disabled</span>}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted/60">
                  <span className="font-mono">{k.keyPrefix}…</span>
                  <span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
                  {k.lastUsedAt && <span>Last used {new Date(k.lastUsedAt).toLocaleDateString()}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Enable/disable toggle */}
                <button
                  onClick={() => void handleToggle(k.id, !k.enabled)}
                  className={[
                    'text-[11px] px-2 py-0.5 rounded-full border font-medium transition-colors',
                    k.enabled
                      ? 'bg-success/10 border-success/30 text-green-400 hover:bg-success/20'
                      : 'bg-border/50 border-border text-muted hover:border-accent/30',
                  ].join(' ')}
                >
                  {k.enabled ? 'Enabled' : 'Disabled'}
                </button>

                {/* Revoke */}
                <button
                  onClick={() => void handleDelete(k.id)}
                  disabled={deleting.has(k.id)}
                  className="text-muted hover:text-error transition-colors"
                >
                  {deleting.has(k.id)
                    ? <RefreshCw size={14} className="animate-spin"/>
                    : <Trash2 size={14}/>}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Usage hint */}
      <div className="rounded-xl border border-border bg-panel p-4 text-xs text-muted/70">
        <p className="font-semibold text-text-primary mb-1 flex items-center gap-1.5">
          <Info size={12} className="text-accent"/>Usage
        </p>
        <pre className="font-mono text-[11px] text-accent/80 whitespace-pre-wrap">{`# Model inference
curl http://localhost:4001/v1/chat/completions \\
  -H "Authorization: Bearer bkg_your_key_here" \\
  -d '{"model":"local","messages":[...]}'

# Coding agent
curl http://localhost:4001/agent/sessions \\
  -H "Authorization: Bearer bkg_your_key_here"`}
        </pre>
      </div>
    </div>
  );
}
