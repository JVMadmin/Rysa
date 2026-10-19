#!/usr/bin/env bash
# Backup de PostgreSQL + archivos subidos + snapshot del código desplegado,
# con rotación y copia FUERA del VPS.
#
# Uso:   ./scripts/backup.sh            (el cron lo corre a diario: install_backup_cron.sh)
#
# Salidas (RYSA_HOME=/opt/rysa por defecto):
#   backups/db/        <db>_<fecha>.dump         (pg_dump -Fc, verificado con pg_restore --list)
#   backups/uploads/   uploads_<fecha>.tar.gz    (volumen rysa_uploads: imágenes, PDFs, comprobantes)
#   backups/releases/  release_<commit>_<fecha>.tar.gz (código del repo, sin secretos)
#
# Configuración opcional en /etc/rysa/backup.env (o variables de entorno):
#   BACKUP_RETAIN_DAYS=30          retención de dumps y uploads
#   BACKUP_RETAIN_RELEASES=10      snapshots de código a conservar
#   BACKUP_RSYNC_TARGET=usuario@host:/ruta/rysa   copia externa por rsync+ssh (llave SSH)
#   BACKUP_RCLONE_REMOTE=remoto:bucket/rysa       copia externa por rclone (S3, B2, Drive...)
# Sin copia externa el respaldo vive en el mismo disco que la base: se avisa
# en el log con "SIN COPIA EXTERNA".

set -euo pipefail

[[ -f /etc/rysa/backup.env ]] && . /etc/rysa/backup.env

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RYSA_HOME="${RYSA_HOME:-/opt/rysa}"
RYSA_REPO="${RYSA_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BK_ROOT="${RYSA_HOME}/backups"
DB_DIR="${BK_ROOT}/db"
UP_DIR="${BK_ROOT}/uploads"
REL_DIR="${BK_ROOT}/releases"
LOG="${RYSA_HOME}/logs/backup.log"
RET_DAYS="${BACKUP_RETAIN_DAYS:-30}"
RET_REL="${BACKUP_RETAIN_RELEASES:-10}"
PG_CONTAINER="${PG_CONTAINER:-rysa_postgres}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-rysa_uploads}"

# BD objetivo desde .env.docker o env (DATABASE_URL). Evita hardcodear el nombre.
# shellcheck source=_db_name.sh
. "$SCRIPT_DIR/_db_name.sh"
DB_NAME="$(rysa_db_name || echo "rysa_prod")"
PG_USER="$(grep -E '^POSTGRES_USER=' "$RYSA_REPO/.env.docker" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
PG_USER="${PG_USER:-rysa}"

log() { printf "[backup %s] %s\n" "$(date +%H:%M:%S)" "$*"; echo "[$(date -Iseconds)] $*" >> "$LOG"; }
mkdir -p "$(dirname "$LOG")" "$DB_DIR" "$UP_DIR" "$REL_DIR"
chmod 700 "$BK_ROOT"

# Un solo backup a la vez (cron + deploy podrían coincidir).
exec 9>"$BK_ROOT/.lock"
flock -n 9 || { log "Otro backup en curso; saliendo"; exit 0; }

if ! command -v docker >/dev/null 2>&1 || ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$PG_CONTAINER"; then
  log "ERROR: $PG_CONTAINER no está corriendo. Abortando."
  exit 1
fi

STAMP=$(date +%Y%m%d_%H%M%S)

# === 1) Dump de la BD ===========================================
DB_FILE="$DB_DIR/${DB_NAME}_${STAMP}.dump"
log "DB -> $DB_FILE (db=$DB_NAME)"
if docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$DB_NAME" -Fc > "$DB_FILE" 2>>"$LOG"; then
  log "DB OK ($(du -h "$DB_FILE" | cut -f1))"
else
  rm -f "$DB_FILE"
  log "ERROR: pg_dump falló"
  exit 1
