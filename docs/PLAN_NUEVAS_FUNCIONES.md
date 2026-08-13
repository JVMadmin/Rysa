# PLAN DE NUEVAS FUNCIONES — GRUPO RYSA ERP

> **TIPO DE DOCUMENTO:** Análisis, arquitectura y diseño. **SOLO ANÁLISIS — NO IMPLEMENTAR.**
> Este documento analiza el código REAL actual (`backend/server.py`, `backend/deps.py`, `backend/pgstore/*`, `backend/alembic/*`, `frontend/src/*`) y describe qué cambios serían necesarios.
> **NO ejecutar migraciones. No modificar BD/backend/frontend. No desplegar. No commit/push.**
> NFT: Fecha 2026-08-12. Repo `main` (commit `2e504fb`).

---

## ✅ ESTADO DE IMPLEMENTACIÓN (P1 — Fases 5, 6, 7)

> Autorizado por el propietario (decisiones A: 1 BD+sucursal_id, product_stock tabla, venta completa por CFDI, extender roles hardcode). **Primera ronda de implementación completada y verificada.**

### Implementado — BACKEND
- **F5 Roles/permisos/alcance:**
  - `deps.py`: añadidos permisos granulares por módulo×acción y alcance: `venta.ver_todas`, `venta.facturar`, `venta.cambiar_operador`, `recargas.ver_todas`, `reportes.global`, `inventario.autorizar_negativo`. Aplicados a `encargado` y expuestos en `MODULES` (ventas, recargas, reportes).
  - Helpers de alcance: `ver_todas_ventas`, `ver_reportes_globales`, `ver_recargas_todas`.
  - `DEFAULT_MODULES_NON_PRIVILEGED` (productos, clientes, recargas, ventas, caja, reportes) aplicado automáticamente al crear usuarios no privilegiados (`create_user`); `es_rol_privilegiado` evita escalamiento.
- **F5 Visibilidad backend (se cerraron fugas reales):**
  - `GET /sales`: exige `venta.ver_todas` o filtra por `vendedor_id` propio; bloquea filtrar por vendedor ajeno sin permiso.
  - `GET /sales/{id}`: 403 si no es propia sin `venta.ver_todas`.
  - `PUT /sales/{id}/cliente` y `POST /sales/{id}/cancelar`: validan propiedad sin permiso global.
  - `GET /reports/ventas` y su export: ahora exigen `reportes.ver` y, sin `reportes.global`, reportan solo las ventas propias.
- **F7a Operador + Caja obligatoria:**
  - `POST /sales` y `POST /recargas`: exigen **caja abierta** (HTTP 409 claro) salvo cotizaciones.
  - Operador forzado: `vendedor_id` solo se acepta ≠ usuario si el rol tiene `venta.cambiar_operador`; el resto SIEMPRE usa su id (imposible suplantar). El frontend solo lo envía/permite cuando hay permiso.
- **F7b Inventario negativo con override:**
  - `SaleInput` gana `allow_negative_inventory` + `override_reason`; validado contra `inventario.autorizar_negativo` (403 si no).
  - La venta registra `inventario_override{allow, override_user_id, override_reason, override_timestamp}`; `pgstore/pos.py` acepta `override_inv` y descuenta a negativo dentro de la transacción atómica.
- **F6 Sucursales (tenant):**
  - Colección `sucursales` + tabla `product_stock` (PG, PK product_id+sucursal_id).
  - Migration alembic **`0003_sucursales`** (aplicada) + colecciones `price_lists`, `mensajes`, `plantillas` (preparadas).
  - Endpoints CRUD `/sucursales` (permiso `config`).
  - `users.sucursal_id` (crear/editar) + default `_default_sucursal_id()` (crea "Matriz" si no hay).
  - `sucursal_id` propagado a `cajas` (apertura) y a `sales`/recargas (desde la caja del operador).

### Implementado — FRONTEND
- `POS.jsx`: selector de vendedor solo editable con `venta.cambiar_operador` (si no, muestra operador fijo); flujo de **inventario insuficiente** con diálogo [Cancelar]/[Continuar] + motivo obligatorio (solo con `inventario.autorizar_negativo`), y envía `allow_negative_inventory`/`override_reason` al confirmar.

### Verificación
- Tests nuevos `backend/tests/test_p1_seguridad.py` (4 tests: alcance de roles, default módulos/rol privilegiado, override inventario negativo a nivel transacción, sucursales).
- **PG suite: 17/17 (previos) + 4 (nuevos) = 21/21 PASS.**
- Frontend: `craco build` OK.
- Alembic: migraciones 0001→0002→0003 aplicadas sobre `rysa_dev`.

### Pendiente (siguientes rondas, fuera de esta iteración)
- Resto de P2/P3 (Bloques 6-19): multi-POS tabs, precios dinámicos (price_lists), facturación multi-venta, WhatsApp, CxC filtros/recordatorios/PDF, ticket designer, branding, export/import global.
- Endurecer `cxc_*` por alcance cuando se defina visibilidad CxC por operador.

---

## ✅ ESTADO DE IMPLEMENTACIÓN P2/P3 (segunda ronda — todas en una fase)

> Continuación autorizada. Funciones visibles de P2/P3 implementadas en la ronda actual.

### Multi-POS (Bloque 6)
- Nuevo `frontend/src/pages/MultiPos.jsx` (ruta `/app/pos`): **tabs de ventanas POS independientes**, cada una es una instancia `<POS/>` con su propio carrito/cliente/precios/pagos. "Nueva ventana" y cerrar pestañas. Cada cierre de venta es su propia transacción.

### Editor avanzado de tickets (Bloque 11)
- Backend `storage.build_ticket_pdf` reescrito a **motor de bloques/elementos** (empresa, texto, separador, folio, fecha, cliente, items, total, logo, **QR**, pie…). Soporta `align/bold/font_size/visible/qr_size`. Fallback al diseño estándar si no hay `elements`.
- Configuración → "Diseño de ticket": editor de **bloques** (agregar/reordenar/quitar, contenido, alineación, negrita, visible, tamaño QR) + vista previa en vivo. Instalada dependencia `qrcode` (+requirements.txt).
- El ticket HTML del POS ya muestra el `logo_url`.

### Listas de precios dinámicas (Bloque 7/8)
- Configuración → Precios: **agregar/quitar listas** (número variable), nombre + % por lista.
- POS: el selector de listas y "Precio mínimo" se adaptan al número dinámico (`priceFromList`/dropdown dinámico).

### Logo personalizable (Bloque 18)
- Endpoint público `GET /settings/branding` + hook `useBranding`. Login y sidebar del ERP muestran el logo personalizado con **fallback** al logo/icono por defecto.

### Facturación multi-venta + WhatsApp (Bloque 13/14)
- Backend `POST /facturacion/multi` (permiso `venta.facturar`): valida en backend que todas las ventas estén confirmadas, no facturadas, del **mismo cliente** y no sean cotizaciones (evita doble timbrado); agrega los conceptos de todas en **una sola factura**.
- Ventas: **checkboxes de selección múltiple** + botón "Facturar seleccionadas" (solo con `venta.facturar`).

### CxC: filtros, recordatorios y PDF (Bloque 15/16/17)
- Backend `GET /cxc` con filtros `estado` (pendiente/parcialmente_pagada/vencida/liquidada), `facturada` (si/no), `vendedor_id`.
- `GET /cxc/{id}/adeudo-pdf`: **PDF detallado** (Cliente/RFC/Fecha, ventas con productos, total vendido, abonos, saldo) reutilizando ReportLab.
- `POST /cxc/{id}/recordatorio`: genera recordatorio con plantilla configurable, devuelve enlace `wa.me`, y **registra historial** en `mensajes`.
- Frontend: selectores de estado/facturación + botones "PDF de adeudo" y "Recordar por WhatsApp".

### Export/Import global (Bloque 10)
- `GET /datos/export` (admin): **ZIP** con manifiesto (versión/engine) + un JSON por entidad. Excluye secretos (`password_hash`, api keys).
- `POST /datos/import` (admin): valida ZIP/versión/integridad, restaura por entidad; **NO restaura `users` ni `settings`** (evita escalamiento de privilegios).
- Configuración → pestaña **Datos**: Exportar ZIP / Importar con confirmación.

