# bKG — Feature Inventory

Complete listing of every implemented feature across all systems.
Last updated: May 2026 · Commit `8ccb303`

---

## Table of Contents

1. [Core Infrastructure](#1-core-infrastructure)
2. [Operating Modes](#2-operating-modes)
3. [User Dashboard](#3-user-dashboard)
4. [Plan Generator (Wizard)](#4-plan-generator-wizard)
5. [Local AI Backends](#5-local-ai-backends)
6. [Cloud Provider System](#6-cloud-provider-system)
7. [bKG Flow — Task Board](#7-bkg-flow--task-board)
8. [bKG Agent Hub](#8-bkg-agent-hub)
9. [Admin Dashboard](#9-admin-dashboard)
10. [API Key System](#10-api-key-system)
11. [User Onboarding](#11-user-onboarding)
12. [Process Manager](#12-process-manager-bkgsh)
13. [Design System](#13-design-system)
14. [REST API Surface](#14-rest-api-surface)

---

## 1. Core Infrastructure

### Server (`server/serve.js`)
- [x] Single unified Express server serves React SPA + all APIs on one port
- [x] `.env` file loading at startup (plain `fs.readFileSync`, no dotenv dep required)
- [x] `BKG_PORT / BKG_HOST / BKG_LLAMA_PORT / BKG_OLLAMA_PORT` env vars
- [x] PID file written to `.bkg/run/serve.pid` at startup, removed on clean shutdown
- [x] `GET /health` — liveness probe (uptime, pid, port)
- [x] `GET /health/ready` — readiness probe (resolves after HTTP server binds)
- [x] Graceful shutdown on SIGTERM/SIGINT: drains open connections → 3 s force-close → 8 s hard exit
- [x] Tracks all open connections for clean teardown
- [x] `uncaughtException` + `unhandledRejection` handlers log and shut down cleanly
- [x] CORS: `Access-Control-Allow-Origin: *` for all API routes
- [x] `express.json()` + `express.urlencoded()` middleware
- [x] SPA catch-all serves `dist/index.html` for all unknown GET routes
- [x] Static files served from `dist/` with `maxAge: 0`
- [x] Correct `application/wasm` MIME type for WebAssembly files

### Authentication (`server/serve.js` — `/auth/*`)
- [x] `POST /auth/login` — bcrypt password verification (cost 12) via `bcryptjs`
- [x] `GET /auth/verify` — HMAC-SHA256 stateless token validation
- [x] `POST /auth/hash` — one-time password hash generator (first-run only)
- [x] Tokens expire after 7 days (server-enforced)
- [x] `BKG_ADMIN_PASSWORD_HASH` in `.env` (bcrypt); falls back to `bkg_admin_2024`
- [x] `BKG_JWT_SECRET` randomised per-run if not set

### Config directory (`~/.bkg/`)
- [x] `BKG_DIR` env override
- [x] Auto-creates subdirs: `sessions/ extensions/ skills/ prompts/ plugins/ hub-sessions/ workspaces/ users/`
- [x] `settings.json` — agent + model defaults
- [x] `api-keys.json` — bearer token store (SHA-256 hashed)
- [x] `global-providers.json` — admin global provider keys
- [x] `flow.db` — bKG Flow SQLite database
- [x] `users/<keyId>.json` — per-user config

---

## 2. Operating Modes

- [x] **Private mode** — local inference only (WebGPU / Ollama / llama-cpp); data never leaves device
- [x] **Cloud mode** — routes inference through `/providers/proxy` using configured provider keys
- [x] Mode stored in `localStorage` as `bkg_mode`; dispatched to `AppState.mode`
- [x] `SET_MODE` action in global reducer
- [x] Mode badge in header (amber = Private, cyan = Cloud)
- [x] Mode banner on home dashboard explains active mode + quick-switch link
- [x] Mobile mode toggle bar below header on small screens
- [x] BackendSelector is fully mode-aware (local backends in private, provider list in cloud)
- [x] Dashboard model cards show local backends in private mode, provider chips in cloud mode
- [x] Admin sidebar sections colour-coded by mode relevance

---

## 3. User Dashboard

### Home screen (`src/components/UserDashboard/Dashboard.tsx`)
- [x] Hero headline with animated Orbitron gradient text
- [x] **Private mode** — three local backend cards (WebGPU / Ollama / llama-cpp)
  - Live connectivity check via `/api/proxy/ping` (CORS-safe)
  - Per-backend colour theme (cyan / purple / blue)
  - Glow + corner rune decorations on active card
  - Model list from live server (Ollama: `/api/proxy/ollama/tags`, llama-cpp: `/api/proxy/llama/models`)
  - Offline cards disabled — cannot be selected when server unreachable
  - Clicking a card sets it as active inference backend
- [x] **Cloud mode** — provider chip grid from `/providers/list`
  - Tier badges (✅ Free / 🔄 Freemium / 🔧 Key / 💳 Paid)
  - Source indicator (user / shared / free)
- [x] Quick action cards: New Plan · Code Studio · Test Model · My Keys
- [x] Recent projects from browser SQLite (last 5) with Continue shortcut
- [x] Stats strip (total plans generated, plans today)
- [x] Empty state with animated float icon
- [x] Refresh button re-checks backend availability

### Model Tester (`src/components/UserDashboard/ModelTester.tsx`)
- [x] Inline chat playground for verifying any backend responds
- [x] Starter prompt chips for one-click testing
- [x] Auto-loads WebGPU engine with determinate progress bar during model download
- [x] Stop button for streaming responses
- [x] Shows backend type + model name (no raw URLs)
- [x] Backend / model name in header

### User Settings (`src/components/UserDashboard/UserSettings.tsx`)
- [x] Lists all 19 providers grouped by tier
- [x] Source badge per provider: `your key / shared key / env config / free access / not set`
- [x] Inline password-masked key input (click to edit, blur to stage)
- [x] Clear button removes key (falls back to global chain)
- [x] `PUT /user/providers` saves immediately
- [x] Fallback chain explanation panel
- [x] Security note: keys stored server-side, never in browser

---

## 4. Plan Generator (Wizard)

### Idea Input (`src/components/Stufe1/IdeaInput.tsx`)
- [x] Multi-line textarea for idea entry
- [x] Character count
- [x] "Propose Features" button with load state
- [x] Determinate WebGPU download progress bar (0–100%)
- [x] Indeterminate bar for REST backends during connection

### Idea Enhancer (`src/components/Stufe1/IdeaEnhancer.tsx`)
- [x] "Enhance with AI" button rewrites idea as detailed product brief
- [x] **Phase 1**: If WebGPU + engine not loaded → `ensureEngine()` with visible determinate progress
- [x] **Phase 2**: Runs enhancement (indeterminate sliding bar)
- [x] Sparkle success flash after completion
- [x] Inline error display

### Backend Selector (`src/components/Stufe1/BackendSelector.tsx`)
- [x] Collapsed bar shows: mode label + backend type + model name (no raw URLs)
- [x] **Private mode expanded**:
  - Size filter toggle (≤ 1B / All sizes)
  - Backend type pills (WebGPU / Ollama / llama-cpp) with per-type colour
  - WebGPU: 9 model options with cached / size indicators
  - Ollama: live model list from proxy (online-only); offline warning
  - llama-cpp: live model list from proxy (real files only); offline warning
  - Refresh button re-queries servers
  - Server config hint links to Admin (never shows raw URL to user)
- [x] **Cloud mode expanded**:
  - All 19 providers shown (inaccessible at 50% opacity with tooltip)
  - Provider chip sets backend type to `cloud` with `provider/model` modelId format
  - Editable model ID input for selected provider
  - Key source legend at bottom

### Feature Proposals (`src/components/Stufe1/FeatureProposals.tsx`)
- [x] AI generates feature list from enhanced idea
- [x] Accept / reject toggles per feature
- [x] Priority and complexity selectors
- [x] Feature count badge

### Generation Progress (`src/components/Stufe1/GenerationProgress.tsx`)
- [x] Multi-file generation with real-time streaming
- [x] Per-file progress bars
- [x] SSE event stream from agent

### Validation Loop (`src/components/Stufe1_5/ValidationLoop.tsx`)
- [x] AI validates generated plan against acceptance criteria
- [x] Step-by-step validation with pass/fail/warn indicators
- [x] Validation report with suggestion list

### Bundle Explorer (`src/components/Stufe2/DualPaneExplorer.tsx`)
- [x] File tree + Monaco editor split pane
- [x] Edit generated files before export
- [x] ZIP compiler for export
- [x] Diff indicator for modified files
- [x] File restore to original

### Code Studio (`src/components/CodeStudio/CodeStudio.tsx`)
- [x] Full coding agent session with pi-agent-core
- [x] File tree with streaming writes
- [x] Monaco editor with syntax highlighting
- [x] Agent chat panel with tool call rendering
- [x] Milestone tracking dialog
- [x] Version history

---

## 5. Local AI Backends

### WebGPU (`src/lib/webllm.ts`)
- [x] @mlc-ai/web-llm engine — runs quantised LLMs in Chrome/Edge via WebGPU
- [x] `ensureEngine(modelId, onProgress)` — loads with download progress callback
- [x] `isEngineReady()` / `isEngineLoading()` — state queries
- [x] `getCachedModelIds()` — cache scan for instant-load detection
- [x] `generateStreaming()` — streaming token generation
- [x] `generateWithTools()` — tool-calling support
- [x] `createEmbeddings()` — embedding vectors
- [x] 9 pre-configured model options (0.5B – 7B)
- [x] WebWorker-based to avoid blocking the main thread
- [x] SharedArrayBuffer COOP/COEP headers managed by vite config

### Ollama (proxy at `/api/proxy/ollama/*`)
- [x] `GET /api/proxy/ollama/tags` — list installed models (server-side, CORS-safe)
- [x] `POST /api/proxy/ollama/pull` — streaming model download
- [x] `DELETE /api/proxy/ollama/delete` — remove model
- [x] `pingRestBackend()` routes through `/api/proxy/ping` for localhost URLs
- [x] Ollama Manager admin UI (pull, delete, inspect)

### node-llama-cpp (`server/index.js`, proxy at `/api/proxy/llama/*`)
- [x] node-llama-cpp v3 inference server with function calling
- [x] `/v1/chat/completions` (streaming + non-streaming)
- [x] `/v1/models` — list loaded GGUF files
- [x] `/health` — model load status
- [x] `/model` — swap loaded model (PUT)
- [x] `/models/pull` — GGUF download with SSE progress
- [x] `/models/:file` — delete GGUF file
- [x] `/gpu` — GPU backend + info
- [x] `/v1/embeddings` — embedding generation
- [x] Node-llama-cpp Manager admin UI (model swap, pull, GPU info)

---

## 6. Cloud Provider System

### Provider Registry (`server/providers.js`)
19 providers across 4 tiers:

| Tier | Providers |
|------|-----------|
| ✅ Free | Kilo, LLM7, OpenRouter, Cline |
| 🔄 Freemium | NVIDIA NIM, SambaNova, Ollama Cloud |
| 🔧 Dynamic (API key) | Groq, Mistral, Cerebras, xAI, HuggingFace, FastRouter |
| 💳 Paid (trial credits) | Codestral, DeepInfra, Together AI, ZenMux, CrofAI, Novita AI |

Each provider has: `id, name, tier, baseUrl, envKey, configKey, description, signupUrl, anonAccess`

- [x] `resolveProviderKey(providerId, userKeys, globalKeys)` — full fallback chain
- [x] `fetchProviderModels(providerId, apiKey)` — live model list from provider API
- [x] `GET /providers/list` — all providers + per-caller key status
- [x] `GET /providers/:id/models` — live model list with resolved key
- [x] `POST /providers/proxy` — streaming inference proxy (SSE forward)
  - Forwards to provider's `/chat/completions`
  - Resolves key: user → admin global → env → anon
  - OpenRouter `HTTP-Referer` + `X-Title` headers added automatically
  - 60 s timeout
  - Returns 403 with `signupUrl` if no key and provider requires one

### User provider management (`server/users.js`)
- [x] Per-user config at `~/.bkg/users/<keyId>.json`
- [x] `getUserProviderKeys(keyId)` / `setUserProviderKeys(keyId, updates)`
- [x] Empty string value = delete that key (falls back to global)
- [x] `getUserProviderStatus(keyId)` — per-provider source badge for UI
- [x] `resolveKeyForUser(providerId, keyId)` — full chain resolution
- [x] `GET/PUT /user/providers` — user's provider key status / update
- [x] `GET /user/profile` — keyId, name, onboarded flag
- [x] `POST /user/onboarded` — mark onboarding complete

### Admin global providers
- [x] `~/.bkg/global-providers.json` — admin-level fallback keys + settings
- [x] `defaultProvider`, `defaultModel`, `freeOnly` flag
- [x] `GET /admin/globals` — masked key values (••••••••) in response
- [x] `PUT /admin/globals` — update settings
- [x] `POST /admin/globals/providers` — update specific key values
- [x] Admin UI: Global Providers tab with tier-grouped accordion
- [x] Provider keys shown masked with eye toggle; clear button per key
- [x] Signup links per provider
- [x] Free-only mode toggle

---

## 7. bKG Flow — Task Board

*Rebraneded/refactored from the Fusion project management system.*

### Database (`server/bkg-flow.js`, `~/.bkg/flow.db`)
- [x] SQLite with WAL mode + foreign keys via `better-sqlite3`
- [x] Auto-migration: creates all tables + indexes + triggers on first run
- [x] FTS5 virtual table with porter stemmer for full-text search
- [x] Auto-sync triggers keep FTS index up-to-date (INSERT/UPDATE/DELETE)
- [x] Default project seeded on first run

### Tasks
- [x] Task lifecycle: `planning → todo → in-progress → review → done → archived`
- [x] All 6 states with allowed transitions
- [x] `started_at` / `done_at` timestamps auto-set on status transitions
- [x] Priority (0–100), labels (JSON array), metadata (JSON object)
- [x] `branch` field auto-set to `flow/<id>` on creation
- [x] `prompt_md` field stores AI-generated PROMPT.md
- [x] `exec_model` / `plan_model` per-task model overrides
- [x] `agent_session` links to Agent Hub session
- [x] `pause_reason` for blocked/paused tasks
- [x] Max `order_index` auto-increment within project
- [x] Activity log entry on every status change + create/delete

### Task dependencies
- [x] BFS cycle detection — rejects any dep that would create a cycle
- [x] `task_deps` join table with CASCADE delete
- [x] `POST /flow/tasks/:id/deps` + `DELETE /flow/tasks/:id/deps/:depId`
- [x] `dependencyIds` array returned on every task fetch

### Full-text search
- [x] FTS5 MATCH query with porter stemming + prefix wildcards
- [x] Graceful fallback to `LIKE` query if FTS index is corrupt
- [x] Searches across `title`, `description`, `prompt_md`
- [x] `GET /flow/tasks/search?projectId=&q=`

### AI task planning
- [x] `buildPlanningPrompt(task, project)` — structured system + user prompt for PROMPT.md generation
- [x] `POST /flow/tasks/:id/plan` — calls `/providers/proxy` (Groq default)
- [x] Falls back to a static template if no provider key is configured
- [x] Sets task status to `planning` during generation, resets to `todo` on failure
- [x] Saves PROMPT.md to `prompt_md` column; marks task as `todo` on success
- [x] Activity log entries for planning start/complete/fail

### Task logs
- [x] `task_logs` table with level (info/warn/error), message, timestamp
- [x] In-memory SSE subscriber fan-out — real-time to all open log streams
- [x] `GET /flow/tasks/:id/logs` — SSE when `Accept: text/event-stream`, REST otherwise
- [x] `?since=<timestamp>` for incremental polling
- [x] 15 s SSE heartbeat

### Workflow steps
- [x] `workflow_steps` table: title, phase (plan/execute/review), status, output
- [x] Auto-increment `order_index`
- [x] `GET/POST /flow/tasks/:id/steps` + `PUT /flow/steps/:id`
- [x] `done_at` timestamp on step completion

### Comments
- [x] `task_comments` table with author + body
- [x] `GET/POST /flow/tasks/:id/comments`

### Missions + Milestones
- [x] `missions` table: title, description, status, project_id
- [x] `milestones` table: title, order_index, mission_id, project_id
- [x] Full CRUD for missions; milestone create + list
- [x] Task → milestone_id + mission_id foreign keys

### Projects
- [x] `projects` table: name, description, path, color, settings
- [x] Soft-archive (archived=1) rather than hard-delete
- [x] `GET/POST/PUT/DELETE /flow/projects/*`
- [x] Default project auto-created on first run

### Secrets (AES-256-GCM)
- [x] `secrets` table: per-row nonce (12 bytes random), ciphertext
- [x] AES-256-GCM encryption; master key from `BKG_MASTER_KEY` env or `scryptSync`
- [x] Auth tag appended to ciphertext, verified on decrypt
- [x] `policy` field: auto / prompt / deny
- [x] Project-scoped secrets
- [x] `GET/POST/DELETE /flow/secrets`

### Evaluations
- [x] `evaluations` table: score (0–100), band (excellent/good/fair/poor), evidence (JSON)
- [x] Band auto-derived from score thresholds (90/70/50)
- [x] `GET/POST /flow/tasks/:id/evals`

### Activity feed
- [x] Append-only `activity` table with type, actor, payload (JSON)
- [x] Auto-logged on: task create/delete/status-change, planning start/end
- [x] `GET /flow/activity?projectId=&limit=`

### Kanban Board UI (`src/components/Flow/FlowBoard.tsx`)
- [x] 5 columns: Planning · Todo · In Progress · Review · Done
- [x] Column headers with colour-coded indicators + task count badges
- [x] **TaskCard**: left accent bar (status colour), title, description preview, labels, dep count badge, stale warning (>3 days in-progress), priority dot (high), PROMPT.md indicator
- [x] Quick-move dropdown on hover — moves to any other status in one click
- [x] Inline task creation form with title, description, status selector
- [x] Debounced FTS search (300 ms) with live results overlay
- [x] Project selector dropdown with colour swatches
- [x] Board stats strip (active count, done count)
- [x] Refresh button

### Task Detail Modal (`src/components/Flow/FlowTask.tsx`)
- [x] 6 tabs: Overview / Plan / Steps / Comments / Logs / Evals
- [x] **Overview**: inline title edit (Enter to save), inline description edit, AI Plan button, branch + priority meta grid, next-status quick-advance button
- [x] **Plan**: minimal Markdown renderer (h1–h3, ordered/unordered lists, checkboxes, paragraphs)
- [x] **Steps**: check/uncheck workflow steps, add new step
- [x] **Comments**: comment list with author + timestamp, add comment input
- [x] **Logs**: REST log list (SSE in future), auto-scroll to bottom
- [x] **Evals**: score history with band labels, quick-score buttons (25/50/75/90/100)
- [x] Status colour theme applied to modal border + header

---

## 8. bKG Agent Hub

*Pure Node.js reimplementation of sandbox-agent's feature set.*

### Agent detection (`server/bkg-hub.js`)
- [x] `listAgents()` — detects all installed agents via `which` + `--version`
- [x] Pi (always available via pi-coding-agent)
- [x] Claude Code (`claude` CLI)
- [x] Codex (`codex` CLI)
- [x] OpenCode (`opencode` CLI)
- [x] Amp (`amp` CLI)
- [x] Per-agent: id, name, description, installed, version, modes, requiresKey, local flag

### Session management
- [x] `createSession(id, agentId, mode, options)` — workspace at `~/.bkg/workspaces/<id>/`
- [x] `sendMessage(sessionId, text)` — routes to Pi or CLI agent
- [x] `abortSession(sessionId)` — SIGINT to subprocess
- [x] `destroySession(sessionId)` — kills proc, clears subscribers, removes from store
- [x] `listSessions()` / `getSession(id)` — registry queries
- [x] Session persistence: JSONL event log at `~/.bkg/hub-sessions/<id>.jsonl`
- [x] Events loaded from disk on reconnect (survives server restart)
- [x] `pendingPermission` state tracked per session

### Pi agent routing
- [x] Lazy session creation — pi session created on first `sendMessage`
- [x] Pi event polling loop (300 ms) forwards pi events to hub events
- [x] `_normalizePiEvent()` maps pi event kinds to universal schema

### CLI agent routing
- [x] `_buildCliArgs(agentId, mode, text)` — correct flags per agent
- [x] Spawns CLI in `cwd` with `stdio: pipe` + minimal env
- [x] stdout/stderr forwarded as `text` / `error` events
- [x] Exit code captured in `command_done` event
- [x] `SIGTERM` on abort, `SIGTERM` + error event on spawn failure

### Universal event schema
Events: `text · message · tool_call · tool_result · permission · error · status · command_start · command_delta · command_done · file_change`

- [x] All events: `{ id, ts, sessionId, type, data }`
- [x] Persisted to JSONL immediately on push
- [x] Broadcast to all SSE subscribers in real-time

### SSE streaming
- [x] `streamSessionEvents(sessionId, req, res, offset)` — offset-resumable SSE
- [x] Replays buffered events from `offset` before subscribing to live stream
- [x] 15 s heartbeat (`": ping"`)
- [x] Clean unsubscribe on `req.close`
- [x] `listSessionEvents(id, offset, limit)` — paginated REST alternative

### Permission handling
- [x] `replyPermission(sessionId, approved, response)` — resolves pending promise
- [x] `POST /hub/sessions/:id/permission` — approve / deny from UI
- [x] Session status set to `waiting_permission` → `running` on reply

### File system proxy (workspace-scoped)
- [x] `fsRead(sessionId, relPath)` — read file or list directory
- [x] `fsWrite(sessionId, relPath, content)` — write with auto-mkdir
- [x] `fsDelete(sessionId, relPath)` — delete file
- [x] `fsList(sessionId, relPath)` — directory listing with name/type/size/mtime
- [x] Path-escape guard: `resolve(cwd, relPath)` must remain inside `cwd`
- [x] `file_change` event emitted on write/delete

### Process execution
- [x] `execInSession(sessionId, command, req, res)` — shell command SSE stream
- [x] Spawns `sh -c <command>` in session workspace
- [x] stdout/stderr forwarded as `command_delta` events per stream
- [x] `command_done` event with exit code
- [x] Process killed if client disconnects

### Agent Hub UI (`src/components/AgentHub/AgentHub.tsx`)
- [x] Three panels: **Terminal** · **Files** · **Sessions**
- [x] **Terminal**: SSE event stream with per-type rendering (text, tool_call, tool_result, command_delta, file_change, error, status)
- [x] **Files**: workspace directory browser + inline text editor (read/write/delete), path breadcrumb, refresh
- [x] **Sessions**: session cards with agent name, mode badge, status indicator, event count, delete button
- [x] Agent selector dropdown: shows installed status, version, local badge, mode picker
- [x] Mode picker per agent (default / plan / bypass)
- [x] Permission modal: blocks UI, shows prompt, approve/deny buttons
- [x] Abort button stops current agent turn
- [x] New Session button creates session immediately
- [x] Auto-scroll terminal to latest event

---

## 9. Admin Dashboard

### Auth gate (`src/components/Admin/AdminAuth.tsx`)
- [x] Password form → `POST /auth/login` → bcrypt verify → HMAC token
- [x] Token stored in `sessionStorage` as `bkg_admin_token`
- [x] Auto-verify token with server on AdminApp mount
- [x] Server-offline detection with hint to run `./bkg.sh start`
- [x] Default password hint + `BKG_ADMIN_PASSWORD_HASH` guidance

### Admin shell (`src/components/Admin/AdminApp.tsx`)
- [x] Sidebar with 3 colour-coded sections: Cloud · Private · General
- [x] Mobile: sidebar collapses to overlay drawer (hamburger toggle)
- [x] Mode indicator badge in header (Cloud / Private)
- [x] Active tab shows Orbitron heading + section label
- [x] Lock button → `logout()` + redirect to login

### Tabs

| Tab | Component | Features |
|-----|-----------|----------|
| **Global Providers** | `GlobalProviders.tsx` | Set fallback API keys for all 19 providers; free-only mode; default model/provider selector; tier-grouped accordion |
| **API Keys** | `ApiKeys.tsx` | Create named bearer tokens (inference/agent/admin/readonly); masked display; enable/disable toggle; revoke; last-used tracking; curl usage hint |
| **Agent Settings** | `AgentSettings.tsx` | Backend type, server URL, model ID, tools list, system prompt prefix, working directory, context window |
| **Plugins** | `PluginManager.tsx` | Install pi-compatible packages (npm: / git:); enable/disable; remove; npm search |
| **Server Manager** | `ServerManager.tsx` | Start/stop llama-cpp + Ollama; view logs; systemd unit generation |
| **Download Models** | `ModelDownloadPanel.tsx` | Pull GGUF files with SSE progress; recommended model list with sizes |
| **Embeddings Lab** | `EmbeddingsLab.tsx` | Test embedding generation; similarity scoring |
| **System Stats** | `SystemStats.tsx` | CPU, memory, disk usage |
| **Ollama Manager** | `OllamaManager.tsx` | Pull/delete Ollama models; model list with size + date |
| **node-llama-cpp** | `NodeLlamaCppManager.tsx` | Model swap; GPU backend info; health status |
| **WebLLM Cache** | `WebLLMCache.tsx` | Inspect browser-cached WebGPU models; cache size |
| **AI Settings** | `AISettings.tsx` | Default model selector for UI; save to localStorage |

---

## 10. API Key System

### Server (`server/api-keys.js`)
- [x] Keys stored at `~/.bkg/api-keys.json` (SHA-256 hashed, never plaintext)
- [x] 4 scopes: `inference · agent · admin · readonly`
- [x] Key format: `bkg_<48 hex chars>`
- [x] `keyPrefix` (first 12 chars) stored for display
- [x] `lastUsedAt` updated on every successful validation
- [x] `enabled` flag for temporary disable without revoke
- [x] `POST /api-keys/self-register` — no-auth key creation (3/hr rate limit per IP)
- [x] `GET/POST /api-keys` — list + create (admin JWT required)
- [x] `DELETE /api-keys/:id` — revoke (admin JWT required)
- [x] `PUT /api-keys/:id/enabled` — enable/disable
- [x] `GET /api-keys/scopes` — scope definitions

### Middleware (`requireApiKey(...scopes)`)
- [x] Accepts both bearer API keys and admin JWT tokens
- [x] Scope enforcement: key scope must match one of the required scopes (or be `admin`)
- [x] Returns 401 with `{ error }` on failure, 403 on scope mismatch
- [x] Attaches `req.apiKey` for downstream handlers

---

## 11. User Onboarding

### Onboarding wizard (`src/components/UserDashboard/Onboarding.tsx`)
- [x] Triggered on first visit when `localStorage.bkg_user_api_key` is not set
- [x] Re-triggerable via `window.dispatchEvent(new Event('bkg:show-onboarding'))`
- [x] Step 1 — Welcome + API key generation
  - `POST /api-keys/self-register` creates a `bkg_XXXXX` key
  - Key stored in `localStorage.bkg_user_api_key`
  - Key displayed once with show/hide toggle + copy button
  - Warning that key won't be shown again
- [x] Step 2 — Optional provider key setup
  - Featured providers: Groq, NVIDIA, OpenRouter, Mistral, SambaNova
  - Signup links per provider
  - `PUT /user/providers` saves keys to server
  - Skip button skips without saving
- [x] Step 3 — Done
  - Shows count of configured providers
  - CTA: "Create My First Plan" + "Open Agent Hub"
- [x] Step indicator (dots) + step counter
- [x] Dismiss/skip (X) at any step
- [x] `POST /user/onboarded` called on completion

---

## 12. Process Manager (`bkg.sh`)

- [x] `start` — kills existing instance; auto-rebuilds if source newer than `dist/`; starts `serve.js`; opens serveo tunnel; waits for `GET /health/ready`
- [x] `stop` — graceful kill by PID file; port fallback kill; `pkill` by name
- [x] `restart` — stop + start
- [x] `status` — shows PID, port, tunnel URL, llama-cpp + Ollama port status
- [x] `build` — `npm install` if missing; `npm run build`
- [x] `dev` — Vite dev server + tunnel
- [x] `logs [serve|tunnel|dev|build|all]` — `tail -f`
- [x] Configuration via `.bkg.env` (sourced at runtime)
- [x] PID files at `.bkg/run/*.pid`; log files at `.bkg/logs/*.log`
- [x] Readiness check: polls `GET /health/ready` (not just port-open)
- [x] TCP socket probe for sandbox-agent (no port-binding race)
- [x] Colour output (✔ ✖ ⚠ ●)
- [x] `.bkg.env.example` documents all options

---

## 13. Design System

### Palette — Atlantis Cyberpunk

| Token | Value | Use |
|-------|-------|-----|
| `base` | `#030810` | Page background (deep ocean) |
| `surface` | `#060f1e` | Card backgrounds |
| `panel` | `#091628` | Panel / sidebar |
| `border` | `#0d2a40` | Default borders |
| `accent` | `#00e5ff` | Bioluminescent cyan — primary actions |
| `mystic` | `#a855f7` | Purple — secondary accent |
| `amber` | `#ffb300` | Private mode, warnings |
| `success` | `#00e5a0` | Seafoam green — positive states |
| `error` | `#ff3d6b` | Errors |
| `muted` | `#6b8ca8` | Secondary text (raised for contrast) |
| `text-primary` | `#e8f4f8` | Primary text (cool white) |

### Typography
- [x] **Orbitron** — logo, hero headings, section titles
- [x] **Space Grotesk** — body text (weights 300–700)
- [x] **JetBrains Mono** — code, IDs, terminal, key prefixes

### Custom CSS utilities
- [x] `.glass` — dark frosted glass header (backdrop-filter + teal border)
- [x] `.card-crystal` — crystalline card with inset glow
- [x] `.glow-sm / .glow / .glow-lg` — box-shadow glow levels
- [x] `.glow-mystic` — purple glow variant
- [x] `.btn-glow` — accent button glow
- [x] `.text-gradient-cyan / .text-gradient-atlantis / .text-gradient-mystic` — animated gradient text
- [x] `.rune-divider` — horizontal line with centre rune glyph
- [x] `.badge-online / .badge-offline / .badge-pending` — status pills
- [x] `.scanlines::after` — subtle CRT scanline overlay
- [x] `.corner-hex::before/::after` — crystalline corner brackets
- [x] `.font-display` — Orbitron display font class
- [x] `.shadow-deep` — deep elevation shadow

### Animations (Tailwind keyframes)
- [x] `glowPulse` — pulsing border/box-shadow (3 s ease-in-out)
- [x] `float` — gentle vertical bob (6 s)
- [x] `gradientShift` — gradient background pan (4 s)
- [x] `progressShimmer` — loading bar sweep
- [x] `scanLine` — single scan-line sweep across screen
- [x] `drift` — subtle random position drift
- [x] `orbRotate` — orbital ring rotation
- [x] `dataStream` — scrolling data pattern
- [x] `blink` — cursor blink

### Responsive breakpoints
- [x] Mobile (< 640px): hamburger drawer nav, 2-col grids, reduced padding, compact mode banner
- [x] Tablet (640–1024px): 2-col model cards, sidebar collapses in admin
- [x] Desktop (1024px+): full nav, 3–4 col grids, sidebar always visible in admin

### Layout
- [x] `AppShell` — fixed header + scrollable main; `maxWidth: 100vw` prevents horizontal bleed
- [x] `StageProgress` — crystalline stepper: glowing active node, checkmark for done, gradient connectors; hidden on `home` + `agenthub`
- [x] Mobile drawer — animated slide-in from left, backdrop blur, section-grouped nav

---

## 14. REST API Surface

100+ endpoints across 12 namespaces:

| Namespace | Count | Purpose |
|-----------|-------|---------|
| `/auth/*` | 3 | Admin authentication |
| `/api/*` | 12 | Local model server management |
| `/api/proxy/*` | 7 | CORS-safe local backend proxy |
| `/api-keys/*` | 6 | Bearer token management |
| `/providers/*` | 3 | Provider registry + cloud proxy |
| `/user/*` | 4 | Per-user settings |
| `/admin/*` | 4 | Admin global config |
| `/agent/*` | 8 | Pi coding agent sessions |
| `/flow/*` | 34 | Task board (bKG Flow) |
| `/hub/*` | 14 | Agent hub sessions + FS + exec |
| `/sandbox/*` | 5 | sandbox-agent binary proxy |
| `/plugins/*` | 6 | Plugin manager |
| `/settings` | 2 | Agent configuration |
| `GET /health*` | 2 | Liveness + readiness probes |

---

## 15. Game Studio (Single-Player Blueprint Wizard)

### Blueprint System (`server/bkg-game-blueprint.js`)
- [x] Full game blueprint schema: World · Story · NPCs · Monsters · Quests · Loot · Levels · Zones
- [x] CRUD: create, get, list (by mode), update, patch section, delete
- [x] `blueprintStats()` — per-section completion percentage
- [x] AI prompts for 9 sections: world/story/npcs/monsters/quests/loot/levels/zones/gameplan
- [x] Entity templates: npcTemplate, monsterTemplate, questTemplate, itemTemplate, zoneTemplate
- [x] Stored in `~/.bkg/blueprints/<id>.json` (JSON, human-readable)

### AI Generation (SSE Streaming)
- [x] `POST /game/blueprint/:id/generate/:section` — token streaming via SSE
- [x] Key resolution: user profile → global admin → env var
- [x] Supports NVIDIA NIM (nvapi-*) and OpenRouter (any other key)
- [x] Auto-parses JSON arrays (npcs/monsters/quests/zones) from streamed text
- [x] Auto-saves parsed data + full text back to blueprint on completion

### Game Wizard UI (`src/components/Game/GameWizard.tsx`)
- [x] 10-step pipeline: Setup → World → Story → NPCs → Monsters → Quests → Loot → Levels → Zones → Launch
- [x] Live streaming token output per step
- [x] NPCs: card grid with type/faction/level
- [x] Monsters: responsive table with tier colour-coding
- [x] Quests: type-coloured list (main=amber, side=cyan, hidden=purple)
- [x] Loot: tier badge strip + item list with rarity colours
- [x] Levels: class chips + stats grid
- [x] Zones: 2-column grid with type accent colours
- [x] Launch: completion meter, JSON viewer, Flow task + World Builder shortcuts
- [x] Single-player only (mode=singleplayer enforced)

---

## 16. Admin: Game Blueprint Manager

### MMOCreator Panel (`src/components/Admin/MMOCreator.tsx`)
- [x] New admin tab: "Game Blueprints" (Globe icon, general section)
- [x] Blueprint list: MMO worlds + single-player blueprints in two sections
- [x] Per-blueprint: genre, tone, status badge, section completion progress bar
- [x] Create MMO world modal: name, concept, genre, tone, max players, PvP toggle
- [x] Blueprint detail: 9-section card grid with generate/edit/regen per section
- [x] Live streaming generation in section cards
- [x] Inline JSON editor per section with save/cancel
- [x] Publish/Unpublish button (LIVE badge visible to users in Game Client)
- [x] Status bar: shows published world names + count
- [x] Delete blueprint with confirmation

---

## 17. Game Client (User MMO Lobby)

### GameClient (`src/components/Game/GameClient.tsx`, stage: `game-client`)
- [x] Fetches `/game/mmo/worlds` (published blueprints only)
- [x] World cards: name, LIVE badge, genre/tone, stats (NPCs/Monsters/Quests/Zones)
- [x] Per-genre colour theming (rpg=purple, fps=red, sci-fi=cyan, etc.)
- [x] Completion progress bar per world
- [x] "Enter World" button → navigates to MMO Engine
- [x] Empty state with redirect to single-player Game Studio
- [x] Single-player CTA in header + footer
- [x] Feature strip: Items & Loot · Progression · Open World

---

## 18. World Builder

### WorldBuilder (`src/components/Game/WorldBuilder.tsx`, stage: `world-builder`)
- [x] 4-step flow: Choose Blueprint → Configure → Generate → Open in Voxel
- [x] Blueprint picker: shows all blueprints with zone count + existing worldId
- [x] World name + seed input with random-seed button
- [x] Info panel: what gets generated from blueprint params
- [x] Creates VLDB world via `POST /vldb/worlds` using blueprint biomes/size/seed
- [x] Links `worldId` back to blueprint via `PUT /game/blueprint/:id`
- [x] Step 4: "Open in Voxel Engine" + "Build Another World" options

---

## 19. Infrastructure Updates

### Docker
- [x] Multi-stage Dockerfile (node:22-alpine, non-root `bkg` user)
- [x] `docker-compose.yml` with `bkg-data` named volume
- [x] `.dockerignore` — excludes node_modules, dist, *.gguf
- [x] HEALTHCHECK via wget to `/health/ready`

### Install Script (`install.sh`)
- [x] Interactive: "1) Local install  2) Docker"
- [x] Local: checks Node 20+, npm install, build, start server
- [x] Docker: `docker compose build && up -d`
- [x] Subcommands: start, stop, install, docker-start, local-start
- [x] Shows admin password on first start from `~/.bkg/install.key`

### First-Run Admin Key
- [x] Auto-generates `bkg_<12hex>` password on fresh install
- [x] Stores bcrypt hash in `~/.bkg/admin.env`
- [x] Stores plaintext in `~/.bkg/install.key` (one-time)
- [x] Prints prominently in terminal (bordered box)
- [x] `GET /admin/install-key` — delivers key once, deletes file + memory
- [x] Admin UI shows amber banner with key + copy button + pre-filled password field

### REST API additions
- [x] `/game/blueprint/*` — 8 CRUD endpoints + SSE generation
- [x] `/game/mmo/*` — 3 MMO world management endpoints
- [x] `/admin/db/*` — 4 DB viewer endpoints (databases, tables, rows, SQL query)
- [x] `/admin/install-key` — one-time install key delivery

