#!/usr/bin/env bash
# Despliegue reproducible de RYSA en VPS.
#
# Uso:
#   ./scripts/deploy.sh                   # pull + build + up
#   ./scripts/deploy.sh --no-cache       # build --no-cache (limpio total)
#   ./scripts/deploy.sh --skip-build     # solo pull + up (build anterior)
#   ./scripts/deploy.sh --check          # solo corre el diagnóstico
#
# Variables de entorno esperadas en .env (NUNCA commitearlo):
#   POSTGRES_PASSWORD, JWT_SECRET, ADMIN_PASSWORD, BACKEND_DATABASE_URL
#
# El script se detiene si un paso crítico falla. NO borra datos.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NO_CACHE=""
SKIP_BUILD=""
CHECK_ONLY=""
for arg in "$@"; do
  case "$arg" in
    --no-cache) NO_CACHE=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help)
      grep '^#' "$0" | head -n 20
      exit 0
      ;;
    *) echo "Argumento no reconocido: $arg" >&2; exit 2 ;;
  esac
done

log() { printf "\033[1;34m[deploy]\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m[deploy]\033[0m %s\n" "$*" >&2; }
ok() { printf "\033[1;32m[deploy]\033[0m %s\n" "$*"; }

require_file() {
  if [[ ! -f "$1" ]]; then
    err "Falta archivo requerido: $1"
    err "Cópialo desde $1.example si aplica, o créalo antes de desplegar."
    exit 1
  fi
}

# 1) Pre-chequeos
require_file .env.docker
require_file backend/alembic.ini

if ! command -v docker >/dev/null 2>&1; then
  err "docker no instalado. Instala Docker Engine + Compose v2."
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  err "docker compose v2 no disponible (requiere Docker reciente)."
  exit 1
fi

# 2) Pull + build
if [[ -n "$CHECK_ONLY" ]]; then
  log "Solo diagnóstico (--check). Levantando contenedores si hace falta..."
elif [[ -n "$SKIP_BUILD" ]]; then
  log "Saltando build (--skip-build)"
  log "git pull..."
  git pull --ff-only
else
  log "git pull..."
  git pull --ff-only
  log "docker compose build ${NO_CACHE:+--no-cache}"
  if [[ -n "$NO_CACHE" ]]; then
    docker compose build --no-cache
  else
    docker compose build
  fi
fi

# 3) Up
if [[ -z "$CHECK_ONLY" ]]; then
  log "docker compose up -d"
  docker compose up -d

  # 4) Esperar healthcheck
  log "Esperando healthchecks..."
  for i in $(seq 1 60); do
    STATE=$(docker compose ps --format json 2>/dev/null | python3 -c "
import json, sys
states = {}
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        states[d.get('Service','?')] = d.get('Health','')
    except: pass
print(' '.join(f\"{k}={v}\" for k,v in states.items()))
" 2>/dev/null || echo "")
    if echo "$STATE" | grep -qE 'unhealthy|starting' && ! echo "$STATE" | grep -q 'starting'; then
      err "Algún contenedor unhealthy: $STATE"
      exit 1
    fi
    if echo "$STATE" | grep -q 'unhealthy'; then
      err "Contenedor unhealthy: $STATE"
      exit 1
    fi
    # Healthy si no hay 'starting' en ningun servicio requerido
    if ! echo "$STATE" | grep -qE '(starting|unhealthy)'; then
      ok "Todos los servicios están healthy: $STATE"
      break
    fi
    sleep 5
  done
fi

# 5) Diagnóstico
log "Ejecutando diagnóstico de instalación..."
docker compose exec -T backend python /app/scripts/check_installation.py
RC=$?

if [[ $RC -ne 0 ]]; then
  err "Diagnóstico reportó problemas. Revisa arriba."
  exit $RC
fi

ok "Despliegue OK."
