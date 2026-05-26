# Deployment Guide

Options: **Local** · **Docker** · **VPS / Cloud** · **Reverse Proxy**

---

## Option 1 — Local (Development or personal use)

### Interactive installer

```bash
git clone https://github.com/soniaschuh88-ship-it/super-waddle.git
cd super-waddle
./install.sh
```

Choose **1) Local install**. The script:
1. Checks Node.js ≥ 20
2. `npm install` + `cd server && npm install`
3. `npm run build`
4. Starts the server
5. Prints the admin password

### Manual

```bash
npm install && cd server && npm install && cd ..
npm run build
BKG_PORT=4001 node server/serve.js
```

### Environment

```bash
cp .env.example .env
# Edit .env — see all variables below
```

---

## Option 2 — Docker (Recommended for clean testing)

### Quick start

```bash
docker compose up --build
```

First run: check logs for admin password:
```bash
docker compose logs bkg | grep -A3 "FIRST RUN"
```

### What the compose file provides

```yaml
services:
  bkg:
    build: .
    ports:
      - "4001:4001"       # app + API
    volumes:
      - bkg-data:/root/.bkg   # blueprints, flow DB, user keys
    restart: unless-stopped
    healthcheck:
      test: wget -qO- http://localhost:4001/health/ready
```

### Updating

```bash
docker compose pull   # if using pre-built image
docker compose up --build -d    # rebuild from source
```

### Persistent data

The `bkg-data` named volume persists:
- `admin.env` (admin password hash)
- `blueprints/` (game blueprints)
- `flow-*.db` (Flow board data)
- `run/serve.pid`

To back up: `docker run --rm -v bkg-data:/data -v $(pwd):/backup alpine tar czf /backup/bkg-backup.tar.gz /data`

---

## Option 3 — VPS / Cloud VM

### Requirements

- Node.js 20+ or Docker
- 512 MB RAM minimum (1 GB recommended for large worlds)
- 2 GB disk (more for model storage)

### Steps

```bash
# On server
git clone https://github.com/soniaschuh88-ship-it/super-waddle.git /opt/bkg
cd /opt/bkg

./install.sh      # choose 1) Local

# Or Docker:
docker compose up -d
```

### Run as a systemd service

```ini
# /etc/systemd/system/bkg.service
[Unit]
Description=bKG Server
After=network.target

[Service]
Type=simple
User=bkg
WorkingDirectory=/opt/bkg
ExecStart=node server/serve.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/bkg/.env

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now bkg
journalctl -fu bkg
```

---

## Option 4 — Nginx Reverse Proxy (HTTPS)

```nginx
# /etc/nginx/sites-available/bkg
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # WebSocket support (for MMO /mmo/ws)
    location /mmo/ws {
        proxy_pass          http://localhost:4001;
        proxy_http_version  1.1;
        proxy_set_header    Upgrade $http_upgrade;
        proxy_set_header    Connection "upgrade";
        proxy_set_header    Host $host;
        proxy_read_timeout  3600s;
    }

    # API + SSE (requires buffering disabled for SSE)
    location ~ ^/(flow|game|vldb|mmo|hub|providers|admin|auth|api) {
        proxy_pass          http://localhost:4001;
        proxy_http_version  1.1;
        proxy_set_header    Host $host;
        proxy_set_header    X-Real-IP $remote_addr;
        proxy_buffering     off;    # required for SSE streams
        proxy_read_timeout  300s;
    }

    # SPA + static assets
    location / {
        proxy_pass          http://localhost:4001;
        proxy_set_header    Host $host;
    }
}
```

```bash
certbot --nginx -d yourdomain.com
nginx -t && systemctl reload nginx
```

---

## Environment Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `BKG_PORT` | `4001` | — | HTTP server port |
| `BKG_HOST` | `0.0.0.0` | — | Bind address |
| `BKG_ADMIN_PASSWORD_HASH` | auto-gen | — | bcrypt hash, cost 12 |
| `BKG_JWT_SECRET` | random | Prod: yes | 64-char random hex |
| `BKG_DIR` | `~/.bkg` | — | Persistent data directory |
| `BKG_LLAMA_PORT` | `8001` | — | node-llama-cpp port |
| `BKG_OLLAMA_PORT` | `11434` | — | Ollama port |
| `NVIDIA_API_KEY` | — | — | Global NVIDIA NIM key |
| `OPENROUTER_API_KEY` | — | — | Global OpenRouter key |
| `ANTHROPIC_API_KEY` | — | — | For coding agents |
| `OPENAI_API_KEY` | — | — | For coding agents |

### Generating a bcrypt hash

```bash
node -e "const b=require('bcryptjs');console.log(b.hashSync('yourpassword',12))"
```

### Generating a JWT secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Production Checklist

- [ ] Set a strong `BKG_ADMIN_PASSWORD_HASH` (not auto-generated)
- [ ] Set `BKG_JWT_SECRET` to a random 64-char hex string
- [ ] Run behind Nginx with TLS (Let's Encrypt)
- [ ] Firewall: only expose 443 (80 redirect), not 4001 directly
- [ ] Set `BKG_DIR` to a persistent disk path
- [ ] Back up `BKG_DIR` regularly (contains blueprints + Flow DB)
- [ ] Set up log rotation for Node.js stdout
- [ ] Monitor with `GET /health/ready`

---

## Ports Used

| Port | Service | Configurable |
|------|---------|-------------|
| 4001 | Main app server | `BKG_PORT` |
| 8001 | node-llama-cpp inference | `BKG_LLAMA_PORT` |
| 11434 | Ollama | `BKG_OLLAMA_PORT` |
| 3000 | Vite dev server | hardcoded in vite.config.ts |

---

## Upgrading

```bash
# Pull latest
git pull

# Rebuild frontend
npm run build

# Restart server
./install.sh stop
./install.sh start

# Or Docker:
docker compose up --build -d
```

---

## Troubleshooting

### Server won't start

```bash
node --check server/serve.js   # syntax check
cat /tmp/bkg-run.log           # check startup log
```

### Port already in use

```bash
lsof -i :4001 | grep LISTEN    # find process
BKG_PORT=5020 node server/serve.js   # use different port
```

### Admin password lost

```bash
# Delete admin.env to trigger first-run password generation
rm ~/.bkg/admin.env
node server/serve.js   # new password printed to console
```

### Blueprint AI generation fails

1. Check Admin → Global Providers → NVIDIA or OpenRouter key is set
2. `GET /providers/list` — confirm `hasKey=true` for at least one provider
3. Test with `POST /providers/:id/test`
