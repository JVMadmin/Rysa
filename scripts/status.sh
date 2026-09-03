#!/usr/bin/env bash
# Estado del despliegue RYSA: versión, commit, containers, healthcheck, uptime.
#
# Uso:  /opt/rysa/repo/scripts/status.sh

set -uo pipefail

RYSA_HOME="${RYSA_HOME:-/opt/rysa}"
RYSA_REPO="${RYSA_HOME}/repo"

GREEN="\033[92m"; YELLOW="\033[93m"; RED="\033[91m"; CYAN="\033[1;36m"; NC="\033[0m"
hr()  { printf "${CYAN}──────────────────────────────────────────────────────${NC}\n"; }
hdr() { printf "\n${CYAN}▶ %s${NC}\n" "$*"; }
ok()  { printf "  ${GREEN}●${NC} %s\n" "$*"; }
warn(){ printf "  ${YELLOW}●${NC} %s\n" "$*"; }
fail(){ printf "  ${RED}●${NC} %s\n" "$*"; }

printf "${CYAN}"
echo "╔═══════════════════════════════════════════════════════╗"
echo "║            RYSA ERP — status del despliegue          ║"
echo "╚═══════════════════════════════════════════════════════╝"
printf "${NC}\n"

# === Versión / commit / branch ====================================
hdr "Versión desplegada"
if [[ -d "$RYSA_REPO/.git" ]]; then
  cd "$RYSA_REPO"
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  COMMIT=$(git rev-parse --short HEAD 2>/dev/null)
  DATE=$(git log -1 --format=%cI 2>/dev/null)
  MSG=$(git log -1 --format=%s 2>/dev/null)
  REMOTE=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
  AHEAD=$(git rev-list --count '@{u}..HEAD' 2>/dev/null)
  BEHIND=$(git rev-list --count 'HEAD..@{u}' 2>/dev/null)
  ok "branch:   $BRANCH"
  ok "commit:   $COMMIT"
  ok "fecha:    $DATE"
  ok "msg:      $MSG"
  [[ -n "$REMOTE" && "$REMOTE" != "@{u}" ]] && ok "upstream: $REMOTE"
  [[ "${AHEAD:-0}" -gt 0 ]] && warn "local ahead de remote por $AHEAD commit(s)"
  [[ "${BEHIND:-0}" -gt 0 ]] && warn "local behind de remote por $BEHIND commit(s) — ejecuta git pull"
else
  fail "no es un repositorio git ($RYSA_REPO)"
fi
# === Containers ===================================================
hdr "Contenedores Docker"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  for c in rysa_postgres rysa_backend rysa_frontend rysa_nginx; do
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${c}$"; then
      STATE=$(docker inspect --format='{{.State.Health.Status}}' "$c" 2>/dev/null)
      UPTIME=$(docker inspect --format='{{.State.StartedAt}}' "$c" 2>/dev/null)
      [[ "$STATE" == "healthy" ]] && ok "$c: healthy (uptime $UPTIME)"
      [[ "$STATE" == "starting" ]] && warn "$c: starting (aún no healthy)"
      [[ -z "$STATE" || "$STATE" == "none" ]] && ok "$c: running (sin healthcheck)"
    else
      fail "$c: NO está corriendo"
    fi
  done
else
  fail "docker no disponible"
fi

# === Imágenes ======================================================
hdr "Imágenes Docker"
docker images --format "  {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}" 2>/dev/null | \
  grep -E "rysa-evolucion-comercial|postgres" | head -8

