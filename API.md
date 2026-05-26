# bKG REST API Reference

Base URL: `http://localhost:4001` (or your `BKG_PORT`)

Authentication:
- **Admin endpoints**: `Authorization: Bearer <admin-token>` (get token from `POST /auth/login`)
- **User endpoints**: `Authorization: Bearer <bkg_...>` (get key from `POST /api-keys/self-register`)
- **Public endpoints**: no auth required

---

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Liveness probe: `{ status, pid, uptime, port }` |
| GET | `/health/ready` | — | Readiness: `{ ready, pid }` — waits for server bind |

---

## Auth

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| POST | `/auth/login` | — | `{ password }` | Returns `{ token }` (HMAC JWT, 7-day) |
| GET | `/auth/verify` | admin | — | Returns `{ valid }` |
| POST | `/auth/hash` | — | `{ password }` | Returns `{ hash }` — only if no hash set yet |
| GET | `/admin/install-key` | — | — | One-time install key — deletes after delivery |

---

## API Keys

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| GET | `/api-keys` | admin | — | List all keys |
| POST | `/api-keys` | admin | `{ name, scopes }` | Create key |
| DELETE | `/api-keys/:id` | admin | — | Revoke key |
| PUT | `/api-keys/:id/enabled` | admin | `{ enabled }` | Enable/disable |
| POST | `/api-keys/self-register` | — | `{ name }` | User self-register → `{ key, id }` |
| GET | `/api-keys/scopes` | — | — | Available scopes |

---

## Flow Board

### Projects

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/flow/projects` | — | List projects |
| POST | `/flow/projects` | — | `{ name, description }` |
| GET | `/flow/projects/:id` | — | Get project |
| PUT | `/flow/projects/:id` | — | Update project |
| DELETE | `/flow/projects/:id` | — | Archive project |
| GET | `/flow/board/:projectId` | — | Full board with columns + tasks |
| GET | `/flow/health` | — | `{ name, activeTasks, ... }` |

### Tasks

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| GET | `/flow/tasks` | — | `?projectId&status` | List tasks |
| GET | `/flow/tasks/search` | — | `?q` | Full-text search |
| POST | `/flow/tasks` | — | `{ title, projectId, ... }` | Create task |
| GET | `/flow/tasks/:id` | — | — | Get task |
| PUT | `/flow/tasks/:id` | — | `{ title, description, ... }` | Update task |
| DELETE | `/flow/tasks/:id` | — | — | Archive task |
| POST | `/flow/tasks/:id/move` | — | `{ status }` | Move between columns |
| POST | `/flow/tasks/:id/plan` | — | `{ model?, provider? }` | AI plan generation (SSE) |
| GET | `/flow/tasks/:id/logs` | — | — | Task activity log |
| GET | `/flow/tasks/:id/comments` | — | — | Comments |
| POST | `/flow/tasks/:id/comments` | — | `{ body, author }` | Add comment |
| GET | `/flow/tasks/:id/steps` | — | — | Workflow steps |
| POST | `/flow/tasks/:id/steps` | — | `{ title }` | Add step |
| PUT | `/flow/steps/:id` | — | `{ status, title }` | Update step |
| POST | `/flow/tasks/:id/deps` | — | `{ depId }` | Add dependency |
| DELETE | `/flow/tasks/:id/deps/:depId` | — | — | Remove dependency |
| GET | `/flow/tasks/:id/evals` | — | — | Evaluations |
| POST | `/flow/tasks/:id/evals` | — | `{ score, notes }` | Add eval |

### Missions & Milestones

| Method | Path | Description |
|--------|------|-------------|
| GET | `/flow/missions` | `?projectId` |
| POST | `/flow/missions` | `{ title, projectId }` |
| GET | `/flow/missions/:id` | — |
| PUT | `/flow/missions/:id` | — |
| GET | `/flow/missions/:id/milestones` | — |
| POST | `/flow/missions/:id/milestones` | `{ title, dueDate }` |

### Export / Webhooks / Events

| Method | Path | Description |
|--------|------|-------------|
| GET | `/flow/export/:projectId` | `?format=markdown\|csv` — Export tasks |
| POST | `/flow/webhook/:projectId` | Webhook trigger (any payload) |
| GET | `/flow/events` | SSE stream of board events |
| GET | `/flow/stats` | `{ totalTasks, activeTasks, ... }` |
| GET | `/flow/activity` | Recent activity log |

---

## Game Blueprints

### Config

| Method | Path | Description |
|--------|------|-------------|
| GET | `/game/config` | Genres, tones, engines |
| GET | `/game/empty` | Empty game design template |
| GET | `/game/blueprint/templates` | NPC/monster/quest/item/zone templates + BLUEPRINT_DEFAULTS |

### Blueprint CRUD

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| GET | `/game/blueprint/list` | — | `?mode=singleplayer\|mmo` | List blueprints |
| POST | `/game/blueprint/create` | — | `{ name, mode, genre, tone, ... }` | Create blueprint |
| GET | `/game/blueprint/:id` | — | — | Get full blueprint |
| GET | `/game/blueprint/:id/stats` | — | — | Completion stats |
| PUT | `/game/blueprint/:id` | — | `{...blueprint}` | Update blueprint |
| PATCH | `/game/blueprint/:id/section/:section` | — | `<section data>` | Update one section |
| DELETE | `/game/blueprint/:id` | — | — | Delete blueprint |

### AI Generation

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| POST | `/game/blueprint/:id/generate/:section` | user | `{}` | SSE streaming AI generation |

**Sections**: `world`, `story`, `npcs`, `monsters`, `quests`, `loot`, `levels`, `zones`, `gameplan`

**SSE event format**:
```json
data: {"type":"chunk","data":{"token":"..."}}
data: {"type":"done","data":{"fullText":"...","section":"npcs","parsedData":[...]}}
data: {"type":"error","data":{"message":"..."}}
```

### Task Creation

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| POST | `/game/create-task` | user | `{ design, projectId }` | Create Flow task from game design |

### MMO Worlds (Public)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/game/mmo/worlds` | — | List published MMO worlds |
| POST | `/game/mmo/publish/:id` | admin | Publish blueprint as live MMO world |
| POST | `/game/mmo/unpublish/:id` | admin | Take MMO world offline |

