# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x-alpha | ✅ Active |
| < 1.0 | ❌ No patches |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: security@bkg.dev (or open a private GitHub security advisory)

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Any suggested mitigations

Response time: within 7 days for critical, 30 days for others.

---

## Security Model

bKG is designed for **self-hosted, trusted-network use**.
Default configuration is NOT hardened for public internet exposure.

### What is protected

- **Admin panel**: bcrypt password hash + HMAC JWT tokens (7-day expiry)
- **API keys**: scoped user tokens (`bkg_` prefix, 32 hex chars)
- **Provider keys**: stored in `~/.bkg/users/globals.json`, never logged or returned in plaintext
- **Admin DB viewer**: SELECT-only SQL (no INSERT/UPDATE/DELETE allowed)
- **Install key**: one-time delivery via `/admin/install-key`, deleted from disk after serving

### What is NOT protected by default

- The app itself is **unauthenticated by default** — any user on the network can use it
- API endpoints (flow, game, vldb, mmo) require a user API key **only if one is provided**
- CORS is `*` — any origin can call the API
- No rate limiting (add Nginx/Cloudflare rate limiting for public exposure)

### For public exposure

Always run behind a reverse proxy with:
- TLS (HTTPS)
- Rate limiting
- Authentication (basic auth at proxy level if app-level auth is insufficient)
- Firewall rules to block direct access to port 4001

---

## Known Risks

### SQL injection (DB Viewer)

The `/admin/db/:dbId/query` endpoint accepts raw SQL.
**Mitigation**: requires admin session; only SELECT/WITH/PRAGMA are allowed; database is opened read-only.

### Path traversal (file system access)

Agent Hub's `/hub/sessions/:id/fs/read` and `/fs/write` endpoints can read/write files.
**Mitigation**: requires user API key; operations are scoped to the agent session sandbox.

### Server-side request forgery (provider proxy)

`POST /providers/proxy` forwards requests to external AI providers.
**Mitigation**: only pre-defined provider endpoints are called; URL is not user-controlled.

---

## Hardening Checklist

- [ ] Change admin password from auto-generated to a strong passphrase
- [ ] Set `BKG_JWT_SECRET` to a random 64-char hex string
- [ ] Run behind Nginx with TLS
- [ ] Restrict port 4001 to localhost only
- [ ] Set up Nginx basic auth or OAuth if exposing to multiple untrusted users
- [ ] Rotate provider API keys regularly
- [ ] Back up `~/.bkg/` — it contains all user data
- [ ] Monitor `/health` for unexpected downtime

---

## Data Stored

| Location | Contains | Sensitive |
|----------|----------|-----------|
| `~/.bkg/admin.env` | bcrypt hash of admin password | Yes |
| `~/.bkg/install.key` | plaintext admin password (one-time) | Yes — delete after setup |
| `~/.bkg/users/globals.json` | encrypted global provider keys | Yes |
| `~/.bkg/blueprints/*.json` | game blueprint data | No |
| `~/.bkg/flow-*.db` | Flow board data (tasks, comments) | Maybe |

**Provider API keys** are stored in the user profile JSON under `providers: { nvidia_api_key: "..." }`.
They are never returned in API responses — only used server-side for AI calls.