### Verificación
- Backend: live test round-trip export/import 200/200; `facturacion/multi` 400 correcto sin PAC; CxC filtros 200; branding 200.
- **PG suite: 21/21 PASS.** Frontend `craco build` OK.

### Pendiente
- Bloque 12 (barra info cliente sticky) y afinar flujo visual del ticket en HTML térmico del POS según bloques.

---

## 1. ESTADO ACTUAL (confirmado)

| Área | Estado |
|---|---|
| Backend | FastAPI 0.0.0.0:8001, prefijo `/api`, monolito `server.py` (3127 líneas) + `deps.py` |
| BD principal | **PostgreSQL** (`DATABASE_ENGINE=postgresql`, BBDD `rysa_dev`, usuario `rysa_dev`), vía fallback `pgstore` |
| Fallback | **MongoDB intacto** (`DATABASE_ENGINE=mongo`, default en `deps.py:12`) |
| ESQUEMA PG | Tablas tipo MongoDB-shim: `_id TEXT PK, id TEXT, doc JSONB, <columnas NUMERIC espejo>` (01). Sin ORM. |
| Alembic | Revisiones `0001_initial`, `0002_sale_idempotency`, `0003_sucursales`. Funciona. |
| POS | Transacción atómica AL FINALIZAR venta **solo en PG** (`pgstore/pos.py`), idempotencia `sale_idempotency`, folio por `sequences`, inventario con `FOR UPDATE`. |
| Tests | PG 6/6 + POS atómico 11/11 + P1 4/4 = **21/21 PASS**. |

**Topología de datos (colecciones → tablas PG):** `users, products, clients, sales, cajas, caja_movimientos, inventory_movements, audit_logs, refresh_tokens, login_attempts, files, settings, categories, suspended_sales, cfdi_documents, pac_config, abonos, counters(→sequences)` (`pgstore/adapter.py:22-27`).

---

## 2. ARQUITECTURA ACTUAL ENCONTRADA

- **Backend-agnóstico:** `server.py` habla con `db.<colección>.<método>()` (API estilo Mongo). `pgstore` traduce a SQL sobre `doc JSONB`. Solo 2 puntos ramifican por engine: `next_counter` (folios) y la transacción atómica del POS (`pgstore/pos.py`).
- **Sin ORM / sin migraciones por tabla**: las tablas se crean automáticamente ("CREA TABLE IF NOT EXISTS") bajo demanda en `_ensure_table`. Alembic existe pero el esquema es el "contenedor JSONB".
- **Roles RBAC por permisos-string** (`deps.py`), superusuario = `"*"`. Roles base: `admin, admin_propietario, admin_desarrollador, encargado, vendedor, cajero`. Módulos asignables (`MODULES`) suman permisos.
- **Auth:** JWT httpOnly cookie (con fallback Bearer), bcrypt, `token_version`, refresh rotation, rate-limit login.
- **Sucursales:** SOLO dato cosmético `settings.sucursales[]` (array de texto). **No hay `sucursal_id` en ninguna tabla operativa** ni rutas por sucursal.
- **Facturación:** CFDI 4.0 vía PAC **Facty.mx**, 1 factura = 1 venta (`cfdi_documents.sale_id` escalar), `sales.facturado` bool. PAC aislado en `pac_provider.py`.
- **Tickets:** HTML `window.print()` en frontend + PDF ReportLab en backend (`storage.build_ticket_pdf`, 80mm/Carta).
- **PDFs:** ReportLab (reportes y tickets) + PAC para CFDI. Excel `openpyxl`/pandas.
- **Import/Export:** SOLO productos y clientes en Excel (existe). **No hay export/import global JSON.**
- **Branding:** Logo dinámico SOLO en ticket/PDF (settings.logo_url → `/uploads`). Landing usa PNG estático. Login/ERP usan icono lucide.

---

## 3. SUCURSALES (futuro) — BLOQUE 1

### Hallazgo clave
No existe `sucursal_id`/`branch_id` en ninguna tabla operativa. Solo `settings.sucursales[]` cosmético. **El paso a multi-sucursal es el cambio más estructural y debe decidirse ANTES de VPS** porque toca casi todas las tablas.

### Recomendación de arquitectura futura
**[REQUIERE DECISIÓN]** — Opciones para RYSA:

- **A) Una BD PostgreSQL, `sucursal_id` en cada fila operativa (recomendada como punto de partida).**
  - Ventajas: simplicidad operativa, consultas globales directas (ventas/inventario/cxc/reportes de todas), una sola copia de seguridad, backup/restore único, migración incremental y de menor riesgo, reutiliza `pgstore` (solo hay que añadir la columna y filtrar).
  - Desventajas: necesidad de particionar/filtrar consistentemente; riesgo de acceso entre sucursales si se olvida el filtro (mitigable con una capa de repositorio/tenant).
- **B) Una BD por sucursal.**
  - Ventajas: aislamiento físico, escalado independiente, latencia por sucursal.
  - Desventajas: reportes globales = consolidación/federación (complejidad alta), backup/restore por sucursal, sincronización de catálogos maestros (productos, usuarios), migración MASIVA ahora, incompatibilidad con el shim JSONB actual tal cual. **Alto costo inicial, mala relación beneficio ahora.**
- **C) Híbrida (recomendada a MEDIO plazo, no ahora).**
  - Una BD central con tenant (`sucursal_id`) HOY, y luego, cuando una sucursal crezca por encima de cierto umbral o se requiera aislamiento físico, extraerla a su propia BD. La clave para que esto sea viable es **mantener el `sucursal_id` en cada fila y un repositorio de datos por sucursal**, que permita reconfigurar la fuente de datos sin reescribir el ERP.

**Recomendación concreta:** Adoptar **A ahora** (tenant único con `sucursal_id`), con un **criterio de separación física futuro (C)** acoplado. Así el propietario consulta global (ventas, inventario, clientes, cajas, reportes, recargas, cxc) con una sola query, y la eventual separación física no requiere rehacer el ERP.

### Qué tablas llevan `sucursal_id` (tenant) y cuáles son globales

**GLOBALES (compartidas / maestras):**
- `settings` (configuración general de empresa + config local de sucursales embebida)
- `users` (usuarios, con asignación de sucursal/es)
- `products` y `categories` (catálogo de productos → **global**, con precios globales; el inventario es local)
- `pac_config` (facturación)
- `audit_logs` (global, con `sucursal_id` de origen en cada registro)
- `login_attempts`, `refresh_tokens`, `counters/sequences`, `sale_idempotency` (globales técnicos)

**LOCALES / POR SUCURSAL (llevan `sucursal_id`):**
- `sales`, `suspended_sales` (ventas por sucursal)
- `cajas`, `caja_movimientos` (caja por sucursal)
- `clients` (clientes — [REQUIERE DECISIÓN]: global o por sucursal; ver abajo)
- `inventory_movements` (kardex local)
- `abonos` (cxc por sucursal)
- `inventario`: **productos globales vs existencia local**

### Inventario: productos globales vs existencia local
[REQUIERE DECISIÓN] — Design recomendado: **catálogo de productos (código, descripción, precios, IVA, categoría) GLOBAL**, y la **existencia por sucursal en una tabla puente** `product_stock (product_id, sucursal_id, existencia, stock_minimo, ultima_actualizacion)`. El `products.doc.existencia` actual es un único valor global; habría que **migrar** hacia existencias por sucursal. En la fase intermedia (una sola sucursal), `product_stock` tendría una fila por producto para la sucursal única. Esto NO rehace el ERP: `pgstore` ya encapsula el acceso.

### Usuarios y sucursales
[REQUIERE DECISIÓN] Un usuario puede pertenecer a **una** sucursal o a **varias** (operador que rota). Recomendación: `users.sucursales[]` (array) o tabla `user_sucursales`, + `sucursal_id` "activa" del momento (la caja abierta fija la sucursal). El permiso por sucursal (Bloque 2) debe consultarse en backend en cada endpoint local.

### Otros
- **Cajas y sucursales:** `cajas.sucursal_id` + validar que la caja abierta pertenece a la sucursal del usuario.
- **Ventas/Recargas/cxc:** `sucursal_id` en cada doc; los reportes globales agregan por sucursal.
- **Config global vs local:** `settings` global + `settings_sucursal(sucursal_id)` con lo que puede variar (listas de precios, ticket_config, folios, tipo de cambio). [REQUIERE DECISIÓN] qué configuración es global vs local.

---

