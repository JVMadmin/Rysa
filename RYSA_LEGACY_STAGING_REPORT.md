# RYSA LEGACY STAGING REPORT (FASE 3)

Batch: `B20260831232056` · Generado: 2026-08-31T23:20:56.802252+00:00 · Duración: 146.2 s · Fuente: `/app/legacy_data`

## 1. Resumen del batch

- Tickets staged: **57,263** (legacy 57,263 → ecuación OK)
- Detalles staged: **134,438** (legacy 134,438 → OK)
- CxC snapshot: **3,576** de 3,576 → READY 3,239 · REVIEW 269 · NEGATIVE 5 · EXCLUDED 63 (OK)
- Clientes mapeados: 640 → `{'UNMATCHED': 20, 'MATCHED': 619, 'DELETED_LEGACY': 1}`
- Productos mapeados: 2,036 → `{'MATCHED': 2034, 'PRODUCT_REVIEW_REQUIRED': 2}`
- **Balances por cliente (V2):** MATCH 611 · DIFFERENCE 79 · REVIEW 0 · maestro $2,547,638.50 · docs $1,660,452.77 · ledger $3,147,481.00 · brechas: docs $887,185.73 / ledger $-599,842.50

- Excluidos (serie F): 171 registros (108 movimientos + documentos) · Cola de revisión: 271

## 2. Decisiones oficiales aplicadas

- **A (desmatches):** saldo autoritativo = CXCDOCS.SALDO; H1 conservado como trazabilidad; desmatches → `REVIEW_REQUIRED (CXC_MISMATCH)`; nada corregido ni eliminado.
- **B (serie F):** `EXCLUDED_SCOPE (FACTURA_SERIE_F)`; datos conservados en staging para fase futura.
- **C (contado con saldo):** `REVIEW_REQUIRED (CASH_DOCUMENT_WITH_BALANCE)`; no se convierte en deuda por inferencia.

## 3. Idempotencia y auditoría

- Claves: `LEGACY:SERIE:FOLIO` (tickets/CxC) · `LEGACY:SERIE:FOLIO:PARTIDA` (detalles) · `LEGACY:MOV:...:FOLIOMOVTO:APLICA:MONTO:recno` (ledger).
- Upserts `ON CONFLICT` → re-ejecuciones no duplican.
- Toda fila conserva `source='LEGACY'`, `legacy_table`, doc JSONB original y `last_batch_id`.

## 4. Tablas staging creadas (namespace aislado, producción intacta)

legacy_migration_batch · legacy_customer_mapping · legacy_product_mapping · legacy_tickets · legacy_ticket_details · legacy_cxc_snapshot · legacy_cxc_movements · legacy_excluded_documents · legacy_review_queue

## 5. Notas

- `legacy_importe_calculado` en detalles = CANTIDAD × PRECIO (NVTAPAR no tiene campo IMPORTE; documentado).
- CAJAPAGO NO se staginga: son movimientos de caja históricos fuera del universo de importación (sección 11 del prompt); permanecen en legacy_data/ y en los reportes de análisis.
- Productos: la colección `products` de RYSA (dev) está vacía → todas las partidas quedan `PRODUCT_REVIEW_REQUIRED` hasta que exista el catálogo RYSA; el match a nivel legacy (ARTICULO) se conserva en `legacy_status`.
- Clientes: match exacto por `clients.doc->>'codigo'`; sin duplicados de codigo en RYSA (686/686 únicos).

## 6. Reportes generados

- `/app/legacy_reports/staging/customer_mapping.csv`
- `/app/legacy_reports/staging/product_mapping.csv`
- `/app/legacy_reports/staging/tickets_staging.csv`
- `/app/legacy_reports/staging/ticket_details_staging.csv`
- `/app/legacy_reports/staging/cxc_staging.csv`
- `/app/legacy_reports/staging/review_queue.csv`
- `/app/legacy_reports/staging/excluded_documents.csv`
- `/app/legacy_reports/customers/client_balance.csv`
- `/app/legacy_reports/reconciliation/client_balance_reconciliation.csv`
- `/app/legacy_reports/snapshots/snapshot_index.csv`
- `/app/legacy_reports/cxc/cxc_document_status.csv`
- `/app/legacy_reports/products/product_mapping_full.csv`
- `/app/legacy_reports/sales/tickets_index.csv`
- `/app/legacy_reports/errors/review_queue_full.csv`
- `/app/legacy_reports/snapshots/changes_vs_previous.csv`
- `/app/legacy_reports/staging/migration_summary.csv`

## 7. Estado

**STAGING COMPLETADO — producción sin modificar. Siguiente fase prevista: DRY-RUN (solo con instrucción explícita).**
