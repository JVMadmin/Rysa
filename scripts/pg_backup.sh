#!/usr/bin/env bash
# ============================================================
# RYSA - Backup de PostgreSQL (pg_dump físico)
# Uso en el VPS (recomendado: cron diario a las 03:00):
#   crontab -e
#   0 3 * * * /opt/rysa/scripts/pg_backup.sh >> /var/log/rysa_backup.log 2>&1
#
# Requisitos: docker compose del ERP levantado (contenedor rysa_postgres).
# Configuración por variables de entorno o editando los defaults:
#   RYSA_DIR        ruta del proyecto           (/opt/rysa)
#   BACKUP_DIR      destino de respaldos        (/var/backups/rysa)
#   RETENTION_DAYS  días de retención           (14)
#   POSTGRES_USER   usuario pg_dump             (rysa)
#   POSTGRES_DB     base a respaldar            (rysa_prod)
#
# RESTAURACIÓN (¡probar mensualmente!):
#   docker exec -i rysa_postgres pg_restore \
#     -U rysa -d rysa_prod --clean --if-exists < BACKUP_DIR/archivo.dump
#   (o crear DB nueva y restaurar ahí para validar antes de tocar producción)
# ============================================================
set -euo pipefail

RYSA_DIR="${RYSA_DIR:-/opt/rysa}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/rysa}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
POSTGRES_USER="${POSTGRES_USER:-rysa}"
POSTGRES_DB="${POSTGRES_DB:-rysa_prod}"

STAMP="$(date +%Y%m%d_%H%M%S)"
FILE="$BACKUP_DIR/${POSTGRES_DB}_${STAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "[$(date '+%F %T')] Iniciando backup $POSTGRES_DB -> $FILE"
# Dump consistente en formato custom (pg_restore), dentro de la red del stack.
docker compose -f "$RYSA_DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$FILE"

SIZE=$(du -h "$FILE" | cut -f1)
echo "[$(date '+%F %T')] Backup OK ($SIZE)"

# Verificación rápida: el dump debe poder listarse sin errores.
docker compose -f "$RYSA_DIR/docker-compose.yml" exec -T postgres \
  pg_restore --list < "$FILE" > /dev/null || { echo "ERROR: dump corrupto"; exit 1; }
echo "[$(date '+%F %T')] Verificación pg_restore --list OK"

# Retención: borrar respaldos antiguos.
find "$BACKUP_DIR" -name "${POSTGRES_DB}_*.dump" -mtime +"$RETENTION_DAYS" -delete
echo "[$(date '+%F %T')] Limpieza completada (retención ${RETENTION_DAYS} días)"