/**
 * server/serve.js — bKG Unified Server
 *
 * Single process that:
 *   1. Serves the built React app from ../dist/  (SPA with HTML fallback)
 *   2. Exposes /api/* endpoints for model server management
 *   3. Exposes /agent/* endpoints for the coding agent (pi-agent-core)
 *   4. Exposes /plugins/* endpoints for the plugin manager
 *   5. Exposes /settings/* endpoints for agent configuration
 *
 * Usage:
 *   node server/serve.js
 *
 * Environment variables:
 *   PORT          HTTP port for this server (default: 3000)
 *   HOST          Bind address             (default: 0.0.0.0)
 *   LLAMA_PORT    llama-cpp server port    (default: 8001)
 *   OLLAMA_PORT   Ollama port              (default: 11434)
 *   DIST_DIR      Path to built app        (default: ../dist)
 */

import express          from 'express';
import cors             from 'cors';
import { createServer } from 'http';
import { spawn }        from 'child_process';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, existsSync, unlinkSync, readFileSync } from 'fs';
import { createHmac, randomBytes }   from 'crypto';

// ── Load .env from project root ────────────────────────────────────────────────
// Try to load a .env file two levels up from server/ (project root)
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE     = join(PROJECT_ROOT, '.env');

if (existsSync(ENV_FILE)) {
  const lines = readFileSync(ENV_FILE, 'utf-8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;
    const key   = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = value;
  }
  console.log(`[bKG] Loaded .env from ${ENV_FILE}`);
}

import {
  startSession, sendMessage, abortSession,
  subscribeSSE, listSessions, getSessionEvents,
  disposeSession, readSettings, writeSettings,
} from './agent.js';

import {
  install as pluginInstall,
  remove  as pluginRemove,
  list    as pluginList,
  setEnabled as pluginSetEnabled,
  searchNpm,
} from './plugins.js';

import {
  createApiKey, listApiKeys, revokeApiKey,
  setKeyEnabled, validateApiKey, SCOPES,
} from './api-keys.js';

import {
  startSandboxAgent, stopSandboxAgent,
  getSandboxAgentStatus, getSandboxAgentLogs,
  proxyToSandboxAgent,
} from './sandbox.js';

import {
  PROVIDERS, getProvider, providersByTier, resolveProviderKey, fetchProviderModels,
} from './providers.js';

import {
  getUser, ensureUser, listUsers, createUser,
  getUserProviderKeys, setUserProviderKeys, markOnboarded,
  getGlobalProviderConfig, setGlobalProviderConfig, getGlobalProviderKeys,
  getUserProviderStatus, resolveKeyForUser,
} from './users.js';

const __dir  = dirname(fileURLToPath(import.meta.url));
const DIST   = resolve(__dir, process.env.DIST_DIR ?? '../dist');

const PORT        = parseInt(process.env.BKG_PORT    ?? process.env.PORT        ?? '4001', 10);
const HOST        = process.env.BKG_HOST              ?? process.env.HOST        ?? '0.0.0.0';
const LLAMA_PORT  = parseInt(process.env.BKG_LLAMA_PORT ?? process.env.LLAMA_PORT ?? '8001',  10);
const OLLAMA_PORT = parseInt(process.env.BKG_OLLAMA_PORT ?? process.env.OLLAMA_PORT ?? '11434', 10);
const JWT_SECRET  = process.env.BKG_JWT_SECRET        ?? randomBytes(32).toString('hex');
const ADMIN_HASH  = process.env.BKG_ADMIN_PASSWORD_HASH ?? '';

// ── Model server process management ──────────────────────────────────────────

const state = {
  llama:  { proc: null, logs: [] },
  ollama: { proc: null, logs: [] },
};

function pushLog(name, line) {
  state[name].logs.push(`[${new Date().toISOString().slice(11,19)}] ${line}`);
  if (state[name].logs.length > 300) state[name].logs.shift();
}

async function isPortOpen(port) {
  return new Promise(resolve => {
    const s = createServer();
    s.listen(port, '127.0.0.1', () => { s.close(); resolve(false); });
    s.on('error', () => resolve(true));
  });
}

