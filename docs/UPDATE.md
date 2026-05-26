# bKG — Update Plan & Feature Enhancements

> Proposed improvements, new features, and architecture upgrades.
> Based on full system testing — May 2026.

---

## Bug Fixes Applied This Session

### ✅ K13 — Agent routes now protected
`/agent/*` endpoints (session create, message, poll, events, abort, delete, list)
now require a valid bearer token (`agent | inference | admin` scope).
Self-registered user keys (from onboarding) automatically receive `agent` scope
so they can access both plan-generator inference and coding-agent sessions.

```
Before: GET /agent/sessions → 200 (no auth, world-readable)
After:  GET /agent/sessions → 401 without Authorization header
        GET /agent/sessions → 200 with Bearer bkg_<key>
```

### ✅ K6 fix — requireApiKey scope logic corrected
Self-registered keys were given `inference` scope but agentAuth only accepted
`agent | admin`. Updated both: `self-register` now grants `agent` scope,
and `agentAuth` accepts `inference | agent | admin` so old keys still work.

---

## What Was Tested & Passes

| System | Test | Result |
|--------|------|--------|
| Server | Health + readiness probes | ✅ |
| Auth | Login, token verify, bad password rejection | ✅ |
| Auth | Token persists across session (JWT_SECRET set) | ✅ |
| API Keys | Create, list, scope check, self-register | ✅ |
| API Keys | Rate limit (3/hr per IP enforced) | ✅ |
| Providers | 19 providers listed with correct tiers | ✅ |
| Flow | Full task lifecycle (create→move→comment→step→eval→delete) | ✅ |
| Flow | BFS cycle detection for task dependencies | ✅ |
| Flow | FTS5 search with porter stemming ("webgpu" finds "WebGPU model loading fix") | ✅ |
| Flow | Secrets stored without value in list response (AES-256-GCM) | ✅ |
| Flow | Activity feed appends on task create/move/delete | ✅ |
| Flow | Missions + milestones CRUD | ✅ |
| Flow | Project CRUD (create/update/list) | ✅ |
| Flow | Route ordering: /tasks/search resolves before /tasks/:id | ✅ |
| Hub | listAgents (Pi installed, 4 CLI agents detected as not installed) | ✅ |
| Hub | Session create + file write + file read + file list + destroy | ✅ |
| Hub | Path escape guard (workspace-scoped) | ✅ |
| Static | SPA index.html at `/` | ✅ |
| Static | `sql-wasm.wasm` served as `application/wasm` | ✅ |
| User | Per-user provider keys set + retrieved | ✅ |
| Admin | Global config GET (keys masked) | ✅ |
| Build | TypeScript compile clean (zero errors) | ✅ |

---

## Known Remaining Issues After This Fix

| ID | Issue | Severity | Plan |
|----|-------|----------|------|
| K2 | sandbox-agent ghost processes (7468/2468) in this dev session | Low | Handled: using port 7468, TCP probe prevents false "in use" |
| K3 | Self-register rate limit counter resets on server restart | Low | Move to SQLite counter table (see R2 below) |
| K7 | Pi agent event poll (300 ms fixed) may miss burst events | Low | Use Pi's native SSE when available |
| K9 | Very long task titles overflow TaskCard at 320 px | Cosmetic | Add `overflow-hidden` to card content div |
| K10 | Stage ordering math negative if 'home' somehow enters stepper | Cosmetic | Already guarded by `if (stage === 'home') return null` |

---

## Enhancement Roadmap

Sorted by **impact × effort** — highest value first.

---

### 🔴 High Priority

#### E1 — Real-time Board Updates (SSE push to Kanban)
**What**: When a task status changes (via any client, CLI, or agent), push a board update event to all open browser tabs via SSE.

**Why**: Currently users must click Refresh to see changes. Agent-driven task moves are invisible in real-time.

