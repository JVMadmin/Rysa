#!/usr/bin/env bash
# Despliegue reproducible de RYSA en VPS desde cero.
#
# Uso:
#   ./scripts/deploy.sh                   # pull + backup + build + up + cadena completa
#   ./scripts/deploy.sh --no-cache       # build --no-cache (limpio total)
#   ./scripts/deploy.sh --skip-build     # solo pull + up (build anterior)
#   ./scripts/deploy.sh --check         # solo diagnóstico
#   ./scripts/deploy.sh --no-backup     # saltarse backup (deploys rápidos)
#   ./scripts/deploy.sh --ref <commit>  # despliega EXACTAMENTE ese commit/tag/rama
#
# Regla: producción solo corre código que está en git. Nada de `docker cp`:
# el paso 7b compara el código del contenedor contra el commit desplegado y
# falla si hay deriva.
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
DEPLOY_REF=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-cache)  NO_CACHE=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --check) CHECK_ONLY=1 ;;
    --no-backup) NO_BACKUP=1 ;;
    --ref)
      [[ -n "${2:-}" ]] || { echo "--ref requiere un commit/tag/rama" >&2; exit 2; }
      DEPLOY_REF="$2"; shift ;;
    -h|--help)
      grep '^#' "$0" | head -n 25
      exit 0
      ;;
    *) echo "Argumento no reconocido: $1" >&2; exit 2 ;;
  esac
  shift
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

