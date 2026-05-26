/**
 * server/serve.js — ICADP 3.0 Unified Server
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
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';

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

const __dir  = dirname(fileURLToPath(import.meta.url));
const DIST   = resolve(__dir, process.env.DIST_DIR ?? '../dist');

const PORT        = parseInt(process.env.PORT        ?? '3000',  10);
const HOST        = process.env.HOST                  ?? '0.0.0.0';
const LLAMA_PORT  = parseInt(process.env.LLAMA_PORT  ?? '8001',  10);
const OLLAMA_PORT = parseInt(process.env.OLLAMA_PORT ?? '11434', 10);

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
      unitFile: `/etc/systemd/system/icadp-llama.service`,
      content: `[Unit]\nDescription=ICADP node-llama-cpp inference server\nAfter=network.target\n\n[Service]\nType=simple\nUser=${user}\nWorkingDirectory=${dir}\nExecStart=${node} ${join(dir,'index.js')}\nRestart=on-failure\nRestartSec=5\nEnvironment=PORT=${LLAMA_PORT}\n\n[Install]\nWantedBy=multi-user.target`,
      commands: [`sudo nano /etc/systemd/system/icadp-llama.service`,`sudo systemctl daemon-reload`,`sudo systemctl enable --now icadp-llama`,`sudo systemctl status icadp-llama`],
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

// ── /settings — agent config ──────────────────────────────────────────────────

app.get('/settings', (_req, res) => {
  res.json(readSettings());
});

app.put('/settings', (req, res) => {
  const updated = writeSettings(req.body ?? {});
  res.json(updated);
});

// ── Static file serving (SPA) ─────────────────────────────────────────────────

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
const PID_DIR  = join(__dir, '../.icadp/run');
const PID_FILE = join(PID_DIR, 'serve.pid');

try {
  mkdirSync(PID_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));
} catch { /* non-fatal: PID dir may not exist in CI */ }

const httpServer = app.listen(PORT, HOST, () => {
  _ready = true;
  console.log(`
╔══════════════════════════════════════════════════════════╗
║       ICADP 3.0 — Unified Server  (pi-agent-core)       ║
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
