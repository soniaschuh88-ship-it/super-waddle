/**
 * server/plugins.js — ICADP Plugin Manager
 *
 * Installs, lists, and removes pi-compatible packages.
 * Packages can provide:
 *   • extensions  — TypeScript/JS modules that register tools, commands, events
 *   • skills      — Markdown instruction files loaded into the agent system prompt
 *   • prompts     — Reusable prompt templates with {{variable}} substitution
 *   • themes      — Visual theme definitions
 *
 * Install sources:
 *   npm:@scope/package          → ~/.icadp/plugins/npm/@scope/package/
 *   npm:@scope/package@1.2.3   → pinned version
 *   git:github.com/user/repo   → ~/.icadp/plugins/git/user__repo/
 *   git:github.com/user/repo@v1 → pinned tag/commit
 *   https://github.com/user/repo
 *
 * Compatible with pi-package format:
 *   package.json "pi": { "extensions": [], "skills": [], "prompts": [], "themes": [] }
 *   Without a "pi" key: auto-discovers from conventional directories.
 */

import { spawn }     from 'child_process';
import {
  existsSync, readFileSync, writeFileSync,
  mkdirSync, readdirSync, rmSync, statSync,
} from 'fs';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dir      = dirname(fileURLToPath(import.meta.url));
const ICADP_DIR  = join(homedir(), '.icadp');
const NPM_DIR    = join(ICADP_DIR, 'plugins', 'npm');
const GIT_DIR    = join(ICADP_DIR, 'plugins', 'git');
const INDEX_FILE = join(ICADP_DIR, 'plugins', 'index.json');

for (const d of [NPM_DIR, GIT_DIR]) mkdirSync(d, { recursive: true });

// ── Plugin index (tracks installed packages) ──────────────────────────────────

function readIndex() {
  if (!existsSync(INDEX_FILE)) return [];
  try { return JSON.parse(readFileSync(INDEX_FILE, 'utf-8')); } catch { return []; }
}

function writeIndex(entries) {
  writeFileSync(INDEX_FILE, JSON.stringify(entries, null, 2));
}

function addToIndex(entry) {
  const idx = readIndex().filter(e => e.source !== entry.source);
  idx.push(entry);
  writeIndex(idx);
}

function removeFromIndex(source) {
  writeIndex(readIndex().filter(e => e.source !== source));
}

// ── Source parsing ────────────────────────────────────────────────────────────

/**
 * Parse a source string into { type, name, version?, url? }.
 *
 * Examples:
 *   'npm:@scope/pkg'           → { type:'npm', name:'@scope/pkg' }
 *   'npm:@scope/pkg@1.0.0'     → { type:'npm', name:'@scope/pkg', version:'1.0.0' }
 *   'git:github.com/u/r'       → { type:'git', name:'u/r', url:'https://github.com/u/r' }
 *   'git:github.com/u/r@v1'    → { type:'git', name:'u/r', url:'...', ref:'v1' }
 *   'https://github.com/u/r'   → { type:'git', name:'u/r', url:'https://github.com/u/r' }
 */
export function parseSource(source) {
  if (source.startsWith('npm:')) {
    const pkg     = source.slice(4);
    const atIdx   = pkg.lastIndexOf('@');
    // Handle scoped packages: @scope/name  →  atIdx would be 0 = the scope @
    // We only split on @ if it appears after position 1 (i.e., it's a version separator)
    if (atIdx > 0) {
      return { type: 'npm', name: pkg.slice(0, atIdx), version: pkg.slice(atIdx + 1) };
    }
    return { type: 'npm', name: pkg };
  }

  if (source.startsWith('git:')) {
    const rest  = source.slice(4);
    const [urlPart, ref] = rest.split('@');
    const url   = urlPart.startsWith('github.com') ? `https://${urlPart}` : urlPart;
    const name  = url.replace(/^https?:\/\//, '').replace(/\.git$/, '').replace(/\//g, '__');
    return { type: 'git', name, url, ref };
  }

  if (source.startsWith('https://') || source.startsWith('http://')) {
    const url  = source.split('@')[0];
    const ref  = source.includes('@') ? source.split('@')[1] : undefined;
    const name = url.replace(/^https?:\/\//, '').replace(/\.git$/, '').replace(/\//g, '__');
    return { type: 'git', name, url, ref };
  }

  if (source.startsWith('ssh://') || source.startsWith('git@')) {
    const url   = source.split('@')[0];
    const name  = url.replace(/^(ssh:\/\/|git@)/, '').replace(/[/:]/g, '__').replace(/\.git$/, '');
    return { type: 'git', name, url: source, ref: undefined };
  }

  throw new Error(`Unknown package source format: ${source}. Use npm:pkg or git:host/user/repo`);
}

// ── Spawn helper ──────────────────────────────────────────────────────────────

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const lines = [];
    const proc  = spawn(cmd, args, {
      cwd:   opts.cwd ?? process.cwd(),
      env:   { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', d => lines.push(d.toString()));
    proc.stderr.on('data', d => lines.push(d.toString()));
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve(lines.join(''));
      else reject(new Error(`Command failed (${code}): ${cmd} ${args.join(' ')}\n${lines.join('')}`));
    });
    if (opts.onLine) {
      // Stream output lines to caller
      const handler = d => {
        for (const l of d.toString().split('\n')) {
          if (l.trim()) opts.onLine(l.trim());
        }
      };
      proc.stdout.on('data', handler);
      proc.stderr.on('data', handler);
    }
  });
}

// ── Discover plugin resources from an install directory ──────────────────────

