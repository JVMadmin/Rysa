#!/usr/bin/env bash
# =============================================================================
# Limpia compilaciones viejas de RYSA en el Docker de la PC de desarrollo.
#
# Quita las imágenes de RYSA que quedaron sin etiqueta al recompilar (versiones
# anteriores) y la caché de compilaciones pasadas. La caché que forma parte de
# las imágenes actuales se queda, así la siguiente compilación sigue siendo
# rápida. No toca volúmenes (bases de datos) ni imágenes o contenedores de
# otros proyectos. Correr después de cada `docker compose -p rysa ... build`.
#
#   ./scripts/limpiar_docker_local.sh
# =============================================================================
set -euo pipefail

docker image prune -f --filter "label=com.docker.compose.project=rysa"
docker builder prune -f
docker system df
