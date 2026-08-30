# RYSA MIGRATION V2 PROPOSAL

**Fecha:** 2026-08-30 · Estado: PROPUESTA — no ejecutar sin aprobación.

## ⛔ RIESGO CRÍTICO (por qué FASE 6 está BLOCKED)

`legacyadmin.py` importa `sales` LEGACY y además aplica a `clients.saldo` el "delta CxC READY" (+$789,708.45).
**`clients.saldo` ya contiene el saldo legacy ($2,547,694.50).** Ejecutar el import actual
crearía **deuda duplicada de ~$789K**. Cambio requerido ANTES de cualquier import:
`_run_import()` NO debe tocar `clients.saldo`.

## 1. Principio de diseño

```
SALDO OPERATIVO (clients.saldo)   = ya migrado (maestro legacy)  → NO se recalcula
HISTÓRICO (sales source=LEGACY)   = documentos consultables      → import masivo
MOVIMIENTOS (abonos FIFO)         = motor actual sin cambios     → aplica sobre docs LEGACY
EVIDENCIA (legacy_* staging)      = intacta, trazable al DBF     → nunca se borra
```

Invariante V2 a garantizar post-import:
```
clients.saldo = SUM(sales.saldo WHERE source=LEGACY)
              + SUM(sales.saldo WHERE source=RYSA)
              + SUM(ajustes_apertura pendientes de resolver)
```

## 2. Flujo V2

```
1. IMPORT HISTÓRICO (57,258 tickets + 134,429 partidas)
   → sales source=LEGACY, SOLO LECTURA operativa, sin inventario/caja/comisiones
   → estado por doc: PAID / PARTIAL / OPEN / UNKNOWN (desde CXCDOCS.SALDO)

2. IMPORT CxC DOCUMENTAL (en lugar del "delta de saldo")
   → todos los docs abiertos de CXCDOCS como sales LEGACY con su saldo:
       READY    232  $789,708.45
       REVIEW   269  $862,197.67   ← tras resolución manual en legacy_review_queue
       EXCLUDED  63  $ 12,792.40   ← facturas F: decidir alcance
       NEGATIVE   5  $ −4,245.75
   → clients.saldo NUNCA se modifica en este paso

3. AJUSTES DE APERTURA (solo tras revisión de cobranza)
   → por cada uno de los 46 clientes "saldo > docs" ($892,265.73):
      crear doc LEGACY tipo AJUSTE_APERTURA por la diferencia, con referencia al
      batch y a la evidencia DBF; NUNCA un ajuste global "para cuadrar".
   → 3 clientes "docs > saldo" ($5,080.00): mismo mecanismo en negativo.
   → 00389 "CARLOS" (−$56 a favor): importar o descartar por decisión explícita.

4. VALIDACIÓN DE CIERRE (gate de aceptación)
   SUM(sales.saldo LEGACY) + SUM(sales.saldo RYSA) + ajustes == clients.saldo
   por cliente y global, con tolerancia $0.02. Falla → batch queda FAILED, rollback.
```

## 3. Cambios puntuales al código actual

| # | Cambio | Archivo |
|---|---|---|
| 1 | Eliminar el "delta clients.saldo" del import | `legacyadmin.py::_run_import` |
| 2 | Importar también docs REVIEW ya resueltos (estado en `legacy_review_queue`) | `legacyadmin.py` |
| 3 | Tipo doc `AJUSTE_APERTURA` (source=LEGACY, trazable, revertible por batch) | `legacyadmin.py` |
| 4 | Gate de cierre por cliente (§2.4) antes de marcar batch IMPORTED | `legacyadmin.py::_validate_import` |
| 5 | Confirmación textual y guardas existentes se conservan ✓ | — |

## 4. Errores: política (sin ocultar nada)

| Clase | Tratamiento |
|---|---|
| AUTO_FIX | Solo normalizaciones determinísticas (ceros, espacios) — ya funcionando |
| REVIEW | `legacy_review_queue` (ya existe; 269 docs + 50 clientes) |
| BLOCKER | Detienen el batch (integridad staging, identidad, backup) |
| EXCLUDED | Visible y reportado (63 facturas F) |

## 5. Rollback

Por `migration_batch_id` (ya implementado en `legacyadmin.py`): borra `sales` LEGACY del batch y revierte deltas de `clients.saldo` usando `legacy_import_audit`. En V2, como no se toca `clients.saldo`, el rollback es puramente documental y seguro.

## 6. Orden de ejecución propuesto

1. Aprobación del negocio: alcance facturas F + política de marcados A=0/51.
2. Revisión de los 46+3 clientes por cobranza (pantalla Reconciliación).
3. Código V2 (cambios §3) + pruebas (idempotencia, rollback, gate de cierre).
4. Dry-run completo → reporte de simulación con cifras exactas.
5. IMPORT HISTÓRICO → IMPORT CxC → AJUSTES (por cliente, aprobados) → VALIDACIÓN.
6. Reconciliación final y firma.
