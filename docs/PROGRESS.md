# bKG PROGRESS — Completed Work Log

> Merged from TASKS.md. Everything here is **done, tested, and shipped**.
> See `TASKS.md` (root) for current work. See `docs/UPDATE.md` for enhancement proposals.

---

## System Overview

```
Idea → Flow Task → PROMPT.md → Agent Session → Execution → FS Changes → Eval → Flow Update → Repeat
```

bKG is an **execution-first AI development runtime** — not an IDE, not a Notion clone.
Every component is a phase in one pipeline.

---

## Completed Phases (124 tasks)

### Phase 1 — Foundation & Branding (8 tasks)
- [x] Rename ICADP → bKG across all source, localStorage, banners
- [x] `.env` loading in serve.js (plain `fs.readFileSync`)
- [x] `BKG_PORT / HOST / LLAMA_PORT / OLLAMA_PORT / JWT_SECRET / ADMIN_HASH` constants
- [x] `POST /auth/login` (bcrypt verify), `GET /auth/verify`, `POST /auth/hash`
- [x] `AdminAuth.tsx` server-side bcrypt auth, token in sessionStorage
- [x] `AdminApp.tsx` verifies token on mount, auto-logout on invalid
- [x] `BKG_DIR` in agent.js, `~/.bkg` default
- [x] `.env.example` with all documented variables

### Phase 2 — API Key System (6 tasks)
- [x] `server/api-keys.js` — SHA-256 hashed bearer tokens, never plaintext
- [x] 4 scopes: `inference / agent / admin / readonly`
- [x] `GET/POST /api-keys`, `DELETE /api-keys/:id`, `PUT /api-keys/:id/enabled`
- [x] `POST /api-keys/self-register` — no-auth (3/hr per IP)
- [x] `requireApiKey()` middleware with scope enforcement
- [x] Admin UI — ApiKeys.tsx: create, copy once, enable/disable, revoke

### Phase 3 — sandbox-agent (legacy path, 5 tasks)
- [x] sandbox-agent npm package installed
- [x] `server/sandbox.js` — spawn binary, PID management
- [x] `/sandbox/*` proxy endpoints
- [x] Fixed `isSARunning()` — TCP socket probe vs server bind race condition
- [x] Fixed ESM `require is not defined` — `import { createConnection } from 'net'`

### Phase 4 — Plan Generator UX (5 tasks)
- [x] BackendSelector — live model discovery with shimmer bar
- [x] BackendSelector — online-only filter
- [x] IdeaEnhancer — phase-1 WebGPU auto-load with determinate progress
- [x] IdeaInput — determinate download % for WebGPU
- [x] WizardModal — pipes engine progress to IdeaInput button

### Phase 5 — User Dashboard (8 tasks)
- [x] `home` stage as default landing page
- [x] Dashboard — local model cards with live status
- [x] Dashboard — block selecting offline REST backends
- [x] Dashboard — quick actions: New Plan / Code Studio / Test Models / My Keys
- [x] Dashboard — recent projects from browser SQLite
- [x] ModelTester — inline chat playground
- [x] AppShell — logo as home button, stage stepper hidden on home
- [x] AppShell — New Plan quick button on home

### Phase 6 — Private / Cloud Mode (9 tasks)
- [x] `mode: 'private' | 'cloud'` in AppState + `SET_MODE` action
- [x] Mode badge, mobile toggle bar, info banner
- [x] BackendSelector fully mode-aware
- [x] Dashboard mode-aware backend section
- [x] `cloud` backend type in BackendConfig
- [x] `cloudComplete()` + `cloudStream()` via `/providers/proxy`
- [x] `loadClient() / isClientReady() / generateJson() / generateStreaming()` for cloud

### Phase 7 — Free Provider System (13 tasks)
- [x] `server/providers.js` — 19 providers (pi-free rebrand)
- [x] `resolveProviderKey()` — user → global → env → anon fallback chain
- [x] `fetchProviderModels()` — live model list
- [x] `POST /providers/proxy` — SSE streaming inference proxy
- [x] `GET /providers/list` + `GET /providers/:id/models`
- [x] `server/users.js` — per-user config at `~/.bkg/users/<keyId>.json`
- [x] `getUserProviderStatus()` — source badges
- [x] `GET/PUT /user/providers`
- [x] `GET/PUT /admin/globals` + `POST /admin/globals/providers`
- [x] Admin — Global Providers tab (tier accordion, masked keys)
- [x] UserSettings.tsx — per-user key manager

### Phase 8 — User Onboarding (6 tasks)
- [x] Onboarding.tsx — 3-step wizard on first visit
- [x] Step 1: API key via self-register
- [x] Step 2: provider key entry (Groq, NVIDIA, OpenRouter, Mistral, SambaNova)
- [x] Step 3: done + CTA
- [x] `POST /user/onboarded`
- [x] Re-trigger via `window.dispatchEvent(new Event('bkg:show-onboarding'))`

### Phase 9 — CORS Proxy (9 tasks)
- [x] `GET /api/proxy/ollama/tags`
- [x] `POST /api/proxy/ollama/pull` (streaming)
- [x] `DELETE /api/proxy/ollama/delete`
- [x] `GET /api/proxy/llama/models / health / model(PUT)`
- [x] `GET /api/proxy/ping` — dual reachability check
- [x] All `llm-client.ts` functions updated to use proxy