**How**:
```
server/bkg-flow.js:  emit('board:update', { projectId, taskId, status }) on every updateTask()
serve.js:            GET /flow/events?projectId=  → SSE stream of board events
FlowBoard.tsx:       useEffect → new EventSource('/flow/events?projectId=...')
                     on 'board:update' → setBoard(prev => merge task into column)
```

**Effort**: M · **Files**: `bkg-flow.js`, `serve.js`, `FlowBoard.tsx`

---

#### E2 — Drag-and-Drop Task Reordering
**What**: HTML5 drag-and-drop to reorder tasks within a column and move between columns.

**Why**: The current quick-move dropdown works but is slower than drag-drop for power users.

**How**:
- `onDragStart` sets `dataTransfer.setData('taskId', id)`
- Column `onDragOver` + `onDrop` compute `order_index` from mouse Y position
- `POST /flow/tasks/:id/move` with new `{ status, index }` payload
- Optimistic UI update, rollback on error

**Effort**: M · **Files**: `FlowBoard.tsx`, no server changes needed

---

#### E3 — Task Execution via Agent Hub
**What**: "Run with Agent" button on FlowTask that creates a Hub session seeded with the task's PROMPT.md.

**Why**: Closes the loop between task planning and AI execution — currently these are siloed.

**How**:
```typescript
// FlowTask.tsx
const runWithAgent = async () => {
  const session = await api.post('/hub/sessions', {
    agent: 'pi', agentMode: 'default',
    initialMessage: `Execute the following plan:\n\n${task.prompt_md}`,
    cwd: `/workspace/${task.id}`,
  });
  updateTask(task.id, { agent_session: session.id, status: 'in-progress' });
  navigate('agenthub');  // switch to Agent Hub stage
};
```

**Effort**: S · **Files**: `FlowTask.tsx`, `App.tsx`

---

#### E4 — Git Branch Per Task
**What**: When a task moves to `in-progress`, auto-create a git branch `flow/<task-id>` in the project directory.

**Why**: Fusion's core feature — isolated worktrees prevent merge conflicts between parallel tasks.

**How**:
```javascript
// serve.js — on /flow/tasks/:id/move to in-progress
if (status === 'in-progress' && task.project_id) {
  const project = getProject(task.project_id);
  if (project.path && fs.existsSync(project.path)) {
    exec(`git -C ${project.path} checkout -b flow/${task.id} 2>/dev/null || true`);
  }
}
appendLog(task.id, `Branch flow/${task.id} created`, 'info');
```

**Effort**: S · **Files**: `serve.js` (task move endpoint)

---

#### E5 — FlowBoard Column Task Count Trend
**What**: Show a small sparkline or `+N today` badge on each column header showing today's throughput.

**Why**: Gives a quick sense of team velocity without opening a separate stats view.

**How**:
- `activity` table already logs `task.status_changed` events with timestamps
- SQL: `SELECT status, COUNT(*) FROM activity WHERE type='task.status_changed' AND created_at > ? AND payload LIKE '%"to":"%'` grouped by target status
- Add `GET /flow/stats?projectId=&since=` endpoint
- Small sparkline dots (5 days × status) rendered in column headers

**Effort**: M · **Files**: `bkg-flow.js`, `serve.js`, `FlowBoard.tsx`

---

### 🟡 Medium Priority

#### E6 — Provider Key Health Check
**What**: "Test key" button in Admin → Global Providers that sends a minimal 1-token request to verify the key works.

**Why**: Currently there's no way to know if a key is valid without creating a task and running AI planning.

**How**:
```javascript
// serve.js
app.post('/providers/:id/test', async (req, res) => {
  const { key } = resolveKeyForUser(req.params.id, 'admin');
  const r = await fetch(`${p.baseUrl}/chat/completions`, {
    body: JSON.stringify({ model: DEFAULT_CLOUD_MODELS[id], messages: [{ role:'user', content:'Hi' }], max_tokens: 1 }),
    ...
  });
  res.json({ ok: r.ok, status: r.status, latencyMs: Date.now() - start });
});
```

**Effort**: S · **Files**: `serve.js`, `GlobalProviders.tsx`

---

