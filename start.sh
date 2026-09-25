#!/usr/bin/env bash
# Starts SafeSpace Workforce: database migrations, backend API, recognition worker
# and frontend, in one terminal. Ctrl+C stops everything.
#
#   ./start.sh                 development: API :8030, worker, Vite dev server :5180
#   ./start.sh prod            production: builds the frontend, API serves it on :8030, worker
#   ./start.sh --no-worker     skip the recognition worker (e.g. on a machine without the pipeline)
#
# PostgreSQL must already be running; this script checks it but does not start it.
# Configuration comes from backend/.env (copy backend/.env.example) or EMS_* variables.
# Works on Linux/macOS and in Git Bash on Windows.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
API_HOST="${API_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-8030}"
MODE="dev"
RUN_WORKER=1

for arg in "$@"; do
  case "$arg" in
    prod|production) MODE="prod" ;;
    dev|development) MODE="dev" ;;
    --no-worker) RUN_WORKER=0 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (use --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1;34m[start]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[start]\033[0m %s\n' "$*" >&2; exit 1; }

# --- Python environment ------------------------------------------------------
if [[ -x "$BACKEND/.venv/bin/python" ]]; then
  PY="$BACKEND/.venv/bin/python"
elif [[ -x "$BACKEND/.venv/Scripts/python.exe" ]]; then
  PY="$BACKEND/.venv/Scripts/python.exe"
else
  say "Creating the backend virtual environment..."
  # First interpreter that is 3.11+ (on Windows `python3` may be an older Microsoft Store Python).
  SYS_PY=""
  for cand in python3.12 python3.11 python3 python py; do
    p="$(command -v "$cand" || true)"
    [[ -n "$p" ]] && "$p" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null && { SYS_PY="$p"; break; }
  done
  [[ -n "$SYS_PY" ]] || fail "Python 3.11+ is required but was not found."
  "$SYS_PY" -m venv "$BACKEND/.venv"
  if [[ -x "$BACKEND/.venv/bin/python" ]]; then PY="$BACKEND/.venv/bin/python"; else PY="$BACKEND/.venv/Scripts/python.exe"; fi
  "$PY" -m pip install --quiet --upgrade pip
  "$PY" -m pip install --quiet -e "$BACKEND"
fi
"$PY" -c "import employee_api" 2>/dev/null || { say "Installing backend dependencies..."; "$PY" -m pip install --quiet -e "$BACKEND"; }

# --- Configuration and database -----------------------------------------------
if [[ ! -f "$BACKEND/.env" && -z "${EMS_DATABASE_URL:-}" ]]; then
  fail "No configuration found. Copy backend/.env.example to backend/.env and set EMS_DATABASE_URL."
fi

say "Checking the database connection..."
( cd "$BACKEND" && "$PY" - <<'EOF'
import sys
from sqlalchemy import text
from employee_api.db import get_engine
try:
    with get_engine().connect() as c:
        c.execute(text("select 1"))
except Exception as exc:
    print(f"Database unavailable: {exc.__class__.__name__}: {str(exc).splitlines()[0]}", file=sys.stderr)
    sys.exit(1)
EOF
) || fail "PostgreSQL is not reachable. Start it and check EMS_DATABASE_URL."

say "Applying database migrations..."
( cd "$BACKEND" && "$PY" -m alembic upgrade head ) || fail "Database migration failed."

if [[ "$RUN_WORKER" == 1 ]]; then
  ( cd "$BACKEND" && "$PY" -m employee_api.cli pipeline-status ) | "$PY" -c \
    "import json,sys; d=json.load(sys.stdin); print('[start] Recognition pipeline:', 'available' if d['available'] else 'NOT available - ' + ' '.join(d['problems']))"
fi

# --- Frontend -----------------------------------------------------------------
command -v npm >/dev/null || fail "Node.js 20+ and npm are required but npm was not found."
if [[ ! -d "$FRONTEND/node_modules" ]]; then
  say "Installing frontend dependencies..."
  ( cd "$FRONTEND" && npm ci --no-audit --no-fund )
fi

if [[ "$MODE" == "prod" ]]; then
  say "Building the frontend..."
  ( cd "$FRONTEND" && npm run build )
  export EMS_FRONTEND_DIST_DIR="$FRONTEND/dist"
fi

# --- Start processes ----------------------------------------------------------
# A leftover API from an earlier run would keep answering with old code.
if "$PY" -c "import socket,sys; s=socket.socket(); s.settimeout(1); sys.exit(0 if s.connect_ex(('$API_HOST', $API_PORT)) == 0 else 1)"; then
  fail "Port $API_PORT is already in use (an API from an earlier run may still be running). Stop it, or set API_PORT."
fi

PIDS=()
cleanup() {
  trap - INT TERM EXIT
  say "Stopping..."
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  # Git Bash on Windows: make sure the native processes are gone too.
  if command -v taskkill >/dev/null 2>&1; then
    for pid in "${PIDS[@]}"; do
      winpid="$(cat /proc/$pid/winpid 2>/dev/null || true)"
      [[ -n "$winpid" ]] && taskkill //F //T //PID "$winpid" >/dev/null 2>&1 || true
    done
  fi
  say "All services stopped."
}
trap cleanup INT TERM EXIT

run() {  # run <label> <color> <dir> <command...>
  local label="$1" color="$2" dir="$3"; shift 3
  ( cd "$dir" && exec "$@" ) > >(while IFS= read -r line; do printf '\033[%sm[%s]\033[0m %s\n' "$color" "$label" "$line"; done) 2>&1 &
  PIDS+=("$!")
}

API_ARGS=(-m uvicorn employee_api.main:app --host "$API_HOST" --port "$API_PORT")
if [[ "$MODE" == "dev" ]]; then API_ARGS+=(--reload --reload-dir employee_api); else API_ARGS+=(--proxy-headers); fi

say "Starting API on http://$API_HOST:$API_PORT ..."
run api "1;32" "$BACKEND" "$PY" "${API_ARGS[@]}"

if [[ "$RUN_WORKER" == 1 ]]; then
  say "Starting recognition worker..."
  run worker "1;35" "$BACKEND" "$PY" -m employee_api.worker
fi

if [[ "$MODE" == "dev" ]]; then
  say "Starting frontend on http://localhost:5180 ..."
  run web "1;36" "$FRONTEND" npx vite --port 5180 --strictPort
  URL="http://localhost:5180"
else
  URL="http://$API_HOST:$API_PORT"
fi

# Wait for the API, then announce.
for _ in $(seq 1 30); do
  if "$PY" -c "import urllib.request; urllib.request.urlopen('http://$API_HOST:$API_PORT/api/v1/health', timeout=1)" 2>/dev/null; then
    say "Ready: open $URL   (Ctrl+C to stop)"
    break
  fi
  sleep 1
done

# Stop everything as soon as any service exits.
wait -n "${PIDS[@]}" || true
say "A service exited; shutting down the others."