# === PostgreSQL ===================================================
hdr "PostgreSQL"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_db_name.sh
. "$SCRIPT_DIR/_db_name.sh"
DB_NAME="$(rysa_db_name || echo "rysa_dev")"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q rysa_postgres; then
  if docker exec rysa_postgres pg_isready -U rysa -d "$DB_NAME" >/dev/null 2>&1; then
    ok "ready (db: $DB_NAME)"
    for tbl in users clients products sales; do
      N=$(docker exec -T rysa_postgres psql -U rysa -d "$DB_NAME" -t -A -c "SELECT count(*) FROM $tbl" 2>/dev/null | head -1)
      [[ -n "$N" ]] && ok "$tbl: $N"
    done
    LEGACY_T=$(docker exec -T rysa_postgres psql -U rysa -d "$DB_NAME" -t -A -c "SELECT count(*) FROM sales WHERE doc->>'source'='LEGACY'" 2>/dev/null | head -1)
    [[ -n "$LEGACY_T" ]] && ok "ventas LEGACY: $LEGACY_T"
  else
    fail "no responde"
  fi
else
  fail "contenedor no está corriendo"
fi

# === Healthcheck centralizado =====================================
hdr "Healthcheck"
if [[ -x "$RYSA_REPO/scripts/healthcheck.sh" ]]; then
  if "$RYSA_REPO/scripts/healthcheck.sh" >/tmp/rysa_hc.log 2>&1; then
    TAIL=$(tail -1 /tmp/rysa_hc.log)
    [[ "$TAIL" == *"PASS"* || "$TAIL" == *"WARN"* ]] && ok "$TAIL" || fail "$TAIL"
  else
    fail "falló (ver /tmp/rysa_hc.log)"
    tail -8 /tmp/rysa_hc.log | sed 's/^/    /'
  fi
else
  warn "scripts/healthcheck.sh no encontrado o no ejecutable"
fi

# === HTTPS público =================================================
hdr "HTTPS"
DOMAIN="${DOMAIN:-}"
if [[ -n "$DOMAIN" ]]; then
  if curl -fsS --max-time 5 "https://$DOMAIN/health" >/dev/null 2>&1; then
    ok "https://$DOMAIN/health responde"
  else
    fail "https://$DOMAND/health no responde"
  fi
else
  warn "DOMAIN no definido"
fi

# === Uptime del stack ==============================================
hdr "Uptime del stack"
FIRST_STARTED=$(docker ps --format '{{.Names}} {{.State.StartedAt}}' 2>/dev/null | \
  awk '{print $2}' | sort | head -1)
if [[ -n "$FIRST_STARTED" ]]; then
  START_EPOCH=$(date -d "$FIRST_STARTED" +%s 2>/dev/null || echo 0)
  NOW_EPOCH=$(date +%s)
  if [[ "$START_EPOCH" -gt 0 ]]; then
    DIFF=$(( NOW_EPOCH - START_EPOCH ))
    DAYS=$(( DIFF / 86400 ))
    HRS=$(( (DIFF % 86400) / 3600 ))
    MINS=$(( (DIFF % 3600) / 60 ))
    ok "${DAYS}d ${HRS}h ${MINS}m (desde $FIRST_STARTED)"
  fi
fi

# === Disco =========================================================
hdr "Disco"
DISK=$(df -P / | tail -1)
DISK_PCT=$(echo "$DISK" | awk '{print $5}')
DISK_FREE=$(echo "$DISK" | awk '{print $4}')
ok "/: ${DISK_PCT} usado (${DISK_FREE} libres)"

# === Backups ======================================================
hdr "Backups"
BK_DIR="${RYSA_HOME}/backups/db"
if [[ -d "$BK_DIR" ]]; then
  N=$(find "$BK_DIR" -name "*.dump" 2>/dev/null | wc -l)
  LATEST=$(ls -t "$BK_DIR"/*.dump 2>/dev/null | head -1)
  if [[ -n "$LATEST" ]]; then
    SIZE=$(du -h "$LATEST" | cut -f1)
    AGE=$(( ($(date +%s) - $(stat -c %Y "$LATEST")) / 86400 ))
    ok "último backup: $(basename "$LATEST") ($SIZE, ${AGE}d)"
  fi
  [[ "$N" -gt 0 ]] && ok "$N archivos en $BK_DIR" || warn "no hay backups"
else
  warn "$BK_DIR no existe (ejecuta scripts/backup.sh)"
fi

echo
