#!/usr/bin/env bash
# =============================================================================
# icadp.sh — bKG Process Manager
#
# Usage:
#   ./icadp.sh start      Start the app (kills any existing instance first)
#   ./icadp.sh stop       Stop everything
#   ./icadp.sh restart    Stop then start
#   ./icadp.sh status     Show running services and URLs
#   ./icadp.sh build      Build the production bundle
#   ./icadp.sh dev        Run Vite dev server (no build needed)
#   ./icadp.sh logs       Tail all log files
#   ./icadp.sh logs serve Tail a specific log  (serve|tunnel|llama|ollama)
#
# Environment variables (can also be set in .bkg.env):
#   ICADP_PORT        App server port          (default: 4000)
#   ICADP_LLAMA_PORT  llama-cpp port           (default: 8001)
#   ICADP_OLLAMA_PORT Ollama port              (default: 11434)
#   ICADP_TUNNEL      0|1 – start serveo tunnel (default: 1)
#   ICADP_NO_BUILD    1   – skip build check    (default: 0)
# =============================================================================

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✔ ${NC}$*"; }
warn() { echo -e "${YELLOW}  ⚠ ${NC}$*"; }
err()  { echo -e "${RED}  ✖ ${NC}$*" >&2; }
info() { echo -e "${CYAN}  ● ${NC}$*"; }
banner() { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }

# ── Directories ───────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_DIR="$SCRIPT_DIR/.bkg/run"
LOG_DIR="$SCRIPT_DIR/.bkg/logs"
ENV_FILE="$SCRIPT_DIR/.bkg.env"

mkdir -p "$PID_DIR" "$LOG_DIR"

# ── Load .bkg.env if it exists ──────────────────────────────────────────────
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

# ── Config (defaults) ─────────────────────────────────────────────────────────
ICADP_PORT="${ICADP_PORT:-4000}"
ICADP_LLAMA_PORT="${ICADP_LLAMA_PORT:-8001}"
ICADP_OLLAMA_PORT="${ICADP_OLLAMA_PORT:-11434}"
ICADP_TUNNEL="${ICADP_TUNNEL:-1}"
ICADP_NO_BUILD="${ICADP_NO_BUILD:-0}"
DIST_DIR="$SCRIPT_DIR/dist"

# ── PID files ─────────────────────────────────────────────────────────────────
PID_SERVE="$PID_DIR/serve.pid"
PID_TUNNEL="$PID_DIR/tunnel.pid"
PID_DEV="$PID_DIR/dev.pid"

# ── Log files ─────────────────────────────────────────────────────────────────
LOG_SERVE="$LOG_DIR/serve.log"
LOG_TUNNEL="$LOG_DIR/tunnel.log"
LOG_DEV="$LOG_DIR/dev.log"
LOG_BUILD="$LOG_DIR/build.log"

# ── Helpers ───────────────────────────────────────────────────────────────────

# is_pid_running <pid_file>
is_pid_running() {
  local pidfile="$1"
  [[ -f "$pidfile" ]] || return 1
  local pid; pid=$(cat "$pidfile" 2>/dev/null) || return 1
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

# kill_pid_file <pid_file> [signal]
kill_pid_file() {
  local pidfile="$1"
  local sig="${2:-TERM}"
  [[ -f "$pidfile" ]] || return 0
  local pid; pid=$(cat "$pidfile" 2>/dev/null) || return 0
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill -"$sig" "$pid" 2>/dev/null || true
    # Wait up to 5 s for graceful exit
    local i=0
    while kill -0 "$pid" 2>/dev/null && (( i < 10 )); do
      sleep 0.5; (( i++ ))
    done
    # Force-kill if still alive
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
}

# kill_port <port>  — kills whatever is listening on <port>
kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti:"$port" 2>/dev/null || fuser "$port/tcp" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill -TERM $pids 2>/dev/null || true
    sleep 0.5
    pids=$(lsof -ti:"$port" 2>/dev/null || true)
    [[ -n "$pids" ]] && kill -KILL $pids 2>/dev/null || true
  fi
}

