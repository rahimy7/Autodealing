#!/usr/bin/env bash
# Start the full OmniAI stack locally: PostgreSQL + API server + frontend.
# Reads secrets from .env (gitignored). Stop everything with Ctrl+C.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# --- Load .env -------------------------------------------------------------
if [ ! -f .env ]; then
  echo "✗ Falta el archivo .env. Copia .env.example a .env y completa los valores." >&2
  exit 1
fi
set -a; . ./.env; set +a

# --- Config ----------------------------------------------------------------
API_PORT=8080
WEB_PORT=5173
PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
[ -d "$PG_BIN" ] && export PATH="$PG_BIN:$PATH"

# --- Ensure PostgreSQL is running ------------------------------------------
echo "▸ Verificando PostgreSQL…"
if ! pg_isready -q 2>/dev/null; then
  echo "  iniciando servicio postgresql@16…"
  brew services start postgresql@16 >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do pg_isready -q 2>/dev/null && break; sleep 1; done
fi
pg_isready -q 2>/dev/null && echo "  ✓ PostgreSQL listo" || { echo "  ✗ PostgreSQL no responde" >&2; exit 1; }

# Create the database if it doesn't exist yet
createdb omnicanal 2>/dev/null && echo "  ✓ base de datos 'omnicanal' creada" || true

# --- Free the ports if something is already listening ----------------------
for p in "$API_PORT" "$WEB_PORT"; do
  pids="$(lsof -ti "tcp:$p" 2>/dev/null || true)"
  if [ -n "$pids" ]; then echo "▸ Liberando puerto ${p}..."; echo "$pids" | xargs kill 2>/dev/null || true; sleep 1; fi
done

# --- Launch servers --------------------------------------------------------
cleanup() {
  echo; echo "▸ Deteniendo servidores…"
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

echo "▸ Iniciando API server (puerto $API_PORT)…"
PORT="$API_PORT" NODE_ENV=development \
  pnpm --filter @workspace/api-server run dev &
API_PID=$!

echo "▸ Iniciando frontend (puerto $WEB_PORT)…"
PORT="$WEB_PORT" BASE_PATH=/ API_PROXY_TARGET="http://localhost:$API_PORT" NODE_ENV=development \
  pnpm --filter @workspace/omnicanal run dev &
WEB_PID=$!

echo
echo "════════════════════════════════════════════════════"
echo "  OmniAI corriendo:"
echo "  • Frontend → http://localhost:$WEB_PORT"
echo "  • API      → http://localhost:$API_PORT/api"
echo "  Login admin: admin@decolor.com  /  contraseña: demo"
echo "  (Ctrl+C para detener todo)"
echo "════════════════════════════════════════════════════"

wait
