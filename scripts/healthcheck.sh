#!/usr/bin/env bash
# Healthcheck centralizado de RYSA.
#
# Comprueba:
#   - Docker daemon
#   - PostgreSQL (conectividad + espacio)
#   - Backend (health + /api/health/db)
#   - Frontend (SPA responde)
#   - Nginx interno del stack (upstream disponible)
#   - Nginx del host (HTTPS si hay dominio)
#   - API: /api/products, /api/clients (smoke)
#   - Espacio en disco (umbral: 80% ocupado = WARN)
#   - Memoria libre
#
# Salida:
#   HEALTHCHECK PASS    -> todo OK
#   HEALTHCHECK FAIL    -> hay al menos un [FAIL] (rc=1)
#   HEALTHCHECK WARN    -> todo OK pero hay warnings
#
# Uso:  /opt/rysa/repo/scripts/healthcheck.sh

set -uo pipefail

# Resolver la BD objetivo desde .env.docker o env (soporta DATABASE_URL y
# BACKEND_DATABASE_URL legacy). Ningún valor hardcoded.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_db_name.sh
. "$SCRIPT_DIR/_db_name.sh"
DB_NAME="$(rysa_db_name || echo "rysa_dev")"

DOMAIN="${DOMAIN:-}"
PUBLIC_URL="${PUBLIC_URL:-${DOMAIN:+https://$DOMAIN}}"
INTERNAL_URL="${INTERNAL_URL:-http://localhost:8080}"
BACKEND_URL="${BACKEND_URL:-$INTERNAL_URL}"
DISK_WARN_PCT="${DISK_WARN_PCT:-80}"
DISK_FAIL_PCT="${DISK_FAIL_PCT:-92}"
MEM_WARN_PCT="${MEM_WARN_PCT:-90}"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

pass() { printf "\033[92m[ OK ]\033[0m  %s\n" "$*"; PASS_COUNT=$((PASS_COUNT+1)); }
fail() { printf "\033[91m[FAIL]\033[0m  %s\n" "$*"; FAIL_COUNT=$((FAIL_COUNT+1)); }
warn() { printf "\033[93m[WARN]\033[0m  %s\n" "$*"; WARN_COUNT=$((WARN_COUNT+1)); }
hdr()  { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }

# ===== Docker ============================================
hdr "Docker daemon"
if ! command -v docker >/dev/null 2>&1; then
  fail "docker no instalado"
elif ! docker info >/dev/null 2>&1; then
  fail "docker daemon no responde (sudo systemctl status docker)"
else
  pass "docker $(docker --version | awk '{print $3}' | tr -d ',')"
fi

# ===== PostgreSQL ========================================
hdr "PostgreSQL (BD: $DB_NAME)"
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q rysa_postgres; then
  if docker exec rysa_postgres pg_isready -U rysa -d "$DB_NAME" >/dev/null 2>&1; then
    pass "rysa_postgres: ready (db: $DB_NAME)"
    N_USERS=$(docker exec -T rysa_postgres psql -U rysa -d "$DB_NAME" -t -A -c "SELECT count(*) FROM users" 2>/dev/null | head -1)
    [[ -n "$N_USERS" ]] && pass "BD: ${N_USERS} usuarios" || warn "BD: query SELECT count(*) users falló"
    N_SALES=$(docker exec -T rysa_postgres psql -U rysa -d "$DB_NAME" -t -A -c "SELECT count(*) FROM sales" 2>/dev/null | head -1)
    [[ -n "$N_SALES" ]] && pass "BD: ${N_SALES} ventas"
  else
    fail "rysa_postgres no responde pg_isready (db: $DB_NAME)"
  fi
else
  fail "contenedor rysa_postgres no está corriendo"
fi

# ===== Backend ===========================================
hdr "Backend (FastAPI)"
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q rysa_backend; then
  if curl -fsS --max-time 5 "$BACKEND_URL/health" >/dev/null 2>&1; then
    pass "/health OK"
  else
    fail "/health no responde ($BACKEND_URL)"
  fi
  if curl -fsS --max-time 5 "$BACKEND_URL/api/health/db" >/dev/null 2>&1; then
    pass "/api/health/db OK"
  else
    fail "/api/health/db no responde (BD inaccesible desde backend)"
  fi
else
  fail "contenedor rysa_backend no está corriendo"
fi

