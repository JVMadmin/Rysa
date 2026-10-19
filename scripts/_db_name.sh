#!/usr/bin/env bash
# Helper: extrae el nombre de la base de datos de DATABASE_URL.
# Fuente canónica: variable de entorno DATABASE_URL (la usa la app y alembic).
# Fallback legacy: BACKEND_DATABASE_URL (compatibilidad con .env.docker antiguos).
#
# Uso:
#   source "$(dirname "$0")/_db_name.sh"
#   db_name="$(rysa_db_name)"
# O directamente:
#   psql_db="$(rysa_db_name)"

# Lee DATABASE_URL (o BACKEND_DATABASE_URL como fallback) del entorno o de .env.docker.
rysa_load_db_url() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "$DATABASE_URL"; return 0
  fi
  if [[ -n "${BACKEND_DATABASE_URL:-}" ]]; then
    echo "$BACKEND_DATABASE_URL"; return 0
  fi
  # Intenta cargar de .env.docker (junto a scripts/)
  local envfile
  envfile="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env.docker"
  if [[ -f "$envfile" ]]; then
    local v
    v="$(grep -E '^DATABASE_URL=' "$envfile" | head -1 | cut -d= -f2-)"
    if [[ -n "$v" ]]; then echo "$v"; return 0; fi
    v="$(grep -E '^BACKEND_DATABASE_URL=' "$envfile" | head -1 | cut -d= -f2-)"
    if [[ -n "$v" ]]; then echo "$v"; return 0; fi
  fi
  return 1
}

# Devuelve solo el nombre de la base (último segmento de la URL).
# postgresql+asyncpg://user:pass@host:port/dbname  ->  dbname
rysa_db_name() {
  local url
  url="$(rysa_load_db_url)" || { echo "ERROR: no DATABASE_URL" >&2; return 1; }
  # strip trailing slash, query, etc.
  url="${url%%\?*}"
  url="${url%%#*}"
  url="${url%/}"
  echo "${url##*/}"
}
