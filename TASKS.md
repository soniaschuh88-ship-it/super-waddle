# bKG — Tasks, Status & Roadmap

> Tracking document for all past, present, and future work on bKG — best Known Garbage.
> Last updated: May 2026 · Branch: `main` · Commit: `8ccb303`

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Done — shipped and working |
| 🔄 | In progress / partial |
| ⚠️ | Done but has known issue |
| ❌ | Known broken |
| 📋 | Planned — not started |
| 💡 | Idea — not yet committed to |

---

## Completed Tasks

All tasks that have been fully built and shipped.

### Phase 1 — Foundation & Branding

| # | Task | Status | Commit notes |
|---|------|--------|--------------|
| 1 | Rename ICADP → bKG across all source files, localStorage keys, server banners | ✅ | All `bkg_` prefix keys, Orbitron logo |
| 2 | Add `.env` loading in `serve.js` (plain `fs.readFileSync`, no dotenv dep) | ✅ | Loads from project root `.env` |
| 3 | Add `BKG_PORT / HOST / LLAMA_PORT / OLLAMA_PORT / JWT_SECRET / ADMIN_HASH` constants | ✅ | Env-first with safe defaults |
| 4 | Add `POST /auth/login` (bcrypt verify), `GET /auth/verify` (HMAC token), `POST /auth/hash` | ✅ | 7-day token expiry |
| 5 | Update `AdminAuth.tsx` to use server-side bcrypt auth | ✅ | Token stored in `sessionStorage` |
| 6 | Update `AdminApp.tsx` to verify token with server on mount | ✅ | Auto-logout on invalid token |
| 7 | Add `BKG_DIR` support in `agent.js` with `~/.bkg` default | ✅ | Backwards-compatible alias |
| 8 | Create `.env.example` with all documented variables | ✅ | Shipped in root |

### Phase 2 — API Key System

| # | Task | Status | Notes |
|---|------|--------|-------|
| 9  | Create `server/api-keys.js` — SHA-256 hashed bearer tokens | ✅ | Keys never stored in plaintext |
| 10 | 4 scopes: `inference / agent / admin / readonly` | ✅ | |
| 11 | `GET/POST /api-keys`, `DELETE /api-keys/:id`, `PUT /api-keys/:id/enabled` | ✅ | Admin JWT required |
| 12 | `POST /api-keys/self-register` — no-auth key creation for new users | ✅ | 3/hr per IP rate limit |
| 13 | `requireApiKey()` middleware (accepts API keys + admin JWT) | ✅ | Exported but not yet applied to agent/v1 routes |
| 14 | Admin UI — ApiKeys.tsx tab: create, copy once, enable/disable, revoke | ✅ | Masked key display, curl hint |

### Phase 3 — sandbox-agent Integration (deprecated path)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 15 | Install `sandbox-agent` npm package in server/ | ✅ | Binary at `node_modules/.bin/sandbox-agent` |
| 16 | Create `server/sandbox.js` — spawn binary, manage PID | ✅ | Port changed to 7468 to avoid ghost processes |
| 17 | Add `/sandbox/*` proxy endpoints to `serve.js` | ✅ | Still present but superseded by `/hub/*` |
| 18 | Fix `isSARunning()` — TCP socket probe instead of server bind | ✅ | Eliminated exit-code-101 race condition |
| 19 | Fix ESM `require is not defined` in sandbox.js | ✅ | Replaced with `import { createConnection } from 'net'` |

### Phase 4 — Plan Generator UX

| # | Task | Status | Notes |
|---|------|--------|-------|
| 20 | BackendSelector — live model discovery (Ollama `/api/tags`, llama-cpp `/v1/models`) | ✅ | |
| 21 | BackendSelector — shimmer progress bar while fetching | ✅ | |
| 22 | BackendSelector — online-only filter (offline servers hidden) | ✅ | |
| 23 | IdeaEnhancer — phase-1 WebGPU auto-load with determinate progress bar | ✅ | Before enhancement starts |
| 24 | IdeaInput — determinate download % for WebGPU, indeterminate for REST | ✅ | |

### Phase 5 — User Dashboard & Home Stage

