# RYSA LEGACY DRY-RUN REPORT (FASE 4)

Generado: 2026-08-31T23:24:36.118687+00:00 · Duración: 3.9 s · Idempotencia (2 pasadas idénticas): **OK**

## 1. Tickets

- Total staged: 57,258
- Would import: **0** · skip (ya existen en sales): 57,258
- Cancelados: 3,000 (con saldo 0 → ya en REVIEW; sin saldo 3,000)
- Monto total histórico: $63,356,380.83
- Identidad (SERIE,FOLIO): 57,258 filas / 57,258 únicas → SIN duplicados
- Por mapping de cliente: `{'UNMATCHED': 244, 'DELETED_LEGACY': 8, 'MATCHED': 57006}`

## 2. Detalles

- Total: 134,429 · would import: 134,429
- Sin producto RYSA (PRODUCT_REVIEW_REQUIRED): **95** · matched: 134,334
- Monto calculado (CANTIDAD×PRECIO): $58,788,278.44
- Identidad (doc,partida): 134,429 / 134,429 únicas

## 3. CxC

- Total snapshot: 3,575 · por estado: `{'EXCLUDED': 63, 'NEGATIVE': 5, 'READY': 3238, 'REVIEW_REQUIRED': 269}`
- **Would import (READY, saldo>0): 232 docs · saldo total $789,708.45**
- READY con saldo cero (sin deuda): 3,006
- REVIEW: 269 docs · saldo $862,197.67
- Desglose REVIEW:

| Razón | Docs | Saldo | Diferencia |
|---|---|---|---|
| CASH_DOCUMENT_WITH_BALANCE | 257 | 832,728.59 | 0.0 |
| CASH_DOCUMENT_WITH_BALANCE+CANCELLED_WITH_BALANCE | 12 | 29,469.08 | 0.0 |

- NEGATIVE: 5 docs · $-4,245.75 → NO entran a CxC
- EXCLUDED (serie F): 63 docs · $12,792.4 → fuera del universo

## 4. Clientes y productos

- Clientes: `{'UNMATCHED': 20, 'DELETED_LEGACY': 1, 'MATCHED': 619}`
- UNMATCHED (20): `['00000', '00361', '00389', '15090', '25045', '45065', '6', '65085', '74210', '75007', '75010', '75011', '75013', '75015', '75022', '75030', '75095', '8', '86482', '97504']`
- Productos: `{'PRODUCT_REVIEW_REQUIRED': 2, 'MATCHED': 2034}` → NO se crearán productos en este dry-run (regla 1); los detalles conservan su información legacy.

## 5. Estado de cuenta virtual (verificación de estructura)

- Clientes con CxC READY: 55
- Cadenas verificadas: 232 docs CxC con ticket staged · 57,238 tickets con detalle (cliente→documento→ticket→detalle navegable)

| Cliente legacy | Docs pendientes | Saldo total |
|---|---|---|
| 00165 | 80 | $24,800.05 |
| 00027 | 19 | $38,676.16 |
| 00131 | 13 | $345.00 |
| 00341 | 12 | $607.01 |
| 00078 | 11 | $56,009.81 |
| 00584 | 11 | $525.00 |
| 00064 | 6 | $77,002.63 |
| 00179 | 6 | $53,626.52 |
| 00585 | 4 | $137.00 |
| 00690 | 4 | $133.00 |
| 00003 | 4 | $44,562.31 |
| 00657 | 4 | $99.00 |

## 6. Aislamiento histórico (regla 11)

- Todos los tickets se importarían con `source='LEGACY'`, `is_historical=true` y `legacy_*` de trazabilidad.
- El importador NUNCA llamará a servicios de inventario/caja/FIFO; los saldos CxC se insertan como snapshot inicial documental, sin generar abonos ni movimientos actuales.
- Reportes actuales filtrarán por origen (por defecto solo RYSA).

## 7. Reconciliación STAGING vs DRY-RUN

- Tickets: 57,258 = would_import 0 + skip 57,258 → OK
- CxC: 3,575 = would_import 232 + ready_zero 3,006 + review 269 + negative 5 + excluded 63 = 3,575 → OK

## 8. Producción verificada intacta

- clients=686 · sales=57258 · abonos=0 · products=2270 · caja_movimientos=20 · inventory_movements=45

## 9. Estrategia transaccional del futuro import

```
BEGIN
  -- por chunk de N docs:
  INSERT sales (históricos, source=LEGACY, is_historical=true)
  INSERT detalles históricos (sin tocar inventario)
  INSERT cxc snapshot (saldo inicial documental; sin FIFO ni abonos)
  -- validación de integridad del chunk
COMMIT   -- o ROLLBACK ante cualquier error; nunca dejar parcial
```

## 10. Frontend futuro (solo diseño, sin implementar)

- Clientes → Estado de cuenta → Histórico Legacy → Ticket → Detalle
- Ventas: filtro Origen (RYSA | LEGACY | Todos); ticket LEGACY solo lectura
- CxC: saldo actual + documentos Legacy pendientes
- DevTools → Legacy Migration: Discovery · Analyze · Staging · Dry Run · Review Queue · Import (bloqueado hasta autorización) · Reports

## 11. Reportes

- `/app/legacy_reports/dry_run/dry_run_summary.csv`
- `/app/legacy_reports/dry_run/tickets_would_import.csv`
- `/app/legacy_reports/dry_run/ticket_details_would_import.csv`
- `/app/legacy_reports/dry_run/cxc_would_import.csv`
- `/app/legacy_reports/dry_run/review_queue.csv`
- `/app/legacy_reports/dry_run/excluded_documents.csv`
- `/app/legacy_reports/dry_run/unmatched_customers.csv`
- `/app/legacy_reports/dry_run/unmatched_products.csv`
- `/app/legacy_reports/dry_run/negative_balances.csv`
- `/app/legacy_reports/dry_run/cancelled_documents.csv`

## 12. Veredicto

**DRY-RUN CON PROBLEMAS** · Producción sin modificar. Import NO ejecutado.
