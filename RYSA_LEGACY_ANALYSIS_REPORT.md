# RYSA LEGACY ANALYSIS REPORT (FASE 2 — ANALYZE)

Generado: 2026-08-29T23:23:46.280554+00:00 · Duración: 25.0 s · Tolerancia: $0.01 · Codificación: cp1252

## 1. Resumen ejecutivo

- 172 tablas legacy leídas; análisis sobre NOTAVTA (57,258), NVTAPAR (134,438), CUENXCOB (7,490), CXCDOCS (3,575), CAJAPAGO (54,164), CLIENTES (690), ARTICULO (2,223).
- Cargo/abono detectado por evidencia: MOVTO='C' (cargo) y MOVTO='A' (abono).
- Reconciliación documental CxC: **94.32% MATCH** (3367 H1 + 5 H2 de 3575 documentos).
- Veredicto: **BLOCKED**.

## 2. Identidad de documentos

| TABLA | ROWS | FOLIOS únicos | Colisiones FOLIO | SERIES | (SERIE,FOLIO) únicos | Duplicados | Folio en multi-serie |
|---|---|---|---|---|---|---|---|
| NOTAVTA | 57,258 | 57,258 | 0 | 1 | 57,258 | 0 | 0 |
| NVTAPAR | 57,238 | 57,238 | 0 | 1 | 57,238 | 0 | 0 |
| CUENXCOB | 7,490 | 3,578 | 3,912 | 4 | 3,583 | 3,907 | 5 |
| CXCDOCS | 3,575 | 3,571 | 4 | 3 | 3,575 | 0 | 4 |
| CAJAPAGO | 54,164 | 52,690 | 1,474 | 2 | 54,007 | 157 | 1,317 |

Series en NOTAVTA: `{'NV': 57258}`

### Cruces con NOTAVTA

| TABLA | Claves distintas | En NOTAVTA | % | Fuera |
|---|---|---|---|---|
| NVTAPAR | 57,238 | 57,238 | 100.0% | 0 |
| CUENXCOB | 3,583 | 3,519 | 98.21% | 64 |
| CXCDOCS | 3,575 | 3,512 | 98.24% | 63 |
| CAJAPAGO | 54,007 | 52,535 | 97.27% | 1,472 |

CUENXCOB con SERIENV/FOLIOMOVTO poblados: 3260 registros.

## 3. Clientes

- **NOTAVTA**: 641 claves distintas → match 622 (97.04%), borrado 0, vacío 1, inexistente 18.
- **CUENXCOB**: 154 claves distintas → match 154 (100.0%), borrado 0, vacío 0, inexistente 0.
- **CXCDOCS**: 154 claves distintas → match 154 (100.0%), borrado 0, vacío 0, inexistente 0.
- Clasificación global: `{'PÚBLICO_EN_GENERAL': 1, 'MATCH': 596, 'BORRADO': 25, 'VACIO': 1, 'INEXISTENTE': 18}`

## 4. Productos

- Códigos distintos en NVTAPAR: 2,036 → match 2,031 (99.75%), borrado 7, vacío 0, inexistente 1.
- Muestra inexistentes: `[' CPP2319-43N']`

## 5-6. Tickets y detalles

- Tickets con detalle: 57,238 (99.97%) · sin detalle: 20.
- Partidas totales: 134,438 · huérfanas: 0 (en 0 docs) · máx. partidas por doc: 97.

Clasificación de tickets:

| Categoría | Count | Monto |
|---|---|---|
| CON_DETALLE | 57,238 | 63347642.41 |
| CANCELADOS | 3,000 |  |
| CONDICION_C | 53,880 |  |
| CON_CLIENTE | 57,111 |  |
| SIN_CXC | 53,746 | 45146214.51 |
| SIN_SALDO | 55,798 | 58391349.22 |
| CONDICION_R | 3,378 |  |
| CON_CXC | 3,512 | 18210166.32 |
| NO_CANCELADOS | 54,258 |  |
| CON_SALDO | 1,460 | 4965031.61 |
| SIN_CLIENTE | 147 |  |
| SIN_DETALLE | 20 | 8738.42 |

## 7. CxC — semántica MOVTO

| MOVTO | Count | Borrados | Suma | Promedio | Mín | Máx | Negativos |
|---|---|---|---|---|---|---|---|
| (vacío) | 1 | 1 | 30.0 | 30.0 | 30.0 | 30.0 | 0 |
| A | 3,450 | 139 | 14,970,089.71 | 4339.16 | -25,338.71 | 158,034.92 | 2 |
| C | 4,039 | 556 | 18,954,225.01 | 4692.8 | 0.13 | 268,672.75 | 0 |

Suma cargos (activos): $17,175,245.769999944 · suma abonos (activos): $13,851,377.909999965

### Reconciliación documental

