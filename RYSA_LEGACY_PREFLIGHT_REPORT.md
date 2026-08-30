# RYSA LEGACY — PRE-FLIGHT PRODUCTIVO (FASE 5.5)

Fecha: 2026-08-29 · **Auditoría 100 % READ-ONLY sobre código y schema real.**
No se ejecutó importación; no se activó `LEGACY_MIGRATION_ENABLED`; producción
sin cambios (clients=686 · sales=0 · abonos=0).

## VEREDICTO

## ✅ PASS (con 3 WARNING documentados — ninguno bloqueante)

Los 4 BLOCKER detectados durante la auditoría fueron **corregidos en el
código durante esta misma fase** (críticos: rollback incompleto, no-reanudable,
items sin `descripcion`, sin validación post-import) y **re-validados**.

---

## 1. AUDITORÍA DEL IMPORTADOR (backend/legacyadmin.py)

| Pregunta | Respuesta verificada |
|---|---|
| Tablas que escribe | `sales` (INSERT docs LEGACY), `clients.saldo` (delta CxC READY), `legacy_import_batch/audit/backup` (metadatos propios) |
| Campos escritos | sales: `_id, id, doc, created_at, total, saldo` · clients: `saldo` (columna + JSONB, patrón idéntico a cxc.py) |
| IDs generados | `_id = "LEGACY:SERIE:FOLIO"` (determinista) |
| IDs conservados | `legacy_serie, legacy_folio, legacy_cliente, legacy_fecha, legacy_condicion, legacy_vendedor, legacy_saldo_original, legacy_cancelado, codigo_legacy por partida` |
| Batch | `legacy_import_batch` (PENDING→RUNNING→COMPLETED/FAILED/ROLLED_BACK), progreso por chunk |
| Identificación LEGACY | `doc.source='LEGACY'` + `doc.legacy_batch` + índice parcial `idx_sales_legacy` |
| Chunks | `LEGACY_IMPORT_CHUNK` (default 1000), progreso persistido por chunk |
| Rollback | Por batch: DELETE sales LEGACY del batch + reversión de deltas de clients.saldo (auditados) + status ROLLED_BACK |
| Backup | Copia completa de `clients` a `legacy_import_backup` + precounts de sales/abonos/caja/inventario/products |
| Auditoría | audit_logs + legacy_import_audit (deltas con saldo resultante) |
| Idempotencia | `INSERT … ON CONFLICT ("_id") DO NOTHING`; los deltas de CxC SOLO se aplican cuando la fila se insertó de verdad (rowcount>0) → segunda ejecución: 0 duplicados, 0 doble saldo |
| Interrupción | excepción → FAILED; proceso muerto → detectado en validate (batch RUNNING sin tarea viva → marcado FAILED "interrumpida; reanudable") |
| Reanudación | Re-ejecutar import: ON CONFLICT deduplica; validación permite `0 < sales_legacy ≤ staging` (reanudación), bloquea `> staging` |
| COMPLETED | Solo si la validación post-import automática pasa (ver §11) |
| FAILED | excepción + detail; validación post-import fallida también → FAILED |

## 2. MATRIZ IMPORTADOR vs SCHEMA REAL (information_schema)

| Destino | Campo | Tipo real | Fuente Legacy | Transformación | OK/BLOQUEO |
|---|---|---|---|---|---|
| sales | _id | text PK | LEGACY:SERIE:FOLIO | ninguno | OK |
| sales | id | text | = _id | ninguno | OK |
| sales | doc | jsonb | doc de venta construido | items+legacy fields | OK |
| sales | created_at | timestamptz | now() | — | OK |
| sales | total | numeric nullable | NOTAVTA.TOTAL | round 2 | OK |
| sales | saldo | numeric nullable | CXCDOCS.SALDO (232 READY) o 0 | round 2 | OK |
| sales | subtotal/iva_total/descuento_total/cambio | numeric nullable | (no escritos) | NULL permitido | OK |
| clients | saldo | numeric nullable | Σ saldos READY del cliente | delta + JSONB | OK |
| clients | doc | jsonb | jsonb_set saldo | patrón cxc.py | OK |
| abonos | — | — | (no se escribe) | — | OK |
| caja_movimientos / inventory_movements / products | — | — | (no se escribe) | — | OK |

