# bKG — best Known Garbage

> AI-powered local coding workspace with free cloud provider integration,
> task management, and a universal coding agent harness.

---

## What is bKG?

**bKG** is a self-hosted AI coding workspace that runs entirely on your machine.
It combines three systems into one unified web app:

| System | What it does |
|--------|--------------|
| **bKG Flow** | AI task board (Kanban, PROMPT.md planning, missions, evals) |
| **bKG Agent Hub** | Universal coding agent interface (Pi, Claude Code, Codex, etc.) |
| **bKG Plan Generator** | Wizard that turns a raw idea into a full software plan |

Everything is served from a single Node.js process. No Docker, no cloud accounts required.
WebGPU models run 100 % in the browser. Ollama and node-llama-cpp run locally.
Free cloud providers (Groq, NVIDIA, OpenRouter, …) are optional.

---

## Quick Start

### 1. Clone

```bash
git clone https://github.com/soniaschuh88-ship-it/super-waddle.git
cd super-waddle
```

### 2. Install dependencies

```bash
# Root (frontend)
npm install

# Server
cd server && npm install && cd ..
```

### 3. Configure

```bash
cp .env.example .env
# Edit .env — at minimum set BKG_ADMIN_PASSWORD_HASH
# Generate a hash:  node -e "const b=require('bcryptjs');console.log(b.hashSync('yourpw',12))"
```

### 4. Build and start

```bash
# Build frontend bundle
npm run build

# Start everything (app server + serveo tunnel)
./bkg.sh start

# Or just the server (no tunnel)
BKG_TUNNEL=0 ./bkg.sh start
```

App is at **http://localhost:4001**
Admin at **http://localhost:4001/admin**

---

## `bkg.sh` Process Manager

```
./bkg.sh start          # kill existing → build if needed → serve.js + tunnel
./bkg.sh stop           # graceful stop (PID file + port)
./bkg.sh restart        # stop + start
./bkg.sh status         # ports, PIDs, public tunnel URL
./bkg.sh build          # rebuild dist/ only
./bkg.sh dev            # Vite hot-reload dev server + tunnel
./bkg.sh logs [serve|tunnel|dev|build|all]
```

### `.bkg.env` options

```bash
BKG_PORT=4001          # main server port
BKG_TUNNEL=1           # 1 = open serveo.net tunnel
BKG_NO_BUILD=0         # 1 = skip rebuild check
```

---

## Operating Modes

### 🔒 Private Mode
All inference stays on your device. No data sent externally.

- **WebGPU** — runs quantised LLMs directly in Chrome/Edge (no install needed)
- **Ollama** — local API server at `http://localhost:11434`
- **node-llama-cpp** — GGUF model server bundled with bKG at port 8001

Switch in the header bar or `localStorage.setItem('bkg_mode','private')`.

### ☁ Cloud Mode
Routes inference through free provider APIs via the bKG server proxy.
Your API keys are stored server-side; the browser never touches them directly.

Free providers: **Groq · NVIDIA NIM · LLM7 · Kilo · OpenRouter · SambaNova · Mistral · Cerebras · xAI · HuggingFace** + more.

---

## Architecture

```
Browser (React + Vite)
  │
  ├─ /            → SPA (dist/)
  ├─ /admin       → Admin Dashboard
  ├─ /api/*       → Model server manager (llama-cpp + Ollama)
  ├─ /api/proxy/* → CORS-safe proxy for local backends
  ├─ /auth/*      → Admin login (bcrypt + HMAC token)
  ├─ /api-keys/*  → API key CRUD (bearer token auth)
  ├─ /providers/* → Provider registry + /proxy (cloud inference)
  ├─ /user/*      → Per-user provider keys + onboarding
  ├─ /admin/*     → Global provider config (admin only)
  ├─ /flow/*      → bKG Flow task board (SQLite)
  ├─ /hub/*       → bKG Agent Hub (sessions, SSE, FS, exec)
  ├─ /sandbox/*   → Legacy sandbox-agent proxy (deprecated)
  ├─ /agent/*     → Pi coding agent sessions
  ├─ /plugins/*   → Plugin manager
  └─ /settings    → Agent configuration
```