---

## VLDB Voxel Engine

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/vldb/config` | — | Types, biomes, colors, kernel info |
| GET | `/vldb/stats` | — | Chunk counts, delta log size |
| GET | `/vldb/worlds` | — | List worlds |
| POST | `/vldb/worlds` | `{ name, seed, width, height, depth, biome }` | Create world |
| DELETE | `/vldb/worlds/:id` | — | Delete world |
| GET | `/vldb/chunk/:worldId` | `?cx&cy&cz` | JSON sparse chunk |
| GET | `/vldb/chunk/:worldId/binary` | `?cx&cy&cz` | Raw bitpacked binary |
| POST | `/vldb/chunk/:worldId/applyDelta` | `{ deltas: [...] }` | Batch apply voxel changes |
| POST | `/vldb/voxel/:worldId` | `{ x, y, z, material }` | Set single voxel |
| PUT | `/vldb/region/:worldId` | `{ x1,y1,z1,x2,y2,z2, material }` | Fill region |
| GET | `/vldb/world/:worldId/state` | — | Full world state snapshot |
| POST | `/vldb/world/:worldId/flush` | — | Flush L1→L2→L3 |
| GET | `/vldb/world/:worldId/replay` | `?from&to` | Replay delta log |
| GET | `/vldb/deltas` | `?worldId&limit` | Delta log entries |
| GET | `/vldb/events` | — | SSE stream of voxel mutations |
| POST | `/vldb/world/:worldId/agent-mutate` | `{ deltas }` | Agent batch mutation |

---

## MMO Engine

### Core

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/mmo/ws-info` | — | WebSocket endpoint info |
| GET | `/mmo/stats` | — | Peer count, zone count, event rate |
| GET | `/mmo/zones` | — | Zone list with peer counts |
| GET | `/mmo/zone/:id` | — | Zone detail |
| GET | `/mmo/peers` | — | Active peers |
| DELETE | `/mmo/peers/:id` | — | Remove peer |
| POST | `/mmo/join` | `{ peerId, worldId, position }` | Join world |
| POST | `/mmo/event` | `{ type, zoneId, payload }` | Ingest VSL event |
| GET | `/mmo/zone/:id/ledger` | — | VSL ledger for zone |
| GET | `/mmo/zone/:id/authority` | — | Zone authority + epoch |
| GET | `/mmo/npcs` | — | NPC registry |
| GET | `/mmo/proof` | — | State proof (CRC chain) |
| GET | `/mmo/farm` | — | Farming state |
| GET | `/mmo/bootstrap/:worldId` | — | Bootstrap packet for new peer |
| GET | `/mmo/vsl/stats` | — | VSL ledger statistics |
| POST | `/mmo/events/batch` | `{ events: [...] }` | Batch event ingest |

### Stabilization

| Method | Path | Description |
|--------|------|-------------|
| GET | `/mmo/stabilize/rebalancer` | Zone load snapshot |
| GET/POST | `/mmo/stabilize/interest/subscribe` | Moore neighbourhood subscription |
| POST | `/mmo/stabilize/interest/route` | Route event to subscribers |
| GET/POST | `/mmo/stabilize/forks` | Fork detection + report |
| GET/POST | `/mmo/stabilize/bandwidth` | Bandwidth tier management |
| GET/POST | `/mmo/stabilize/tick` | Tick sync snapshot + report |

