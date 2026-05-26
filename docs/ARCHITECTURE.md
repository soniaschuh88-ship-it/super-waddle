# bKG — Detailed Architecture

Supplementary to [../ARCHITECTURE.md](../ARCHITECTURE.md).

---

## Module Dependency Graph

```
serve.js (entry point)
├── bkg-flow.js          (Flow board — tasks, missions, evals)
├── bkg-game.js          (Game config — genres, tones, engines)
├── bkg-game-blueprint.js(Blueprint CRUD + AI prompts)
├── bkg-vldb.js          (Voxel world engine)
├── bkg-p2p.js           (P2P relay + zone management)
│   └── vsl-reducer.js   (VSL deterministic merge)
├── cluster-manager.js   (Zone→server assignment)
├── cluster-rebalancer.js(Load-based rebalancing)
├── interest-manager.js  (Moore neighbourhood subscriptions)
├── vsl-conflict-resolver.js (CRC mismatch detection)
├── bandwidth-shaper.js  (Quality tier assignment)
├── tick-sync.js         (Deterministic tick simulation)
├── chaos-recovery.js    (Peer trust + quarantine)
├── speculative-replay.js(Optimistic apply + rollback)
├── state-healer.js      (Checkpoint + verify + heal)
├── zone-stitcher.js     (Cross-zone movement)
├── render-partition.js  (Tile grid GPU budget)
├── compositing-serverless.js (Frame compositor)
├── global-consistency.js (Time-of-day, sun, fog)
├── frame-smoother.js    (EWMA quality smoothing)
├── gpu-trust.js         (Peer grade scoring)
├── temporal-coherence.js(Ghost/flicker suppression)
└── cognitive-load-balancer.js (Event clustering)
```

---

## Flow Board Architecture

### Storage

One SQLite database per project at `~/.bkg/flow-<projectId>.db`.
`better-sqlite3` is used synchronously (safe for single-process Node.js).

### Schema evolution

No migrations framework. Schema is created on first open with `CREATE TABLE IF NOT EXISTS`.
Adding columns requires manual `ALTER TABLE` or dropping and recreating the DB.

### Task state machine

```
Backlog → Todo → InProgress → InReview → Done → Archive
                     ↑____________________________|  (reopen)
```

### AI plan generation

```
POST /flow/tasks/:id/plan
1. Read task.prompt_md (user-written context)
2. Compose system prompt: "You are a coding task planner..."
3. Resolve AI key: user providers → global admin providers → env
4. Call provider proxy (NVIDIA or OpenRouter)
5. Stream tokens via SSE to client
6. On complete: save full text to task.prompt_md
```

---

## Game Blueprint Architecture

### Write path

```
User generates section
    → POST /game/blueprint/:id/generate/:section
    → resolve API key
    → build AI prompt
    → fetch provider (streaming)
    → SSE: tokens → client
    → on complete: parse JSON from fullText
    → update blueprint[section] = parsedData
    → blueprint.docs[section] = fullText
    → blueprint.generatedSections.push(section)
    → saveBlueprint() → write JSON to disk
```

### Read path

```
GET /game/blueprint/:id
    → readFileSync(path.json)
    → JSON.parse()
    → return full document
```

### Concurrency

No locks. Single-process Node.js. Last write wins if two requests
race to update the same blueprint (extremely unlikely in practice).

---

## VLDB Engine Architecture

### Chunk lifecycle

```
Request for chunk (worldId, cx, cy, cz)
    → L1 hot cache (Map): O(1) lookup
    → L2 warm cache (LRU): O(1) eviction
    → L3 cold (disk): readFileSync binary
    → If not found: generate terrain procedurally
    → Promote to L1 hot cache
```

### Bitpacking

```
Chunk = 32×32×32 = 32,768 voxels
4-bit material ID (0-15)
2 voxels per byte → 16,384 bytes = 16 KB raw
```

Index calculation:
```js
index = x + y*32 + z*32*32
byte  = index >> 1
shift = (index & 1) ? 4 : 0
```

### Delta log

```
Array<{ seq, worldId, chunkKey, x, y, z, material, author, ts }>
Appended on every voxel mutation.
Replayed to reconstruct state at any seq number.
No GC — grows indefinitely (compact manually if needed).
```

---

## MMO Consensus Architecture

### VSL (Voxel State Ledger)

The VSL provides deterministic state merging across peers:

```
stateA + stateB → vslReducer.merge(stateA, stateB) → stateC
```

