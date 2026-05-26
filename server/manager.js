/**
 * server/manager.js — bKG Process Manager
 *
 * Lightweight HTTP server that starts / stops the two model servers:
 *   • node-llama-cpp inference server  (server/index.js, default port 8001)
 *   • Ollama                            (ollama serve, default port 11434)
 *
 * Runs on port 4001 by default.  The bKG admin panel connects to it.
 *
 * Usage:
 *   cd server && node manager.js
 *
 * Environment variables:
 *   MANAGER_PORT   Port for this manager server (default: 4001)
 *   MANAGER_HOST   Bind address (default: 127.0.0.1)
 *   LLAMA_PORT     Port the llama server listens on (default: 8001)
 *   OLLAMA_PORT    Port Ollama listens on (default: 11434)
 *   MODEL_DIR      Model directory passed to inference server (default: ./models)
 */

import express        from 'express';
import cors           from 'cors';
import { spawn }      from 'child_process';
import { createServer }from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { access }     from 'fs/promises';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const MANAGER_PORT = parseInt(process.env.MANAGER_PORT ?? '4001', 10);
const MANAGER_HOST = process.env.MANAGER_HOST           ?? '127.0.0.1';
const LLAMA_PORT   = parseInt(process.env.LLAMA_PORT    ?? '8001', 10);
const OLLAMA_PORT  = parseInt(process.env.OLLAMA_PORT   ?? '11434', 10);
const MODEL_DIR    = process.env.MODEL_DIR               ?? join(__dir, 'models');

// ── Process tracking ──────────────────────────────────────────────────────────

const procs = {
  llama:  /** @type {import('child_process').ChildProcess|null} */ (null),
  ollama: /** @type {import('child_process').ChildProcess|null} */ (null),
};

const logs = {
  llama:  /** @type {string[]} */ ([]),
  ollama: /** @type {string[]} */ ([]),
};

const MAX_LOG_LINES = 200;

function pushLog(name, line) {
  logs[name].push(line);
  if (logs[name].length > MAX_LOG_LINES) logs[name].shift();
}

// ── Health poll ───────────────────────────────────────────────────────────────

async function isPortOpen(port) {
  return new Promise(resolve => {
    const srv = createServer();
    srv.listen(port, '127.0.0.1', () => { srv.close(); resolve(false); });
    srv.on('error', () => resolve(true)); // port in use = something is listening
  });
}

async function serverStatus(name) {
  const port = name === 'llama' ? LLAMA_PORT : OLLAMA_PORT;
  const pid  = procs[name]?.pid ?? null;
  const running = pid !== null && !procs[name].killed;
  const reachable = await isPortOpen(port);
  return { name, pid, running, reachable, port };
}

// ── Start helpers ─────────────────────────────────────────────────────────────

