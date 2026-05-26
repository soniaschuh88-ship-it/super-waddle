/**
 * server/bkg-flow.js — bKG Flow
 *
 * AI-powered task and workflow management.
 * Rebranded/refactored from the Fusion project management system.
 *
 * Features implemented:
 *   • Task lifecycle  (planning→todo→in-progress→review→done→archived)
 *   • Kanban columns  with deterministic ordering
 *   • Task planning   via AI (generates PROMPT.md)
 *   • Task execution  via bKG Agent Hub sessions
 *   • Task dependencies (DAG, cycle detection)
 *   • Projects        (isolated per project with SQLite)
 *   • Workflow steps  (plan → execute → review phases)
 *   • Task comments   with timestamps
 *   • Full-text search
 *   • Git branch per  task (fusion/{task-id})
 *   • Mission hierarchy (Mission → Milestone → Task)
 *   • Task logs       (SSE streaming)
 *   • Settings        (global + project-scoped)
 *   • Activity feed
 *   • Secrets store   (AES-256-GCM)
 *   • Evaluations     (task quality scoring)
 *
 * Database: better-sqlite3 at ~/.bkg/flow.db
 */

import Database   from 'better-sqlite3';
import { join }   from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const BKG_DIR  = process.env.BKG_DIR ?? join(homedir(), '.bkg');
const DB_PATH  = process.env.BKG_FLOW_DB ?? join(BKG_DIR, 'flow.db');

mkdirSync(BKG_DIR, { recursive: true });

// ── Database setup ─────────────────────────────────────────────────────────────

const db = new Database(DB_PATH, { verbose: null });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');   // Good balance for WAL mode

// A1 — WAL checkpoint every 5 minutes to prevent unbounded WAL growth
setInterval(() => {
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /**/ }
}, 5 * 60 * 1000).unref();

// A5 — Integrity check at startup (non-blocking, logs result)
setImmediate(() => {
  try {
    const result = db.pragma('integrity_check');
    const ok     = result?.[0]?.integrity_check === 'ok';
    if (!ok) {
      console.error('[bkg-flow] ⚠️  SQLite integrity check FAILED:', result);
    }
  } catch (e) {
    console.error('[bkg-flow] integrity check error:', e.message);
  }
});