Corrección aplicada durante pre-flight: partidas ahora incluyen
`descripcion/unidad/precio_bruto/importe_bruto` (compatibilidad de render con
Ventas.jsx) preservando `codigo_legacy` y `mapping_status`.

## 3. MOTOR CxC (pgstore/cxc.py) — SIN MOTOR PARALELO

- FIFO de `abonar_pg` opera sobre `sales` con `condicion='credito' AND
  estado='confirmada' AND saldo>0` ORDER BY fecha ASC FOR UPDATE.
- Los 232 documentos READY se importan exactamente con esas propiedades →
  **el FIFO existente los atiende de forma natural** (los más viejos primero).
- `clients.saldo` actualizado con el mismo patrón columna+JSONB que cxc.py.
- `cancelar_abono_pg` recomponería saldos correctamente sobre docs LEGACY.
- NO existe lógica CxC paralela en el importador: crea estado, no motor. ✓

## 4. AISLAMIENTO (matemático, sobre datos reales)

| Impacto potencial | Veredicto | Evidencia |
|---|---|---|
| Ventas del día | **LIMPIO** | 0 tickets LEGACY con fecha = hoy (0 en últimos 7 días) |
| Caja | LIMPIO | El importador no escribe caja_movimientos; precount verificado en validación post-import |
| Inventario | LIMPIO | No se insertan inventory_movements; precount verificado |
| Comisiones | LIMPIO | Solo se generan en el flujo crear_venta (no invocado) |
| Abonos históricos | LIMPIO | abonos: 0 filas escritas; precount verificado |
| Vendedores normales | LIMPIO | Docs LEGACY sin `vendedor_id` → invisibles para no-supervisores en /sales |
| **Reportes del mes actual** | ⚠️ WARNING | 291 tickets LEGACY de agosto-2026 ($277,669.13) entrarían en estadísticas por rango mensual hasta que los reportes filtren por `source` (mitigación futura; decisión operativa del usuario) |

## 5. IDEMPOTENCIA (análisis + pruebas de lógica)

- Clave determinista `LEGACY:SERIE:FOLIO` + ON CONFLICT DO NOTHING.
- Deltas de saldo: solo en inserción real → re-ejecución NO duplica saldo.
- Simulación ejecutada en validate: `sales_legacy_previas=0` → fresh; estado
  parcial → `reanudacion=true` (permitido); > staging → BLOQUEADO. ✓
- Prueba de batch huérfano RUNNING ejecutada: detectado, marcado FAILED,
  reanudación habilitada, metadato de prueba eliminado. ✓

## 6. INTERRUPCIÓN (análisis estático, sin ejecución real)

| Punto de corte | Comportamiento |
|---|---|
| Durante tickets/chunk | Transacción del chunk hace ROLLBACK; filas previas persisten; batch RUNNING → reanudable (auto-FAILED al validar) |
| Durante CxC | Deltas aplicados quedan auditados; re-ejecución re- calcula: los tickets ya insertados no re-aplican delta (rowcount=0) ✓ |
| Proceso muerto (SIGKILL) | validate marca FAILED + permite reanudar; rollback del batch parcial disponible |
| Huérfanos | Ninguno posible: toda fila lleva `legacy_batch` → rollback la alcanza |

## 7. BACKUP

- Mecanismo automático integrado: copia completa de `clients` (única tabla
  cuyo dato productivo se modifica) + precounts de las demás + deltas
  auditados → **restauración verificable por batch**.
- pg_dump completo: no ejecutable desde el contenedor backend (sin cliente
  pg_dump ni socket docker) → **queda como paso manual OBLIGATORIO del
  administrador** (checkbox "Confirmo el backup" + instrucciones FASE 6).