function startLlama(env = {}) {
  if (procs.llama && !procs.llama.killed) return { error: 'Already running', pid: procs.llama.pid };

  const child = spawn(process.execPath, [join(__dir, 'index.js')], {
    cwd: __dir,
    env: {
      ...process.env,
      PORT:      String(LLAMA_PORT),
      MODEL_DIR,
      ...env,
    },
    detached: false,
    stdio:    ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', d => d.toString().split('\n').forEach(l => l && pushLog('llama', l)));
  child.stderr.on('data', d => d.toString().split('\n').forEach(l => l && pushLog('llama', `ERR: ${l}`)));
  child.on('exit', (code) => { pushLog('llama', `Process exited (code ${code})`); procs.llama = null; });
  child.on('error', (e)   => { pushLog('llama', `Process error: ${e.message}`);  procs.llama = null; });

  procs.llama = child;
  pushLog('llama', `Started PID ${child.pid}`);
  return { pid: child.pid };
}

function stopLlama() {
  if (!procs.llama || procs.llama.killed) return { error: 'Not running' };
  procs.llama.kill('SIGTERM');
  pushLog('llama', 'Sent SIGTERM');
  return { ok: true };
}

function startOllama(env = {}) {
  if (procs.ollama && !procs.ollama.killed) return { error: 'Already running', pid: procs.ollama.pid };

  const child = spawn('ollama', ['serve'], {
    env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${OLLAMA_PORT}`, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', d => d.toString().split('\n').forEach(l => l && pushLog('ollama', l)));
  child.stderr.on('data', d => d.toString().split('\n').forEach(l => l && pushLog('ollama', l)));
  child.on('exit', (code) => { pushLog('ollama', `Process exited (code ${code})`); procs.ollama = null; });
  child.on('error', (e)   => { pushLog('ollama', `Process error: ${e.message}`);  procs.ollama = null; });

  procs.ollama = child;
  pushLog('ollama', `Started PID ${child.pid}`);
  return { pid: child.pid };
}

function stopOllama() {
  if (!procs.ollama || procs.ollama.killed) return { error: 'Not running' };
  procs.ollama.kill('SIGTERM');
  pushLog('ollama', 'Sent SIGTERM');
  return { ok: true };
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'] }));
app.use(express.json());

// ── GET /status — health of both servers ─────────────────────────────────────

app.get('/status', async (_req, res) => {
  const [llama, ollama] = await Promise.all([serverStatus('llama'), serverStatus('ollama')]);
  res.json({ llama, ollama });
});

// ── GET /logs/:server — tail of recent log lines ──────────────────────────────

app.get('/logs/:server', (req, res) => {
  const name = req.params.server;
  if (name !== 'llama' && name !== 'ollama') return res.status(400).json({ error: 'Unknown server' });
  res.json({ lines: logs[name].slice(-100) });
});

// ── POST /llama/start ─────────────────────────────────────────────────────────

app.post('/llama/start', (req, res) => {
  const { modelPath, nCtx, gpuLayers } = req.body ?? {};
  const env = {};
  if (modelPath)  env['MODEL_PATH']  = modelPath;
  if (nCtx)       env['N_CTX']       = String(nCtx);
  if (gpuLayers !== undefined) env['GPU_LAYERS'] = String(gpuLayers);
  const result = startLlama(env);
  res.json(result);
});

// ── POST /llama/stop ──────────────────────────────────────────────────────────

app.post('/llama/stop', (_req, res) => { res.json(stopLlama()); });

// ── POST /ollama/start ────────────────────────────────────────────────────────

app.post('/ollama/start', (_req, res) => { res.json(startOllama()); });

// ── POST /ollama/stop ─────────────────────────────────────────────────────────

app.post('/ollama/stop', (_req, res) => { res.json(stopOllama()); });

// ── GET /systemd-units — Ubuntu/systemd setup snippets ───────────────────────

app.get('/systemd-units', (req, res) => {
  const user       = process.env.USER ?? 'ubuntu';
  const serverDir  = __dir;
  const nodeBin    = process.execPath;
  const ollamaBin  = '/usr/local/bin/ollama'; // typical Ollama install path

  res.json({
    llama: {
      unitFile: `/etc/systemd/system/bkg-llama.service`,
      content: `[Unit]
Description=bKG node-llama-cpp inference server
After=network.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${serverDir}
ExecStart=${nodeBin} ${join(serverDir,'index.js')}
Restart=on-failure
RestartSec=5
Environment=PORT=${LLAMA_PORT}
Environment=MODEL_DIR=${MODEL_DIR}
Environment=GPU_LAYERS=-1

[Install]
WantedBy=multi-user.target`,
      commands: [
        `sudo nano /etc/systemd/system/bkg-llama.service  # paste unit file`,
        `sudo systemctl daemon-reload`,
        `sudo systemctl enable bkg-llama`,
        `sudo systemctl start bkg-llama`,
        `sudo systemctl status bkg-llama`,
      ],
    },
    ollama: {
      unitFile: `/etc/systemd/system/ollama.service`,
      installCommand: `curl -fsSL https://ollama.com/install.sh | sh`,
      commands: [
        `# If installed via install.sh, Ollama already registers a systemd service:`,
        `sudo systemctl enable ollama`,
        `sudo systemctl start ollama`,
        `sudo systemctl status ollama`,
        `# Manual start (no systemd):`,
        `ollama serve`,
      ],
    },
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(MANAGER_PORT, MANAGER_HOST, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║      bKG Process Manager  v1.0                     ║
╠══════════════════════════════════════════════════════╣
║  Manager : http://${MANAGER_HOST}:${MANAGER_PORT}               
║  Controls: llama-cpp (port ${LLAMA_PORT}), ollama (port ${OLLAMA_PORT})
╠══════════════════════════════════════════════════════╣
║  Endpoints:                                          ║
║    GET  /status                                      ║
║    GET  /logs/llama | /logs/ollama                   ║
║    POST /llama/start  { modelPath, nCtx, gpuLayers } ║
║    POST /llama/stop                                  ║
║    POST /ollama/start                                ║
║    POST /ollama/stop                                 ║
║    GET  /systemd-units  (Ubuntu setup snippets)      ║
╚══════════════════════════════════════════════════════╝
`);
});

// Graceful shutdown
process.on('SIGTERM', () => { stopLlama(); stopOllama(); process.exit(0); });
process.on('SIGINT',  () => { stopLlama(); stopOllama(); process.exit(0); });