| # | Task | Status | Notes |
|---|------|--------|-------|
| 25 | Add `home` stage as default landing page | ✅ | Stage order: `home→stufe1→…` |
| 26 | Dashboard — local model cards (WebGPU / Ollama / llama-cpp) with live status | ✅ | |
| 27 | Dashboard — block selecting offline REST backends | ✅ | |
| 28 | Dashboard — quick actions: New Plan / Code Studio / Test Models / My Keys | ✅ | |
| 29 | Dashboard — recent projects from browser SQLite | ✅ | |
| 30 | ModelTester — inline chat playground for model verification | ✅ | Starter prompts, stop button |
| 31 | AppShell — logo as home button, Dashboard nav link, stage stepper hidden on home | ✅ | |
| 32 | AppShell — `New Plan` quick button on home stage | ✅ | |

### Phase 6 — Private / Cloud Mode

| # | Task | Status | Notes |
|---|------|--------|-------|
| 33 | Add `mode: 'private' | 'cloud'` to AppState + `SET_MODE` action | ✅ | Persisted in localStorage |
| 34 | AppShell — mode badge (amber=Private, cyan=Cloud) | ✅ | |
| 35 | AppShell — mobile mode toggle bar below header | ✅ | |
| 36 | AppShell — mode info banner on home stage | ✅ | Truncates on mobile |
| 37 | BackendSelector — fully mode-aware (local in private, providers in cloud) | ✅ | All 19 providers shown; inaccessible at 50% opacity |
| 38 | Dashboard — mode-aware backend section | ✅ | |
| 39 | Add `cloud` backend type to `BackendConfig` | ✅ | `modelId` = `provider/model` format |
| 40 | `llm-client.ts` — `cloudComplete()` + `cloudStream()` via `/providers/proxy` | ✅ | |
| 41 | `loadClient()` + `isClientReady()` + `generateJson()` + `generateStreaming()` for `cloud` type | ✅ | |

### Phase 7 — Free Provider System

| # | Task | Status | Notes |
|---|------|--------|-------|
| 42 | Create `server/providers.js` — registry of 19 providers (pi-free rebrand) | ✅ | Kilo, LLM7, OpenRouter, Cline, NVIDIA, SambaNova, Ollama Cloud, Groq, Mistral, Cerebras, xAI, HuggingFace, FastRouter, Codestral, DeepInfra, Together AI, ZenMux, CrofAI, Novita AI |
| 43 | `resolveProviderKey()` — user key → global key → env var → anon | ✅ | |
| 44 | `fetchProviderModels()` — live `/models` query with 5 s timeout | ✅ | |
| 45 | `POST /providers/proxy` — streaming cloud inference proxy | ✅ | SSE forward, OpenRouter headers |
| 46 | `GET /providers/list` — all providers + per-caller key status | ✅ | |
| 47 | `GET /providers/:id/models` — live model list | ✅ | |
| 48 | Create `server/users.js` — per-user config at `~/.bkg/users/<keyId>.json` | ✅ | |
| 49 | `getUserProviderStatus()` — source badges (user/global/env/anon/none) | ✅ | |
| 50 | `GET/PUT /user/providers` — user provider key management | ✅ | |
| 51 | `GET/PUT /admin/globals` — admin global provider config | ✅ | Keys masked on GET |
| 52 | `POST /admin/globals/providers` — bulk key update | ✅ | |
| 53 | Admin — Global Providers tab (tier accordion, masked keys, signup links) | ✅ | |
| 54 | UserSettings.tsx — per-user key manager (all 19 providers, source badges) | ✅ | |

### Phase 8 — User Onboarding

| # | Task | Status | Notes |
|---|------|--------|-------|
| 55 | Onboarding.tsx — 3-step wizard triggered on first visit | ✅ | |
| 56 | Step 1: self-register API key via `POST /api-keys/self-register` | ✅ | |
| 57 | Step 2: optional provider key entry (Groq, NVIDIA, OpenRouter, Mistral, SambaNova) | ✅ | |
| 58 | Step 3: done + CTA to New Plan / Agent Hub | ✅ | |
| 59 | `POST /user/onboarded` mark completion | ✅ | |
| 60 | Re-trigger via `window.dispatchEvent(new Event('bkg:show-onboarding'))` | ✅ | |

