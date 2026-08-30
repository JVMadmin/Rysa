# RYSA CLIENT RECONCILIATION REPORT

**Fecha:** 2026-08-30 · Fuentes: `CLIENTES.dbf` (legacy) y `clients` (PostgreSQL RYSA). Solo lectura.

## 1. Resumen

| Métrica | Legacy | RYSA |
|---|---|---|
| Clientes activos | 690 | 686 (tras limpieza de residuos de pruebas) |
| Saldo total | **$2,547,638.50** | **$2,547,694.50** |
| Saldo positivo | $2,547,638.50 + | $2,547,694.50 |
| Saldo negativo | $0.00 (hay un cliente −$56: 00389 CARLOS) | $0.00 |
| Borrados (deleted) | 12 registros, $35.00 — NO importados ✓ | — |

**Diferencia total: +$56.00** = saldo a favor (−$56) del legacy 00389 "CARLOS", que no se importó por no tener correspondencia en RYSA. **Cierre exacto.**

## 2. Calidad del mapeo de códigos

| Tipo | n | Confianza |
|---|---|---|
| EXACT_MATCH (CLAVE = codigo) | 685 | HIGH |
| NAME_MATCH | 2 | MEDIUM ⚠ |
| UNMATCHED | 3 | — (sin nombre, saldo 0) |

- **Sin** duplicados de código, **sin** colisiones por ceros a la izquierda (formato legacy `00003` = formato RYSA), **sin** espacios residuales.
- 00389 "CARLOS" (−$56.00) no existe en RYSA (secuencia salta 00388→00390). El NAME_MATCH hacia 00531 "CARLOS" es ambiguo → revisar identidad antes de importar saldo a favor.
- 00361, 00520, 00554: fichas vacías sin saldo → pueden omitirse.
- 1 código RYSA sin origen legacy: `PUBLICO` ($0) junto a `00001 PÚBLICO EN GENERAL` — benigno, revisar si se unifica.

## 3. Integridad del saldo importado

La migración de clientes **ya trajo el SALDOS legacy** a `clients.saldo` (comparación por cliente en `client_code_reconciliation.csv`): 685/690 con saldo idéntico al centavo.

## 4. Clientes con inconsistencia interna legacy (auditoría CxC)

Lista completa en `client_reconciliation.csv` (ordenada por |diferencia|) y `unexplained_balances_top.csv`:

| Grupo | n | Implicado |
|---|---|---|
| saldo maestro > Σ docs abiertos | 46 | $892,265.73 |
| Σ docs abiertos > saldo maestro | 3 | $5,080.00 |
| maestro ≠ ledger C−A | 43 | $599,842.50 |
| no cuadra con ninguna fuente | 13 | revisión individual |

Top diferencias: 00004 ARISTEO ARZOLA GARCIA (maestro $439,496.87 / docs $123,468.93 / ledger $814,800.52), 00034 BLANCA ITZEL PEREZ HERNANDEZ ($179,877.46 / $124,020.71 / $47,577.37), 00358 POBLANO GILDARDO, 00019 ROED, 00003 SANTOS PEREZ…

**Estos clientes NO deben corregirse automáticamente**: requieren revisión por cobranza con el estado de cuenta legacy en mano.
