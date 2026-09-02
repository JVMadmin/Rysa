#!/usr/bin/env bash
# Despliegue reproducible de RYSA en VPS desde cero.
#
# Uso:
#   ./scripts/deploy.sh                   # pull + build + up + verificación completa
#   ./scripts/deploy.sh --no-cache       # build --no-cache (limpio total)
#   ./scripts/deploy.sh --skip-build     # solo pull + up (build anterior)
#   ./scripts/deploy.sh --check         # solo diagnóstico (sin redeploy)
#
# Variables de entorno esperadas en .env.docker (NUNCA commitearlo):
#   POSTGRES_PASSWORD, JWT_SECRET, ADMIN_PASSWORD, BACKEND_DATABASE_URL
#   DOMAIN, LETSENCRYPT_EMAIL           -> para HTTPS automático con Traefik
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

log()  { printf "\033[1;34m[deploy]\033[0m %s\n" "$*"; }
err()  { printf "\033[1;31m[deploy]\033[0m %s\n" "$*" >&2; }
ok()   { printf "\033[1;32m[deploy]\033[0m %s\n" "$*"; }
step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }

require_file() {
  if [[ ! -f "$1" ]]; then
    err "Falta archivo requerido: $1"
    err "Cópialo desde $1.example si aplica, o créalo antes de desplegar."
    exit 1
  fi
}

require_env() {
  if [[ -z "${!1:-}" ]]; then
    err "Variable $1 no definida en .env.docker"
    err "Añádela y re-ejecuta el deploy."
    exit 1
  fi
}

# 1) Pre-chequeos
step "1) Pre-chequeos"
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

# Cargar .env.docker para validaciones locales (sin exportar secretos al log)
set -a
# shellcheck disable=SC1091
source .env.docker
set +a

# Para producción exige dominio
if [[ "${ENVIRONMENT:-development}" == "production" ]]; then
  require_env ADMIN_EMAIL
  require_env ADMIN_PASSWORD
  if [[ "${ADMIN_PASSWORD}" == "<"*">"* || ${#ADMIN_PASSWORD} -lt 12 ]]; then
    err "ADMIN_PASSWORD debe tener al menos 12 caracteres y no ser placeholder."
    exit 1
  fi
  if [[ "${JWT_SECRET}" == "<"*">"* || ${#JWT_SECRET} -lt 32 ]]; then
    err "JWT_SECRET debe tener al menos 32 caracteres y no ser placeholder."
    exit 1
  fi
fi

# 2) Pull + build
if [[ -n "$CHECK_ONLY" ]]; then
  log "Solo diagnóstico (--check)"
else
  step "2) Pull + build"
  if [[ -n "$SKIP_BUILD" ]]; then
    log "Saltando build (--skip-build)"
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
  step "3) docker compose up -d"
  docker compose up -d
fi

# 4) Esperar healthchecks (cadena completa)
step "4) Esperando cadena de healthchecks"

wait_healthy() {
  local svc="$1"
  local timeout="${2:-180}"
  log "Esperando $svc healthy (timeout ${timeout}s)..."
  for ((i=0; i<timeout; i+=5)); do
    local state
    state=$(docker compose ps --format json 2>/dev/null | \
      python3 -c "import json,sys
for line in sys.stdin:
  line=line.strip()
  if not line: continue
  try: d=json.loads(line)
  except: continue
  if d.get('Service')=='$svc': print(d.get('Health','')); break" 2>/dev/null || echo "")
    if [[ "$state" == "healthy" ]]; then
      ok "$svc healthy"
      return 0
    fi
    if [[ "$state" == "unhealthy" ]]; then
      err "$svc unhealthy — revisa: docker compose logs $svc --tail=50"
      return 1
    fi
    sleep 5
  done
  err "$svc NO quedó healthy en ${timeout}s (estado final: $state)"
  docker compose logs "$svc" --tail=30 || true
  return 1
}

wait_healthy postgres 120
wait_healthy backend  180
wait_healthy frontend 60
wait_healthy nginx    90

# 5) Verificar respuesta del stack a través del host (HTTPS si hay dominio)
step "5) Verificar respuesta pública"
if [[ "${ENVIRONMENT:-development}" == "production" && -n "${DOMAIN:-}" ]]; then
  log "Esperando que ${DOMAIN} responda (HTTPS, puede tardar 1-2 min tras el cert)..."
  for ((i=0; i<60; i+=5)); do
    if curl -fsSL --max-time 5 "https://${DOMAIN}/health" >/dev/null 2>&1; then
      ok "HTTPS ${DOMAIN}/health responde"
      break
    fi
    if curl -fsSL --max-time 5 "http://${DOMAIN}/health" >/dev/null 2>&1; then
      log "  HTTP responde, falta TLS (revisar Certbot en host)"
      break
    fi
    log "  esperando... ($((i+5))s)"
    sleep 5
  done
  if ! curl -fsS --max-time 5 "http://${DOMAIN}/health" >/dev/null 2>&1 && \
     ! curl -fsSL --max-time 5 "https://${DOMAIN}/health" >/dev/null 2>&1; then
    err "${DOMAIN} no responde. Verifica:"
    err "  1) DNS del dominio apunta a este VPS"
    err "  2) nginx nativo del host está activo y hace proxy_pass a localhost:${NGINX_HTTP_PORT:-8080}"
    err "  3) Certbot emitió el certificado (sudo certbot certificates)"
    err "  4) Firewall abre 80 y 443"
    exit 1
  fi
else
  ok "Sin DOMAIN: solo se valida el stack interno (http://localhost:${NGINX_HTTP_PORT:-8080}/health)"
  if ! curl -fsS --max-time 5 "http://localhost:${NGINX_HTTP_PORT:-8080}/health" >/dev/null 2>&1; then
    err "El stack no responde en localhost:${NGINX_HTTP_PORT:-8080}."
    err "Comprueba: docker compose ps y docker compose logs nginx --tail=50"
    exit 1
  fi
fi

# 6) Diagnóstico
step "6) Diagnóstico de instalación"
docker compose exec -T backend python /app/scripts/check_installation.py
RC=$?
if [[ $RC -ne 0 ]]; then
  err "Diagnóstico reportó problemas. Revisa arriba."
  exit $RC
fi

# 7) Resumen final
step "7) Resumen"
ok "RYSA desplegado correctamente."
if [[ -n "${DOMAIN:-}" ]]; then
  ok "URL pública: https://${DOMAIN}/"
  ok "Admin: ${ADMIN_EMAIL} (idempotente — vuelve a correr este script para resetear el password)"
else
  ok "Sin DOMAIN configurado: solo HTTP local en http://<host>:80"
fi