| Status | Docs |
|---|---|
| H1_MATCH | 3,367 |
| H2_MATCH | 5 |
| NO_MATCH | 203 |
| SIN_MOV | 0 |

CUENXCOB.SALDO por movimiento: 6,785 rows con saldo; 3,536 coinciden con CXCDOCS.SALDO (±0.01).

CXCDOCS.SALDO: positivos 507 · cero 3,063 · negativos 5 · suma total $1,660,452.77 (positivos $1,664,698.52, negativos $-4,245.75).

## 8. Pagos (CAJAPAGO)

- Rows: 54,164 (borrados 0) · conceptos: `{'01': 51981, '28': 1203, '03': 654, '04': 306, '99': 6, '02': 4, '23': 2, '12': 2, '15': 2, '06': 1}` · tipodoc: `{'n': 52692, 'f': 1472}`.
- Claves en NOTAVTA: 52,692 ($33,246,914.02) · fuera: 1,472 ($2,745,819.01).
- Documentos con pago y pago==TOTAL: 17,794 de 54,007 (33.87%).
- Por condición: `{'C': {'n': 52534, 'exactos': 17793}, 'R': {'n': 1, 'exactos': 1}}`

## 9. Cancelaciones

- Cancelados: 3,003 · total $20,843,253.93 · saldo $-2,328,069.42 · movimientos CxC asociados: 808.
- STATUS values: `{'C': 3003, 'A': 54260}`

## 10-11. Borrados y montos negativos

- MOVTO=(vacío): 1 borrados · 0 negativos (suma $0.0).
- MOVTO=A: 139 borrados · 2 negativos (suma $-43,245.18).
- MOVTO=C: 556 borrados · 0 negativos (suma $0.0).
- Escenarios comparados por documento en `cxc_reconciliation.csv` (H1=activos, H2=activos+borrados).

## 12. Reconciliación matemática

- H1 (cargo−abono activos) y H2 (incluye borrados) por documento contra CXCDOCS.SALDO → **94.32% MATCH global**.
- Diferencias detalladas por documento en `legacy_reports/analysis/cxc_reconciliation.csv`.

## 13. Fechas (distribución anual)

| Año | Tickets | Ventas | Cargos CxC | Abonos CxC | Saldo CXCDOCS | Pagos caja |
|---|---|---|---|---|---|---|
| 2024 | 1,658 | 1,686,926.19 | 358,253.91 | 187,630.03 | 0.0 | 939,947.52 |
| 2025 | 33,149 | 33,562,671.15 | 8,843,289.05 | 7,907,497.72 | 85,377.8 | 21,330,360.63 |
| 2026 | 22,456 | 28,117,721.96 | 9,752,682.05 | 6,874,961.96 | 1,575,074.97 | 13,722,424.88 |

## 14. Anomalías

- 6 anomalías registradas (detalle en `anomalies.csv`).
- IVA de NOTAVTA: consistencia SUBTOTAL+IVA==TOTAL en muestra de 19,998: 72.63% → **NO usar IVA para reconstrucción financiera**; usar TOTAL.

## 15-16. Relaciones comprobadas y desconocidas

- Comprobadas: NOTAVTA→NVTAPAR (SERIE+FOLIO), CLIENTE→CLIENTES.CLAVE, CODIGO→ARTICULO.CODIGO, CUENXCOB/CXCDOCS/CAJAPAGO→NOTAVTA (SERIE+FOLIO).
- A revisar en STAGING: significado exacto de SERIENV/FOLIOMOVTO, CONCEPTO de CAJAPAGO, documentos con diferencias de saldo.

## 17. Fuentes de verdad (por evidencia)

| Dato | Fuente | Evidencia |
|---|---|---|
| Clientes | CLIENTES (activos) | 717 registros; claves usadas por todas las tablas |
| Tickets | NOTAVTA | 57,263 docs; única tabla de cabecera |
| Detalle | NVTAPAR | 134,438 partidas enlazadas por (SERIE,FOLIO) |
| Documentos CxC | CXCDOCS | saldo declarado por documento |
| Movimientos CxC | CUENXCOB | cargos/abonos con MONTO y APLICA |
| Pagos de caja | CAJAPAGO | folio enlaza a NOTAVTA; pago==TOTAL en contado |
| Saldo histórico | CXCDOCS.SALDO validado con H1/H2 de CUENXCOB (94.32% match) |

## 18. Riesgos

- 🔴 CUENXCOB tiene movimientos fuera de NOTAVTA (clave documental incompleta)
- 🔴 reconciliación CxC solo 94.32% (umbral 95%)
- Saldos negativos en CXCDOCS/NOTAVTA (no eliminar; representan notas de crédito/ajustes).
- 696 movimientos borrados en CUENXCOB: el escenario (H1 vs H2) decide su tratamiento.
- IVA de NOTAVTA corrupto/inconsistente: excluir de reconstrucción.

