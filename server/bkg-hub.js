/**
 * server/bkg-hub.js — bKG Agent Hub
 *
 * Pure Node.js implementation of a universal coding agent harness.
 * Rebraneded from and inspired by sandbox-agent (MIT, rivet-dev/sandbox-agent).
 *
 * Supported agents:
 *   pi          — via @earendil-works/pi-coding-agent (bundled)
 *   claude-code — spawns 'claude' CLI if installed
 *   codex       — spawns 'codex' CLI if installed
 *   opencode    — spawns 'opencode' CLI if installed
 *
 * Features (1:1 with sandbox-agent spec):
 *   • Universal agent API (one interface for all agents)
 *   • Session lifecycle (create / send / stream / destroy)
 *   • SSE streaming for real-time events
 *   • Permission handling (human-in-the-loop)
 *   • Universal event schema (normalized across agents)
 *   • File-system proxy (read / write / list / delete)
 *   • Process execution (run commands inside session workspace)
 *   • Session persistence (JSONL at ~/.bkg/hub-sessions/)
 *   • Agent installation detection + status
 *   • Inspector-ready REST API
 */

import { spawn, exec }         from 'child_process';
import { join, dirname, resolve as resolvePath }  from 'path';
import { fileURLToPath }        from 'url';
import {
  readFileSync, writeFileSync, existsSync,
  mkdirSync, readdirSync, statSync, unlinkSync,
} from 'fs';
import { homedir }              from 'os';
import { randomUUID }           from 'crypto';
import { promisify }            from 'util';

// ── Pi agent (bundled) ────────────────────────────────────────────────────────
let piCodingAgent = null;
try {
  piCodingAgent = await import('./agent.js');
} catch { /**/ }

const execAsync = promisify(exec);

const BKG_DIR   = process.env.BKG_DIR ?? join(homedir(), '.bkg');
const SESS_DIR  = join(BKG_DIR, 'hub-sessions');
const WORK_ROOT = join(BKG_DIR, 'workspaces');

mkdirSync(SESS_DIR,  { recursive: true });
mkdirSync(WORK_ROOT, { recursive: true });

// ── Universal event schema ────────────────────────────────────────────────────

/**
 * bKG Hub event types (matches sandbox-agent universal schema).
 *
 * text          — assistant text delta
 * message       — complete assistant message
 * tool_call     — agent invoked a tool
 * tool_result   — tool execution completed
 * permission    — agent requesting human approval
 * error         — agent or hub error
 * status        — lifecycle / status update
 * command_start — shell command started
 * command_delta — shell command output delta
 * command_done  — shell command finished
 * file_change   — file written/modified in workspace
 */
function mkEvent(type, data, sessionId = null) {
  return {
    id:        randomUUID(),
    ts:        Date.now(),
    sessionId,
    type,
    data,
  };
}

// ── Detect installed agents ───────────────────────────────────────────────────

async function isInstalled(binary) {
  try { await execAsync(`which ${binary}`); return true; }
  catch { return false; }
}

async function agentVersion(binary) {
  try {
    const { stdout } = await execAsync(`${binary} --version 2>&1`);
    return stdout.trim().slice(0, 40);
  } catch { return null; }
}

export async function listAgents() {
  const agents = [];

  // Pi (always available if pi-coding-agent is installed)
  if (piCodingAgent) {
    agents.push({
      id:          'pi',
      name:        'Pi',
      description: 'Local coding agent via @earendil-works/pi-coding-agent. Works with Ollama, llama-cpp, and cloud providers.',
      installed:   true,
      version:     '0.75.5',
      modes:       ['default'],
      local:       true,
    });
  }

  // Claude Code
  const claudeInstalled = await isInstalled('claude');
  agents.push({
    id:          'claude-code',
    name:        'Claude Code',
    description: 'Anthropic Claude Code — autonomous coding agent.',
    installed:   claudeInstalled,
    version:     claudeInstalled ? await agentVersion('claude') : null,
    modes:       ['default'],
    requiresKey: 'ANTHROPIC_API_KEY',
    local:       false,
  });

  // Codex
  const codexInstalled = await isInstalled('codex');
  agents.push({
    id:          'codex',
    name:        'Codex (OpenAI)',
    description: 'OpenAI Codex — code-focused model agent.',
    installed:   codexInstalled,
    version:     codexInstalled ? await agentVersion('codex') : null,
    modes:       ['default', 'plan'],
    requiresKey: 'OPENAI_API_KEY',
    local:       false,
  });

  // OpenCode
  const opencodeInstalled = await isInstalled('opencode');
  agents.push({
    id:          'opencode',
    name:        'OpenCode',
    description: 'Open-source coding agent — compatible with multiple providers.',
    installed:   opencodeInstalled,
    version:     opencodeInstalled ? await agentVersion('opencode') : null,
    modes:       ['default'],
    requiresKey: null,
    local:       false,
  });

  // Amp
  const ampInstalled = await isInstalled('amp');
  agents.push({
    id:          'amp',
    name:        'Amp',
    description: 'AI coding agent with permission system and bypass mode.',
    installed:   ampInstalled,
    version:     ampInstalled ? await agentVersion('amp') : null,
    modes:       ['default', 'bypass'],
    requiresKey: 'AMP_API_KEY',
    local:       false,
  });

  return agents;
}