### Phase 10 — Atlantis Cyberpunk Design (11 tasks)
- [x] Color palette: base `#030810`, accent `#00e5ff`, mystic `#a855f7`, amber `#ffb300`
- [x] Orbitron (display) + Space Grotesk + JetBrains Mono fonts
- [x] 9 custom Tailwind animations
- [x] CSS utilities: `.glass`, `.card-crystal`, `.glow-*`, `.text-gradient-*`, `.rune-divider`, `.badge-*`
- [x] Responsive AppShell — hamburger → slide-in mobile drawer
- [x] Responsive Dashboard — mode-aware backend cards
- [x] Responsive Admin — mobile sidebar overlay
- [x] StageProgress — crystalline node stepper
- [x] Fixed `overflow: hidden` on body (broke mobile scroll)
- [x] Raised `.text-muted` contrast `#4a6880 → #6b8ca8`
- [x] Small text `font-weight: 500` at 10–11px

### Phase 11 — bKG Agent Hub Node.js (17 tasks)
- [x] `server/bkg-hub.js` — pure Node.js, no Rust binary (~600 lines)
- [x] `listAgents()` — pi, claude-code, codex, opencode, amp via `which`
- [x] `createSession()` — workspace at `~/.bkg/workspaces/<id>/`
- [x] Pi agent routing — lazy session, 300ms polling, event normalization
- [x] CLI agent routing — spawn process, stream stdout/stderr
- [x] Universal event schema — 10 event types
- [x] SSE with offset resume + 15s heartbeat
- [x] Permission handling — human-in-the-loop
- [x] `fsRead / fsWrite / fsDelete / fsList` — path-escape guard
- [x] `execInSession()` — shell command SSE stream
- [x] Session persistence — JSONL at `~/.bkg/hub-sessions/<id>.jsonl`
- [x] 14 `/hub/*` endpoints
- [x] AgentHub.tsx — Terminal / Files / Sessions panels
- [x] Agent selector with installed status + version
- [x] Permission modal — blocking approve/deny
- [x] File browser with inline editor
- [x] `Agents` + `Flow` nav links in AppShell

### Phase 12 — bKG Flow Task Board (19 tasks)
- [x] `server/bkg-flow.js` — SQLite, WAL, better-sqlite3 (~650 lines)
- [x] Full schema: 9 tables + FTS5 + auto-sync triggers
- [x] Task lifecycle: `planning→todo→in-progress→review→done→archived`
- [x] `started_at` / `done_at` auto-set on transitions
- [x] BFS cycle detection for dependencies
- [x] AI planning via `/providers/proxy` → PROMPT.md
- [x] Task logs SSE subscriber fan-out
- [x] Workflow steps (plan/execute/review phases)
- [x] Mission + Milestone hierarchy
- [x] AES-256-GCM secrets with per-row nonce
- [x] Evaluation scoring (0–100, band: excellent/good/fair/poor)
- [x] Activity feed (append-only)
- [x] 34 `/flow/*` endpoints
- [x] FlowBoard.tsx — Kanban 5 columns, task cards, quick-move
- [x] FlowTask.tsx — 6-tab modal (Overview/Plan/Steps/Comments/Logs/Evals)
- [x] PROMPT.md markdown renderer
- [x] Search with 300ms debounce (FTS5 + LIKE fallback)
- [x] `flow` stage wired into App.tsx + AppShell nav
- [x] `Zap` Flow nav link

### Phase 13 — Process Manager (5 tasks)
- [x] `bkg.sh` — start/stop/restart/status/build/dev/logs
- [x] PID + log files at `.bkg/run/` and `.bkg/logs/`
- [x] Readiness via `GET /health/ready` (not just port-open)
- [x] serve.js graceful shutdown + PID file cleanup
- [x] `.bkg.env` + `.bkg.env.example`

### Phase 14 — Security Fix (2 tasks)
- [x] K13: `/agent/*` endpoints require Bearer token (inference|agent|admin scope)
- [x] K6: self-register now gives `agent` scope; agentAuth accepts inference|agent|admin

### Phase 15 — Old Name Cleanup (7 tasks)
- [x] `icadp.sh` → `bkg.sh` (renamed, old file kept as legacy copy)
- [x] `server/package.json` — name: `bkg-llama-cpp-server`
- [x] `server/agent.js` — provider renamed `icadp` → `bkg`, env var `BKG_LOCAL_KEY`
- [x] `server/plugins.js` — uses `BKG_DIR` constant
- [x] `server/serve.js` — comments updated
- [x] `server/manager.js` — banner updated
- [x] `src/components/Admin/ApiKeys.tsx` — curl examples use `${BKG_PORT:-4001}`

---

## System Test Results (May 2026)

All 23 checks pass:

| System | Status |
|--------|--------|
| Health + readiness probes | ✅ |
| Auth login/verify/rejection | ✅ |
| API keys CRUD + scopes + rate limit | ✅ |
| 19 providers with correct tiers | ✅ |
| Flow full task lifecycle | ✅ |
| Flow BFS cycle detection | ✅ |
| Flow FTS5 search (porter stemmer) | ✅ |
| Flow AES-256-GCM secrets | ✅ |
| Flow activity feed | ✅ |
| Flow missions + milestones | ✅ |
| Hub session CRUD + file FS | ✅ |
| Hub path escape guard | ✅ |
| sql-wasm.wasm → `application/wasm` | ✅ |
| Route ordering search before :id | ✅ |
| Build: zero TypeScript errors | ✅ |