## 4. ROLES Y PERMISOS — BLOQUE 2

### Estado actual
Sí existe **RBAC por permisos de acción** (`require_permission`, `user_has_permission`, `effective_permissions`). Superusuario = `*`. Roles base en `deps.py:110-127`:

| Rol actual | Permisos base |
|---|---|
| `admin` / `admin_propietario` | `{"*"}` (no dev) |
| `admin_desarrollador` | `{"*"} ∪ dev` |
| `encargado` | producto.*, inventario.ajuste, venta.*, cliente.*, reportes.ver, importar/exportar, config, credito.autorizar |
| `vendedor` | venta.crear, venta.descuento, cliente.crear/editar, exportar |
| `cajero` | venta.crear, exportar |

**Roles NO existentes literalmente:** `super_admin`, `administrador`, `propietario`, `desarrollador`, `cajera`, `usuario_normal`. El frontend usa `admin, admin_propietario, admin_desarrollador, encargado, vendedor, cajero`. (El usuario usa "cajera" ↔ `cajero`; "administrador" ↔ `admin`; "propietario" ↔ `admin_propietario`; "desarrollador" ↔ `admin_desarrollador`.)

**Huecos detectados:**
- **No existe ROL → PERMISO configurable** (constructor de roles). Los roles son hardcodeados en `ROLE_PERMISSIONS`.
- Los permisos son **por acción** pero la agrupación es **por rol, no por "MÓDULO×ACCIÓN×ALCANCE"**.
- **No existe ALCANCE (scope)** — no se puede expresar "ver propias" vs "ver todas".
- `reportes.ver` existe pero `GET /reports/ventas` **solo usa `get_current_user` (sin permiso)** (server.py:2802) → cualquier autenticado ve reporte global.
- `list_sales` (server.py:1475) usa `get_current_user` (sin permiso) → cualquier autenticado ve **TODAS** las ventas. `get_sale` (1509) igual.

### Diseño propuesto
Estructura: **ROL → PERMISOS → MÓDULO → ACCIÓN → ALCANCE**.

Se recomienda añadir un **catálogo de permisos** extensible y un **constructor de roles**:
- Nueva tabla/colección `roles` con `{name, descripcion, permisos: [ {modulo, accion, alcance} ], builtin: bool}`.
- El rol puede ser **builtin** (admin, etc.) o **personalizado** (ruta admin → constructor de roles en `/roles`).
- Añadir permisos granulares por **módulo×acción**:
  - `ventas.ver_propias`, `ventas.ver_todas`, `ventas.crear`, `ventas.editar`, `ventas.cancelar`, `ventas.exportar`, `ventas.facturar`, `ventas.autorizar`, `ventas.cambiar_operador`.
  - Idem para recargas, reportes, productos, clientes, caja, cxc, facturación.
- Añadir **ALCANCE** como dimensión de cada permiso (propias / sucursal / todas).

Ejemplo de matriz objetivo (Cajera):
```
ventas: { crear: sí, ver_propias: sí, ver_todas: no, cancelar: no, exportar: no, facturar: no, cambiar_operador: no }
recargas: { ver_propias: sí, ver_todas: no, crear: sí }
reportes: { ver: no }  // solo roles autorizados
```
Propietario:
```
ventas: { ver_todas: sí, cancelar: sí, exportar: sí, facturar: sí }
reportes: { ver: sí }
```

**[REQUIERE DECISIÓN]** El modelo de alcance ("propias/sucursal/todas") — ver Bloque 3.

---

## 5. PERMISOS DE VISIBILIDAD (backend) — BLOQUE 3

### Problema real actual
Hoy **cualquier usuario autenticado** puede leer **todas** las ventas (`list_sales` 1475), ver cualquier venta por id (`get_sale` 1509) y ver el reporte global (`reporte_ventas` 2802). **El frontend no las oculta** salvo por navegación. Por tanto la restricción requerida (cajera solo sus ventas) hoy NO existe en backend.

### Diseño (indispensable que viva en BACKEND)
1. **Filtrado en el repositorio/query, no en el frontend.** Cada endpoint de venta/recarga/reporte debe recibir `effective_permissions(user)` + regla de alcance y **añadir `vendedor_id == user.id` (o `sucursal_id == user.sucursal`) al query** cuando el usuario no tenga `ver_todas`.
2. **`get_sale` debe validar que la venta pertenece al usuario** (o que el usuario tiene `ver_todas`/`ventas.ver_todas`); hoy devuelve cualquier `sale_id` sin comprobación (riesgo de manipulación de IDs, Bloque 20).
3. **`reporte_ventas`** debe exigir `require_permission("reportes.ver")` (hoy no lo tiene) y, si el alcance no es global, filtrar por vendedor/sucursal.
4. **CxC:** `cxc_list`/`cxc_detail` deben filtrar por sucursal y por vendedor según alcance.
5. **Recargas:** son `sales` con `tipo_venta="recarga"` → heredan la misma regla (filtrar por vendedor/sucursal; roles superiores `ver_todas` + ver quién las realizó = `vendedor_nombre`).
6. **Nunca confiar en React.** Toda autorización de lectura/escritura se valida en el endpoint.

### Alerta de seguridad
Mientras no se implemente, **existe una fuga real**: un `cajero` puede `GET /api/sales` y ver toda la operación. Es prioridad alta.

---

## 6. OPERADOR DEL POS — BLOQUE 4

### Estado actual
- `create_sale` (1535-1541): `vendedor_id = data.vendedor_id or user["id"]`. **Cualquier usuario con `venta.crear` puede mandar un `vendedor_id` ajeno** (server.py:1538-1541 lo acepta). Esto es un **riesgo de suplantación de operador** (Bloque 4 y 20).
- No existe `operator_id` ni `authenticated_user_id` separados; solo `usuario_id` (=JWT) y `vendedor_id` (=enviado).
- El frontend POS deja elegir "Vendedor" en dropdown (POS.jsx:398-401) sin restricción.

### Diseño propuesto
1. **`operator_id` = usuario autenticado SIEMPRE en backend**, ignorando el valor que envíe un usuario sin permiso.
2. **`created_by` / `authenticated_user_id`** = `user["id"]` (del JWT), **no editable**.
3. **`sale.operator_id` / `sale.vendedor_id`** solo editable si el usuario tiene permiso `ventas.cambiar_operador` (rol admin). Si no lo tiene, backend fuerza `vendedor_id = user["id"]` (o la caja del operador) y descarta el valor recibido.
4. **Bloquear manualmente:** el endpoint debe:
   - si `data.vendedor_id` difiere de `user["id"]` y el usuario **no** tiene `ventas.cambiar_operador` → o bien ignorarlo y usar `user["id"]`, o bien devolver 403. (Recomendado: **ignorar** para cajera + **403 para dato inválido de rol no autorizado**, con auditoría.)
5. **Caja:** `caja_id` debe derivarse de la **caja abierta del operador autenticado** (no del payload).

---

## 7. CAJA OBLIGATORIA PARA POS — BLOQUE 5

### Estado actual
**No se exige caja abierta** para vender. `create_sale`/`crear_venta_pg` solo usa la caja si existe (`caja_abierta_de`, 1290) para registrar el movimiento de efectivo (1592, 1600; pos.py:156). Un usuario puede vender sin abrir caja: la venta se crea pero no entra a caja.

### Diseño propuesto
1. **Endpoint `POST /sales` / `crear_recarga`:** exigir **caja abierta válida** del usuario autenticado:
   - `caja = await caja_abierta_de(user["id"])`
   - si `not caja` → **HTTP 409/400** con mensaje claro "No hay caja abierta. Abre una caja antes de vender."
   - validar `caja.estado == "abierta"` y que la caja pertenece a la sucursal del usuario (cuando exista sucursal).
2. **Excepción (definir):** cotizaciones (`tipo_venta=="cotizacion"`) NO requieren caja abierta (no cobran).
3. **Frontend:** `POS.jsx` y `Recargas.jsx` deben consultar `GET /caja/actual` antes de cobrar y deshabilitar si no hay caja / mostrar el error del backend. Hoy la caja solo muestra un indicador informativo en ErpLayout.
4. La validación vive en backend; el frontend solo la refleja.

---

## 8. MÚLTIPLES VENTANAS POS — BLOQUE 6