#### E7 — Self-Register Rate Limit Persistence
**What**: Store rate limit counters in SQLite instead of in-memory Map, so they survive server restarts.

**Why**: Current in-memory counter resets on restart — allows bypass by restarting the server.

**How**:
```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT PRIMARY KEY, count INTEGER DEFAULT 0, window_start INTEGER
);
```
Replace `_selfRegCounts` Map with DB queries.

**Effort**: S · **Files**: `serve.js`

---

#### E8 — Flow Task Labels UI
**What**: Add/remove labels on tasks from the FlowTask modal (currently labels are set at creation only via API).

**Why**: Labels exist in the DB and are displayed on cards but there's no UI to manage them.

**How**:
- Add label chips with `+` button in FlowTask Overview tab
- `PUT /flow/tasks/:id` with updated `labels` array (JSON)
- Predefined label suggestions + free-form input

**Effort**: S · **Files**: `FlowTask.tsx`

---

#### E9 — Onboarding: Show API Key in User Dashboard
**What**: After onboarding, show the user's API key summary (prefix + scope) in a "My Account" section on the dashboard, with a "Re-run setup" link.

**Why**: Users forget their key or want to re-enter provider keys without going through full onboarding.

**How**:
- `GET /user/profile` already returns `keyId`, `onboarded`, `name`
- Show `bkg_<prefix>...` in a subtle chip on the dashboard footer
- "Reset provider keys" button dispatches `window.dispatchEvent(new Event('bkg:show-onboarding'))`

**Effort**: S · **Files**: `Dashboard.tsx`

---

#### E10 — Flow Board Keyboard Shortcuts
**What**: Keyboard shortcuts for common Flow actions.

| Key | Action |
|-----|--------|
| `N` | New task (focus on creation form) |
| `/` | Focus search input |
| `Esc` | Close task modal / search |
| `J` / `K` | Navigate between task cards |
| `Enter` | Open selected card |
| `→` | Move task to next status column |

**Effort**: M · **Files**: `FlowBoard.tsx`, global `useEffect` on `keydown`

---

#### E11 — Provider Proxy Retry on 429
**What**: When a provider returns HTTP 429 (rate limit), automatically retry after the `Retry-After` header delay (max 2 retries).

**Why**: Groq and NVIDIA free tiers have aggressive rate limits. Currently a 429 just propagates as an error to the user.

**How**:
```javascript
// serve.js — /providers/proxy
for (let attempt = 0; attempt < 3; attempt++) {
  const r = await fetch(...);
  if (r.status !== 429) break;
  const retryAfter = parseInt(r.headers.get('retry-after') ?? '2', 10);
  if (attempt < 2) await new Promise(r => setTimeout(r, retryAfter * 1000));
}
```

**Effort**: S · **Files**: `serve.js`

---

#### E12 — Hub: Session Exec History
**What**: Store executed commands and their outputs in the session's JSONL file, and display them in a separate "Shell History" tab in AgentHub.

**Why**: Currently command output streams live but is not distinguished from agent output in the terminal panel.

**How**:
- `execInSession` already emits `command_start / command_delta / command_done` events
- Add "Shell" filter pill to terminal panel: toggle between All events / Agent only / Shell only
- Shell history tab shows deduplicated commands with exit codes

**Effort**: S · **Files**: `AgentHub.tsx`

---

### 🟢 Low Priority / Nice-to-Have

#### E13 — Dark/Light theme toggle
**What**: Toggle between the current Atlantis Cyberpunk dark theme and a lighter "Atlantis Day" variant.

**Design**:
```
Light variant:
  base:    #f0f8ff  (pale ocean)
  surface: #e8f4fb
  accent:  #0077aa  (deep ocean blue instead of cyan)
  border:  #c0d8e8
```

**Effort**: M · **Files**: `index.css`, `tailwind.config.js`, `AppShell.tsx`

---

#### E14 — Flow: Export to Markdown / CSV
**What**: `GET /flow/export/:projectId?format=md|csv` — exports all tasks for a project.

