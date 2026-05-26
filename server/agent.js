/**
 * server/agent.js — bKG Coding Agent Engine
 *
 * Uses @earendil-works/pi-coding-agent as the agent harness, rebranded for bKG.
 * Registers our local model servers (node-llama-cpp and Ollama) as custom providers,
 * so pi's full tool system (read/write/edit/bash/grep/find/ls) and extension API
 * work with any locally-running GGUF or Ollama model.
 *
 * Pi's built-in tools are 100% real — no simulation:
 *   • bash   — spawns shell processes, streams stdout/stderr
 *   • read   — reads files from disk
 *   • write  — writes files to disk
 *   • edit   — applies diff-based edits to files
 *   • grep   — searches file contents
 *   • find   — finds files matching patterns
 *   • ls     — lists directory contents
 *
 * Sessions are stored in JSONL format at ~/.bkg/sessions/.
 * Extensions load from ~/.bkg/extensions/ and ./.bkg/extensions/.
 * Skills load from ~/.bkg/skills/ and ./.bkg/skills/.
 */

import {
  createAgentSession,
  SessionManager,
  ModelRegistry,
  AuthStorage,
  DefaultResourceLoader,
  getAgentDir,
} from '@earendil-works/pi-coding-agent';

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dir   = dirname(fileURLToPath(import.meta.url));
// BKG_DIR env var overrides the default config directory
const BKG_DIR = process.env.BKG_DIR ?? join(homedir(), '.bkg');

// ── bKG config directory ──────────────────────────────────────────────────────

for (const sub of ['sessions', 'extensions', 'skills', 'prompts', 'plugins/npm', 'plugins/git']) {
  mkdirSync(join(BKG_DIR, sub), { recursive: true });
}

// Alias for backwards compat within this file
const ICADP_DIR = BKG_DIR;

// ── Default agent settings ────────────────────────────────────────────────────

const SETTINGS_FILE = join(ICADP_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  // Model backend: 'llama-cpp' | 'ollama'
  backendType:  'llama-cpp',
  serverUrl:    'http://localhost:8001',
  modelId:      'local',
  // Which tools to enable
  tools:        ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'],
  // System prompt prefix (appended before pi's default)
  systemPromptPrefix: '',
  // Working directory for new sessions (defaults to process.cwd())
  defaultCwd:   process.cwd(),
  // Context window
  contextWindow: 4096,
  maxTokens:     4096,
};

