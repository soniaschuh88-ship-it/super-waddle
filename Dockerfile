# ── bKG Dockerfile ───────────────────────────────────────────────────────────
# Multi-stage build: deps → build → runtime
# Final image: ~200MB (node:22-alpine + pre-built dist)
#
# Build:  docker build -t bkg .
# Run:    docker run -p 4001:4001 -v bkg-data:/root/.bkg bkg

# ── Stage 1: Install server dependencies ─────────────────────────────────────
FROM node:22-alpine AS server-deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# ── Stage 2: Build frontend ───────────────────────────────────────────────────
FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
# Skip the server/ node_modules from host; use stage 1's
RUN npm run build

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Non-root user for security
RUN addgroup -S bkg && adduser -S bkg -G bkg

WORKDIR /app

# Copy server code + its dependencies
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/ ./server/

# Copy built frontend
COPY --from=frontend-build /app/dist ./dist

# Copy root scripts
COPY bkg.sh ./
COPY .env.example ./.env.example 2>/dev/null || true

# Runtime config directory — mounted as a volume in production
RUN mkdir -p /root/.bkg && chown bkg:bkg /root/.bkg

EXPOSE 4001

ENV BKG_PORT=4001 \
    BKG_HOST=0.0.0.0 \
    NODE_ENV=production

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4001/health/ready || exit 1

# Run as non-root
USER bkg

CMD ["node", "server/serve.js"]
