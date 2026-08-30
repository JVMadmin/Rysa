# RYSA LEGACY RELATIONSHIP MAP

**Fecha:** 2026-08-30 · Todas las relaciones verificadas con datos reales (`legacy_data/`, 370 archivos). Nada asumido por nombre.

## 1. Mapa maestro

```
CLIENTES.dbf (CLAVE PK, SALDO maestro, NOMBRE, CREDITO, LIMCREDITO)
   │  1:N por CLIENTE.CLAVE
   ├──► NOTAVTA.dbf        (tickets; SERIE+SERIENV, FOLIO; CONDICION C/R; FCANCELADA)
   │        └── NVTAPAR.dbf (partidas; SERIE+FOLIO+PARTIDA → CODIGO → ARTICULO)
   ├──► FACTURAS.dbf       (1,409; CONDICION 'C'; solo 62 en CxC)
   ├──► CXCDOCS.dbf        (documentos a crédito: TIPO n/f/d; MONTO cargo, SALDO pendiente)
   │        └── 1:1 ◄── CUENXCOB cargos (MOVTO=C, TIPO/SERIE/FOLIO = doc origen)
   ├──► CUENXCOB.dbf       (ledger: MOVTO C=cargo / A=abono; SERIE/FOLIO = doc; APLICA fecha)
   └──► CAJAPAGO.dbf       (pagos en caja; TIPODOC n/f + SERIE/FOLIO del doc pagado)
```

## 2. Evidencia por relación

| Relación | Evidencia | Confianza |
|---|---|---|
| CLIENTES→CXCDOCS | match 99%+ de claves; 3,576 docs sobre 690 clientes | HIGH |
| CXCDOCS↔CUENXCOB cargos | 3,483 de 3,576 docs tienen cargo exacto; 135 sin cargo (todos SALDO=0, pagados) | HIGH |
| CUENXCOB MOVTO C/A | Σ cargos ≈ Σ CXCDOCS.MONTO por cliente; abonos reducen saldo del doc | HIGH |
| NOTAVTA↔CXCDOCS | CXCDOCS TIPO='n' + SERIE='NV' + FOLIO = NOTAVTA; 3,513 ≈ tickets con condición R | HIGH |
| NOTAVTA↔NVTAPAR | folio+partida; 134,438 partidas | HIGH |
| CAJAPAGO→docs | TIPODOC/SERIE/FOLIO; 54,164 pagos $40.4M (contado+crédito) | HIGH |
| NOTAVTA.SALDO | **NO es saldo del ticket**: snapshot del saldo de la cuenta del cliente al vender (valores repetidos en folios consecutivos) | DEMOSTRADO |
| CLIENTES.SALDO | maestro: = Σ docs abiertos en 641/690; = ledger C−A en 647/690; ambos en 611 | DEMOSTRADO |
| DOCCANCL / RELDOCTOS | vacías (0 registros); cancelaciones solo vía FCANCELADA por documento | VERIFICADO |

## 3. Construcción del saldo

```
CLIENTE (CLIENTES.CLAVE)
   ↓ 1:N
TICKET (NOTAVTA, condición R = crédito)
   ↓ 1:1
CARGO (CUENXCOB MOVTO=C ↔ CXCDOCS.MONTO; doc identificado por TIPO+SERIE+FOLIO)
   ↓ 1:N
ABONOS (CUENXCOB MOVTO=A; concepto 10 pago, 05, 51 marcador, 03/04/60/71/72 ajustes)
   ↓
SALDO DEL DOCUMENTO = CXCDOCS.SALDO
SALDO DEL CLIENTE   = CLIENTES.SALDO (maestro) ≈ Σ saldos de docs ≈ ΣC−ΣA
```

## 4. Anomalías documentadas (no corregidas, conservadas como evidencia)

1. **Marcador A=0/CONCEPTO=51**: 132 docs con cargo + abono de monto 0 el mismo día; 115 ($1,277,780.30) sin abono real ni CAJAPAGO → cobro en mostrador sin asentar. El maestro los excluye; el ledger no.
2. **135 docs CXCDOCS sin cargo en ledger** (todos SALDO=0, $1,220,490.08 histórico pagado).
3. **NOTAVTA.SALDO** nunca debe usarse como saldo de documento.
4. **NOTAVTA con folios duplicados**: 5 claves colisionadas (57,263 leídos → 57,258 claves únicas).