### Estado actual (frontend)
`POS.jsx` usa **un solo `cart` en `useState` local** (POS.jsx:33). No hay store global (react-query está instalado pero SIN uso; solo AuthContext). Las "ventanillas" son instancias separadas del navegador; en una sola pestaña NO hay multi-POS.

### Recomendación
- **Recomendado para RYSA: tabs internos / múltiples instancias del POS dentro de una misma página**, con **estado por sesión de venta**.
- Cada **"ventana POS"** porta su propio estado local: `{ cart, cliente, lista_precios, descuentos, pagos, estado }`.
- **Compartido (no duplicar):** usuario (`AuthContext`), caja (`GET /caja/actual`), productos/inventario (catálogo), configuración (`GET /settings`).
- **No compartido (aislado por ventana):** carrito, cliente seleccionado, precios por línea, descuentos, pagos, estado de venta.
- Implementación sugerida: componente `PosWindow` (encapsula todo el estado de una venta) + un shell `MultiPos` que renderiza N `PosWindow` en tabs. Al **confirmar** una ventana, se envían las ventas de forma **independiente y atómica** (cada cierre es su propia transacción POST /sales, no se mezclan items).
- **No** se recomienda rutas por ventana ni store global compartido para el carrito (haría que los carritos se interfirieran). Un store separado por `windowId` sería válido pero innecesario: `useState` local es suficiente.

---

## 9. LISTAS DE PRECIOS — BLOQUE 7 (y 8)

### Estado actual
- **Precios estructurados** en `products.precios[]` = 5 objetos `{precio_con_iva, precio_sin_iva, utilidad_pct, nombre}` + `product.precio_minimo` (ProductForm.jsx:137-140). Fijo en **5 listas** (nombres en `settings.listas_precios_nombres`).
- POS ya permite **seleccionar precio por línea** (F6 / dialog precio), con **Precio Libre** (requiere `producto.precio`).
- `settings.listas_precios_nombres` y `listas_precios_pct` (%). El POS usa índice 1-5 + 6="Precio mínimo".

### Funcionalidad solicitada (ya parcialmente existe)
- **Seleccionar producto → F6 / "Lista de precios" → mostrar precios de ESE producto:** YA existe (dialog por línea). Se debe **verificar/pulir** que muestre los 4-5+ precios.
- **Precio seleccionable individualmente por producto del carrito:** YA existe (por línea). Confirmar que al cambiar una línea NO recalculan las demás (actualmente `applyLista` recalcula TODAS al cambiar la lista global, pero el override por línea es independiente — verificar que el flujo F6 no toca las demás líneas). **El override por línea debe quedar ligado a la línea, no al carrito.**

### Bloque 8: Crear nuevas listas de precios (estructura dinámica)
**Hallazgo:** hoy es **cantidad FIJA de 5 listas** (+mínimo). Para listas dinámicas ("Mayoreo", "Distribuidor", "Especial") se necesita:

**[REQUIERE DECISIÓN]** Cambiar de "5 columnas fijas" a **colección/tabla `price_lists`**:
- `price_lists: { id, name/codigo, descripcion, tipo (porcentaje|precio_fijo), value (pct o precio), estado, prioridad/sort_order, es_minimo: bool }`.
- `products` pasa a tener precios indexados a la lista por **id de lista** (no por índice 1-5): `products.precios: { <price_list_id>: {precio_sin_iva, precio_con_iva, utilidad_pct} }`.
- **No asumir solo porcentaje:** soportar listas de **precio fijo** y de **porcentaje sobre costo**.
- **Compatibilidad/migración:** la estructura actual (5 listas por índice) debe poder representarse como 5 price_lists por defecto para conservar datos. Migración Alembic + migración de datos de `precios[]`.
- **MongoDB fallback:** el cambio de "5 columnas" a "por lista" afecta al modelado de datos; ver Bloque 21.
- Frontend: selector de lista dinámica en POS y en Configuración→Precios.

---

## 10. VENTA SIN INVENTARIO — BLOQUE 9

### Estado actual
Ya **existe** la base a nivel de producto: `products.controles.permitir_inventario_negativo` (por producto) y `controlar_inventario` (server.py:228-229, 1553-1557; pos.py:118-126). **NO hay override por venta con autorización/auditoría.**

### Diseño propuesto
1. Mantener la validación actual (controlar+no permitir_neg → 409/400 si insuficiente).
2. Añadir **override por venta** cuando el **rol autorizado** lo confirma:
   - Nuevos campos en `SaleInput`: `allow_negative_inventory: bool`, `override_reason: str`.
   - **Solo roles con permiso `inventario.autorizar_negativo`** pueden enviar `allow_negative_inventory=true`. Si un usuario sin permiso lo envía → 403 (o se ignora).
   - Registrar en la venta: `override_user_id` (=JWT), `override_reason`, `override_timestamp`.
   - Con override: permitir descenso a inventario **negativo** dentro de la transacción atómica (pos.py ya soporta `permitir_neg`, extender a nivel de venta).
3. **Frontend:** diálogo "Este producto no tiene inventario suficiente." [CANCELAR]/[CONTINUAR]; CONTINUAR solo si el usuario tiene el permiso; siempre pide `override_reason`.
4. **Auditoría** del override (log_audit) + detalle en la venta.
- [REQUIERE DECISIÓN] ¿Qué roles: solo `admin`/`encargado` con `inventario.ajuste`? Se propone permiso dedicado `inventario.autorizar_negativo` asignable a `encargado`+ (no a `cajero`).

---

## 11. EXPORTAR/IMPORTAR DATOS GLOBALES — BLOQUE 10

### Estado actual
Existen import/export **Excel** para productos y clientes SOLO. **No** existe export/import global JSON/ZIP del ERP.

### Diseño recomendado
**[REQUIERE DECISIÓN — alcance y formato]**
- **Formato:** Exportación JSON estructurada en **ZIP**, con manifiesto (versión de formato, fecha, engine, sucursal) + por colección (`users, clients, products, sales, cajas, caja_movimientos, inventory_movements, abonos, cfdi_documents, settings, price_lists, audit_logs, files`).
- **Datos + archivos:** incluir rutas de archivos (tickets PDF, imágenes) como binarios en el ZIP `files/`, y en las colecciones referenciar esos archivos. (Storage local en `backend/uploads`.)
- **Excluir/proteger secretos:** `users.password_hash` (exportar con placeholder o excluir), `pac_config` API key, `refresh_tokens`, `login_attempts`, `JWT_SECRET`/variables de entorno, tokens. No exportar secretos sensibles innecesariamente.
- **Importar (flujo de 7 pasos como solicita):**
  1. validar archivo (ZIP, tamaño, estructura),
  2. validar **versión** del manifiesto,
  3. validar **integridad** (checksum/hash + referencias cruzadas),
  4. mostrar **resumen** (conteos por entidad, nuevos/existentes),
  5. pedir **confirmación**,
  6. ejecutar (transacción por entidad, respetando relaciones: productos→inventario→ventas),
  7. reportar errores (por fila/entidad) sin dejar el sistema a medias.
- **Exclusiva para roles administrativos autorizados:** permiso `datos.exportar` / `datos.importar` (nuevo), validado en backend.
- **Riesgos de seguridad (Bloque 20):** importación puede sobrescribir/inyectar datos o privilegios; debe validar tipos, claves únicas, y **nunca** aceptar roles/permisos superiores de archivos no confiables. Exportación es una vía de exfiltración → solo admin.
- **Alternativa considerada:** `pg_dump`/backup lógico — **rechazado como función de usuario final** (exposición de secretos, dependencia de infraestructura, no portable a MongoDB, riesgo). El dump de BD queda como herramienta de operaciones/DevTools, no como módulo Configuración.

---

## 12. EDITOR AVANZADO DE TICKETS — BLOQUE 11

### Estado actual
- Frontend: ticket = HTML térmico inline, `window.print()` (POS.jsx:606-651, Recargas.jsx:165-199), NO hay librería de impresión.
- Configuración: pestaña "Diseño de ticket" con **logo, tamaño 80mm/Carta, toggles RFC/Dirección/Teléfono, encabezado y pie, vista previa** (`SettingsInput.ticket_config`).
- Backend: PDF ReportLab (`storage.build_ticket_pdf`) para 80mm/Carta.
- **Generación duplicada en 2 lugares** (HTML frontend para imprimir + PDF backend para WhatsApp). Riesgo de divergencia.

