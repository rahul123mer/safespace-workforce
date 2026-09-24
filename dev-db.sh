#!/usr/bin/env bash
# Local development PostgreSQL for SafeSpace Workforce (not for production).
#
#   ./dev-db.sh start    create (first run) and start the local cluster on 127.0.0.1:55432
#   ./dev-db.sh stop     stop it
#   ./dev-db.sh status
#
# Data lives in .devdata/pgdata (git-ignored). Local connections only, no password.
# Connection URL: postgresql+psycopg://ems@127.0.0.1:55432/workforce

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="$ROOT/.devdata/pgdata"
LOG="$ROOT/.devdata/postgres.log"
PORT="${DEV_DB_PORT:-55432}"

PGBIN=""
if command -v pg_ctl >/dev/null 2>&1; then
  PGBIN="$(dirname "$(command -v pg_ctl)")"
else
  for d in /c/Program\ Files/PostgreSQL/*/bin /usr/lib/postgresql/*/bin; do
    [[ -x "$d/pg_ctl" || -x "$d/pg_ctl.exe" ]] && PGBIN="$d"
  done
fi
[[ -n "$PGBIN" ]] || { echo "PostgreSQL binaries (pg_ctl, initdb) were not found. Install PostgreSQL 14+." >&2; exit 1; }

running() { "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; }

case "${1:-start}" in
  start)
    if [[ ! -f "$DATA/PG_VERSION" ]]; then
      echo "Creating local database cluster in $DATA ..."
      mkdir -p "$ROOT/.devdata"
      "$PGBIN/initdb" -D "$DATA" -U ems --auth=trust -E UTF8 >/dev/null
    fi
    if running; then echo "Local database already running on port $PORT."; else
      # Output is redirected so the server does not hold this terminal open (Windows).
      "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -h 127.0.0.1" -l "$LOG" start >/dev/null 2>&1 &
      for _ in $(seq 1 30); do running && break; sleep 1; done
      running || { echo "The database did not start; see $LOG" >&2; exit 1; }
      echo "Local database running on 127.0.0.1:$PORT."
    fi
    for _ in $(seq 1 15); do "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" -q && break; sleep 1; done
    if ! "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U ems -d postgres -tAc "select 1 from pg_database where datname='workforce'" | grep -q 1; then
      "$PGBIN/createdb" -h 127.0.0.1 -p "$PORT" -U ems workforce
      echo "Created database 'workforce'."
    fi
    ;;
  stop)
    if running; then "$PGBIN/pg_ctl" -D "$DATA" stop -m fast >/dev/null && echo "Local database stopped."; else echo "Local database is not running."; fi
    ;;
  status)
    if running; then echo "Running on 127.0.0.1:$PORT"; else echo "Stopped"; fi
    ;;
  *) echo "Usage: $0 start|stop|status" >&2; exit 2 ;;
esac
