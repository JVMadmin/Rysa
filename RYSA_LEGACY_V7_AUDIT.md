# RYSA LEGACY V7 AUDIT

**Fecha:** 2026-08-30 · Auditoría previa a la reingeniería V7 (sin modificaciones aún).

## 1. Modificadores de `clients.saldo` (única fuente operativa)

| # | Ubicación | Efecto | Evaluación |
|---|---|---|---|
| 1 | `pgstore/pos.py:188` | `+` al vender a crédito (columna + JSONB juntas) | ✓ correcto, transaccional |
| 2 | `pgstore/cxc.py:101-107` | `−` al abonar (FIFO con `FOR UPDATE`) | ✓ correcto |
| 3 | `pgstore/cxc.py` (cancelar abono) | revierte el abono | ✓ correcto |
| 4 | `server.py:5557-5575` | importador de clientes con flag explícito `actualizar_saldo` | ✓ explícito, opt-in |
| 5 | `legacyadmin.py` (import legacy) | ~~delta CxC~~ **eliminado en V2**; hoy `saldo_policy_v2` = no-op auditado | ✓ corregido |
| 6 | `legacyadmin.py:857` (rollback) | revierte deltas `client_saldo_delta` (bajo V2 no existen) | ✓ no-op seguro |
| Triggers PostgreSQL | 0 en clients/sales/abonos | sin lógica oculta en BD | ✓ |

**Conclusión:** no hay doble contabilidad operativa; el único riesgo histórico (delta del import legacy) ya está eliminado y protegido por la validación `clients_saldo_intacto`.

## 2. Uso de `NOTAVTA.SALDO`

- Se conserva **únicamente** como `legacy_saldo_original` / `doc` JSONB (evidencia).
- **Ningún** cálculo de saldo documental lo utiliza: el saldo del doc viene de `CXCDOCS.SALDO` (READY) o 0.
- Su semántica real (snapshot de cuenta al vender) está documentada en `RYSA_LEGACY_DATA_DICTIONARY.md`.

## 3. Números del snapshot anterior como constantes

- Código de producción (backend/frontend/importador): **ninguno** (grep de 57258 / 789708 / 2547638 / etc. = 0 resultados).
- Solo aparecen en scripts forenses de análisis puntual (`tools/legacy_migration/forensic_*.py`), que no forman parte del pipeline runtime.

## 4. Estado del subsistema legacy (pre-V7)

| Capa | Implementación | Cobertura V7 |
|---|---|---|
| Snapshot registry | `legacy_snapshots` (+ `source_hash`) | ✓ (falta listar cambios por snapshot en API/UI) |
| Saldo por snapshot | `legacy_client_balance` (master/docs/ledger por snapshot) | ✓ |
| Identidad de documentos | `LEGACY:SERIE:FOLIO` estable, snapshot-independiente | ✓ (falta hash de cambios) |
| Idempotencia import | probada en vivo: 2do import = 57,258 saltados, 0 inserciones | ✓ |
| Detección de cambios | **NO existe** (V7 la agrega: CREATED/UNCHANGED/UPDATED/CANCELLED/MISSING) | ⚠ construir |
| Reconciliación | `legacy_client_balance` + `/legacy/reconciliation` | ✓ |
| Interrupted/resume | `legacy_import_batch` con reanudación validada en `_validate_import` | ✓ (probar) |
| Rollback | por batch, puramente documental bajo V2 | ✓ |
| Seguridad | 5 capas (env, developer mode, flag, rol, confirmación) + validación saldo | ✓ |

## 5. Riesgos detectados a cerrar en V7

1. **Sin detección de cambios**: un snapshot futuro con tickets nuevos/cancelados/modificados se incorporaría por upsert, pero sin registro explícito de qué cambió → V7 agrega `document_hash` + estados de cambio.
2. **Sin marcado de ausencias**: un documento desaparecido en el nuevo snapshot permanecería "fresco" → V7 agrega `missing_from_snapshot`.
3. **API/UI no exponen la lista de snapshots ni cambios** → V7 agrega `/legacy/snapshots` + pestaña.
4. Deadlock puntual observado en import concurrente (transitorio, auto-recuperado) → documentar reintentos y guard de unicidad (ya existe 409).

## 6. Inventario de tablas legacy_*

12 tablas: `legacy_migration_batch`, `legacy_customer_mapping`, `legacy_product_mapping`, `legacy_tickets`, `legacy_ticket_details`, `legacy_cxc_snapshot`, `legacy_cxc_movements`, `legacy_excluded_documents`, `legacy_review_queue`, `legacy_import_audit`, `legacy_import_backup`, `legacy_import_batch` + V2: `legacy_snapshots`, `legacy_client_balance`. Ninguna contiene lógica productiva; ninguna será eliminada (regla 23).
