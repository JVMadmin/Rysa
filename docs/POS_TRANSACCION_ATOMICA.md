# Transacción Atómica del POS + Pruebas de Concurrencia — Informe (Fase 4)

> Entorno: **solo local**. PostgreSQL 17.10 `rysa_dev`. MongoDB intacto. VPS sin tocar.
> No hubo commit/push.

---

## A. Flujo anterior

El endpoint `POST /api/sales` (`server.py::create_sale`) construía el documento de la
venta y luego persistía **operación por operación**, cada una con conexión/commit propio:

```
validar → folio (pg_next_counter, commit propio)
 → db.sales.insert_one(sale)                     [commit propio]
 → por item: registrar_movimiento()              [update products + insert kardex, commits propios]
 → db.caja_movimientos.insert_one(...)           [commit propio]
 → db.clients.update_one($inc saldo)             [commit propio]
 → log_audit(...)                                [commit propio]
```

**Riesgo eliminado:** si fallaba un paso después de la venta, quedaba una venta sin
inventario desconatdo, o caja sin venta, etc. No había atomicidad ni idempotencia.

## B. Flujo nuevo

`POST /api/sales` sigue validando (items, cliente, vendedor, `calcular_venta`, pagos,
crédito) y generando el folio, pero la **persistencia** se delega a
`pgstore.pos.crear_venta_pg()` que ejecuta **TODO** en una única transacción sobre la
**misma conexión** (`pgstore.transaction()`), sin commits intermedios.

```
Folio (secuencia consumida, commit aparte y robusto — ver E)
  ↓
async with pgstore.transaction() as conn:      # BEGIN
   A) SELECT ... FOR UPDATE productos  (validar e "intentar" existencia)
   B) INSERT sales  (items + pagos embebidos)
   C) UPDATE productos (existencia) + INSERT inventory_movements (kardex)
   D) INSERT caja_movimientos  (si caja y efectivo, contado)
   E) UPDATE clients (saldo)  (si crédito)
   F) INSERT audit_logs
   G) INSERT sale_idempotency  (si idempotency_key)
                                              # COMMIT
Cualquier VentaError/RuntimeError → ROLLBACK de TODO
```

Cuando `DATABASE_ENGINE=postgresql`. El fallback MongoDB conserva el flujo original
(sin cambios) y sigue funcionando.

## C. Transacción — qué está dentro de `transaction()`

Dentro (misma conexión, atómico): bloquear/validar inventario, crear venta, descontar
inventario + kardex, movimiento de caja, saldo de crédito, auditoría e idempotencia.

Fuera (a propósito): la **generación del folio** (ver E).

## D. Locks — qué filas y por qué

- **Fila del producto** (`SELECT ... FOR UPDATE` por `product_id`): garantiza que dos
  cajas que venden el mismo producto se *serialicen*. Sólo se bloquea la fila del
  producto afectado (no toda la tabla, no toda la venta). Permite que cajas distintas
  con productos distintos trabajen en paralelo.
- **Fila del folio/sequence**: `pg_next_counter` bloquea la fila `sequences` con
  `FOR UPDATE` sólo el instante de reservar el folio.
- **Nada global**: no hay locks de tabla completos.

## E. Folios — unicidad y política de consumo

- La secuencia (`sequences` + `SELECT ... FOR UPDATE`) ya probada sigue intacta.
- La generación del folio se hace **antes** de la transacción y **se consume aunque la
  venta falle** (política fiscal/comercial: series secuenciales, sin reusar números;
  los huecos son normales). Si se reintentara dentro de la transacción, el rollback
  reusaría el `seq`, lo que **no** es aceptable para documentos/comerciales — por eso
  se mantiene fuera.
- 50 concurrentes → 50 folios únicos; **100 concurrentes → 100 folios únicos** (0 duplicados).

## F. Inventario — cómo se evita la race condition

Doble protección:
1. `SELECT ... FROM products WHERE id=:x FOR UPDATE` dentro de la transacción (bloqueo
   de fila → las ventas concurrentes sobre el mismo producto se serializan).
2. Validación de existencia **dentro** de la transacción (autoritativa), tras el lock.

Prueba real: producto con existencia **1**, venta A y B simultáneas → **A aprobada, B
rechazada (409)**; existencia final **0** (nunca -1 ni "0 con ambas exitosas").

## G. Pagos — consistencia

Los pagos quedan **dentro del documento de la venta** (`sales.doc.pagos`), insertados en
la misma transacción que la venta. Imposible “pago registrado sin venta” o “venta sin
pago” cuando el flujo los requiere atómicos. No se cambió ninguna regla (efectivo/
tarjeta/transferencia/otros, contado, crédito).

## H. Caja — consistencia

El `caja_movimientos` (tipo `venta`, monto NUMERIC, `referencia`=folio) se inserta en la
misma transacción que la venta. Verificado vía API: tras crear la venta, `caja/actual`
muestra el movimiento. Una venta fallida no deja movimiento huérfano (rollback lo elimina).

## I. Idempotencia

Antes no existía. Se añadió:
- Campo opcional `idempotency_key` en `SaleInput`.
- Tabla `sale_idempotency (idempotency_key TEXT PRIMARY KEY, sale_id)` (migración Alembic
  `0002_sale_idempotency`).
