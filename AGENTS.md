# AGENTS.md — AI Agent Instructions for bKG

This file provides instructions for AI coding agents (Claude Code, Codex, Pi, Amp, etc.)
working on the bKG codebase.

---

## Project Identity

**bKG — best Known Garbage** is a self-hosted AI workspace with:
- React/TypeScript frontend (Vite, Tailwind CSS)
- Single Node.js Express server (`server/serve.js`)
- SQLite (better-sqlite3) for Flow board
- File-based JSON storage for blueprints (`~/.bkg/blueprints/`)

---

## Critical Rules

### Never break the test suite

All 127 assertions in `test/alpha.js` must pass after any change:
```bash
node test/alpha.js http://localhost:5020
```

Run the server first:
```bash
BKG_PORT=5020 node server/serve.js &
sleep 10
```

### TypeScript must compile cleanly

```bash
npx tsc --noEmit
npm run build
```

No `any` types without explicit justification. No unused imports.

### Server syntax must be valid

```bash
node --check server/serve.js
```

---

## Code Patterns

### Adding a server endpoint

```js
// Standard pattern for serve.js
app.get('/game/blueprint/list', (req, res) => {
  const mode = req.query.mode?.toString() ?? null;
  res.json({ blueprints: listBlueprints(mode) });
});

// Async endpoint
app.post('/game/blueprint/:id/generate/:section', async (req, res) => {
  try {
    const bp = getBlueprint(req.params.id);
    if (!bp) return res.status(404).json({ error: 'Blueprint not found' });
    // ... logic
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin-only endpoint
app.post('/admin/something', (req, res) => {
  if (!requireAdminSession(req, res)) return;
  // ... logic
});

// User-auth optional
app.get('/game/blueprint/:id', (req, res) => {
  const userKey = req.headers.authorization?.replace('Bearer ', '').trim();
  const profile = userKey ? getUserProfile(userKey) : null;
  // ... logic
});
```

### Adding a React stage

1. Create component in `src/components/Game/MyStage.tsx`
2. Add stage key to `src/types/index.ts` Stage union
3. Add case to `StageView()` in `src/App.tsx`
4. Add to `NAV_ITEMS` in `AppShell.tsx` (mobile drawer)
5. Add to desktop nav array in `AppShell.tsx`

### Adding a game blueprint section

1. Add section key and default in `server/bkg-game-blueprint.js`:
   - `BLUEPRINT_DEFAULTS.mysection = ...`
   - AI prompt in `buildSectionPrompt('mysection', bp)`
2. Add section data to `createBlueprint()` initial object
3. Add to `SECTIONS` array in `MMOCreator.tsx`
4. Add step to `STEPS` array in `GameWizard.tsx`
5. Add step render to `steps` map in `GameWizard.tsx`

---

## File Structure Quick Reference

```
server/serve.js              — Main Express server, ~3500 lines
server/bkg-game-blueprint.js — Blueprint schema + CRUD + AI prompts
server/bkg-flow.js           — Flow board (tasks, missions, evals)
server/bkg-game.js           — Game config (genres, tones, engines)
server/bkg-vldb.js           — Voxel world engine
server/bkg-p2p.js            — P2P/MMO relay

src/App.tsx                  — Stage routing
src/types/index.ts           — Stage type + all types
src/context/AppContext.tsx   — Global state
src/index.css                — Design system CSS

src/components/Layout/AppShell.tsx     — Header + mobile drawer
src/components/UserDashboard/Dashboard.tsx — Home + provider panel
src/components/UserDashboard/Onboarding.tsx — First-run wizard
src/components/Game/GameWizard.tsx     — Single-player blueprint wizard
src/components/Game/GameClient.tsx     — MMO world lobby
src/components/Game/WorldBuilder.tsx   — Voxel world from blueprint
src/components/Admin/AdminApp.tsx      — Admin panel shell
src/components/Admin/MMOCreator.tsx    — Blueprint management
src/components/Admin/DbViewer.tsx      — SQLite viewer
```

---

## Key API Patterns

### Auth helpers (serve.js)

```js
// Require admin session or return 401
if (!requireAdminSession(req, res)) return;

// Get user profile from bearer token
const profile = getUserProfile(token);  // null if invalid

// Get global provider config
const cfg = getGlobalProviderConfig();  // { providerKeys: { nvidia_api_key: '...' } }
```

### Provider key resolution

```js
const userKey   = req.headers.authorization?.replace('Bearer ','').trim();
const userProfile = userKey ? getUserProfile(userKey) : null;
const apiKey    = userProfile?.providers?.nvidia_api_key
               || getGlobalProviderConfig().providerKeys?.nvidia_api_key
               || process.env.NVIDIA_API_KEY || '';
```

### SSE streaming

```js
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('X-Accel-Buffering', 'no');
const send = (type, data) => res.write(`data: ${JSON.stringify({type,data})}\n\n`);

// Then:
send('chunk', { token: 'Hello' });
send('done',  { fullText: '...', parsedData: [...] });
send('error', { message: 'Something failed' });
res.end();
```

---

## Testing New Endpoints

Add assertions to `test/alpha.js` following the existing pattern:

```js
// GET endpoint
r = await GET('/game/blueprint/list');
assert('GET /game/blueprint/list', r.status === 200 && Array.isArray(r.body?.blueprints), r.raw);

// POST endpoint
r = await POST('/game/blueprint/create', { name: 'Test', mode: 'singleplayer', genre: 'rpg' });
assert('POST /game/blueprint/create', r.status === 200 && r.body?.id, r.raw);

// Cleanup
r = await DELETE(`/game/blueprint/${testBpId}`);
assert('DELETE /game/blueprint/:id', r.status === 200 && r.body?.ok, r.raw);
```

---

## Design System Constants

```css
/* Primary colours */
--accent: #00e5ff    /* cyan — main interactive colour */
--success: #00e5a0   /* mint — positive states */
--error: #ff3d6b     /* crimson — errors */
--warning: #ffb300   /* amber — game studio accent */
--mystic: #a855f7    /* purple — agent/AI accent */

/* Backgrounds */
--base: #020a12      /* darkest */
--surface: #030810   /* cards */
--panel: #050e1a     /* panels */

/* Typography */
--font-display: 'Orbitron'  /* headers */
--font-mono: 'JetBrains Mono'
```

---

## Do Not

- Don't add `main > * { max-width: ... }` CSS — it breaks full-height panels
- Don't add blocking synchronous I/O on the critical request path
- Don't store sensitive values (plaintext passwords, API keys) in source code
- Don't add `console.log` to production paths
- Don't use `require()` — the codebase uses ESM (`import`/`export`)
- Don't modify `~/.bkg/admin.env` without regenerating the hash
- Don't add circular dependencies between server modules
