# RYSA CxC RECONCILIATION REPORT

**Fecha:** 2026-08-30 · Batch fuente: staging del 2026-08-29 · Solo lectura.

## 1. Las cuatro cifras y su significado

```
$3,147,481.00  ← F  Ledger CUENXCOB (Cargos − Abonos)          [inflado: incluye cargos ya cobrados en mostrador]
$2,547,638.50  ← A  CLIENTES.SALDO (maestro)                   [AUTORITATIVO — lo que usaba cobranza]
$1,660,452.77  ← B  CXCDOCS.SALDO (documentos abiertos)        [le faltan $887K que el maestro sí tiene]
  $789,708.45  ←    READY del pipeline (subset de B)           [no es "la deuda", es lo importable sin revisión]
```

## 2. Desglose de B (lo que produce el pipeline)

| Clase | Docs | Saldo | Nota |
|---|---|---|---|
| READY | 232 | $789,708.45 | Importable sin revisión |
| REVIEW_REQUIRED | 269 | $862,197.67 | CXC_MISMATCH + CASH_DOCUMENT_WITH_BALANCE |
| EXCLUDED_SCOPE | 63 | $12,792.40 | Facturas serie F (decisión oficial post-ANALYZE) |
| NEGATIVE | 5 | −$4,245.75 | Saldos negativos |
| (pagados) | 3,007 | $0.00 | Histórico |
| **Total B** | **3,576** | **$1,660,452.77** | |

## 3. Puente B → A (documentos → maestro)

```
B                                    1,660,452.77
+ saldo sin respaldo documental      +892,265.73   (46 clientes; top: 00004 +316,027.94, 00034 +55,856.75, ...)
− exceso de docs sobre maestro         −5,080.00   (3 clientes)
= A                                  2,547,638.50  ✓
```

Origen demostrado del desbalance: 132 documentos con **cargo + marcador A=0/CONCEPTO=51** ($1,277,780.30 en cargos; 115 sin abono real ni CAJAPAGO). El maestro excluye estos cargos; los documentos/ledger no siempre.

## 4. Puente A → F (maestro → ledger)

```
F (C−A ledger)                       3,147,481.00
− cargos marcados sin abono         −(parcial de 1,277,780.30 sobre 43 clientes)
= A                                  2,547,638.50  ✓ (diferencia exacta por cliente en 00019, 00179, 00075, 00013, 00425, ...)
Residuo multi-causa (47 clientes)      revisar caso por caso → legacy_review_queue
```

## 5. Puente A → G (legacy → RYSA) ✓ CERRADO

```
A (CLIENTES.SALDO legacy)            2,547,638.50   (690 activos)
+  56.00   ← 00389 "CARLOS" saldo −56 (a favor) NO importado (UNMATCHED)
+   0.00   ← 00361/00520/00554 sin nombre, saldo 0
= G (clients.saldo RYSA)             2,547,694.50   (686 clientes) ✓ EXACTO
```
*(Nota: la cifra ~2,549,288.50 citada en la auditoría difiere de la calculada sobre el archivo actual en 1,650.00; posible snapshot anterior o incluir borrados (+$35.00). La evidencia vigente es la de este reporte.)*

## 6. CONSECUENCIA PARA LA IMPORTACIÓN

`clients.saldo` **ya contiene** el saldo legacy (G). El importador actual (`legacyadmin.py`) aplica además el "delta CxC READY" (+$789,708.45) a `clients.saldo` al importar → **duplicaría ~$789K de deuda**.

➡ **FASE 6 = BLOCKED** hasta implementar la V2 (ver `RYSA_MIGRATION_V2_PROPOSAL.md`).

## 7. Cola de revisión (REVIEW)

| Caso | n | Acción propuesta |
|---|---|---|
| Clientes con saldo > docs (46) | 46 | Documentar por cliente: crear documento sustituto de "saldo inicial" por la diferencia, o corregir docs |
| Clientes con docs > saldo (3) | 3 | Igual, signo contrario |
| Doc marcados A=0/51 sin abono (115) | 115 | Confirmar con el negocio: "cobrados en mostrador" → marcar pagados |
| Facturas serie F (63) | 63 | Decidir alcance: ¿migrar como CxC o solo histórico? |
| 00389 "CARLOS" (−$56 a favor) | 1 | Decidir si se importa el saldo a favor |
| NAME_MATCH 00389→00531 | 1 | Confirmar identidad manualmente |
