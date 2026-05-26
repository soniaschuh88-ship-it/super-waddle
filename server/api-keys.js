/**
 * server/api-keys.js — bKG API Key Management
 *
 * Stores hashed API keys at ~/.bkg/api-keys.json
 *
 * Scopes:
 *   inference  — access to /v1/* model endpoints
 *   agent      — access to /agent/* coding agent endpoints
 *   admin      — full access (all routes)
 *   readonly   — GET-only status + sessions
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes, createHash } from 'crypto';

const BKG_DIR   = process.env.BKG_DIR ?? join(homedir(), '.bkg');
const KEYS_FILE = join(BKG_DIR, 'api-keys.json');

// ── Persistence ───────────────────────────────────────────────────────────────

function loadKeys() {
  try {
    mkdirSync(BKG_DIR, { recursive: true });
    if (!existsSync(KEYS_FILE)) return [];
    return JSON.parse(readFileSync(KEYS_FILE, 'utf-8'));
  } catch { return []; }
}

function saveKeys(keys) {
  mkdirSync(BKG_DIR, { recursive: true });
  writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

function hashKey(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

function uid() {
  return randomBytes(8).toString('hex');
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Create a new API key. Returns the raw key (shown once). */
export function createApiKey(name, scope) {
  const rawKey = `bkg_${randomBytes(24).toString('hex')}`;
  const stored = {
    id:         uid(),
    name:       (name ?? '').toString().trim().slice(0, 80),
    scope:      scope ?? 'inference',
    keyHash:    hashKey(rawKey),
    keyPrefix:  rawKey.slice(0, 12),
    createdAt:  new Date().toISOString(),
    lastUsedAt: null,
    enabled:    true,
  };
  const keys = loadKeys();
  keys.push(stored);
  saveKeys(keys);
  return { key: rawKey, stored };
}

/** List all keys (without hashes). */
export function listApiKeys() {
  return loadKeys().map(({ keyHash: _h, ...rest }) => rest);
}

/** Revoke a key by id. */
export function revokeApiKey(id) {
  const keys = loadKeys();
  const idx  = keys.findIndex(k => k.id === id);
  if (idx < 0) return false;
  keys.splice(idx, 1);
  saveKeys(keys);
  return true;
}

/** Enable / disable a key. */
export function setKeyEnabled(id, enabled) {
  const keys = loadKeys();
  const k    = keys.find(k => k.id === id);
  if (!k) return false;
  k.enabled = !!enabled;
  saveKeys(keys);
  return true;
}

/**
 * Validate a raw Bearer token.
 * Returns the key record on success, null on failure.
 * Side-effect: updates lastUsedAt.
 */
export function validateApiKey(rawKey) {
  if (!rawKey) return null;
  const hash = hashKey(rawKey);
  const keys = loadKeys();
  const k    = keys.find(k => k.keyHash === hash && k.enabled);
  if (!k) return null;
  k.lastUsedAt = new Date().toISOString();
  saveKeys(keys);
  return k;
}

/** Valid scope names. */
export const SCOPES = ['inference', 'agent', 'admin', 'readonly'];