function discoverResources(installDir) {
  const pkgFile  = join(installDir, 'package.json');
  const manifest = existsSync(pkgFile)
    ? JSON.parse(readFileSync(pkgFile, 'utf-8'))
    : {};

  const pi       = manifest.pi ?? {};
  const result   = { extensions: [], skills: [], prompts: [], themes: [] };

  // Explicit pi manifest
  if (pi.extensions?.length)  result.extensions = pi.extensions.map(p => join(installDir, p));
  if (pi.skills?.length)      result.skills     = pi.skills.map(p => join(installDir, p));
  if (pi.prompts?.length)     result.prompts    = pi.prompts.map(p => join(installDir, p));
  if (pi.themes?.length)      result.themes     = pi.themes.map(p => join(installDir, p));

  // Auto-discover if no manifest
  if (!manifest.pi) {
    for (const [dir, key] of [
      ['extensions', 'extensions'],
      ['skills',     'skills'],
      ['prompts',    'prompts'],
      ['themes',     'themes'],
    ]) {
      const d = join(installDir, dir);
      if (existsSync(d) && statSync(d).isDirectory()) {
        result[key] = [d];
      }
    }
  }

  return result;
}

// ── Install ───────────────────────────────────────────────────────────────────

/**
 * Install a plugin package.
 * @param source  Package source string (npm:pkg, git:host/user/repo, https://...)
 * @param onLine  Optional callback receiving progress lines
 */
export async function install(source, onLine) {
  const parsed     = parseSource(source);
  const installDir = parsed.type === 'npm'
    ? join(NPM_DIR, parsed.name.replace(/\//g, path_sep_npm))
    : join(GIT_DIR, parsed.name);

  onLine?.(`Installing ${source}…`);

  if (parsed.type === 'npm') {
    // Install via npm into its own directory
    mkdirSync(installDir, { recursive: true });
    const pkg = parsed.version
      ? `${parsed.name}@${parsed.version}`
      : parsed.name;
    // Use --prefix to install into the plugin directory
    await runCommand('npm', [
      'install', '--ignore-scripts', '--prefix', installDir, pkg,
    ], { onLine });
  } else {
    // Clone via git
    if (existsSync(installDir)) {
      // Already cloned — update
      onLine?.('Directory exists, pulling latest…');
      await runCommand('git', ['pull', '--ff-only'], { cwd: installDir, onLine });
    } else {
      await runCommand('git', ['clone', '--depth', '1', parsed.url, installDir], { onLine });
    }
    if (parsed.ref) {
      await runCommand('git', ['checkout', parsed.ref], { cwd: installDir, onLine });
    }
    // Install npm dependencies if package.json exists
    if (existsSync(join(installDir, 'package.json'))) {
      onLine?.('Installing npm dependencies…');
      await runCommand('npm', ['install', '--ignore-scripts', '--omit=dev'], {
        cwd: installDir, onLine,
      });
    }
  }

  // Discover resources in the installed package
  const pkgRootDir = parsed.type === 'npm'
    ? join(installDir, 'node_modules', parsed.name)
    : installDir;

  const resources = existsSync(pkgRootDir)
    ? discoverResources(pkgRootDir)
    : discoverResources(installDir);

  const entry = {
    source,
    type:       parsed.type,
    name:       parsed.name,
    version:    parsed.version,
    installDir: parsed.type === 'npm' ? pkgRootDir : installDir,
    resources,
    installedAt: new Date().toISOString(),
    enabled:    true,
  };

  addToIndex(entry);
  onLine?.(`✅ Installed ${source}`);
  return entry;
}

// ── path_sep helper (npm scoped package '@scope/name' → 'scope__name') ───────
const path_sep_npm = (s) => s.replace(/\//g, '__');

// ── Remove ────────────────────────────────────────────────────────────────────

export async function remove(source) {
  const parsed = parseSource(source);
  const entry  = readIndex().find(e => e.source === source);

  if (!entry) throw new Error(`Plugin '${source}' is not installed`);

  const dir = parsed.type === 'npm'
    ? join(NPM_DIR, parsed.name.replace(/\//g, '__'))
    : join(GIT_DIR, parsed.name);

  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  removeFromIndex(source);
}

// ── List ──────────────────────────────────────────────────────────────────────

export function list() {
  return readIndex();
}

// ── Enable / disable ──────────────────────────────────────────────────────────

export function setEnabled(source, enabled) {
  const idx     = readIndex();
  const entry   = idx.find(e => e.source === source);
  if (!entry) throw new Error(`Plugin '${source}' not found`);
  entry.enabled = enabled;
  writeIndex(idx);
}

// ── Get resource paths for all enabled plugins ────────────────────────────────
// Used by agent.js to load extensions/skills/prompts from installed packages.

export function getEnabledResources() {
  const result = { extensions: [], skills: [], prompts: [], themes: [] };
  for (const entry of readIndex()) {
    if (!entry.enabled || !entry.resources) continue;
    for (const key of ['extensions', 'skills', 'prompts', 'themes']) {
      result[key].push(...(entry.resources[key] ?? []));
    }
  }
  return result;
}

// ── Search npm for pi packages ────────────────────────────────────────────────

export async function searchNpm(query = 'pi-package') {
  try {
    const out = await runCommand('npm', [
      'search', '--json', query, '--searchlimit', '20',
    ]);
    const results = JSON.parse(out);
    return results.map(r => ({
      name:        r.name,
      version:     r.version,
      description: r.description,
      keywords:    r.keywords ?? [],
      source:      `npm:${r.name}`,
    }));
  } catch { return []; }
}