export function readSettings() {
  if (!existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function writeSettings(partial) {
  const current = readSettings();
  const updated  = { ...current, ...partial };
  writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
  return updated;
}

// ── Provider registration ─────────────────────────────────────────────────────

/**
 * Create a ModelRegistry that knows about our local servers.
 *
 * The ICADP provider name maps to whichever local server is configured in settings.
 * Pi's `streamSimpleOpenAICompletions` is used because both our llama-cpp server
 * and Ollama speak the OpenAI /v1/chat/completions protocol.
 */
async function buildModelRegistry(settings) {
  const authStorage  = AuthStorage.create(join(ICADP_DIR, 'auth.json'));
  const modelRegistry = ModelRegistry.create(authStorage, join(ICADP_DIR, 'models.json'));

  // Register our local server as the 'bkg' provider
  await modelRegistry.registerProvider('bkg', {
    api:     'openai-completions',
    baseUrl: settings.serverUrl,
    apiKey:  'BKG_LOCAL_KEY',         // env var name — we'll set a fake key
    models: [
      {
        id:            settings.modelId || 'local',
        name:          `bKG Local (${settings.backendType})`,
        reasoning:     false,
        input:         ['text'],
        cost:          { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: settings.contextWindow,
        maxTokens:     settings.maxTokens,
      },
    ],
  });

  // Provide a dummy API key so pi doesn't complain about missing auth
  authStorage.setRuntimeApiKey('bkg', 'local-no-auth');
  // Set env var so the provider can pick it up
  process.env['BKG_LOCAL_KEY'] = 'local-no-auth';

  return { authStorage, modelRegistry };
}

// ── Active sessions ───────────────────────────────────────────────────────────

/**
 * sessionStore: Map<sessionId, { session, dispose, events[] }>
 * Events are buffered here until polled via SSE.
 */
const sessionStore = new Map();

// ── Start a new agent session ─────────────────────────────────────────────────

/**
 * Start a new coding agent session.
 *
 * @param options.cwd            Working directory (default: settings.defaultCwd)
 * @param options.systemPrompt   Override the system prompt prefix
 * @param options.tools          Override the enabled tools
 * @param options.initialMessage If provided, send this message immediately
 * @returns { sessionId }
 */
export async function startSession(options = {}) {
  const settings = readSettings();
  const cwd      = options.cwd        ?? settings.defaultCwd ?? process.cwd();
  const tools    = options.tools      ?? settings.tools;
  const sysPrefix= options.systemPrompt ?? settings.systemPromptPrefix;

  const { authStorage, modelRegistry } = await buildModelRegistry(settings);
  const model = modelRegistry.find('bkg', settings.modelId || 'local');

  if (!model) {
    throw new Error(
      `Cannot find bKG local model. Is the ${settings.backendType} server running at ${settings.serverUrl}?`,
    );
  }

  // Resource loader: finds extensions + skills from ICADP dirs
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir:                ICADP_DIR,
    additionalExtensionPaths: [],
    extensionFactories: [
      // Inline bKG branding extension
      (pi) => {
        pi.on('before_agent_start', async () => {
          // No-op; system prompt prefix handled below
        });
      },
    ],
  });
  await resourceLoader.reload();

  // Session manager: persists JSONL to ~/.bkg/sessions/
  const sessionMgr = SessionManager.create(join(ICADP_DIR, 'sessions'), cwd);

  // Create the pi session
  const { session } = await createAgentSession({
    model,
    authStorage,
    modelRegistry,
    sessionManager: sessionMgr,
    resourceLoader,
    cwd,
    tools,
    ...(sysPrefix ? { systemPrompt: sysPrefix } : {}),
  });

  const sessionId = randomUUID();
  const events    = [];
  let sseClients  = []; // SSE response objects

  // Subscribe to ALL agent events and fan them out to SSE clients + buffer
  session.subscribe((event) => {
    const stamped = { ...event, _ts: Date.now(), _session: sessionId };
    events.push(stamped);
    // Deliver to connected SSE clients
    for (const res of sseClients) {
      try { res.write(`data: ${JSON.stringify(stamped)}\n\n`); } catch { /**/ }
    }
  });

  sessionStore.set(sessionId, {
    session,
    cwd,
    events,
    sseClients,
    model:    model.id,
    provider: model.provider,
    startedAt: new Date().toISOString(),
    messages:  [],
  });

  // Send initial message if provided
  if (options.initialMessage) {
    // Don't await — let the session stream async
    session.prompt(options.initialMessage).catch(() => {});
  }

  return { sessionId };
}

// ── Send a message to a session ───────────────────────────────────────────────

export async function sendMessage(sessionId, message) {
  const entry = sessionStore.get(sessionId);
  if (!entry) throw new Error(`Session ${sessionId} not found`);
  // session.prompt() returns once the turn is complete
  await entry.session.prompt(message);
}

// ── Abort a running session ───────────────────────────────────────────────────

export function abortSession(sessionId) {
  const entry = sessionStore.get(sessionId);
  if (!entry) return;
  entry.session.abort();
}

// ── Register an SSE client for a session ─────────────────────────────────────

export function subscribeSSE(sessionId, req, res) {
  const entry = sessionStore.get(sessionId);
  if (!entry) { res.status(404).end(); return; }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');

  // Replay buffered events so late-connecting clients don't miss anything
  for (const ev of entry.events) {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }

  entry.sseClients.push(res);

  req.on('close', () => {
    entry.sseClients = entry.sseClients.filter(r => r !== res);
  });
}

// ── List sessions ─────────────────────────────────────────────────────────────

export function listSessions() {
  return Array.from(sessionStore.entries()).map(([id, e]) => ({
    sessionId:  id,
    cwd:        e.cwd,
    model:      e.model,
    startedAt:  e.startedAt,
    eventCount: e.events.length,
  }));
}

// ── Get session events ────────────────────────────────────────────────────────

export function getSessionEvents(sessionId, afterIndex = 0) {
  const entry = sessionStore.get(sessionId);
  if (!entry) return null;
  return entry.events.slice(afterIndex);
}

// ── Dispose session ───────────────────────────────────────────────────────────

export function disposeSession(sessionId) {
  const entry = sessionStore.get(sessionId);
  if (!entry) return;
  try { entry.session.dispose(); } catch { /**/ }
  sessionStore.delete(sessionId);
}