## 19-20. Arquitectura recomendada y decisión

- STAGING por claves compuestas (SERIE,FOLIO) con idempotencia por origen legacy.
- Fórmula CxC: saldo = Σ(MOVTO='C') − Σ(MOVTO='A') según el escenario ganador H1/H2; reconstruir por documento y validar contra CXCDOCS.SALDO.
- **VEREDICTO: BLOCKED**
- Bloqueos a resolver antes de STAGING (ver sección 18).

---

## ADDENDUM — Evidencia adicional de segunda pasada (mismo día)

Verificaciones dirigidas posteriores al primer reporte, sobre los mismos datos:

### A1. Estructura real del ledger CUENXCOB (RESUELTA)

| Elemento | Evidencia |
|---|---|
| Cargo | MOVTO='C': 3,483 registros (SERIE+FOLIO = documento de venta; FOLIOMOVTO casi siempre vacío) |
| Abono | MOVTO='A': 3,311 registros (SERIE+FOLIO = **venta pagada**; FOLIOMOVTO = folio secuencial del abono, 3,001 poblados) |
| Series | NV: 6,686 · F (facturas): 104 · directa: 2 · vacía: 2 |
| Semántica C/A | CONFIRMADA matemáticamente: H1 (C−A activos) reproduce CXCDOCS.SALDO en 94.18% de documentos |
| Borrados | H2 (incluye borrados) solo matchea 5 docs → **los borrados DEBEN EXCLUIRSE** (Escenario A) |

### A2. Caso de prueba del prompt verificado en datos reales

`
CLIENTE 00003 · NOTAVTA NV-000037
  MOVTO C  CONCEPTO 01  MONTO .01  (cargo)
  MOVTO A  CONCEPTO 10  MONTO .00  FOLIOMOVTO 000002  (abono)
  SALDO   = .01  ✓ (coincide con el ejemplo canónico)
`

### A3. Comparación de fuentes de saldo (contra H1)

| Fuente | Match | Interpretación |
|---|---|---|
| CXCDOCS.SALDO | 94.18% | **FUENTE AUTORITATIVA** (snapshot declarado) |
| NOTAVTA.SALDO | 55.02% | STALE: solo actualizado en algunos flujos → NO usar como saldo |
| Ambos | 1904 docs | |
| Solo CXCDOCS | 1463 docs | NOTAVTA.SALDO desactualizado |
| Solo NOTAVTA | 63 docs | CXCDOCS.SALDO en 0 con saldo vivo (snapshot congelado) |
| Ninguno | 145 docs | requiere revisión dirigida |

### A4. Caracterización de los 203 desmatches (5.68%)

- 136 con CONDICION='C' (contado), 60 'R', 7 vacía · serie NV 195, F 8
- Solo 2 involucran borrados; solo 1 involucra montos negativos → NO son la causa
- Solo 1 diff ≤ .05 → NO es redondeo
- 19 docs: DIFF == SUMA(CAJAPAGO del documento) → pago registrado solo en caja
- ~60 docs: CXCDOCS.SALDO=0 con H1>0 y NOTAVTA.SALDO==H1 → snapshot congelado
- Serie 'F': cargos contra FACTURAS (no NOTAVTA) → legítimo, migrar con su tabla origen

### A5. Identidad documental (RESUELTA)

- NOTAVTA: 57,258 filas activas = 57,258 folios únicos, **0 colisiones**, serie única 'NV' → FOLIO único global en ventas
- CUENXCOB: 3,907 claves (SERIE,FOLIO) repetidas = **ledger con N movimientos por documento** (correcto)
- Identidad de movimiento CxC: (SERIE, FOLIO, MOVTO, FOLIOMOVTO, APLICA) — única combinación razonable para abonos repetidos al mismo doc
- CAJAPAGO: 157 (SERIE,FOLIO) repetidos = pagos parciales múltiples por doc (correcto)

### A6. Veredicto refinado

**BLOCKED (parcial)** — resuelto: identidad documental, fórmula CxC (H1), tratamiento de borrados (excluir), semántica C/A. Pendiente para desbloquear STAGING:

1. Decidir tratamiento de los ~203 desmatches: usar CXCDOCS.SALDO como autoritativo y marcar los desmatches para revisión manual (recomendado), O investigar caso por caso.
2. Confirmar destino de los cargos serie 'F'/'directa' (¿FACTURAS entra en esta migración o se excluye?).
3. Confirmar política para documentos CONDICION='C' con saldo (¿se migran a CxC o solo como ventas?).

**RECOMENDACIÓN:** avanzar a STAGING con la política: saldo autoritativo = CXCDOCS.SALDO; H1 como reconstrucción de trazabilidad; desmatches a cola de revisión manual; serie 'F' excluida de la primera importación (solo NV). Esto reduce el riesgo a cero inventario de decisiones no respaldadas.
