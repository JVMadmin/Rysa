# Cambios de RYSA ERP

La versión oficial está en `VERSION` (MAYOR.MENOR.PARCHE). `scripts/deploy.sh`
la compila junto con el commit en el servidor y en la web; el ERP la muestra al
pie del menú («Acerca de RYSA») y avisa cuando hay una nueva. Las novedades que
ven los usuarios están en `frontend/src/lib/novedades.js`.

Al publicar: subir `VERSION`, agregar la entrada aquí y en `novedades.js`, y
etiquetar el commit desplegado (`git tag v<versión>`).

## 2.0.0 · 2026-10-29

- Indicador de versión y aviso de versión nueva.
- Impresión por equipo (ticket y carta) y app de escritorio 1.1.0 con impresión directa.
- Ventas a prueba de duplicados y carreras; folios sin huecos.
- Rendimiento: índices, PDF en segundo plano, tablero y catálogo en SQL con caché, gzip.
- Menú rediseñado, fechas locales, autorización remota de precio manual.
- Carga inicial desde el sistema anterior (`backend/scripts/carga_inicial_legacy.py`).
