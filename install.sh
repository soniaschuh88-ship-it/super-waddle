#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# bKG — best Known Garbage  ·  Install & Start Script
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BKG_PORT="${BKG_PORT:-4001}"
BKG_DIR="${BKG_DIR:-$HOME/.bkg}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colours ──────────────────────────────────────────────────────────────────
C_RESET='\033[0m'
C_BOLD='\033[1m'
C_CYAN='\033[0;36m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[0;33m'
C_RED='\033[0;31m'

info()  { echo -e "${C_CYAN}${C_BOLD}[bKG]${C_RESET} $*"; }
ok()    { echo -e "${C_GREEN}  ✓${C_RESET} $*"; }
warn()  { echo -e "${C_YELLOW}  ⚠${C_RESET} $*"; }
err()   { echo -e "${C_RED}  ✗${C_RESET} $*" >&2; }
die()   { err "$*"; exit 1; }

# ── Banner ───────────────────────────────────────────────────────────────────

print_banner() {
cat << 'EOF'
╔══════════════════════════════════════════════════════════╗
║   █▄▄ █▄▀ █▀▀   best Known Garbage  v1.0.0-alpha         ║
║   █▄█ █░█ █▄█   Local AI Coding Workspace                ║
╠══════════════════════════════════════════════════════════╣
║  AI planning · Flow board · Voxel world · MMO engine     ║
╚══════════════════════════════════════════════════════════╝
EOF
}

# ── Detect commands ───────────────────────────────────────────────────────────

has() { command -v "$1" &>/dev/null; }

check_node() {
  has node || die "Node.js not found. Install v20+ from https://nodejs.org"
  local ver; ver=$(node -e "process.stdout.write(process.version.slice(1))")
  local major; major=$(echo "$ver" | cut -d. -f1)
  [[ $major -ge 20 ]] || die "Node.js $ver is too old. Need v20+."
  ok "Node.js $ver"
}

check_docker() {
  has docker && has docker-compose || has docker  # docker compose v2 is part of docker
  docker info &>/dev/null 2>&1 || die "Docker is not running. Start Docker Desktop or docker daemon."
  ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
}

# ── Installation modes ────────────────────────────────────────────────────────

install_local() {
  info "Installing dependencies…"

  cd "$SCRIPT_DIR"

  # Root package (Vite, React, TypeScript)
  if [[ ! -d node_modules ]]; then
    info "Installing frontend dependencies (npm install)…"
    npm install
    ok "Frontend deps installed"
  else
    ok "Frontend deps already present"
  fi

  # Server package
  if [[ ! -d server/node_modules ]]; then
    info "Installing server dependencies…"
    npm --prefix server install
    ok "Server deps installed"
  else
    ok "Server deps already present"
  fi

  # Build frontend
  info "Building frontend…"
  npm run build
  ok "Frontend built → dist/"

  # Create data directory
  mkdir -p "$BKG_DIR"
  ok "Data directory: $BKG_DIR"
}

install_docker() {
  info "Building Docker image (this may take a few minutes on first run)…"
  cd "$SCRIPT_DIR"
  docker compose build
  ok "Docker image built"
}

# ── Start ─────────────────────────────────────────────────────────────────────

start_local() {
  info "Starting bKG server on port $BKG_PORT…"

  # Kill any existing bKG process
  local PIDFILE="$BKG_DIR/run/serve.pid"
  if [[ -f "$PIDFILE" ]]; then
    local OLD_PID; OLD_PID=$(cat "$PIDFILE" 2>/dev/null || echo "")
    if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
      info "Stopping existing server (PID $OLD_PID)…"
      kill "$OLD_PID" 2>/dev/null || true
      sleep 1
    fi
  fi

  mkdir -p "$BKG_DIR/run"

  # Start server in background
  BKG_PORT="$BKG_PORT" node "$SCRIPT_DIR/server/serve.js" &
  local PID=$!
  echo "$PID" > "$PIDFILE"

  # Wait for readiness
  info "Waiting for server to be ready…"
  local tries=0
  until curl -sf "http://localhost:$BKG_PORT/health/ready" >/dev/null 2>&1; do
    tries=$((tries+1))
    [[ $tries -gt 20 ]] && die "Server did not start after 20s. Check the logs."
    sleep 1
    printf "."
  done
  echo ""

  ok "Server running on port $BKG_PORT (PID $PID)"

  # Show admin key if first run
  if [[ -f "$BKG_DIR/install.key" ]]; then
    local KEY; KEY=$(cat "$BKG_DIR/install.key" 2>/dev/null || echo "")
    if [[ -n "$KEY" ]]; then
      echo ""
      echo -e "${C_YELLOW}${C_BOLD}══════════════════════════════════════════════${C_RESET}"
      echo -e "${C_YELLOW}${C_BOLD}  FIRST RUN — ADMIN PASSWORD                  ${C_RESET}"
      echo -e "${C_YELLOW}${C_BOLD}══════════════════════════════════════════════${C_RESET}"
      echo -e "  Password: ${C_CYAN}${C_BOLD}${KEY}${C_RESET}"
      echo ""
      echo "  → Open http://localhost:$BKG_PORT/admin"
      echo "  → Enter this password to log in"
      echo "  → Also stored in: $BKG_DIR/install.key"
      echo -e "${C_YELLOW}${C_BOLD}══════════════════════════════════════════════${C_RESET}"
      echo ""
    fi
  fi

  echo ""
  echo -e "${C_GREEN}${C_BOLD}  App:    http://localhost:$BKG_PORT${C_RESET}"
  echo -e "${C_CYAN}  Admin:  http://localhost:$BKG_PORT/admin${C_RESET}"
  echo ""
  echo "  Stop:  kill $PID  or  $0 stop"
  echo ""
}