// ── Schema migrations ─────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    path        TEXT DEFAULT '',
    color       TEXT DEFAULT '#00e5ff',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    archived    INTEGER DEFAULT 0,
    settings    TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS missions (
    id          TEXT PRIMARY KEY,
    project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    status      TEXT DEFAULT 'active',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS milestones (
    id          TEXT PRIMARY KEY,
    mission_id  TEXT REFERENCES missions(id) ON DELETE CASCADE,
    project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
    mission_id  TEXT REFERENCES missions(id) ON DELETE SET NULL,
    milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    status      TEXT DEFAULT 'todo'
                CHECK(status IN ('planning','todo','in-progress','review','done','archived')),
    priority    INTEGER DEFAULT 50,
    order_index INTEGER DEFAULT 0,
    branch      TEXT DEFAULT '',
    prompt_md   TEXT DEFAULT '',
    exec_model  TEXT DEFAULT '',
    plan_model  TEXT DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    started_at  INTEGER,
    done_at     INTEGER,
    agent_session TEXT DEFAULT '',
    pause_reason  TEXT DEFAULT '',
    labels      TEXT DEFAULT '[]',
    metadata    TEXT DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_project   ON tasks(project_id, status, order_index);
  CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status);

  CREATE TABLE IF NOT EXISTS task_deps (
    task_id   TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    dep_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, dep_id)
  );

  CREATE TABLE IF NOT EXISTS task_comments (
    id         TEXT PRIMARY KEY,
    task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    author     TEXT DEFAULT 'user',
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_logs (
    id         TEXT PRIMARY KEY,
    task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    level      TEXT DEFAULT 'info',
    message    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id, created_at);

  CREATE TABLE IF NOT EXISTS workflow_steps (
    id          TEXT PRIMARY KEY,
    task_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    phase       TEXT DEFAULT 'execute'
                CHECK(phase IN ('plan','execute','review')),
    status      TEXT DEFAULT 'pending'
                CHECK(status IN ('pending','running','done','failed','skipped')),
    output      TEXT DEFAULT '',
    started_at  INTEGER,
    done_at     INTEGER,
    order_index INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS activity (
    id         TEXT PRIMARY KEY,
    project_id TEXT,
    task_id    TEXT,
    type       TEXT NOT NULL,
    actor      TEXT DEFAULT 'system',
    payload    TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS secrets (
    id         TEXT PRIMARY KEY,
    project_id TEXT,
    name       TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    nonce      TEXT NOT NULL,
    scope      TEXT DEFAULT 'project',
    policy     TEXT DEFAULT 'auto',
    created_at INTEGER NOT NULL,
    UNIQUE(project_id, name)
  );

  CREATE TABLE IF NOT EXISTS evaluations (
    id         TEXT PRIMARY KEY,
    task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    score      REAL DEFAULT 0,
    band       TEXT DEFAULT 'unrated',
    evidence   TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL
  );

  -- E7: Persistent rate-limit counters (survive server restart)
  CREATE TABLE IF NOT EXISTS rate_limits (
    ip           TEXT PRIMARY KEY,
    count        INTEGER DEFAULT 0,
    window_start INTEGER NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
    id, title, description, prompt_md,
    content='tasks', content_rowid='rowid',
    tokenize='porter unicode61'
  );
`);

// ── Trigger: keep FTS in sync ─────────────────────────────────────────────────

db.exec(`
  CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
    INSERT INTO tasks_fts(rowid, id, title, description, prompt_md)
    VALUES (new.rowid, new.id, new.title, new.description, new.prompt_md);
  END;
  CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
    INSERT INTO tasks_fts(tasks_fts, rowid, id, title, description, prompt_md)
    VALUES ('delete', old.rowid, old.id, old.title, old.description, old.prompt_md);
    INSERT INTO tasks_fts(rowid, id, title, description, prompt_md)
    VALUES (new.rowid, new.id, new.title, new.description, new.prompt_md);
  END;
  CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
    INSERT INTO tasks_fts(tasks_fts, rowid, id, title, description, prompt_md)
    VALUES ('delete', old.rowid, old.id, old.title, old.description, old.prompt_md);
  END;
`);

// Seed a default project if none exist
const projectCount = db.prepare('SELECT COUNT(*) as c FROM projects').get();
if (projectCount.c === 0) {
  db.prepare(`INSERT INTO projects (id, name, description, path, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'default', 'bKG Default', 'Default workspace project',
    process.cwd(), '#00e5ff', Date.now(), Date.now(),
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const now   = () => Date.now();
const uid   = () => randomUUID().replace(/-/g, '').slice(0, 16);

function parseJson(s, fallback = {}) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function activityLog(projectId, taskId, type, payload = {}) {
  db.prepare(`INSERT INTO activity (id, project_id, task_id, type, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    uid(), projectId, taskId, type, JSON.stringify(payload), now(),
  );
}

// ── Project CRUD ──────────────────────────────────────────────────────────────

export function listProjects() {
  return db.prepare('SELECT * FROM projects WHERE archived=0 ORDER BY created_at ASC').all();
}

export function getProject(id) {
  return db.prepare('SELECT * FROM projects WHERE id=?').get(id) ?? null;
}

export function createProject(data) {
  const id = data.id ?? uid();
  db.prepare(`INSERT INTO projects (id, name, description, path, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id, data.name, data.description ?? '', data.path ?? process.cwd(),
    data.color ?? '#00e5ff', now(), now(),
  );
  return getProject(id);
}

export function updateProject(id, data) {
  const cols = ['name','description','path','color','settings']
    .filter(k => k in data)
    .map(k => `${k}=?`);
  if (!cols.length) return getProject(id);
  db.prepare(`UPDATE projects SET ${cols.join(',')}, updated_at=? WHERE id=?`)
    .run(...cols.map(c => c.split('=')[0]).map(k => typeof data[k] === 'object' ? JSON.stringify(data[k]) : data[k]), now(), id);
  return getProject(id);
}

export function archiveProject(id) {
  db.prepare('UPDATE projects SET archived=1, updated_at=? WHERE id=?').run(now(), id);
}

// ── Task CRUD ─────────────────────────────────────────────────────────────────

function taskRow(row) {
  if (!row) return null;
  return {
    ...row,
    labels:   parseJson(row.labels, []),
    metadata: parseJson(row.metadata, {}),
    dependencyIds: db.prepare('SELECT dep_id FROM task_deps WHERE task_id=?')
      .all(row.id).map(r => r.dep_id),
  };
}

export function listTasks(projectId, opts = {}) {
  let q = 'SELECT * FROM tasks WHERE project_id=?';
  const args = [projectId];
  if (opts.status)    { q += ' AND status=?'; args.push(opts.status); }
  if (opts.missionId) { q += ' AND mission_id=?'; args.push(opts.missionId); }
  if (!opts.archived) { q += " AND status!='archived'"; }
  q += ' ORDER BY order_index ASC, created_at ASC';
  return db.prepare(q).all(...args).map(taskRow);
}

export function getTask(id) {
  return taskRow(db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
}

// ── Board SSE pub/sub (E1 — real-time updates) ────────────────────────────────

/** Map<projectId, Set<fn>> — live browser sessions subscribed to board events */
const _boardSubscribers = new Map();

/**
 * Subscribe to board events for a project.
 * @param {string} projectId
 * @param {function} fn  called with { type, task, taskId }
 * @returns {function} unsubscribe
 */
export function subscribeBoardEvents(projectId, fn) {
  if (!_boardSubscribers.has(projectId)) _boardSubscribers.set(projectId, new Set());
  _boardSubscribers.get(projectId).add(fn);
  return () => _boardSubscribers.get(projectId)?.delete(fn);
}

/** Publish a board event to all subscribers for a project */
function emitBoard(projectId, type, task) {
  _boardSubscribers.get(projectId)?.forEach(fn => {
    try { fn({ type, task }); } catch { /**/ }
  });
}

export function createTask(data) {
  const id = uid();
  const projectId = data.projectId ?? data.project_id ?? 'default';
  const maxOrder = db.prepare('SELECT MAX(order_index) AS m FROM tasks WHERE project_id=?').get(projectId)?.m ?? 0;

  db.prepare(`INSERT INTO tasks
    (id, project_id, mission_id, milestone_id, title, description, status,
     priority, order_index, branch, prompt_md, exec_model, plan_model,
     created_at, updated_at, labels, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    projectId,
    data.missionId ?? null,
    data.milestoneId ?? null,
    data.title,
    data.description ?? '',
    data.status ?? 'todo',
    data.priority ?? 50,
    maxOrder + 1,
    `flow/${id}`,
    data.promptMd ?? '',
    data.execModel ?? '',
    data.planModel ?? '',
    now(), now(),
    JSON.stringify(data.labels ?? []),
    JSON.stringify(data.metadata ?? {}),
  );
  activityLog(projectId, id, 'task.created', { title: data.title });
  const created = getTask(id);
  emitBoard(projectId, 'task.created', created);
  return created;
}

export function updateTask(id, data) {
  const allowed = ['title','description','status','priority','order_index','prompt_md',
    'exec_model','plan_model','agent_session','pause_reason','started_at','done_at',
    'mission_id','milestone_id','labels','metadata'];
  const rawCols = Object.keys(data).filter(k => allowed.includes(k));
  const cols    = rawCols.map(k => `${k}=?`);
  const values  = rawCols.map(k =>
    (k === 'labels' || k === 'metadata') ? JSON.stringify(data[k]) : data[k],
  );
  if (!cols.length) return getTask(id);

  // Track status transitions
  if (data.status) {
    const old = db.prepare('SELECT status, project_id FROM tasks WHERE id=?').get(id);
    if (old && old.status !== data.status) {
      activityLog(old.project_id, id, 'task.status_changed', { from: old.status, to: data.status });
      if (data.status === 'in-progress' && !data.started_at) {
        cols.push('started_at=?'); values.push(now());
      }
      if (data.status === 'done' && !data.done_at) {
        cols.push('done_at=?'); values.push(now());
      }
    }
  }

  db.prepare(`UPDATE tasks SET ${cols.join(',')}, updated_at=? WHERE id=?`)
    .run(...values, now(), id);
  const updated = getTask(id);
  if (updated) emitBoard(updated.project_id, 'task.updated', updated);
  return updated;
}

export function deleteTask(id) {
  const t = getTask(id);
  if (!t) return false;
  emitBoard(t.project_id, 'task.deleted', { id, project_id: t.project_id, title: t.title });
  db.prepare('DELETE FROM tasks WHERE id=?').run(id);
  activityLog(t.project_id, id, 'task.deleted', { title: t.title });
  return true;
}

export function moveTask(id, newStatus, targetIndex = null) {
  const updates = { status: newStatus };
  if (targetIndex !== null) updates.order_index = targetIndex;
  return updateTask(id, updates);
}

// ── Task search (FTS) ─────────────────────────────────────────────────────────

export function searchTasks(projectId, query) {
  const escaped = query.replace(/['"]/g, '');
  try {
    const rows = db.prepare(`
      SELECT tasks.* FROM tasks
      JOIN tasks_fts ON tasks.id = tasks_fts.id
      WHERE tasks.project_id=? AND tasks_fts MATCH ?
      ORDER BY rank LIMIT 50
    `).all(projectId, `${escaped}*`);
    return rows.map(taskRow);
  } catch {
    // Fallback to LIKE search
    return db.prepare(`
      SELECT * FROM tasks WHERE project_id=?
      AND (title LIKE ? OR description LIKE ?)
      LIMIT 50
    `).all(projectId, `%${query}%`, `%${query}%`).map(taskRow);
  }
}

// ── Task dependencies ─────────────────────────────────────────────────────────

export function addDependency(taskId, depId) {
  // Cycle detection: BFS from depId, check if taskId is reachable
  const visited = new Set([taskId]);
  const queue   = [depId];
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur)) return { error: 'Dependency would create a cycle' };
    visited.add(cur);
    const deps = db.prepare('SELECT dep_id FROM task_deps WHERE task_id=?').all(cur);
    queue.push(...deps.map(r => r.dep_id));
  }
  db.prepare('INSERT OR IGNORE INTO task_deps (task_id, dep_id) VALUES (?, ?)').run(taskId, depId);
  return { ok: true };
}

export function removeDependency(taskId, depId) {
  db.prepare('DELETE FROM task_deps WHERE task_id=? AND dep_id=?').run(taskId, depId);
  return { ok: true };
}

// ── Task comments ─────────────────────────────────────────────────────────────

export function getComments(taskId) {
  return db.prepare('SELECT * FROM task_comments WHERE task_id=? ORDER BY created_at ASC').all(taskId);
}

export function addComment(taskId, body, author = 'user') {
  const id = uid();
  db.prepare('INSERT INTO task_comments (id, task_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, taskId, author, body, now());
  return db.prepare('SELECT * FROM task_comments WHERE id=?').get(id);
}

// ── Task logs ─────────────────────────────────────────────────────────────────

export function appendLog(taskId, message, level = 'info') {
  db.prepare('INSERT INTO task_logs (id, task_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uid(), taskId, level, message, now());
  // Notify SSE subscribers
  _logSubscribers.get(taskId)?.forEach(fn => fn({ level, message, ts: now() }));
}

export function getTaskLogs(taskId, since = 0) {
  return db.prepare('SELECT * FROM task_logs WHERE task_id=? AND created_at>? ORDER BY created_at ASC')
    .all(taskId, since);
}

const _logSubscribers = new Map();

export function subscribeTaskLogs(taskId, fn) {
  if (!_logSubscribers.has(taskId)) _logSubscribers.set(taskId, new Set());
  _logSubscribers.get(taskId).add(fn);
  return () => _logSubscribers.get(taskId)?.delete(fn);
}

// ── Workflow steps ─────────────────────────────────────────────────────────────

export function getWorkflowSteps(taskId) {
  return db.prepare('SELECT * FROM workflow_steps WHERE task_id=? ORDER BY order_index ASC').all(taskId);
}

export function addWorkflowStep(taskId, data) {
  const id = uid();
  const maxOrder = db.prepare('SELECT MAX(order_index) AS m FROM workflow_steps WHERE task_id=?').get(taskId)?.m ?? 0;
  db.prepare(`INSERT INTO workflow_steps (id, task_id, title, phase, status, order_index)
    VALUES (?, ?, ?, ?, 'pending', ?)`).run(
    id, taskId, data.title, data.phase ?? 'execute', maxOrder + 1,
  );
  return db.prepare('SELECT * FROM workflow_steps WHERE id=?').get(id);
}

export function updateWorkflowStep(id, data) {
  const cols = ['title','phase','status','output','started_at','done_at'].filter(k => k in data);
  if (!cols.length) return;
  db.prepare(`UPDATE workflow_steps SET ${cols.map(c=>`${c}=?`).join(',')} WHERE id=?`)
    .run(...cols.map(c => data[c]), id);
  return db.prepare('SELECT * FROM workflow_steps WHERE id=?').get(id);
}

// ── Missions ──────────────────────────────────────────────────────────────────

export function listMissions(projectId) {
  return db.prepare('SELECT * FROM missions WHERE project_id=? ORDER BY created_at ASC').all(projectId);
}

export function getMission(id) {
  return db.prepare('SELECT * FROM missions WHERE id=?').get(id) ?? null;
}

export function createMission(data) {
  const id = uid();
  db.prepare('INSERT INTO missions (id, project_id, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, data.projectId, data.title, data.description ?? '', 'active', now(), now());
  return getMission(id);
}

export function updateMission(id, data) {
  const cols = ['title','description','status'].filter(k => k in data);
  if (!cols.length) return getMission(id);
  db.prepare(`UPDATE missions SET ${cols.map(c=>`${c}=?`).join(',')}, updated_at=? WHERE id=?`)
    .run(...cols.map(c => data[c]), now(), id);
  return getMission(id);
}

// ── Milestones ────────────────────────────────────────────────────────────────

export function listMilestones(missionId) {
  return db.prepare('SELECT * FROM milestones WHERE mission_id=? ORDER BY order_index ASC').all(missionId);
}

export function createMilestone(data) {
  const id = uid();
  const maxOrder = db.prepare('SELECT MAX(order_index) AS m FROM milestones WHERE mission_id=?').get(data.missionId)?.m ?? 0;
  db.prepare('INSERT INTO milestones (id, mission_id, project_id, title, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, data.missionId, data.projectId, data.title, maxOrder + 1, now());
  return db.prepare('SELECT * FROM milestones WHERE id=?').get(id);
}

// ── Activity feed ─────────────────────────────────────────────────────────────

export function getActivity(projectId, limit = 50) {
  return db.prepare('SELECT * FROM activity WHERE project_id=? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit).map(r => ({ ...r, payload: parseJson(r.payload) }));
}

// ── Secrets (AES-256-GCM) ─────────────────────────────────────────────────────

const MASTER_KEY = process.env.BKG_MASTER_KEY
  ? Buffer.from(process.env.BKG_MASTER_KEY, 'hex')
  : scryptSync('bkg-default-master-key', 'salt-bkg-flow', 32);

function encrypt(text) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', MASTER_KEY, nonce);
  const ct = Buffer.concat([cipher.update(text, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([ct, tag]).toString('base64'),
    nonce:      nonce.toString('base64'),
  };
}

function decrypt(ciphertext, nonce) {
  const buf    = Buffer.from(ciphertext, 'base64');
  const nonceB = Buffer.from(nonce, 'base64');
  const tag    = buf.slice(buf.length - 16);
  const ct     = buf.slice(0, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', MASTER_KEY, nonceB);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
}

export function listSecrets(projectId) {
  return db.prepare('SELECT id, project_id, name, scope, policy, created_at FROM secrets WHERE project_id=?')
    .all(projectId);
}

export function setSecret(projectId, name, value, policy = 'auto') {
  const { ciphertext, nonce } = encrypt(value);
  db.prepare(`INSERT INTO secrets (id, project_id, name, ciphertext, nonce, policy, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, name) DO UPDATE SET ciphertext=excluded.ciphertext, nonce=excluded.nonce`)
    .run(uid(), projectId, name, ciphertext, nonce, policy, now());
  return { ok: true, name };
}

export function getSecretValue(projectId, name) {
  const row = db.prepare('SELECT ciphertext, nonce FROM secrets WHERE project_id=? AND name=?')
    .get(projectId, name);
  if (!row) throw new Error(`Secret '${name}' not found`);
  return decrypt(row.ciphertext, row.nonce);
}

export function deleteSecret(projectId, name) {
  db.prepare('DELETE FROM secrets WHERE project_id=? AND name=?').run(projectId, name);
  return { ok: true };
}

// ── Evaluations ───────────────────────────────────────────────────────────────

export function createEval(taskId, score, evidence = {}) {
  const band = score >= 90 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor';
  const id   = uid();
  db.prepare('INSERT INTO evaluations (id, task_id, score, band, evidence, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, taskId, score, band, JSON.stringify(evidence), now());
  return db.prepare('SELECT * FROM evaluations WHERE id=?').get(id);
}

export function getEvals(taskId) {
  return db.prepare('SELECT * FROM evaluations WHERE task_id=? ORDER BY created_at DESC').all(taskId)
    .map(r => ({ ...r, evidence: parseJson(r.evidence) }));
}

// ── Board layout (Kanban) ─────────────────────────────────────────────────────

const COLUMNS = [
  { id: 'planning',    label: 'Planning',    color: '#a855f7' },
  { id: 'todo',        label: 'Todo',        color: '#4a6880' },
  { id: 'in-progress', label: 'In Progress', color: '#00e5ff' },
  { id: 'review',      label: 'Review',      color: '#ffb300' },
  { id: 'done',        label: 'Done',        color: '#00e5a0' },
];

export function getBoardData(projectId) {
  const tasks = listTasks(projectId);
  const columns = COLUMNS.map(col => ({
    ...col,
    tasks: tasks.filter(t => t.status === col.id)
      .sort((a, b) => (a.order_index - b.order_index) || (a.created_at - b.created_at)),
  }));
  return {
    projectId,
    columns,
    totals: Object.fromEntries(columns.map(c => [c.id, c.tasks.length])),
  };
}

// ── AI task planning ──────────────────────────────────────────────────────────

/**
 * Generate a PROMPT.md for a task using the configured model.
 * This is called from the /flow/tasks/:id/plan endpoint.
 * The actual LLM call is done in serve.js (which has the model registry).
 *
 * Returns a template that serve.js fills in with LLM output.
 */
export function buildPlanningPrompt(task, project) {
  return {
    system: `You are a senior software engineer and AI task planner for the bKG coding workspace.
Your job is to analyze a task description and produce a detailed PROMPT.md planning document.

PROMPT.md format:
# Task: {title}

## Objective
Clear statement of what needs to be accomplished.

## Context
Relevant background information.

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
...

## Implementation Steps
1. Step description
   - Sub-step
   - Sub-step
2. Step description
...

## File Scope
Files likely to be created or modified.

## Notes
Any special considerations, risks, or dependencies.

Return ONLY the PROMPT.md content. No commentary.`,
    user: `Project: ${project?.name ?? 'bKG'}
Task: ${task.title}
Description: ${task.description || '(no description)'}
Labels: ${task.labels?.join(', ') || 'none'}

Generate the PROMPT.md planning document for this task.`,
  };
}

export function savePlanMd(taskId, promptMd) {
  updateTask(taskId, { prompt_md: promptMd, status: 'todo' });
  appendLog(taskId, 'Planning complete — PROMPT.md generated', 'info');
  return getTask(taskId);
}

// ── Health ────────────────────────────────────────────────────────────────────

// ── E7: Persistent rate limiting ─────────────────────────────────────────────

const RATE_WINDOW = 60 * 60 * 1000; // 1 hour in ms
const RATE_LIMIT  = 3;

export function checkAndIncrRateLimit(ip) {
  const now  = Date.now();
  const row  = db.prepare('SELECT count, window_start FROM rate_limits WHERE ip=?').get(ip);

  if (!row) {
    db.prepare('INSERT INTO rate_limits (ip, count, window_start) VALUES (?,?,?)').run(ip, 1, now);
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }

  // Reset if window expired
  if (now - row.window_start >= RATE_WINDOW) {
    db.prepare('UPDATE rate_limits SET count=1, window_start=? WHERE ip=?').run(now, ip);
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }

  if (row.count >= RATE_LIMIT) {
    const resetIn = Math.ceil((row.window_start + RATE_WINDOW - now) / 60000);
    return { allowed: false, remaining: 0, resetIn };
  }

  db.prepare('UPDATE rate_limits SET count=count+1 WHERE ip=?').run(ip);
  return { allowed: true, remaining: RATE_LIMIT - row.count - 1 };
}

// ── Stats (E5 — column throughput) ───────────────────────────────────────────

/**
 * Returns { [status]: count } of task status transitions since `since` timestamp.
 * Used by FlowBoard column headers to show "+N today" throughput badges.
 */
export function getFlowStats(projectId, since = Date.now() - 86400000) {
  const rows = db.prepare(`
    SELECT json_extract(payload, '$.to') AS status, COUNT(*) AS cnt
    FROM   activity
    WHERE  project_id=?
      AND  type='task.status_changed'
      AND  created_at >= ?
    GROUP BY status
  `).all(projectId, since);

  const result = {};
  for (const r of rows) {
    if (r.status) result[r.status] = r.cnt;
  }
  return result;
}

export function flowHealth() {
  const taskCount    = db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status!='archived'").get().c;
  const projectCount = db.prepare('SELECT COUNT(*) AS c FROM projects WHERE archived=0').get().c;
  const missionCount = db.prepare('SELECT COUNT(*) AS c FROM missions').get().c;
  return {
    name:          'bKG Flow',
    version:       '1.0.0',
    description:   'AI-powered task and workflow management',
    dbPath:        DB_PATH,
    activeTasks:   taskCount,
    projects:      projectCount,
    missions:      missionCount,
    columns:       COLUMNS.map(c => c.id),
    features:      [
      'task-lifecycle', 'kanban', 'ai-planning', 'dependencies',
      'missions', 'milestones', 'workflow-steps', 'comments',
      'activity-feed', 'full-text-search', 'secrets-aes256', 'evaluations',
    ],
  };
}