fi
if docker exec -i "$PG_CONTAINER" pg_restore --list < "$DB_FILE" >/dev/null 2>>"$LOG"; then
  log "DB integridad verificada (pg_restore --list)"
else
  log "ERROR: pg_restore --list falló (dump corrupto)"
  exit 1
fi

# === 2) Archivos subidos (volumen de uploads) ===================
UP_FILE="$UP_DIR/uploads_${STAMP}.tar.gz"
if docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
  # Se reutiliza la imagen de postgres (ya presente) para no descargar otra.
  PG_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$PG_CONTAINER")"
  if docker run --rm -v "$UPLOADS_VOLUME":/data:ro "$PG_IMAGE" tar -czf - -C /data . > "$UP_FILE" 2>>"$LOG"; then
    log "Uploads OK ($(du -h "$UP_FILE" | cut -f1))"
  else
    rm -f "$UP_FILE"
    log "ERROR: respaldo de uploads falló"
    exit 1
  fi
else
  log "Aviso: volumen $UPLOADS_VOLUME no existe; se omite"
fi

# === 3) Snapshot del código desplegado (sin secretos) ===========
COMMIT=$(git -C "$RYSA_REPO" rev-parse --short HEAD 2>/dev/null || echo "unknown")
REL_FILE="$REL_DIR/release_${COMMIT}_${STAMP}.tar.gz"
tar -czf "$REL_FILE" \
  --exclude=node_modules --exclude=.git --exclude=__pycache__ \
  --exclude='*.log' --exclude='legacy_data' --exclude='legacy_reports' \
  --exclude='backend/uploads' --exclude='backend/backups' \
  --exclude='.env' --exclude='.env.docker' --exclude='.env.docker.local' --exclude='.env.*.bak-*' \
  -C "$RYSA_REPO" .
log "Release OK ($(du -h "$REL_FILE" | cut -f1), commit $COMMIT)"

# === 4) Rotación ==================================================
find "$DB_DIR" -name "*.dump" -mtime +"$RET_DAYS" -delete
find "$UP_DIR" -name "uploads_*.tar.gz" -mtime +"$RET_DAYS" -delete
find "$REL_DIR" -name "*.tar.gz" | sort | head -n -"$RET_REL" | xargs -r rm -f

# === 5) Copia externa ============================================
OFFSITE=0
if [[ -n "${BACKUP_RSYNC_TARGET:-}" ]]; then
  if rsync -a -e "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
       "$DB_DIR" "$UP_DIR" "$BACKUP_RSYNC_TARGET/" 2>>"$LOG"; then
    log "Copia externa rsync OK -> $BACKUP_RSYNC_TARGET"; OFFSITE=1
  else
    log "ERROR: copia externa rsync falló"
  fi
fi
if [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  if command -v rclone >/dev/null 2>&1 \
     && rclone copy "$DB_DIR" "$BACKUP_RCLONE_REMOTE/db" 2>>"$LOG" \
     && rclone copy "$UP_DIR" "$BACKUP_RCLONE_REMOTE/uploads" 2>>"$LOG"; then
    log "Copia externa rclone OK -> $BACKUP_RCLONE_REMOTE"; OFFSITE=1
  else
    log "ERROR: copia externa rclone falló (¿rclone instalado y configurado?)"
  fi
fi
[[ "$OFFSITE" -eq 1 ]] || log "AVISO: SIN COPIA EXTERNA — configura BACKUP_RSYNC_TARGET o BACKUP_RCLONE_REMOTE en /etc/rysa/backup.env"

# === 6) Resumen ====================================================
N_DB=$(find "$DB_DIR" -name "*.dump" | wc -l)
N_UP=$(find "$UP_DIR" -name "uploads_*.tar.gz" | wc -l)
N_REL=$(find "$REL_DIR" -name "*.tar.gz" | wc -l)
log "Total: ${N_DB} dumps, ${N_UP} uploads, ${N_REL} releases (retención ${RET_DAYS}d / ${RET_REL} releases)"