// ── Session store ─────────────────────────────────────────────────────────────

const sessions = new Map();   // sessionId → SessionRecord

function getSessionRecord(id) {
  return sessions.get(id) ?? null;
}

function persistEvent(sessionId, event) {
  const path = join(SESS_DIR, `${sessionId}.jsonl`);
  writeFileSync(path, JSON.stringify(event) + '\n', { flag: 'a' });
}

function loadSessionEvents(sessionId) {
  const path = join(SESS_DIR, `${sessionId}.jsonl`);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l));
  } catch { return []; }
}

/** Push event to session buffer + persist + notify SSE subscribers */
function pushEvent(sessionId, event) {
  const rec = sessions.get(sessionId);
  if (!rec) return;
  rec.events.push(event);
  persistEvent(sessionId, event);
  // Notify SSE subscribers
  for (const fn of rec.subscribers) {
    try { fn(event); } catch { /**/ }
  }
}

function subscribe(sessionId, fn) {
  const rec = sessions.get(sessionId);
  if (!rec) return () => {};
  rec.subscribers.add(fn);
  return () => rec.subscribers.delete(fn);
}

// ── Create session ────────────────────────────────────────────────────────────

export async function createSession(sessionId, agentId = 'pi', mode = 'default', options = {}) {
  if (sessions.has(sessionId)) {
    return { error: `Session '${sessionId}' already exists` };
  }

  const cwd = options.cwd ?? join(WORK_ROOT, sessionId);
  mkdirSync(cwd, { recursive: true });

  const rec = {
    id:          sessionId,
    agentId,
    mode,
    cwd,
    status:      'idle',   // idle | running | waiting_permission | error | done
    createdAt:   new Date().toISOString(),
    events:      loadSessionEvents(sessionId),
    subscribers: new Set(),
    // Agent-specific handle
    agentHandle: null,
    // Pending permission request
    pendingPermission: null,
  };
  sessions.set(sessionId, rec);

  // Start the agent subprocess / session
  if (agentId === 'pi' && piCodingAgent) {
    await _startPiSession(rec, options);
  } else {
    await _startCliSession(rec, options);
  }

  pushEvent(sessionId, mkEvent('status', { status: 'created', agentId, mode, cwd }, sessionId));
  return { id: sessionId, agentId, mode, cwd, status: rec.status };
}

// ── Pi session ────────────────────────────────────────────────────────────────

async function _startPiSession(rec, options) {
  rec.status = 'idle';
  rec.agentHandle = { type: 'pi', piSessionId: null };

  if (options.initialMessage) {
    // Pi sessions are created lazily — send first message to initialise
    _sendPi(rec, options.initialMessage).catch(e => {
      pushEvent(rec.id, mkEvent('error', { message: e.message }, rec.id));
    });
  }
}

async function _sendPi(rec, text) {
  rec.status = 'running';
  pushEvent(rec.id, mkEvent('status', { status: 'running', agentId: 'pi' }, rec.id));

  let piSessionId = rec.agentHandle?.piSessionId;

  if (!piSessionId) {
    // Create a new pi session
    const result = await piCodingAgent.startSession({
      cwd:           rec.cwd,
      initialMessage: text,
    });
    piSessionId = result.sessionId;
    rec.agentHandle.piSessionId = piSessionId;

    // Forward pi events to hub events
    _pollPiEvents(rec, piSessionId);
    return;
  }

  await piCodingAgent.sendMessage(piSessionId, text);
  _pollPiEvents(rec, piSessionId);
}

