/**
 * server/serve.js — ICADP 3.0 Unified Server
 *
 * Single process that:
 *   1. Serves the built React app from ../dist/  (SPA with HTML fallback)
 *   2. Exposes /api/ endpoints to start / stop the two model servers
 *      so the admin panel can control them without a separate manager.
 *   3. Logs everything to the console with clean prefixes.
 *
 * Usage:
 *   node server/serve.js
 *
 * Environment variables:
 *   PORT          HTTP port for this server          (default: 3000)
 *   HOST          Bind address                       (default: 0.0.0.0)
 *   LLAMA_PORT    Port the llama-cpp server uses     (default: 8001)
 *   OLLAMA_PORT   Port Ollama listens on             (default: 11434)
 *   DIST_DIR      Path to built app files            (default: ../dist)
 */

import express         from 'express';
import cors            from 'cors';
import { createServer }from 'http';
import { spawn }       from 'child_process';
import { readdir }     from 'fs/promises';
import { join, extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir  = dirname(fileURLToPath(import.meta.url));
const DIST   = resolve(__dir, process.env.DIST_DIR ?? '../dist');

const PORT        = parseInt(process.env.PORT        ?? '3000',  10);
const HOST        = process.env.HOST                  ?? '0.0.0.0';
const LLAMA_PORT  = parseInt(process.env.LLAMA_PORT  ?? '8001',  10);
const OLLAMA_PORT = parseInt(process.env.OLLAMA_PORT ?? '11434', 10);

// ── Process state ─────────────────────────────────────────────────────────────

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
  const port      = name === 'llama' ? LLAMA_PORT : OLLAMA_PORT;
  const proc      = state[name].proc;
  const running   = proc != null && !proc.killed;
  const reachable = await isPortOpen(port);
  return { name, pid: proc?.pid ?? null, running, reachable, port };
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
  child.on('exit',  c => { pushLog('llama', `exited (${c})`);        state.llama.proc = null; });
  child.on('error', e => { pushLog('llama', `error: ${e.message}`);  state.llama.proc = null; });
  state.llama.proc = child;
  pushLog('llama', `started PID ${child.pid}`);
  return { pid: child.pid };
}

function stopLlama() {
  if (!state.llama.proc || state.llama.proc.killed) return { error: 'Not running' };
  state.llama.proc.kill('SIGTERM');
  pushLog('llama', 'SIGTERM sent');
  return { ok: true };
}

function startOllama() {
  if (state.ollama.proc && !state.ollama.proc.killed)
    return { error: 'Already running', pid: state.ollama.proc.pid };

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

function stopOllama() {
  if (!state.ollama.proc || state.ollama.proc.killed) return { error: 'Not running' };
  state.ollama.proc.kill('SIGTERM');
  pushLog('ollama', 'SIGTERM sent');
  return { ok: true };
}

// ── Express ───────────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── /api/* — manager endpoints ────────────────────────────────────────────────

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
  if (modelPath)              env['MODEL_PATH']  = modelPath;
  if (nCtx)                   env['N_CTX']       = String(nCtx);
  if (gpuLayers !== undefined)env['GPU_LAYERS']  = String(gpuLayers);
  res.json(startLlama(env));
});
app.post('/api/llama/stop',   (_req, res) => res.json(stopLlama()));
app.post('/api/ollama/start', (_req, res) => res.json(startOllama()));
app.post('/api/ollama/stop',  (_req, res) => res.json(stopOllama()));

// Systemd snippets
app.get('/api/systemd-units', (_req, res) => {
  const user = process.env.USER ?? 'ubuntu';
  const node = process.execPath;
  const dir  = __dir;
  res.json({
    llama: {
      unitFile: `/etc/systemd/system/icadp-llama.service`,
      content: `[Unit]
Description=ICADP node-llama-cpp inference server
After=network.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${dir}
ExecStart=${node} ${join(dir,'index.js')}
Restart=on-failure
RestartSec=5
Environment=PORT=${LLAMA_PORT}

[Install]
WantedBy=multi-user.target`,
      commands: [
        `sudo nano /etc/systemd/system/icadp-llama.service`,
        `sudo systemctl daemon-reload`,
        `sudo systemctl enable --now icadp-llama`,
        `sudo systemctl status icadp-llama`,
      ],
    },
    ollama: {
      installCommand: `curl -fsSL https://ollama.com/install.sh | sh`,
      commands: [
        `sudo systemctl enable --now ollama`,
        `sudo systemctl status ollama`,
        `# Or manual: ollama serve`,
      ],
    },
  });
});

// ── Static file serving (SPA) ─────────────────────────────────────────────────

// Serve static assets; unknown paths fall back to index.html
app.use(express.static(DIST, { maxAge: 0 }));
app.get('*', (_req, res) => res.sendFile(join(DIST, 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, HOST, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║       ICADP 3.0 — Unified Server                     ║
╠══════════════════════════════════════════════════════╣
║  App     : http://localhost:${PORT}                    
║  Admin   : http://localhost:${PORT}/admin              
║  API     : http://localhost:${PORT}/api/status         
╠══════════════════════════════════════════════════════╣
║  Controls node-llama-cpp (port ${LLAMA_PORT}) and       
║  Ollama (port ${OLLAMA_PORT}) via /api/ endpoints      
╚══════════════════════════════════════════════════════╝
`);
});

process.on('SIGTERM', () => { stopLlama(); stopOllama(); process.exit(0); });
process.on('SIGINT',  () => { stopLlama(); stopOllama(); process.exit(0); });
