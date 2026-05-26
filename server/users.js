/**
 * server/users.js — bKG User Store
 *
 * Each user is identified by a bKG API key (from api-keys.js).
 * Per-user config is stored at ~/.bkg/users/<keyId>.json
 * Admin global provider config: ~/.bkg/global-providers.json
 *
 * Structure of ~/.bkg/users/<keyId>.json:
 * {
 *   "keyId":       "abc123",
 *   "createdAt":   "2026-...",
 *   "onboarded":   false,
 *   "providerKeys": {
 *     "groq_api_key":    "gsk_...",
 *     "nvidia_api_key":  "nvapi-...",
 *     ...
 *   }
 * }
 *
 * Structure of ~/.bkg/global-providers.json:
 * {
 *   "providerKeys": {
 *     "groq_api_key":   "gsk_...",
 *     ...
 *   },
 *   "defaultModel":     "groq/llama-3.3-70b-versatile",
 *   "defaultProvider":  "groq",
 *   "freeOnly":         true,
 *   "updatedAt":        "2026-..."
 * }
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createApiKey } from './api-keys.js';
import { resolveProviderKey, PROVIDERS } from './providers.js';

const BKG_DIR       = process.env.BKG_DIR ?? join(homedir(), '.bkg');
const USERS_DIR     = join(BKG_DIR, 'users');
const GLOBALS_FILE  = join(BKG_DIR, 'global-providers.json');

mkdirSync(USERS_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function userFile(keyId) {
  return join(USERS_DIR, `${keyId}.json`);
}

function readJson(path, fallback = {}) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch { return fallback; }
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ── User CRUD ─────────────────────────────────────────────────────────────────

/**
 * Create a new user record with a default bKG API key.
 * Returns { keyId, rawKey, user }
 */
export function createUser(name = 'default') {
  const { key: rawKey, stored } = createApiKey(name || 'user', 'inference');
  const user = {
    keyId:        stored.id,
    name:         stored.name,
    createdAt:    new Date().toISOString(),
    onboarded:    false,
    providerKeys: {},
  };
  writeJson(userFile(stored.id), user);
  return { keyId: stored.id, rawKey, user };
}

/**
 * Get a user record by key ID. Returns null if not found.
 */
export function getUser(keyId) {
  if (!keyId) return null;
  const data = readJson(userFile(keyId), null);
  return data;
}

/**
 * Ensure a user record exists for the given keyId (creates one if missing).
 */
export function ensureUser(keyId, name = 'user') {
  const existing = getUser(keyId);
  if (existing) return existing;
  const user = {
    keyId,
    name,
    createdAt:    new Date().toISOString(),
    onboarded:    false,
    providerKeys: {},
  };
  writeJson(userFile(keyId), user);
  return user;
}

/**
 * List all user records (without provider keys for privacy).
 */
export function listUsers() {
  try {
    return readdirSync(USERS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const u = readJson(join(USERS_DIR, f));
        const { providerKeys: _pk, ...rest } = u;
        return rest;
      });
  } catch { return []; }
}

// ── User provider keys ────────────────────────────────────────────────────────

/**
 * Get a user's provider key map.
 * Returns { groq_api_key: '...', nvidia_api_key: '...', ... }
 */
export function getUserProviderKeys(keyId) {
  const user = getUser(keyId);
  return user?.providerKeys ?? {};
}

/**
 * Set (merge) provider keys for a user.
 * Empty string values are treated as "delete this key".
 */
export function setUserProviderKeys(keyId, updates) {
  const user = ensureUser(keyId);
  const current = user.providerKeys ?? {};
  const merged = { ...current };
  for (const [k, v] of Object.entries(updates)) {
    if (v === '' || v === null || v === undefined) {
      delete merged[k];
    } else {
      merged[k] = String(v).trim();
    }
  }
  user.providerKeys = merged;
  writeJson(userFile(keyId), user);
  return merged;
}

/**
 * Mark user as onboarded.
 */
export function markOnboarded(keyId) {
  const user = ensureUser(keyId);
  user.onboarded = true;
  writeJson(userFile(keyId), user);
}

// ── Global provider config (admin) ────────────────────────────────────────────

/**
 * Get admin's global provider configuration.
 */
export function getGlobalProviderConfig() {
  return readJson(GLOBALS_FILE, {
    providerKeys:    {},
    defaultModel:    '',
    defaultProvider: 'groq',
    freeOnly:        true,
    updatedAt:       null,
  });
}

/**
 * Update admin's global provider configuration.
 */
export function setGlobalProviderConfig(updates) {
  const current  = getGlobalProviderConfig();
  const merged   = {
    ...current,
    ...updates,
    updiderKeys: undefined,
  };
  // Merge provider keys separately (don't wipe unmentioned keys)
  if (updates.providerKeys) {
    const keys = { ...current.providerKeys };
    for (const [k, v] of Object.entries(updates.providerKeys)) {
      if (v === '' || v === null) delete keys[k];
      else keys[k] = String(v).trim();
    }
    merged.providerKeys = keys;
  }
  delete merged.updiderKeys;
  merged.updatedAt = new Date().toISOString();
  writeJson(GLOBALS_FILE, merged);
  return merged;
}

/**
 * Get global provider keys only.
 */
export function getGlobalProviderKeys() {
  return getGlobalProviderConfig().providerKeys ?? {};
}

// ── Provider status for a user ────────────────────────────────────────────────

/**
 * Return per-provider status for a user: whether they have a key (user / global / anon),
 * plus the provider's public metadata (no key values returned).
 */
export function getUserProviderStatus(keyId) {
  const userKeys   = getUserProviderKeys(keyId);
  const globalKeys = getGlobalProviderKeys();

  return PROVIDERS.map(p => {
    const userHas   = !!(userKeys[p.configKey]);
    const globalHas = !!(globalKeys[p.configKey]);
    const envHas    = !!(process.env[p.envKey]);

    let source = 'none';
    if (userHas)   source = 'user';
    else if (globalHas) source = 'global';
    else if (envHas)    source = 'env';
    else if (p.anonAccess) source = 'anon';

    return {
      id:          p.id,
      name:        p.name,
      tier:        p.tier,
      description: p.description,
      signupUrl:   p.signupUrl,
      anonAccess:  p.anonAccess,
      source,                         // 'user'|'global'|'env'|'anon'|'none'
      hasKey:      source !== 'none', // usable (any source)
      userHasKey:  userHas,           // user personally configured
    };
  });
}

/**
 * Resolve the best available API key for a provider, for a given user.
 * Returns { key, source } where source is 'user'|'global'|'env'|'anon'|null
 */
export function resolveKeyForUser(providerId, keyId) {
  const userKeys   = getUserProviderKeys(keyId);
  const globalKeys = getGlobalProviderKeys();
  const key        = resolveProviderKey(providerId, userKeys, globalKeys);
  const p          = PROVIDERS.find(pr => pr.id === providerId);

  if (!p) return { key: null, source: null };
  if (!key) return { key: null, source: null };

  if (key === 'anon') return { key: null, source: 'anon' };

  // Determine source for audit/display
  let source = 'env';
  if (userKeys[p.configKey]) source = 'user';
  else if (globalKeys[p.configKey]) source = 'global';

  return { key, source };
}
