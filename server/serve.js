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
import { writeFileSync, mkdirSync, existsSync, unlinkSync, readFileSync, statSync } from 'fs';
import { createHmac, randomBytes }   from 'crypto';
import { homedir }      from 'os';

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
  listAgents, createSession as hubCreateSession, sendMessage as hubSendMessage,
  streamSessionEvents, listSessionEvents, listSessions as hubListSessions,
  getSession as hubGetSession, destroySession as hubDestroySession,
  abortSession as hubAbortSession, replyPermission,
  fsRead, fsWrite, fsDelete, fsList, execInSession, hubHealth,
} from './bkg-hub.js';

import {
  flowHealth, listProjects, getProject, createProject, updateProject, archiveProject,
  listTasks, getTask, createTask, updateTask, deleteTask, moveTask, searchTasks,
  getComments, addComment, appendLog, getTaskLogs, subscribeTaskLogs,
  getWorkflowSteps, addWorkflowStep, updateWorkflowStep,
  addDependency, removeDependency,
  listMissions, getMission, createMission, updateMission,
  listMilestones, createMilestone,
  getActivity,
  listSecrets, setSecret, deleteSecret,
  getEvals, createEval,
  getBoardData, buildPlanningPrompt, savePlanMd,
  subscribeBoardEvents, checkAndIncrRateLimit, getFlowStats,
} from './bkg-flow.js';

import {
  GAME_GENRES, GAME_TONES, GAME_ENGINES,
  buildWorldPrompt, buildStoryPrompt, buildNPCsPrompt, buildQuestsPrompt,
  buildGamePlanPrompt, emptyGameDesign, assembleGamePromptMd,
} from './bkg-game.js';

import {
  createBlueprint, saveBlueprint, getBlueprint, listBlueprints,
  updateBlueprintSection, deleteBlueprint, blueprintStats,
  buildSectionPrompt, npcTemplate, monsterTemplate, questTemplate,
  itemTemplate, zoneTemplate, BLUEPRINT_DEFAULTS,
} from './bkg-game-blueprint.js';

import {
  VOXEL_TYPES, BIOMES, VOXEL_COLORS, voxel, chunkKey,
  VoxelWorld, createWorld, getWorld, listWorlds, deleteWorld,
  kernel as voxelKernel,
} from './bkg-voxel.js';

import {
  vldb, MAT, PALETTE,
  BitpackedChunk, rleEncode, rleDecode,
  worldToChunkCoords,
  CHUNK_SIZE, CHUNK_VOL, CHUNK_2BIT, CHUNK_4BIT,
  generateChunk, readDeltas, applyDeltas, compressionRatio,
} from './bkg-vldb.js';

import {
  PROVIDERS, getProvider, providersByTier, resolveProviderKey, fetchProviderModels,
} from './providers.js';

import {
  getUser, ensureUser, listUsers, createUser,
  getUserProviderKeys, setUserProviderKeys, markOnboarded,
  getGlobalProviderConfig, setGlobalProviderConfig, getGlobalProviderKeys,
  getUserProviderStatus, resolveKeyForUser,
} from './users.js';

import {
  peerRegistry, npcConsensus, proofChain,
  attachMMOWebSocket, chunkToZone, PEER_ROLE,
} from './bkg-p2p.js';

import {
  getLedger, makeVSLEvent, verifyEvent,
  reduce, mergeStates, listLedgers, vsStats,
  AUTHORITY_EPOCH,
} from './vsl-reducer.js';

import {
  getClusterManager, listManagers,
  npcShouldExist, npcPosition,
} from './cluster-manager.js';

import { ClusterRebalancer }    from './cluster-rebalancer.js';
import { interestManager, PRIORITY, PRIORITY_NAME, classifyEvent } from './interest-manager.js';
import { conflictResolver }     from './vsl-conflict-resolver.js';
import { bandwidthShaper, DeltaCompressor } from './bandwidth-shaper.js';
import { getTickSync, listTickSyncs, globalTickSyncStats } from './tick-sync.js';

import { ChaosRecoveryKernel, peerTrustScore, CHAOS } from './chaos-recovery.js';
import { getTimeline, listTimelines, speculativeStats } from './speculative-replay.js';
import { StateHealer, crc32, ledgerCRC, HEAL_LEVEL_NAME } from './state-healer.js';
import { ZoneStitcher, analyzeZoneConnectivity }         from './zone-stitcher.js';
import { renderPartition, assignTiles, GRID_COLS, GRID_ROWS, GPU_BUDGET } from './render-partition.js';
import { compositor }                                    from './compositing-serverless.js';
import { globalConsistency }                             from './global-consistency.js';
import { frameSmoother }                                 from './frame-smoother.js';
import { gpuTrust, GRADE }                               from './gpu-trust.js';
import { temporalCoherence }                             from './temporal-coherence.js';
import { cognitiveBalancer }                             from './cognitive-load-balancer.js';

const __dir  = dirname(fileURLToPath(import.meta.url));
const DIST   = resolve(__dir, process.env.DIST_DIR ?? '../dist');

const PORT        = parseInt(process.env.BKG_PORT    ?? process.env.PORT        ?? '4001', 10);
const HOST        = process.env.BKG_HOST              ?? process.env.HOST        ?? '0.0.0.0';
const LLAMA_PORT  = parseInt(process.env.BKG_LLAMA_PORT ?? process.env.LLAMA_PORT ?? '8001',  10);
const OLLAMA_PORT = parseInt(process.env.BKG_OLLAMA_PORT ?? process.env.OLLAMA_PORT ?? '11434', 10);
const JWT_SECRET  = process.env.BKG_JWT_SECRET        ?? randomBytes(32).toString('hex');

// ── First-run admin password ──────────────────────────────────────────────────

const BKG_DIR_ROOT = process.env.BKG_DIR ?? join(homedir(), '.bkg');
mkdirSync(BKG_DIR_ROOT, { recursive: true });

const ADMIN_ENV_FILE   = join(BKG_DIR_ROOT, 'admin.env');
const INSTALL_KEY_FILE = join(BKG_DIR_ROOT, 'install.key');  // plaintext, shown once

let ADMIN_HASH = process.env.BKG_ADMIN_PASSWORD_HASH ?? '';

// If no hash configured, generate one on first start
let _installKeyPlaintext = '';   // held in memory, served once via /admin/install-key

if (!ADMIN_HASH) {
  // Load from .bkg/admin.env if it was generated before
  if (existsSync(ADMIN_ENV_FILE)) {
    const envLines = readFileSync(ADMIN_ENV_FILE, 'utf-8').split('\n');
    for (const line of envLines) {
      if (line.startsWith('BKG_ADMIN_PASSWORD_HASH=')) {
        ADMIN_HASH = line.slice('BKG_ADMIN_PASSWORD_HASH='.length).trim();
      }
    }
  }

  // Still no hash → brand new install, generate a random password
  if (!ADMIN_HASH) {
    const { default: bcrypt } = await import('bcryptjs');
    // Generate memorable password: bkg_ + 12 random hex chars
    const finalPwd  = `bkg_${randomBytes(6).toString('hex')}`;
    ADMIN_HASH      = await bcrypt.hash(finalPwd, 12);

    // Persist hash
    writeFileSync(ADMIN_ENV_FILE, `BKG_ADMIN_PASSWORD_HASH=${ADMIN_HASH}\n`);
    // Store plaintext temporarily
    writeFileSync(INSTALL_KEY_FILE, finalPwd);
    _installKeyPlaintext = finalPwd;

    console.log('\n' + '═'.repeat(62));
    console.log('  bKG — FIRST RUN SETUP');
    console.log('═'.repeat(62));
    console.log('');
    console.log(`  Admin password:  ${finalPwd}`);
    console.log('');
    console.log(`  Also saved to:   ${INSTALL_KEY_FILE}`);
    console.log('');
    console.log('  Visit /admin in your browser and enter this password.');
    console.log('  Add it in the bKG Dashboard → "Set Admin Key" button.');
    console.log('═'.repeat(62) + '\n');
  } else if (existsSync(INSTALL_KEY_FILE)) {
    // Hash loaded from file — install key may still be pending display
    _installKeyPlaintext = readFileSync(INSTALL_KEY_FILE, 'utf-8').trim();
  }
}

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
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '8mb' }));

// A4 — Request ID tracing: every response gets X-Request-Id
app.use((_req, res, next) => {
  res.setHeader('X-Request-Id', randomBytes(8).toString('hex'));
  next();
});

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

/**
 * GET /admin/install-key — return the generated install key ONE TIME.
 * After reading, the plaintext file is deleted so it can't be fetched again.
 * Only works when no admin session is established yet (first-run scenario).
 */
