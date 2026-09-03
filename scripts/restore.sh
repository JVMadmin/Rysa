#!/usr/bin/env bash
# Restaurar un dump de PostgreSQL desde /opt/rysa/backups/db/.
#
# Uso:  sudo /opt/rysa/repo/scripts/restore.sh <archivo.dump> [TARGET_DB]
#
#   TARGET_DB por defecto: rysa_dev. Si la BD no existe, la crea.
#   Antes de restaurar, hace un backup de la BD actual.
#
# PELIGRO: sobrescribe la BD destino. Requiere confirmación.

set -euo pipefail

RYSA_HOME="${RYSA_HOME:-/opt/rysa}"
DB_DIR="${RYSA_HOME}/backups/db"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: ejecuta como root (sudo $0)" >&2; exit 1
fi
if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <archivo.dump> [target_db]" >&2
  echo "  Dumps disponibles:"
  ls -1t "$DB_DIR"/*.dump 2>/dev/null | head -10 | sed 's/^/    /'
  exit 1
fi

DUMP="$1"
TARGET_DB="${2:-rysa_dev}"
[[ -f "$DUMP" ]] || { echo "ERROR: $DUMP no existe" >&2; exit 1; }
[[ "$DUMP" == /* ]] || DUMP="$DB_DIR/$DUMP"

# Confirmar
echo "ATENCIÓN: vas a restaurar:"
echo "  Dump:    $DUMP ($(du -h "$DUMP" | cut -f1))"
echo "  Target:  $TARGET_DB"
echo ""
read -p "¿Continuar? Escribe 'RESTAURAR' para confirmar: " CONFIRM
if [[ "$CONFIRM" != "RESTAURAR" ]]; then
  echo "Cancelado."
  exit 0
fi

# Pre-flight: postgres corriendo
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q rysa_postgres; then
  echo "ERROR: rysa_postgres no está corriendo" >&2; exit 1
fi

# Backup de seguridad de la BD actual (si existe)
if docker exec rysa_postgres psql -U rysa -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$TARGET_DB"; then
  PRE_FILE="$DB_DIR/pre_restore_$(date +%Y%m%d_%H%M%S)_${TARGET_DB}.dump"
  echo "Backup de la BD actual -> $PRE_FILE"
  docker exec rysa_postgres pg_dump -U rysa -d "$TARGET_DB" -Fc > "$PRE_FILE" 2>/dev/null
fi

# Crear BD limpia
docker exec rysa_postgres dropdb -U rysa --if-exists "$TARGET_DB" 2>/dev/null || true
docker exec rysa_postgres createdb -U rysa "$TARGET_DB" 2>/dev/null

# Restaurar
echo "Restaurando $DUMP -> $TARGET_DB ..."
if docker exec -i rysa_postgres pg_restore -U rysa -d "$TARGET_DB" --no-owner --role=rysa < "$DUMP"; then
  echo "Restauración OK."
  echo "Ahora ejecuta: cd $RYSA_HOME/repo && ./scripts/deploy.sh"
else
  echo "ERROR: pg_restore falló" >&2
  exit 1
fi
