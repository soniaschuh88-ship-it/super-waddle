# bKG — TASKS

> Active work, current sprint, and roadmap.
> Completed work → `docs/PROGRESS.md` · Enhancements detail → `docs/UPDATE.md`

---

## ✅ Sprint Completed

All original sprint items are shipped. Checked off below:

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| E1 | SSE Real-time Board Updates | ✅ Done | `GET /flow/events`, FlowBoard subscribes via EventSource |
| E2 | Drag-and-drop board reorder | ✅ Done | `draggable` + `onDrop` in FlowBoard |
| E3 | Flow → Agent Execution Bridge | ✅ Done | "Run with Agent" in FlowTask, creates Hub session |
| E4 | Git Branch Per Task | ✅ Done | `flow/<task-id>` on move to in-progress |
| E5 | Column +N today stats | ✅ Done | `todayCount` in board columns |
| E6 | Provider key health-check | ✅ Done | `POST /providers/:id/test` |
| E7 | Rate Limit SQLite Persistence | ✅ Done | `checkAndIncrRateLimit()` uses SQLite table |
| E8 | Task labels UI | ✅ Done | `LabelsEditor` component in FlowTask |
| E9 | API key chip in Dashboard | ✅ Done | `UserKeyChip` component in Dashboard |
| E10 | Board keyboard shortcuts | ✅ Done | `N` new task · `/` focus search · `Esc` close |
| E11 | Provider 429 Retry | ✅ Done | `Retry-After` retry loop in `/providers/proxy` |
| E14 | Flow export (MD/CSV) | ✅ Done | `GET /flow/export/:projectId?format=` |
| E15 | Install missing agents | ✅ Done | `POST /hub/agents/:id/install` |
| E17 | Mission autopilot | ✅ Done | Auto-advance milestone on task done |
| E18 | Webhook triggers | ✅ Done | `POST /flow/webhook/:projectId` |
| A1 | WAL Checkpointing | ✅ Done | `setInterval wal_checkpoint(TRUNCATE)` in bkg-flow.js |
| A3 | Structured Error Responses | ✅ Done | `apiErr()` helper + global error handler middleware |
| A4 | Request ID Tracing | ✅ Done | `X-Request-Id` on every response |
| A5 | DB Integrity Check | ✅ Done | `PRAGMA integrity_check` in `setImmediate` at startup |
| G1–G7 | Game Creation System | ✅ Done | Full blueprint wizard, MMO panel, game client, world builder |
| E16 | Mobile bottom tab nav | ✅ Done | 5-item fixed bottom nav bar on mobile (`sm:hidden`) |

---

## 🔴 Active Sprint

### E12 — Hub shell history tab
Filter agent session events to show only terminal/exec output in a dedicated tab.
`AgentHub.tsx` → new "Terminal" tab showing only `exec`/`shell` type events.

### A2 — Session JSONL compression
Gzip session event logs older than 24h to reduce disk usage.
`server/serve.js` → nightly `setInterval` to compress JSONL files.

### E13 — Light theme toggle
CSS variable swap for a light `#f8f9fa` base theme.
`AppShell.tsx` + `index.css` → toggle via localStorage.

---

## 🟡 Backlog

| ID | Feature | Effort | Notes |
|----|---------|--------|-------|
| E20 | Provider model search/filter | S | Filter the 100+ NVIDIA models by name |
| E21 | Flow board swimlanes | M | Group tasks by assignee or milestone |
| E22 | Task time-tracking | M | Start/stop timer per task |
| E23 | Voxel world screenshot | S | Canvas `toDataURL()` → download |
| E24 | Blueprint AI batch generate | M | Generate all 8 sections in one click |
| E25 | MMO player statistics | M | Real-time player count per zone |
| M1 | Event replay mode | L | JSONL timeline scrubber |
| M2 | Agent memory layer | L | `/flow/tasks/:id/memory` |
| M3 | Conflict detection engine | L | File collision detection |
| M4 | Execution cost layer | M | Token tracking per task |

---

## ⚠️ Known Issues

| ID | Issue | Severity |
|----|-------|----------|
| K2 | Ghost sandbox-agent processes on dev ports 2468–2470 | Low |
| K7 | Pi event poll 300ms fixed, may miss burst events | Low |
| K9 | Very long task titles overflow at 320px | Cosmetic |

---

## Architecture Principles

> **Everything is a phase in one execution pipeline:**
> `Idea → Task → PROMPT.md → Agent Session → FS Changes → Eval → Loop`

- Flow = planning layer
- Hub = execution layer
- Agent = runtime layer
- Providers = inference layer
- Git = isolation layer

All layers show a **single coherent chain** in the UI, not separate tools.

---

## Core Loop (current state)

```
[New Idea]
    ↓
[Flow: Create Task]         ← N shortcut · webhook · game wizard
    ↓
[AI: Generate PROMPT.md]   ← /providers/proxy streaming
    ↓
[Flow → Agent: "Run"]      ← E3: Hub session seeded with plan
    ↓
[Hub: Execute]             ← Pi / Claude Code / Codex / Amp
    ↓
[FS: flow/<task-id> branch]← E4: git checkout -b
    ↓
[Eval: Score + evidence]   ← task evals (0-100)
    ↓
[Flow: SSE push → done]    ← E1: live update to all open tabs
    ↓
[Repeat or Archive]
```
