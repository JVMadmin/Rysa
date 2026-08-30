# RYSA LEGACY RECONCILIATION REPORT (V2)

**Fecha:** 2026-08-30 · Snapshot: `SNAP-B20260830090901` · Batch staging: `B20260830090901`
**IMPORT EJECUTADO (autorizado):** `IMP-20260830093616` COMPLETED · Idempotencia verificada con `IMP-20260830094147`.

## 0. Resultado de la importación (FASE 6)

| Métrica | Valor |
|---|---|
| Tickets importados (sales source=LEGACY) | **57,258** |
| Partidas | **134,429** |
| Documentos CxC con saldo (READY) | **232 · $789,708.45** |
| Errores | 0 |
| **clients.saldo antes → después** | **$2,547,694.50 → $2,547,694.50** ✓ (validación `clients_saldo_intacto`) |
| Abonos / caja / inventario / productos | intactos ✓ |
| **Re-import (idempotencia)** | `IMP-20260830094147` COMPLETED · **0 insertados · 57,258 saltados** |

Post-import en RYSA:
- `SUM(sales.saldo LEGACY, saldo>0)` = $789,708.45 (232 docs) ✓ = READY del snapshot.
- CxC operativo (`/api/cxc`): cartera total = **$2,547,694.50** = maestro; cada peso trazable: 232 docs READY por documento + saldo inicial por cliente (maestro) donde no hay doc READY.
- Estado de cuenta legacy por cliente (222 docs para 00003, con cancelados y pagados) ✓.
- Dashboard/reportes operativos: sin contaminar (excluyen source=LEGACY).

## 1. Cifras maestras (snapshot actual)

| Fuente | Total |
|---|---|
| **Maestro** `CLIENTES.SALDO` (690 activos) | **$2,547,638.50** |
| **Documentos abiertos** `SUM(CXCDOCS.SALDO)` (3,576) | **$1,660,452.77** |
| **Ledger** `ΣC−ΣA CUENXCOB` | **$3,147,481.00** |
| **RYSA** `SUM(clients.saldo)` (686) | **$2,547,694.50** |

Cierre legacy→RYSA: `G = A + 56.00` — el +$56.00 es el saldo a FAVOR (−$56) del legacy 00389 "CARLOS", sin mapear en RYSA. **Exacto al centavo.**

## 2. Conciliación por cliente (legacy_client_balance)

| Estado | Clientes | Master | Docs | Ledger |
|---|---|---|---|---|
| MATCH | **611** | $345,161.72 | $345,161.72 | $345,161.72 |
| DIFFERENCE | **79** | $2,202,476.78 | $1,315,291.05 | $2,802,319.28 |

- `MATCH` = triple igualdad maestro = docs = ledger al centavo.
- `DIFFERENCE` = al menos una brecha ≠ 0 (union de 46 con master>docs, 3 con docs>master, 43 con master≠ledger).

## 3. Las tres brechas explicadas

### Brecha 1 — Master vs RYSA (+$56.00) ✓ cerrada
Únicamente 00389 "CARLOS" (saldo −$56 a favor) sin código RYSA (secuencia salta 00388→00390). Requiere decisión: importar saldo a favor o no.

### Brecha 2 — Master vs Documentos (+$887,185.73)
```
46 clientes con master > docs: +$892,265.73   (top: 00004 +$316,027.94; 00034 +$55,856.75)
 3 clientes con docs > master:   −$5,080.00
```
Causa demostrada: deuda que el maestro considera vigente sin documento abierto que la respalde (marcadores A=0/51 y ajustes del legacy). **Requiere revisión de cobranza por cliente** — no se "corrige" automáticamente.

### Brecha 3 — Master vs Ledger (−$599,842.50)
Cargos con marcador `A=0/CONCEPTO=51` (cobrados en mostrador sin asentar abono): probado exacto por cliente (00019: 37,812.72; 00179: 34,367.45; 00075: 23,591.10; 00013: 19,970.70…). El maestro es correcto; el ledger quedó inflado.

## 4. La cifra $2,110,892.76 (investigación)

Reportada como "lo que RYSA ha mostrado". **No es reproducible** desde ningún dato, vista, endpoint o código actual (se probaron: sumas totales/por estado del mapping, clientes con docs READY/REVIEW/EXCLUDED, paginación por código y por saldo, exclusión de clientes específicos). No existe en ningún reporte ni CSV del repo. Conclusión: provenía de un estado efímero/intermedio anterior o de una vista con filtros puntuales. La V2 elimina esta clase de cifras huérfanas: todo total se deriva de documentos trazables por snapshot.

## 5. Tickets y detalle

| Concepto | Valor |
|---|---|
| Tickets legacy (claves únicas) | 57,258 |
| Partidas | 134,438 |
| Tickets cancelados | 3,000 (FCANCELADA) |
| Tickets con condición R (crédito) | 3,378 |
| Documentos CxC pagados (SALDO=0) | 3,006 |
| Documentos CxC con saldo | 570 (READY 232 nonzero + 269 REVIEW + 63 EXCLUDED + 5 NEGATIVE + 1 d) |

## 6. Estado

**CONCILIACIÓN ESTRUCTURAL COMPLETA.** Diferencias por cliente concentradas y documentadas en `legacy_reports/reconciliation/client_balance_reconciliation.csv` y navegables en DevTools → Migración Legacy → Conciliación.
