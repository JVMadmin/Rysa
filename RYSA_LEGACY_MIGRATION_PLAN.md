# RYSA LEGACY MIGRATION PLAN (V2)

**Fecha:** 2026-08-30 · Plan operativo para migrar cualquier snapshot legacy. NO ejecutar IMPORT sin autorización explícita.

## Fase 0 — Entrega de copia legacy
1. Reemplazar/acomodar archivos en `legacy_data/` (ruta relativa al proyecto o `LEGACY_DATA_PATH`).
2. NO renombrar ni modificar archivos originales (solo lectura).

## Fase 1 — DISCOVERY
```
python -m tools.legacy_migration inventory   # inventario de archivos
python -m tools.legacy_migration inspect     # estructura, encoding, fechas, relaciones
```
Salidas: `legacy_reports/legacy_discovery.json`, tablas CSV, `RYSA_LEGACY_DISCOVERY_REPORT.md`.

## Fase 2 — ANÁLISIS
```
python -m tools.legacy_migration analyze
```
Valida semántica (MOVTO C/A, identidad de docs), conciliación global A/B/F y genera `legacy_reports/analysis/`.

## Fase 3 — STAGING (crea snapshot versionado)
```
python -m tools.legacy_migration stage
```
- Upserts idempotentes por clave `LEGACY:SERIE:FOLIO[:PARTIDA]`.
- Crea `legacy_snapshots` + `legacy_client_balance` del snapshot (master/docs/ledger por cliente).
- CSVs en `legacy_reports/{customers,products,sales,cxc,reconciliation,errors,snapshots}/`.
- Producción intacta. Re-ejecutable N veces sin duplicar.

## Fase 4 — DRY-RUN
```
python -m tools.legacy_migration dry-run
```
Simula la importación completa en memoria; verifica idempotencia en 2 pasadas y que producción queda intacta.

## Fase 5 — CONCILIACIÓN Y REVISIÓN (humana)
- DevTools → Migración Legacy → **Conciliación**: filtros MATCH/DIFFERENCE/REVIEW.
- Resolver la cola (`legacy_review_queue`): 269 docs REVIEW, facturas serie F (63), marcados A=0/51 (115), clientes 46+3 con brecha, 00389 CARLOS.
- Cada resolución se registra en la cola (status), nunca se borra evidencia.

## Fase 6 — IMPORT (requiere autorización explícita)
`POST /api/legacy/import` con `confirmacion: "IMPORTAR LEGACY"` + `backup_confirmado: true`:
- Precheck (staging íntegro, identidad, mapping, backup) → bloquea si falla.
- Importa `sales` source=LEGACY con saldo documental (FIFO-ready). **`clients.saldo` NO se toca** (política V2, validación `clients_saldo_intacto`).
- Chunks con progreso en `legacy_import_batch`; fallo crítico → FAILED (+rollback disponible).
- Resultados posibles: COMPLETED / COMPLETED_WITH_WARNINGS / FAILED / REVIEW_REQUIRED.

## Fase 7 — VALIDACIÓN POST-IMPORT (automática, gate del batch)
- tickets/detalles/CxC esperados vs importados.
- `clients_saldo_intacto` (antes = después).
- Tablas operativas intactas (abonos, caja, inventario, productos).
- Gate de cierre V2: `SUM(sales.saldo LEGACY) + SUM(sales.saldo RYSA) + ajustes ≈ clients.saldo` por cliente → documenta brechas por resolver (887K) sin forzarlas.

## Fase 8 — RECONCILIACIÓN FINAL
`/api/legacy/reconciliation` + reporte `RYSA_LEGACY_RECONCILIATION_REPORT.md` regenerado con el snapshot importado.

## Rollback
`POST /api/legacy/rollback` con `"REVERTIR LEGACY"`: elimina SOLO las `sales` LEGACY del batch (`doc->>'legacy_batch'`); bajo política V2 no hay deltas de saldo que revertir.

## Reproducibilidad con nueva copia
Cada corrida de staging crea `SNAP-B<batch>` con `source_hash` de los archivos. Los snapshots anteriores se conservan; la diferencia entre snapshots es el movimiento del negocio entre copias.