# port_open <port>  — true if something is listening
port_open() {
  local port="$1"
  if command -v nc &>/dev/null; then
    nc -z 127.0.0.1 "$port" 2>/dev/null
  else
    (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null
  fi
}

# wait_for_port <port> [timeout_secs]  — simple TCP port check
wait_for_port() {
  local port="$1"; local timeout="${2:-15}"; local i=0
  while ! port_open "$port" && (( i < timeout * 2 )); do
    sleep 0.5; (( i++ ))
  done
  port_open "$port"
}

# wait_for_ready <port> [timeout_secs]  — polls /health/ready endpoint
wait_for_ready() {
  local port="$1"; local timeout="${2:-15}"; local i=0
  local url="http://127.0.0.1:${port}/health/ready"
  while (( i < timeout * 2 )); do
    if curl -sf "$url" | grep -q '"ready":true' 2>/dev/null; then
      return 0
    fi
    sleep 0.5; (( i++ ))
  done
  return 1
}

# get_tunnel_url
get_tunnel_url() {
  grep -o 'https://[^ ]*\.serveousercontent\.com' "$LOG_TUNNEL" 2>/dev/null | head -1 || true
}

# needs_rebuild  — true if dist/ is older than any source file
needs_rebuild() {
  [[ "$ICADP_NO_BUILD" == "1" ]] && return 1
  [[ ! -d "$DIST_DIR" ]] && return 0
  local newest_src newest_dist
  newest_src=$(find "$SCRIPT_DIR/src" "$SCRIPT_DIR/index.html" \
    "$SCRIPT_DIR/vite.config.ts" "$SCRIPT_DIR/tailwind.config.js" \
    -newer "$DIST_DIR/index.html" 2>/dev/null | head -1)
  [[ -n "$newest_src" ]]
}

# ── BUILD ─────────────────────────────────────────────────────────────────────

cmd_build() {
  banner "Building production bundle"
  if ! command -v node &>/dev/null; then
    err "Node.js not found. Install Node >= 20."; exit 1
  fi
  if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
    info "Installing npm dependencies…"
    npm install --silent 2>&1 | tee "$LOG_BUILD"
  fi
  info "Running tsc + vite build…"
  npm run build 2>&1 | tee "$LOG_BUILD"
  ok "Build complete → dist/"
}

# ── STOP ──────────────────────────────────────────────────────────────────────

cmd_stop() {
  banner "Stopping bKG services"

  # Vite dev server
  if is_pid_running "$PID_DEV"; then
    info "Stopping Vite dev server…"
    kill_pid_file "$PID_DEV"
    ok "Dev server stopped"
  fi

  # Main serve.js
  if is_pid_running "$PID_SERVE"; then
    info "Stopping serve.js…"
    kill_pid_file "$PID_SERVE"
    ok "App server stopped"
  fi

  # Tunnel
  if is_pid_running "$PID_TUNNEL"; then
    info "Stopping tunnel…"
    kill_pid_file "$PID_TUNNEL"
    ok "Tunnel stopped"
  fi

  # Kill any stale process on the app port (belt-and-suspenders)
  if port_open "$ICADP_PORT"; then
    info "Killing stale process on port $ICADP_PORT…"
    kill_port "$ICADP_PORT"
    ok "Port $ICADP_PORT cleared"
  fi

  # Kill any lingering node serve.js processes by name
  pkill -f "node.*serve\.js" 2>/dev/null || true
  pkill -f "ssh.*serveo"     2>/dev/null || true

  echo -e "${DIM}  All bKG processes stopped.${NC}"
}

# ── START ─────────────────────────────────────────────────────────────────────

cmd_start() {
  banner "Starting bKG"

  # ── 1. Stop anything already running ───────────────────────────────────────
  info "Checking for existing processes…"
  if is_pid_running "$PID_SERVE" || port_open "$ICADP_PORT"; then
    warn "Found running instance — stopping it first."
    cmd_stop
    sleep 1
  fi

  # ── 2. Build if needed ──────────────────────────────────────────────────────
  if needs_rebuild; then
    info "Source newer than dist/ — rebuilding."
    cmd_build
  else
    ok "dist/ is up to date (skip with ICADP_NO_BUILD=1)"
  fi

  # ── 3. Verify server dir ────────────────────────────────────────────────────
  if [[ ! -f "$SCRIPT_DIR/server/serve.js" ]]; then
    err "server/serve.js not found. Is this the right directory?"
    exit 1
  fi
  if [[ ! -d "$SCRIPT_DIR/server/node_modules" ]]; then
    info "Installing server npm dependencies…"
    (cd "$SCRIPT_DIR/server" && npm install --ignore-scripts --silent)
  fi

  # ── 4. Start app server ─────────────────────────────────────────────────────
  info "Starting app server on port $ICADP_PORT…"
  PORT="$ICADP_PORT" \
  LLAMA_PORT="$ICADP_LLAMA_PORT" \
  OLLAMA_PORT="$ICADP_OLLAMA_PORT" \
    node "$SCRIPT_DIR/server/serve.js" \
      >> "$LOG_SERVE" 2>&1 &
  echo $! > "$PID_SERVE"

  if ! wait_for_ready "$ICADP_PORT" 15; then
    err "App server failed to become ready on port $ICADP_PORT"
    err "Check logs: $LOG_SERVE"
    cat "$LOG_SERVE" | tail -20 >&2
    exit 1
  fi
  ok "App server running  http://localhost:${ICADP_PORT}"

  # ── 5. Start tunnel ─────────────────────────────────────────────────────────
  local tunnel_url=""
  if [[ "$ICADP_TUNNEL" == "1" ]]; then
    if command -v ssh &>/dev/null; then
      info "Opening serveo tunnel…"
      : > "$LOG_TUNNEL"   # truncate
      ssh -o StrictHostKeyChecking=no \
          -o ServerAliveInterval=30 \
          -o TCPKeepAlive=yes \
          -o ExitOnForwardFailure=yes \
          -o ConnectTimeout=10 \
          -R "80:localhost:${ICADP_PORT}" \
          serveo.net \
          >> "$LOG_TUNNEL" 2>&1 &
      echo $! > "$PID_TUNNEL"

      # Wait up to 12 s for URL to appear
      local i=0
      while [[ -z "$tunnel_url" ]] && (( i < 24 )); do
        sleep 0.5; (( i++ ))
        tunnel_url=$(get_tunnel_url)
      done

      if [[ -n "$tunnel_url" ]]; then
        ok "Public URL  ${BOLD}${tunnel_url}${NC}"
      else
        warn "Tunnel started but URL not yet visible — check logs/tunnel.log"
      fi
    else
      warn "ssh not found — skipping tunnel. Set ICADP_TUNNEL=0 to silence this."
    fi
  fi

  # ── 6. Summary ───────────────────────────────────────────────────────────────
  echo ""
  echo -e "  ${BOLD}bKG is running${NC}"
  echo -e "  ${DIM}Local  :${NC}  http://localhost:${ICADP_PORT}"
  echo -e "  ${DIM}Admin  :${NC}  http://localhost:${ICADP_PORT}/admin"
  [[ -n "$tunnel_url" ]] && echo -e "  ${DIM}Public :${NC}  ${BOLD}${tunnel_url}${NC}"
  echo -e "  ${DIM}Logs   :${NC}  .bkg/logs/"
  echo ""
  echo -e "  ${DIM}Stop with: ./icadp.sh stop${NC}"
}

# ── DEV ───────────────────────────────────────────────────────────────────────

cmd_dev() {
  banner "Starting bKG (development mode)"

  # Kill any existing instance
  if is_pid_running "$PID_DEV" || is_pid_running "$PID_SERVE"; then
    warn "Found running instance — stopping first."
    cmd_stop; sleep 1
  fi

  local dev_port="${ICADP_DEV_PORT:-5173}"

  info "Starting Vite dev server on port ${dev_port}…"
  npm run dev -- --host 0.0.0.0 --port "$dev_port" \
    >> "$LOG_DEV" 2>&1 &
  echo $! > "$PID_DEV"

  if ! wait_for_port "$dev_port" 15; then
    err "Vite dev server failed to start"
    exit 1
  fi
  ok "Dev server  http://localhost:${dev_port}"

  # Tunnel (dev)
  if [[ "$ICADP_TUNNEL" == "1" ]] && command -v ssh &>/dev/null; then
    info "Opening tunnel for dev server…"
    : > "$LOG_TUNNEL"
    ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 \
        -o TCPKeepAlive=yes -R "80:localhost:${dev_port}" \
        serveo.net >> "$LOG_TUNNEL" 2>&1 &
    echo $! > "$PID_TUNNEL"
    sleep 6
    local url; url=$(get_tunnel_url)
    [[ -n "$url" ]] && ok "Public URL  ${BOLD}${url}${NC}" \
                     || warn "Tunnel URL not yet visible — see logs/tunnel.log"
  fi
}

# ── STATUS ────────────────────────────────────────────────────────────────────

cmd_status() {
  banner "bKG — Status"

  # App server
  if is_pid_running "$PID_SERVE"; then
    local pid; pid=$(cat "$PID_SERVE")
    ok  "App server   running  (PID ${pid})  http://localhost:${ICADP_PORT}"
  elif port_open "$ICADP_PORT"; then
    warn "App server   port ${ICADP_PORT} is in use (not managed by this script)"
  else
    err "App server   stopped"
  fi

  # Dev server
  if is_pid_running "$PID_DEV"; then
    local pid; pid=$(cat "$PID_DEV")
    ok  "Dev server   running  (PID ${pid})"
  fi

  # Tunnel
  if is_pid_running "$PID_TUNNEL"; then
    local pid; pid=$(cat "$PID_TUNNEL")
    local url; url=$(get_tunnel_url)
    if [[ -n "$url" ]]; then
      ok  "Tunnel       running  (PID ${pid})"
      echo -e "             ${BOLD}${url}${NC}"
    else
      ok  "Tunnel       running  (PID ${pid})  — URL pending"
    fi
  else
    info "Tunnel       stopped"
  fi

  # llama-cpp (optional, started via Admin)
  if port_open "$ICADP_LLAMA_PORT"; then
    ok  "llama-cpp    running  :${ICADP_LLAMA_PORT}"
  else
    info "llama-cpp    stopped  :${ICADP_LLAMA_PORT}"
  fi

  # Ollama (optional)
  if port_open "$ICADP_OLLAMA_PORT"; then
    ok  "Ollama       running  :${ICADP_OLLAMA_PORT}"
  else
    info "Ollama       stopped  :${ICADP_OLLAMA_PORT}"
  fi

  echo ""
  echo -e "  ${DIM}Logs: .bkg/logs/{serve,tunnel,dev,build}.log${NC}"
}

# ── LOGS ──────────────────────────────────────────────────────────────────────

cmd_logs() {
  local which="${1:-all}"
  case "$which" in
    serve)  tail -f "$LOG_SERVE" ;;
    tunnel) tail -f "$LOG_TUNNEL" ;;
    dev)    tail -f "$LOG_DEV" ;;
    build)  tail -f "$LOG_BUILD" ;;
    all)
      echo -e "${DIM}Tailing all logs (Ctrl+C to stop)…${NC}"
      tail -f "$LOG_SERVE" "$LOG_TUNNEL" "$LOG_DEV" 2>/dev/null
      ;;
    *)
      err "Unknown log: $which  (serve|tunnel|dev|build|all)"
      exit 1
      ;;
  esac
}

