# Migración MongoDB → PostgreSQL — Grupo RYSA ERP (Fase 3 local)

> Entorno: **solo local (PC)**. PostgreSQL **no** se tocó en el VPS.
> Fecha: 2026-08-11/12 · Alcance: desarrollo y pruebas.

---

## 1. PostgreSQL instalado

**Versión:** PostgreSQL 17.10 (x86_64, compilado MSVC-19.44.35227, 64-bit).

- Sin permisos de administrador se usó el **paquete de binarios portable de EDB**
  (`postgresql-17.10-2-windows-x64-binaries.zip`), extraído en
  `C:\Users\emili\AppData\Local\Programs\pgsql`.
- `initdb` con codificación **UTF-8**, autenticación `scram-sha-256`.
- Se ejecuta de forma persistente vía **Task Scheduler** (`RYSA_Postgres17`) porque
  el shell de la sesión bloquea procesos hijo (postgres backend daba `0xC0000142`);
  al arrancarse desde el contexto de tareas los procesos backend funcionan con normalidad.
- Puerto **5432**.

## 2. Base de datos

**Nombre:** `rysa_dev`

## 3. Usuario

**Nombre:** `rysa_dev`
- Rol `LOGIN` **sin superusuario**, sin `CREATEDB`/`CREATEROLE` (creado como `NOSUPERUSER`).
- **Dueño** únicamente de la base `rysa_dev` (acceso limitado a desarrollo).
- La contraseña es generada por entorno y guardada **solo** en `backend/.env` (gitignored).

## 4. Esquema (tablas `public`, dueño `rysa_dev`)

Además de `alembic_version` y `sequences`, se crearon **18 colecciones→tablas**:
`users, products, clients, sales, cajas, caja_movimientos, inventory_movements,
audit_logs, refresh_tokens, login_attempts, files, settings, categories,
suspended_sales, cfdi_documents, pac_config, abonos, counters(→ sequences)`.

Cada tabla tiene la estructura:
```
_id  TEXT PRIMARY KEY      (clave lógica: doc._id o doc.id)
id   TEXT                  (doc.id cuando existe, indexado)
doc  JSONB NOT NULL        (documento completo)
created_at TIMESTAMPTZ
<columnas espejo NUMERIC>  (para dinero/cantidad, ver §5)
```

### 5. Tipos de datos y dinero

- **Dinero/cantidad (NUMERIC real):** se espejan a columnas `numeric` tipadas:
  `sales.(subtotal, iva_total, descuento_total, total, cambio, saldo)`,
  `clients.(saldo, limite_credito)`, `products.(costo, existencia, stock_minimo)`,
  `cajas.fondo_inicial`, `caja_movimientos.monto`,
  `inventory_movements.(entrada, salida, existencia_anterior, existencia_resultante, costo)`,
  `abonos.monto`.
  - **Nunca `FLOAT`** para costos/precios/totales/pagos/descuentos/impuestos.
- **Fechas:** se conservan como ISO-8601 (fuente Mongo) y se pueden tipar a `timestamptz`.
- **Identificadores:** se conservan los `id`/`_id` hex existentes (`TEXT`) para no
  romper la migración; no se renumeraron arbitrariamente.

## 6. Decisiones de arquitectura (documentadas)

El backend es un monolito `server.py` (~3.100 líneas, ~144 llamadas directas a
`db.<coleccion>.<metodo>` entrelazadas con lógica de negocio, PDF, PAC e importación
Excel). Reescribir manualmente **todo** a repositorios por entidad supera con
creces esta fase y añade riesgo alto de romper lo que ya funciona.

Por ello se implementó un **adaptador de compatibilidad MongoDB→PostgreSQL**
(`backend/pgstore/adapter.py`): cada colección MongoDB queda representada como una
**tabla PostgreSQL real** con PK + `doc` JSONB + columnas NUMERIC espejo, y se expone
la misma API asíncrona que usa el monolito (`find_one, find, insert_one,
update_one, delete_one, count_documents, aggregate, next_counter`).

Consecuencias:
- **Pros:** la aplicación completa corre sobre PostgreSQL sin cambiar el frontend,
  sin cambiar la lógica de negocio y sin tocar los contratos JSON de la API.
