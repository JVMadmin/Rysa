# RYSA LEGACY IMPORT SPEC (V2)

**Fecha:** 2026-08-30 · Especificación contractual del importador. Cumplimiento obligatorio.

## 1. Identidad e idempotencia

| Entidad | Clave única | Conflicto |
|---|---|---|
| Ticket | `LEGACY:{SERIE}:{FOLIO}` | `ON CONFLICT DO NOTHING` en `sales._id` |
| Detalle | `LEGACY:{SERIE}:{FOLIO}:{PARTIDA}` | — (embebido en items del doc) |
| Doc CxC | `LEGACY:{SERIE}:{FOLIO}` | — |
| Snapshot balance | `(snapshot_id, legacy_customer_key)` | upsert |

Re-importar el mismo snapshot → `skipped_duplicates = total`, 0 cambios.

## 2. Documento importado (sales, source=LEGACY)

```jsonc
{
  "source": "LEGACY",
  "legacy_table": "NOTAVTA",
  "legacy_key": "LEGACY:NV:01523",
  "legacy_serie": "NV", "legacy_folio": "01523",
  "legacy_cliente": "00003", "legacy_batch": "IMP-...",
  "cliente_id": "<rysa uuid|null>", "cliente_nombre": "...",
  "condicion": "credito|contado",
  "estado": "confirmada", "fecha": "YYYY-MM-DD",
  "total": 4500.00,
  "saldo": 4500.00,          // 0 si el doc está pagado/cancelado (CXCDOCS.SALDO)
  "items": [ { "codigo_legacy": "...", "descripcion": "...", "cantidad": 2,
               "precio": 10.00, "importe": 20.00, "product_id": null|"<rysa>",
               "mapping_status": "MATCHED|PRODUCT_REVIEW_REQUIRED" } ]
}
```

Garantías:
- Sin movimientos de inventario, caja, comisiones ni abonos.
- `estado='confirmada'`; cancelados conservan `legacy_cancelado=true` y saldo 0.
- Tickets pagados (saldo 0) SE importan: son parte de la explicación histórica.
- Productos sin mapping: se conserva código/descripción legacy, `product_id=null`.

## 3. Política de saldo (NÚCLEO V2)

```
PROHIBIDO: clients.saldo = clients.saldo + delta_CxC
OBLIGATORIO: clients.saldo INVARIABLE durante el import
```
- `clients.saldo` ya contiene el maestro legacy (verificado: $2,547,694.50 = legacy − saldo no mapeado).
- El saldo documental LEGACY (sales.saldo) es la capa **explicativa** (¿de dónde viene el saldo?), no un delta operativo.
- Validación dura post-import: `clients_saldo_intacto` (antes == después, tolerancia $0.02). Falla → batch FAILED.

## 4. Errores (nunca silenciosos)

| Clase | Ejemplo | Manejo |
|---|---|---|
| BLOCKER | staging sin tickets, batch duplicado corriendo, mapping incompleto | aborta import |
| ERROR | validación post-import fallida | batch FAILED + rollback disponible |
| WARNING | doc sin cliente RYSA (cuenta `cxc_sin_cliente_rysa`) | importa, marca, cuenta |
| REVIEW | doc en `legacy_cxc_snapshot.status='REVIEW_REQUIRED'` | NO importa; espera resolución humana |
| INFO | duplicado skipped | contador público |

Registro permanente: `legacy_import_audit` (kind, entity_key, payload) + `audit_logs`.

## 5. API (rol admin_desarrollador; 404 en producción; interruptor LEGACY_MIGRATION_ENABLED)

| Endpoint | Método | Función |
|---|---|---|
| `/api/legacy/status` | GET | estado global (etapas, staging, producción, batch) |
| `/api/legacy/reconciliation` | GET | conciliación maestro/docs/ledger por snapshot |
| `/api/legacy/review` | GET | cola de revisión filtrable |
| `/api/legacy/validate` | POST | prechecks del import |
| `/api/legacy/import` | POST | inicia import (doble confirmación) |
| `/api/legacy/progress` | GET | progreso del batch |
| `/api/legacy/rollback` | POST | revertir batch completo |
| `/api/legacy/estado-cuenta` | GET | histórico por cliente (usuarios autenticados) |
| `/api/legacy/public-summary` | GET | banner informativo CxC |

## 6. Seguridad

1. `ENVIRONMENT != production` (404) · 2. `DEVELOPER_MODE` · 3. `LEGACY_MIGRATION_ENABLED` · 4. rol `admin_desarrollador` · 5. confirmación textual exacta · 6. confirmación de backup. Escritura limitada a `sales` + tablas `legacy_*`.