async function serverStatus(name) {
  const port    = name === 'llama' ? LLAMA_PORT : OLLAMA_PORT;
  const proc    = state[name].proc;
  const running = proc != null && !proc.killed;
  return { name, pid: proc?.pid ?? null, running, reachable: await isPortOpen(port), port };
}

function startLlama(env = {}) {
  if (state.llama.proc && !state.llama.proc.killed)
    return { error: 'Already running', pid: state.llama.proc.pid };
  const child = spawn(process.execPath, [join(__dir, 'index.js')], {
    cwd: __dir,
    env: { ...process.env, PORT: String(LLAMA_PORT), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => d.toString().split('\n').forEach(l => l && pushLog('llama', l)));
  child.stderr.on('data', d => d.toString().split('\n').forEach(l => l && pushLog('llama', `ERR ${l}`)));
  child.on('exit',  c => { pushLog('llama', `exited (${c})`);       state.llama.proc = null; });
  child.on('error', e => { pushLog('llama', `error: ${e.message}`); state.llama.proc = null; });
  state.llama.proc = child;
  pushLog('llama', `started PID ${child.pid}`);
  return { pid: child.pid };
}
function stopLlama()  { if (!state.llama.proc || state.llama.proc.killed) return { error:'Not running' }; state.llama.proc.kill('SIGTERM'); return { ok:true }; }
function startOllama() {
  if (state.ollama.proc && !state.ollama.proc.killed) return { error:'Already running', pid: state.ollama.proc.pid };
  const child = spawn('ollama', ['serve'], {
    env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${OLLAMA_PORT}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => d.toString().split('\n').forEach(l => l && pushLog('ollama', l)));
  child.stderr.on('data', d => d.toString().split('\n').forEach(l => l && pushLog('ollama', l)));
  child.on('exit',  c => { pushLog('ollama', `exited (${c})`);       state.ollama.proc = null; });
  child.on('error', e => { pushLog('ollama', `error: ${e.message}`); state.ollama.proc = null; });
  state.ollama.proc = child;
  pushLog('ollama', `started PID ${child.pid}`);
  return { pid: child.pid };
}
function stopOllama() { if (!state.ollama.proc || state.ollama.proc.killed) return { error:'Not running' }; state.ollama.proc.kill('SIGTERM'); return { ok:true }; }

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '8mb' }));

// ── /api/* — model server manager ────────────────────────────────────────────

// ── /auth/* — admin authentication (bcrypt + HMAC token) ─────────────────────

/**
 * Simple stateless tokens: HMAC-SHA256(secret, "admin:"+timestamp).
 * Not a full JWT but sufficient for a single-user local tool.
 */
function makeToken() {
  const ts  = Math.floor(Date.now() / 1000);
  const mac = createHmac('sha256', JWT_SECRET).update(`admin:${ts}`).digest('hex');
  return Buffer.from(JSON.stringify({ ts, mac })).toString('base64url');
}

function verifyToken(token) {
  try {
    const { ts, mac } = JSON.parse(Buffer.from(token, 'base64url').toString());
    const expected    = createHmac('sha256', JWT_SECRET).update(`admin:${ts}`).digest('hex');
    const age         = Math.floor(Date.now() / 1000) - ts;
    return mac === expected && age < 86400 * 7; // valid 7 days
  } catch { return false; }
}

/**
 * POST /auth/login  — body: { password: string }
 * Returns { token } on success, 401 on failure.
 */
app.post('/auth/login', async (req, res) => {
  const { password } = req.body ?? {};
  if (!password) return res.status(400).json({ error: 'password required' });

  // If no hash configured, fall back to the default password comparison
  const fallback = 'bkg_admin_2024';

  let ok = false;
  if (ADMIN_HASH) {
    try {
      const bcrypt = await import('bcryptjs');
      ok = await bcrypt.default.compare(password, ADMIN_HASH);
    } catch { ok = password === fallback; }
  } else {
    ok = password === fallback;
  }

  if (!ok) return res.status(401).json({ error: 'Invalid password' });
  res.json({ token: makeToken(), expiresIn: 604800 });
});

/** GET /auth/verify  — verify a token */
app.get('/auth/verify', (req, res) => {
  const auth  = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.token;
  if (verifyToken(token)) res.json({ valid: true });
  else res.status(401).json({ valid: false, error: 'Invalid or expired token' });
});

