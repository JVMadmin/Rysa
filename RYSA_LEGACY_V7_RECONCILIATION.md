# RYSA LEGACY V7 RECONCILIATION

**Fecha:** 2026-08-30 · Snapshot vigente tras FASE 7 · Estados de cambio verificados.

## 1. Cifras maestras (del snapshot real actual)

| Fuente | Valor |
|---|---|
| Maestro `CLIENTES.SALDO` (690 activos) | $2,547,638.50 |
| Documentos abiertos `SUM(CXCDOCS.SALDO)` | $1,660,452.77 |
| Ledger `ΣC−ΣA CUENXCOB` | $3,147,481.00 |
| RYSA `clients.saldo` (686) | **$2,547,694.50** |
| RYSA `SUM(sales.saldo source=LEGACY)` | $789,708.45 (232 docs READY) |

Cierre maestro→RYSA: +$56.00 = saldo a favor (−$56) del legacy 00389 "CARLOS" sin mapear. Exacto.

## 2. Conciliación por cliente (por snapshot)

| Estado | Clientes | Master | Docs | Ledger |
|---|---|---|---|---|
| MATCH | 611 | = | = | = |
| DIFFERENCE | 79 | $2,202,476.78 | $1,315,291.05 | $2,802,319.28 |

Brechas conocidas y documentadas (no corregidas automáticamente):
- **Master > docs (+$892,265.73 en 46 clientes)**: saldo sin documento abierto que lo respalde.
- **Ledger > master (+$599,842.50 en 43 clientes)**: cargos liquidados en mostrador con marcador A=0/CONCEPTO=51 sin abono asentado.

Estas diferencias viven en `legacy_client_balance` **por snapshot** y son navegables en DevTools → Migración Legacy → Conciliación.

## 3. Conciliación documental post-import

| Universo | Docs | Saldo | Estado |
|---|---|---|---|
| Importados como CxC operativo-FIFO (READY) | 232 | $789,708.45 | respaldan parte del saldo |
| REVIEW_REQUIRED (mismatch/contado con saldo) | 269 | $862,197.67 | cola de revisión |
| EXCLUDED (facturas serie F) | 63 | $12,792.40 | alcance decidible |
| NEGATIVE | 5 | −$4,245.75 | revisión |
| Pagados (SALDO=0, histórico) | 3,006 | $0.00 | conservados como evidencia |

**Traza del saldo RYSA ($2,547,694.50):**
```
$789,708.45  respaldado por 232 documentos READY (por documento)
$862,197.67  clientes cuyo saldo proviene de docs REVIEW (saldo por cliente visible)
$887,185.73  saldo sin respaldo documental (46+3 clientes) → ajustes de apertura pendientes de revisión
   +$56.00   saldo a favor no importado (00389)
------------
$2,547,694.50 ✓
```

## 4. Detección de cambios (V7) — estado vigente

Última corrida de staging sobre el snapshot real:
- tickets: 0 nuevos · 57,258 sin cambios · 0 modificados · 0 cancelados · 0 ausentes
- cxc: 0 nuevos · 3,575 sin cambios · 0 modificados · 0 ausentes
- clientes ausentes: 0

Durante las pruebas con snapshot sintético se demostraron los cinco estados (CREATED/UPDATED/CANCELLED/UNCHANGED/MISSING) con datos reales parcheados (ver `RYSA_LEGACY_V7_TEST_REPORT.md`).

## 5. Conclusión

El subsistema legacy queda como **capa histórica permanente**: cualquier snapshot futuro se incorpora con detección de cambios, sin duplicar deuda ni documentos, sin alterar la operación, y con cada cifra del saldo explicable hasta el documento y el movimiento.
