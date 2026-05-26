# bKG — TASKS

> Active work, current sprint, and roadmap.
> Completed work → `docs/PROGRESS.md` · Enhancements detail → `docs/UPDATE.md`

---

## 🔴 Current Sprint

### E1 — Real-time SSE Board Updates
Push task status changes to all open browser tabs via SSE.
`bkg-flow.js` → emit on `updateTask()` · `serve.js` → `GET /flow/events` · `FlowBoard.tsx` → subscribe

### E3 — Flow → Agent Execution Bridge
"Run with Agent" button on FlowTask creates a Hub session seeded with PROMPT.md.
`FlowTask.tsx` + `App.tsx` — closes the Plan → Execute loop.

### E4 — Git Branch Per Task
Auto-create `flow/<task-id>` branch when task moves to `in-progress`.
`serve.js` task-move endpoint.

### A1 — WAL Checkpointing
`setInterval(() => db.pragma('wal_checkpoint(TRUNCATE)'), 300_000)` in `bkg-flow.js`.

### A3 — Structured Error Responses
All errors: `{ error, code, details? }` with machine-readable `code` values.

### A4 — Request ID Tracing
`X-Request-Id` header on every response. Log alongside errors.

### A5 — DB Integrity Check
`PRAGMA integrity_check` at startup. Log + activity-feed alert on failure.

### E7 — Rate Limit SQLite Persistence
Replace in-memory `_selfRegCounts` Map with `rate_limits` SQLite table.

### E11 — Provider 429 Retry
Retry with `Retry-After` delay (max 2 retries) in `/providers/proxy`.

---

## 🎮 Game Creation System

bKG must support full production-ready game development, not just apps.

### G1 — Game Project Mode
New wizard mode: **Game** (alongside existing App mode).
Adds game-specific planning stages before PROMPT.md generation.

### G2 — World Creation Planner
Interactive form:
- World name, genre, tone (dark fantasy / sci-fi / cozy / etc.)
- Geography: continents, biomes, cities, factions
- Lore: history, magic system / technology, rules of the world
- Exports to `WORLD.md` stored in task + workspace

### G3 — Story Creation Planner
- Acts structure (3-act, 5-act, hero's journey, non-linear)
- Main narrative arc + subplots
- Protagonist / antagonist definition
- Key story beats with chapter outline
- Exports to `STORY.md`

### G4 — NPC Creator
- NPC template: name, role, faction, personality traits, backstory
- Dialogue tree skeleton (YAML or JSON)
- Behavioral flags: hostile / friendly / neutral / merchant / questgiver
- Voice / visual description for asset generation prompts
- Exports to `NPCS.md` + `npcs.json`

### G5 — Quest Creator
- Quest type: main / side / procedural / hidden
- Objectives list (kill / collect / escort / discover / build)
- Prerequisites (other quest IDs, NPC states, world flags)
- Rewards: XP / items / reputation / story unlock
- Failure conditions
- Exports to `QUESTS.md` + `quests.json`

### G6 — Game Technical Plan Generator
AI generates a full `PROMPT.md` for game execution covering:
- Tech stack selection (Godot / Unity / Phaser / custom engine)
- Entity component system design
- Asset pipeline plan
- Save/load system design
- Physics + collision layer setup
- Audio system design
- Exports `GAMEPLAN.md`

### G7 — Agent Game Coding Pipeline
Enhanced Agent Hub session type for games:
- Seeded with WORLD.md + STORY.md + NPCS.md + QUESTS.md + GAMEPLAN.md
- Tools: `write_scene`, `write_npc`, `write_quest`, `write_shader`, `run_tests`
- Progress tracked in Flow task workflow steps

---

## 🟡 Backlog

| ID | Feature | Effort | Notes |
|----|---------|--------|-------|
| E2 | Drag-and-drop board reorder | M | HTML5 DnD |
| E5 | Column +N today stats | M | SQL from activity table |
| E6 | Provider key health-check | S | POST /providers/:id/test |
| E8 | Task labels UI | S | FlowTask.tsx |
| E9 | API key chip in Dashboard | S | GET /user/profile |
| E10 | Board keyboard shortcuts | M | N / / Esc J K → Enter |
| E12 | Hub shell history tab | S | filter terminal events |
| E14 | Flow export (MD/CSV) | S | GET /flow/export/:id |
| E15 | Install missing agents | S | Hub UI + POST /hub/agents/:id/install |
| E16 | Mobile bottom tab nav | M | AppShell.tsx |
| E17 | Mission autopilot | S | serve.js task-move hook |
| E18 | Webhook triggers | M | POST /flow/webhook/:projectId |
| M1 | Event replay mode | L | JSONL timeline scrubber |
| M2 | Agent memory layer | L | /flow/tasks/:id/memory |
| M3 | Conflict detection engine | L | file collision detection |
| M4 | Execution cost layer | M | token tracking per task |
| A2 | Session JSONL compression | S | gzip sessions > 24h |
| E13 | Light theme toggle | M | CSS vars swap |

---

## ⚠️ Known Issues

| ID | Issue | Severity |
|----|-------|----------|
| K2 | Ghost sandbox-agent processes on dev ports 2468–2470 | Low |
| K3 | Rate limit counter resets on server restart → E7 fixes this | Low |
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

All layers must show a **single coherent chain** in the UI, not 3 separate tools.

---

## Core Loop (target state)

```
[New Idea]
    ↓
[Flow: Create Task]  ← World/Story/NPC/Quest planners (Game mode)
    ↓
[AI: Generate PROMPT.md]  ← via /providers/proxy
    ↓
[Flow → Agent: "Run with Agent"]  ← E3
    ↓
[Hub: Execute in workspace]
    ↓
[FS: Committed to flow/<task-id>]  ← E4
    ↓
[Eval: Score + evidence]
    ↓
[Flow: Update task → done]  ← SSE push ← E1
    ↓
[Repeat or Archive]
```