### Diseño propuesto
Convertir el ticket en un **motor de bloques/elementos** configurable, con salida única:
1. **Modelo de ticket basado en elementos** (lista ordenada de bloques), cada uno con `{tipo, contenido, posicion, orden, alineacion, font_size, negrita, visible, ancho, separacion}`. Tipos: `texto, qr, logo, empresa, cliente, venta, fiscal, mensaje`.
   - Para `qr`: `{contenido, url, texto, tamaño}`.
2. **Un solo generador** que renderice los elementos → **HTML** y, a partir del HTML, genere tanto la vista de impresión (frontend) como el **PDF** (backend). Así no hay divergencia. [REQUIERE DECISIÓN] ¿Reescribir `storage.build_ticket_pdf` para consumir el JSON de elementos (HMTL→PDF vía ReportLab platypus o weasyprint) vs mantener ReportLab canvas? Recomendado: generar el HTML del ticket en backend y convertirlo a PDF (un solo origen).
3. `ticket_config` se expande de toggles a **`ticket_config.elements[]`** (persistente en settings). Migración de los toggles actuales a bloques por defecto.
4. **MongoDB:** el formato `elements[]` es solo datos JSONB → compatible con MongoDB.

---

## 13. BARRA SUPERIOR / INFO DE CLIENTE — BLOQUE 12 (UX)

### Estado actual
Existe `TableScroller.jsx` (barra flotante inferior + botones laterales) en tablas anchas (Productos, Clientes).

### Recomendación UX
- Para tablas con **muchas columnas y datos de cliente (descripciones)**: **resumen contextual / sticky header de fila activa** es lo más apropiado.
- **Recomendado:** **fila activa fija (sticky top)** que, al seleccionar/focus una fila, muestra sus campos clave (descripción larga, cliente, RFC, saldo, etc.) en una **barra superior sticky** dentro de la tabla (scroll horizontal/vertical no la pierde).
- Alternativa complementaria: **tooltip/expandir fila** (row expansion) para la descripción larga en lugar de la doble barra inferior actual.
- NO implementar barra flotante duplicada inferior; reemplazar la doble barra por un **panel superior contextual** cuando haya selección activa, y mantener el scroller inferior solo para navegación horizontal.

---

## 14. VENTAS MÚLTIPLES PARA FACTURACIÓN — BLOQUE 13

### Estado actual
- **1 factura = 1 venta.** `cfdi_documents.sale_id` es escalar (1:1). `emitir_cfdi` recibe `sale_id` único (2576) y `ventas_facturables` (2570) lista ventas individuales no facturadas.
- `sales.facturado` bool; ventas ya facturadas se excluyen; cancelar CFDI revierte `facturado`.
- No hay estado fiscal parcial; solo `facturado` (bool) + `cfdi_documents.status (vigente/cancelado)`.

### Diseño propuesto
**[REQUIERE DECISIÓN — clave fiscal]**
1. Permitir **seleccionar varias ventas** (en Ventas y en Facturación) del mismo cliente y **generar UNA factura**.
2. **Modelo fiscal:** cambiar `cfdi_documents.sale_id` (escalar) por `cfdi_documents.sales: [sale_id...]` + `cfdi_documents.cliente_id`/`rfc` únicos. La factura agrega items de varias ventas en un solo CFDI (Conceptos).
3. **Validación en backend (evitar doble facturación):** antes de emitir, validar que **ninguna** venta seleccionada esté ya `facturado=true`, ni `estado != confirmada`, ni `tipo_venta == cotizacion`. Marcar con `UPDATE ... WHERE facturado=false` (traslación de la idempotencia/atomicidad). Si cualquiera ya está facturada → 409/400 y no timbrar nada.
4. **Reglas fiscales a respetar (propietario):** 
   - mismo receptor (cliente/RFC) obligatorio,
   - misma moneda/condición de pago o pasar a PPD global con forma de pago específica,
   - **el actual modelo PAC (Facty) genera un CFDI por venta**; agregar 1 CFDI con varios conceptos es compatible (mapear items concatenados).
   - **No permitir facturar dos veces** la misma venta si el modelo fiscal no lo permite → check en backend.
5. **Estado parcialmente facturado:** [REQUIERE DECISIÓN] ¿se permite facturar *parte* de una venta (p.ej. abono/lote de items) o siempre la venta completa? Por defecto recomendado: **venta completa** (como hoy) para el CFDI; "parcial" requeriría split de conceptos y complejidad alta.
6. Frontend: checkboxes de selección múltiple en Ventas y Facturación + botón "Facturar seleccionadas" y "Enviar por WhatsApp" (Bloque 14).

---

## 15. FACTURACIÓN POR WHATSAPP — BLOQUE 14

### Estado actual
- **PDF/XML de CFDI se descargan** del PAC (Facty) vía `descargar_cfdi` (2604). No se almacenan localmente como archivos propios más allá de lo que devuelve el PAC.
- **No hay API de WhatsApp integrada.** El envío actual es por **enlace `wa.me`** (abre el navegador/WhatsApp con URL) tanto en ticket como en factura — sin enviar el archivo como adjunto.

### Diseño propuesto (sin contratar servicios aún)
1. Al timbrar, **persistir** PDF y XML en storage local (`db.files`) vinculados a `cfdi_documents` (no solo stream del PAC).
2. **Botón "Enviar por WhatsApp"** en Facturación y en el modal de venta:
   - **Opción 1 (hoy viable sin servicio):** enlace `wa.me/<telefono>?text=<mensaje>` apuntando al PDF/XML público (igual al patrón de ticket actual). Barato, sin API.
   - **Opción 2 (futuro):** API de mensajería (WhatsApp Business API / proveedor tipo Meta, Twilio, etc.) para enviar adjuntos reales PDF/XML. Requiere contratación — **NO implementar ahora**.
3. **Componentes futuros:** servicio `whatsapp_provider.py` (análogo a `pac_provider.py`), configuración (token/proveedor) en Configuración→Facturación, cola/reintentos, registro de envíos (historial de mensajes, Bloque 16).
4. Backend expone endpoint `GET /facturacion/{id}/file/{tipo}` (pdf|xml) y `confirma` el enlace. El frontend usa `fileUrl()`.

---

## 16. CUENTAS POR COBRAR — BLOQUE 15 (filtros) + BLOQUE 16 (recordatorios) + BLOQUE 17 (PDF adeudo)

### 16a. Filtros CxC (Bloque 15)
Módulo existente (`CuentasPorCobrar.jsx`, endpoints `GET /cxc`, `GET /cxc/{id}`, `POST /cxc/{id}/abono`). Estados actuales: derivados por `sale.saldo` / días (corriente, vencida, etc.) y tipo de venta a crédito.

**Filtros propuestos (añadir a `GET /cxc` + UI):** cliente (q), RFC, fecha venta (desde/hasta), fecha vencimiento, saldo (rango/min), monto original, días vencidos (rango), estado (`pendiente|parcialmente_pagada|vencida|liquidada`), ventas con/sin abonos, vendedor_id, cajera/operador (usuario_id), sucursal_id, folio, facturada/no facturada.
**Estados sugeridos** → derivar en backend y permitir filtro `estado`.

### 16b. Recordatorios (Bloque 16)
- Usar datos del cliente: `telefono`/`whatsapp`, `correo` (clients ya tienen estos campos).
- **Plantillas configurables** (`settings` o colección `plantillas`): por defecto "Estimado {cliente}, tiene un saldo pendiente de ${saldo}..." con variables `{nombre},{saldo},{vencimiento},{dias}`.
- **Canal:** WhatsApp por enlace `wa.me` (inmediato, sin API) y/o correo (requiere SMTP — no configurado hoy; posponer).
- **Historial de mensajes:** colección `mensajes` `{id, cliente_id, canal, tipo, contenido, estado, destinatario, usuario_id, fecha}` para auditoría (y para futuro api de WhatsApp).
- Permiso nuevo `cxc.recordar`.
- No implementar integración externa aún.

### 16c. PDF detallado de adeudo (Bloque 17)
Reutilizar **ReportLab** (ya usado en `_reporte_pdf_bytes` y `storage`).
- Nuevo endpoint `POST /cxc/{cliente_id}/adeudo-pdf` (o GET export) → PDF con: encabezado Cliente/RFC/Fecha, **detalle por venta** (folio, fecha, producto, descripción, cantidad, precio, total), luego Total vendido / Abonos / Saldo.
- Storage: generado con ReportLab → `storage.put_object` → `db.files` → enlace para imprimir. Reutiliza branding (logo, Bloque 18).
- Permiso: `reportes.ver` o `cxc.ver` + `exportar`.