function _pollPiEvents(rec, piSessionId) {
  const sessionId = rec.id;
  let lastIdx = 0;

  const poll = async () => {
    if (!sessions.has(sessionId)) return;
    const { events: piEvents } = await piCodingAgent.getSessionEvents
      ? { events: piCodingAgent.getSessionEvents(piSessionId, lastIdx) ?? [] }
      : { events: [] };

    for (const e of piEvents) {
      lastIdx++;
      // Normalize pi event to universal schema
      const normalized = _normalizePiEvent(e, sessionId);
      if (normalized) pushEvent(sessionId, normalized);
    }

    const rec2 = sessions.get(sessionId);
    if (rec2 && rec2.status === 'running') {
      setTimeout(poll, 300);
    } else {
      if (rec2) {
        rec2.status = 'idle';
        pushEvent(sessionId, mkEvent('status', { status: 'idle' }, sessionId));
      }
    }
  };

  setTimeout(poll, 300);
}

function _normalizePiEvent(e, sessionId) {
  if (!e) return null;
  const kind = e.kind ?? e.type ?? '';
  switch (kind) {
    case 'text':
    case 'content_delta':
      return mkEvent('text', { content: e.text ?? e.content ?? '' }, sessionId);
    case 'tool_use':
    case 'tool_call':
      return mkEvent('tool_call', { name: e.tool ?? e.name, params: e.params ?? e.input }, sessionId);
    case 'tool_result':
      return mkEvent('tool_result', { name: e.tool ?? e.name, result: e.result }, sessionId);
    case 'error':
      return mkEvent('error', { message: e.message ?? String(e) }, sessionId);
    case 'done':
    case 'end':
      return mkEvent('status', { status: 'idle', reason: kind }, sessionId);
    default:
      return mkEvent('status', { raw: e }, sessionId);
  }
}

// ── CLI agent session (claude-code, codex, opencode, amp) ─────────────────────

async function _startCliSession(rec, options) {
  rec.status = 'idle';
  rec.agentHandle = { type: 'cli', proc: null };

  if (options.initialMessage) {
    await _sendCli(rec, options.initialMessage);
  }
}

function _buildCliArgs(agentId, mode, text) {
  switch (agentId) {
    case 'claude-code':
      return ['claude', '--print', text];
    case 'codex':
      return mode === 'plan'
        ? ['codex', '--plan', text]
        : ['codex', text];
    case 'opencode':
      return ['opencode', 'run', '--message', text];
    case 'amp':
      return mode === 'bypass'
        ? ['amp', '--bypass', '--message', text]
        : ['amp', '--message', text];
    default:
      throw new Error(`Unknown agent: ${agentId}`);
  }
}

async function _sendCli(rec, text) {
  const sessionId = rec.id;
  rec.status = 'running';
  pushEvent(sessionId, mkEvent('status', { status: 'running', agentId: rec.agentId }, sessionId));

  const [bin, ...args] = _buildCliArgs(rec.agentId, rec.mode, text);

  const proc = spawn(bin, args, {
    cwd:   rec.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env:   { ...process.env },
  });

  rec.agentHandle.proc = proc;

  let textBuf = '';
  proc.stdout.on('data', chunk => {
    const str = chunk.toString();
    textBuf += str;
    pushEvent(sessionId, mkEvent('text', { content: str }, sessionId));
  });

  proc.stderr.on('data', chunk => {
    pushEvent(sessionId, mkEvent('error', { message: chunk.toString() }, sessionId));
  });

  proc.on('exit', code => {
    rec.agentHandle.proc = null;
    rec.status = 'idle';
    pushEvent(sessionId, mkEvent('status', {
      status: code === 0 ? 'idle' : 'error',
      exitCode: code,
      output: textBuf,
    }, sessionId));
  });

  proc.on('error', e => {
    rec.status = 'error';
    pushEvent(sessionId, mkEvent('error', {
      message: `Failed to start ${rec.agentId}: ${e.message}. Is it installed?`,
    }, sessionId));
  });
}

// ── Send message ──────────────────────────────────────────────────────────────

