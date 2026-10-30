#!/usr/bin/env bash
# =============================================================================
# Imágenes que compila GitHub (CI) y publica en GHCR, una por commit:
#   ghcr.io/jvmadmin/rysa-<servicio>:<commit completo>
# Se descargan y se re-etiquetan como rysa-<servicio>:latest, que es el nombre
# que usa docker-compose.yml; así cualquier `docker compose up` (manual o de
# otro script) sigue usando la versión desplegada. La que corría queda como
# rysa-<servicio>:anterior para revertir, y la más vieja se borra: en el equipo
# solo quedan la actual y la anterior.
#
# Lo usan scripts/deploy.sh (VPS) y scripts/usar_imagenes_ci.sh (PC local):
#   . scripts/imagenes_ci.sh
# =============================================================================

RYSA_GHCR="${RYSA_GHCR:-ghcr.io/jvmadmin/rysa}"
RYSA_SERVICIOS=(backend frontend nginx)
RYSA_COMPOSE="${RYSA_COMPOSE:-docker compose}"

# imagenes_ci_descargar <commit completo>: 0 si GitHub ya publicó las tres.
imagenes_ci_descargar() {
  local s
  for s in "${RYSA_SERVICIOS[@]}"; do
    docker pull -q "$RYSA_GHCR-$s:$1" >/dev/null 2>&1 || return 1
  done
}

# imagenes_ci_esperar <commit> <segundos>: reintenta mientras CI termina.
imagenes_ci_esperar() {
  local limite=$(( $(date +%s) + ${2:-0} ))
  until imagenes_ci_descargar "$1"; do
    (( $(date +%s) < limite )) || return 1
    echo "  GitHub aún no publica las imágenes de ${1:0:7}; reintento en 20 s..."
    sleep 20
  done
}

# La actual (latest) pasa a ser la anterior; la anterior previa se borra.
imagenes_guardar_anterior() {
  local s vieja
  for s in "${RYSA_SERVICIOS[@]}"; do
    docker image inspect "rysa-$s:latest" >/dev/null 2>&1 || continue
    vieja=$(docker image inspect -f '{{.Id}}' "rysa-$s:anterior" 2>/dev/null || true)
    docker tag "rysa-$s:latest" "rysa-$s:anterior"
    # Falla sola (y se ignora) si la usa un contenedor o es la misma imagen.
    [[ -n "$vieja" ]] && docker rmi "$vieja" >/dev/null 2>&1 || true
  done
  return 0
}

# imagenes_ci_activar <commit>: la de GitHub pasa a ser latest.
imagenes_ci_activar() {
  local s
  for s in "${RYSA_SERVICIOS[@]}"; do
    docker tag "$RYSA_GHCR-$s:$1" "rysa-$s:latest"
    docker rmi "$RYSA_GHCR-$s:$1" >/dev/null   # solo quita la etiqueta
  done
}

# Compose no siempre recrea un contenedor cuando solo cambió a qué imagen
# apunta la etiqueta: se recrea cada servicio que no corre rysa-<s>:latest.
imagenes_recrear() {
  local s actual nueva
  for s in "${RYSA_SERVICIOS[@]}"; do
    actual=$(docker inspect -f '{{.Image}}' "rysa_$s" 2>/dev/null || true)
    nueva=$(docker image inspect -f '{{.Id}}' "rysa-$s:latest" 2>/dev/null || true)
    [[ -n "$nueva" && "$actual" != "$nueva" ]] || continue
    echo "  recreando $s (imagen nueva)"
    $RYSA_COMPOSE up -d --no-deps --force-recreate "$s" || return 1
  done
}

# La anterior vuelve a ser latest (después: up -d e imagenes_recrear).
imagenes_revertir() {
  local s
  for s in "${RYSA_SERVICIOS[@]}"; do
    docker image inspect "rysa-$s:anterior" >/dev/null 2>&1 \
      && docker tag "rysa-$s:anterior" "rysa-$s:latest"
  done
  return 0
}