# ===== Frontend ==========================================
hdr "Frontend (Nginx del contenedor)"
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q rysa_frontend; then
  if docker exec rysa_frontend wget -q --spider http://127.0.0.1:80/ >/dev/null 2>&1; then
    pass "SPA responde"
  else
    fail "SPA no responde dentro del contenedor rysa_frontend"
  fi
else
  fail "contenedor rysa_frontend no está corriendo"
fi

# ===== Nginx interno del stack ==========================
hdr "Nginx interno (contenedor rysa_nginx)"
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q rysa_nginx; then
  if curl -fsS --max-time 5 "$INTERNAL_URL/health" >/dev/null 2>&1; then
    pass "http://localhost:8080/health OK"
  else
    warn "rysa_nginx no responde en $INTERNAL_URL (¿puerto distinto?)"
  fi
else
  fail "contenedor rysa_nginx no está corriendo"
fi

# ===== Nginx del host (HTTPS público) ====================
hdr "HTTPS público"
if [[ -n "$PUBLIC_URL" ]]; then
  if curl -fsS --max-time 10 "$PUBLIC_URL/health" >/dev/null 2>&1; then
    pass "$PUBLIC_URL/health OK"
    HSTS=$(curl -sI --max-time 5 "$PUBLIC_URL/" 2>/dev/null | grep -i strict-transport-security | head -1 | tr -d '\r')
    [[ -n "$HSTS" ]] && pass "HSTS presente" || warn "HSTS no presente"
    REDIR=$(curl -sI --max-time 5 "http://${DOMAIN}/" 2>/dev/null | grep -i "^location:" | tr -d '\r')
    [[ "$REDIR" == *https://* ]] && pass "HTTP→HTTPS redirige" || warn "no redirige a HTTPS"
  else
    fail "$PUBLIC_URL/health no responde"
  fi
else
  warn "DOMAIN no definido: salta la verificación pública"
fi

# ===== API smoke ==========================================
hdr "API smoke"
TOKEN=""
if command -v docker >/dev/null 2>&1 && [[ -f "${RYSA_HOME:-/opt/rysa}/repo/.env.docker" ]]; then
  # shellcheck disable=SC1091
  . "${RYSA_HOME:-/opt/rysa}/repo/.env.docker"
  if [[ -n "${ADMIN_EMAIL:-}" && -n "${ADMIN_PASSWORD:-}" ]]; then
    LOGIN=$(curl -sS --max-time 10 -H "Content-Type: application/json" \
            -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
            "$BACKEND_URL/api/auth/login" 2>/dev/null) || LOGIN=""
    TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.loads(sys.stdin.read() or '{}'); print(d.get('token',''))" 2>/dev/null || echo "")
  fi
fi
if [[ -n "$TOKEN" ]]; then
  pass "login OK"
  for endpoint in products clients sales; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -H "Authorization: Bearer $TOKEN" "$BACKEND_URL/api/$endpoint")
    [[ "$code" == "200" ]] && pass "GET /api/$endpoint -> 200" || fail "GET /api/$endpoint -> $code"
  done
else
  warn "no se pudo hacer login (credenciales no disponibles)"
fi

# ===== Espacio en disco ===================================
hdr "Recursos"
DISK_PCT=$(df -P / | tail -1 | awk '{print $5}' | tr -d '%')
if [[ "$DISK_PCT" -ge "$DISK_FAIL_PCT" ]]; then
  fail "disco ${DISK_PCT}% usado (umbral fail: ${DISK_FAIL_PCT}%)"
elif [[ "$DISK_PCT" -ge "$DISK_WARN_PCT" ]]; then
  warn "disco ${DISK_PCT}% usado (umbral warn: ${DISK_WARN_PCT}%)"
else
  pass "disco ${DISK_PCT}% usado"
fi

MEM_PCT=$(free | awk '/Mem:/ {printf "%.0f", $3/$2*100}')
if [[ "$MEM_PCT" -ge "$MEM_WARN_PCT" ]]; then
  warn "memoria ${MEM_PCT}% usada"
else
  pass "memoria ${MEM_PCT}% usada"
fi

# ===== Resumen =============================================
echo
printf "\033[1;36m══════════════════════════════════════════════\033[0m\n"
printf " PASS=%d  WARN=%d  FAIL=%d\n" "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"
printf "\033[1;36m══════════════════════════════════════════════\033[0m\n"

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo "HEALTHCHECK FAIL"
  exit 1
elif [[ $WARN_COUNT -gt 0 ]]; then
  echo "HEALTHCHECK WARN"
  exit 0
else
  echo "HEALTHCHECK PASS"
  exit 0
fi