---

## 17. RECARGAS — impacto (Bloque 15/21 y transversal)

- Las recargas son **ventas `tipo_venta=="recarga"`**; heredan todo: caja obligatoria (Bloque 5), operador (Bloque 4), sucursal, permisos de visibilidad (Bloque 3), facturación.
- **Filtro "¿quién la realizó?":** ya en `vendedor_id`/`usuario_id`; asegurar visibilidad por alcance.
- **Mobile Mongo:** sin cambios excepto los filtros de alcance.

---

## 18. LOGOTIPO PERSONALIZABLE — BLOQUE 18 (branding)

### Estado actual
- **Ticket/PDF:** `settings.logo_url` → `/api/files/...`; se muestra en preview de ticket (Configuracion) y en PDF de reporte (usa `brand/logotipo.png` o logo subido). **POS/Recargas NO muestran el logo** en el HTML térmico.
- **Landing:** PNG **estático** `/brand/ISOTIPO-Photoroom.png` y `/brand/logotipo-Photoroom.png`.
- **Login/ERP:** icono lucide `Boxes` (sin imagen).
- No hay favicon ni logo global unificado.

### Diseño propuesto
1. **Una sola fuente de branding:** `settings.logo_url` + nuevos `settings.logo_isotipo_url` (o similar). **Fallback a logo por defecto** (`brand/logotipo.png`) si no existe el personalizado (NO eliminar el fallback).
2. **Aplicar donde corresponda:**
   - Login: `<img src={fileUrl(logo)||default}>`.
   - Landing: usar `fileUrl(s.logo_url)` (hoy estática) con fallback; no romper el flujo actual si el logo es predeterminado.
   - ERP (ErpLayout): mostrar logo personalizado con fallback al icono/logo default.
   - Tickets (HTML) y PDFs: usar `logo_url` (añadir al ticket HTML, hoy ausente).
   - Favicon: `GET /files/.../favicon` o endpoint `/logo`.
3. **Validación de formato:** aceptar PNG (transparencia), JPG/JPEG, WebP (si compatible). Los PNG transparentes deben conservar canal alfa en tickets/PDF. Upload ya valida MIME real ≤8MB (`/uploads/image`).
4. Endpoint seguro `GET /files/{path}` ya público.

---

## 19. MÓDULOS PREDETERMINADOS PARA USUARIOS — BLOQUE 19

### Estado actual
- `create_user` (824) y `update_user` (843): solo `es_admin_sistema` (permiso `usuarios.admin`) puede asignar roles privilegiados o `modulos` (829-831, 848-853).
- `users.modulos` es un array; `effective_permissions` suma permisos de módulos.
- **No existe default de módulos** para usuarios no-administrativos. `vendedor`/`cajero` arrancan con permisos base (que no incluyen productos/inventario/clientes si no se les asignan módulos).

### Diseño propuesto
1. **Default (solo para no-`super_admin/admin/...`) de módulos activados:** `productos, inventario, clientes, recargas, ventas, caja, reportes` (tal como pide). Esto es un **valor por defecto al crear un usuario no privilegiado** → editar `create_user` para **prepoblar `modulos`** con ese set.
2. **Modificable posteriormente** por `usuarios.admin` en el constructor de usuarios (ya existe el contenedor).
3. **Prevenir escalamiento:** al crear/editar, solo `usuarios.admin` puede añadir módulos `usuarios`, `auditoria`, `configuracion` o roles con `*`. Backend valida (ya lo hace `es_admin_sistema`); **extender** para que un `encargado` (si se le da `usuarios.*`) no pueda autocrearse `admin`.
4. Añadir default también para los **nuevos permisos** (Bloques 2-5) coherentes con cada rol.

---

## 20. SEGURIDAD GLOBAL — BLOQUE 20

Riesgos y mitigaciones (todos requieren validación en **backend**, no frontend):

| Riesgo | Estado hoy | Mitigación |
|---|---|---|
| Escalamiento de privilegios | Parcial (create/update user valida `usuarios.admin`) | Endpoint nuevo roles (constructor) solo `usuarios.admin`; validar que `usuarios.*` no se autootorgue `*`/admin |
| Manipulación de IDs (`GET /sales/{id}`, `get_product`, `get_client`, `get_sale`) | `get_sale` sin comprobación de alcance; productos/clientes sin tenant | Validar alcance y sucursal en cada GET/UPDATE |
| Acceso a ventas de otros usuarios | **Vulnerable hoy** (`list_sales` y `get_sale` sin scope) | Bloque 3: filtrar por alcance en query |
| Acceso entre sucursales (futuro) | N/A (no sucursal aún) | Filtro `sucursal_id` en repositorio + validación |
| Modificación de operador | **Vulnerable hoy** (`vendedor_id` aceptado de cualquiera) | Bloque 4 |
| Modificación de precios | Solo por `producto.precio` | Confirmar todos los campos precio requieren el permiso; validar en backend |
| Inventario negativo | Por producto `controles` | Bloque 9: override autorizado con permiso + auditoría |
| Importación de datos | Roles `importar` | Validar tipos/versión/integridad; no aceptar roles privilegiados desde archivo |
| Exportación | Roles `exportar` | Solo admin para export global; excluir secretos |
| Archivos | `/files/{path}` público por diseño; upload valida tipo/tamaño | No subir ejecutables; path traversal ya mitigado por storage; servir con content-type seguro |
| Facturas | `cfdi` 1:1 | Bloque 13: evitar doble timbrado (transaccional) |
| Datos de clientes | Visibles a todo autenticado (list_clients usa `cliente.*`) | Alcance/sucursal en backend |
| APIs abiertas | `reporte_ventas`/`list_sales` sin permiso | Añadir `require_permission` |

**Principio rector:** toda autorización importante se valida con `require_permission` + reglas de alcance/sucursal en el endpoint. Nunca confiar en el frontend.

---

## 21. COMPATIBILIDAD CON MONGODB — BLOQUE 21

La app conserva `DATABASE_ENGINE=mongo`. El monolito es mayormente agnóstico (habla `db.*`), así que muchos cambios solo requieren datos JSONB (compatibles con Mongo). Clasificación:

**A) Inicialmente SOLO PostgreSQL (por transacción/locking nativos):**
- Transacción atómica del POS multi-item (ya solo existe en PG) y su extensión a inventario negativo con override, caja obligatoria, doble-timbrado y export/import transaccional.
- Cualquier cosa que dependa de `pgstore.transaction()`, `FOR UPDATE`, constraints/índices nativos, checksums.

**B) Compatibles con MongoDB (datos JSONB):**
- Roles/permisos (colección `roles` + `modulos`/permisos en `users`).
- Alcance/visibilidad (filtros en query — funciona en ambos engines).
- Operador del POS (campos en `sales`).
- Caja obligatoria (validación por doc).
- Listas de precios dinámicas (colección `price_lists` + `precios` por id en products JSONB).
- Ticket designer (`ticket_config.elements[]` en settings JSONB).
- Branding (`settings.logo_url`; datos de archivo).
- Recordatorios/plantillas (colección `plantillas`/`mensajes`).
- Visibilidad de recargas/reportes (filtros).

**C) Requieren abstracción adicional (ricas/relacionales):**
- **Export/import global** de datos en ZIP con relación entre entidades y atomicidad → en Mongo se haría por colecciones con lógica de orden/rollback manual; conviene una **capa de repositorio** que encapsule (así el import funciona en ambos). [REQUIERE DECISIÓN] ¿Implementar import/export solo PG o abstraído? Recomendado: abstraído para no romper el fallback.
- **Varias ventas → 1 factura** y el modelo `cfdi_documents.sales[]`: ambos engines soportan el JSON array; la **validación de doble-timbrado** requiere una actualización "compare-and-set" — en PG dentro de transacción, en Mongo con `find_one_and_update` condicional (posible pero hay que diseñarla).
- **`product_stock` (existencia por sucursal):** si se hace como tabla con FK/constraints, sería solo PG; si se modela como documentos JSONB (`products.existencias: {sucursal_id: n}`), compatible con Mongo. [REQUIERE DECISIÓN] — relevante para sucursales.

