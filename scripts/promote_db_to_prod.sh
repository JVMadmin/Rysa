#!/usr/bin/env bash
# Promueve la base operativa a su nombre de producción (por defecto
# rysa_dev -> rysa_prod) para poder correr con ENVIRONMENT=production
# (deploy.sh y check_installation.py rechazan rysa_dev en producción).
#
# Uso (en la carpeta del repo, con el stack levantado):
#   ./scripts/promote_db_to_prod.sh              # simulación: solo valida
#   ./scripts/promote_db_to_prod.sh --apply      # respalda, renombra y ajusta .env.docker
#
# Seguridad:
#   * Respaldo pg_dump -Fc verificado ANTES de tocar nada.
#   * La base destino debe NO existir o estar VACÍA (sin tablas de usuario);
#     si tiene datos, aborta.
#   * Detiene rysa_backend durante el renombre (unos segundos) y NO lo
#     vuelve a levantar: el siguiente paso es ./scripts/deploy.sh.
#   * .env.docker (y .env si existe) se respaldan como *.bak-<fecha> antes
#     de cambiar DATABASE_URL.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SRC_DB="${SRC_DB:-rysa_dev}"
DST_DB="${DST_DB:-rysa_prod}"
PG_CONTAINER="${PG_CONTAINER:-rysa_postgres}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-rysa_backend}"
BACKUP_DIR="${BACKUP_DIR:-${RYSA_HOME:-/opt/rysa}/backups/db}"
APPLY=""
[[ "${1:-}" == "--apply" ]] && APPLY=1

log() { printf "\033[1;34m[promote]\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m[promote]\033[0m %s\n" "$*" >&2; }
ok()  { printf "\033[1;32m[promote]\033[0m %s\n" "$*"; }

PG_USER="$(grep -E '^POSTGRES_USER=' .env.docker 2>/dev/null | cut -d= -f2- | tr -d '\r')"
PG_USER="${PG_USER:-rysa}"
psql_admin() { docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d postgres -Atc "$1"; }

docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER" || { err "$PG_CONTAINER no está corriendo"; exit 1; }

# 1) Validaciones
[[ "$(psql_admin "SELECT count(*) FROM pg_database WHERE datname='$SRC_DB'")" == "1" ]] \
  || { err "La base origen $SRC_DB no existe"; exit 1; }
SRC_TABLES=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$SRC_DB" -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
log "Origen $SRC_DB: $SRC_TABLES tablas"

DST_EXISTS=$(psql_admin "SELECT count(*) FROM pg_database WHERE datname='$DST_DB'")
if [[ "$DST_EXISTS" == "1" ]]; then
  DST_TABLES=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$DST_DB" -Atc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  if [[ "$DST_TABLES" != "0" ]]; then
    err "La base destino $DST_DB ya tiene $DST_TABLES tablas. Abortando (no se sobrescribe)."
    exit 1
  fi
  log "Destino $DST_DB existe y está vacía: se eliminará antes del renombre"
else
  log "Destino $DST_DB no existe"
fi

grep -qE "^DATABASE_URL=.*/${SRC_DB}([?]|$)" .env.docker \
  || err "Aviso: DATABASE_URL de .env.docker no apunta a /$SRC_DB (revísalo a mano)"

if [[ -z "$APPLY" ]]; then
  ok "Simulación OK. Ejecuta con --apply para respaldar y renombrar."
  exit 0
fi

# 2) Respaldo verificado
mkdir -p "$BACKUP_DIR"
DUMP="$BACKUP_DIR/pre_promote_${SRC_DB}_$(date +%Y%m%d_%H%M%S).dump"
log "Respaldo -> $DUMP"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$SRC_DB" -Fc > "$DUMP"
docker exec -i "$PG_CONTAINER" pg_restore --list < "$DUMP" > /dev/null \
  || { err "El respaldo no se puede leer; abortando sin cambios"; exit 1; }
ok "Respaldo verificado ($(du -h "$DUMP" | cut -f1))"

# 3) Renombre (requiere que nadie esté conectado a la base origen)
log "Deteniendo $BACKEND_CONTAINER"
docker stop "$BACKEND_CONTAINER" > /dev/null || true
psql_admin "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$SRC_DB','$DST_DB') AND pid <> pg_backend_pid()" > /dev/null
[[ "$DST_EXISTS" == "1" ]] && psql_admin "DROP DATABASE \"$DST_DB\""
psql_admin "ALTER DATABASE \"$SRC_DB\" RENAME TO \"$DST_DB\""
ok "Base renombrada: $SRC_DB -> $DST_DB"

# 4) DATABASE_URL en .env.docker (y .env, copia usada por docker compose)
STAMP=$(date +%Y%m%d_%H%M%S)
for f in .env.docker .env; do
  [[ -f "$f" ]] || continue
  cp -p "$f" "$f.bak-$STAMP"
  sed -i -E "s#^(DATABASE_URL=.*/)${SRC_DB}([?].*)?\$#\1${DST_DB}\2#" "$f"
  ok "$f actualizado (respaldo $f.bak-$STAMP)"
done

ok "Listo. Siguiente paso: ./scripts/deploy.sh (levanta el backend contra $DST_DB)."
