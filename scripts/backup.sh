#!/usr/bin/env bash
# Backup de PostgreSQL + metadata del deploy (commit, fecha) + cleanup.
#
# Uso:  /opt/rysa/repo/scripts/backup.sh
#
# Salidas en /opt/rysa/backups/db/  (DB dumps)
#          /opt/rysa/backups/releases/  (tar.gz con código + .env.docker + commit)
# Retención: BACKUP_RETAIN_DAYS (default 30) para DB, BACKUP_RETAIN_RELEASES (default 10) para releases.

set -euo pipefail

RYSA_HOME="${RYSA_HOME:-/opt/rysa}"
RYSA_REPO="${RYSA_HOME}/repo"
DB_DIR="${RYSA_HOME}/backups/db"
REL_DIR="${RYSA_HOME}/backups/releases"
LOG="${RYSA_HOME}/logs/backup.log"
RET_DAYS="${BACKUP_RETAIN_DAYS:-30}"
RET_REL="${BACKUP_RETAIN_RELEASES:-10}"

log() { printf "[backup %s] %s\n" "$(date +%H:%M:%S)" "$*"; echo "[$(date -Iseconds)] $*" >> "$LOG"; }
mkdir -p "$(dirname "$LOG")" "$DB_DIR" "$REL_DIR"

# Sanity
if ! command -v docker >/dev/null 2>&1 || ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q rysa_postgres; then
  log "ERROR: rysa_postgres no está corriendo. Abortando."
  exit 1
fi

# === 1) Dump de la BD ===========================================
STAMP=$(date +%Y%m%d_%H%M%S)
DB_FILE="$DB_DIR/rysa_dev_${STAMP}.dump"
log "DB -> $DB_FILE"
if docker exec rysa_postgres pg_dump -U rysa -d rysa_dev -Fc > "$DB_FILE" 2>>"$LOG"; then
  SIZE=$(du -h "$DB_FILE" | cut -f1)
  log "DB OK ($SIZE)"
else
  rm -f "$DB_FILE"
  log "ERROR: pg_dump falló"
  exit 1
fi

# Verificar integridad del dump
if docker exec rysa_postgres pg_restore --list < "$DB_FILE" >/dev/null 2>>"$LOG"; then
  log "DB integridad verificada (pg_restore --list)"
else
  log "WARNING: pg_restore --list falló (dump posiblemente corrupto)"
fi

# === 2) Snapshot de la release (código + .env.docker + commit) ===
COMMIT=$(cd "$RYSA_REPO" 2>/dev/null && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
REL_FILE="$REL_DIR/release_${COMMIT}_${STAMP}.tar.gz"
log "Release -> $REL_FILE"

TAR_ARGS=( -czf "$REL_FILE" -C "$RYSA_HOME" )
[[ -f "$RYSA_REPO/.env.docker" ]] && TAR_ARGS+=( ".env.docker" ) || true  # .env.docker está en repo, no en home; ajustar
# Mejor: empaquetar desde el repo
tar -czf "$REL_FILE" \
  --exclude=node_modules --exclude=.git --exclude=__pycache__ \
  --exclude='*.log' --exclude='legacy_data' --exclude='legacy_reports' \
  --exclude='backend/uploads' --exclude='backend/backups' \
  --exclude='.env.docker' --exclude='.env.docker.local' \
  -C "$RYSA_REPO" .
log "Release OK ($(du -h "$REL_FILE" | cut -f1))"

# === 3) Rotación ==================================================
DELETED=$(find "$DB_DIR" -name "*.dump" -mtime +"$RET_DAYS" -delete -print 2>/dev/null | wc -l)
[[ "$DELETED" -gt 0 ]] && log "Rotación DB: $DELETED archivos >${RET_DAYS}d eliminados"

DELETED_REL=$(find "$REL_DIR" -name "*.tar.gz" | sort | head -n -"$RET_REL" 2>/dev/null | wc -l)
find "$REL_DIR" -name "*.tar.gz" | sort | head -n -"$RET_REL" 2>/dev/null | xargs -r rm -f
[[ "$DELETED_REL" -gt 0 ]] && log "Rotación releases: $DELETED_REL snapshots >$RET_REL eliminados"

# === 4) Resumen ====================================================
N_DB=$(find "$DB_DIR" -name "*.dump" | wc -l)
N_REL=$(find "$REL_DIR" -name "*.tar.gz" | wc -l)
log "Total: ${N_DB} DB dumps, ${N_REL} releases (retención ${RET_DAYS}d / ${RET_REL} releases)"
log "Próximo backup: configurar cron (ver DEPLOY_VPS.md)"