**Directriz:** mantener el patrón `db.*` y data-JSONB siempre que sea posible para preservar el fallback; reservar funciones transaccionales/constraint para PG con `pgstore` y dejarlas degradadas en Mongo (como ya se hace con el POS).

---

## 22. ROADMAP ALEMBIC — BLOQUE 22 (NO ejecutar)

Nota: gran parte del esquema vive en `doc JSONB`, así que "migraciones" en muchos casos = **migraciones de datos + catálogos** y añadir **columnas tipadas/espejo** cuando haga falta indexar por campo. Se listan las migraciones propuestas (según orden recomendado del Bloque 25).

- **Migration 0003 — Sucursales (tenant) [REQUIERE DECISIÓN previa]:**
  - Tabla nueva `sucursales` (`_id, id TEXT PK, doc JSONB` + columnas: `codigo`).
  - Columnas nuevas (espejo + doc JSONB) en: `sales, suspended_sales, cajas, caja_movimientos, clients, inventory_movements, abonos, audit_logs` → `sucursal_id TEXT` (doc + columna indexada). Índices compuestos `(sucursal_id, fecha)`.
  - Tabla nueva `product_stock` (`product_id, sucursal_id, existencia, stock_minimo`) si se adopta existencia por sucursal. Índice `(product_id, sucursal_id)` UNIQUE.
  - Datos de backfill: asignar `sucursal_id` = sucursal por defecto (Matriz) a todos los doc.
- **Migration 0004 — Roles/permisos dinámicos + alcance:**
  - Tabla nueva `roles` (`_id, id, name UNIQUE, doc JSONB`). 
  - `users`: columna `role` ya existe; añadir `sucursales` array (en doc) — sin columna especial.
- **Migration 0005 — Listas de precios dinámicas:**
  - Tabla nueva `price_lists` (`id, doc JSONB`, columnas `sort_order`).
  - `products`: migrar `precios[]` (5 índices) → `precios_map {price_list_id: {...}}`; añadir columna espejo no necesaria. Backfill: crear 5 price_lists por defecto y mapear.
- **Migration 0006 — Inventario negativo con override:**
  - `sales`: campos `allow_negative_inventory, override_user_id, override_reason, override_timestamp` (en doc JSONB, sin columna).
  - `products.controles.permitir_inventario_negativo` ya existe (columna doc, sin cambio de tabla).
- **Migration 0007 — Caja obligatoria:**
  - `sales.caja_id` ya existe como campo; endurecer validación (sin cambio de esquema) — posible columna espejo `caja_id` si se indexa.
- **Migration 0008 — Facturación multi-venta:**
  - `cfdi_documents`: `sale_id` (escalar) → `sales TEXT[]` (doc JSONB) + conservar `sale_id` para compat. Columna nueva no necesaria.
- **Migration 0009 — Export/Import, mensajes, plantillas, adeudo:**
  - Tablas nuevas `mensajes`, `plantillas` (JSONB). `sale_export_manifest` (opcional, temporal).
- **Migration 0010 — Ticket designer:**
  - `settings.ticket_config.elements[]` (doc JSONB) — backfill de toggles actuales a bloques. Sin columna.
- **Migration 0011 — Branding extensible:**
  - `settings.logo_isotipo_url`/`logo_favicon_url` (doc JSONB).

Cada migración = datos + (cuando aplique) columnas/índices via `build_create_table`/`ALTER`. NO ejecutar ninguna hasta aprobación.

---

## 23. IMPACTO EN ARQUITECTURA — BLOQUE 23 (resumen por función)

Se detalla el impacto más significativo; el detalle por función está en las secciones 3-19.

| Función | BACKEND (archivos/servicios/endpoints) | DATABASE | FRONTEND | SEGURIDAD | TESTS |
|---|---|---|---|---|---|
| **Sucursales** | `server.py` (todas las queries locales), `deps.py`, `pgstore` (repositorio/filtro), nuevos endpoints `/sucursales` | tablas nuevas + columna `sucursal_id` + `product_stock` | `ErpLayout` (selector suc.), POS/caja/ventas (filtro), Configuración→Sucursales | check tenant en cada endpoint | multitenancy, acceso entre sucursales |
| **Roles/permisos** | `deps.py` (catálogo, role builder), `server.py` (`/roles`), nuevos `require_permission` | tabla `roles` | Usuarios (constructor roles), sidebar | constructor solo admin | matriz de permisos |
| **Visibilidad** | `list_sales`, `get_sale`, `reporte_ventas`, `cxc_*`, `list_recargas` | — | Ventas/Recargas/Reportes (filtros) | scope en query | alcance propias/todas |
| **Operador POS** | `create_sale`, `crear_recarga` (force operator) | — | POS (quitar dropdown o restringir) | evitar suplantación | operator spoofing |
| **Caja obligatoria** | `create_sale`/`crear_venta_pg`/`crear_recarga` + `caja_actual` | — | POS/Recargas (check caja) | validar caja+usuario | sin caja → 409 |
| **Multi-POS** | — | — | POS → `PosWindow` + `MultiPos` | — | aislamiento de carritos |
| **Precios dinámicos** | `server.py` (products/settings), `ProductForm`/backend | tabla `price_lists` + `precios_map` | POS (selector), Configuración | permiso precio | CRUD listas + selección por línea |
| **Inv. negativo** | `create_sale`/`pos.py` (override) | `sales.*override*` | POS (diálogo CONTINUAR) | permiso + auditoría | override autorizado/no |
| **Export/Import global** | nuevos endpoints `/datos/export`, `/datos/import` | manifiesto + archivos | Configuración→Datos | solo admin + integridad | roundtrip export/import |
| **Ticket designer** | `storage.build_ticket_pdf` (refactor a elemento) | `settings.ticket_config.elements[]` | Configuración (editor bloques) | — | render de tipos |
| **Barra info cliente** | — | — | tablas (sticky row / panel) | — | — |
| **Multi-factura** | `emitir_cfdi`, `ventas_facturables` | `cfdi_documents.sales[]` | Ventas/Facturación (selección múltiple) | evitar doble timbre | varias ventas→1 CFDI |
| **Factura WhatsApp** | `descargar_cfdi` (persistir), nuevo endpoint `/facturacion/{id}/file` | `files` | Facturación botón | — | enlace genera |
| **CxC filtros** | `cxc_list` | — | CuentasPorCobrar | alcance | filtros |
| **Recordatorios** | nuevo `/cxc/{id}/recordar` | `mensajes`, `plantillas` | UI + historial | permiso | plantilla vars |
| **PDF adeudo** | `POST /cxc/{id}/adeudo-pdf` | `files` | botón export | `cxc.ver`+`exportar` | contenido PDF |
| **Logo personalizable** | `/uploads` (validar webp), `/settings` | `settings.logo_*` | Login/Landing/ERP/ticket/PDF/favicon | — | fallback logo |

---

## 24. MATRIZ DE DEPENDENCIAS — BLOQUE 26 (FUNCIÓN | BD | BACKEND | FRONTEND | PERMISOS | DEPENDE DE | RIESGO)

| # | Función | BD | Backend | Frontend | Permisos | Depende de | Riesgo |
|---|---|---|---|---|---|---|---|
| 1 | Sucursales (tenant) | Alta (nueva columna/tabla) | Alta | Alta | Nuevo `sucursal.acceso` | Decisión A/B/C | **Alto** |
| 2 | Roles dinámicos + alcance | Media (tabla roles) | Media | Media | `usuarios.admin` | 1 | **Alto** |
| 3 | Visibilidad (ver propias/todas) | Baja | Media | Baja | `ventas.ver_todas` etc. | 2 | **Alto** (fuga actual) |
| 4 | Operador POS forzado | Baja | Media | Baja | `ventas.cambiar_operador` | 2 | Alto |
| 5 | Caja obligatoria POS | Baja | Media | Media | `venta.crear` + caja | — | Alto (comporta) |
| 6 | Multi-POS | Ninguna | Ninguna | Alta | — | — | Bajo |
| 7 | Listas de precios dinámicas | Media (tabla/listas) | Media | Alta | `config`, `producto.precio` | — | Medio (migración datos) |
| 8 | Inventario negativo con override | Baja | Media | Media | `inventario.autorizar_negativo` | — | Medio |
| 9 | Export/Import global | Media | Alta | Media | `datos.exportar/importar` | — | **Alto** |
| 10 | Ticket designer | Baja | Media | Alta | `config` | — | Bajo |
| 11 | Barra info cliente (UX) | Ninguna | Ninguna | Media | — | — | Bajo |
| 12 | Multi-venta facturación | Baja | Alta | Media | `venta.facturar` | 7 (precios ok) | **Alto** (fiscal) |
| 13 | Factura WhatsApp | Baja | Media | Media | `venta.facturar` | 12 | Bajo |
| 14 | CxC filtros | Baja | Media | Media | `cxc.ver` | 2,3 | Bajo |
| 15 | Recordatorios CxC | Media (mensajes/plantillas) | Media | Baja | `cxc.recordar` | 14 | Bajo |
| 16 | PDF adeudo | Baja | Baja | Baja | `cxc.ver`+`exportar` | 14 | Bajo |
| 17 | Logo personalizable | Baja | Baja | Media | `config` | — | Bajo |
| 18 | Módulos default usuarios | Baja | Baja | Baja | `usuarios.admin` | 2 | Medio (escalamiento) |

