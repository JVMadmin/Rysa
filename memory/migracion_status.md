# Estado y Plan de Migración — Grupo RYSA ERP (HANDOFF)

> **Objetivo de este documento**: permitir que un nuevo contexto (ventana de opencode) pueda **retomar la migración MongoDB → PostgreSQL** sin perder las decisiones, hallazgos y estado de las fases previas.
> Última actualización: 2026-08-11
>
> LEE TAMBIÉN:
> - `plan_migracion_postgresql.md` (análisis previo de migración)
> - `analysis_results.md` (auditoría completa)
> - `memory/PRD.md` (requisitos / historial funcional)
> - EL CÓDIGO ACTUAL es la fuente de verdad de lo ya implementado.

---

## 1. STACK Y ESTADO DEL SISTEMA

| Capa | Tecnología |
|---|---|
| Backend | Python 3.13 + FastAPI 0.110 + Uvicorn + Motor (async) — `backend/` (monolítico: `server.py` ~3 000 líneas, `deps.py`, `storage.py`, `pac_provider.py`) |
| BD actual | **MongoDB Atlas** (`cluster0.1krcnbl.mongodb.net`, db `rysa`), cliente `AsyncIOMotorClient`, sin ODM |
| Frontend | React 19, CRA+CRACO, Tailwind, shadcn/ui, recharts, axios |
| Facturación | PAC **Facty.mx** (`pac_provider.py`), CFDI 4.0 — **sin credenciales reales** |
| Storage/PDF | Filesystem local `UPLOAD_DIR` + reportlab |
| Tests | pytest + pytest-xdist (`pytest.ini`: `addopts = -n 2 --dist loadscope`), contra servidor en vivo (`REACT_APP_BACKEND_URL`) |

**Estado**: app funcional completa sobre MongoDB. La **fase de remediación de seguridad ya quedó implementada** (ver §2). La **migración a PostgreSQL NO ha comenzado** a nivel de código.

---

## 2. LO YA IMPLEMENTADO (fase de seguridad — NO rehacer)

