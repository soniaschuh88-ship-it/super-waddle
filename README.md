# bKG — best Known Garbage

> Full-stack local AI coding workspace with voxel MMO engine, game studio,
> distributed consensus layer, Flow task board, and cloud provider integration.

[![127 Tests Passing](https://img.shields.io/badge/tests-127%20passing-00e5a0)](test/alpha.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933)](https://nodejs.org)

---

## What is bKG?

**bKG** is a self-hosted AI development workspace that runs entirely on your machine.
It combines seven integrated systems into one unified web app:

| System | What it does |
|--------|-------------|
| **Plan Generator** | Wizard that turns a raw idea into a full structured software plan |
| **Flow Board** | AI task board (Kanban, PROMPT.md, missions, evals, webhooks) |
| **Agent Hub** | Universal coding agent interface (Pi, Claude Code, Codex, Amp) |
| **Game Studio** | 9-step single-player game blueprint wizard with AI generation |
| **Game Client** | User MMO lobby — browse & join published worlds |
| **Voxel Engine** | VLDB 32³-chunk voxel world editor with WASM-ready bitpacked storage |
| **MMO Engine** | P2P/VSL distributed multiplayer with zone sharding, chaos recovery |

Everything is served from a **single Node.js process**.
No microservices. No cloud accounts required. No Docker required (but supported).

---

## Quick Start

### Option A — Interactive installer (recommended)

```bash
git clone https://github.com/soniaschuh88-ship-it/super-waddle.git
cd super-waddle
./install.sh
```

The installer asks you to choose **Local** (Node.js) or **Docker**, then does everything.

### Option B — Manual (local)

```bash
# 1. Clone
git clone https://github.com/soniaschuh88-ship-it/super-waddle.git
cd super-waddle

# 2. Install
npm install
cd server && npm install && cd ..

# 3. Build frontend
npm run build

# 4. Start
node server/serve.js
```

### Option C — Docker

```bash
git clone https://github.com/soniaschuh88-ship-it/super-waddle.git
cd super-waddle
docker compose up --build
```

**First run:** admin password is printed in the terminal and pre-filled on the `/admin` page.

---

## Access

| URL | What |
|-----|------|
| `http://localhost:4001` | Main app |
| `http://localhost:4001/admin` | Admin dashboard |
| `http://localhost:4001/health` | API health check |

The default port is **4001**. Override with `BKG_PORT=5020 node server/serve.js`.

---

## Architecture

```
Browser (React + Vite)
    │
    ▼
Express server (serve.js ~3500 lines)
    ├── /auth/*         bcrypt + HMAC JWT tokens
    ├── /flow/*         SQLite task board (better-sqlite3)
    ├── /hub/*          Agent session orchestration
    ├── /game/*         Game config + blueprint CRUD + AI SSE generation
    ├── /game/mmo/*     MMO world publish/unpublish
    ├── /vldb/*         Voxel world storage (bitpacked, RLE, delta log)
    ├── /mmo/*          P2P relay, VSL ledger, zone sharding, chaos recovery
    ├── /providers/*    19 cloud AI providers (NVIDIA, Groq, OpenRouter, …)
    ├── /admin/*        Admin API (globals, users, DB viewer)
    ├── /api-keys/*     User API key management
    └── /*              React SPA fallback (dist/index.html)

Persistent state (~/.bkg/)
    ├── admin.env       bcrypt hash for admin password
    ├── install.key     One-time plaintext install key (deleted after first /admin visit)
    ├── blueprints/     Game blueprint JSON files
    ├── flow-*.db       Flow task SQLite databases (one per project)
    └── run/serve.pid   Running server PID
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full deep-dive.

---

## Game Features

### Single-Player Game Studio (`/game` stage)

1. Set game name, engine, genre, tone
2. AI generates each system individually with live streaming:
   - **World** — geography, factions, magic/tech system, lore
   - **Story** — 3-act narrative, protagonist/antagonist arcs
   - **NPCs** — 8-12 characters (merchants, quest-givers, companions)
   - **Monsters** — 12-18 creatures with stats, abilities, loot tables
   - **Quests** — Main chain + side quests + hidden secrets
   - **Loot** — Item database with tier system (Common → Artifact)
   - **Levels** — Player classes, skill trees, XP curves
   - **Zones** — Regions, dungeons, cities, boss lairs
3. Create Flow task → AI coding agent builds the game

### MMO Engine

- **Admin creates** a blueprint → publishes a world
- **Users join** via Game Client (browsable lobby)
- P2P WebSocket fabric with VSL deterministic consensus
- Zone sharding, interest management, chaos recovery
- Speculative replay, state healer, zone stitcher

### World Builder (`/world-builder` stage)

Links a game blueprint to a VLDB voxel world:
- Picks biomes from blueprint, seeds terrain generator
- Creates VLDB world, links `worldId` back to blueprint
- Opens result in Voxel Engine for editing

---

## AI Provider Integration

bKG supports 19 cloud providers out of the box. All free-tier providers are auto-discovered:

| Provider | Tier | Notes |
|----------|------|-------|
| **Kilo Code** | Free anon | No key needed |
| **LLM7** | Free anon | No key needed |
| **NVIDIA NIM** | Freemium | 1,000 req/month free |
| **Groq** | Free tier | Ultra-fast inference |
| **OpenRouter** | Free models | 200+ models, many free |
| **Mistral** | Free dev | No credit card |
| **SambaNova** | Free | 20–480 req/min |
| + 12 more | Various | See Admin → Global Providers |

Add your key in **Dashboard → Settings → API Keys** or **Admin → Global Providers**.

---

## AI Inference Backends

| Backend | How to use |
|---------|-----------|
| **WebGPU (browser)** | No setup — runs Llama 3.2 1B in the browser tab |
| **Ollama** | `ollama serve` then select in Dashboard |
| **node-llama-cpp** | `cd server && npm run pull hf:...` |
| **Cloud providers** | Add API key in Dashboard or Admin |

---

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `BKG_PORT` | `4001` | HTTP server port |
| `BKG_HOST` | `0.0.0.0` | Bind address |
| `BKG_ADMIN_PASSWORD_HASH` | auto-generated | bcrypt hash of admin password |
| `BKG_JWT_SECRET` | random | JWT signing secret |
| `BKG_DIR` | `~/.bkg` | Persistent data directory |
| `NVIDIA_API_KEY` | — | Global NVIDIA NIM key |
| `OPENROUTER_API_KEY` | — | Global OpenRouter key |

---

## Development

```bash
# Start backend
BKG_PORT=5020 node server/serve.js &

# Start Vite dev server (proxies all API calls to backend)
BKG_PORT=5020 npm run dev
# → http://localhost:3000 (with HMR)
```

```bash
# Run tests (127 assertions)
node test/alpha.js http://localhost:5020

# Type check
npx tsc --noEmit

# Lint
npm run lint

# Build
npm run build
```

---

## Documentation

| File | Contents |
|------|----------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full system design, module map, data flows |
| [API.md](API.md) | Complete REST API reference (all 120+ endpoints) |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production deployment guide |
| [SECURITY.md](SECURITY.md) | Security policy and practices |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [docs/GAME_BLUEPRINT.md](docs/GAME_BLUEPRINT.md) | Game blueprint schema reference |
| [docs/GAME_SYSTEMS.md](docs/GAME_SYSTEMS.md) | All game subsystems documented |
| [docs/FEATURES.md](docs/FEATURES.md) | Complete feature inventory |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Detailed subsystem architecture |

---

## License

MIT © 2026 Sonia Schuh & contributors