/**
 * Utility to hash a new admin password (called by the setup helper).
 * POST /auth/hash  — body: { password }  — returns { hash }
 * Only available when no ADMIN_HASH is set (first-run setup).
 */
app.post('/auth/hash', async (req, res) => {
  if (ADMIN_HASH) return res.status(403).json({ error: 'Admin password is already set' });
  const { password } = req.body ?? {};
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be ≥ 6 chars' });
  const bcrypt = await import('bcryptjs');
  const hash   = await bcrypt.default.hash(password, 12);
  res.json({ hash, hint: `Add to .env: BKG_ADMIN_PASSWORD_HASH=${hash}` });
});

// ── /api-keys/* — API key management ─────────────────────────────────────────

/** Extract a Bearer token from a request (header or ?apiKey query param). */
function extractBearerToken(req) {
  const auth = req.headers.authorization ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return (req.query.apiKey ?? '').toString().trim() || null;
}

/**
 * Middleware: require a valid API key with at least one of the given scopes.
 * Passes through if the request carries a valid admin JWT token too.
 */
export function requireApiKey(...scopes) {
  return (req, res, next) => {
    // Allow valid admin JWT session tokens as well
    const auth  = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.token;
    if (token && verifyToken(token)) return next();  // admin session

    // Check API key
    const rawKey = extractBearerToken(req);
    if (!rawKey) return res.status(401).json({ error: 'Authentication required (Bearer token or API key)' });

    const k = validateApiKey(rawKey);
    if (!k) return res.status(401).json({ error: 'Invalid or revoked API key' });

    // Check scope
    if (k.scope !== 'admin' && scopes.length > 0 && !scopes.includes(k.scope)) {
      return res.status(403).json({ error: `Scope '${k.scope}' not permitted here; required: ${scopes.join(' | ')}` });
    }

    req.apiKey = k;  // attach to request for downstream use
    next();
  };
}

/** GET /api-keys — list all keys (admin JWT required) */
app.get('/api-keys', (req, res) => {
  const auth  = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.token;
  if (!token || !verifyToken(token)) return res.status(401).json({ error: 'Admin session required' });
  res.json(listApiKeys());
});

/** POST /api-keys — create a key (admin JWT required) */
app.post('/api-keys', (req, res) => {
  const auth  = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.token;
  if (!token || !verifyToken(token)) return res.status(401).json({ error: 'Admin session required' });

  const { name, scope } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (scope && !SCOPES.includes(scope)) return res.status(400).json({ error: `scope must be one of: ${SCOPES.join(', ')}` });

  const { key, stored } = createApiKey(name, scope ?? 'inference');
  // Return the raw key ONCE — never stored in plaintext after this
  res.status(201).json({ ...stored, key, warning: 'Store this key securely. It will not be shown again.' });
});

