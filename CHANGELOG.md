# Changelog

All notable changes to bKG are documented here.
Format: [Semantic Versioning](https://semver.org/) | [Keep a Changelog](https://keepachangelog.com)

---

## [1.0.0-alpha] — 2026-05-26

### Added — Game Studio & Blueprint System

- **`server/bkg-game-blueprint.js`** — Complete game blueprint schema
  - Full data model: World · Story · NPCs · Monsters · Quests · Loot · Levels · Zones
  - CRUD: `createBlueprint`, `getBlueprint`, `listBlueprints`, `updateBlueprintSection`, `deleteBlueprint`
  - `blueprintStats()` — completion percentage per section
  - Per-section AI prompts via `buildSectionPrompt()`
  - Entity templates: `npcTemplate`, `monsterTemplate`, `questTemplate`, `itemTemplate`, `zoneTemplate`
  - Stored in `~/.bkg/blueprints/*.json`

- **Blueprint API** (`serve.js`)
  - `GET  /game/blueprint/list` — list all blueprints, filter by mode
  - `POST /game/blueprint/create` — create new blueprint
  - `GET  /game/blueprint/templates` — default templates for UI
  - `GET  /game/blueprint/:id` — fetch full blueprint
  - `GET  /game/blueprint/:id/stats` — completion stats
  - `PUT  /game/blueprint/:id` — update full blueprint
  - `PATCH /game/blueprint/:id/section/:section` — update single section
  - `DELETE /game/blueprint/:id` — delete blueprint
  - `POST /game/blueprint/:id/generate/:section` — SSE streaming AI generation
    - Resolves key: user profile → global NVIDIA → global OpenRouter
    - Streams tokens live, auto-parses JSON sections, persists to disk

- **MMO World Management** — `serve.js`
  - `GET  /game/mmo/worlds` — list published MMO worlds (public)
  - `POST /game/mmo/publish/:id` — admin: publish blueprint as live world
  - `POST /game/mmo/unpublish/:id` — admin: take world offline

- **Game Wizard** (`src/components/Game/GameWizard.tsx`) — complete rewrite
  - 10-step pipeline: Setup → World → Story → NPCs → Monsters → Quests → Loot → Levels → Zones → Launch
  - SSE streaming generation with live token display per step
  - NPCs rendered as cards; monsters as color-coded table; quests as type-colored list
  - Loot: tier badge strip + item list with rarity colors
  - Levels: class chips + stats grid
  - Zones: 2-column grid with type accent colors
  - Blueprint JSON viewer toggle on launch step
  - Links to Flow task creation and Voxel World Builder

- **Admin MMO Panel** (`src/components/Admin/MMOCreator.tsx`)
  - New admin tab: "Game Blueprints" (Globe icon, general section)
  - Blueprint list: MMO worlds + single-player blueprints separated
  - Create modal: name, concept, genre, tone, max players, PvP toggle
  - Blueprint detail: 9-section grid with per-section generate/edit/regen
  - Inline JSON editor per section with save/cancel
  - Publish/Unpublish button → immediate visibility in Game Client
  - Live status bar showing published world names

- **Game Client** (`src/components/Game/GameClient.tsx`, stage: `game-client`)
  - User-facing MMO lobby
  - Fetches `/game/mmo/worlds` (published blueprints only)
  - World cards: name, LIVE badge, genre/tone, system stats, completion bar
  - Per-genre color theming (rpg=purple, fps=red, sci-fi=cyan, etc.)
  - Empty state with redirect to single-player GameWizard
  - Feature strip: Items & Loot · Progression · Open World

- **World Builder** (`src/components/Game/WorldBuilder.tsx`, stage: `world-builder`)
  - 4-step flow: Choose Blueprint → Configure → Generate → Open in Voxel
  - Reads blueprint biomes/size/zones to seed world gen parameters
  - Creates VLDB world via `/vldb/worlds`
  - Links `worldId` back to blueprint on success
  - Step 4: Direct link to Voxel Engine

- **Stage types** expanded (`src/types/index.ts`)
  - Added `'game-client'` and `'world-builder'` to `Stage` union
  - Wired in `App.tsx` switch
  - Added to AppShell mobile drawer (9 items) and desktop nav (10 items)

### Added — Admin & Infrastructure

- **DB Viewer** (`src/components/Admin/DbViewer.tsx`)
  - Sidebar: database selector + table list with row counts
  - Paginated row browser (50/page) with full-text search
  - Read-only SQL console (SELECT/WITH/PRAGMA only)
  - New server endpoints: `/admin/db/databases`, `/tables`, `/table/:name`, `/query`

- **First-run admin key** (`server/serve.js`)
  - On fresh install: generates `bkg_<12hex>` password, bcrypt-hashes it
  - Persists hash to `~/.bkg/admin.env`, plaintext to `~/.bkg/install.key`
  - Prints prominently in terminal with border
  - `GET /admin/install-key` — returns key once, deletes file, clears memory
  - `AdminAuth.tsx` — fetches install key on mount, pre-fills form, shows amber banner

- **Docker support**
  - `Dockerfile` — multi-stage build (node:22-alpine, non-root user `bkg`)
  - `docker-compose.yml` — bkg service + volume `bkg-data`, commented Nginx/Ollama
  - `.dockerignore` — excludes node_modules, dist, *.gguf

- **Install script** (`install.sh`)
  - Interactive: "1) Local  2) Docker"
  - Local: checks Node 20+, `npm install`, `npm run build`, starts server
  - Docker: `docker compose build && up -d`
  - Subcommands: `start`, `stop`, `install`, `docker-start`, `local-start`
  - Shows admin password on first start

### Fixed — CSS & Layout

- **AppShell header** — added `max-w-[1800px] mx-auto` inner wrapper
  - Centres content on ultrawide monitors (>1800px)
  - Header no longer stretches to full viewport width
- **FlowTask modal** — `overflow-y-auto` backdrop, `my-auto` card centering
  - `max-h-[95vh]` prevents overflow on short screens
  - `items-start sm:items-center` for mobile vs desktop behaviour
- **Removed** `main > * { max-width: 1600px }` — was breaking full-height panels
- **Desktop nav** — icon-only on `md:`, icon+label on `xl:` (no overflow at 768-1279px)
- **Mobile drawer** — synced to all 9 navigation destinations
- **Dashboard** — `py-10` → `py-4 sm:py-8`, hero h1 `text-3xl` → `text-2xl sm:text-3xl`

### Fixed — Provider Cards

- `CloudPanel.displayProviders` was filtering too aggressively
  - Was: `p.hasKey || p.source==='anon' || p.tier==='free'` (only 4 visible)
  - Now: all 19 providers in two groups: **Available** + **Add API Key to enable**
- `selectedId` now initializes from providers list on load (not just localStorage)
- Auto-selects first provider with a key, or first anonymous provider
- Model auto-select respects saved model if still in list
- Models cleared before re-fetch on provider switch

### Fixed — Onboarding

- Full-screen modal replaced with compact slide-in card (bottom-right, 300px)
- X button now sets `localStorage.bkg_onboarding_dismissed = 1` → never auto-shows again
- Minimize button collapses to pill badge (app fully usable behind it)
- `shouldAutoShow()`: only shows if no API key AND not dismissed

### Fixed — Vite Proxy

- `vite.config.ts` reads `BKG_PORT` from `process.env` (not just `loadEnv`)
- `ECONNREFUSED` no longer spams console — returns 503 JSON instead
- Auto-detects running backend port (5020 → 5025 → 5030…)

---

## [0.9.0] — 2026-05-24

### Added

- **Provider system** — 19 providers, per-user keys, global admin keys
- **Admin dashboard** — Global Providers, API Keys, Agent Settings, Plugins, Stats, DB Viewer
- **DbViewer** — SQLite table browser with SQL console
- **AdminAuth** — bcrypt password gate, HMAC JWT tokens, 7-day expiry
- **First-run admin key** — auto-generated on fresh install, shown in terminal + UI
- **Docker** — multi-stage Dockerfile + docker-compose.yml
- **install.sh** — interactive local/Docker installer
- **`/admin/install-key`** — one-time endpoint, deletes plaintext after delivery

---

## [0.8.0] — 2026-05-22

### Added

- **MMO Engine** — full distributed multiplayer system
  - VSL (Voxel State Ledger) deterministic consensus
  - Zone sharding + cluster manager + cluster rebalancer
  - Interest manager — Moore neighbourhood subscriptions
  - VSL conflict resolver — CRC-based state verification
  - Bandwidth shaper — adaptive quality tiers
  - Tick sync — per-zone deterministic simulation
  - Chaos recovery — peer trust scoring, bad event detection
  - Speculative replay — apply/correct/rollback state
  - State healer — checkpoint + verify + heal
  - Zone stitcher — seamless cross-boundary movement
  - Render partition — 3×3 tile grid GPU budget assignment
  - Compositing serverless — tile compositor for frames
  - Global consistency — time-of-day, sun, fog, jitter
  - Frame smoother — EWMA quality per tile
  - GPU trust — peer grade scoring (S/A/B/C/D/F)
  - Temporal coherence — ghost/flicker suppression
  - Cognitive load balancer — event clustering + stream compression

---

## [0.7.0] — 2026-05-20

### Added

- **VLDB Voxel Engine** — bitpacked 32³ chunk storage
  - 4-bit material packing (2 voxels per byte)
  - 3-layer storage: L1 hot (Map), L2 warm (LRU), L3 cold (disk)
  - RLE delta compression
  - Delta log with sequence numbers
  - WASM-ready kernel interface (hot-swappable)
  - 16 material types (air, stone, grass, water, wood, crystal, lava, …)
  - 5 biome presets (plains, forest, mountains, desert, ocean)
  - Agent mutation API

---

## [0.6.0] — 2026-05-18

### Added

- **bKG Agent Hub** — universal coding agent session orchestrator
  - Pi Agent (RLHF fine-tuned on code)
  - Claude Code, Codex, Amp, OpenCode adapters
  - Session create/message/abort/delete
  - SSE event streaming
  - File system access (read/write/delete)
  - Shell execution
  - Permission gating

---

## [0.5.0] — 2026-05-15

### Added

- **bKG Flow** — full Kanban + AI task board
  - SQLite-backed (better-sqlite3)
  - 5-column board: Backlog → In Progress → Review → Done → Archive
  - Tasks: title, labels, priority, assignee, due date, description
  - AI plan generation (SSE streaming)
  - Comments, workflow steps, evaluations (0-100 score)
  - Mission + milestone tracking
  - Webhooks, CSV/Markdown export
  - SSE event bus for live updates

---

## [0.4.0] — 2026-05-12

### Added

- **Cloud provider system** — 19 providers
- **WebGPU inference** — @mlc-ai/web-llm, Llama 3.2 1B in browser
- **Ollama** manager + node-llama-cpp manager
- **User Dashboard** — provider panel, model selector, project history

---

## [0.3.0] — 2026-05-08

### Added

- **Plan Generator** — 3-step wizard (idea → features → generate)
- **Code Studio** — dual-pane file explorer + code editor
- **Validation Loop** — run, test, iterate
- **API key system** — self-registration, scopes, revocation

---

## [0.2.0] — 2026-05-04

### Added

- Express server skeleton, SPA fallback
- React + Vite + Tailwind CSS setup
- Admin auth (bcrypt + HMAC JWT)
- Health endpoints (`/health`, `/health/ready`)

---

## [0.1.0] — 2026-04-30

### Added

- Initial project structure
- bKG brand + Atlantis Cyberpunk design system
- TypeScript strict configuration
- ESLint + Prettier setup