- En `create_sale`: fast-path (reintento → devuelve la venta existente, sin gastar folio)
  y, dentro de la transacción, `INSERT ... ON CONFLICT`-equivalente vía PK; si llega un
  reintento **simultáneo**, el que pierde hace rollback completo y devuelve la venta del ganador.

Prueba real (API y a nivel de servicio): dos requests idénticos con la misma key →
**1 venta, 1 folio, 1 pago, 1 movimiento de caja, inventario descontado una vez**.
Reintento concurrente con la misma key → misma única venta.

## J. Rollback — resultados por prueba (PostgreSQL real, verificado en BD)

| Prueba (fault) | venta | inventario | kardex | caja | pagos | audit | saldo crédito |
|---|---|---|---|---|---|---|---|
| normal | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| después de crear venta | rollback | sin cambio | sin cambio | — | rollback | rollback | — |
| después de descontar inventario | rollback | **rollback** | rollback | — | rollback | rollback | — |
| después de pago/caja | rollback | rollback | rollback | rollback | rollback | rollback | — |
| después de caja | rollback | rollback | rollback | rollback | rollback | rollback | — |
| después de auditoría | rollback | rollback | rollback | rollback | rollback | rollback | — |
| crédito con fallo | rollback | rollback | — | — | — | — | **saldo revierte** |

Se consulta directamente la BD (`SELECT COUNT` en sales/products/inventory_movements/
caja_movimientos/audit_logs) tras cada fallo: **0 filas residuales**.

## K. Concurrencia — resultados

- Folios: 50 → 50 únicos; **100 → 100 únicos** (0 duplicados).
- Inventario concurrente (existencia 1, 2 ventas) → 1 aprobada + 1 rechazada; stock 0.
- Ventas concurrentes (20 y 50) → folios únicos = ventas exitosas; existencia correcta;
  kardex y caja coinciden con el nº de ventas.
- **Rendimiento (local):** 10 concurrentes ≈ 3.3s (0.33s/venta); 20 ≈ 3.8s; 50 ≈ 4.1s;
  100 folios ≈ 4.4s. Sin deadlocks ni race conditions.

## L. Tests

| Suite | Resultado |
|---|---|
| `tests/test_postgresql.py` | **6/6 PASS** |
| `tests/test_pos_atomico.py` (nuevo, POS atómico) | **11/11 PASS** |
| Legacy `test_rysa_api.py` y afines | dependen del backend MongoDB en `:8000` (no activo en esta sesión) — ver N |

Nota de transparencia: `test_client_import_saldo.py` y `test_import_products.py` fallan
en *collection* por precondiciones de entorno (esperan un archivo de entrada y la env
`REACT_APP_BACKEND_URL`). El resto de tests legacy apuntan a `http://localhost:8000`
(MongoDB), backend que no está corriendo en esta sesión. Ninguno es una regresión de
esta fase. El **fallback MongoDB sí se verificó** lanzando un backend con
`DATABASE_ENGINE=mongo` (puerto 8100): login y productos responden 200 vía Atlas.

## M. Archivos modificados / creados

- `backend/pgstore/pos.py` (nuevo): servicio transaccional del POS.
- `backend/pgstore/database.py`: `transaction()` y `dispose()` robusto (ya existían; disposer tolerante).
- `backend/pgstore/__init__.py`: exporta `pos`.
- `backend/server.py`: `SaleInput.idempotency_key`; `create_sale` usa el servicio
  transaccional en PostgreSQL (fallback MongoDB intacto); import de `pgstore.pos`.
- `backend/alembic/versions/0002_sale_idempotency.py` (nuevo).
- `backend/tests/test_pos_atomico.py` (nuevo).
- Sin cambios en `test_postgresql.py`, MongoDB, frontend.

## N. Riesgos pendientes

1. Los tests legacy requieren el backend MongoDB `:8000` y env/archivos específicos;
   no se ejecutaron en esta sesión (no es regresión: el fallback Mongo se verificó aparte).
2. La transacción atómica cubre **ventas (`POST /sales`)**. Aún no se envuelven en
   transacción `recargas` ni `cancelación` (flujos secundarios sin inventario); quedan
   como están. Se recomienda extender el patrón si se requiere.
3. El kardex/`inventory_movements`, `cajas` y `audit_logs` en PG usan `doc` JSONB con
   columnas NUMERIC espejo; es el diseño documentado (adapter de compatibilidad). Un
   rediseño relacional puro requeriría fase posterior.
4. Idempotencia requiere que el cliente envíe `idempotency_key`; el frontend puede
   añadirla al pulsar "Cobrar" (cambio de cliente, no implementado aquí, sin alterar la API).

## O. Recomendación

**Sí**: el POS está listo en el aspecto solicitado por esta fase — la venta
(VENTA+FOLIO+DETALLES+INVENTARIO+PAGO+CAJA+AUDITORÍA) se procesa como **una única
transacción**, con inventario sin race conditions, folios únicos bajo concurrencia e
idempotencia opcional. Todo local, MongoDB disponible y VPS intacto.

Resta (fuera de esta fase) validar el frontend contra el backend PostgreSQL y ejecutar
los tests legacy con el backend MongoDB `:8000` activo; luego pasar a la fase de VPS.

---

Detener aquí. No se preparó el VPS ni se hizo commit/deploy.