Rules:
1. Merge is commutative: `merge(A,B) == merge(B,A)`
2. Merge is idempotent: `merge(A,A) == A`
3. Later sequence numbers win on conflict

### CRC32 state verification

```
After each batch of events:
    crc = crc32(JSON.stringify(sortedZoneState))
    Broadcast to zone peers
    Peers with different CRC → trigger state heal
```

### Zone sharding

```
World grid divided into N zones
Each zone has:
    - Authority server (elected by lowest peer ID)
    - Up to maxPlayers/N players
    - Independent VSL ledger
    - Independent tick simulation
```

### Interest management

Player subscribes to Moore neighbourhood (3×3 zone grid centred on player zone).
Events outside this neighbourhood are not sent.

```
Zone (cx,cz) → neighbours:
  (cx-1,cz-1), (cx,cz-1), (cx+1,cz-1)
  (cx-1,cz),   (cx,cz),   (cx+1,cz)
  (cx-1,cz+1), (cx,cz+1), (cx+1,cz+1)
```

---

## Frontend Architecture

### AppShell

```
AppShell (flex-col h-screen overflow-hidden)
├── scanline ambient (absolute top, z-10)
├── header (h-14, z-30)
│   └── inner wrapper (max-w-[1800px] mx-auto)
│       ├── mobile hamburger (md:hidden)
│       ├── BKGLogo
│       ├── separator
│       ├── breadcrumb (hidden md:flex)
│       ├── StageProgress (hidden md:flex flex-1 justify-center)
│       └── right controls (ml-auto)
│           ├── ModeBadge
│           └── desktop nav (hidden md:flex)
├── mobile mode bar (flex sm:hidden)
├── error banner (conditional)
├── main (flex-1 overflow-auto) ← stage content here
└── MobileDrawer (fixed left-0, z-50)
```

### State flow

```
User clicks "New Plan"
    → dispatch({ type: 'SET_STAGE', stage: 'stufe1' })
    → AppContext reducer updates state.stage
    → AppShell re-renders with new stage
    → StageView switches to WizardModal
    → User fills form → dispatch(SET_PROJECT)
    → Plan generated → dispatch(SET_BUNDLE)
    → Navigate to stufe2 (file explorer)
```

### Onboarding

```
App mounts
    → shouldAutoShow():
        !localStorage.bkg_user_api_key AND !localStorage.bkg_onboarding_dismissed
        → true: render Onboarding slide-in card
        → false: don't render
    
    User clicks X:
        → setDismissed(): localStorage.bkg_onboarding_dismissed = '1'
        → onComplete() → setShowOnboarding(false)
        → never auto-shows again
    
    User clicks — (minimise):
        → setMinimised(true)
        → renders as pill button (app fully usable)
```

---

## Provider Proxy Architecture

```
POST /providers/proxy { provider, model, messages, stream }
    → validate provider ID
    → resolve API key for provider:
        1. userProfile.providers[configKey]
        2. globalConfig.providerKeys[configKey]
        3. process.env[UPPER_CASE_KEY]
    → look up provider endpoint URL
    → forward request to provider
    → if stream=true: pipe SSE response directly to client
    → if stream=false: collect full response, return JSON
```

Provider endpoints:
```
nvidia   → https://integrate.api.nvidia.com/v1/chat/completions
groq     → https://api.groq.com/openai/v1/chat/completions
openrouter→ https://openrouter.ai/api/v1/chat/completions
kilo     → https://api.kilo.codes/v1/chat/completions
llm7     → https://llm7.io/v1/chat/completions
mistral  → https://api.mistral.ai/v1/chat/completions
... (14 more)
```

---

## Security Architecture

### Token types

```
Admin token:  HMAC-SHA256(JWT_SECRET, "admin:" + timestamp)
              Verified by: replicate HMAC + check timestamp ≤ 7 days
              Stored:      sessionStorage['bkg_admin_token']

User API key: "bkg_" + 32 random hex chars
              Verified by: in-memory Map lookup
              Stored:      localStorage['bkg_user_api_key']
```

### Key storage

```
Provider keys never written to source code.
Admin global keys: ~/.bkg/users/globals.json
User keys: in-memory Map (not persisted — users re-register on server restart)
```

### DB access control

```
/admin/db/* endpoints require admin session.
SQLite opened read-only: new Db(path, { readonly: true }).
Only SELECT/WITH/PRAGMA queries accepted.
```
