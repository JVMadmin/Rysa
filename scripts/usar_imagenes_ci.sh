#!/usr/bin/env bash
# =============================================================================
# PC local: corre el stack de prueba con las imágenes que compiló GitHub para
# un commit (las mismas que irán a producción), sin compilar nada aquí.
#
#   ./scripts/usar_imagenes_ci.sh            # commit actual (HEAD)
#   ./scripts/usar_imagenes_ci.sh <ref>      # otro commit, rama o etiqueta
#   ESPERA_CI=600 ./scripts/usar_imagenes_ci.sh   # esperar a que CI termine
#
# El commit debe estar empujado a GitHub (cualquier rama) y con CI en verde.
# Quedan solo la imagen nueva y la anterior (scripts/imagenes_ci.sh).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=imagenes_ci.sh
. scripts/imagenes_ci.sh

SHA="$(git rev-parse "${1:-HEAD}")"
echo "Descargando imágenes de ${SHA:0:7}..."
imagenes_ci_esperar "$SHA" "${ESPERA_CI:-0}" || {
  echo "GitHub no tiene imágenes de ${SHA:0:7}: ¿se empujó el commit? ¿CI terminó en verde?" >&2
  exit 1
}
imagenes_guardar_anterior
imagenes_ci_activar "$SHA"
docker compose -p rysa -f docker-compose.yml --env-file .env.docker up -d --no-build backend frontend nginx
docker compose -p rysa -f docker-compose.yml --env-file .env.docker ps