- **Limitación a registrar:** al no reescribirse la capa de servicio, las operaciones
  POS del monolito (crear venta + kardex + caja + crédito) se ejecutan como
  operaciones individuales **no envueltas en una sola transacción** por el propio
  monolito. Para rollback **atómico** se expone `pgstore.transaction()` y se documenta
  que el siguiente paso (recomendado) es alojar la lógica POS en repositorios/servicio
  transaccional (Fase 3.14) y envolverla en `transaction()`.

## 7. Relaciones

- `sales.cliente_id → clients.id` (opcional, "Público General" si es nulo).
- `sales.caja_id → cajas.id` y `caja_movimientos.caja_id → cajas.id`.
- `sales.usuario_id/vendedor_id → users.id`; `cajas.usuario_id → users.id`.
- `inventory_movements.product_id → products.id`.
- `cajas.cierre` (resumen), `sales.items/pagos`, `product.precios/sat/controles`
  y configs (`settings`, `pac_config`, `cfdi_documents.response`, `suspended_sales.payload`)
  son **JSONB** por ser datos de forma flexible/capturados como bloque, no consultados relacionalmente.
- `counters` (folios) viven en la tabla `sequences (name PK, seq BIGINT)`.
- N:N y tablas intermedias: no hay N:N reales en el dominio actual (proveedores/sinónimos
  de producto son listas planas → JSONB).

## 8. POS y folios — concurrencia (fase más importante)

**Cómo se genera hoy el ticket:** `deps.next_counter(nombre, prefijo, padding)` que en
Mongo hacía `find_one_and_update({"_id": nombre}, {$inc:{seq:1}}, upsert=True)`.

**Problema de concurrencia:** dos cajas que piden el folio simultáneamente pueden leer
el mismo `seq` (ticket `000001` duplicado) si no se serializa la reserva.

**Solución PostgreSQL:** secuencia bajo **row-locking** dentro de una transacción:
```
BEGIN;
INSERT INTO sequences(name, seq) VALUES(:n, 0) ON CONFLICT(name) DO NOTHING;
SELECT seq FROM sequences WHERE name = :n FOR UPDATE;   -- bloquea la fila
UPDATE sequences SET seq = seq + 1 ...;
COMMIT;
```
**Garantía de unicidad:** mientras una transacción tiene la fila bloqueada con
`FOR UPDATE`, cualquier otra espera; al hacer commit la siguiente lee el valor ya
incrementado. La reserva es **atómica** (aislamiento Read Committed + lock de fila).

Verificado: **50 solicitudes concurrentes** → 50 folios únicos (test y vía API).

## 9. Inventario — consistencia

- Existencia se guarda en `products.existencia` (y espejo NUMERIC).
- Cada entrada/salida registra `inventory_movements` (kardex) con
  `existencia_anterior/resultante`. La operación `venta`/`devolucion`/`ajuste` usa
  `UPDATE products ... SET existencia = ...` con escritura atómica.
- Para ventas concurrentes del mismo producto se ofrece `pgstore.transaction()` +
  `SELECT ... FOR UPDATE` sobre la fila del producto antes de descontar, evitando
  pérdida de actualización. (El monolito actual descuenta por operación; se recomienda
  envolver el flujo POS en `transaction()` — ver §6.)

## 10. Caja — integridad Venta→Pago→Caja

- `cajas` (apertura/cierre/`cierre` JSONB), `caja_movimientos` (tipo: venta/devolucion/
  entrada/retiro; `monto` NUMERIC, `referencia` = folio).
- `sales.items` y `sales.pagos` quedan en JSONB dentro de la venta (escritura atómica
  con la venta). La relación `Pago → Caja` se materializa en `caja_movimientos`.
- Fase recomendada: servicio transaccional que en una sola transacción preste la venta,
  descuente inventario, registre el pago y el movimiento de caja (rollback completo).

## 11. Migraciones Alembic

`backend/alembic/` + `backend/alembic.ini`. Migración inicial `0001_initial` (head).
`alembic upgrade head` crea las 18 tablas + `sequences`. La app NO depende de
`create_all` en producción; `_ensure_table` es solo conveniencia idempotente de dev.

## 12. MongoDB → PostgreSQL (datos migrados)

