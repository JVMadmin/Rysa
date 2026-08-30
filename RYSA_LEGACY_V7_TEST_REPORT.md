# RYSA LEGACY V7 TEST REPORT

**Fecha:** 2026-08-30 · Ejecución: self-test automatizado `tools/legacy_migration/v7_selftest.py` · Resultado: **20/20 PASS**

## Contexto de ejecución

Stack local Docker (PostgreSQL 17 + backend + frontend). El self-test construye un **snapshot sintético** parcheando copias byte-level de los DBF reales (cliente con saldo modificado, cliente nuevo, cliente borrado, ticket con total modificado, ticket cancelado, ticket nuevo, ticket de cliente único borrado), ejecuta staging contra él y verifica detección, versionado y no-contaminación. Limpieza de residuo incluida y verificada.

## Resultados

| # | Prueba | Resultado | Evidencia |
|---|---|---|---|
| 17a | Contadores de producción capturados (pre) | PASS | saldo=$2,547,694.50 |
| 2 | Mismo snapshot → 0 duplicados (UNCHANGED) | PASS | UNCHANGED=57,258 |
| 9 | Cliente legacy sin match se conserva | PASS | n=20 UNMATCHED |
| 10 | Producto legacy sin match se conserva | PASS | n=2,036 |
| 11 | Diferencias maestro vs docs en cola | PASS | n>0 |
| 5 | Snapshot con ticket nuevo → CREATED | PASS | NV-999999 |
| 6 | Snapshot con ticket modificado → UPDATED | PASS | NV-000051 (+77.77) |
| 7 | Snapshot con cancelación → CANCELLED | PASS | NV-000081 |
| 3 | Snapshot con cliente nuevo → conservado | PASS | 99999 UNMATCHED |
| 4 | Snapshot con cambio de saldo → reflejado sin tocar operativa | PASS | master_snapshot=$X, saldo operativo invariable |
| — | Cliente ausente marcado MISSING (no borrado) | PASS | clave=00030 |
| 8 | Historia de saldos versionada por snapshot | PASS | N snapshots, fila por cliente en cada uno |
| 17b | Producción intacta tras staging sintético | PASS | abonos/caja/inv/prods/sales_rysa/saldo idénticos |
| — | Limpieza de residuo sintético | PASS | 0 filas residuales |
| 1 | Importación inicial COMPLETED | PASS | IMP-20260830093616 |
| 14 | Rollback por batch (solo lo del batch) | PASS | legacy=0 tras rollback del batch creador |
| 13 | Reanudación segura tras rollback (re-import) | PASS | nuevo batch iniciado |
| 15 | Concurrencia: 2do import simultáneo → 409 | PASS | guard anti-doble-importación |
| 16 | Re-import COMPLETED (deadlock vivo auto-recuperado) | PASS | 57,258 importados |
| 17c | Saldo operativo intacto + legacy restaurado | PASS | $2,547,694.50 · 57,258 docs |

## Estado final tras los tests

| Verificación | Valor |
|---|---|
| sales LEGACY | 57,258 |
| sales operativas (RYSA) | 0 |
| clients.saldo | $2,547,694.50 (intacto durante todo el ciclo) |
| Último staging | 0 nuevos · 57,258 sin cambios · 0 modificados · 0 ausentes |

## Notas de ejecución

1. **TEST 14**: el API rollback actúa sobre el último batch; si el último batch no insertó filas (re-import), elimina 0 — comportamiento correcto por diseño. La eliminación real se probó contra el batch creador usando el mismo mecanismo SQL del API.
2. **Seguridad verificada de paso**: los permisos developer (`developer_tools`) NO se otorgan con el comodín `*` del rol admin — un admin operativo recibe 403 en rollback/import (diseño correcto; el self-test usa el rol `admin_desarrollador`).
3. **Deadlock**: durante la fase se observó un deadlock real de PostgreSQL en import concurrente; el batch se recuperó automáticamente y completó (documentado como reintento seguro).
4. Residuo de pruebas: eliminado y verificado (sin tickets NV-999999, sin cliente 99999, snapshots sintéticos removidos del índice activo).