### Chaos Recovery

| Method | Path | Description |
|--------|------|-------------|
| GET | `/mmo/chaos/stats` | Recovery kernel state |
| POST | `/mmo/chaos/track` | Track peer event |
| POST | `/mmo/chaos/latency` | Report peer latency |
| POST | `/mmo/chaos/bad-event` | Report bad event → penalise trust |
| GET | `/mmo/chaos/trust` | Peer trust scores |
| GET/POST | `/mmo/chaos/speculative` | Speculative state apply/correct |
| GET/POST | `/mmo/chaos/healer` | State checkpoint/verify/heal |
| GET/POST | `/mmo/chaos/stitcher` | Zone stitcher track/predict |

### Render

| Method | Path | Description |
|--------|------|-------------|
| GET | `/mmo/render/config` | Tile grid + GPU budget tiers |
| GET | `/mmo/render/tiles` | Current tile assignments |
| GET/POST | `/mmo/render/assignment` | Tile assignment per peer |
| POST | `/mmo/render/rebalance` | Trigger rebalance |
| POST | `/mmo/render/frame` | Submit rendered frame |
| GET | `/mmo/render/frame/summary` | Quality per tile |
| GET | `/mmo/render/compositor` | Compositor snapshot |
| POST | `/mmo/render/npc` | Submit NPC render |
| POST | `/mmo/render/world-snapshot` | World render snapshot |

---

## Providers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/providers/list` | user (opt) | All 19 providers with `hasKey`, `source`, `tier` |
| GET | `/providers/:id/models` | user (opt) | Model list for provider |
| POST | `/providers/:id/test` | user | Test connection to provider |
| POST | `/providers/proxy` | user | Proxy inference request (streaming or non-streaming) |

### Provider IDs

`kilo`, `llm7`, `openrouter`, `cline`, `groq`, `mistral`, `nvidia`, `cohere`,
`sambanova`, `hyperbolic`, `together`, `fireworks`, `perplexity`, `xai`,
`anthropic`, `openai`, `google`, `azure`, `bedrock`

---

## User Profile

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| GET | `/user/providers` | user | — | Get user provider keys (masked) |
| PUT | `/user/providers` | user | `{ providerKey: value }` | Set provider keys |
| POST | `/user/onboarded` | user | — | Mark onboarding complete |
| GET | `/user/profile` | user | — | Full user profile |

---

## Admin

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| GET | `/admin/globals` | admin | — | Global config (keys masked) |
| PUT | `/admin/globals` | admin | `{ providerKeys, ... }` | Update global config |
| POST | `/admin/globals/providers` | admin | `{ id, key }` | Set individual provider key |
| POST | `/admin/user` | admin | `{ name }` | Create user → `{ key }` |
| GET | `/admin/users` | admin | — | List users |
| GET | `/admin/db/databases` | admin | — | List SQLite databases |
| GET | `/admin/db/:dbId/tables` | admin | — | Tables + row counts |
| GET | `/admin/db/:dbId/table/:table` | admin | `?limit&offset&search` | Rows (paginated) |
| POST | `/admin/db/:dbId/query` | admin | `{ sql }` | Read-only SQL query |

**DB IDs**: `flow` (Flow board SQLite)

---

## Agent Hub

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| GET | `/hub/health` | — | — | Hub status |
| GET | `/hub/agents` | — | — | Available agents + install status |
| POST | `/hub/agents/:id/install` | — | — | Install agent |
| GET | `/hub/sessions` | — | — | Active sessions |
| POST | `/hub/sessions` | user | `{ agentId, task, ... }` | Create session |
| GET | `/hub/sessions/:id` | user | — | Session detail |
| DELETE | `/hub/sessions/:id` | user | — | End session |
| POST | `/hub/sessions/:id/message` | user | `{ content }` | Send message |
| POST | `/hub/sessions/:id/abort` | user | — | Abort session |
| GET | `/hub/sessions/:id/events` | user | — | SSE event stream |
| GET | `/hub/sessions/:id/events/list` | user | — | Buffered events |
| POST | `/hub/sessions/:id/permission` | user | `{ granted }` | Grant/deny tool use |
| GET | `/hub/sessions/:id/fs` | user | `?path` | List directory |
| GET | `/hub/sessions/:id/fs/read` | user | `?path` | Read file |
| PUT | `/hub/sessions/:id/fs/write` | user | `{ path, content }` | Write file |
| DELETE | `/hub/sessions/:id/fs/delete` | user | `?path` | Delete file |
| POST | `/hub/sessions/:id/exec` | user | `{ command }` | Execute shell command |

---

## Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/settings` | Server settings (backend config, model path, …) |
| PUT | `/settings` | Update settings |