### Phase 9 — CORS Proxy for Local Backends

| # | Task | Status | Notes |
|---|------|--------|-------|
| 61 | Add server-side proxy endpoints for Ollama + llama-cpp | ✅ | All calls go through `/api/proxy/*` — never browser → localhost |
| 62 | `GET /api/proxy/ollama/tags` | ✅ | |
| 63 | `POST /api/proxy/ollama/pull` (streaming) | ✅ | |
| 64 | `DELETE /api/proxy/ollama/delete` | ✅ | |
| 65 | `GET /api/proxy/llama/models` | ✅ | |
| 66 | `GET /api/proxy/llama/health` | ✅ | |
| 67 | `PUT /api/proxy/llama/model` (swap) | ✅ | |
| 68 | `GET /api/proxy/ping` — dual reachability check | ✅ | |
| 69 | Update all frontend `llm-client.ts` functions to use proxy | ✅ | `ollamaListModels`, `llamaCppListModels`, `pingRestBackend`, etc. |

### Phase 10 — Atlantis Cyberpunk Design System

| # | Task | Status | Notes |
|---|------|--------|-------|
| 70 | New color palette: base `#030810`, accent `#00e5ff`, mystic `#a855f7`, amber `#ffb300`, success `#00e5a0` | ✅ | |
| 71 | Add Orbitron font (display), keep Space Grotesk + JetBrains Mono | ✅ | Google Fonts import |
| 72 | 9 custom animations in Tailwind: glowPulse, float, gradientShift, progressShimmer, scanLine, drift, orbRotate, dataStream, blink | ✅ | |
| 73 | CSS utilities: `.glass`, `.card-crystal`, `.glow-*`, `.text-gradient-*`, `.rune-divider`, `.badge-*`, `.scanlines`, `.corner-hex` | ✅ | |
| 74 | Responsive AppShell — hamburger → slide-in mobile drawer | ✅ | |
| 75 | Responsive Dashboard — mode-aware backend cards with glow themes | ✅ | |
| 76 | Responsive Admin — sidebar + overlay mobile drawer | ✅ | |
| 77 | StageProgress — crystalline node stepper (checkmarks, glow ring, gradient connectors) | ✅ | |
| 78 | Fix `overflow: hidden` on `body` (was breaking mobile scroll) | ✅ | |
| 79 | Raise `.text-muted` contrast from `#4a6880` → `#6b8ca8` | ✅ | |
| 80 | Small text `font-weight: 500` for legibility at 10–11px | ✅ | |

### Phase 11 — bKG Agent Hub (Node.js)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 81 | Create `server/bkg-hub.js` — pure Node.js agent hub (~600 lines) | ✅ | No Rust binary dependency |
| 82 | `listAgents()` — detects pi, claude-code, codex, opencode, amp via `which` | ✅ | |
| 83 | `createSession()` — workspace at `~/.bkg/workspaces/<id>/` | ✅ | |
| 84 | Pi agent routing — lazy session, 300 ms polling, event normalization | ✅ | |
| 85 | CLI agent routing — spawn process, stream stdout/stderr | ✅ | |
| 86 | Universal event schema — 10 event types | ✅ | |
| 87 | `streamSessionEvents()` — SSE with offset resume + 15 s heartbeat | ✅ | |
| 88 | `replyPermission()` — human-in-the-loop approvals | ✅ | |
| 89 | `fsRead / fsWrite / fsDelete / fsList` — workspace file system | ✅ | Path-escape guard |
| 90 | `execInSession()` — shell command SSE stream | ✅ | |
| 91 | Session persistence — JSONL at `~/.bkg/hub-sessions/<id>.jsonl` | ✅ | Survives server restart |
| 92 | 14 `/hub/*` endpoints wired in `serve.js` | ✅ | |
| 93 | AgentHub.tsx rewrite — Terminal / Files / Sessions panels | ✅ | |
| 94 | Agent selector dropdown with installed status + version | ✅ | |
| 95 | Permission modal — blocking approve/deny dialog | ✅ | |
| 96 | File browser — inline editor + read/write/delete | ✅ | |
| 97 | `Flow` nav link added to AppShell | ✅ | Also: `Agents` nav link |

