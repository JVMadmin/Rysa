# Cambios de RYSA ERP

La versión oficial está en `VERSION` (MAYOR.MENOR.PARCHE). `scripts/deploy.sh`
la compila junto con el commit en el servidor y en la web; el ERP la muestra al
pie del menú («Acerca de RYSA») y avisa cuando hay una nueva. Las novedades que
ven los usuarios están en `frontend/src/lib/novedades.js`.

Al publicar: subir `VERSION`, agregar la entrada aquí y en `novedades.js`, y
etiquetar el commit desplegado (`git tag v<versión>`).

Cómo viaja un cambio:
1. Commit y `git push` (cualquier rama). GitHub corre las pruebas y, si pasan,
   publica las imágenes `ghcr.io/jvmadmin/rysa-{backend,frontend,nginx}:<commit>`.
2. Prueba local con esas mismas imágenes: `./scripts/usar_imagenes_ci.sh`.
   (Para algo aún sin empujar, compilar local como siempre y después
   `./scripts/limpiar_docker_local.sh`.)
3. Producción: `./scripts/deploy.sh --ref <commit>` descarga las imágenes (no
   compila), respalda, migra y verifica; si falla vuelve sola a la anterior.
   Sin imágenes de GitHub (CI en rojo) no despliega; `--compilar` lo fuerza.

## 2.0.4 · 2026-10-30

- Nota de venta carta (plantilla del Editor de formatos): fecha y hora locales
  (salían en UTC: 19:18 por una venta de las 13:18).

## 2.0.3 · 2026-10-30

- Ticket: cada renglón muestra cantidad x precio con IVA = importe con IVA (el
  mismo precio del formato carta; antes el precio unitario salía sin IVA y no
  cuadraba con el importe). Encabezado DESCRIPCION / IMPORTE y desglose
  «Subtotal sin IVA», «IVA <tasa>», «TOTAL».
- Cantidades con decimales (1.5 KG salía como 1 KG).
- Fecha y hora locales en ticket y carta (salían en UTC).
- Las líneas largas del ticket (dirección) se parten en vez de cortarse.

## 2.0.2 · 2026-10-30

- Impresión desde el navegador corregida: el ticket salía en blanco (la vista
  de impresión apuntaba a la dirección interna del servidor) y la carta del
  POS no abría el diálogo. Un solo camino de impresión para todo PDF.

## 2.0.1 · 2026-10-29

- Las imágenes se compilan y prueban en GitHub; el servidor y la PC local solo
  las descargan. Despliegues más rápidos y sin carga en producción.
- Reversión automática a la versión anterior si un despliegue falla.
- Más pruebas en CI (POS atómico, PostgreSQL, permisos, código de autorización).

## 2.0.0 · 2026-10-29

- Indicador de versión y aviso de versión nueva.
- Impresión por equipo (ticket y carta) y app de escritorio 1.1.0 con impresión directa.
- Ventas a prueba de duplicados y carreras; folios sin huecos.
- Rendimiento: índices, PDF en segundo plano, tablero y catálogo en SQL con caché, gzip.
- Menú rediseñado, fechas locales, autorización remota de precio manual.
- Carga inicial desde el sistema anterior (`backend/scripts/carga_inicial_legacy.py`).
