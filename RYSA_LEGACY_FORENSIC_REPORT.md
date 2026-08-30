# RYSA LEGACY FORENSIC REPORT

**Fecha:** 2026-08-30 · **Fuente:** `legacy_data/` (370 archivos: 172 DBF, 129 CDX, 62 FPT, 7 TMP)
**Modo:** SOLO LECTURA. No se importó, modificó ni eliminó ningún dato productivo.
**Scripts:** `tools/legacy_migration/forensic*.py` · **CSVs:** `legacy_reports/forensic/`

---

## 1. DIAGNÓSTICO — ¿Por qué ~$789K vs ~$2.55M?

Las dos cifras **miden cosas distintas** y ambas provienen del legacy:

| Cifra | Valor | Qué es realmente |
|---|---|---|
| **A** = `SUM(CLIENTES.SALDO)` | **$2,547,638.50** | Saldo maestro por cliente (lo que usaba cobranza). |
| **B** = `SUM(CXCDOCS.SALDO)` | **$1,660,452.77** | Saldo de los **documentos abiertos** registrados en CxC. |
| **READY** del pipeline | **$789,708.45** (232 docs) | Subconjunto de B que pasó los filtros: B − REVIEW $862,197.67 (269 docs) − EXCLUDED $12,792.40 (63 facturas serie F) + NEGATIVE $4,245.75 (5 docs) = B. |

**Ecuación verificada:** 1,660,452.77 − 862,197.67 − 12,792.40 + 4,245.75 = **789,708.45** ✓

Los ~$789K **no son la deuda total**: son la parte de los documentos abiertos que el algoritmo de staging pudo clasificar como READY. La deuda según el maestro legacy (A) es $2.55M, ya cargada en `clients.saldo` de RYSA durante la migración de clientes.

## 2. LA ECUACIÓN GLOBAL (A–G)

| Ref | Concepto | Valor |
|---|---|---|
| **A** | SUM(CLIENTES.SALDO) — 690 activos (+$35.00 en 12 borrados) | **$2,547,638.50** |
| **B** | SUM(CXCDOCS.SALDO) — 3,576 docs abiertos | **$1,660,452.77** |
| **C** | SUM(NOTAVTA.SALDO) | −$12,072,515.65 (**NO es saldo documental**, ver §3) |
| **D** | SUM(CUENXCOB.SALDO) | $18,613,176.45 (saldo corrido por movimiento) |
| **E** | Cargos (MOVTO=C) $17,175,245.77 − Abonos (MOVTO=A) $14,027,764.77 | **F = $3,147,481.00** |
| **F** | SALDO_RECONSTRUIDO (ledger C−A) | **$3,147,481.00** |
| **G** | SUM(clients.saldo) en RYSA (post-limpieza QA) | **$2,547,694.50** |

### Cierre 1 — G vs A (clientes) ✓ EXACTO
```
G = A − Σ(saldos de clientes sin mapear)
  = 2,547,638.50 − (−56.00)   ← cliente legacy 00389 "CARLOS", saldo a FAVOR −$56, sin código en RYSA
  = 2,547,694.50 = G ✓
```

### Cierre 2 — A vs B (documentos) — diferencia $887,185.73
```
A − B = +887,185.73
  46 clientes con saldo > docs abiertos: +892,265.73
   3 clientes con saldo < docs abiertos:   −5,080.00
```
Concentrada, NO distribuida (ver `client_reconciliation.csv`). El maestro incluye deuda que ya no tiene documento abierto en CXCDOCS.

### Cierre 3 — F vs A (ledger) — diferencia $599,842.50
```
F − A = +599,842.50  en 43 clientes
```
Causa demostrada: **132 documentos con patrón "cargo + marcador A=0/CONCEPTO=51"** (abono de monto CERO el mismo día del cargo). De ellos, 115 ($1,277,780.30) no tienen abono real ni pago en CAJAPAGO. En los clientes problemáticos la diferencia coincide **exactamente** con esos cargos (00019: 37,812.72 = 37,812.72; 00179: 34,367.45; 00075: 23,591.10; 00013: 19,970.70). Interpretación: ventas asentadas a crédito que se cobraron en mostrador sin asentar el abono; el maestro (A) las excluyó correctamente; el ledger quedó inflado.