### Phase 12 — bKG Flow (Task Board)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 98  | Create `server/bkg-flow.js` — SQLite task board (~650 lines) | ✅ | better-sqlite3, WAL mode |
| 99  | Schema: projects, missions, milestones, tasks, deps, comments, logs, workflow_steps, activity, secrets, evaluations | ✅ | |
| 100 | FTS5 virtual table with auto-sync triggers (INSERT/UPDATE/DELETE) | ✅ | Porter stemmer |
| 101 | Task lifecycle: `planning→todo→in-progress→review→done→archived` | ✅ | |
| 102 | `started_at` / `done_at` auto-set on status transitions | ✅ | |
| 103 | BFS cycle detection for task dependencies | ✅ | |
| 104 | AI task planning via `/providers/proxy` — generates PROMPT.md | ✅ | Falls back to template if no key |
| 105 | Task logs with SSE subscriber fan-out | ✅ | |
| 106 | Workflow steps (plan/execute/review phases) | ✅ | |
| 107 | Mission + Milestone hierarchy | ✅ | |
| 108 | AES-256-GCM secrets with per-row nonce | ✅ | Master key from env or scrypt |
| 109 | Evaluation scoring (0–100, band: excellent/good/fair/poor) | ✅ | |
| 110 | Activity feed (append-only event log) | ✅ | |
| 111 | 34 `/flow/*` endpoints in `serve.js` | ✅ | |
| 112 | FlowBoard.tsx — Kanban with 5 columns, task cards, quick-move | ✅ | |
| 113 | FlowTask.tsx — 6-tab detail modal (Overview/Plan/Steps/Comments/Logs/Evals) | ✅ | |
| 114 | PROMPT.md minimal Markdown renderer | ✅ | h1–h3, lists, checkboxes |
| 115 | FlowBoard search with 300 ms debounce | ✅ | FTS5 + LIKE fallback |
| 116 | `flow` stage wired into App.tsx + AppShell nav | ✅ | |

### Phase 13 — Process Manager

| # | Task | Status | Notes |
|---|------|--------|-------|
| 117 | `bkg.sh` — start/stop/restart/status/build/dev/logs | ✅ | |
| 118 | PID file at `.bkg/run/serve.pid`; log files at `.bkg/logs/` | ✅ | |
| 119 | Readiness check via `GET /health/ready` (not just port-open) | ✅ | |
| 120 | serve.js graceful shutdown + PID file cleanup | ✅ | |
| 121 | `.bkg.env` + `.bkg.env.example` | ✅ | |

### Phase 14 — Documentation

| # | Task | Status | Notes |
|---|------|--------|-------|
| 122 | `README.md` — full project overview, setup, architecture, API reference | ✅ | Replaces Vite template README |
| 123 | `FEATURES.md` — complete feature inventory across all 14 systems | ✅ | 100+ features documented |
| 124 | `TASKS.md` — this file | ✅ | |

---

## In Progress

| # | Task | Status | Blocker / Notes |
|---|------|--------|-----------------|
| A | `requireApiKey()` middleware applied to `/agent/*` + `/v1/*` routes | 🔄 | Middleware exists but not yet wired on protected routes |
| B | serveo.net tunnel reliability | 🔄 | Tunnel occasionally fails on this session's IP; `bkg.sh start` re-establishes it |
| C | sandbox-agent binary port management | 🔄 | Ghost processes from dev session linger on ports 2468–2470; runtime fix: `BKG_SA_PORT=7468` |

---

## Known Issues

### Critical

| ID | Issue | Affects | Workaround |
|----|-------|---------|------------|
| K1 | `GET /flow/tasks/search` route must be registered **before** `GET /flow/tasks/:id` in serve.js — Express matches `:id` first if order is wrong | Flow search | Already fixed in current code but must not regress on reorder |
| K2 | sandbox-agent binary exits with code 101 when spawned from Node.js with full inherited env on some hosts | AgentHub "Start Hub" button | Fixed: minimal env `{ HOME, PATH, TMPDIR }` + `cwd: /tmp` in spawn options |
| K3 | Ghost sandbox-agent processes occupying ports 2468–2470 in this dev session | AgentHub | Restart server fresh on a clean host; or `pkill -f sandbox-agent` |