### Autenticación / sesiones (`deps.py`, `server.py`)
- Access token JWT **HS256 de 2h** (`ACCESS_TOKEN_TTL_SECONDS`) con claims: `sub, email, jti, iat, exp, type=access, token_version`.
- **Refresh token rotatorio de 14 días** (`REFRESH_TOKEN_TTL_SECONDS`), guardado hash-ciphered (sha256) en colección `refresh_tokens`, en cookie **HttpOnly / Secure(prod) / SameSite=Lax / Path=/**. Nunca en `localStorage`.
- `POST /api/auth/refresh` rota y revoca el anterior; reutilización → 401.
- Revocación real: campo `token_version` en `users`; se incrementa al **cambiar password/rol o desactivar** (`revoke_user_sessions`) → invalida tokens emitidos antes.
- Logout revoca el refresh activo.
- Frontend: `AuthContext.jsx` y `lib/api.js` **sin `localStorage`**; interceptor Axios intenta `/auth/refresh` ante 401 y reintenta.

### Seguridad de la aplicación
- **Rate limiting de login persistente en MongoDB** (colección `login_attempts`, multi-worker): 8 fallos/min/IP → 429; 8 fallos acumulados → bloqueo 15 min por usuario; limpieza de registros viejos.
- **Mass assignment cerrado**: `ProductInput` con `extra="forbid"` y los **85 campos DBF declarados explícitamente** + campos ERP. `id/created_at/updated_at/role/...` → 422.
- Política de contraseñas ≥ 12 caracteres (crear/editar usuario y seed).
- **Endpoints `/dev/*` → 404 en producción** (guard `_dev_only`); `DEV_ERRORS` solo no-prod.
- Búsquedas `$regex` **sanitizadas** (`sanitize_search_term`: `re.escape` + max 100 chars) en productos/clientes/ventas/inventarios/export.
- `/api/files/{path}`: rechazo temprano de `..`, rutas absolutas, backslashes.
- Auditoría de login: `LOGIN_SUCCESS/FAILURE/LOGOUT/PASSWORD_CHANGE/ACCOUNT_DISABLED/TOKEN_REVOKED` + IP + user-agent.
- Cabeceras de seguridad ya presentes en middleware (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`).

### Administración de usuarios en la BD dev (`rysa`)
- `test@gmail.com` **desactivado** (usaba password filtrado) + token_version incrementado.
- `testadmin@rysa.local` eliminado (artefacto).
- Activos: `admin@gruporysa.com`, `testadmin@rysa-dev.com` (admin dev sintético de tests).

### Secretos y Git (HANDOFF CRÍTICO)
- **Historial Git reescrito y limpio** (`git filter-repo --replace-text`) y **force-push a `origin/main`** (ahora `2e504fb`). Ningún secreto en la historia.
- Los arquitecturas: `backend/.env`, `.env.development`, `.env.test` (gitignored) contienen secretos **rotados/dev**; `.env.example` solo placeholders.
- `backend/uploads/`, `backend/brand/`, `test_reports/` están en `.gitignore`.
- ⚠️ **PENDIENTE (manual, tuyo)**: rotar la contraseña del cluster **MongoDB Atlas** en la consola y actualizar `backend/.env` (`MONGO_URL`). Las actuales siguen en `.env` porque la app las necesita.
- El árbol de trabajo conserva cambios de la fase de seguridad **SIN commitear** (no se han commiteado todavía).

---

## 3. MAPEO MONGO → POSTGRESQL (propuesto, NO aplicado)

| Mongo | PostgreSQL (tabla) | Notas |
|---|---|---|
| `users` | `users` | PK `id uuid`; `email` UNIQUE; `role`; `user_modules(user_id,module)` o jsonb; `password_hash`, `active`, `caja_numero` (único parcial en activos), `token_version`, `created_at timestamptz` |
| `products` | `products` + `product_prices` + `product_barcodes` + `product_synonyms` + `product_suppliers` | `codigo` UNIQUE; núcleo tipado + `metadatos jsonb` (bloque legacy de 85 columnas); `version` para optimistic lock; 5 listas de precio en tabla hija; `existencia numeric(14,3)` |
| `categories` | `categories` | PK uuid; `nombre` UNIQUE |
| `clients` | `clients` | `codigo` UNIQUE; 52 campos DBF tipados (o jsonb los no usados en queries); `saldo numeric(12,2)`; `updated_at`+`version` |
| `sales` | `sales` + `sale_items` + `sale_payments` | `folio` UNIQUE; `fecha timestamptz NOT NULL`; `estado` CHECK; **`idempotency_key uuid UNIQUE`** (anti doble-cobro); items/pagos como tablas hijas |
| `suspended_sales` | `suspended_sales` | `payload jsonb` |
| `inventory_movements` | `inventory_movements` | FK `product_id, usuario_id, sale_id?`; tipo CHECK; `fecha timestamptz`; index `(product_id, fecha)`, partición opcional por fecha |
| `cajas` | `cajas` | **ÍNDICE ÚNICO PARCIAL `(usuario_id) WHERE estado='abierta'`**; `cierre jsonb` |
| `caja_movimientos` | `caja_movimientos` | FK `caja_id, usuario_id`; tipo CHECK; monto numeric |
| `abonos` | `abonos` + `abono_applications` | folio AB; `aplicaciones` a tabla hija (auditable) |
| `cfdi_documents` | `cfdi_documents` | `uuid` UNIQUE; `response jsonb` (PAC), `cancelacion jsonb` |
| `pac_config` | `pac_config` | api_key **cifrada/vault**; `timbres_cache jsonb` |
| `settings` | `settings` + `sucursales` | `ticket_config jsonb`; sucursales → tabla |
| `counters` | `counters` | `name PK`, `seq bigint` |
| `audit_logs` | `audit_logs` | + `ip`, `user_agent`; index `(entidad, fecha)` |
| `files` | `files` | metadata de archivos |

**Se mantienen como JSONB** (documentos opacos): `cfdi_documents.response`, `suspended_sales.payload`, `pac_config.timbres_cache`, `products.metadatos` (legacy), ficha técnica de categorías.

---

## 4. CONCURRENCIA DEL POS — IMPERATIVO EN POSTGRESQL

El modelo MongoDB actual **no usa transacciones** → riesgos reales con varias cajas. En PostgreSQL resolver con **transacciones + row-locking + constraints**:

| Riesgo | Solución PG |
|---|---|
| Folio duplicado | tabla `counters` con `UPDATE ... SET seq=seq+1 RETURNING` en transacción (evita saltos) en vez de SEQUENCE |
| Venta/doble cobro | `idempotency_key` UNIQUE (el POS manda un UUID); 409 en reuso |
| Inventario negativo / venta duplicada | `UPDATE products SET existencia=existencia-q, version=version+1 WHERE id=$1 AND (permitir_negativo OR existencia>=q)`; venta completa en una **transacción** (sale+items+pagos+mov+caja+saldo) |
| Caja abierta doble por usuario | índice único parcial `(usuario_id) WHERE estado='abierta'` |
| Cierre de caja vs movimiento concurrente | `SELECT ... FOR UPDATE` sobre la fila caja + transacción corta |
| Número de caja duplicado | UNIQUE parcial + retry |
| Abono aplicado 2 veces | transacción + `UPDATE sale SET saldo=saldo-$m WHERE id=$1 AND saldo>=$m` + idempotency |
| Crédito excedido | `SELECT ... FOR UPDATE` del cliente dentro de la venta |
| Pérdida de edición | columna `version` (optimistic) en `products`/`clients` |
| Cancelación concurrente | `UPDATE sale SET estado='cancelada' WHERE id=$1 AND estado<>'cancelada' RETURNING` |

Reglas: transacciones **cortas**; `FOR UPDATE` solo en filas de negocio (producto, cliente, caja, sale); unique constraints como garantía final; aislamiento default **READ COMMITTED**.

---

## 5. ARQUITECTURA DEV/PROD RECOMENDADA (decisiones a confirmar)

- **Producción**: PostgreSQL nativo en el VPS (repo apt, no Docker obligatorio), una instancia, DB `rysa_prod`, puerto solo localhost, usuario `rysa_prod_app` mínimo privilegio.
- **Desarrollo**: PostgreSQL **en la máquina del desarrollador** (o servicio barato) con DB `rysa_dev`; NUNCA compartir credenciales/vars con prod.
- Evaluar opciones: A) mismo servidor 2 DBs · B) instancias separadas · C) Docker por entorno · D) dev en PC + prod en VPS (recomendada).
- Reverse proxy: **Nginx** + Let's Encrypt/Certbot (recomendado) o Caddy.
- Backups: `pg_dump -Fc` diario + WAL/PITR + copia externa cifrada 90d + **prueba de restauración mensual**.

---

## 6. PLAN DE FASES DE LA MIGRACIÓN (por ejecutar)

**FASE 0** — Auditoría y decisiones (hecha; pendientes en §9).
**FASE 1** — Preparación: PostgreSQL up (dev local + prod), roles/DBs, `pg_hba` localhost, backup `mongodump` completo (corte 0).
**FASE 2** — Esquema: `alembic` (tablas de §3 + índices + constraints + CHECKs). NO borrar Mongo.
**FASE 3** — Backend: capa de datos async (recomendado **SQLAlchemy async + asyncpg**, o SQL crudo con asyncpg); pool; `next_counter` → `counters` transaccional; reescribir endpoints verificando contra tests.
**FASE 4** — POS/concurrencia (§4) **antes** de migrar datos.
**FASE 5** — Migración de datos: export Mongo → limpiar (duplicados, tipos, fechas) → import a PG en orden → **validación** (conteos y sumas: inventario, saldos, folios, ventas) → corte con mantenimiento corto.
**FASE 6** — Reforzar seguridad restante (IDOR ventas, CSRF/CSP, rate limit general, refresh si aplica).
**FASE 7** — Infra VPS: nginx + TLS, hardening SSH/UFW, usuario app, systemd, PITR+backups externos, healthcheck, observabilidad mínima.
**FASE 8** — Testing (suite green + pruebas de concurrencia de 2 cajas + prueba de restauración).
**FASE 9** — Deploy producción con rollback planificado (volver a Mongo en <5 min si falla validación).
**FASE 10** — Retiro de Mongo (solo tras estabilidad N días): quitar `motor/pymongo/dnspython`, mongodump de archivo, documentar.

**Rollback real**: mientras la FASE 9 no supere validación, se regresa a Mongo con el dump de corte.

---

## 7. CÓMO EJECUTAR LAS PRUEBAS

Requisito: levantar el backend con el código actualizado.
```
# desde backend/
# requiere ENVIRONMENT/MONGO_URL/JWT_SECRET/... en .env
C:\...\backend\venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8030
```
En otra terminal:
```
$env:REACT_APP_BACKEND_URL="http://127.0.0.1:8030"
$env:TEST_ADMIN_EMAIL="testadmin@rysa-dev.com"
$env:TEST_ADMIN_PASSWORD="TestAdmin_Rysa_2026_Dev"
# suite completa en serie (recomendado):
pytest -q -n 0
```
- **Suite completa en serie: 74/74 PASS**.
- Con `-n 2` (default pytest.ini) solo fallan 4 tests de `test_rysa_api.py` por diseño secuencial compartido (caja/producto/cliente entre clases que xdist separa). Ejecutar ese archivo con `-n 0`.
- `test_security.py` es la suite de seguridad (19 casos).

---

## 8. SECRETOS / REGLAS ABSOLUTAS (a preservar incluso en SQL)

1. NO exponer valores de secretos en informes/código/commits (referirse como `SECRET DETECTADO` / `REDACTED`).
2. Dev JAMÁS debe poder afectar producción (variables/DBs/credenciales separadas).
3. PostgreSQL de producción NO expuesto a Internet salvo razón explícita.
4. NO mitigar Mongo sin respaldo ni rollback.
5. La migración debe permitir rollback real.
6. No modificar PDFs/negocio salvo necesidad; no cambiar lógica POS en esta fase (ya protegida en fase de seguridad).
7. Rotación de MongoDB Atlas pendiente de hacer manualmente por el usuario.

---

## 9. PENDIENTES / DECISIONES A CONFIRMAR

- [ ] **Usuario**: rotar contraseña MongoDB Atlas (consola) y avisar para actualizar `backend/.env` y verificar.
- [ ] **Commitear** la fase de seguridad (trabajo actual sin commitear sobre `HEAD` limpio).
- [ ] Migración a PostgreSQL: ¿proceder? (elegir capa de datos, DB dev/prod, reverse proxy, backups).
- [ ] Decidir regla IDOR de ventas (`GET /sales/{id}`) — regla NO determinada aún.
- [ ] CSRF token / CSP agresivo — postergados (documentado).
- [ ] Corregir `test_rysa_api.py` bajo `-n 2` (estructural) — opcional.
- [ ] Sustituir/limpiar créditos reales de Facty al configurar PAC.