# Cargar .env.docker sin `source`: el formato env_file de Docker no usa
# comillas, y valores con & ; ) ' (contraseñas) romperían o ejecutarían
# código al interpretarse como bash.
while IFS= read -r line; do
  [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue
  export "${line%%=*}=${line#*=}"
done < <(tr -d '\r' < .env.docker)

# Disco libre (necesario para builds y backups)
AVAIL_KB=$(df -P "$ROOT" | tail -1 | awk '{print $4}')
AVAIL_GB=$((AVAIL_KB / 1024 / 1024))
log "Espacio libre: ${AVAIL_GB} GB"
[[ "$AVAIL_GB" -lt 2 ]] && { err "menos de 2 GB libres; abortando"; exit 1; }

# Validaciones producción
if [[ "${ENVIRONMENT:-development}" == "production" ]]; then
  require_env ADMIN_EMAIL
  require_env ADMIN_PASSWORD
  require_env DATABASE_URL
  [[ "${ADMIN_PASSWORD}" == "<"*">"* || ${#ADMIN_PASSWORD} -lt 12 ]] && { err "ADMIN_PASSWORD placeholder o <12"; exit 1; }
  [[ "${JWT_SECRET}" == "<"*">"* || ${#JWT_SECRET} -lt 32 ]] && { err "JWT_SECRET placeholder o <32"; exit 1; }
  [[ "${POSTGRES_PASSWORD}" == "<"*">"* ]] && { err "POSTGRES_PASSWORD placeholder"; exit 1; }
  # En producción, no usar rysa_dev en la BD canónica (DATABASE_URL).
  if [[ "${DATABASE_URL:-}" == *"rysa_dev"* ]]; then
    err "================================================================"
    err "ERROR: Production environment cannot use database rysa_dev."
    err "       Expected production database: rysa_prod."
    err "       Fix: edita .env.docker y cambia DATABASE_URL a .../rysa_prod"
    err "================================================================"
    exit 1
  fi
  # Validar que la BD objetivo sea la correcta
  PROD_DB="$(echo "${DATABASE_URL}" | sed -E 's|.*/||' | cut -d'?' -f1)"
  if [[ "$PROD_DB" != "rysa_prod" ]]; then
    err "================================================================"
    err "ERROR: Production database is '$PROD_DB' but must be 'rysa_prod'."
    err "       Fix: edita .env.docker y cambia DATABASE_URL a .../rysa_prod"
    err "================================================================"
    exit 1
  fi
  ok "DATABASE_URL apunta a rysa_prod (producción)"
  # Herramientas destructivas apagadas en producción.
  case "${DEVELOPER_MODE:-}" in
    false|0|off|no) ;;
    *) err "DEVELOPER_MODE debe ser 'false' en producción (actual: '${DEVELOPER_MODE:-<vacío>}')"; exit 1 ;;
  esac
  # La migración legacy SÍ se usa en producción (rol admin_desarrollador +
  # frase de confirmación + lote reversible). Solo se avisa para no olvidarla.
  if [[ "${LEGACY_MIGRATION_ENABLED:-false}" == "true" ]]; then
    log "AVISO: LEGACY_MIGRATION_ENABLED=true (importación legacy disponible); apágalo al terminar la migración"
  fi
  # El stack nunca se publica fuera de loopback (el nginx del host da TLS).
  if [[ "${NGINX_BIND:-127.0.0.1}" != "127.0.0.1" ]]; then
    err "NGINX_BIND=${NGINX_BIND} expone la app sin TLS; usa 127.0.0.1"; exit 1
  fi
  ok "Modo producción: DEVELOPER_MODE=false, legacy apagado, nginx solo en loopback"
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
  [[ -f "$ROOT/scripts/backup.sh" ]] || { err "Falta scripts/backup.sh"; exit 1; }
  bash "$ROOT/scripts/backup.sh" || { err "backup falló; no se despliega sin respaldo"; exit 1; }
  ok "Backup completado"
fi

# ============ 4) Pull + build ====================================
if [[ -z "$CHECK_ONLY" ]]; then
  step "4) Pull + build"
  if [[ -z "$SKIP_BUILD" ]]; then
    if [[ -n "$DEPLOY_REF" ]]; then
      log "git fetch + checkout $DEPLOY_REF..."
      git fetch --tags origin || { err "git fetch falló"; exit 1; }
      git checkout --detach "$DEPLOY_REF" 2>/dev/null \
        || git checkout --detach "origin/$DEPLOY_REF" \
        || { err "No existe la referencia $DEPLOY_REF"; exit 1; }
    else
      log "git pull..."
      git pull --ff-only || { err "git pull falló (revisar conflictos)"; exit 1; }
    fi
    DEPLOYED_COMMIT="$(git rev-parse HEAD)"
    log "Commit a desplegar: $DEPLOYED_COMMIT"
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
    # Contenedores con nombre fijo (container_name: rysa_<servicio>).
    state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' \
      "rysa_$svc" 2>/dev/null || echo "")
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
if [[ -f "$ROOT/backend/scripts/check_installation.py" ]]; then
  docker compose exec -T backend python /app/scripts/check_installation.py || {
    err "DEPLOY FAILED en check_installation.py"
    exit 1
  }
fi

# ============ 7b) Deriva: el contenedor corre EXACTAMENTE el commit =====
step "7b) Verificación de deriva (contenedor vs git)"
DRIFT=0
while IFS= read -r f; do
  rel="${f#backend/}"
  want=$(md5sum "$f" | cut -c1-32)
  have=$(docker exec rysa_backend md5sum "/app/$rel" 2>/dev/null | cut -c1-32 || true)
  if [[ "$want" != "$have" ]]; then
    err "Deriva en $rel (git=$want contenedor=${have:-ausente})"; DRIFT=1
  fi
done < <(git ls-files 'backend/*.py' | grep -v '^backend/tests/')
[[ "$DRIFT" -eq 0 ]] || { err "DEPLOY FAILED: el contenedor no coincide con git"; exit 1; }
ok "Código del backend idéntico al commit $(git rev-parse --short HEAD)"
if [[ -z "$CHECK_ONLY" ]]; then
  {
    echo "commit=$(git rev-parse HEAD)"
    echo "fecha=$(date -Iseconds)"
    echo "usuario=$(whoami)"
  } > "$ROOT/.deployed"
fi

# ============ 8) Smoke tests (test_all.sh) =====================
step "8) Smoke tests"
# Sin login: un smoke test con ADMIN_PASSWORD fallaría si el admin cambió su
# contraseña en la UI y sumaría intentos al rate limit de login.
BASE="http://127.0.0.1:${NGINX_HTTP_PORT:-8080}"
smoke() {  # smoke <descripción> <url> <código esperado>
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$2" 2>/dev/null) || true
  code="${code:-000}"; code="${code:0:3}"
  if [[ "$code" == "$3" ]]; then ok "$1 ($code)"; else err "$1: esperado $3, obtuvo $code"; return 1; fi
}
SMOKE_FAIL=0
smoke "Backend /health"        "$BASE/health" 200               || SMOKE_FAIL=1
smoke "Base de datos"          "$BASE/api/health/db" 200        || SMOKE_FAIL=1
smoke "Frontend (SPA)"         "$BASE/" 200                     || SMOKE_FAIL=1
smoke "API protegida sin token" "$BASE/api/auth/me" 401         || SMOKE_FAIL=1
MAIN_JS=$(curl -s --max-time 10 "$BASE/" | grep -oE '/static/js/main\.[a-f0-9]+\.js' | head -1 || true)
if [[ -n "$MAIN_JS" ]]; then
  smoke "Source map no publicado" "$BASE${MAIN_JS}.map" 404     || SMOKE_FAIL=1
fi
RUN_ENV=$(docker exec rysa_backend printenv ENVIRONMENT 2>/dev/null || true)
if [[ "$RUN_ENV" == "${ENVIRONMENT:-}" ]]; then ok "Backend corre con ENVIRONMENT=$RUN_ENV"
else err "Backend corre con ENVIRONMENT='$RUN_ENV' (esperado '${ENVIRONMENT:-}')"; SMOKE_FAIL=1; fi
[[ "$SMOKE_FAIL" -eq 0 ]] || { err "DEPLOY FAILED en smoke tests"; exit 1; }
if [[ "${RUN_SMOKE_AUTH:-0}" == "1" && -f "$ROOT/scripts/test_all.sh" ]]; then
  bash "$ROOT/scripts/test_all.sh" || { err "DEPLOY FAILED en test_all.sh"; exit 1; }
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