**Why**: Useful for weekly reports, sharing with stakeholders, or backup.

**Markdown format**:
```markdown
# Project: Default
## Todo
- [ ] Task title (created 2026-05-01)
## In Progress
- [~] Another task
## Done
- [x] Completed task
```

**Effort**: S · **Files**: `serve.js` (1 new route), no frontend needed

---

#### E15 — Agent Hub: Install Missing Agents
**What**: When an agent shows `installed: false`, show an "Install" button that runs the agent's install command in a terminal.

**Agents + commands**:
```
Claude Code:  npm install -g @anthropic-ai/claude-code
Codex:        npm install -g @openai/codex
OpenCode:     npm install -g opencode-ai
```

**Effort**: S · **Files**: `AgentHub.tsx`, `serve.js` (POST /hub/agents/:id/install)

---

#### E16 — Mobile: Bottom Tab Navigation
**What**: On mobile (< 640px), replace the hamburger drawer with a persistent bottom tab bar.

**Tabs**: Home · Flow · Agents · Settings

**Why**: Bottom tabs are more thumb-friendly on phones than a drawer for the most common actions.

**Effort**: M · **Files**: `AppShell.tsx`

---

#### E17 — Flow: Mission Autopilot
**What**: When all tasks in a milestone reach `done`, automatically progress the mission to the next milestone.

**How**:
```javascript
// serve.js — after /flow/tasks/:id/move to 'done'
const milestone = task.milestone_id ? getMilestone(task.milestone_id) : null;
if (milestone) {
  const remaining = listTasks(task.project_id, { milestoneId: milestone.id })
    .filter(t => !['done','archived'].includes(t.status));
  if (remaining.length === 0) {
    appendLog(task.id, `Milestone "${milestone.title}" complete 🎉`, 'info');
    activityLog(task.project_id, null, 'milestone.completed', { milestoneId: milestone.id });
  }
}
```

**Effort**: S · **Files**: `serve.js`

---

#### E18 — Webhook Triggers for Flow
**What**: `POST /flow/webhook/:projectId` creates a task from an incoming webhook payload (GitHub issue, Jira, Slack, etc.).

**Why**: Enables external tools to drive task creation without using the UI.

**Payload mapping**:
```json
{
  "title": "{{ action.issue.title }}",
  "description": "{{ action.issue.body }}",
  "labels": ["{{ action.issue.labels[*].name }}"]
}
```

**Effort**: M · **Files**: `serve.js`, `bkg-flow.js`

---

## Architecture Improvements

### A1 — SQLite WAL Checkpointing
Schedule periodic WAL checkpoints to prevent unbounded WAL growth on long-running servers.

```javascript
// bkg-flow.js — setInterval every 5 minutes
setInterval(() => db.pragma('wal_checkpoint(TRUNCATE)'), 5 * 60 * 1000);
```

### A2 — Compress Hub Session JSONL Files
Sessions with thousands of events create large JSONL files. Add a `compress` option that gzips sessions older than 24 h.

### A3 — Structured Error Responses
All API errors should return `{ error: string, code: string, details?: object }` with machine-readable `code` values (`AUTH_REQUIRED`, `SCOPE_INSUFFICIENT`, `NOT_FOUND`, `RATE_LIMITED`, etc.).

Currently some endpoints return plain strings in `error` — standardise across all routes.

### A4 — Request ID Tracing
Add `X-Request-Id` header to every response (random UUID) and log it alongside errors for debugging.

### A5 — Flow DB Integrity Checking
Run `PRAGMA integrity_check` on startup and log result. Alert via activity feed if corruption is detected.

---

## Summary by Effort

| Effort | Items | Impact |
|--------|-------|--------|
| S (hours) | E3, E4, E6, E7, E8, E9, E11, E12, E14, E15, E17, A1, A5 | High |
| M (half-day) | E1, E2, E5, E10, E13, E16, E18, A3, A4 | High |
| L (days) | GitHub integration, Docker nodes, Tailscale tunnel | Very high |