### Medium

| ID | Issue | Affects | Workaround |
|----|-------|---------|------------|
| K4 | WebAssembly WASM compile error logged in browser console when sql.js wasm is served from the SPA catch-all | Browser SQLite (db.ts) | Not a real error — wasm **is** served correctly (confirmed `content-type: application/wasm`); browser logs are misleading |
| K5 | `bkg_admin_token` session token not invalidated server-side on `./bkg.sh restart` (JWT_SECRET changes if unset) | Admin auth | Set `BKG_JWT_SECRET` in `.env` to a fixed value so tokens survive restarts |
| K6 | Cloud mode: providers with `anonAccess: true` (Kilo, LLM7) require the provider's free tier to be available; no retry or rate-limit handling on the proxy | Cloud inference | Reload if rate-limited; or configure a key |
| K7 | Pi agent polling loop (`_pollPiEvents`) uses 300 ms fixed interval; under heavy load may lose events if pi flushes a large batch between polls | Agent Hub (Pi) | Pi's own SSE endpoint is a better long-term fix |
| K8 | `flowHealth()` query used `status!="archived"` (double-quotes) — SQLite needs single-quotes for string literals | Flow health endpoint | Fixed in code; document to catch on future similar queries |

### Low / Cosmetic

| ID | Issue | Affects | Note |
|----|-------|---------|------|
| K9 | Mobile: very long task titles in FlowBoard overflow card width on 320px screens | FlowBoard | `truncate` class applied but flex container doesn't always constrain |
| K10 | StageProgress uses `ORDER` array that includes `home` at index 0; if `home` is ever used as a "current stage" in the stepper, `cur` calculation goes negative | StageProgress | Guarded by `if (state.stage === 'home') return null` |
| K11 | Onboarding Step 2: provider key input shows placeholder text even after key is staged but not yet saved | Onboarding | Cosmetic only; Save button correctly sends the value |
| K12 | Admin GlobalProviders: masked key display (••••••••) is the same for set and empty keys on first load | GlobalProviders | Empty keys show empty string after server responds; harmless |

---

## Roadmap

### Near-term (next iteration)

| # | Task | Priority | Effort |
|---|------|----------|--------|
| R1 | Wire `requireApiKey('inference')` on `/agent/*` + `/v1/*` routes | High | S |
| R2 | FlowBoard — drag-and-drop reorder within columns (HTML5 DnD) | High | M |
| R3 | FlowBoard — real-time SSE board updates (task status changes pushed to browser) | High | M |
| R4 | FlowTask — execute task via Agent Hub (create hub session from Flow task) | High | M |
| R5 | FlowTask — Git branch create per task (`flow/<id>`) | High | M |
| R6 | Admin — User management tab (list users, view provider config, create user) | Medium | S |
| R7 | bkg.sh — `bkg.sh tunnel` as a standalone command (separate from start) | Medium | S |
| R8 | Flow — task labels CRUD UI (add/remove labels from task detail) | Medium | S |
| R9 | Flow — mission board view (grouped by mission) | Medium | M |
| R10 | Model Tester — save conversation history to browser SQLite | Low | S |

### Medium-term

| # | Task | Priority | Effort |
|---|------|----------|--------|
| R11 | pi-free provider integration — fetch free model lists from Kilo, LLM7 automatically | High | L |
| R12 | Flow — task dependency graph visualisation (DAG view with D3 or canvas) | Medium | L |
| R13 | Flow — full-text search results with context highlight (SNIPPET function) | Medium | M |
| R14 | Flow — scheduled evaluations (auto-score tasks that reach `done`) | Medium | M |
| R15 | Flow — task archiving UI (archive column + restore) | Medium | S |
| R16 | Flow — export tasks to JSON / CSV | Low | S |
| R17 | Agent Hub — Codex plan mode UI (shows plan step before executing) | Medium | M |
| R18 | Agent Hub — session replay from persisted JSONL | Medium | M |
| R19 | Agent Hub — process exec with working directory picker | Low | S |
| R20 | Provider proxy — streaming error classification (rate-limit vs auth vs server error) | Medium | M |
| R21 | Provider proxy — retry with exponential backoff on 429 responses | Medium | M |
| R22 | Provider proxy — token count tracking per provider | Low | M |
| R23 | Admin — Global Providers: test-call button (send a minimal request to verify key) | Medium | S |
| R24 | Admin — Activity log view (render `flow/activity` in admin) | Low | S |
| R25 | `bkg.sh dev` — use `/health/ready` readiness probe (currently uses TCP port poll) | Low | S |

