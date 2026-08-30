# RYSA LEGACY V7 ARCHITECTURE

**Fecha:** 2026-08-30 · Subsistema histórico permanente, reproducible, idempotente, trazable y seguro.

## 1. Cuatro capas conceptuales (implementadas)

```
CAPA 1 — CLIENTE RYSA            clients.id (UUID interno, estable, nunca el código legacy como PK)
   ↕ mapping N:1                  legacy_customer_mapping (legacy_customer_key → rysa_customer_id,
                                   status MATCHED/UNMATCHED/DELETED_LEGACY/PUBLICO_GENERAL,
                                   missing_from_snapshot V7)
CAPA 2 — SNAPSHOT LEGACY         legacy_snapshots (snapshot_id=SNAP-B<batch>, fecha, origen,
                                   source_hash de archivos, files_count) + legacy_client_balance
                                   (master/docs/ledger POR snapshot — historia de saldos versionada)
CAPA 3 — DOCUMENTOS              legacy_tickets / legacy_cxc_snapshot (identidad estable
                                   LEGACY:SERIE:FOLIO, snapshot-independiente; document_hash +
                                   change_status + missing_from_snapshot V7)
CAPA 4 — DETALLE                 legacy_ticket_details (partidas con legacy_codigo/descripción;
                                   sin producto RYSA = PRODUCT_REVIEW_REQUIRED, la partida NUNCA
                                   se pierde) + legacy_cxc_movements (ledger evidencia)
```

## 2. Detección de cambios (V7)

Cada corrida de staging calcula `document_hash` (sha256 del contenido relevante) por ticket y documento CxC y lo compara contra el estado previo en BD:

| Estado | Significado |
|---|---|
| CREATED | documento nuevo no visto antes |
| UNCHANGED | hash idéntico → sin cambios |
| UPDATED | hash distinto (total, cliente, vendedor, fecha…) |
| CANCELLED | pasó a cancelado (FCANCELADA) |
| MISSING_FROM_SNAPSHOT | estaba en snapshots previos y ya no aparece — **nunca se borra**, solo se marca |

Reglas: un snapshot vacío no marca nada como missing; un documento que reaparece se des-marca automáticamente; los snapshots anteriores nunca se destruyen.

## 3. Flujo permanente

```
legacy_data/ (cualquier copia, cualquier fecha)
   ↓ DISCOVERY → ANALYSIS
   ↓ SNAPSHOT (legacy_snapshots + legacy_client_balance)
   ↓ MATCHING (clientes: código exacto → borrados → público → legacy-activo → REVIEW)
   ↓ STAGING (upserts idempotentes + detección de cambios + ausencias)
   ↓ RECONCILIATION (maestro vs docs vs ledger por cliente; MATCH/DIFFERENCE/REVIEW)
   ↓ DRY RUN (simulación + idempotencia en 2 pasadas)
   ↓ IMPORT (sales source=LEGACY; clients.saldo INVARIABLE; validación dura)
   ↓ POST VALIDATION → COMPLETED / COMPLETED_WITH_WARNINGS / FAILED / ROLLED_BACK
```

## 4. Matriz Legacy → RYSA

| Legacy | RYSA | Mecanismo | Efecto operativo |
|---|---|---|---|
| CLIENTES.CLAVE/SALDO | clients.id / clients.saldo | mapping exacto; saldo maestro YA migrado (una sola vez) | saldo operativo = fuente única |
| NOTAVTA + NVTAPAR | sales source=LEGACY (doc JSONB + saldo) | import idempotente por clave estable | consulta histórica; sin inventario/caja/comisiones |
| CXCDOCS (SALDO) | sales.saldo (docs READY) | solo READY (>0.01) al importar | FIFO aplicable; REVIEW queda en cola |
| CUENXCOB | legacy_cxc_movements | evidencia ledger | reconstrucción/auditoría |
| ARTICULO | products (si match) / legacy_codigo (si no) | mapping independiente | partidas históricas completas |
| CLIENTES.SALDO histórico | legacy_client_balance.master_saldo | snapshot por corrida | evolución de saldos auditable |

## 5. Diagrama de relaciones (flujo del saldo)

```
CLIENTE (CLIENTES.CLAVE → clients.id)
   ↓ 1:N
DOCUMENTO (NOTAVTA → sales LEGACY; CXCDOCS → saldo)
   ↓ 1:N
DETALLE (NVTAPAR → items con legacy_codigo/producto RYSA nullable)
   ↓
MOVIMIENTOS (CUENXCOB: MOVTO C/A ↔ legacy_cxc_movements)
   ↓
ABONOS/PAGOS (conceptos 10/05 reales; 51 marcador; CAJAPAGO evidencia de caja)
   ↓
SALDO (clients.saldo = maestro operativo)
        + legacy_client_balance: master vs docs vs ledger por snapshot
        + diferencia explicada por evidencia, NUNCA ajustada automáticamente
```

## 6. Garantías

- **Idempotencia**: mismo snapshot N veces → 0 duplicados (probado: 2do import = 57,258 saltados).
- **No destructivo**: MISSING se marca, no se borra; snapshots versionados; rollback por batch.
- **Operación intacta**: clients.saldo inválido si cambia → batch FAILED; caja/inventario/abonos/productos verificados pre/post.
- **Seguridad**: 5 capas backend; permisos developer NO heredados por `*` (verificado por test).
- **Independencia de cifras**: cero constantes del snapshot anterior en runtime; pruebas con snapshot sintético distinto pasan íntegras.

## 7. Cambios de código de esta fase (reporte)

| Archivo | Cambio |
|---|---|
| `tools/legacy_migration/staging.py` | Lee SALDO de CLIENTES; ALTERs V7 (document_hash/change_status/missing_from_snapshot en tickets, cxc y mapping); clasificación CREATED/UNCHANGED/UPDATED/CANCELLED; marcado MISSING; upserts sincronizan legacy_cancelado/fecha/etc.; validations + `cambios`; CSVs `snapshots/changes_vs_previous.csv` y carpetas temáticas |
| `backend/legacyadmin.py` | `_ensure_tables` crea tablas V2; endpoint `GET /legacy/snapshots`; status incluye `snapshot` + `cambios`; (V2 previo: delta saldo eliminado, `clients_saldo_intacto`) |
| `frontend/src/pages/LegacyMigration.jsx` | Pestaña **Snapshots** con historial versionado y contadores de cambios |
| `tools/legacy_migration/v7_selftest.py` | Self-test de 20 verificaciones (17 pruebas del prompt) |

Scripts forenses de análisis puntual (`forensic_*.py`) conservados como evidencia; no forman parte del runtime.
