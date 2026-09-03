#!/usr/bin/env bash
# Despliegue reproducible de RYSA en VPS desde cero.
#
# Uso:
#   ./scripts/deploy.sh                   # pull + backup + build + up + cadena completa
#   ./scripts/deploy.sh --no-cache       # build --no-cache (limpio total)
#   ./scripts/deploy.sh --skip-build     # solo pull + up (build anterior)
#   ./scripts/deploy.sh --check         # solo diagnóstico
#   ./scripts/deploy.sh --no-backup     # saltarse backup (deploys rápidos)
#
# Variables requeridas en .env.docker:
#   POSTGRES_PASSWORD, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD (>=12)
#   ENVIRONMENT=production
#   DOMAIN, NGINX_HTTP_PORT
#
# El script se detiene si un paso crítico falla. Intenta dejar el último
# estado funcional conocido si hay rollback configurado.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NO_CACHE=""
SKIP_BUILD=""
CHECK_ONLY=""
NO_BACKUP=""
for arg in "$@"; do
  case "$arg" in
    --no-cache)  NO_CACHE=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --check) CHECK_ONLY=1 ;;
    --no-backup) NO_BACKUP=1 ;;
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

# ============ Helpers ============================================
require_file() {
  [[ -f "$1" ]] || { err "Falta $1"; exit 1; }
}
require_env() {
  [[ -n "${!1:-}" ]] || { err "Variable $1 no definida en .env.docker"; exit 1; }
}
require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "Comando requerido no instalado: $1"; exit 1; }
}

# ============ 1) Pre-chequeos ====================================
step "1) Pre-chequeos"
require_file .env.docker
require_file backend/alembic.ini
require_cmd docker
docker compose version >/dev/null 2>&1 || { err "docker compose v2 requerido"; exit 1; }

# Cargar .env.docker
set -a
# shellcheck disable=SC1090
source .env.docker
set +a

# Disco libre (necesario para builds y backups)
AVAIL_KB=$(df -P "$ROOT" | tail -1 | awk '{print $4}')
AVAIL_GB=$((AVAIL_KB / 1024 / 1024))
log "Espacio libre: ${AVAIL_GB} GB"
[[ "$AVAIL_GB" -lt 2 ]] && { err "menos de 2 GB libres; abortando"; exit 1; }