/** DELETE /api-keys/:id — revoke a key (admin JWT required) */
app.delete('/api-keys/:id', (req, res) => {
  const auth  = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.token;
  if (!token || !verifyToken(token)) return res.status(401).json({ error: 'Admin session required' });

  const ok = revokeApiKey(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Key not found' });
  res.json({ ok: true });
});

/** PUT /api-keys/:id/enabled — enable/disable a key */
app.put('/api-keys/:id/enabled', (req, res) => {
  const auth  = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.token;
  if (!token || !verifyToken(token)) return res.status(401).json({ error: 'Admin session required' });

  const { enabled } = req.body ?? {};
  const ok = setKeyEnabled(req.params.id, !!enabled);
  if (!ok) return res.status(404).json({ error: 'Key not found' });
  res.json({ ok: true });
});

/** GET /api-keys/scopes — list valid scopes */
/**
 * POST /api-keys/self-register
 * No-auth self-registration: creates a bKG API key for a new local user.
 * Rate-limited to 3 keys per hour per IP (simple counter).
 * Key scope is 'inference' (can use models + plan generator).
 * Body: { name?: string }
 */
const _selfRegCounts = new Map();   // ip → [timestamp, count]

app.post('/api-keys/self-register', (req, res) => {
  const ip    = req.ip ?? 'unknown';
  const now   = Date.now();
  const [ts, cnt] = _selfRegCounts.get(ip) ?? [now, 0];
  const window = 60 * 60 * 1000;  // 1 hour

  // Reset counter if outside window
  const count = (now - ts) < window ? cnt : 0;
  if (count >= 3) {
    return res.status(429).json({ error: 'Too many self-registrations. Try again later.' });
  }
  _selfRegCounts.set(ip, [ts, count + 1]);

  const { name } = req.body ?? {};
  const { key, stored } = createApiKey(name || 'user', 'inference');
  res.status(201).json({
    key,
    id:     stored.id,
    scope:  stored.scope,
    warning: 'Store this key in your browser — it will not be shown again.',
  });
});

app.get('/api-keys/scopes', (_req, res) => {
  res.json({
    scopes: SCOPES.map(s => ({
      id: s,
      description: {
        inference: 'Access /v1/* model inference endpoints',
        agent:     'Access /agent/* coding agent endpoints',
        admin:     'Full access to all routes',
        readonly:  'GET-only: status, sessions, model list',
      }[s] ?? s,
    })),
  });
});

// ── /api/proxy/* — server-side proxy for local backends (avoids browser CORS) ─
//
// The browser can never reach http://localhost:11434 or http://localhost:8001
// when served through a tunnel.  These endpoints run server-side and forward
// requests to the local Ollama / llama-cpp servers on behalf of the browser.

/** GET /api/proxy/ollama/tags — list installed Ollama models */
app.get('/api/proxy/ollama/tags', async (_req, res) => {
  try {
    const r = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return res.status(r.status).json({ error: `Ollama ${r.status}` });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: 'Ollama unreachable', detail: e.message });
  }
});

/** POST /api/proxy/ollama/pull — pull a model (streams progress) */
app.post('/api/proxy/ollama/pull', async (req, res) => {
  try {
    const r = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(600000),
    });
    res.setHeader('Content-Type', r.headers.get('content-type') ?? 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    r.body.on('data', chunk => res.write(chunk));
    r.body.on('end',  ()    => res.end());
    r.body.on('error',()    => res.end());
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: e.message });
  }
});

/** DELETE /api/proxy/ollama/delete — delete an Ollama model */
app.delete('/api/proxy/ollama/delete', async (req, res) => {
  try {
    const r = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(30000),
    });
    res.status(r.ok ? 200 : r.status).json(await r.json().catch(() => ({ ok: r.ok })));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/** GET /api/proxy/llama/models — list loaded GGUF models */
app.get('/api/proxy/llama/models', async (_req, res) => {
  try {
    const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/models`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return res.status(r.status).json({ error: `llama-cpp ${r.status}` });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: 'llama-cpp unreachable', detail: e.message });
  }
});

/** GET /api/proxy/llama/health — llama-cpp health check */
app.get('/api/proxy/llama/health', async (_req, res) => {
  try {
    const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/health`, { signal: AbortSignal.timeout(3000) });
    res.status(r.ok ? 200 : r.status).json(await r.json().catch(() => ({ status: r.ok ? 'ok' : 'error' })));
  } catch (e) {
    res.status(503).json({ error: 'llama-cpp unreachable' });
  }
});