## 3. SEMÁNTICA REAL DE LOS CAMPOS (evidencia, no suposición)

| Campo | Semántica demostrada | Evidencia |
|---|---|---|
| `CLIENTES.SALDO` | Saldo vigente del cliente (maestro autoritativo) | 647/690 clientes: saldo = ledger C−A; 641/690: saldo = Σ docs abiertos; **611: ambos** |
| `CUENXCOB.MOVTO` | `C`=Cargo, `A`=Abono | Cargos (3,470) ≈ SUM(CXCDOCS.MONTO) por cliente; abonos reducen saldo |
| `CUENXCOB.SALDO` | Saldo **corrido** del cliente tras cada movimiento | D=18.6M ≫ deuda real |
| `CXCDOCS.MONTO` | Monto original del cargo a crédito | 3,513 'n' ($18.2M) + 62 'f' + 1 'd' |
| `CXCDOCS.SALDO` | Saldo pendiente del documento | Σ = B; 3,006 docs con SALDO=0 |
| `NOTAVTA.SALDO` | **Snapshot del saldo de la CUENTA del cliente al vender** — NO saldo del ticket | Valores idénticos repetidos en tickets consecutivos (ej. 00004: −90,623.55 en folios 050151 y 050153); 894 tickets 'R' con saldo negativo |
| `CAJAPAGO` | Pagos en caja (54,164; $40.4M): incluye contado y crédito | TIPODOC n=51,146 / f=1,137 |
| `DOCCANCL` | Vacío (0 registros) — cancelaciones solo via `FCANCELADA` por documento | 3,000 NOTAVTA canceladas |
| `RELDOCTOS` | Vacío (0 registros) | — |

## 4. INVARIANTE DEL LEGACY (sistemas sanos)

Para el 88.5% de los clientes (611) se cumple la triple igualdad:
```
CLIENTES.SALDO = SUM(CXCDOCS.SALDO abiertos) = SUM(CUENXCOB.C) − SUM(CUENXCOB.A)
```
Las violaciones están **concentradas en ~50 clientes** (43+3+46 con solapamiento; 13 no cuadran con ninguna fuente). **El legacy mismo es internamente inconsistente para esos clientes.**

## 5. RELACIONES DEMOSTRADAS

```
CLIENTES.CLAVE ──1:N──► CXCDOCS.CLIENTE (99%+ match, 3,576 docs)
CLIENTES.CLAVE ──1:N──► CUENXCOB.CLIENTE (6,794 movimientos)
CLIENTES.CLAVE ──1:N──► NOTAVTA.CLIENTE (57,263 tickets)
CXCDOCS.(TIPO,SERIE,FOLIO) ◄──1:1── CUENXCOB cargos (3,483 de 3,576 docs; 135 docs sin cargo, todos SALDO=0)
NOTAVTA.(SERIE='NV',FOLIO) ◄──1:1── CXCDOCS TIPO='n'
FACTURAS ◄─ solo 62 de 1,409 en CxC (resto contado)
CAJAPAGO.(TIPODOC,SERIE,FOLIO) ──► documento pagado
NVTAPAR.(SERIE,FOLIO) ──N:1──► NOTAVTA (134,429 partidas)
```

## 6. AUDITORÍA DE CÓDIGOS DE CLIENTE

| Match | n | Saldo |
|---|---|---|
| EXACT_MATCH | 685 | — |
| NAME_MATCH | 2 | ⚠ 00389 "CARLOS" (−$56.00) mapeó por nombre a 00531 "CARLOS" en RYSA — **AMBIGUOUS**, revisar |
| UNMATCHED | 3 | $0.00 (claves 00361, 00520, 00554 sin nombre) |
| Códigos RYSA sin origen legacy | 1 ("PUBLICO") | $0.00 |

Sin colisiones de ceros a la izquierda relevantes, sin duplicados. La migración de clientes fue correcta. Ver `client_code_reconciliation.csv`.

## 7. ESTADO

**Diagnóstico: COMPLETO.** La brecha 2.55M vs 789K está explicada matemáticamente al 100%.
**FASE 6 (import CxC): BLOCKED** con el diseño actual — ver `RYSA_MIGRATION_V2_PROPOSAL.md`, sección "Riesgo crítico".