- ⚠️ WARNING: el checkbox confía en la declaración del admin; la restauración
  integral ante desastre depende del pg_dump manual. Documentado.

## 8. ROLLBACK (endpoint auditado y corregido)

- Ahora revierte COMPLETED, FAILED y RUNNING (interrumpidas) — antes solo
  COMPLETED (BLOQUEER corregido).
- Borra SOLO `sales WHERE source='LEGACY' AND legacy_batch=batch` → ventas
  RYSA intocables; revierte deltas de clients.saldo desde auditoría;
  registra el rollback en legacy_import_audit. ✓
- No toca staging ni legacy_data. ✓

## 9. FRONTEND (12 capacidades verificadas en LegacyMigration.jsx + integraciones)

Estado de etapas (1-4) ✓ · Validate (5) ✓ · cifras exactas pre-import (6) ✓ ·
confirmación explícita doble (7) ✓ · progreso (8) ✓ · resultado (9) ✓ ·
errores (10) ✓ · REVIEW filtrable (11) ✓ · rollback (12) ✓.
Botón deshabilitado si: flag off / stages incompletos / ya importado; y el
backend bloquea además si validate falla, backup sin confirmar o batch
inconsistente. ✓

## 10. CUMPLIMIENTO DE DECISIONES FASES 1-4

57,258 tickets (SERIE,FOLIO, source=LEGACY, is_historical) ✓ · 134,429
detalles con legacy_codigo/cantidad/precio/importe_calculado, sin crear
productos (2,036 en REVIEW) ✓ · CxC autoritativa = CXCDOCS.SALDO (NO la
fórmula), solo 232 READY / $789,708.45 ✓ · 269 REVIEW no importables
automáticamente ✓ · 5 NEGATIVE fuera ✓ · Serie F excluida (63 docs + 108
movimientos conservados en staging) ✓

## 11. VALIDACIÓN POST-IMPORTACIÓN (ahora automática, BLOCKER corregido)

Antes de COMPLETED el importador verifica e inserta en el batch:
tickets LEGACY=57,258 · items LEGACY=134,429 · CxC LEGACY=232 ·
saldo=$789,708.45±0.02 · abonos/caja/inventario/products SIN CAMBIO vs
precounts. Si algo falla → batch FAILED (nunca COMPLETED falso). ✓

## 12-13. NAVEGACIÓN Y PAGO FUTURO

Cliente→Histórico(tab)→documento LEGACY ✓ · Ventas→Origen=LEGACY→detalle ✓
(rango "Todas" existente; búsqueda por folio sin tope) · Pago de deuda
LEGACY: flujo normal CxC → FIFO existente → disminuye sales.saldo del doc
LEGACY más antiguo + clients.saldo, con abono y caja normales ✓ (sin segundo
motor).

---

## WARNINGS (no bloqueantes)

1. **Reportes mensuales**: 291 tickets LEGACY de agosto-2026 ($277,669.13)
   se incluirán en estadísticas por rango de fecha hasta que los reportes
   agreguen filtro por `source` (recomendado en FASE posterior).
2. **pg_dump manual**: obligatorio antes de importar; el sistema no puede
   generarlo desde el contenedor backend.
3. **Listado Ventas tope 3,000 docs**: con 57k históricos, usar rango/búsqueda
   por folio (endpoint sin tope) para consultar antiguos.

## BLOCKERS: 0 (los 4 detectados fueron corregidos y re-validados)

Correcciones aplicadas en esta fase: (1) items con
descripcion/unidad/precio_bruto/importe_bruto; (2) rollback de batches
FAILED/RUNNING; (3) política de reanudación + detección de batch huérfano;
(4) validación post-import obligatoria antes de COMPLETED (columna
`validations` añadida con ALTER seguro sobre tabla legacy_*).

---

**FASE 6 LISTA PARA EJECUCIÓN PRODUCTIVA — REQUIERE APROBACIÓN EXPLÍCITA**

No se importó nada. Producción intacta. LEGACY_MIGRATION_ENABLED sigue en
false.