export async function sendMessage(sessionId, text) {
  const rec = sessions.get(sessionId);
  if (!rec) throw new Error(`Session '${sessionId}' not found`);

  pushEvent(sessionId, mkEvent('message', { role: 'user', content: text }, sessionId));

  if (rec.agentId === 'pi' && piCodingAgent) {
    await _sendPi(rec, text);
  } else {
    await _sendCli(rec, text);
  }
}

// ── Permission handling ───────────────────────────────────────────────────────

export function replyPermission(sessionId, approved, response = null) {
  const rec = sessions.get(sessionId);
  if (!rec || !rec.pendingPermission) {
    return { error: 'No pending permission request' };
  }
  const { resolve } = rec.pendingPermission;
  rec.pendingPermission = null;
  rec.status = 'running';
  resolve({ approved, response });
  pushEvent(sessionId, mkEvent('status', {
    status: 'running',
    permissionDecision: { approved, response },
  }, sessionId));
  return { ok: true };
}

// ── Stream events (SSE) ───────────────────────────────────────────────────────

export function streamSessionEvents(sessionId, req, res, afterOffset = 0) {
  const rec = sessions.get(sessionId);
  if (!rec) { res.status(404).json({ error: 'Session not found' }); return; }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Replay buffered events first
  for (let i = afterOffset; i < rec.events.length; i++) {
    res.write(`data: ${JSON.stringify(rec.events[i])}\n\n`);
  }

  // Subscribe to new events
  const unsub = subscribe(sessionId, event => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  });

  // Heartbeat every 15 s
  const hb = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
    else clearInterval(hb);
  }, 15000);

  req.on('close', () => { unsub(); clearInterval(hb); });
}

// ── List events (REST) ────────────────────────────────────────────────────────

export function listSessionEvents(sessionId, offset = 0, limit = 100) {
  const rec = sessions.get(sessionId);
  if (!rec) return null;
  const slice = rec.events.slice(offset, offset + limit);
  return { items: slice, total: rec.events.length, offset, limit };
}

// ── Destroy session ───────────────────────────────────────────────────────────

export function destroySession(sessionId) {
  const rec = sessions.get(sessionId);
  if (!rec) return { error: 'Session not found' };

  // Kill subprocess if running
  if (rec.agentHandle?.proc) {
    try { rec.agentHandle.proc.kill('SIGTERM'); } catch { /**/ }
  }

  // Kill pi session
  if (rec.agentHandle?.piSessionId && piCodingAgent?.disposeSession) {
    try { piCodingAgent.disposeSession(rec.agentHandle.piSessionId); } catch { /**/ }
  }

  rec.subscribers.clear();
  sessions.delete(sessionId);
  pushEvent(sessionId, mkEvent('status', { status: 'destroyed' }, sessionId));
  return { ok: true };
}

// ── Abort current turn ────────────────────────────────────────────────────────

export function abortSession(sessionId) {
  const rec = sessions.get(sessionId);
  if (!rec) return { error: 'Session not found' };

  if (rec.agentHandle?.proc) {
    try { rec.agentHandle.proc.kill('SIGINT'); } catch { /**/ }
  }
  if (rec.agentHandle?.piSessionId && piCodingAgent?.abortSession) {
    try { piCodingAgent.abortSession(rec.agentHandle.piSessionId); } catch { /**/ }
  }

  rec.status = 'idle';
  pushEvent(sessionId, mkEvent('status', { status: 'aborted' }, sessionId));
  return { ok: true };
}

// ── List sessions ─────────────────────────────────────────────────────────────

export function listSessions() {
  return Array.from(sessions.values()).map(rec => ({
    id:        rec.id,
    agentId:   rec.agentId,
    mode:      rec.mode,
    status:    rec.status,
    cwd:       rec.cwd,
    createdAt: rec.createdAt,
    eventCount: rec.events.length,
  }));
}

export function getSession(sessionId) {
  const rec = sessions.get(sessionId);
  if (!rec) return null;
  return {
    id:        rec.id,
    agentId:   rec.agentId,
    mode:      rec.mode,
    status:    rec.status,
    cwd:       rec.cwd,
    createdAt: rec.createdAt,
    eventCount: rec.events.length,
    pendingPermission: rec.pendingPermission
      ? { prompt: rec.pendingPermission.prompt, options: rec.pendingPermission.options }
      : null,
  };
}