/** POST /api/proxy/llama/model — swap model (PUT forwarded) */
app.put('/api/proxy/llama/model', async (req, res) => {
  try {
    const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/model`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });
    res.status(r.ok ? 200 : r.status).json(await r.json().catch(() => ({ ok: r.ok })));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/** GET /api/proxy/ping — quick reachability check for both local servers */
app.get('/api/proxy/ping', async (_req, res) => {
  const [ollamaOk, llamaOk] = await Promise.all([
    fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`, { signal: AbortSignal.timeout(2000) })
      .then(r => r.ok).catch(() => false),
    fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/models`, { signal: AbortSignal.timeout(2000) })
      .then(r => r.ok).catch(() => false),
  ]);
  res.json({ ollama: ollamaOk, llama: llamaOk });
});

app.get('/api/status', async (_req, res) => {
  const [llama, ollama] = await Promise.all([serverStatus('llama'), serverStatus('ollama')]);
  res.json({ llama, ollama });
});
app.get('/api/logs/:server', (req, res) => {
  const name = req.params.server;
  if (name !== 'llama' && name !== 'ollama') return res.status(400).json({ error: 'Unknown' });
  res.json({ lines: state[name].logs.slice(-100) });
});
app.post('/api/llama/start', (req, res) => {
  const { modelPath, nCtx, gpuLayers } = req.body ?? {};
  const env = {};
  if (modelPath)              env['MODEL_PATH'] = modelPath;
  if (nCtx)                   env['N_CTX']      = String(nCtx);
  if (gpuLayers !== undefined)env['GPU_LAYERS'] = String(gpuLayers);
  res.json(startLlama(env));
});
app.post('/api/llama/stop',   (_req, res) => res.json(stopLlama()));
app.post('/api/ollama/start', (_req, res) => res.json(startOllama()));
app.post('/api/ollama/stop',  (_req, res) => res.json(stopOllama()));

app.get('/api/systemd-units', (_req, res) => {
  const user = process.env.USER ?? 'ubuntu';
  const node = process.execPath;
  const dir  = __dir;
  res.json({
    llama: {
      unitFile: `/etc/systemd/system/bkg-llama.service`,
      content: `[Unit]\nDescription=bKG node-llama-cpp inference server\nAfter=network.target\n\n[Service]\nType=simple\nUser=${user}\nWorkingDirectory=${dir}\nExecStart=${node} ${join(dir,'index.js')}\nRestart=on-failure\nRestartSec=5\nEnvironment=PORT=${LLAMA_PORT}\n\n[Install]\nWantedBy=multi-user.target`,
      commands: [`sudo nano /etc/systemd/system/bkg-llama.service`,`sudo systemctl daemon-reload`,`sudo systemctl enable --now bkg-llama`,`sudo systemctl status bkg-llama`],
    },
    ollama: {
      installCommand: `curl -fsSL https://ollama.com/install.sh | sh`,
      commands: [`sudo systemctl enable --now ollama`,`sudo systemctl status ollama`,`# Or manual: ollama serve`],
    },
  });
});

// ── /agent/* — coding agent ───────────────────────────────────────────────────

/**
 * POST /agent/session
 * Start a new agent session.
 * Body: { cwd?, systemPrompt?, tools?, initialMessage? }
 */
