#!/usr/bin/env bash
# Rollback a una release anterior (código + commit previos) y reaplicar BD.
#
# Uso:  sudo /opt/rysa/repo/scripts/rollback.sh [release.tar.gz]
#
#   Sin argumentos: lista las últimas 5 releases disponibles.
#   Con un archivo: extrae el código a /opt/rysa/repo, restaura el
#   dump de BD más cercano y re-despliega.
#
# PELIGRO: revierte el código y la BD. Requiere confirmación.

set -euo pipefail

RYSA_HOME="${RYSA_HOME:-/opt/rysa}"
RYSA_REPO="${RYSA_HOME}/repo"
REL_DIR="${RYSA_HOME}/backups/releases"
DB_DIR="${RYSA_HOME}/backups/db"
BACKUP_BEFORE_ROLLBACK="${RYSA_HOME}/backups/db/pre_rollback_$(date +%Y%m%d_%H%M%S).dump"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: ejecuta como root" >&2; exit 1
fi

# Sin argumentos: listar
if [[ $# -eq 0 ]]; then
  echo "Releases disponibles (más recientes primero):"
  ls -lt "$REL_DIR"/release_*.tar.gz 2>/dev/null | head -5 | \
    awk '{printf "  %s  %s\n", $NF, $6" "$7" "$8}' | sed 's|/opt/rysa/backups/releases/release_|  |'
  echo ""
  echo "Para hacer rollback:  sudo $0 <release.tar.gz>"
  echo "Para ver un backup DB:  sudo $0 --db"
  exit 0
fi

if [[ "$1" == "--db" ]]; then
  echo "Últimos 10 dumps de BD:"
  ls -lt "$DB_DIR"/*.dump 2>/dev/null | head -10 | \
    awk '{printf "  %s  %s\n", $NF, $6" "$7" "$8}'
  exit 0
fi

REL="$1"
[[ -f "$REL" ]] || { echo "ERROR: $REL no existe" >&2; exit 1; }
[[ "$REL" == /* ]] || REL="$REL_DIR/$REL"

# Determinar commit de la release
COMMIT=$(basename "$REL" | sed -n 's/release_\([a-f0-9]*\)_.*/\1/p')
[[ -z "$COMMIT" ]] && COMMIT="desconocido"

echo "ATENCIÓN: vas a hacer rollback a:"
echo "  Release: $REL"
echo "  Commit:  $COMMIT"
echo "  Esto revertirá código Y base de datos."
read -p "Escribe 'ROLLBACK' para confirmar: " CONFIRM
[[ "$CONFIRM" == "ROLLBACK" ]] || { echo "Cancelado."; exit 0; }

# 1) Backup de la BD actual (por si algo sale mal)
echo "Backup de la BD actual -> $BACKUP_BEFORE_ROLLBACK"
docker exec rysa_postgres pg_dump -U rysa -d rysa_dev -Fc > "$BACKUP_BEFORE_ROLLBACK" 2>/dev/null || true

# 2) Extraer código de la release
echo "Extrayendo código de la release..."
TMP=$(mktemp -d)
tar -xzf "$REL" -C "$TMP"
# Preservar .env.docker y volúmenes (no están en el tarball)
if [[ -d "$RYSA_REPO" ]]; then
  cp -a "$RYSA_REPO/.env.docker" "$TMP/.env.docker" 2>/dev/null || true
fi
# Reemplazar el código
rm -rf "$RYSA_REPO"
mv "$TMP" "$RYSA_REPO"
chown -R 1000:1000 "$RYSA_REPO" 2>/dev/null || true
echo "Código restaurado en $RYSA_REPO"

# 3) Buscar dump de BD más cercano al commit
CANDIDATE=$(ls -t "$DB_DIR"/rysa_dev_*.dump 2>/dev/null | head -1)
if [[ -z "$CANDIDATE" ]]; then
  echo "WARNING: no hay dumps de BD en $DB_DIR"
  echo "El rollback de código está hecho. La BD se mantiene como estaba."
else
  echo "Dump de BD más reciente: $CANDIDATE"
  read -p "¿Restaurar la BD a este dump? (s/N): " RESTORE
  if [[ "$RESTORE" == "s" || "$RESTORE" == "S" ]]; then
    "$RYSA_HOME/repo/scripts/restore.sh" "$CANDIDATE" rysa_dev
  fi
fi

# 4) Re-deploy
echo "Re-desplegando..."
cd "$RYSA_REPO"
./scripts/deploy.sh || {
  echo "ERROR: deploy falló tras rollback. Revisa logs." >&2
  exit 1
}

echo
echo "Rollback completado. Ejecuta scripts/status.sh para verificar."
