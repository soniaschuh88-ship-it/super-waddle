# bKG — System Architecture

> Deep-dive into every subsystem, data flow, and module dependency.

---

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (React SPA)                       │
│   AppShell → Dashboard / Game / Flow / Voxel / MMO / Admin  │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTP + SSE + WebSocket
┌─────────────────────▼───────────────────────────────────────┐
│               server/serve.js  (Express, ~3500 lines)        │
│                                                              │
│  Auth  ·  Flow  ·  Hub  ·  Game  ·  VLDB  ·  MMO  ·  Admin  │
└──┬──────────┬─────────┬─────────┬────────┬────────┬─────────┘
   │          │         │         │        │        │
  JWT       SQLite   Processes   JSON    Bitpack  P2P/WS
 HMAC     better-   (Pi, Claude  files   chunks   relay
          sqlite3    Code, etc.) ~/.bkg  ~/.bkg   in-mem
```

---

## Server (`server/serve.js`)

Single-file Express server, ~3500 lines, ESM modules.

### Startup sequence

1. Load `.env` from project root (plain `fs.readFileSync`, no dotenv dep)
2. First-run password check: if `BKG_ADMIN_PASSWORD_HASH` missing → generate `bkg_<12hex>`, bcrypt hash, write `~/.bkg/admin.env` + `~/.bkg/install.key`
3. Import all sub-modules (flow, game, blueprint, vldb, p2p, …)
4. Register all Express routes
5. Create HTTP server + upgrade WebSocket connections
6. Listen on `BKG_PORT` (default 4001)
7. Write PID to `~/.bkg/run/serve.pid`
8. Mark `_ready = true` (readiness probe unblocks)

### Middleware stack

```
cors({ origin: '*' })
express.json({ limit: '50mb' })
express.urlencoded()
express.static(DIST_DIR)       ← serves React SPA
X-Request-Id header injection
```

### Route namespaces

| Prefix | Module | Auth |
|--------|--------|------|
| `/auth/*` | inline | — |
| `/api-keys/*` | inline | user bearer |
| `/api/proxy/*` | inline | — |
| `/agent/*` | inline | user bearer |
| `/plugins/*` | inline | — |
| `/flow/*` | `bkg-flow.js` | user bearer (optional) |
| `/hub/*` | `bkg-flow.js` | user bearer |
| `/game/*` | `bkg-game.js` + `bkg-game-blueprint.js` | user bearer (optional) |
| `/vldb/*` | `bkg-vldb.js` | user bearer (optional) |
| `/mmo/*` | `bkg-p2p.js` + inline | — |
| `/providers/*` | inline | user bearer (optional) |
| `/admin/*` | inline | admin session required |
| `/settings/*` | inline | — |
| `/user/*` | inline | user bearer |
| `/health*` | inline | — |
| `/*` | SPA fallback | — |

---

## Authentication

### Admin sessions

```
POST /auth/login { password }
  → bcrypt.compare(password, BKG_ADMIN_PASSWORD_HASH)
  → HMAC-SHA256(JWT_SECRET, "admin:" + timestamp)
  → { token }  stored in sessionStorage

GET /auth/verify  Authorization: Bearer <token>
  → verifyToken(token): HMAC check + 7-day expiry
```

### User API keys

```
POST /api-keys/self-register { name }
  → generateApiKey() → "bkg_" + 32 hex chars
  → stored in-memory: Map<id, { key, name, created, enabled }>
  → { key, id }  stored in localStorage['bkg_user_api_key']

Routes accepting user keys: Authorization: Bearer <bkg_...>
  → extractBearerToken(req)
  → findUserByKey(token)
```

---

## Flow Board (`server/bkg-flow.js`)

SQLite-backed Kanban board. Database per project at `~/.bkg/flow-<projectId>.db`.

### Schema

```sql
tasks        (id, project_id, title, status, priority, labels, assignee,
              due_date, description, prompt_md, created_at, updated_at,
              archived_at, position)
comments     (id, task_id, author, body, created_at)
steps        (id, task_id, title, status, order_idx)
evals        (id, task_id, score, notes, created_at)
missions     (id, project_id, title, status, description)
milestones   (id, mission_id, title, done, due_date)
secrets      (id, project_id, name, value_enc, created_at)
```

### AI plan generation

```
POST /flow/tasks/:id/plan
  → Reads task.prompt_md
  → Calls provider proxy (NVIDIA NIM or OpenRouter)
  → Streams SSE tokens to client
  → Saves final text back to task.prompt_md
```

---

## Game Blueprint System (`server/bkg-game-blueprint.js`)

JSON documents stored in `~/.bkg/blueprints/<id>.json`.

### Blueprint structure

```json
{
  "id": "hex8",
  "name": "My Game",
  "mode": "singleplayer | mmo",
  "genre": "rpg | fps | ...",
  "tone": "dark | heroic | ...",
  "engine": { "id", "label", "lang" },
  "status": "draft | complete | published | archived",
  "generatedSections": ["world", "story", ...],
  "docs": { "world": "...", "story": "...", ... },
  "world":    { seed, size, biomes, climate, magicLevel, techLevel, ... },
  "story":    { structure, protagonist, antagonist, conflict, acts, ... },
  "npcs":     [ { id, name, type, faction, level, stats, dialogue, ... } ],
  "monsters": [ { id, name, type, level, tier, stats, lootTable, ... } ],
  "quests":   [ { id, title, type, objectives, rewards, ... } ],
  "loot":     { itemTiers, tables, items },
  "levels":   { maxLevel, xpFormula, classes, skillTrees, equipSlots },
  "combat":   { hitFormula, critChance, statusEffects, aiPatterns },
  "zones":    [ { id, name, type, biome, levelRange, boss, ... } ],
  "mmo":      { maxPlayers, pvpEnabled, ... } | null
}
```

### AI generation (SSE streaming)

```
POST /game/blueprint/:id/generate/:section
  → Key resolution: user.providers → global.providerKeys → env
  → Calls NVIDIA NIM (nvapi-*) or OpenRouter (anything else)
  → Streams tokens via SSE data: JSON events
  → event type: 'chunk' { token }
  → event type: 'done'  { fullText, section, parsedData }
  → event type: 'error' { message }
  → Auto-saves parsed JSON arrays (npcs/monsters/quests/zones) to blueprint
```

---

## VLDB Voxel Engine (`server/bkg-vldb.js`)

Bitpacked 32³-chunk voxel world storage.

### Memory layout

```
Chunk = 32×32×32 = 32,768 voxels
4-bit packing = 16,384 bytes raw
After RLE compression ≈ 2-8 KB (terrain) or 4-16 KB (mixed)

3-layer storage:
  L1 hot:  JavaScript Map (fast access, limited size)
  L2 warm: LRU cache (configurable capacity)
  L3 cold: disk (binary files per chunk)
```

### Material IDs (4-bit, 0-15)

```
0: air       4: sand      8: glass     12: ice
1: stone     5: wood      9: crystal   13: obsidian
2: grass     6: leaves   10: metal     14: lava
3: water     7: snow     11: dirt      15: [reserved]
```

### Delta log

```
deltaLog: Array<{ seq, worldId, chunkKey, x, y, z, material, author, ts }>
Replayed on demand to reconstruct world state at any point in time.
```

### API endpoints

```
GET  /vldb/config              → types, biomes, colors, kernel info
GET  /vldb/stats               → chunk counts, delta log size
GET  /vldb/worlds              → list worlds
POST /vldb/worlds              → create world (name, seed, width, height, depth, biome)
GET  /vldb/chunk/:worldId      → JSON sparse chunk data
GET  /vldb/chunk/:worldId/binary → raw bitpacked binary
POST /vldb/voxel/:worldId      → set single voxel
PUT  /vldb/region/:worldId     → fill rectangular region
GET  /vldb/deltas              → delta log entries
```

---

## MMO Engine

### Module map

```
bkg-p2p.js              ← P2P relay, signaling, peer registry, zone management
vsl-reducer.js          ← VSL deterministic merge (CRC32 state hashing)
cluster-manager.js      ← Zone→server assignment
cluster-rebalancer.js   ← Load-based zone rebalancing
interest-manager.js     ← Moore neighbourhood subscriptions
vsl-conflict-resolver.js← CRC mismatch detection + correction
bandwidth-shaper.js     ← Adaptive quality tier assignment
tick-sync.js            ← Per-zone deterministic tick simulation
chaos-recovery.js       ← Peer trust scoring, bad event quarantine
speculative-replay.js   ← Optimistic apply + rollback
state-healer.js         ← Checkpoint + verify + CRC heal
zone-stitcher.js        ← Seamless cross-zone movement prediction
render-partition.js     ← 3×3 tile grid GPU budget assignment
compositing-serverless.js ← Tile compositor for frames
global-consistency.js   ← Time-of-day, sun angle, fog, temporal jitter
frame-smoother.js       ← EWMA quality smoothing per tile
gpu-trust.js            ← Peer grade scoring (S/A/B/C/D/F)
temporal-coherence.js   ← Ghost/flicker detection + suppression
cognitive-load-balancer.js ← Event clustering + stream compression
```

### VSL Consensus

```
Each zone maintains a VSL ledger.
Events are ingested via POST /mmo/event { type, zoneId, payload, seq }.
reducer.merge(stateA, stateB) is deterministic (same inputs → same output).
CRC32 of world state is computed after each batch.
Peers with matching CRCs are trusted; mismatches trigger healing.
```

### WebSocket protocol

```
ws://host/mmo/ws
Subprotocol: bkg-mmo

Client→Server:
  { type: 'join',  worldId, peerId, position }
  { type: 'move',  peerId, position, zone }
  { type: 'event', type, payload }

Server→Client:
  { type: 'peers',    peers: [...] }
  { type: 'zone_map', zones: [...] }
  { type: 'event',    event }
  { type: 'tick',     seq, delta }
```

---

## Frontend (`src/`)

### Route map (stages)

```
Stage            Component              Description
─────────────────────────────────────────────────────
home           → Dashboard             User home, provider panel, history
stufe1         → WizardModal           Plan generator wizard
stufe1_5       → ValidationLoop        Run/test/iterate loop
stufe2         → DualPaneExplorer      File explorer + editor
stufe3         → CodeStudio            Full code studio
agenthub       → AgentHub              Agent session UI
flow           → FlowBoard             Kanban board
game           → GameWizard            Single-player blueprint wizard
game-client    → GameClient            MMO world lobby
world-builder  → WorldBuilder          Voxel world from blueprint
voxel          → VoxelEngine           3D voxel editor
mmo            → MMOEngine             MMO control panel
```

### State management

```typescript
// Context: src/context/AppContext.tsx
AppState {
  stage:         Stage           // current active stage
  project:       Project | null  // current plan project
  bundle:        Bundle | null   // generated file bundle
  backendConfig: BackendConfig   // inference backend selection
  engineStatus:  EngineStatus    // WebGPU load progress
  globalError:   string | null   // banner error message
}

Actions: SET_STAGE | SET_PROJECT | CLEAR_PROJECT |
         SET_BUNDLE | SET_BACKEND | SET_ENGINE_STATUS |
         SET_ENGINE_PROGRESS | CLEAR_ERROR | SET_GLOBAL_ERROR
```

### Design system

- **Color palette**: Atlantis Cyberpunk (deep ocean + bioluminescent cyan)
- **Fonts**: `Orbitron` (headings), `Inter` (body), `JetBrains Mono` (code)
- **Primary accent**: `#00e5ff` (cyan)
- **Game accent**: `#ffb300` (amber)
- **Success**: `#00e5a0` (mint)
- **Error**: `#ff3d6b` (crimson)
- **Background**: `#020a12` → `#030810`
- **Tailwind config**: custom CSS variables, glass morphism utilities, glow effects

---

## Data Directory (`~/.bkg/`)

```
~/.bkg/
├── admin.env          BKG_ADMIN_PASSWORD_HASH=...
├── install.key        plaintext admin password (one-time, deleted after /admin visit)
├── run/
│   └── serve.pid      running server PID
├── blueprints/
│   └── <id>.json      game blueprint documents
├── flow-default.db    Flow board SQLite (default project)
├── flow-<id>.db       additional project databases
└── users/
    └── globals.json   global provider key config
```

---

## Test Suite (`test/alpha.js`)

127 assertions covering:

- Health endpoints (liveness + readiness + X-Request-Id)
- Auth (login, bad password 401, verify)
- API key CRUD + scopes
- VLDB (config, stats, world CRUD, chunk read/write, delta log, binary endpoint, agent mutate, SSE)
- MMO (stats, zones, peers, join, events, zone authority, NPC/proof/farm/bootstrap)
- MMO stabilization (rebalancer, interest, forks, bandwidth, tick)
- MMO chaos recovery (track, latency, bad-event, trust, speculative, healer, stitcher)
- MMO render (config, tiles, assignment, rebalance, frame, compositor, NPC, snapshot)
- Flow (health, board, stats, task CRUD, move, labels, comments, steps, evals, search, export, webhook, SSE)
- Game (config, empty design, create-task)
- Hub (health, agents, sessions)
- Providers (list, count 19)
- Admin (GET /admin serves HTML)
- SPA fallback (unknown routes → index.html)
- Cleanup (DELETE flow task, VLDB world, MMO peer)

Run: `node test/alpha.js http://localhost:4001`