### Long-term / Ambitious

| # | Task | Priority | Effort |
|---|------|----------|--------|
| R26 | Multi-node mesh — replicate Flow task state across machines (LAN sync) | High | XL |
| R27 | Docker node provisioning — create containers as isolated agent nodes | Medium | XL |
| R28 | GitHub integration — import issues as Flow tasks; create PRs from tasks | High | L |
| R29 | GitHub OAuth — authenticate with GitHub for repo access | Medium | L |
| R30 | Mission autopilot — automatic task progression when all deps are done | High | L |
| R31 | Tailscale / Cloudflare tunnel support alongside serveo | Medium | L |
| R32 | Flow — roadmap planning view (Gantt-style timeline by milestone) | Medium | XL |
| R33 | Electron desktop app (macOS/Windows/Linux) — wrap with Capacitor or Electron | High | XL |
| R34 | iOS / Android mobile app via Capacitor | Low | XL |
| R35 | Flow — AI evaluation scoring (auto-run eval on task completion via provider proxy) | Medium | M |
| R36 | Flow — fix-feature retries (re-run failed tasks within budget) | Medium | L |
| R37 | Webhook triggers — trigger Flow tasks or Hub sessions via HTTP webhook | Medium | L |
| R38 | Scheduled automations — cron-based task creation or agent execution | Medium | L |
| R39 | Chat rooms — multi-agent group chat with mention routing | Low | XL |
| R40 | Plugin contribution — allow plugins to add provider definitions | Medium | L |

---

## Effort Key

| Symbol | Meaning |
|--------|---------|
| S | Small — a few hours, 1 file or less |
| M | Medium — half a day, 2–4 files |
| L | Large — 1–2 days, significant new system |
| XL | Extra large — several days, major new capability |

---

## File Map (quick reference)

```
super-waddle/
├─ bkg.sh                        Process manager (start/stop/status/build/dev)
├─ .env.example                  All server environment variables
├─ .bkg.env.example              bkg.sh runtime config
├─ README.md                     Project overview + setup
├─ FEATURES.md                   Complete feature inventory
├─ TASKS.md                      This file
│
├─ server/
│  ├─ serve.js                   Unified Express server (all routes)
│  ├─ bkg-flow.js                Flow task board (SQLite)
│  ├─ bkg-hub.js                 Agent Hub (sessions, SSE, FS, exec)
│  ├─ providers.js               19 free/paid provider registry
│  ├─ users.js                   Per-user config + fallback chain
│  ├─ api-keys.js                Bearer token store (hashed)
│  ├─ sandbox.js                 sandbox-agent binary manager (legacy)
│  ├─ agent.js                   Pi coding agent engine
│  ├─ plugins.js                 Pi-compatible plugin manager
│  ├─ index.js                   node-llama-cpp inference server
│  └─ manager.js                 Legacy process manager (unused)
│
└─ src/
   ├─ components/
   │  ├─ Layout/                 AppShell, StageProgress
   │  ├─ UserDashboard/          Dashboard, ModelTester, UserSettings, Onboarding
   │  ├─ Flow/                   FlowBoard, FlowTask
   │  ├─ AgentHub/               AgentHub
   │  ├─ Admin/                  AdminApp + 11 sub-panels
   │  ├─ Stufe1/                 WizardModal, BackendSelector, IdeaEnhancer, IdeaInput
   │  ├─ Stufe1_5/               ValidationLoop
   │  ├─ Stufe2/                 DualPaneExplorer + editors
   │  ├─ Stufe3/                 TerminalConsole
   │  └─ CodeStudio/             CodeStudio + Monaco
   ├─ context/                   AppContext (global state)
   ├─ lib/                       llm-client, webllm, db, prompts, simulation
   └─ types/                     index.ts
```
