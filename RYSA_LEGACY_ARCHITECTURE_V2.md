# RYSA LEGACY ARCHITECTURE V2

**Fecha:** 2026-08-30 · Estado: IMPLEMENTADA EN STAGING — import productivo NO ejecutado.

## 1. Principios

| Prioridad | Regla |
|---|---|
| INTEGRIDAD | `clients.saldo` nunca se modifica por el import (ya contiene el maestro legacy) |
| TRAZABILIDAD | todo registro sabe de qué archivo DBF, tabla, snapshot y batch viene |
| REPRODUCIBILIDAD | un snapshot nuevo se procesa completo sin depender del estado anterior |
| OPERACIÓN | operativo (RYSA) e histórico (LEGACY) físicamente separados |
| COMODIDAD | vistas por usuario con filtros "Origen: Todos / RYSA / LEGACY" |

## 2. Las tres capas (nunca mezcladas)

```
A. SALDO OPERATIVO    → clients.saldo        (maestro, ya migrado del legacy)
B. SALDO HISTÓRICO    → legacy_client_balance (snapshot por batch: master/docs/ledger)
C. DOCUMENTOS         → legacy_tickets + legacy_cxc_snapshot (+ futuro sales LEGACY)
D. EVIDENCIA          → legacy_data/*.dbf + doc JSONB originales en staging
```

## 3. Cambios implementados (código)

| Componente | Cambio |
|---|---|
| `tools/legacy_migration/staging.py` | Lee `CLIENTES.SALDO`; crea `legacy_snapshots` (registro versionado) y `legacy_client_balance` (master vs docs vs ledger por cliente, con `snapshot_id`); CSVs en carpetas temáticas |
| `backend/legacyadmin.py` | **ELIMINADO el delta `clients.saldo`** (riesgo crítico de duplicar ~$789K); nueva validación `clients_saldo_intacto` (antes/después) que falla el batch si el saldo cambia; nuevo endpoint `GET /api/legacy/reconciliation`; `_ensure_tables` crea las tablas V2 |
| `frontend/src/pages/LegacyMigration.jsx` | Nueva pestaña **Conciliación**: totales maestro/docs/ledger, filtros MATCH/DIFFERENCE/REVIEW, tabla de diferencias con semáforo |

## 4. Flujo V2 (idempotente y reproducible)

```
legacy_data/ (cualquier copia, cualquier fecha)
   ↓ DISCOVERY → ANALYSIS → STAGING (nuevo snapshot_id por corrida)
   ↓ DRY-RUN (idempotencia verificada en 2 pasadas)
   ↓ IMPORT (sales LEGACY documental, saldo intacto)
   ↓ VALIDACIÓN (clients_saldo_intacto + tablas_intactas + ecuaciones)
   ↓ RECONCILIACIÓN (legacy_client_balance + cola de revisión)
```

Identidad estable de documentos: `LEGACY:SERIE:FOLIO` (tickets/CxC), `:PARTIDA` (detalles). Re-importar el mismo snapshot = 0 duplicados; un snapshot nuevo actualiza por upsert y crea SU propio snapshot de balances, conservando los anteriores (§16 del prompt).

## 5.Qué pasa si mañana llega `legacy_data` actualizado

1. `python -m tools.legacy_migration stage` → nuevo batch + `SNAP-B<fecha>` con los saldos de ESA copia.
2. `legacy_client_balance` conserva el snapshot anterior (PK incluye `snapshot_id`).
3. `GET /api/legacy/reconciliation` muestra siempre el más reciente; los anteriores quedan consultables por `snapshot_id`.
4. Diferencias entre snapshots = movimientos del negocio entre copias (nuevos tickets/pagos/bajas), visibles por cliente.