start_docker() {
  info "Starting bKG with Docker…"
  cd "$SCRIPT_DIR"

  BKG_PORT="$BKG_PORT" docker compose up -d

  # Wait for health check
  info "Waiting for container to be healthy…"
  local tries=0
  until curl -sf "http://localhost:$BKG_PORT/health/ready" >/dev/null 2>&1; do
    tries=$((tries+1))
    [[ $tries -gt 30 ]] && {
      warn "Container not ready yet. Check: docker compose logs bkg"
      break
    }
    sleep 1
    printf "."
  done
  echo ""

  ok "bKG running in Docker"

  # Show admin key from logs
  echo ""
  echo -e "${C_YELLOW}${C_BOLD}  Check admin password in logs:${C_RESET}"
  echo "  docker compose logs bkg | grep -A3 'FIRST RUN'"
  echo ""
  echo -e "${C_GREEN}${C_BOLD}  App:    http://localhost:$BKG_PORT${C_RESET}"
  echo -e "${C_CYAN}  Admin:  http://localhost:$BKG_PORT/admin${C_RESET}"
  echo ""
}

stop_local() {
  local PIDFILE="$BKG_DIR/run/serve.pid"
  if [[ -f "$PIDFILE" ]]; then
    local PID; PID=$(cat "$PIDFILE" 2>/dev/null || echo "")
    if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      ok "Server stopped (PID $PID)"
      rm -f "$PIDFILE"
    else
      warn "No running server found"
      rm -f "$PIDFILE"
    fi
  else
    warn "No PID file found"
  fi
}

stop_docker() {
  cd "$SCRIPT_DIR"
  docker compose down
  ok "Docker containers stopped"
}

# ── Interactive installer ─────────────────────────────────────────────────────

choose_install_method() {
  print_banner
  echo ""
  echo "How would you like to install bKG?"
  echo ""
  echo "  1) Local install  — Node.js required (fast, recommended for development)"
  echo "  2) Docker          — Docker required  (clean, recommended for production)"
  echo ""

  local choice
  read -rp "Choose [1/2]: " choice

  case "$choice" in
    1|"") echo "local" ;;
    2)    echo "docker" ;;
    *)    echo "local" ;;
  esac
}

# ── Main ──────────────────────────────────────────────────────────────────────

case "${1:-}" in
  start)
    # Called with explicit 'start' — detect mode from existing setup
    if [[ -f "$SCRIPT_DIR/docker-compose.yml" ]] && has docker && docker compose ps 2>/dev/null | grep -q "bkg"; then
      start_docker
    else
      start_local
    fi
    ;;

  stop)
    if docker compose ps 2>/dev/null | grep -q "bkg"; then
      stop_docker
    else
      stop_local
    fi
    ;;

  docker-start)
    check_docker
    install_docker
    start_docker
    ;;

  local-start)
    check_node
    install_local
    start_local
    ;;

  install)
    # Non-interactive: default to local
    check_node
    install_local
    info "Installation complete. Run '$0 start' to start bKG."
    ;;

  "")
    # Interactive first-time setup
    print_banner
    echo ""

    local METHOD
    METHOD=$(choose_install_method)

    if [[ "$METHOD" == "docker" ]]; then
      check_docker
      install_docker
      start_docker
    else
      check_node
      install_local
      start_local
    fi
    ;;

  *)
    echo "Usage: $0 [start|stop|install|docker-start|local-start]"
    echo ""
    echo "  (no args)     — interactive installer: choose local or Docker"
    echo "  start         — start the server (auto-detects mode)"
    echo "  stop          — stop the server"
    echo "  install       — install deps + build (local, non-interactive)"
    echo "  docker-start  — build and start with Docker"
    echo "  local-start   — install deps, build, and start locally"
    exit 1
    ;;
esac