# Validaciones producción
if [[ "${ENVIRONMENT:-development}" == "production" ]]; then
  require_env ADMIN_EMAIL
  require_env ADMIN_PASSWORD
  [[ "${ADMIN_PASSWORD}" == "<"*">"* || ${#ADMIN_PASSWORD} -lt 12 ]] && { err "ADMIN_PASSWORD placeholder o <12"; exit 1; }
  [[ "${JWT_SECRET}" == "<"*">"* || ${#JWT_SECRET} -lt 32 ]] && { err "JWT_SECRET placeholder o <32"; exit 1; }
  [[ "${POSTGRES_PASSWORD}" == "<"*">"* ]] && { err "POSTGRES_PASSWORD placeholder"; exit 1; }
  # En producción, no usar rysa_dev en la URL del backend (prohibido).
  if [[ "${BACKEND_DATABASE_URL:-}" == *"rysa_dev"* ]]; then
    err "BACKEND_DATABASE_URL apunta a rysa_dev en producción. Cámbialo a rysa_prod."
    exit 1
  fi
fi

# ============ 2) Verificar git limpio y rama esperada ==========
if [[ -d .git ]]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
  log "Rama actual: $BRANCH"
  if [[ -n "$(git status --porcelain 2>/dev/null)" && "${ALLOW_DIRTY:-0}" != "1" ]]; then
    err "Hay cambios sin commitear. Commit primero o usa ALLOW_DIRTY=1."
    git status --short
    exit 1
  fi
fi

# ============ 3) Backup pre-deploy (si no es check-only) =======
if [[ -z "$CHECK_ONLY" && -z "$NO_BACKUP" ]]; then
  step "3) Backup pre-deploy"
  if [[ -x "$ROOT/scripts/backup.sh" ]]; then
    "$ROOT/scripts/backup.sh" || { err "backup falló"; exit 1; }
    ok "Backup completado"
  else
    log "scripts/backup.sh no encontrado, saltando"
  fi
fi

# ============ 4) Pull + build ====================================
if [[ -z "$CHECK_ONLY" ]]; then
  step "4) Pull + build"
  if [[ -z "$SKIP_BUILD" ]]; then
    log "git pull..."
    git pull --ff-only || { err "git pull falló (revisar conflictos)"; exit 1; }
    log "docker compose build ${NO_CACHE:+--no-cache}"
    [[ -n "$NO_CACHE" ]] && docker compose build --no-cache || docker compose build
  else
    log "Saltando build (--skip-build)"
  fi

  # ============ 5) Up ============================================
  step "5) docker compose up -d"
  docker compose up -d
fi

# ============ 6) Esperar cadena de healthchecks =================
step "6) Healthchecks de servicios"
wait_healthy() {
  local svc="$1"
  local timeout="${2:-180}"
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
    case "$state" in
      healthy) ok "$svc healthy"; return 0 ;;
      unhealthy) err "$svc unhealthy — revisa: docker compose logs $svc --tail=50"; return 1 ;;
    esac
    sleep 5
  done
  err "$svc NO quedó healthy en ${timeout}s (último estado: $state)"
  return 1
}
wait_healthy postgres 120 || { err "DEPLOY FAILED en postgres"; exit 1; }
wait_healthy backend  180 || { err "DEPLOY FAILED en backend"; exit 1; }
wait_healthy frontend 60  || { err "DEPLOY FAILED en frontend"; exit 1; }
wait_healthy nginx    90  || { err "DEPLOY FAILED en nginx"; exit 1; }

# ============ 7) Diagnóstico de instalación =====================
step "7) Diagnóstico de instalación"
if [[ -x "$ROOT/scripts/check_installation.py" ]]; then
  docker compose exec -T backend python /app/scripts/check_installation.py || {
    err "DEPLOY FAILED en check_installation.py"
    exit 1
  }
fi

# ============ 8) Smoke tests (test_all.sh) =====================
step "8) Smoke tests"
if [[ -x "$ROOT/scripts/test_all.sh" ]]; then
  "$ROOT/scripts/test_all.sh" || {
    err "DEPLOY FAILED en smoke tests"
    exit 1
  }
fi

# ============ 9) Verificación pública ==========================
step "9) Verificación pública"
if [[ "${ENVIRONMENT:-development}" == "production" && -n "${DOMAIN:-}" ]]; then
  log "Esperando que ${DOMAIN} responda..."
  for ((i=0; i<60; i+=5)); do
    if curl -fsSL --max-time 5 "https://${DOMAIN}/health" >/dev/null 2>&1; then
      ok "https://${DOMAIN}/health OK"
      break
    fi
    sleep 5
  done
  if ! curl -fsS --max-time 5 "http://${DOMAIN}/health" >/dev/null 2>&1 && \
     ! curl -fsSL --max-time 5 "https://${DOMAIN}/health" >/dev/null 2>&1; then
    err "${DOMAIN} no responde. Posible firewall/DNS/cert."
    exit 1
  fi
fi

# ============ 10) Resumen final ================================
step "10) Resumen"
ok "RYSA desplegado correctamente."
if [[ -n "${DOMAIN:-}" ]]; then
  ok "URL: https://${DOMAIN}/"
  ok "Admin: ${ADMIN_EMAIL} (idempotente)"
else
  ok "Sin DOMAIN: http://localhost:${NGINX_HTTP_PORT:-8080}/"
fi
ok "Estado: ./scripts/status.sh"
ok "Backup:  ./scripts/backup.sh"