# ── RESTART ───────────────────────────────────────────────────────────────────

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

# ── HELP ──────────────────────────────────────────────────────────────────────

cmd_help() {
  cat <<EOF

${BOLD}bKG — Process Manager${NC}

  ${CYAN}./icadp.sh start${NC}       Build (if needed) and start app + tunnel
  ${CYAN}./icadp.sh stop${NC}        Stop all bKG processes
  ${CYAN}./icadp.sh restart${NC}     Stop then start
  ${CYAN}./icadp.sh status${NC}      Show running services and public URL
  ${CYAN}./icadp.sh build${NC}       Rebuild production bundle only
  ${CYAN}./icadp.sh dev${NC}         Start Vite dev server (hot-reload)
  ${CYAN}./icadp.sh logs${NC}        Tail all log files
  ${CYAN}./icadp.sh logs serve${NC}  Tail a specific log (serve|tunnel|dev|build)

${BOLD}Configuration (.bkg.env):${NC}
  ICADP_PORT=4000          App server port
  ICADP_LLAMA_PORT=8001    llama-cpp inference server port
  ICADP_OLLAMA_PORT=11434  Ollama port
  ICADP_TUNNEL=1           1 = open serveo tunnel, 0 = skip
  ICADP_NO_BUILD=0         1 = skip rebuild check on start

${BOLD}Examples:${NC}
  ./icadp.sh start                          # production
  ICADP_TUNNEL=0 ./icadp.sh start          # no public tunnel
  ICADP_NO_BUILD=1 ./icadp.sh restart      # restart, skip build
  ./icadp.sh dev                            # dev with hot-reload
  ./icadp.sh logs serve                     # tail server logs

EOF
}

# ── ENTRYPOINT ────────────────────────────────────────────────────────────────

CMD="${1:-help}"
shift || true

case "$CMD" in
  start)    cmd_start   "$@" ;;
  stop)     cmd_stop    "$@" ;;
  restart)  cmd_restart "$@" ;;
  status)   cmd_status  "$@" ;;
  build)    cmd_build   "$@" ;;
  dev)      cmd_dev     "$@" ;;
  logs)     cmd_logs    "$@" ;;
  help|-h|--help) cmd_help ;;
  *)
    err "Unknown command: $CMD"
    cmd_help
    exit 1
    ;;
esac