### Server files

| File | Purpose |
|------|---------|
| `server/serve.js` | Unified Express server — static SPA + all API routes |
| `server/agent.js` | Pi coding agent engine (pi-agent-core) |
| `server/bkg-flow.js` | Task board — SQLite DB, CRUD, AI planning |
| `server/bkg-hub.js` | Agent hub — sessions, SSE, FS, process exec |
| `server/providers.js` | Free provider registry (19 providers) |
| `server/users.js` | Per-user config, provider keys, fallback chain |
| `server/api-keys.js` | Bearer token store (hashed) |
| `server/sandbox.js` | sandbox-agent binary manager |
| `server/plugins.js` | Pi-compatible plugin manager |
| `server/index.js` | node-llama-cpp inference server |

### Frontend structure

```
src/
├─ components/
│  ├─ Layout/         AppShell, StageProgress
│  ├─ UserDashboard/  Dashboard, ModelTester, UserSettings, Onboarding
│  ├─ Flow/           FlowBoard, FlowTask
│  ├─ AgentHub/       AgentHub
│  ├─ Admin/          AdminApp, AdminAuth, ApiKeys, GlobalProviders, ...
│  ├─ Stufe1/         WizardModal, BackendSelector, IdeaEnhancer
│  ├─ Stufe1_5/       ValidationLoop
│  ├─ Stufe2/         DualPaneExplorer
│  ├─ Stufe3/         TerminalConsole
│  └─ CodeStudio/     CodeStudio
├─ context/           AppContext (stage, mode, backendConfig, ...)
├─ lib/               llm-client, webllm, db, prompts, simulation
└─ types/             index.ts
```

---

## Configuration

### `.env` (server-side)

| Variable | Default | Description |
|----------|---------|-------------|
| `BKG_PORT` | `4001` | HTTP port |
| `BKG_HOST` | `0.0.0.0` | Bind address |
| `BKG_LLAMA_PORT` | `8001` | node-llama-cpp port |
| `BKG_OLLAMA_PORT` | `11434` | Ollama port |
| `BKG_ADMIN_PASSWORD_HASH` | — | bcrypt hash of admin password |
| `BKG_JWT_SECRET` | random | HMAC secret for admin tokens |
| `BKG_DIR` | `~/.bkg` | Config + data directory |
| `BKG_FLOW_DB` | `~/.bkg/flow.db` | Flow SQLite database path |
| `BKG_MASTER_KEY` | scrypt-derived | AES-256-GCM key for secrets |
| `BKG_SA_PORT` | `7468` | sandbox-agent port |
| `BKG_TUNNEL` | `1` | Enable serveo tunnel |

Provider API keys (optional):
`GROQ_API_KEY` · `NVIDIA_API_KEY` · `OPENROUTER_API_KEY` · `MISTRAL_API_KEY` · `SAMBANOVA_API_KEY` · `CEREBRAS_API_KEY` · `XAI_API_KEY` · `HF_TOKEN` · `LLM7_API_KEY`

### Data directory `~/.bkg/`

```
~/.bkg/
├─ flow.db              bKG Flow SQLite database
├─ settings.json        Agent + model settings
├─ api-keys.json        Bearer token store (hashed)
├─ global-providers.json  Admin global API key config
├─ auth.json            Pi auth storage
├─ users/               Per-user provider key configs
├─ hub-sessions/        Agent hub session event logs (.jsonl)
├─ workspaces/          Agent hub session working directories
├─ sessions/            Pi agent session JSONL logs
├─ extensions/          Pi agent extensions
├─ skills/              Pi agent skill bundles
└─ plugins/             Plugin installs
```

---

## Admin Dashboard

Navigate to `/admin` and log in with the admin password.

| Tab | Purpose |
|-----|---------|
| **Global Providers** | Set fallback API keys for all 19 providers |
| **API Keys** | Create/revoke bearer tokens (inference / agent / admin / readonly) |
| **Agent Settings** | Configure model backend (type, URL, model ID) |
| **Server Manager** | Start/stop llama-cpp and Ollama servers |
| **Download Models** | Pull GGUF models to `server/models/` |
| **Ollama Manager** | Pull, delete, inspect Ollama models |
| **node-llama-cpp** | Model swap, GPU info, health check |
| **WebLLM Cache** | Inspect browser-cached WebGPU models |
| **Plugins** | Install pi-compatible extension packages |
| **Embeddings Lab** | Test embedding models |
| **System Stats** | CPU / memory / disk |
| **AI Settings** | UI model selector defaults |