// ── File system proxy ─────────────────────────────────────────────────────────

function safePath(cwd, relPath) {
  const abs = resolvePath(cwd, relPath);
  if (!abs.startsWith(cwd)) throw new Error('Path escape not allowed');
  return abs;
}

export function fsRead(sessionId, relPath) {
  const rec = sessions.get(sessionId);
  if (!rec) throw new Error('Session not found');
  const abs = safePath(rec.cwd, relPath);
  if (!existsSync(abs)) throw new Error(`File not found: ${relPath}`);
  const stat = statSync(abs);
  if (stat.isDirectory()) {
    return { type: 'directory', entries: readdirSync(abs).map(name => {
      const s = statSync(join(abs, name));
      return { name, type: s.isDirectory() ? 'dir' : 'file', size: s.size };
    })};
  }
  const content = readFileSync(abs, 'utf-8');
  return { type: 'file', path: relPath, size: stat.size, content };
}

export function fsWrite(sessionId, relPath, content) {
  const rec = sessions.get(sessionId);
  if (!rec) throw new Error('Session not found');
  const abs = safePath(rec.cwd, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
  pushEvent(sessionId, mkEvent('file_change', { path: relPath, action: 'write', size: content.length }, sessionId));
  return { ok: true, path: relPath };
}

export function fsDelete(sessionId, relPath) {
  const rec = sessions.get(sessionId);
  if (!rec) throw new Error('Session not found');
  const abs = safePath(rec.cwd, relPath);
  if (!existsSync(abs)) throw new Error(`Not found: ${relPath}`);
  unlinkSync(abs);
  pushEvent(sessionId, mkEvent('file_change', { path: relPath, action: 'delete' }, sessionId));
  return { ok: true };
}

export function fsList(sessionId, relPath = '.') {
  const rec = sessions.get(sessionId);
  if (!rec) throw new Error('Session not found');
  const abs = safePath(rec.cwd, relPath);
  if (!existsSync(abs)) return { entries: [] };
  return {
    path: relPath,
    entries: readdirSync(abs).map(name => {
      const s = statSync(join(abs, name));
      return { name, type: s.isDirectory() ? 'dir' : 'file', size: s.size, modified: s.mtimeMs };
    }),
  };
}

// ── Process execution ─────────────────────────────────────────────────────────

export async function execInSession(sessionId, command, req, res) {
  const rec = sessions.get(sessionId);
  if (!rec) { res.status(404).json({ error: 'Session not found' }); return; }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const cmdId = randomUUID();
  pushEvent(sessionId, mkEvent('command_start', { id: cmdId, command }, sessionId));
  res.write(`data: ${JSON.stringify({ type: 'start', id: cmdId, command })}\n\n`);

  const proc = spawn('sh', ['-c', command], {
    cwd: rec.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  proc.stdout.on('data', chunk => {
    const text = chunk.toString();
    const ev = mkEvent('command_delta', { id: cmdId, stream: 'stdout', text }, sessionId);
    pushEvent(sessionId, ev);
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'delta', stream: 'stdout', text })}\n\n`);
  });

  proc.stderr.on('data', chunk => {
    const text = chunk.toString();
    const ev = mkEvent('command_delta', { id: cmdId, stream: 'stderr', text }, sessionId);
    pushEvent(sessionId, ev);
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'delta', stream: 'stderr', text })}\n\n`);
  });

  proc.on('exit', code => {
    const ev = mkEvent('command_done', { id: cmdId, exitCode: code }, sessionId);
    pushEvent(sessionId, ev);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'done', exitCode: code })}\n\n`);
      res.end();
    }
  });

  proc.on('error', e => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
      res.end();
    }
  });

  req.on('close', () => { try { proc.kill(); } catch { /**/ } });
}

// ── Hub health ────────────────────────────────────────────────────────────────

export function hubHealth() {
  return {
    name:         'bKG Agent Hub',
    version:      '1.0.0',
    docs:         'https://github.com/soniaschuh88-ship-it/super-waddle',
    activeSessions: sessions.size,
    uptime:       process.uptime(),
    agents:       ['pi', 'claude-code', 'codex', 'opencode', 'amp'],
    features:     [
      'sessions', 'streaming', 'permissions', 'filesystem',
      'process-exec', 'persistence', 'universal-events',
    ],
  };
}