Script `backend/scripts/migrate_mongo_to_pg.py` (lee MongoDB, normaliza, inserta,
valida). Resultado (sin eliminar MongoDB):

| Entidad | MongoDB | PostgreSQL | Dif |
|---|---|---|---|
| users | 4 | 4 | 0 |
| products | 19 | 19 | 0 |
| clients | 15 | 15 | 0 |
| sales | 32 | 32 | 0 |
| cajas | 15 | 15 | 0 |
| caja_movimientos | 8 | 8 | 0 |
| inventory_movements | 46 | 46 | 0 |
| audit_logs | 614 | 614 | 0 |
| refresh_tokens | 187 | 187 | 0 |
| files | 16 | 16 | 0 |
| settings | 1 | 1 | 0 |
| sequences (contadores) | 4 | 4 | 0 |

**Validación de dinero:** sumas de `sales.total/subtotal/iva_total/saldo`,
`clients.saldo`, `products.costo/existencia`, `cajas.fondo_inicial`,
`caja_movimientos.monto`, `inventory_movements.entrada/salida` → **idénticas** entre
MongoDB y PostgreSQL (reporte JSON en `test_reports/migracion_postgresql_report.json`).

## 13. Backend

Backend completo operando sobre **PostgreSQL** (`DATABASE_ENGINE=postgresql`).
Verificado vía API (puerto 8010): `auth/login`, `products` (19), `inventario`, `caja`,
`settings`, `categories`, `sales-next-folio`, creación de **venta real** y folios únicos.
Retorno puntual a MongoDB: cambiar `DATABASE_ENGINE=mongo` en `backend/.env`.

## 14. Tests (PostgreSQL)

`backend/tests/test_postgresql.py` — **6/6 PASAN** (`-n 0`):
producto CRUD, cliente CRUD, venta crear/total/pago, folios concurrentes (50→únicos),
rollback transaccional venta+inventario, caja+inventario.

## 15. Concurrencia

- 50 folios simultáneos → únicos (nivel de datos).
- 10 ventas API simultáneas → folios V000052–V000061 únicos (nivel de app).

## 16. Variables de entorno

- `DATABASE_ENGINE=postgresql` (o `mongo`).
- `DATABASE_URL=postgresql+asyncpg://rysa_dev:<PASSWORD>@localhost:5432/rysa_dev`
- `MONGO_URL` / `DB_NAME` se conservan como fuente durante la migración.
- `.env*` en `.gitignore`; `.env.example` actualizado con *placeholders*.

## 17. Dependencias agregadas

`sqlalchemy[asyncio]>=2.0`, `asyncpg>=0.30`, `alembic>=1.13`, `pytest-asyncio`.

## 18. Próximo paso (recomendación)

1. Refactorizar la lógica POS (venta + inventario + caja + crédito) a un servicio
   transaccional envuelto en `pgstore.transaction()` para garantizar rollback completo
   entre operaciones (atiende el pendiente de §6/§9/§10).
2. Validar el frontend apuntando al backend PostgreSQL (puerto 8010) antes de cerrar.
3. En una fase posterior y **solo tras revisión**, preparar profesionalmente el VPS.

## 19. Archivos modificados/creados (backend)

- `backend/deps.py` (switch `DATABASE_ENGINE`)
- `backend/pgstore/` (database.py, adapter.py, `__init__.py`)
- `backend/scripts/migrate_mongo_to_pg.py`
- `backend/alembic/`, `backend/alembic.ini`
- `backend/tests/test_postgresql.py`
- `backend/requirements.txt`, `backend/.env`, `backend/.env.example`

## 20. Pendientes / limitaciones

- **Atomicidad multi-operación del monolito POS**: aún se ejecuta operación por
  operación; el rollback atómico de venta+inventario+caja en el **endpoint** requiere
  el refactor descrito (ya demostrado a nivel de `pgstore.transaction()` en tests).
- Cambiar un endpoint POS a transacción puede alterar el orden de persistencia que
  el código actual espera; se hará con pruebas de regresión.
- El "reporte de ventas" usa agregaciones en memoria (pandas) sobre `.to_list(50000)`;
  funciona pero conviene paginar/optimizar (no bloqueante).