---

## API Reference

### Auth

```bash
POST /auth/login          { password } → { token }
GET  /auth/verify         Authorization: Bearer <token> → { valid }
POST /auth/hash           { password } → { hash }  (first-run only)
```

### bKG Flow

```bash
GET  /flow/health
GET  /flow/board/:projectId
GET  /flow/projects
POST /flow/projects                  { name, description, color }
GET/PUT/DELETE /flow/projects/:id
GET  /flow/tasks?projectId=&status=
POST /flow/tasks                     { title, description, status, projectId }
GET/PUT/DELETE /flow/tasks/:id
POST /flow/tasks/:id/move            { status, index? }
POST /flow/tasks/:id/plan            { providerId?, model? }  → PROMPT.md
GET  /flow/tasks/:id/logs            ?since=  (SSE or REST)
GET/POST /flow/tasks/:id/comments
GET/POST /flow/tasks/:id/steps
GET/POST /flow/tasks/:id/deps
GET  /flow/missions?projectId=
POST /flow/missions
GET/PUT /flow/missions/:id
GET  /flow/activity?projectId=&limit=
GET/POST/DELETE /flow/secrets
GET/POST /flow/tasks/:id/evals
```

### bKG Agent Hub

```bash
GET  /hub/health
GET  /hub/agents
GET  /hub/sessions
POST /hub/sessions                   { agent, agentMode, cwd?, initialMessage? }
GET/DELETE /hub/sessions/:id
POST /hub/sessions/:id/message       { message }
POST /hub/sessions/:id/abort
GET  /hub/sessions/:id/events        ?offset=  (SSE)
GET  /hub/sessions/:id/events/list   ?offset=&limit=
POST /hub/sessions/:id/permission    { approved }
GET  /hub/sessions/:id/fs            ?path=
GET  /hub/sessions/:id/fs/read       ?path=
PUT  /hub/sessions/:id/fs/write      { path, content }
DELETE /hub/sessions/:id/fs/delete   ?path=
POST /hub/sessions/:id/exec          { command }  (SSE)
```

### Cloud Providers

```bash
GET  /providers/list
GET  /providers/:id/models
POST /providers/proxy                { provider, model, messages, ... }
GET/PUT /user/providers
GET  /user/profile
POST /user/onboarded
GET  /admin/globals
PUT  /admin/globals
POST /admin/globals/providers        { providerKeys }
```

### Local backend proxy (CORS-safe)

```bash
GET  /api/proxy/ollama/tags
POST /api/proxy/ollama/pull
GET  /api/proxy/llama/models
GET  /api/proxy/llama/health
GET  /api/proxy/ping
```

---

## Development

```bash
# Dev server with hot-reload
./bkg.sh dev

# Type check
npx tsc --noEmit

# Build
npm run build

# Server syntax check
node --check server/serve.js
```

### Tech stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18 + TypeScript + Vite + Tailwind CSS |
| **UI fonts** | Orbitron (display) · Space Grotesk (body) · JetBrains Mono |
| **Backend** | Node.js ESM + Express 4 |
| **Database** | better-sqlite3 (Flow tasks) · sql.js (browser SQLite) |
| **AI in-browser** | @mlc-ai/web-llm (WebGPU) |
| **AI local** | node-llama-cpp v3 · Ollama |
| **AI cloud** | 19 OpenAI-compatible providers via /providers/proxy |
| **Agent** | @earendil-works/pi-coding-agent |
| **Auth** | bcryptjs + HMAC-SHA256 tokens |
| **Crypto** | AES-256-GCM secrets (Node.js crypto) |
| **Tunnel** | serveo.net reverse SSH proxy |

---

## License

MIT — see `LICENSE`

Built with ❤ by Sonia Schuh · bKG — best Known Garbage
