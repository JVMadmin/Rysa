# RYSA LEGACY DATA DICTIONARY

**Fecha:** 2026-08-30 · Encoding: cp1252 · Formato: FoxPro/dBase (FPT memo) · Solo campos relevantes.

## CLIENTES.dbf — maestro de clientes
| Campo | Tipo | Significado demostrado |
|---|---|---|
| CLAVE | C | PK código de cliente (formato `00003`) |
| NOMBRE | C | Razón social |
| SALDO | N | **Saldo maestro vigente** (Σ docs abiertos ≈ ledger C−A en 88.5% de clientes) |
| CREDITO | L | Cliente con crédito habilitado |
| LIMCREDITO / DIASCREDIT | N | Condiciones de crédito |
| STATUS | C | Estado del registro |

## NOTAVTA.dbf — tickets de venta
| Campo | Significado |
|---|---|
| SERIE / FOLIO | Identidad del ticket (`NV` + folio) |
| CLIENTE | FK → CLIENTES.CLAVE |
| CONDICION | `C` contado · `R` crédito |
| TOTAL | Importe total |
| FCANCELADA | Fecha de cancelación (si aplica) |
| SALDO | ⚠ **NO es saldo del ticket**: snapshot del saldo de la CUENTA del cliente al momento de la venta |
| NCRED_TOT / VENDEDOR / CAJAPAGO | nota de crédito asociada / vendedor / folio de pago |

## NVTAPAR.dbf — partidas de tickets
SERIE+FOLIO+PARTIDA (PK compuesta) · CODIGO (→ARTICULO) · CANTIDAD · PRECIO · PRECIONETO · DESCUENTO · COSTO. Sin campo IMPORTE (se calcula CANTIDAD×PRECIO).

## CXCDOCS.dbf — documentos a crédito
| Campo | Significado |
|---|---|
| TIPO | `n` nota de venta · `f` factura (62) · `d` otro (1) |
| SERIE / FOLIO | Doc origen (NV-xxxx) |
| CLIENTE | FK → CLIENTES.CLAVE |
| MONTO | Monto original del cargo |
| SALDO | **Saldo pendiente del documento** |
| TOTAL | Vacío en este dataset (0) |
| APLICA / VENCE | Fechas |

## CUENXCOB.dbf — ledger de movimientos de cuenta
| Campo | Significado |
|---|---|
| MOVTO | `C` cargo · `A` abono |
| TIPO / SERIE / FOLIO | Documento al que aplica (TIPO='' en pagos no referenciados) |
| CLIENTE | FK → CLIENTES.CLAVE |
| MONTO | Importe del movimiento |
| SALDO | ⚠ Saldo **corrido** de la cuenta tras el movimiento (NO pendiente del doc) |
| CONCEPTO | `01` cargo venta · `10` pago · `05` pago · `51` marcador (ver §anomalías) · `03/04/60/71/72` ajustes · `30/93` otros cargos |
| APLICA | Fecha de aplicación |
| FOLIOMOVTO | Folio interno del movimiento |

## CAJAPAGO.dbf — pagos en caja
TIPODOC (`n`/`f`) · SERIE/FOLIO del doc pagado · CONCEPTO (01 pago de nota, 03, 28…) · MONTO/TOTAL · FECHA · CIERRE. 54,164 registros. No tiene CLIENTE (se infiere vía doc).

## Otras tablas relevantes
- **FACTURAS.dbf**: 1,409 facturas (CONDICION 'C'); su SALDO no es confiable (mayoría contado).
- **ARTICULO.dbf**: catálogo legacy (CODIGO PK, DESCRIP, UNIMEDIDA, COSTO, PRECIOS…).
- **TICKETS.dbf / TICKPAR.dbf**: tickets POS resumidos (sin cliente).
- **NOTACRED / NOTADEV / NOTASDBT**: notas (sin registros activos con saldo).
- **DOCCANCL / RELDOCTOS**: vacías.
- **CONCEPTO.dbf**: catálogo de conceptos (tipos I/C/P/H).
- **TJPUNTOS.dbf**: tarjeta de puntos (SALDO propio, no CxC).