app.post('/agent/session', async (req, res) => {
  try {
    const result = await startSession(req.body ?? {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /agent/session/:id/events
 * SSE stream of all events for a session.
 * After=N query param: skip first N buffered events (for reconnect).
 */
app.get('/agent/session/:id/events', (req, res) => {
  subscribeSSE(req.params.id, req, res);
});

/**
 * GET /agent/session/:id/poll?after=N
 * Long-poll alternative to SSE — returns new events since index N.
 */
app.get('/agent/session/:id/poll', (req, res) => {
  const after  = parseInt(req.query.after ?? '0', 10);
  const events = getSessionEvents(req.params.id, after);
  if (events === null) return res.status(404).json({ error: 'Session not found' });
  res.json({ events, total: (getSessionEvents(req.params.id) ?? []).length });
});

/**
 * POST /agent/session/:id/message
 * Send a user message to the running agent.
 * Body: { text: string }
 */
app.post('/agent/session/:id/message', async (req, res) => {
  const { text } = req.body ?? {};
  if (!text) return res.status(400).json({ error: 'text is required' });
  try {
    await sendMessage(req.params.id, text);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /agent/session/:id/abort
 * Abort the current agent turn.
 */
app.post('/agent/session/:id/abort', (req, res) => {
  abortSession(req.params.id);
  res.json({ ok: true });
});

/**
 * DELETE /agent/session/:id
 * Dispose a session (cleans up memory).
 */
app.delete('/agent/session/:id', (req, res) => {
  disposeSession(req.params.id);
  res.json({ ok: true });
});

/**
 * GET /agent/sessions
 * List active sessions.
 */
app.get('/agent/sessions', (_req, res) => {
  res.json(listSessions());
});

// ── /plugins/* — plugin manager ───────────────────────────────────────────────

/**
 * GET /plugins
 * List installed plugins.
 */
app.get('/plugins', (_req, res) => {
  res.json(pluginList());
});

/**
 * POST /plugins/install
 * Install a plugin. Body: { source: "npm:@pkg" | "git:host/user/repo" }
 * Streams SSE progress.
 */
app.post('/plugins/install', async (req, res) => {
  const { source } = req.body ?? {};
  if (!source) return res.status(400).json({ error: 'source is required' });

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const entry = await pluginInstall(source, (line) => send({ status: 'progress', message: line }));
    send({ status: 'done', plugin: entry });
  } catch (e) {
    send({ status: 'error', message: e.message });
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

/**
 * DELETE /plugins/:source  (URL-encoded)
 * Remove a plugin.
 */
app.delete('/plugins/:source', async (req, res) => {
  try {
    await pluginRemove(decodeURIComponent(req.params.source));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * PUT /plugins/:source/enabled
 * Enable or disable a plugin. Body: { enabled: boolean }
 */
app.put('/plugins/:source/enabled', (req, res) => {
  const { enabled } = req.body ?? {};
  try {
    pluginSetEnabled(decodeURIComponent(req.params.source), !!enabled);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /plugins/search?q=…
 * Search npm for pi-compatible packages.
 */
app.get('/plugins/search', async (req, res) => {
  const q       = req.query.q ?? 'pi-package';
  const results = await searchNpm(q);
  res.json(results);
});

// ── /sandbox/* — bKG Agent Hub (sandbox-agent proxy) ─────────────────────────
//
// sandbox-agent runs on port 2468 and provides a universal HTTP API for
// controlling coding agents (pi, Claude Code, Codex, OpenCode, Cursor, Amp).
// bKG proxies all /sandbox/* requests to it and adds start/stop controls.

app.get('/sandbox/status', async (_req, res) => {
  res.json(await getSandboxAgentStatus());
});

app.post('/sandbox/start', async (_req, res) => {
  try { res.json(await startSandboxAgent()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/sandbox/stop', (_req, res) => {
  res.json(stopSandboxAgent());
});

app.get('/sandbox/logs', (_req, res) => {
  res.json({ lines: getSandboxAgentLogs() });
});

// Proxy all other /sandbox/* requests to the sandbox-agent server
app.all('/sandbox/*', async (req, res) => {
  await proxyToSandboxAgent(req, res);
});

// ── /settings — agent config ──────────────────────────────────────────────────

app.get('/settings', (_req, res) => {
  res.json(readSettings());
});

app.put('/settings', (req, res) => {
  const updated = writeSettings(req.body ?? {});
  res.json(updated);
});

// ── Static file serving (SPA) ─────────────────────────────────────────────────

// ── /providers/* — bKG provider registry ─────────────────────────────────────

/**
 * Helper: extract the calling user's key ID from their Bearer token.
 * Returns the keyId string if the request has a valid API key, else null.
 * Admin JWT tokens are treated as "admin" user.
 */
function getCallerKeyId(req) {
  const auth  = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return null;

  // Admin JWT → special "admin" user
  if (verifyToken(token)) return 'admin';

  // API key
  const k = validateApiKey(token);
  return k ? k.id : null;
}

/** GET /providers/list — all providers with per-user status */
app.get('/providers/list', (req, res) => {
  const keyId = getCallerKeyId(req);
  const status = getUserProviderStatus(keyId ?? '');
  const groups = providersByTier();
  res.json({ providers: status, groups: { free: groups.free.map(p=>p.id), freemium: groups.freemium.map(p=>p.id), dynamic: groups.dynamic.map(p=>p.id), paid: groups.paid.map(p=>p.id) } });
});

/** GET /providers/:id/models — list models from a provider (with resolved key) */
app.get('/providers/:id/models', async (req, res) => {
  const keyId  = getCallerKeyId(req);
  const { key } = resolveKeyForUser(req.params.id, keyId ?? '');
  const p = getProvider(req.params.id);
  if (!p) return res.status(404).json({ error: 'Unknown provider' });
  const models = await fetchProviderModels(req.params.id, key);
  res.json({ provider: req.params.id, models, count: models.length });
});

/**
 * POST /providers/proxy
 * Cloud-mode inference proxy — routes an OpenAI-compatible request through
 * the resolved provider API key and streams back the response.
 *
 * Body:
 *   {
 *     provider: string,         // e.g. "groq"
 *     model:    string,         // e.g. "llama-3.3-70b-versatile"
 *     messages: [...]           // OpenAI messages array
 *     stream?:  boolean,        // default true
 *     max_tokens?: number,
 *     temperature?: number,
 *   }
 */
app.post('/providers/proxy', async (req, res) => {
  const keyId = getCallerKeyId(req);
  const { provider: providerId, model, messages, stream = true, max_tokens = 4096, temperature = 0.4 } = req.body ?? {};

  if (!providerId || !model || !messages) {
    return res.status(400).json({ error: 'provider, model, and messages are required' });
  }

  const p = getProvider(providerId);
  if (!p) return res.status(404).json({ error: `Unknown provider: ${providerId}` });

  // Resolve API key via fallback chain
  const { key, source } = resolveKeyForUser(providerId, keyId ?? '');

  if (!key && !p.anonAccess) {
    return res.status(403).json({
      error: `No API key for ${p.name}. Configure one in User Settings or Admin → Global Providers.`,
      provider: providerId,
      signupUrl: p.signupUrl,
    });
  }

  try {
    const { default: fetch } = await import('node-fetch').catch(() => ({ default: globalThis.fetch }));

    const headers = {
      'Content-Type': 'application/json',
      'Accept': stream ? 'text/event-stream' : 'application/json',
    };
    if (key && key !== 'anon') headers['Authorization'] = `Bearer ${key}`;
    // OpenRouter requires HTTP-Referer for some models
    if (providerId === 'openrouter') {
      headers['HTTP-Referer'] = 'https://bkg.local';
      headers['X-Title'] = 'bKG';
    }

    const upstreamRes = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, stream, max_tokens, temperature }),
      signal: AbortSignal.timeout(60000),
    });

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text().catch(() => `${upstreamRes.status}`);
      return res.status(upstreamRes.status).json({ error: text, provider: providerId });
    }

    if (stream && upstreamRes.body) {
      // Forward SSE stream
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-bKG-Provider', providerId);
      res.setHeader('X-bKG-Source', source ?? 'unknown');
      res.flushHeaders();

      const reader = upstreamRes.body;
      reader.on('data', chunk => res.write(chunk));
      reader.on('end', () => res.end());
      reader.on('error', () => res.end());
    } else {
      const data = await upstreamRes.json();
      res.setHeader('X-bKG-Provider', providerId);
      res.setHeader('X-bKG-Source', source ?? 'unknown');
      res.json(data);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) res.status(502).json({ error: `Proxy error: ${msg}`, provider: providerId });
  }
});

// ── /user/* — per-user settings ───────────────────────────────────────────────

/** GET /user/providers — get calling user's provider key status (no values) */
app.get('/user/providers', (req, res) => {
  const keyId = getCallerKeyId(req);
  if (!keyId) return res.status(401).json({ error: 'Authentication required' });
  res.json(getUserProviderStatus(keyId));
});

/** PUT /user/providers — set/update provider keys for the calling user */
app.put('/user/providers', (req, res) => {
  const keyId = getCallerKeyId(req);
  if (!keyId) return res.status(401).json({ error: 'Authentication required' });
  const updates = req.body ?? {};
  const result  = setUserProviderKeys(keyId, updates);
  // Return updated status (no key values)
  res.json({ ok: true, configured: Object.keys(result).length });
});

/** POST /user/onboarded — mark user as having completed onboarding */
app.post('/user/onboarded', (req, res) => {
  const keyId = getCallerKeyId(req);
  if (!keyId) return res.status(401).json({ error: 'Authentication required' });
  markOnboarded(keyId);
  res.json({ ok: true });
});

/** GET /user/profile — get user profile + onboarding status */
app.get('/user/profile', (req, res) => {
  const keyId = getCallerKeyId(req);
  if (!keyId) return res.status(401).json({ error: 'Authentication required' });
  const user = getUser(keyId) ?? { keyId, onboarded: false, createdAt: null };
  res.json({ keyId: user.keyId, name: user.name, onboarded: user.onboarded, createdAt: user.createdAt });
});

// ── /admin/globals — admin global provider config ─────────────────────────────

function requireAdminSession(req, res) {
  const auth  = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.token;
  if (!token || !verifyToken(token)) {
    res.status(401).json({ error: 'Admin session required' });
    return false;
  }
  return true;
}

/** GET /admin/globals — get global provider config */
app.get('/admin/globals', (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const cfg = getGlobalProviderConfig();
  // Mask key values — only show whether each key is set
  const masked = {};
  for (const [k, v] of Object.entries(cfg.providerKeys ?? {})) {
    masked[k] = v ? '••••••••' : '';
  }
  res.json({ ...cfg, providerKeys: masked });
});

/** PUT /admin/globals — update global provider config */
app.put('/admin/globals', (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const updated = setGlobalProviderConfig(req.body ?? {});
  res.json({ ok: true, updatedAt: updated.updatedAt });
});

/** POST /admin/globals/providers — set individual provider key values */
app.post('/admin/globals/providers', (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const { providerKeys } = req.body ?? {};
  if (!providerKeys) return res.status(400).json({ error: 'providerKeys required' });
  const updated = setGlobalProviderConfig({ providerKeys });
  res.json({ ok: true, updatedAt: updated.updatedAt });
});

/** POST /admin/user — create a new user (returns raw API key) */
app.post('/admin/user', (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const { name } = req.body ?? {};
  const result = createUser(name || 'user');
  res.status(201).json({ ...result.user, rawKey: result.rawKey, warning: 'Store this key securely.' });
});

/** GET /admin/users — list all user profiles */
app.get('/admin/users', (req, res) => {
  if (!requireAdminSession(req, res)) return;
  res.json(listUsers());
});

// ── Readiness + health endpoints (must be before static/SPA catch-all) ───────

let _ready = false;

/** GET /health — liveness probe */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', pid: process.pid, uptime: Math.round(process.uptime()), port: PORT });
});

/** GET /health/ready — readiness probe (used by icadp.sh to confirm server is up) */
app.get('/health/ready', (_req, res) => {
  if (_ready) res.json({ ready: true, pid: process.pid });
  else        res.status(503).json({ ready: false });
});

// ── Static file serving (SPA) ─────────────────────────────────────────────────

app.use(express.static(DIST, { maxAge: 0 }));
app.get('*', (_req, res) => res.sendFile(join(DIST, 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────────

// Write PID file so icadp.sh can track and kill us reliably
const PID_DIR  = join(__dir, '../.bkg/run');
const PID_FILE = join(PID_DIR, 'serve.pid');

try {
  mkdirSync(PID_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));
} catch { /* non-fatal: PID dir may not exist in CI */ }

const httpServer = app.listen(PORT, HOST, () => {
  _ready = true;
  console.log(`
╔══════════════════════════════════════════════════════════╗
║       bKG — Unified Server  (pi-agent-core)       ║
╠══════════════════════════════════════════════════════════╣
║  App       : http://localhost:${PORT}
║  Admin     : http://localhost:${PORT}/admin
║  Ready     : http://localhost:${PORT}/health/ready
╠══════════════════════════════════════════════════════════╣
║  /api/*     model server manager  (llama-cpp + ollama)  ║
║  /agent/*   coding agent          (pi-agent-core)       ║
║  /plugins/* plugin manager        (pi-compatible pkgs)  ║
║  /settings  agent configuration                         ║
╚══════════════════════════════════════════════════════════╝
`);
});

// Track open connections so we can close them during graceful shutdown
const connections = new Set();
httpServer.on('connection', (conn) => {
  connections.add(conn);
  conn.once('close', () => connections.delete(conn));
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[serve] Received ${signal} — shutting down gracefully…`);
  _ready = false;

  // Stop managed child processes first
  stopLlama();
  stopOllama();

  // Stop accepting new connections
  httpServer.close(() => {
    console.log('[serve] HTTP server closed');
    // Remove PID file
    try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch { /**/ }
    process.exit(0);
  });

  // Force-close all open connections after a grace period
  setTimeout(() => {
    for (const conn of connections) conn.destroy();
  }, 3000);

  // Hard exit if still alive after 8 s
  setTimeout(() => {
    console.error('[serve] Forced exit after timeout');
    process.exit(1);
  }, 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('[serve] Uncaught exception:', err);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('[serve] Unhandled rejection:', reason);
});