---

## 25. PRIORIZACIÓN — BLOQUE 24

**PRIORIDAD 1 (deben hacerse antes del VPS) — afectan arquitectura, BD, seguridad o POS:**
1. **Seguridad/visibilidad (Bloque 3):** fuga actual de datos (cualquier autenticado ve todas las ventas/reportes). Crítico antes de producción.
2. **Operador forzado (Bloque 4):** suplantación de operador. Crítico.
3. **Caja obligatoria (Bloque 5):** flujo de arqueo/control de caja. Crítico para POS en producción.
4. **Roles/permisos granulares + alcance (Bloque 2/3):** fundación para todo lo demás; sin esto no hay control.
5. **Sucursales (Bloque 1) — DECISIÓN y migración 0003:** si se va a multi-sucursal, hay que preparar el esquema AHORA (columna `sucursal_id`) antes de llenar datos; es el cambio más invasivo. **Justifica P1 por bloqueo de infraestructura.**
6. **Inventario negativo con override autorizado (Bloque 9):** seguridad y auditoría sobre el POS; evita "meta inventario" sin control.

**PRIORIDAD 2 (conviene hacer antes del VPS):**
7. **Listas de precios dinámicas (Bloque 7/8):** afecta a datos de productos (migración) y a POS; conviene antes de poblar producción.
8. **Facturación multi-venta + reglas fiscales (Bloque 13):** impacto fiscal; conviene definir antes de VPS para no re-trabajar.
9. **Factura por WhatsApp (Bloque 14):** depende de 8; mejora comercial.
10. **Módulos default (Bloque 19):** simple, evita config manual.

**PRIORIDAD 3 (puede ir después del VPS):**
11. **Multi-POS (Bloque 6):** UX, independiente.
12. **Ticket designer (Bloque 11):** mejora de ticket, no bloquea.
13. **Barra info cliente (Bloque 12):** UX.
14. **CxC filtros/recordatorios/PDF (Bloques 15-17):** mejoras de módulo.
15. **Logo personalizable (Bloque 18):** branding, independiente.
16. **Export/Import global (Bloque 10):** valioso pero no bloquea; alto riesgo, requiere cuidado (opcional P2 por seguridad).

---

## 26. ORDEN DE IMPLEMENTACIÓN RECOMENDADO — BLOQUE 25

Basado en dependencias reales (no el orden propuesto original):

**FASE 5 — Fundación de permisos y seguridad (P1):**
- Bloque 2 (roles dinámicos + constructor) + Bloque 3 (visibilidad backend) + Bloque 20 (endurecer `reporte_ventas`/`list_sales`/`get_sale`) + Bloque 19 (módulos default).
- Resultado: control granular real y cierre de la fuga.

**FASE 6 — Base de datos multi-sucursal (P1, tras DECISIÓN):**
- Bloque 1 (tenant `sucursal_id` + `sucursales` + `product_stock`) con migración 0003.
- Debe ir antes o junto con Fase 5 si hay solapamiento en alcance (alcance "sucursal").

**FASE 7 — POS endurecido (P1):**
- Bloque 4 (operador forzado) + Bloque 5 (caja obligatoria) + Bloque 9 (inventario negativo con override) + Bloque 6 (multi-POS, UX).

**FASE 8 — Precios (P1/P2):**
- Bloque 7/8 (listas de precios dinámicas + selección por línea) — porque afecta datos y POS.

**FASE 9 — Facturación (P2):**
- Bloque 13 (multi-venta → 1 CFDI) + Bloque 14 (WhatsApp) — depende de 8 para precios correctos.

**FASE 10 — CxC completo (P3):**
- Bloque 15 (filtros/estados) + Bloque 16 (recordatorios) + Bloque 17 (PDF adeudo).

**FASE 11 — Ticket y branding (P3):**
- Bloque 11 (ticket designer) + Bloque 18 (logo personalizable) + Bloque 12 (barra info cliente, UX).

**FASE 12 — Export/Import global (P2/P3):**
- Bloque 10 (datos JSON/ZIP) — independiente, alto riesgo, último.

---

## 27. CAMBIOS QUE NO RECOMIENDAS — BLOQUE 27

**NO hacer / mala idea ahora:**
1. **NO crear una BD por sucursal ahora** (opción B): alto costo, rompe reportes globales y el shim JSONB, migración masiva. Solo tras crecimiento real y con el tenant ya preparado.
2. **NO usar `pg_dump`/restore crudo como función de usuario** en Configuración (solo como backup operacional/DevTools). Riesgo de secretos + no portable.
3. **NO implementar API de WhatsApp pagada / integración externa** aún (Bloque 14/16): usar enlaces `wa.me` primero.
4. **NO forzar nuevos permisos sin cerrar la fuga actual primero** (prima seguridad sobre features).
5. **NO cambiar a "precios solo por porcentaje"** (Bloque 8): soportar precio fijo.
6. **NO implementar ventas múltiples→factura sin definir la regla fiscal** (parcial vs completa) — riesgo de violar timbrado/CFDI.
7. **NO reescribir el POS a un store global único** (Multi-POS): mantendría los carritos mezclados; usar instancias aisladas.
8. **NO eliminar el fallback del logo** ni el `permitir_inventario_negativo` por producto (riesgo de perder funcionalidad existente).

**Cosas que complican la futura multi-sucursal:**
9. **NO consolidar la existencia en un único `products.existencia`** si se planea multi-almacén; modelar por sucursal desde el inicio (aunque hoy sea 1 sucursal).
10. **NO añadir catálogos/procesos sin `sucursal_id`** (clientes, ventas, caja, cxc) o se rehace después.
11. **NO tomar decisiones irreversibles de esquema sin aprobación** (ver [REQUIERE DECISIÓN]).

---

## 28. RESULTADO FINAL

Documento generado: `docs/PLAN_NUEVAS_FUNCIONES.md`. **NO se implementó ninguna función, no se modificó código, BD, ni se crearon migraciones; no se tocó VPS; no commit/push.**

---

## DECISIONES QUE REQUIEREN APROBACIÓN (recopilación)

1. **Arquitectura de sucursales:** A) 1 BD + `sucursal_id` (recomendada) / B) 1 BD por sucursal / C) híbrida. → afecta migración 0003.
2. **Clientes globales o por sucursal** (Bloque 1).
3. **Config global vs local por sucursal** (Bloque 1).
4. **Modelo de alcance de permisos** (propias/sucursal/todas) y qué roles (Bloque 2/3).
5. **Constructor de roles**: roles dinámicos vs solo hardcode (Bloque 2).
6. **Overrides de inventario negativo**: roles autorizados y token `inventario.autorizar_negativo` (Bloque 9).
7. **Export/Import global**: alcance (solo PG o abstraído), formato, secretos excluidos (Bloque 10 y 21-C).
8. **Ticket: dónde generar (frontend HTML vs backend→PDF)** para un solo origen (Bloque 11).
9. **Facturación multi-venta**: venta completa vs parcial; reglas fiscales (Bloque 13).
10. **`product_stock` (existencia por sucursal)**: tabla PG (constraints) vs JSONB por sucursal (compat Mongo) (Bloque 21-C).
11. **Bloque 13**: si permitir facturar ventas ya parcialmente facturadas.

**Condición:** el propietario debe revisar estas decisiones antes de autorizar cualquier implementación.
