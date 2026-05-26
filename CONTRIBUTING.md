# Contributing to bKG

Thank you for contributing to **bKG — best Known Garbage**.

---

## Ways to Contribute

- Bug fixes
- New cloud provider integrations
- Game system improvements (new blueprint sections, better AI prompts)
- UI/UX improvements
- Documentation
- Test coverage
- Performance improvements

---

## Development Setup

```bash
git clone https://github.com/soniaschuh88-ship-it/super-waddle.git
cd super-waddle

# Install frontend deps
npm install

# Install server deps
cd server && npm install && cd ..

# Copy env
cp .env.example .env

# Build frontend
npm run build

# Start server
BKG_PORT=5020 node server/serve.js &

# Start dev server (HMR)
BKG_PORT=5020 npm run dev
```

---

## Code Standards

### TypeScript (frontend)

```bash
# Type check — must pass before PR
npx tsc --noEmit

# Lint
npm run lint

# Build — must succeed
npm run build
```

- Strict TypeScript: no `any` unless absolutely necessary
- No unused imports
- All React component props must be typed
- Prefer `interface` over `type` for object shapes
- Use `import type` for type-only imports
- Always handle errors: `try/catch`, not silent failures

### JavaScript (server)

```bash
node --check server/serve.js
```

- ESM modules (`import`/`export`, not `require`)
- Async/await over callbacks
- No global mutable state outside module-level constants
- Always validate request bodies: check required fields, return 400 on missing
- All `async` route handlers must have `try/catch`

### CSS / Tailwind

- No inline styles except for dynamic values (colours, transforms)
- Responsive: all layouts work at 320px to 2560px
- Mobile-first: `sm:` overrides rather than `md:hidden` for important content
- Never add `max-width` to `main > *` — each component controls its own width

---

## Commit Messages

Format: `type: short summary (< 72 chars)`

```
feat: add X system with Y capability
fix: resolve Z bug in W component
docs: add ARCHITECTURE.md and API.md
refactor: simplify blueprint section generation
test: add 5 assertions for blueprint CRUD
chore: update dependencies
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `style`

---

## Pull Request Process

1. Fork → feature branch from `main`
2. Branch name: `feat/description` or `fix/description`
3. Write code + pass all checks:
   ```bash
   npx tsc --noEmit && npm run build && node test/alpha.js http://localhost:4001
   ```
4. 127/127 tests must pass
5. Open PR against `main`
6. Describe: what changed, why, how tested

---

## Adding a Cloud Provider

1. Add provider definition in `server/serve.js` `PROVIDERS` array:
   ```js
   {
     id: 'myprovider',
     name: 'My Provider',
     tier: 'freemium',
     description: '...',
     signupUrl: 'https://...',
     anonAccess: false,
     configKey: 'myprovider_api_key',
   }
   ```

2. Add model-fetch handler in `GET /providers/:id/models`

3. Add proxy support in `POST /providers/proxy`

4. Add to `FEATURED_PROVIDERS` in `Onboarding.tsx` if it has a free tier

---

## Adding a Game Blueprint Section

1. Add section key to `SECTIONS` array in `server/bkg-game-blueprint.js`

2. Add AI prompt in `buildSectionPrompt()`:
   ```js
   mynewsection: {
     system: `You are a ... designer. Generate ... as JSON array. Output ONLY valid JSON.`,
     user:   `Game: "${bp.name}" | ...`,
   }
   ```

3. Add default value in `BLUEPRINT_DEFAULTS`

4. Add step in `GameWizard.tsx` `STEPS` array and `steps` render map

5. Add section to `SECTIONS` in `MMOCreator.tsx` for admin editing

---

## Project Structure

```
super-waddle/
├── src/
│   ├── components/
│   │   ├── Admin/          AdminApp, Auth, DbViewer, MMOCreator, ...
│   │   ├── AgentHub/       Hub session UI
│   │   ├── CodeStudio/     Dual-pane editor
│   │   ├── Flow/           Board, Task, TaskCard
│   │   ├── Game/           GameWizard, GameClient, WorldBuilder
│   │   ├── Layout/         AppShell, StageProgress
│   │   ├── MMO/            MMOEngine
│   │   ├── Stufe1/         Plan wizard
│   │   ├── Stufe1_5/       Validation loop
│   │   ├── Stufe2/         File explorer
│   │   ├── Stufe3/         Code studio
│   │   ├── UserDashboard/  Dashboard, Onboarding, Settings, ModelTester
│   │   └── Voxel/          VoxelEngine, VoxelRenderer
│   ├── context/            AppContext (state + dispatch)
│   ├── lib/                db.ts, llm-client.ts
│   └── types/              index.ts (Stage, BackendConfig, ...)
├── server/
│   ├── serve.js            Main server (~3500 lines)
│   ├── bkg-flow.js         Flow board + task system
│   ├── bkg-game.js         Game wizard config + generation
│   ├── bkg-game-blueprint.js  Blueprint schema + CRUD + AI prompts
│   ├── bkg-vldb.js         Voxel world storage engine
│   ├── bkg-p2p.js          P2P relay + signaling + zone mgmt
│   ├── vsl-reducer.js      VSL deterministic consensus
│   ├── cluster-manager.js  Zone/server assignment
│   ├── chaos-recovery.js   Peer trust + bad event quarantine
│   └── ... (15 more MMO modules)
├── test/
│   └── alpha.js            127-assertion integration test
├── docs/
│   ├── FEATURES.md         Full feature inventory
│   ├── PROGRESS.md         Completed work log
│   ├── UPDATE.md           Enhancement proposals
│   ├── ARCHITECTURE.md     Detailed subsystem docs
│   ├── API.md              API cross-reference
│   ├── GAME_BLUEPRINT.md   Blueprint schema reference
│   └── GAME_SYSTEMS.md     Game subsystem docs
├── Dockerfile              Multi-stage production build
├── docker-compose.yml      Compose file with bkg-data volume
├── install.sh              Interactive installer (local / Docker)
├── .env.example            All documented env variables
└── vite.config.ts          Dev server + proxy config
```

---

## License

MIT. All contributions must be compatible with the MIT license.