app.get('/admin/install-key', (_req, res) => {
  if (!_installKeyPlaintext && !existsSync(INSTALL_KEY_FILE)) {
    return res.json({ key: null, message: 'No pending install key' });
  }

  const key = _installKeyPlaintext || readFileSync(INSTALL_KEY_FILE, 'utf-8').trim();

  // Deliver the key and delete the file — it's a one-time token
  try { if (existsSync(INSTALL_KEY_FILE)) unlinkSync(INSTALL_KEY_FILE); } catch { /**/ }
  _installKeyPlaintext = '';  // clear from memory too

  res.json({ key, firstRun: true });
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
app.post('/api-keys/self-register', (req, res) => {
  const ip = req.ip ?? 'unknown';

  // E7 — Persistent rate limit via SQLite (survives server restarts)
  const rl = checkAndIncrRateLimit(`selfReg:${ip}`);
  if (!rl.allowed) {
    return res.status(429).json({
      error: `Too many self-registrations. Try again in ${rl.resetIn ?? 60} minutes.`,
      code:  'RATE_LIMITED',
    });
  }

  const { name } = req.body ?? {};
  // Give self-registered users 'agent' scope so they can use both inference + agent routes
  const { key, stored } = createApiKey(name || 'user', 'agent');
  res.status(201).json({
    key,
    id:        stored.id,
    scope:     stored.scope,
    remaining: rl.remaining,
    warning:   'Store this key in your browser — it will not be shown again.',
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
//
// Protected: requires a valid API key (scope: agent or admin) OR admin JWT.
// Use POST /api-keys/self-register to get an inference key, or
// POST /api-keys (admin) to create one with scope 'agent'.

// inference scope = general user key from self-register; agent = explicit grant; admin = full access
const agentAuth = requireApiKey('inference', 'agent', 'admin');

/**
 * POST /agent/session
 * Start a new agent session.
 * Body: { cwd?, systemPrompt?, tools?, initialMessage? }
 */
app.post('/agent/session', agentAuth, async (req, res) => {
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
app.get('/agent/session/:id/events', agentAuth, (req, res) => {
  subscribeSSE(req.params.id, req, res);
});

/**
 * GET /agent/session/:id/poll?after=N
 * Long-poll alternative to SSE — returns new events since index N.
 */
app.get('/agent/session/:id/poll', agentAuth, (req, res) => {
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
app.post('/agent/session/:id/message', agentAuth, async (req, res) => {
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
app.post('/agent/session/:id/abort', agentAuth, (req, res) => {
  abortSession(req.params.id);
  res.json({ ok: true });
});

/**
 * DELETE /agent/session/:id
 * Dispose a session (cleans up memory).
 */
app.delete('/agent/session/:id', agentAuth, (req, res) => {
  disposeSession(req.params.id);
  res.json({ ok: true });
});

/**
 * GET /agent/sessions
 * List active sessions.
 */
app.get('/agent/sessions', agentAuth, (_req, res) => {
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

// ── /flow/* — bKG Flow (AI task & workflow management) ───────────────────────
//
// Rebraneded / refactored from the Fusion project management system.
// Full task lifecycle, kanban board, AI planning, missions, secrets, evals.

app.get('/flow/health', (_req, res) => res.json(flowHealth()));

// ── Projects ──────────────────────────────────────────────────────────────────

app.get('/flow/projects',        (_req, res) => res.json(listProjects()));
app.get('/flow/projects/:id',    (req, res) => {
  const p = getProject(req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'Project not found' });
});
app.post('/flow/projects',       (req, res) => {
  try { res.status(201).json(createProject(req.body ?? {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/flow/projects/:id',    (req, res) => res.json(updateProject(req.params.id, req.body ?? {})));
app.delete('/flow/projects/:id', (req, res) => { archiveProject(req.params.id); res.json({ ok: true }); });

// ── Board ─────────────────────────────────────────────────────────────────────

app.get('/flow/board/:projectId', (req, res) => res.json(getBoardData(req.params.projectId)));

/**
 * GET /flow/events?projectId=  — SSE stream of real-time board events (E1)
 *
 * Event types pushed to the browser:
 *   task.created  — new task in project
 *   task.updated  — status/title/priority changed
 *   task.deleted  — task removed
 *   board.reload  — client should re-fetch full board
 */
app.get('/flow/events', (req, res) => {
  const projectId = req.query.projectId ?? 'default';

  res.setHeader('Content-Type',        'text/event-stream');
  res.setHeader('Cache-Control',       'no-cache');
  res.setHeader('Connection',          'keep-alive');
  res.setHeader('X-Accel-Buffering',   'no');
  res.flushHeaders();

  // Send an initial snapshot event so the client knows the stream is live
  res.write(`event: connected\ndata: ${JSON.stringify({ projectId, ts: Date.now() })}\n\n`);

  // Subscribe to live board mutations
  const unsub = subscribeBoardEvents(projectId, (event) => {
    if (!res.writableEnded) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
  });

  // Heartbeat every 20 s to keep the connection alive through proxies
  const hb = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
    else clearInterval(hb);
  }, 20_000);

  req.on('close', () => {
    unsub();
    clearInterval(hb);
  });
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

app.get('/flow/tasks', (req, res) => {
  const pid = req.query.projectId ?? 'default';
  res.json(listTasks(pid, { status: req.query.status, missionId: req.query.missionId }));
});

app.get('/flow/tasks/search', (req, res) => {
  const pid = req.query.projectId ?? 'default';
  if (!req.query.q) return res.status(400).json({ error: 'q required' });
  res.json(searchTasks(pid, req.query.q));
});

app.post('/flow/tasks', (req, res) => {
  try { res.status(201).json(createTask(req.body ?? {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/flow/tasks/:id', (req, res) => {
  const t = getTask(req.params.id);
  t ? res.json(t) : res.status(404).json({ error: 'Task not found' });
});

app.put('/flow/tasks/:id', (req, res) => {
  const t = updateTask(req.params.id, req.body ?? {});
  t ? res.json(t) : res.status(404).json({ error: 'Task not found' });
});

app.delete('/flow/tasks/:id', (req, res) => {
  deleteTask(req.params.id)
    ? res.json({ ok: true })
    : res.status(404).json({ error: 'Task not found' });
});

/** POST /flow/tasks/:id/move — change status + reorder
 *  Body: { status: string, index?: number }
 */
app.post('/flow/tasks/:id/move', async (req, res) => {
  const { status, index } = req.body ?? {};
  if (!status) return res.status(400).json({ error: 'status required' });

  const updated = moveTask(req.params.id, status, index ?? null);
  if (!updated) return res.status(404).json({ error: 'Task not found' });

  // E4 — Create git branch when task starts (in-progress)
  if (status === 'in-progress') {
    const project = getProject(updated.project_id);
    const branchName = `flow/${updated.id}`;
    if (project?.path && existsSync(project.path)) {
      try {
        const { execSync } = await import('child_process');
        execSync(`git -C "${project.path}" checkout -b "${branchName}" 2>/dev/null || true`, { timeout: 5000 });
        appendLog(updated.id, `✓ Git branch created: ${branchName}`, 'info');
      } catch {
        appendLog(updated.id, `Git branch skipped (no git repo at project path)`, 'warn');
      }
    }
    // E17 — Mission autopilot: check if milestone is complete
    if (updated.milestone_id) {
      const remaining = listTasks(updated.project_id, { missionId: updated.mission_id })
        .filter(t => t.milestone_id === updated.milestone_id && !['done','archived'].includes(t.status));
      if (remaining.length === 0) {
        appendLog(updated.id, `🎉 Milestone complete!`, 'info');
      }
    }
  }

  // E17 — Mission autopilot on done
  if (status === 'done' && updated.milestone_id) {
    const remaining = listTasks(updated.project_id, { missionId: updated.mission_id })
      .filter(t => t.milestone_id === updated.milestone_id && !['done','archived'].includes(t.status));
    if (remaining.length === 0) {
      appendLog(updated.id, `🎉 All tasks in milestone done — milestone complete!`, 'info');
    }
  }

  res.json(updated);
});

// ── AI Task Planning ──────────────────────────────────────────────────────────

/**
 * POST /flow/tasks/:id/plan — generate PROMPT.md via AI
 *
 * Uses /providers/proxy (cloud mode) or local backends (private mode)
 * to generate a planning document for the task.
 */
app.post('/flow/tasks/:id/plan', async (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const project  = getProject(task.project_id);
  const { system, user } = buildPlanningPrompt(task, project);

  // Update task to planning status
  updateTask(task.id, { status: 'planning' });
  appendLog(task.id, 'AI planning started…', 'info');

  // Resolve provider + model for planning
  const providerId = req.body?.providerId ?? 'groq';
  const model      = req.body?.model ?? 'llama-3.3-70b-versatile';
  const keyId      = getCallerKeyId(req);
  const { key }    = resolveKeyForUser(providerId, keyId ?? '');

  if (!key) {
    appendLog(task.id, `No API key for ${providerId} — using simple template`, 'warn');
    const fallback = `# Task: ${task.title}\n\n## Objective\n${task.description || 'Implement the task as described.'}\n\n## Acceptance Criteria\n- [ ] Implementation complete\n- [ ] Tests pass\n- [ ] Code reviewed\n\n## Implementation Steps\n1. Analyse requirements\n2. Implement solution\n3. Write tests\n4. Review\n`;
    const updated = savePlanMd(task.id, fallback);
    return res.json(updated);
  }

  // Stream response and collect
  try {
    const { default: fetch } = await import('node-fetch').catch(() => ({ default: globalThis.fetch }));
    const p = getProvider(providerId);
    const headers = { 'Content-Type': 'application/json' };
    if (key !== 'anon') headers['Authorization'] = `Bearer ${key}`;

    const r = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        stream: false,
        max_tokens: 2048,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!r.ok) throw new Error(`Provider ${r.status}`);
    const d    = await r.json();
    const text = d.choices?.[0]?.message?.content ?? '';
    const updated = savePlanMd(task.id, text);
    appendLog(task.id, 'Planning complete ✓', 'info');
    res.json(updated);
  } catch (e) {
    appendLog(task.id, `Planning failed: ${e.message}`, 'error');
    updateTask(task.id, { status: 'todo' });
    res.status(500).json({ error: e.message });
  }
});

// ── Task Logs (SSE) ───────────────────────────────────────────────────────────

app.get('/flow/tasks/:id/logs', (req, res) => {
  const taskId = req.params.id;
  const since  = parseInt(req.query.since ?? '0', 10);

  if (req.headers.accept === 'text/event-stream') {
    // SSE streaming
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    // Send existing logs
    for (const log of getTaskLogs(taskId, since)) {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    }

    const unsub = subscribeTaskLogs(taskId, log => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(log)}\n\n`);
    });

    const hb = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); else clearInterval(hb); }, 15000);
    req.on('close', () => { unsub(); clearInterval(hb); });
  } else {
    res.json(getTaskLogs(taskId, since));
  }
});

// ── Task comments ─────────────────────────────────────────────────────────────

app.get('/flow/tasks/:id/comments',  (req, res) => res.json(getComments(req.params.id)));
app.post('/flow/tasks/:id/comments', (req, res) => {
  const { body, author } = req.body ?? {};
  if (!body) return res.status(400).json({ error: 'body required' });
  res.status(201).json(addComment(req.params.id, body, author ?? 'user'));
});

// ── Workflow steps ────────────────────────────────────────────────────────────

app.get('/flow/tasks/:id/steps', (req, res) => res.json(getWorkflowSteps(req.params.id)));
app.post('/flow/tasks/:id/steps', (req, res) => {
  try { res.status(201).json(addWorkflowStep(req.params.id, req.body ?? {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/flow/steps/:id', (req, res) => res.json(updateWorkflowStep(req.params.id, req.body ?? {})));

// ── Dependencies ──────────────────────────────────────────────────────────────

app.post('/flow/tasks/:id/deps',   (req, res) => {
  const { depId } = req.body ?? {};
  if (!depId) return res.status(400).json({ error: 'depId required' });
  res.json(addDependency(req.params.id, depId));
});
app.delete('/flow/tasks/:id/deps/:depId', (req, res) =>
  res.json(removeDependency(req.params.id, req.params.depId)),
);

// ── Missions ──────────────────────────────────────────────────────────────────

app.get('/flow/missions',       (req, res) => res.json(listMissions(req.query.projectId ?? 'default')));
app.post('/flow/missions',      (req, res) => {
  try { res.status(201).json(createMission(req.body ?? {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/flow/missions/:id',   (req, res) => {
  const m = getMission(req.params.id);
  m ? res.json(m) : res.status(404).json({ error: 'Mission not found' });
});
app.put('/flow/missions/:id',   (req, res) => res.json(updateMission(req.params.id, req.body ?? {})));

app.get('/flow/missions/:id/milestones', (req, res) => res.json(listMilestones(req.params.id)));
app.post('/flow/missions/:id/milestones', (req, res) => {
  try { res.status(201).json(createMilestone({ ...req.body, missionId: req.params.id })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Activity ──────────────────────────────────────────────────────────────────

app.get('/flow/activity', (req, res) =>
  res.json(getActivity(req.query.projectId ?? 'default', parseInt(req.query.limit ?? '50', 10))),
);

/**
 * GET /flow/stats — task throughput by status for today/period (E5)
 * Query: ?projectId=&since=<timestamp>
 * Returns: { [status]: count } map of tasks moved TO that status since `since`
 */
app.get('/flow/stats', (req, res) => {
  const projectId = req.query.projectId ?? 'default';
  const since     = parseInt(req.query.since ?? String(Date.now() - 86400000), 10);
  const stats = getFlowStats(projectId, since);
  res.json(stats);
});

// ── Secrets ───────────────────────────────────────────────────────────────────

app.get('/flow/secrets', (req, res) => res.json(listSecrets(req.query.projectId ?? 'default')));
app.post('/flow/secrets', (req, res) => {
  const { projectId = 'default', name, value, policy } = req.body ?? {};
  if (!name || !value) return res.status(400).json({ error: 'name and value required' });
  res.json(setSecret(projectId, name, value, policy));
});
app.delete('/flow/secrets/:name', (req, res) =>
  res.json(deleteSecret(req.query.projectId ?? 'default', req.params.name)),
);

// ── Evaluations ───────────────────────────────────────────────────────────────

app.get('/flow/tasks/:id/evals',  (req, res) => res.json(getEvals(req.params.id)));
app.post('/flow/tasks/:id/evals', (req, res) => {
  const { score, evidence } = req.body ?? {};
  if (score === undefined) return res.status(400).json({ error: 'score required' });
  res.status(201).json(createEval(req.params.id, parseFloat(score), evidence ?? {}));
});

// ── E6: Provider health check ─────────────────────────────────────────────────

/**
 * POST /providers/:id/test — send a 1-token request to verify the key works.
 * Returns { ok, status, latencyMs, model }
 */
app.post('/providers/:id/test', async (req, res) => {
  const providerId = req.params.id;
  const p = getProvider(providerId);
  if (!p) return res.status(404).json({ error: 'Unknown provider' });

  const keyId      = getCallerKeyId(req);
  const { key }    = resolveKeyForUser(providerId, keyId ?? '');

  if (!key) return res.status(403).json({ error: 'No API key configured for this provider' });

  const model   = req.body?.model ?? Object.keys({ groq:'llama-3.1-8b-instant', nvidia:'meta/llama-3.1-8b-instruct', openrouter:'meta-llama/llama-3.2-1b-instruct:free', mistral:'open-mistral-7b', sambanova:'Meta-Llama-3.1-8B-Instruct', cerebras:'llama3.1-8b', default:'default' })[0];
  const testModel = {
    groq:'llama-3.1-8b-instant', nvidia:'meta/llama-3.1-8b-instruct',
    openrouter:'meta-llama/llama-3.2-1b-instruct:free', mistral:'open-mistral-7b',
    sambanova:'Meta-Llama-3.1-8B-Instruct', cerebras:'llama3.1-8b',
    xai:'grok-3-mini', huggingface:'Qwen/Qwen2.5-0.5B-Instruct',
    llm7:'default', kilo:'kilo-mini',
  }[providerId] ?? model;

  const start = Date.now();
  try {
    const { default: fetch } = await import('node-fetch').catch(() => ({ default: globalThis.fetch }));
    const headers = { 'Content-Type': 'application/json' };
    if (key !== 'anon') headers['Authorization'] = `Bearer ${key}`;

    const r = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: testModel, messages:[{ role:'user', content:'Reply with one word: OK' }], max_tokens: 5 }),
      signal: AbortSignal.timeout(10000),
    });
    const latencyMs = Date.now() - start;
    if (r.ok) {
      const d = await r.json();
      res.json({ ok: true, status: r.status, latencyMs, model: testModel, reply: d.choices?.[0]?.message?.content ?? '' });
    } else {
      const txt = await r.text().catch(() => `${r.status}`);
      res.json({ ok: false, status: r.status, latencyMs, error: txt.slice(0, 200) });
    }
  } catch (e) {
    res.json({ ok: false, status: 0, latencyMs: Date.now() - start, error: e.message });
  }
});

// ── E14: Flow export ──────────────────────────────────────────────────────────

/**
 * GET /flow/export/:projectId — export all tasks as Markdown or CSV
 * Query: ?format=md|csv  (default: md)
 */
app.get('/flow/export/:projectId', (req, res) => {
  const projectId = req.params.projectId;
  const format    = req.query.format === 'csv' ? 'csv' : 'md';
  const project   = getProject(projectId);
  const tasks     = listTasks(projectId, { archived: true });

  if (format === 'csv') {
    const header = 'id,title,status,priority,labels,created_at,done_at\n';
    const rows   = tasks.map(t =>
      [t.id, `"${t.title.replace(/"/g,'""')}"`, t.status, t.priority,
       `"${(t.labels ?? []).join(';')}"`,
       new Date(t.created_at).toISOString(),
       t.done_at ? new Date(t.done_at).toISOString() : ''].join(','),
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="bkg-flow-${projectId}.csv"`);
    return res.send(header + rows);
  }

  // Markdown export
  const COLS = ['planning','todo','in-progress','review','done','archived'];
  const STATUS_ICON = { planning:'🔮', todo:'📋', 'in-progress':'⚡', review:'🔍', done:'✅', archived:'📦' };
  const grouped = {};
  for (const col of COLS) grouped[col] = tasks.filter(t => t.status === col);

  let md = `# ${project?.name ?? projectId} — Task Export\n\n`;
  md += `> Exported ${new Date().toISOString().slice(0,10)} · ${tasks.length} tasks\n\n`;

  for (const col of COLS) {
    const list = grouped[col];
    if (!list.length) continue;
    md += `## ${STATUS_ICON[col] ?? '•'} ${col.charAt(0).toUpperCase() + col.slice(1)} (${list.length})\n\n`;
    for (const t of list) {
      const prefix = t.status === 'done' ? '[x]' : t.status === 'in-progress' ? '[~]' : '[ ]';
      md += `- ${prefix} **${t.title}**`;
      if (t.description) md += ` — ${t.description.slice(0, 80)}`;
      if (t.labels?.length) md += ` \`${t.labels.join('` `')}\``;
      md += `\n`;
    }
    md += '\n';
  }

  res.setHeader('Content-Type', 'text/markdown');
  res.setHeader('Content-Disposition', `attachment; filename="bkg-flow-${projectId}.md"`);
  res.send(md);
});

// ── E18: Webhook trigger ──────────────────────────────────────────────────────

/**
 * POST /flow/webhook/:projectId — create a task from an incoming webhook.
 * Accepts GitHub issue format, Jira, or custom { title, description, labels }.
 * Query: ?secret=  (optional shared secret)
 */
app.post('/flow/webhook/:projectId', (req, res) => {
  const { projectId } = req.params;
  const body = req.body ?? {};

  // Support GitHub issue format
  const title       = body.title ?? body.issue?.title ?? body.summary ?? 'Webhook Task';
  const description = body.description ?? body.body ?? body.issue?.body ?? '';
  const labels      = body.labels
    ? (Array.isArray(body.labels) ? body.labels.map((l) => typeof l === 'string' ? l : l.name ?? '') : [body.labels])
    : [];

  try {
    const task = createTask({ title, description, status: 'todo', projectId, labels, metadata: { source: 'webhook', payload: body } });
    appendLog(task.id, `Created via webhook`, 'info');
    res.status(201).json({ id: task.id, title: task.title, status: task.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── E15: Install agent ────────────────────────────────────────────────────────

/**
 * POST /hub/agents/:id/install — install a missing coding agent via npm
 * Body: optional { global: boolean }
 * Streams installation output as SSE.
 */
app.post('/hub/agents/:id/install', (req, res) => {
  const INSTALL_CMDS = {
    'claude-code': ['npm', 'install', '-g', '@anthropic-ai/claude-code'],
    'codex':       ['npm', 'install', '-g', '@openai/codex'],
    'opencode':    ['npm', 'install', '-g', 'opencode-ai'],
    'amp':         ['npm', 'install', '-g', '@sourcegraph/amp'],
  };

  const agentId = req.params.id;
  const cmd     = INSTALL_CMDS[agentId];
  if (!cmd) return res.status(404).json({ error: `No install command for agent: ${agentId}` });

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  send('start', { agentId, cmd: cmd.join(' ') });

  const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore','pipe','pipe'] });

  child.stdout.on('data', d => send('stdout', { text: d.toString() }));
  child.stderr.on('data', d => send('stderr', { text: d.toString() }));
  child.on('exit', code => {
    send('done', { exitCode: code, success: code === 0 });
    res.end();
  });
  child.on('error', e => { send('error', { message: e.message }); res.end(); });
  req.on('close', () => { try { child.kill(); } catch { /**/ } });
});

// ── /game/* — bKG Game Creation System ──────────────────────────────────────

/** GET /game/config — genres, tones, engines */
app.get('/game/config', (_req, res) => {
  res.json({ genres: GAME_GENRES, tones: GAME_TONES, engines: GAME_ENGINES });
});

/** GET /game/empty — empty game design document */
app.get('/game/empty', (_req, res) => res.json(emptyGameDesign()));

/**
 * Helper: call AI proxy and return generated text.
 * Used by all game design generation endpoints.
 */
async function callAI(systemPrompt, userPrompt, req) {
  const providerId = req.body?.providerId ?? 'groq';
  const model      = req.body?.model ?? 'llama-3.3-70b-versatile';
  const keyId      = getCallerKeyId(req);
  const { key }    = resolveKeyForUser(providerId, keyId ?? '');

  if (!key) {
    // Return a minimal template if no provider key
    return `# Generated Document\n\n*No AI provider configured. Configure a provider in Settings to generate rich content.*\n\n${userPrompt}`;
  }

  const fetch  = (await import('node-fetch')).default;
  const p      = getProvider(providerId);
  if (!p) throw new Error(`Unknown provider: ${providerId}`);

  const headers = { 'Content-Type': 'application/json' };
  if (key !== 'anon') headers['Authorization'] = `Bearer ${key}`;

  let res;
  for (let attempt = 0; attempt <= 2; attempt++) {
    res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        stream:     false,
        max_tokens: 3000,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (res.status !== 429 || attempt === 2) break;
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '2', 10);
    await new Promise(r => setTimeout(r, Math.min(retryAfter, 10) * 1000));
  }

  if (!res.ok) throw new Error(`Provider ${res.status}`);
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? '';
}

/** POST /game/generate/world — generate WORLD.md from world design data */
app.post('/game/generate/world', async (req, res) => {
  try {
    const { system, user } = buildWorldPrompt(req.body ?? {});
    const text = await callAI(system, user, req);
    res.json({ doc: text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** POST /game/generate/story — generate STORY.md */
app.post('/game/generate/story', async (req, res) => {
  try {
    const { system, user } = buildStoryPrompt(req.body?.story ?? {}, req.body?.world ?? {});
    const text = await callAI(system, user, req);
    res.json({ doc: text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** POST /game/generate/npcs — generate NPCS.md */
app.post('/game/generate/npcs', async (req, res) => {
  try {
    const { system, user } = buildNPCsPrompt(req.body?.npcs ?? {}, req.body?.world ?? {}, req.body?.story ?? {});
    const text = await callAI(system, user, req);
    res.json({ doc: text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** POST /game/generate/quests — generate QUESTS.md */
app.post('/game/generate/quests', async (req, res) => {
  try {
    const { system, user } = buildQuestsPrompt(req.body?.quests ?? {}, req.body?.world ?? {}, req.body?.story ?? {});
    const text = await callAI(system, user, req);
    res.json({ doc: text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** POST /game/generate/gameplan — generate full GAMEPLAN.md + PROMPT.md */
app.post('/game/generate/gameplan', async (req, res) => {
  try {
    const { system, user } = buildGamePlanPrompt(req.body ?? {});
    const text = await callAI(system, user, req);
    res.json({ doc: text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /game/create-task — assemble all game docs into a Flow task
 * Body: { design: GameDesign, projectId?: string }
 * Returns the created task with prompt_md containing all game documents.
 */
app.post('/game/create-task', (req, res) => {
  try {
    const { design, projectId = 'default' } = req.body ?? {};
    if (!design) return res.status(400).json({ error: 'design required' });

    const promptMd = assembleGamePromptMd(design);
    const task     = createTask({
      title:       `🎮 ${design.world?.title || 'Untitled Game'}`,
      description: `${design.world?.genre || 'Game'} · ${design.world?.tone || ''} · ${design.engine?.label || 'Godot 4'}`,
      status:      'todo',
      projectId,
      promptMd,
      labels:      ['game', design.world?.genre || 'rpg', design.engine?.id || 'godot4'],
      metadata:    { gameDesign: design, mode: 'game' },
    });

    // Write all game docs to task logs for reference
    appendLog(task.id, `Game project created: ${task.title}`, 'info');
    appendLog(task.id, `Engine: ${design.engine?.label || 'Godot 4'} · Genre: ${design.world?.genre || 'rpg'}`, 'info');
    if (design.docs?.world)   appendLog(task.id, 'WORLD.md generated', 'info');
    if (design.docs?.story)   appendLog(task.id, 'STORY.md generated', 'info');
    if (design.docs?.npcs)    appendLog(task.id, 'NPCS.md generated',  'info');
    if (design.docs?.quests)  appendLog(task.id, 'QUESTS.md generated','info');

    res.status(201).json(task);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── /game/blueprint/* — Blueprint CRUD + AI generation ────────────────────────

app.get('/game/blueprint/list', (req, res) => {
  res.json({ blueprints: listBlueprints(req.query.mode?.toString() ?? null) });
});

app.post('/game/blueprint/create', (req, res) => {
  res.json(createBlueprint(req.body ?? {}));
});

app.get('/game/blueprint/templates', (_req, res) => {
  res.json({ npc:npcTemplate(), monster:monsterTemplate(), quest:questTemplate(), item:itemTemplate(), zone:zoneTemplate(), defaults:BLUEPRINT_DEFAULTS });
});

app.get('/game/blueprint/:id', (req, res) => {
  const bp = getBlueprint(req.params.id);
  if (!bp) return res.status(404).json({ error:'Blueprint not found' });
  res.json(bp);
});

app.get('/game/blueprint/:id/stats', (req, res) => {
  const bp = getBlueprint(req.params.id);
  if (!bp) return res.status(404).json({ error:'Blueprint not found' });
  res.json(blueprintStats(bp));
});

app.put('/game/blueprint/:id', (req, res) => {
  const bp = getBlueprint(req.params.id);
  if (!bp) return res.status(404).json({ error:'Blueprint not found' });
  res.json(saveBlueprint({ ...bp, ...(req.body??{}), id:bp.id }));
});

app.patch('/game/blueprint/:id/section/:section', (req, res) => {
  try { res.json(updateBlueprintSection(req.params.id, req.params.section, req.body)); }
  catch (e) { res.status(400).json({ error:e.message }); }
});

app.delete('/game/blueprint/:id', (req, res) => res.json(deleteBlueprint(req.params.id)));

/**
 * POST /game/blueprint/:id/generate/:section — stream AI generation via SSE
 */
app.post('/game/blueprint/:id/generate/:section', async (req, res) => {
  const bp = getBlueprint(req.params.id);
  if (!bp) return res.status(404).json({ error:'Blueprint not found' });

  const section = req.params.section;
  const prompt  = buildSectionPrompt(section, { ...bp, ...(req.body?.overrides ?? {}) });

  // Resolve API key: user key → global NVIDIA → global OpenRouter
  const userKey   = req.headers.authorization?.replace('Bearer ','').trim();
  const userProfile = userKey ? getUserProfile(userKey) : null;
  const nvidiaKey = userProfile?.providers?.nvidia_api_key
    || getGlobalProviderConfig().providerKeys?.nvidia_api_key
    || process.env.NVIDIA_API_KEY || '';
  const orKey     = userProfile?.providers?.openrouter_api_key
    || getGlobalProviderConfig().providerKeys?.openrouter_api_key
    || process.env.OPENROUTER_API_KEY || '';
  const apiKey    = nvidiaKey || orKey;

  if (!apiKey) {
    return res.status(503).json({ error:'No AI API key. Add NVIDIA or OpenRouter key in Admin → Global Providers.' });
  }

  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('X-Accel-Buffering','no');
  const send = (t,d) => res.write(`data: ${JSON.stringify({type:t,data:d})}\n\n`);

  const isNvidia = apiKey.startsWith('nvapi-');
  const endpoint = isNvidia
    ? 'https://integrate.api.nvidia.com/v1/chat/completions'
    : 'https://openrouter.ai/api/v1/chat/completions';
  const model    = isNvidia ? 'meta/llama-4-scout-17b-16e-instruct' : 'meta-llama/llama-3.1-8b-instruct:free';

  try {
    const resp = await fetch(endpoint, {
      method:'POST',
      headers:{ Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ model, stream:true, max_tokens: section==='gameplan'?4096:3000, temperature:0.85,
        messages:[{ role:'system', content:prompt.system },{ role:'user', content:prompt.user }] }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) { send('error',{ message:`AI ${resp.status}: ${(await resp.text()).slice(0,200)}` }); return res.end(); }

    let full='', buf='';
    const reader = resp.body.getReader(), dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value,{ stream:true });
      const lines = buf.split('\n'); buf = lines.pop()??'';
      for (const ln of lines) {
        if (!ln.startsWith('data:')) continue;
        const raw = ln.slice(5).trim(); if (raw==='[DONE]') continue;
        try {
          const tok = JSON.parse(raw).choices?.[0]?.delta?.content ?? '';
          if (tok) { full+=tok; send('chunk',{ token:tok }); }
        } catch { /**/ }
      }
    }

    // Parse structured sections
    let parsed = full;
    if (['npcs','monsters','quests','zones'].includes(section)) {
      try { const m=full.match(/\[[\s\S]*\]/); if(m) parsed=JSON.parse(m[0]); } catch{/**/ }
    } else if (['loot','levels'].includes(section)) {
      try { const m=full.match(/\{[\s\S]*\}/); if(m) { const p=JSON.parse(m[0]); parsed={...bp[section],...p}; } } catch{/**/ }
    }

    // Persist
    const fresh = getBlueprint(req.params.id);
    if (fresh) {
      fresh.docs[section] = full;
      if (!fresh.generatedSections.includes(section)) fresh.generatedSections.push(section);
      if (Array.isArray(parsed) && parsed.length) fresh[section]=parsed;
      else if (['loot','levels'].includes(section) && typeof parsed==='object') fresh[section]=parsed;
      saveBlueprint(fresh);
    }

    send('done',{ fullText:full, section, parsedData:parsed }); res.end();
  } catch(e) { send('error',{ message:e.message }); res.end(); }
});

// ── /game/mmo/worlds — public MMO lobby ───────────────────────────────────────

app.get('/game/mmo/worlds', (_req, res) => {
  const worlds = listBlueprints('mmo').filter(b => b.status==='published');
  res.json({ worlds });
});

app.post('/game/mmo/publish/:id', (req, res) => {
  if (!requireAdminSession(req,res)) return;
  const bp = getBlueprint(req.params.id);
  if (!bp) return res.status(404).json({ error:'Blueprint not found' });
  bp.status='published'; bp.publishedAt=Date.now(); saveBlueprint(bp);
  res.json({ ok:true, blueprint:bp });
});

app.post('/game/mmo/unpublish/:id', (req, res) => {
  if (!requireAdminSession(req,res)) return;
  const bp = getBlueprint(req.params.id);
  if (!bp) return res.status(404).json({ error:'Blueprint not found' });
  bp.status='complete'; saveBlueprint(bp);
  res.json({ ok:true });
});

// ── /voxel/* — bKG Voxel Engine ──────────────────────────────────────────────
//
// Node.js-controlled voxel simulation engine.
// WASM-ready memory layout (hot-swap with AssemblyScript/C/Zig WASM module).
// Integrates with Flow (tasks→regions) and Agent Hub (agent→mutations).

/** GET /voxel/config — type registry, biome defs, color palette */
app.get('/voxel/config', (_req, res) => {
  res.json({
    types:    VOXEL_TYPES,
    biomes:   BIOMES,
    colors:   VOXEL_COLORS,
    kernel:   { isWASM: voxelKernel.isWASM, mode: voxelKernel.isWASM ? 'wasm' : 'js' },
  });
});

/** GET /voxel/worlds — list all worlds */
app.get('/voxel/worlds', (_req, res) => res.json(listWorlds()));

/** POST /voxel/worlds — create a new world */
app.post('/voxel/worlds', (req, res) => {
  try {
    const world = createWorld(req.body ?? {});
    res.status(201).json(world.getWorldInfo());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** GET /voxel/worlds/:id — world info */
app.get('/voxel/worlds/:id', (req, res) => {
  const w = getWorld(req.params.id);
  w ? res.json(w.getWorldInfo()) : res.status(404).json({ error: 'World not found' });
});

/** DELETE /voxel/worlds/:id — delete world */
app.delete('/voxel/worlds/:id', (req, res) => {
  deleteWorld(req.params.id);
  res.json({ ok: true });
});

/** POST /voxel/worlds/:id/save — persist all dirty chunks */
app.post('/voxel/worlds/:id/save', (req, res) => {
  const w = getWorld(req.params.id);
  if (!w) return res.status(404).json({ error: 'World not found' });
  res.json(w.saveAll());
});

/** POST /voxel/worlds/:id/tick — advance simulation */
app.post('/voxel/worlds/:id/tick', (req, res) => {
  const w = getWorld(req.params.id);
  if (!w) return res.status(404).json({ error: 'World not found' });
  const ticks = parseInt(req.body?.ticks ?? '1', 10);
  const tick  = voxelKernel.tick(w, Math.min(ticks, 100));
  res.json({ tick, worldId: req.params.id });
});

/** GET /voxel/worlds/:id/chunk — get chunk data as JSON */
app.get('/voxel/worlds/:id/chunk', (req, res) => {
  const w = getWorld(req.params.id);
  if (!w) return res.status(404).json({ error: 'World not found' });
  const cx = parseInt(req.query.cx ?? '0', 10);
  const cy = parseInt(req.query.cy ?? '0', 10);
  const cz = parseInt(req.query.cz ?? '0', 10);
  res.json(w.chunkToJSON(cx, cy, cz));
});

/** GET /voxel/worlds/:id/chunk/binary — get chunk as raw binary */
app.get('/voxel/worlds/:id/chunk/binary', (req, res) => {
  const w = getWorld(req.params.id);
  if (!w) return res.status(404).json({ error: 'World not found' });
  const cx = parseInt(req.query.cx ?? '0', 10);
  const cy = parseInt(req.query.cy ?? '0', 10);
  const cz = parseInt(req.query.cz ?? '0', 10);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(w.chunkToBinary(cx, cy, cz));
});

/** POST /voxel/worlds/:id/voxel — set a single voxel */
app.post('/voxel/worlds/:id/voxel', (req, res) => {
  const w = getWorld(req.params.id);
  if (!w) return res.status(404).json({ error: 'World not found' });
  const { wx, wy, wz, type, state = 0, metaA = 0, metaB = 0, source = 'api' } = req.body ?? {};
  if (wx === undefined) return res.status(400).json({ error: 'wx,wy,wz required' });
  const v   = voxel.pack(type ?? 1, state, metaA, metaB);
  const old = w.setVoxel(wx, wy, wz, v, source);
  res.json({ ok: true, wx, wy, wz, v, old });
});

/** PUT /voxel/worlds/:id/region — fill a region with a voxel type */
app.put('/voxel/worlds/:id/region', (req, res) => {
  const w = getWorld(req.params.id);
  if (!w) return res.status(404).json({ error: 'World not found' });
  const { x1, y1, z1, x2, y2, z2, type, state = 0, metaA = 0, source = 'api' } = req.body ?? {};
  let count = 0;
  for (let y = Math.min(y1,y2); y <= Math.max(y1,y2); y++) {
    for (let z = Math.min(z1,z2); z <= Math.max(z1,z2); z++) {
      for (let x = Math.min(x1,x2); x <= Math.max(x1,x2); x++) {
        w.setVoxel(x, y, z, voxel.pack(type, state, metaA, 0), source);
        count++;
      }
    }
  }
  res.json({ ok: true, count });
});

/** POST /voxel/worlds/:id/entity — spawn an entity */
app.post('/voxel/worlds/:id/entity', (req, res) => {
  const w = getWorld(req.params.id);
  if (!w) return res.status(404).json({ error: 'World not found' });
  const { type, x, y, z, data } = req.body ?? {};
  res.status(201).json(w.spawnEntity(type ?? 'npc', x ?? 0, y ?? 0, z ?? 0, data ?? {}));
});

/** GET /voxel/worlds/:id/entities — list all entities */
app.get('/voxel/worlds/:id/entities', (req, res) => {
  const w = getWorld(req.params.id);
  if (!w) return res.status(404).json({ error: 'World not found' });
  res.json([...w.entities.values()]);
});

/** GET /voxel/worlds/:id/events — SSE real-time event stream (E3) */
app.get('/voxel/worlds/:id/events', (req, res) => {
  const w = getWorld(req.params.id);
  if (!w) return res.status(404).json({ error: 'World not found' });

  res.setHeader('Content-Type',        'text/event-stream');
  res.setHeader('Cache-Control',       'no-cache');
  res.setHeader('X-Accel-Buffering',   'no');
  res.flushHeaders();

  // Replay recent events
  const since = parseInt(req.query.since ?? '0', 10);
  for (const evt of w.getEvents(since, 50)) {
    res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
  }

  const unsub = w.subscribe(evt => {
    if (!res.writableEnded) res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
  });

  const hb = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
    else clearInterval(hb);
  }, 20_000);

  req.on('close', () => { unsub(); clearInterval(hb); });
});

/** POST /voxel/worlds/:id/prompt — compile PROMPT.md into world rules (B3) */
app.post('/voxel/worlds/:id/prompt', (req, res) => {
  const w = getWorld(req.params.id);
  if (!w) return res.status(404).json({ error: 'World not found' });
  const { promptMd } = req.body ?? {};
  if (!promptMd) return res.status(400).json({ error: 'promptMd required' });
  const rules = w.compilePrompt(promptMd);
  res.json({ ok: true, rules, worldName: w.name });
});

/** POST /voxel/worlds/:id/task-region — map a Flow task to a voxel region (B1) */
app.post('/voxel/worlds/:id/task-region', (req, res) => {
  const w = getWorld(req.params.id);
  if (!w) return res.status(404).json({ error: 'World not found' });
  const { taskId, cx, cy, cz, radius } = req.body ?? {};
  if (!taskId) return res.status(400).json({ error: 'taskId required' });
  const region = w.assignTaskRegion(taskId, { cx, cy, cz, radius });
  res.status(201).json({ taskId, ...region, worldId: req.params.id });
});

/** PUT /voxel/worlds/:id/task-region/:taskId/status — update task status in world */
app.put('/voxel/worlds/:id/task-region/:taskId/status', (req, res) => {
  const w = getWorld(req.params.id);
  if (!w) return res.status(404).json({ error: 'World not found' });
  w.updateTaskStatus(req.params.taskId, req.body?.status ?? 'todo');
  res.json({ ok: true });
});

/** POST /voxel/worlds/:id/agent-mutate — agent-driven voxel mutation (B2) */
app.post('/voxel/worlds/:id/agent-mutate', (req, res) => {
  const w = getWorld(req.params.id);
  if (!w) return res.status(404).json({ error: 'World not found' });

  const { sessionId, mutations } = req.body ?? {};
  if (!Array.isArray(mutations)) return res.status(400).json({ error: 'mutations array required' });

  let count = 0;
  for (const m of mutations.slice(0, 1000)) {  // cap at 1000 per call
    if (m.type === 'voxel.set') {
      w.setVoxel(m.wx, m.wy, m.wz,
        voxel.pack(m.voxelType ?? 1, m.state ?? 0, m.metaA ?? 0, m.metaB ?? 0),
        `agent:${sessionId ?? 'unknown'}`);
      count++;
    } else if (m.type === 'entity.spawn') {
      w.spawnEntity(m.entityType, m.x, m.y, m.z, m.data ?? {});
      count++;
    }
  }

  res.json({ ok: true, mutations: count, tick: w.tick });
});

/** GET /voxel/worlds/:id/events/log — full event log (paginated) */
app.get('/voxel/worlds/:id/events/log', (req, res) => {
  const w = getWorld(req.params.id);
  if (!w) return res.status(404).json({ error: 'World not found' });
  const since = parseInt(req.query.since ?? '0', 10);
  const limit  = parseInt(req.query.limit ?? '100', 10);
  res.json(w.getEvents(since, limit));
});

// ── /mmo/* — Distributed Voxel Consensus Engine (VSL + P2P) ──────────────────

/** GET /mmo/stats — global cluster + peer stats */
app.get('/mmo/stats', (_req, res) => {
  res.json(defaultMgr.stats());
});

/** GET /mmo/zones — list active zone clusters */
app.get('/mmo/zones', (_req, res) => {
  res.json(defaultMgr.listClusters().map(c => ({
    zoneId:    c.zoneId,
    peerCount: c.peerCount,
    authority: c.authority,
    stateHash: (c.ledger?.stateHash ?? '').slice(0, 16),
    npcs:      c.npcs ?? 0,
    active:    c.active,
    metrics:   c.metrics,
  })));
});

/** GET /mmo/peers — all registered peers */
app.get('/mmo/peers', (_req, res) => {
  res.json([...peerRegistry.peers.values()].map(p => ({
    id:          p.id,
    role:        p.role,
    gpuTier:     p.gpuTier,
    zoneId:      p.zoneId,
    computeFarm: p.computeFarm,
    joinedAt:    p.joinedAt,
    latency:     p.lat,
  })));
});

/** POST /mmo/join — REST-based peer join (WS alternative) */
app.post('/mmo/join', (req, res) => {
  const { gpuTier=0, lat=999, bw=1, cx=0, cy=0, cz=0, farm=false } = req.body ?? {};
  const result = peerRegistry.join({ gpuTier, lat, bw, cx, cy, cz });
  if (farm) peerRegistry.activateComputeFarm(result.peerId);
  const cluster = defaultMgr.getCluster(result.zoneId);
  res.status(201).json({ ...result, clusterState: cluster.snapshot() });
});

/** DELETE /mmo/peers/:id — leave */
app.delete('/mmo/peers/:id', (req, res) => {
  peerRegistry.leave(req.params.id);
  res.json({ ok: true });
});

/** PUT /mmo/peers/:id/position — update peer chunk position */
app.put('/mmo/peers/:id/position', (req, res) => {
  const { cx=0, cy=0, cz=0 } = req.body ?? {};
  peerRegistry.updatePosition(req.params.id, +cx, +cy, +cz);
  res.json({ ok: true, zoneId: chunkToZone(+cx, +cy, +cz) });
});

/**
 * POST /mmo/event — ingest a VSL event (from client or agent)
 * Body: { worldId?, tick, chunkId, op, lx, ly, lz, value, actor }
 */
app.post('/mmo/event', (req, res) => {
  const { worldId = 'default', ...evt } = req.body ?? {};

  // Build + verify event
  const event = makeVSLEvent(
    evt.tick ?? 0, evt.chunkId ?? '0000',
    evt.op ?? 'set',
    evt.lx ?? 0, evt.ly ?? 0, evt.lz ?? 0,
    evt.value ?? 0, evt.actor ?? 'api',
  );

  const cluster = defaultMgr.getCluster(event.chunkId);
  const result  = cluster.ingestEvent(event);
  res.json({ ...result, event: { sig: event.sig, tick: event.tick } });
});

/**
 * POST /mmo/events/batch — ingest a batch of VSL events
 * Body: { worldId?, events: VoxelEvent[] }
 */
app.post('/mmo/events/batch', (req, res) => {
  const { worldId = 'default', events = [] } = req.body ?? {};
  if (!Array.isArray(events)) return res.status(400).json({ error: 'events array required' });

  let accepted = 0, rejected = 0;
  for (const e of events.slice(0, 1000)) {
    const evt = makeVSLEvent(e.tick ?? 0, e.chunkId ?? '0000', e.op ?? 'set', e.lx ?? 0, e.ly ?? 0, e.lz ?? 0, e.value ?? 0, e.actor ?? 'api');
    const r   = defaultMgr.getCluster(evt.chunkId).ingestEvent(evt);
    r.accepted ? accepted++ : rejected++;
  }
  res.json({ accepted, rejected, total: events.length });
});

/** GET /mmo/zone/:zoneId — zone cluster detail + ledger snapshot */
app.get('/mmo/zone/:zoneId', (req, res) => {
  const cluster = defaultMgr.getCluster(req.params.zoneId);
  res.json({ ...cluster.snapshot(), npcs: cluster.getNPCs() });
});

/** GET /mmo/zone/:zoneId/ledger — VSL ledger events for a zone */
app.get('/mmo/zone/:zoneId/ledger', (req, res) => {
  const cluster  = defaultMgr.getCluster(req.params.zoneId);
  const since    = parseInt(req.query.since ?? '0', 10);
  const limit    = parseInt(req.query.limit ?? '200', 10);
  const events   = cluster.ledger.eventsSince(since, limit);
  res.json({ zoneId: req.params.zoneId, count: events.length, events });
});

/** GET /mmo/zone/:zoneId/authority — current authority + schedule */
app.get('/mmo/zone/:zoneId/authority', (req, res) => {
  const cluster = defaultMgr.getCluster(req.params.zoneId);
  res.json(cluster.ledger.authority.toJSON());
});

/** GET /mmo/npcs — all active NPC states across all zones */
app.get('/mmo/npcs', (req, res) => {
  const worldId = req.query.worldId ?? 'default';
  const npcs = defaultMgr.activeClusters().flatMap(c => c.npcs);
  res.json({ npcs: [...(npcs instanceof Map ? npcs.values() : npcs)], count: npcs instanceof Map ? npcs.size : npcs.length });
});

/** GET /mmo/proof — state proof chain for all zones */
app.get('/mmo/proof', (_req, res) => {
  const chains = {};
  for (const [zoneId, chain] of proofChain.chains) {
    chains[zoneId] = chain.slice(-10);
  }
  res.json({ ...proofChain.stats(), chains });
});

/** GET /mmo/farm — compute farm task queue */
app.get('/mmo/farm', (_req, res) => {
  res.json({ tasks: defaultMgr.getFarmQueue(50) });
});

/** POST /mmo/farm/activate/:peerId — activate compute farm for a peer */
app.post('/mmo/farm/activate/:peerId', (req, res) => {
  const ok = peerRegistry.activateComputeFarm(req.params.peerId);
  res.json({ ok });
});

/** GET /mmo/bootstrap/:worldId — full world state for new peer cold sync */
app.get('/mmo/bootstrap/:worldId', (req, res) => {
  const mgr = getClusterManager(req.params.worldId);
  res.json(mgr.worldBootstrap());
});

/** GET /mmo/vsl/stats — VSL ledger registry stats */
app.get('/mmo/vsl/stats', (_req, res) => res.json(vsStats()));

/** GET /mmo/ws — WebSocket endpoint info */
app.get('/mmo/ws-info', (_req, res) => {
  res.json({
    endpoint: '/mmo/ws',
    protocol: 'bkg-mmo',
    version:  '1.0',
    clients:  mmoWss.clients.size,
    messages: ['join','move','offer','answer','ice','delta','vote','farm','ping'],
  });
});

// ── /mmo/render/* — VRDL Render Distribution Layer ───────────────────────────

/** GET /mmo/render/config — tile grid, GPU budget config */
app.get('/mmo/render/config', (_req, res) => {
  res.json({ gridCols: GRID_COLS, gridRows: GRID_ROWS, tileCount: GRID_COLS * GRID_ROWS, gpuBudget: GPU_BUDGET });
});

/** GET /mmo/render/tiles — current tile grid with cost + assignment */
app.get('/mmo/render/tiles', (_req, res) => res.json(renderPartition.snapshot()));

/** GET /mmo/render/assignment — current full assignment map */
app.get('/mmo/render/assignment', (_req, res) => res.json({ assignment: renderPartition.getAssignmentMap() }));

/** GET /mmo/render/assignment/:peerId — tiles assigned to a specific peer */
app.get('/mmo/render/assignment/:peerId', (req, res) => {
  const tiles = renderPartition.getPeerAssignment(req.params.peerId);
  res.json({ peerId: req.params.peerId, tiles });
});

/** POST /mmo/render/rebalance — force tile reassignment */
app.post('/mmo/render/rebalance', (_req, res) => {
  const assignment = renderPartition.rebalance();
  compositor.broadcastAssignment(renderPartition.getAssignmentMap());
  res.json({ ok: true, assignment: Object.fromEntries(assignment ?? []) });
});

/**
 * POST /mmo/render/frame — peer submits a rendered tile frame (metadata)
 * Body: { peerId, tileId, seq, bytes, encoding?, hash? }
 * Pixel data travels P2P; server only tracks metadata.
 */
app.post('/mmo/render/frame', (req, res) => {
  const { peerId, tileId, seq, bytes, encoding = 'raw', hash } = req.body ?? {};
  if (!peerId || !tileId) return res.status(400).json({ error: 'peerId + tileId required' });
  const accepted = compositor.recordTileFrame({ peerId, tileId, seq: +seq || 0, bytes: +bytes || 0, encoding, hash });
  res.json({ accepted, tileId });
});

/** GET /mmo/render/frame/summary — current frame composition status */
app.get('/mmo/render/frame/summary', (_req, res) => res.json(compositor.getFrameSummary()));

/** GET /mmo/render/compositor — full compositor snapshot */
app.get('/mmo/render/compositor', (_req, res) => res.json(compositor.snapshot()));

/**
 * POST /mmo/render/npc — assign NPC rendering to nearest render peer
 * Body: { npcs: [{id,wx,wy,wz}], zoneId }
 */
app.post('/mmo/render/npc', (req, res) => {
  const { npcs = [], zoneId = '0:0:0' } = req.body ?? {};
  const assignments = compositor.assignNPCRendering(npcs, zoneId);
  res.json({ ok: true, assignments: assignments ?? [], npcStats: compositor.npcAssigner.stats() });
});

/**
 * POST /mmo/render/world-snapshot — update world complexity hint for cost model
 * Body: { trianglesInView, lightsInView, entitiesInView, dirtyVoxels }
 */
app.post('/mmo/render/world-snapshot', (req, res) => {
  renderPartition.updateWorldSnapshot(req.body ?? {});
  res.json({ ok: true, avgCost: renderPartition.metrics.avgCost });
});

// ── /mmo/render/temporal — Temporal Coherence Layer ───────────────────────────

/** GET /mmo/render/temporal — snapshot of temporal coherence state */
app.get('/mmo/render/temporal', (_req, res) => res.json(temporalCoherence.snapshot()));

/**
 * POST /mmo/render/temporal/camera — record a camera sample from a peer
 * Body: { peerId, pos:{x,y,z}, yaw, pitch, fov }
 */
app.post('/mmo/render/temporal/camera', (req, res) => {
  const { peerId, pos = {x:0,y:0,z:0}, yaw = 0, pitch = 0, fov = 70 } = req.body ?? {};
  if (!peerId) return res.status(400).json({ error: 'peerId required' });

  const traj   = temporalCoherence.recordCamera(peerId, { pos, yaw, pitch, fov });
  const predict = temporalCoherence.predictCamera(peerId);

  res.json({
    ok:       true,
    speed:    +traj.speed.toFixed(2),
    lodBias:  traj.lodBias,
    predict:  predict ? { pos: predict.pos, confidence: predict.confidence } : null,
  });
});

/** GET /mmo/render/temporal/predict/:peerId — predict future camera position */
app.get('/mmo/render/temporal/predict/:peerId', (req, res) => {
  const aheadMs = parseInt(req.query.ahead ?? '300', 10);
  const predict  = temporalCoherence.predictCamera(req.params.peerId, aheadMs);
  res.json({ peerId: req.params.peerId, aheadMs, prediction: predict });
});

/** GET /mmo/render/temporal/anchor — current temporal anchor */
app.get('/mmo/render/temporal/anchor', (_req, res) => {
  res.json({ anchor: temporalCoherence.anchors.current, ageMs: Math.round(temporalCoherence.anchors.anchorAge) });
});

// ── /mmo/cognitive — Cognitive Load Balancer ──────────────────────────────────

/** GET /mmo/cognitive — cognitive load balancer snapshot */
app.get('/mmo/cognitive', (_req, res) => res.json(cognitiveBalancer.snapshot()));

/**
 * POST /mmo/cognitive/peer — register a peer with the load balancer
 * Body: { peerId, gpuTier }
 */
app.post('/mmo/cognitive/peer', (req, res) => {
  const { peerId, gpuTier = 0 } = req.body ?? {};
  if (!peerId) return res.status(400).json({ error: 'peerId required' });
  cognitiveBalancer.addPeer(peerId, +gpuTier);
  res.json({ ok: true, budget: cognitiveBalancer.budgets.get(peerId)?.snapshot() });
});

/**
 * POST /mmo/cognitive/ingest — ingest events through the cognitive filter
 * Body: { events: [], zoneId, peerIds: [] }
 */
app.post('/mmo/cognitive/ingest', (req, res) => {
  const { events = [], zoneId = '0:0:0', peerIds = [] } = req.body ?? {};
  cognitiveBalancer.ingestBatch(events, zoneId, peerIds);
  res.json({ ok: true, ingested: events.length, ratio: cognitiveBalancer.compressionRatio() });
});

// ── /mmo/render/consistency|smooth|trust — Visual Coherence Layer ─────────────

/** GET /mmo/render/consistency — current global render state (lighting, TAA, fog) */
app.get('/mmo/render/consistency', (_req, res) => res.json(globalConsistency.snapshot()));

/** GET /mmo/render/consistency/state — just the raw render state (minimal payload for peers) */
app.get('/mmo/render/consistency/state', (_req, res) => res.json(globalConsistency.state));

/** POST /mmo/render/consistency/time — set time of day (0–1, 0.5=noon) */
app.post('/mmo/render/consistency/time', (req, res) => {
  const { time, daySpeed } = req.body ?? {};
  if (time !== undefined) globalConsistency.setTimeOfDay(+time);
  if (daySpeed !== undefined) globalConsistency.setDaySpeed(+daySpeed);
  res.json({ ok: true, timeOfDay: globalConsistency.timeOfDay });
});

/** POST /mmo/render/consistency/fog — override fog near/far */
app.post('/mmo/render/consistency/fog', (req, res) => {
  const { near = 150, far = 600 } = req.body ?? {};
  globalConsistency.setFog(+near, +far);
  res.json({ ok: true, fogNear: globalConsistency.fogNear, fogFar: globalConsistency.fogFar });
});

/** POST /mmo/render/consistency/light — override lighting params (null to reset to procedural) */
app.post('/mmo/render/consistency/light', (req, res) => {
  const { override } = req.body ?? {};
  globalConsistency.setLightOverride(override ?? null);
  res.json({ ok: true, override: !!override });
});

/** GET /mmo/render/consistency/motion — motion blur params for current + prev frame */
app.get('/mmo/render/consistency/motion', (_req, res) => {
  res.json({ ...globalConsistency.motionBlurParams(), prevState: globalConsistency.prevState(1) });
});

/** GET /mmo/render/smoother — frame smoother snapshot */
app.get('/mmo/render/smoother', (_req, res) => res.json(frameSmoother.snapshot()));

/**
 * POST /mmo/render/smoother/frame — peer submits tile frame with timing metadata
 * Body: { tileId, seq, peerId, bytes, latencyMs?, camDeltaX?, camDeltaY? }
 */
app.post('/mmo/render/smoother/frame', (req, res) => {
  const { tileId, seq, peerId, bytes, latencyMs, camDeltaX, camDeltaY } = req.body ?? {};
  if (!tileId || !peerId) return res.status(400).json({ error: 'tileId + peerId required' });

  // Ingest into jitter buffer
  frameSmoother.ingest({ tileId, seq: +seq || 0, peerId, bytes: +bytes || 0, camDeltaX, camDeltaY });

  // Also record in compositor and trust module
  compositor.recordTileFrame({ tileId, seq: +seq || 0, peerId, bytes: +bytes || 0 });
  if (latencyMs !== undefined) gpuTrust.recordDelivery(peerId, +latencyMs);

  res.json({ ok: true, tileId });
});

/** GET /mmo/render/trust — GPU trust leaderboard + stats */
app.get('/mmo/render/trust', (_req, res) => res.json(gpuTrust.snapshot()));

/** GET /mmo/render/trust/:peerId — trust record for a specific peer */
app.get('/mmo/render/trust/:peerId', (req, res) => {
  const { peerId } = req.params;
  const grade = gpuTrust.getGrade(peerId);
  res.json({
    peerId,
    grade,
    trustScore: gpuTrust.getTrust(peerId),
    maxTiles:   gpuTrust.getMaxTiles(peerId),
    lod:        gpuTrust.getLod(peerId),
    isEvicted:  gpuTrust.isEvicted(peerId),
  });
});

/**
 * POST /mmo/render/trust/quality — peer reports pixel quality of received tile
 * Body: { peerId, quality (0–1) }
 */
app.post('/mmo/render/trust/quality', (req, res) => {
  const { peerId, quality } = req.body ?? {};
  if (!peerId || quality === undefined) return res.status(400).json({ error: 'peerId + quality required' });
  gpuTrust.reportQuality(peerId, +quality);
  res.json({ ok: true, grade: gpuTrust.getGrade(peerId), trustScore: gpuTrust.getTrust(peerId) });
});

/** POST /mmo/render/trust/:peerId/miss — record a missed frame for a peer */
app.post('/mmo/render/trust/:peerId/miss', (req, res) => {
  gpuTrust.recordMiss(req.params.peerId);
  res.json({ ok: true, grade: gpuTrust.getGrade(req.params.peerId) });
});

// ── /mmo/chaos/* — Chaos Recovery Kernel ─────────────────────────────────────

/** GET /mmo/chaos/stats — overall chaos detection + recovery stats */
app.get('/mmo/chaos/stats', (_req, res) => {
  res.json({
    chaos:       chaosKernel.getStats(),
    speculative: speculativeStats(),
    healer:      stateHealer.getStats(),
    stitcher:    zoneStitcher.snapshot(),
    trust:       chaosKernel.getTrustLeaderboard().slice(0, 10),
  });
});

/** GET /mmo/chaos/history — recent chaos events + recoveries */
app.get('/mmo/chaos/history', (req, res) => {
  const limit = parseInt(req.query.limit ?? '30', 10);
  res.json({ events: chaosKernel.getHistory(limit) });
});

/**
 * POST /mmo/chaos/track — track a peer event (for chaos detection)
 * Body: { peerId, event, seq? }
 */
app.post('/mmo/chaos/track', (req, res) => {
  const { peerId, event, seq } = req.body ?? {};
  if (!peerId) return res.status(400).json({ error: 'peerId required' });
  chaosKernel.trackEvent(peerId, { ...(event ?? {}), seq });
  res.json({ ok: true });
});

/**
 * POST /mmo/chaos/latency — report peer latency measurement
 * Body: { peerId, latencyMs }
 */
app.post('/mmo/chaos/latency', (req, res) => {
  const { peerId, latencyMs } = req.body ?? {};
  if (!peerId) return res.status(400).json({ error: 'peerId required' });
  chaosKernel.trackLatency(peerId, +latencyMs || 100);
  res.json({ ok: true });
});

/**
 * POST /mmo/chaos/bad-event — report tampered/invalid event from peer
 * Body: { peerId, event }
 */
app.post('/mmo/chaos/bad-event', (req, res) => {
  const { peerId, event } = req.body ?? {};
  if (!peerId) return res.status(400).json({ error: 'peerId required' });
  chaosKernel.reportBadEvent(peerId, event ?? {});
  res.json({ ok: true, trustScore: chaosKernel._trustScores.get(peerId) ?? 0.8 });
});

/** GET /mmo/chaos/trust — peer trust leaderboard */
app.get('/mmo/chaos/trust', (_req, res) => {
  res.json({ peers: chaosKernel.getTrustLeaderboard() });
});

// Speculative replay endpoints

/** GET /mmo/chaos/speculative — all active speculative timelines */
app.get('/mmo/chaos/speculative', (_req, res) => {
  res.json({ ...speculativeStats(), timelines: listTimelines() });
});

/**
 * POST /mmo/chaos/speculative/apply — apply a speculative event
 * Body: { worldId, zoneId, event, confirmed?: boolean }
 */
app.post('/mmo/chaos/speculative/apply', (req, res) => {
  const { worldId='default', zoneId='0:0:0', event, confirmed=false } = req.body ?? {};
  if (!event) return res.status(400).json({ error: 'event required' });

  const timeline = getTimeline(worldId, zoneId);
  const ok = confirmed
    ? (timeline.applyConfirmed(event), true)
    : timeline.applySpeculative(event);

  res.json({ ok, zoneId, speculative: timeline.speculative.length, confirmed: timeline.confirmed.length });
});

/**
 * POST /mmo/chaos/speculative/correct — apply forward correction
 * Body: { worldId, zoneId, canonicalMap?: object, atTick }
 */
app.post('/mmo/chaos/speculative/correct', (req, res) => {
  const { worldId='default', zoneId, atTick } = req.body ?? {};
  if (!zoneId) return res.status(400).json({ error: 'zoneId required' });

  const timeline = getTimeline(worldId, zoneId);
  const cluster  = defaultMgr.clusters.get(zoneId);
  const canonical = cluster?.ledger?.voxelMap ?? new Map();

  const result = timeline.forwardCorrect(canonical, +atTick || timeline._currentTick);
  res.json({ ...result, zoneId });
});

// State healer endpoints

/** GET /mmo/chaos/healer — state healer stats */
app.get('/mmo/chaos/healer', (_req, res) => {
  res.json(stateHealer.getStats());
});

/**
 * POST /mmo/chaos/healer/checkpoint — create CRC checkpoint for a zone's ledger
 * Body: { worldId?, zoneId }
 */
app.post('/mmo/chaos/healer/checkpoint', async (req, res) => {
  const { worldId='default', zoneId } = req.body ?? {};
  if (!zoneId) return res.status(400).json({ error: 'zoneId required' });

  // Auto-create cluster if it doesn't exist (required for checkpointing)
  const cluster = defaultMgr.getCluster(zoneId);
  const crc = stateHealer.checkpoint(cluster.ledger);
  res.json({ ok: true, zoneId, crc });
});

/**
 * POST /mmo/chaos/healer/verify — verify a zone's ledger CRC
 * Body: { worldId?, zoneId }
 */
app.post('/mmo/chaos/healer/verify', async (req, res) => {
  const { worldId='default', zoneId } = req.body ?? {};
  if (!zoneId) return res.status(400).json({ error: 'zoneId required' });

  const cluster = defaultMgr.getCluster(zoneId);
  const result  = stateHealer.verify(cluster.ledger);
  res.json({ zoneId, ...result });
});

/**
 * POST /mmo/chaos/healer/heal — trigger healing pipeline for a zone
 * Body: { worldId?, zoneId }
 */
app.post('/mmo/chaos/healer/heal', async (req, res) => {
  const { worldId='default', zoneId } = req.body ?? {};
  if (!zoneId) return res.status(400).json({ error: 'zoneId required' });

  const cluster = defaultMgr.getCluster(zoneId);  // auto-create if missing

  try {
    const result = await stateHealer.heal(cluster.ledger, worldId);
    res.json({ zoneId, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Zone stitcher endpoints

/** GET /mmo/chaos/stitcher — zone stitcher snapshot */
app.get('/mmo/chaos/stitcher', (_req, res) => {
  const connectivity = analyzeZoneConnectivity(defaultMgr.clusters);
  res.json({ ...zoneStitcher.snapshot(), connectivity });
});

/**
 * POST /mmo/chaos/stitcher/track — update peer position for movement prediction
 * Body: { peerId, wx, wy, wz }
 */
app.post('/mmo/chaos/stitcher/track', (req, res) => {
  const { peerId, wx=0, wy=0, wz=0 } = req.body ?? {};
  if (!peerId) return res.status(400).json({ error: 'peerId required' });
  zoneStitcher.trackPeer(peerId, +wx, +wy, +wz);
  const predictedZones = zoneStitcher.tracker.predictZones(peerId);
  res.json({ ok: true, predictedZones });
});

/**
 * GET /mmo/chaos/stitcher/predict/:peerId — get predicted zones for a peer
 */
app.get('/mmo/chaos/stitcher/predict/:peerId', (req, res) => {
  const predicted = zoneStitcher.tracker.predictZones(req.params.peerId);
  const prefetched = zoneStitcher.prefetchForPeer(req.params.peerId);
  res.json({ peerId: req.params.peerId, predictedZones: predicted, prefetched });
});

// ── /mmo/stabilization/* — MMO Stabilization Kernel ─────────────────────────

/** GET /mmo/stabilize/rebalancer — load map + rebalancer metrics */
app.get('/mmo/stabilize/rebalancer', (_req, res) => {
  res.json({ ...rebalancer.getMetrics(), loadMap: rebalancer.getLoadMap() });
});

/** GET /mmo/stabilize/interest — per-peer subscription stats */
app.get('/mmo/stabilize/interest', (_req, res) => {
  res.json({ ...interestManager.getStats(), peerStats: interestManager.getPeerStats(20), snapshot: interestManager.interestSnapshot() });
});

/** POST /mmo/stabilize/interest/subscribe — subscribe a peer */
app.post('/mmo/stabilize/interest/subscribe', (req, res) => {
  const { peerId, wx=0, wy=0, wz=0, yaw } = req.body ?? {};
  if (!peerId) return res.status(400).json({ error: 'peerId required' });
  const zoneId = interestManager.subscribe(peerId, +wx, +wy, +wz, yaw !== undefined ? +yaw : undefined);
  res.json({ ok: true, zoneId, zones: interestManager.getPeerZones(peerId).length });
});

/**
 * POST /mmo/stabilize/interest/route — classify event + get interested peers
 * Body: { event, zoneId, originId? }
 */
app.post('/mmo/stabilize/interest/route', (req, res) => {
  const { event, zoneId = '0:0:0', originId = '' } = req.body ?? {};
  if (!event) return res.status(400).json({ error: 'event required' });
  const priority = classifyEvent(event);
  const peers    = interestManager.getInterestedPeers(event, zoneId, originId);
  res.json({ priority, priorityName: PRIORITY_NAME[priority], peers, peerCount: peers.length });
});

/** GET /mmo/stabilize/forks — active + recent resolved forks */
app.get('/mmo/stabilize/forks', (_req, res) => {
  res.json({
    ...conflictResolver.getStats(),
    active:   conflictResolver.getActiveForks(),
    resolved: conflictResolver.getRecentResolutions(10),
  });
});

/**
 * POST /mmo/stabilize/forks/report — peer reports its stateHash (fork detection)
 * Body: { zoneId, peerId, stateHash, atTick }
 */
app.post('/mmo/stabilize/forks/report', (req, res) => {
  const { zoneId, peerId, stateHash, atTick } = req.body ?? {};
  if (!zoneId || !peerId || !stateHash || atTick === undefined)
    return res.status(400).json({ error: 'zoneId, peerId, stateHash, atTick required' });

  const fork = conflictResolver.reportState(zoneId, peerId, stateHash, +atTick);
  res.json({ fork: fork ? { id: fork.id, forkTick: fork.forkTick, branches: fork.branches.size } : null });
});

/**
 * POST /mmo/stabilize/forks/submit — submit events for fork resolution
 * Body: { forkId, peerId, events, stateHash, atTick, zonePeers? }
 */
app.post('/mmo/stabilize/forks/submit', (req, res) => {
  const { forkId, peerId, events = [], stateHash, atTick, zonePeers = [] } = req.body ?? {};
  if (!forkId || !peerId) return res.status(400).json({ error: 'forkId + peerId required' });

  const result = conflictResolver.submitBranch(forkId, peerId, events, stateHash ?? '', +atTick, zonePeers);
  if (result) {
    // Apply canonical state back to ledger
    for (const cluster of defaultMgr.clusters.values()) {
      conflictResolver.applyToLedger(cluster.ledger, result.voxelMap, result.stateHash);
    }
  }
  res.json(result ? { resolved: true, stateHash: result.stateHash, appliedCount: result.appliedCount } : { resolved: false });
});

/** GET /mmo/stabilize/bandwidth — shaper stats */
app.get('/mmo/stabilize/bandwidth', (_req, res) => {
  res.json({ ...bandwidthShaper.getStats(), queueDepths: bandwidthShaper.getQueueDepths() });
});

/**
 * POST /mmo/stabilize/bandwidth/tier — set bandwidth tier for a peer
 * Body: { peerId, tier: 'full'|'normal'|'throttled'|'minimal' }
 */
app.post('/mmo/stabilize/bandwidth/tier', (req, res) => {
  const { peerId, tier } = req.body ?? {};
  if (!peerId || !tier) return res.status(400).json({ error: 'peerId + tier required' });
  bandwidthShaper.setTier(peerId, tier);
  res.json({ ok: true, peerId, tier });
});

/** GET /mmo/stabilize/tick — tick sync status for all zones */
app.get('/mmo/stabilize/tick', (_req, res) => {
  res.json({ ...globalTickSyncStats(), zones: listTickSyncs() });
});

/**
 * POST /mmo/stabilize/tick/report — peer reports its local tick
 * Body: { zoneId, peerId, localTick, sentAt, latencyMs? }
 */
app.post('/mmo/stabilize/tick/report', (req, res) => {
  const { zoneId='0:0:0', peerId, localTick, sentAt, latencyMs=100 } = req.body ?? {};
  if (!peerId || localTick === undefined) return res.status(400).json({ error: 'peerId + localTick required' });

  const ts     = getTickSync(zoneId);
  const result = ts.report(peerId, +localTick, +(sentAt ?? Date.now()), +latencyMs);
  res.json({ ...result, zoneId, canonical: ts.globalTick });
});

/** GET /mmo/stabilize/tick/:zoneId — tick sync state for one zone */
app.get('/mmo/stabilize/tick/:zoneId', (req, res) => {
  res.json(getTickSync(req.params.zoneId).snapshot());
});

// ── /vldb/* — VLDB Voxel Layer Database ──────────────────────────────────────
//
// Compressed space-event machine.
// L1=LRU RAM  L2=binary chunks (.bin)  L3=event log (JSONL)
// All world state derived from delta replays.

/** GET /vldb/config — VLDB constants, material palette, chunk geometry */
app.get('/vldb/config', (_req, res) => {
  res.json({
    chunkSize:  CHUNK_SIZE,
    chunkVol:   CHUNK_VOL,
    chunk2Bit:  CHUNK_2BIT,
    chunk4Bit:  CHUNK_4BIT,
    materials:  MAT,
    palette:    [...PALETTE],   // RGBA8 per material
    kernel:     'JS/WASM-compatible',
    features:   ['bitpack','rle','lru','delta-log','sse-stream'],
  });
});

/** GET /vldb/stats — cache, disk, delta log statistics */
app.get('/vldb/stats', (_req, res) => res.json(vldb.stats()));

/** GET /vldb/worlds */
app.get('/vldb/worlds', (_req, res) => res.json(vldb.listWorlds()));

/** POST /vldb/worlds */
app.post('/vldb/worlds', (req, res) => {
  try { res.status(201).json(vldb.createWorld(req.body ?? {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/** DELETE /vldb/worlds/:id */
app.delete('/vldb/worlds/:id', (req, res) => {
  vldb.deleteWorld(req.params.id);
  res.json({ ok: true });
});

/**
 * GET /vldb/chunk/:worldId — JSON sparse voxel list
 * Query: ?cx=0&cy=0&cz=0
 */
app.get('/vldb/chunk/:worldId', (req, res) => {
  const { cx=0, cy=0, cz=0 } = req.query;
  try {
    res.json(vldb.getChunkJSON(+cx, +cy, +cz, req.params.worldId));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * GET /vldb/chunk/:worldId/binary — raw bitpacked binary chunk
 * Returns: Content-Type: application/octet-stream (HEADER+RLE data)
 */
app.get('/vldb/chunk/:worldId/binary', (req, res) => {
  const { cx=0, cy=0, cz=0 } = req.query;
  try {
    const buf = vldb.getChunkBinary(+cx, +cy, +cz, req.params.worldId);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('X-VLDB-ChunkSize', CHUNK_SIZE);
    res.setHeader('X-VLDB-BPP', vldb.bpp);
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /vldb/chunk/:worldId/applyDelta — apply a batch of voxel mutations
 * Body: { deltas: [{wx,wy,wz,val,mat}], source?: string }
 */
app.post('/vldb/chunk/:worldId/applyDelta', (req, res) => {
  const { deltas, source } = req.body ?? {};
  if (!Array.isArray(deltas)) return res.status(400).json({ error: 'deltas array required' });
  try {
    const applied = vldb.applyDeltaBatch(deltas, req.params.worldId, source ?? 'api');
    res.json({ ok: true, applied });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /vldb/voxel/:worldId — set a single voxel
 * Body: { wx, wy, wz, mat, source? }
 */
app.post('/vldb/voxel/:worldId', (req, res) => {
  const { wx, wy, wz, mat, source } = req.body ?? {};
  if (wx === undefined) return res.status(400).json({ error: 'wx,wy,wz,mat required' });
  try {
    const result = vldb.setVoxel(+wx, +wy, +wz, +mat, req.params.worldId, source ?? 'api');
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * PUT /vldb/region/:worldId — fill a box region with a material
 * Body: { x1,y1,z1, x2,y2,z2, mat, source? }
 */
app.put('/vldb/region/:worldId', (req, res) => {
  const { x1,y1,z1, x2,y2,z2, mat, source='api' } = req.body ?? {};
  const deltas = [];
  for (let y=Math.min(y1,y2); y<=Math.max(y1,y2); y++)
    for (let z=Math.min(z1,z2); z<=Math.max(z1,z2); z++)
      for (let x=Math.min(x1,x2); x<=Math.max(x1,x2); x++)
        deltas.push({ wx:x, wy:y, wz:z, val: +mat });
  try {
    const applied = vldb.applyDeltaBatch(deltas, req.params.worldId, source);
    res.json({ ok: true, applied });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * GET /vldb/world/:worldId/state — world info + loaded chunk stats
 */
app.get('/vldb/world/:worldId/state', (req, res) => {
  const world = vldb.getWorld(req.params.worldId);
  if (!world) return res.status(404).json({ error: 'World not found' });
  const cache = vldb.cache.keys().filter(k => k.startsWith(req.params.worldId));
  res.json({ ...world, loadedChunks: cache.length, cacheKeys: cache.slice(0, 20), stats: vldb.stats().cache });
});

/**
 * POST /vldb/world/:worldId/flush — flush all dirty chunks to L2
 */
app.post('/vldb/world/:worldId/flush', (_req, res) => {
  const saved = vldb.flushDirtyChunks();
  res.json({ ok: true, saved });
});

/**
 * GET /vldb/world/:worldId/replay — replay delta log for a specific chunk
 * Query: ?cx=0&cy=0&cz=0
 */
app.get('/vldb/world/:worldId/replay', (req, res) => {
  const { cx=0, cy=0, cz=0 } = req.query;
  try {
    const { chunk, deltasApplied } = vldb.replayChunk(+cx, +cy, +cz, req.params.worldId);
    const sparse = chunk.toSparse();
    res.json({ cx:+cx, cy:+cy, cz:+cz, deltasApplied, solidCount: sparse.length, voxels: sparse });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * GET /vldb/events — SSE real-time delta stream for all worlds (E3)
 * Query: ?worldId= (optional filter)
 */
app.get('/vldb/events', (req, res) => {
  const filterWorld = req.query.worldId ?? null;

  res.setHeader('Content-Type',        'text/event-stream');
  res.setHeader('Cache-Control',       'no-cache');
  res.setHeader('X-Accel-Buffering',   'no');
  res.flushHeaders();
  res.write('event: connected\ndata: {"type":"connected"}\n\n');

  const unsub = vldb.subscribe(evt => {
    if (filterWorld && evt.worldId !== filterWorld) return;
    if (!res.writableEnded) {
      res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
    }
  });

  const hb = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
    else clearInterval(hb);
  }, 20_000);

  req.on('close', () => { unsub(); clearInterval(hb); });
});

/**
 * GET /vldb/deltas — read event log (L3 source of truth)
 * Query: ?worldId=&chunkId=&since=<ts>&limit=
 */
app.get('/vldb/deltas', (req, res) => {
  const { since, limit = '200' } = req.query;
  const deltas = readDeltas({ since: since ? +since : 0 }).slice(-parseInt(limit, 10));
  res.json({ count: deltas.length, deltas });
});

/**
 * POST /vldb/world/:worldId/agent-mutate — agent-driven voxel mutation (bKG integration)
 * Body: { sessionId, mutations: [{type:'voxel.set', wx,wy,wz,mat}] }
 */
app.post('/vldb/world/:worldId/agent-mutate', (req, res) => {
  const { sessionId, mutations } = req.body ?? {};
  if (!Array.isArray(mutations)) return res.status(400).json({ error: 'mutations array required' });
  const deltas = mutations
    .filter(m => m.type === 'voxel.set')
    .map(m => ({ wx: m.wx, wy: m.wy, wz: m.wz, val: m.mat ?? MAT.SOLID }));
  const applied = vldb.applyDeltaBatch(deltas, req.params.worldId, `agent:${sessionId ?? 'unknown'}`);
  res.json({ ok: true, applied });
});

// ── /hub/* — bKG Agent Hub (pure Node.js, full feature set) ─────────────────
//
// Rebraneded from sandbox-agent (MIT, rivet-dev/sandbox-agent).
// All features implemented in Node.js without the Rust binary.
//
// Agents: pi · claude-code · codex · opencode · amp
// Features: sessions · SSE streaming · permissions · file system · process exec

/** GET /hub/health */
app.get('/hub/health', (_req, res) => res.json(hubHealth()));

/** GET /hub/agents — list available agents + installation status */
app.get('/hub/agents', async (_req, res) => {
  try { res.json(await listAgents()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/** GET /hub/sessions — list active sessions */
app.get('/hub/sessions', (_req, res) => res.json(hubListSessions()));

/** POST /hub/sessions — create a session
 *  Body: { id?, agent, agentMode?, cwd?, initialMessage? }
 */
app.post('/hub/sessions', async (req, res) => {
  const { id, agent = 'pi', agentMode = 'default', ...rest } = req.body ?? {};
  const sessionId = id ?? `bkg-${Date.now()}`;
  try {
    const result = await hubCreateSession(sessionId, agent, agentMode, rest);
    if (result.error) return res.status(409).json(result);
    res.status(201).json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** GET /hub/sessions/:id */
app.get('/hub/sessions/:id', (req, res) => {
  const s = hubGetSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json(s);
});

/** DELETE /hub/sessions/:id */
app.delete('/hub/sessions/:id', (req, res) => {
  res.json(hubDestroySession(req.params.id));
});

/** POST /hub/sessions/:id/message — send a message
 *  Body: { message: string }
 */
app.post('/hub/sessions/:id/message', async (req, res) => {
  const { message } = req.body ?? {};
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    await hubSendMessage(req.params.id, message);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** POST /hub/sessions/:id/abort — abort current agent turn */
app.post('/hub/sessions/:id/abort', (req, res) => {
  res.json(hubAbortSession(req.params.id));
});

/** GET /hub/sessions/:id/events — SSE stream of events
 *  Query: ?offset=0  (resume from event index)
 */
app.get('/hub/sessions/:id/events', (req, res) => {
  const offset = parseInt(req.query.offset ?? '0', 10);
  streamSessionEvents(req.params.id, req, res, offset);
});

/** GET /hub/sessions/:id/events/list — paginated event list (non-SSE)
 *  Query: ?offset=0&limit=100
 */
app.get('/hub/sessions/:id/events/list', (req, res) => {
  const offset = parseInt(req.query.offset ?? '0', 10);
  const limit  = parseInt(req.query.limit  ?? '100', 10);
  const result = listSessionEvents(req.params.id, offset, limit);
  if (!result) return res.status(404).json({ error: 'Session not found' });
  res.json(result);
});

/** POST /hub/sessions/:id/permission — reply to a permission request
 *  Body: { approved: boolean, response?: string }
 */
app.post('/hub/sessions/:id/permission', (req, res) => {
  const { approved, response } = req.body ?? {};
  res.json(replyPermission(req.params.id, !!approved, response));
});

/** GET /hub/sessions/:id/fs — list files in session workspace
 *  Query: ?path=. (relative path)
 */
app.get('/hub/sessions/:id/fs', (req, res) => {
  try { res.json(fsList(req.params.id, req.query.path ?? '.')); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

/** GET /hub/sessions/:id/fs/read — read a file
 *  Query: ?path=src/index.ts
 */
app.get('/hub/sessions/:id/fs/read', (req, res) => {
  if (!req.query.path) return res.status(400).json({ error: 'path required' });
  try { res.json(fsRead(req.params.id, req.query.path)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

/** PUT /hub/sessions/:id/fs/write — write a file
 *  Body: { path: string, content: string }
 */
app.put('/hub/sessions/:id/fs/write', (req, res) => {
  const { path: p, content } = req.body ?? {};
  if (!p || content === undefined) return res.status(400).json({ error: 'path and content required' });
  try { res.json(fsWrite(req.params.id, p, content)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

/** DELETE /hub/sessions/:id/fs/delete — delete a file
 *  Query: ?path=file.txt
 */
app.delete('/hub/sessions/:id/fs/delete', (req, res) => {
  if (!req.query.path) return res.status(400).json({ error: 'path required' });
  try { res.json(fsDelete(req.params.id, req.query.path)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

/** POST /hub/sessions/:id/exec — execute a command (SSE stream)
 *  Body: { command: string }
 */
app.post('/hub/sessions/:id/exec', (req, res) => {
  const { command } = req.body ?? {};
  if (!command) return res.status(400).json({ error: 'command required' });
  execInSession(req.params.id, command, req, res);
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

    // E11 — Retry on 429 with Retry-After (max 2 retries)
    let upstreamRes;
    for (let attempt = 0; attempt <= 2; attempt++) {
      upstreamRes = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, stream, max_tokens, temperature }),
        signal: AbortSignal.timeout(60000),
      });
      if (upstreamRes.status !== 429 || attempt === 2) break;
      const retryAfter = parseInt(upstreamRes.headers.get('retry-after') ?? '2', 10);
      await new Promise(r => setTimeout(r, Math.min(retryAfter, 10) * 1000));
    }

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

// ── /admin/db/* — SQLite DB Viewer ───────────────────────────────────────────

/**
 * GET /admin/db/databases — list all known SQLite databases
 */
app.get('/admin/db/databases', (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const BKG_DIR = process.env.BKG_DIR ?? join(homedir(), '.bkg');
  const databases = [
    { id: 'flow',   label: 'Flow Board',    path: join(BKG_DIR, 'flow-default.db') },
    { id: 'users',  label: 'Users & Keys',  path: join(BKG_DIR, 'users', 'globals.json') },
  ];
  // Check which exist
  const existing = databases.map(db => ({
    ...db,
    exists: existsSync(db.path),
    size:   existsSync(db.path) ? (() => { try { return statSync(db.path).size; } catch { return 0; } })() : 0,
  }));
  res.json({ databases: existing });
});

/**
 * GET /admin/db/:dbId/tables — list tables + row counts
 */
app.get('/admin/db/:dbId/tables', async (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const BKG_DIR = process.env.BKG_DIR ?? join(homedir(), '.bkg');

  const DB_PATHS = {
    flow: join(BKG_DIR, 'flow-default.db'),
  };

  const dbPath = DB_PATHS[req.params.dbId];
  if (!dbPath) return res.status(404).json({ error: 'Database not found' });
  if (!existsSync(dbPath)) return res.status(404).json({ error: 'Database file not found', path: dbPath });

  try {
    const { default: Db } = await import('better-sqlite3').catch(() => ({ default: null }));
    if (!Db) return res.status(503).json({ error: 'SQLite not available' });

    const db     = new Db(dbPath, { readonly: true, verbose: null });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const result = tables.map(({ name }) => {
      try {
        const count = db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get();
        const cols  = db.prepare(`PRAGMA table_info("${name}")`).all();
        return { name, rows: count.c, columns: cols.map(c => c.name) };
      } catch { return { name, rows: 0, columns: [] }; }
    });
    db.close();
    res.json({ dbId: req.params.dbId, tables: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /admin/db/:dbId/table/:table — query rows from a table
 * Query: ?limit=50&offset=0&search=
 */
app.get('/admin/db/:dbId/table/:table', async (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const BKG_DIR  = process.env.BKG_DIR ?? join(homedir(), '.bkg');
  const DB_PATHS = { flow: join(BKG_DIR, 'flow-default.db') };

  const dbPath = DB_PATHS[req.params.dbId];
  if (!dbPath || !existsSync(dbPath)) return res.status(404).json({ error: 'Database not found' });

  const limit  = Math.min(200, parseInt(req.query.limit ?? '50', 10));
  const offset = parseInt(req.query.offset ?? '0', 10);
  const search = req.query.search?.toString() ?? '';
  const table  = req.params.table.replace(/[^a-zA-Z0-9_]/g, '');  // sanitise

  try {
    const { default: Db } = await import('better-sqlite3').catch(() => ({ default: null }));
    if (!Db) return res.status(503).json({ error: 'SQLite not available' });

    const db   = new Db(dbPath, { readonly: true, verbose: null });
    const cols = db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);

    let rows, total;
    if (search && cols.length > 0) {
      // Search across all text columns
      const likeClause = cols.map(c => `CAST("${c}" AS TEXT) LIKE ?`).join(' OR ');
      const pat = `%${search}%`;
      const params = cols.map(() => pat);
      total = db.prepare(`SELECT COUNT(*) AS c FROM "${table}" WHERE ${likeClause}`).get(...params).c;
      rows  = db.prepare(`SELECT * FROM "${table}" WHERE ${likeClause} LIMIT ? OFFSET ?`).all(...params, limit, offset);
    } else {
      total = db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;
      rows  = db.prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`).all(limit, offset);
    }
    db.close();
    res.json({ table, columns: cols, rows, total, limit, offset });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /admin/db/:dbId/query — run a read-only SQL query
 * Body: { sql }
 */
app.post('/admin/db/:dbId/query', async (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const BKG_DIR  = process.env.BKG_DIR ?? join(homedir(), '.bkg');
  const DB_PATHS = { flow: join(BKG_DIR, 'flow-default.db') };

  const dbPath = DB_PATHS[req.params.dbId];
  if (!dbPath || !existsSync(dbPath)) return res.status(404).json({ error: 'Database not found' });

  const { sql } = req.body ?? {};
  if (!sql) return res.status(400).json({ error: 'sql required' });

  // Security: only allow SELECT statements
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH') && !trimmed.startsWith('PRAGMA')) {
    return res.status(403).json({ error: 'Only SELECT, WITH, and PRAGMA queries are allowed' });
  }

  try {
    const { default: Db } = await import('better-sqlite3').catch(() => ({ default: null }));
    if (!Db) return res.status(503).json({ error: 'SQLite not available' });

    const db   = new Db(dbPath, { readonly: true, verbose: null });
    const rows = db.prepare(sql).all();
    db.close();
    res.json({ rows, count: rows.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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

/** GET /health/ready — readiness probe (used by bkg.sh to confirm server is up) */
app.get('/health/ready', (_req, res) => {
  if (_ready) res.json({ ready: true, pid: process.pid });
  else        res.status(503).json({ ready: false });
});

// ── Static file serving (SPA) ─────────────────────────────────────────────────

app.use(express.static(DIST, { maxAge: 0 }));
app.get('*', (_req, res) => res.sendFile(join(DIST, 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────────

// Write PID file so bkg.sh can track and kill us reliably
const PID_DIR  = join(__dir, '../.bkg/run');
const PID_FILE = join(PID_DIR, 'serve.pid');

try {
  mkdirSync(PID_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));
} catch { /* non-fatal: PID dir may not exist in CI */ }

const httpServer = createServer(app);

// ── Attach MMO WebSocket + start cluster manager ───────────────────────────
const mmoWss        = attachMMOWebSocket(httpServer, peerRegistry, npcConsensus, proofChain);
const defaultMgr    = getClusterManager('default');
const rebalancer    = new ClusterRebalancer(defaultMgr).start();

// ── Chaos Recovery Kernel ──────────────────────────────────────────────────
const chaosKernel  = new ChaosRecoveryKernel(defaultMgr).start();
const stateHealer  = new StateHealer(defaultMgr, null);
const zoneStitcher = new ZoneStitcher(defaultMgr).start();
stateHealer.start();
chaosKernel.injectDeps({ bandwidthShaper });

// ── VRDL: start compositor and initial tile assignment ──────────────────────
setTimeout(() => {
  renderPartition.rebalance();
  compositor.broadcastAssignment(renderPartition.getAssignmentMap());
}, 2000);

// ── Global Consistency: start day/night cycle ────────────────────────────────
globalConsistency.start();

// ── GPU Trust: start trust manager ──────────────────────────────────────────
gpuTrust.start();

// ── Temporal Coherence: start with consistency + cluster manager ─────────────
temporalCoherence.start(globalConsistency, defaultMgr);

// ── Cognitive Load Balancer: running at startup ──────────────────────────────
// cognitiveBalancer already starts via .start() in its module

// Start bandwidth shaper — delivers queued messages via WebSocket
bandwidthShaper.start((peerId, messages) => {
  const peer = peerRegistry.getPeer(peerId);
  const ws   = peer?.ws;
  if (ws?.readyState === 1) {
    for (const msg of messages) {
      try { ws.send(JSON.stringify(msg)); } catch { /**/ }
    }
  }
});

httpServer.listen(PORT, HOST, () => {
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
