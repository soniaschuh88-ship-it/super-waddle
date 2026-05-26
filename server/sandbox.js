/**
 * server/sandbox.js — bKG Agent Hub
 *
 * Manages the sandbox-agent process (universal coding agent harness).
 * sandbox-agent supports: pi, Claude Code, Codex, OpenCode, Cursor, Amp
 * Runs the binary on port 2468 and exposes control endpoints.
 *
 * Based on https://github.com/rivet-dev/sandbox-agent (MIT License)
 * Rebranded and integrated into bKG.
 */

import { spawn }    from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath }  from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// Path to the sandbox-agent binary (installed as npm dep)
const SA_BIN  = join(__dir, 'node_modules', '.bin', 'sandbox-agent');
const SA_PORT = parseInt(process.env.BKG_SA_PORT  ?? '2468', 10);
const SA_HOST = process.env.BKG_SA_HOST           ?? '127.0.0.1';
const SA_BASE = `http://${SA_HOST}:${SA_PORT}`;

// ── Process state ─────────────────────────────────────────────────────────────

let saProc   = null;
let saLogs   = [];

function pushSALog(line) {
  saLogs.push(`[${new Date().toISOString().slice(11,19)}] ${line}`);
  if (saLogs.length > 400) saLogs.shift();
}

// ── Check if sandbox-agent is already listening ───────────────────────────────

/**
 * Check if sandbox-agent is already running by trying to connect to its port.
 * Uses a TCP connection attempt instead of binding (which temporarily occupies the port
 * and causes sandbox-agent to fail with exit code 101 / EADDRINUSE).
 */
async function isSARunning() {
  return new Promise(resolve => {
    const net = require('net');
    const sock = new net.Socket();
    sock.setTimeout(1000);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.on('error',   () => { sock.destroy(); resolve(false); });
    sock.connect(SA_PORT, SA_HOST);
  });
}

// ── Start sandbox-agent ───────────────────────────────────────────────────────

export async function startSandboxAgent() {
  if (saProc && !saProc.killed) return { error: 'Already running', pid: saProc.pid };
  if (await isSARunning()) return { error: 'Port already in use', port: SA_PORT };

  const child = spawn(SA_BIN, [
    'server',
    '--no-token',
    '--host', SA_HOST,
    '--port', String(SA_PORT),
    '--cors-allow-origin', '*',
    '--cors-allow-method', 'GET,POST,PUT,DELETE,OPTIONS',
    '--cors-allow-header', 'Content-Type,Authorization',
    '--no-telemetry',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', d => d.toString().split('\n').forEach(l => l && pushSALog(l)));
  child.stderr.on('data', d => d.toString().split('\n').forEach(l => l && pushSALog(l)));
  child.on('exit',  c => { pushSALog(`exited (${c})`);       saProc = null; });
  child.on('error', e => { pushSALog(`error: ${e.message}`); saProc = null; });

  saProc = child;
  pushSALog(`started PID ${child.pid} on port ${SA_PORT}`);
  return { pid: child.pid, port: SA_PORT, base: SA_BASE };
}

// ── Stop sandbox-agent ────────────────────────────────────────────────────────

export function stopSandboxAgent() {
  if (!saProc || saProc.killed) return { error: 'Not running' };
  saProc.kill('SIGTERM');
  pushSALog('SIGTERM sent');
  return { ok: true };
}

// ── Status ────────────────────────────────────────────────────────────────────

export async function getSandboxAgentStatus() {
  const running   = saProc != null && !saProc.killed;
  const reachable = await isSARunning();
  return {
    running,
    reachable,
    pid:  saProc?.pid ?? null,
    port: SA_PORT,
    base: SA_BASE,
    inspectorUrl: `${SA_BASE}/ui/`,
  };
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export function getSandboxAgentLogs() {
  return saLogs.slice(-100);
}

// ── Proxy helper ──────────────────────────────────────────────────────────────

/**
 * Forward an Express req/res pair to the sandbox-agent server.
 * Used by serve.js to proxy /sandbox/* → http://127.0.0.1:2468/*
 */
export async function proxyToSandboxAgent(req, res) {
  // Strip /sandbox prefix
  const path      = req.path.replace(/^\/sandbox/, '') || '/';
  const url        = `${SA_BASE}${path}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;

  // For SSE streams, we need to forward the stream directly
  const isSSE = req.headers.accept === 'text/event-stream';

  try {
    const fetch  = (await import('undici')).fetch;
    const method = req.method;
    const headers = { ...req.headers, host: `${SA_HOST}:${SA_PORT}` };
    delete headers['content-length'];  // let fetch recalculate

    const body = ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(req.body);

    const upstream = await fetch(url, { method, headers, body, duplex: 'half' });

    // Forward headers
    for (const [k, v] of upstream.headers.entries()) {
      if (!['transfer-encoding'].includes(k)) res.setHeader(k, v);
    }
    res.status(upstream.status);

    if (!upstream.body) { res.end(); return; }

    // Stream the body
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();

  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'sandbox-agent unreachable', detail: err.message });
    }
  }
}

// ── Export base URL for serve.js ──────────────────────────────────────────────

export { SA_BASE, SA_PORT };
