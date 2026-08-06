# PRD — Grupo RYSA ERP & POS

## Problema original
ERP/POS web full-stack para Grupo RYSA (comercio de plásticos y desechables, mayoreo y menudeo). Modular y escalable. Fase 1: Landing pública, Auth/Roles, Dashboard, Productos+Inventario, Clientes, Caja, POS, Import/Export Excel, Auditoría. Prioridad: funcionalidad real conectada a BD e integración entre módulos; eficiencia de créditos.

## Arquitectura
- Backend: FastAPI (0.0.0.0:8001, prefijo /api) — `server.py`, `deps.py`
- BD: MongoDB (MONGO_URL / DB_NAME). IDs uuid string, proyección `{_id:0}`.
- Frontend: React 19 + Tailwind + shadcn/ui + recharts. Alias `@/` → src.
- Auth: JWT (Bearer + cookie httpOnly), bcrypt, RBAC por roles.

## Personas / Roles
- admin (acceso total), encargado (amplio sin config crítica), vendedor (POS+clientes), cajero (caja+cobros).

## Implementado (2026-08-04) — Fase 1 COMPLETA y probada (24/24 backend, smoke frontend)
- Landing page pública (hero, categorías bento, destacados, mayoreo/menudeo, contacto, footer)
- Login JWT + rutas protegidas + logout. Admin seed: REDACTED
- Usuarios y roles/permisos (crear usuario, activar/desactivar)
- Dashboard con métricas reales (ventas día/mes, caja, stock bajo/sin existencia, clientes, gráfica 7 días, ventas recientes, alertas)
- Productos e Inventario: CRUD, ficha con pestañas (Identificación/Generales/Precios/SAT/Controles/Ficha técnica/Sinónimos/Imagen), 5 listas de precios + precio mínimo con cálculo utilidad/IVA, estados activo/baja/suspendido, filtros (estado, bajo stock, sin existencia), búsqueda, Kardex de movimientos, ajuste de inventario
- Clientes: CRUD, tipos (público/menudeo/mayoreo/especial), lista precios, condición pago, límite crédito, saldo; cliente Público General por defecto
- Caja: apertura con fondo, movimientos (entrada/retiro/gasto/ajuste), resumen (esperado), cierre con diferencia
- POS: búsqueda rápida, carrito, cliente, lista de precios, descuento línea y global, condición contado/crédito, pagos mixtos + cambio, ticket, suspender/recuperar ventas
- Integración POS↔Inventario (descuenta + kardex salida), POS↔Caja (efectivo entra), POS↔Crédito (saldo cliente)
- Ventas: historial con filtros (rango/estado), detalle, cancelar con reversión (inventario+caja+crédito), copiar, reimprimir
- Import/Export Excel de productos (plantilla, preview+validación, confirm) y clientes
- Auditoría de acciones críticas

## Implementado (2026-08-05) — Módulo Categorías
- Página `Categorias.jsx` conectada a rutas (`/app/categorias`) y menú lateral (ícono Tags)
- 74 categorías reales derivadas del campo **CLASIFICACION** de los productos (decisión del usuario), con conteo por categoría, imagen editable (URL), descripción y ficha técnica (colección `categories` para metadata)
- Filtro rápido por categoría en Productos (selector desplegable) + navegación desde tarjeta "Ver" que aplica el filtro automáticamente vía `location.state`
- Backend: `GET/POST /api/categories` agrupa por `clasificacion`; `GET /api/products?categoria=` filtra por `clasificacion`. Verificado con curl y capturas (74 categorías, filtro BOLSA NATURAL = 58 productos)

## Implementado (2026-08-05) — Clientes: estructura completa (DBF heredada, 52 campos)
- `ClientInput` ampliado a los 52 campos legacy (CLAVE→codigo, NOMBRE, CREDITO→credito_autorizado, LIMCREDITO→limite_credito, SALDO, STATUS→estado, PRECIOVTA→precio_venta/lista_precios sync, RET_ISR/IVA, RET_*TAS, DIASCREDIT, MENSUAL/ANUAL, ULTF/CCOMPRA, USOCFDI, REGFISCAL, OFERTAS, CORREOS, etc.) — como columnas reales, no JSON.
- `CLIENT_IMPORT_MAP` + `parse_client_row` con conversión de tipos DBF (C/N/D/L/M) y validaciones (CLAVE/NOMBRE obligatorios, RFC y correo válidos, no negativos). `normalize_client_doc` sincroniza campos compat sin romper POS.
- Índice ÚNICO en `clients.codigo` (CLAVE). Identificación por CLAVE en import.
- Importación segura: `POST /clients/import/preview` (nuevos/existentes/a actualizar/errores + descarga de reporte de errores) y `POST /clients/import/confirm` (modos nuevos|actualizar|ambos). XLSX/XLS/CSV, detección automática de encabezados. En update NO se sobrescribe `saldo` (lo gobiernan las ventas).
- Toggles rápidos en el listado: `PATCH /clients/{id}/credito-toggle` y `PATCH /clients/{id}/estado`. Guardado automático con toast, sin recargar.
- Ficha con 10 pestañas (General, Contacto, Dirección, Fiscales, Comercial, Crédito, Retenciones, Estadísticas, Comentarios, Configuración).
- Listado con columnas: Clave, Nombre, RFC, Ciudad, Teléfono, Celular, Vendedor, P.Vta, Saldo, Límite, Crédito (switch + indicador financiero 🟢🟡🔴⚫), Estado (selector rápido), Alta. Filtros: Todos/Con-Sin crédito/Con-Sin saldo/Activos/Suspendidos/Inactivos/Con-Sin ofertas. Búsqueda ampliada (clave, nombre, RFC, representante, tel/celular, correo, ciudad, estado).
- POS respeta crédito: venta a crédito a cliente sin `credito_autorizado` → 400 "El cliente no tiene crédito autorizado" (verificado). Plantilla legacy descargable.
- Verificado con curl (crear, toggle, estado, preview con 2 errores detectados, confirm crear+actualizar por CLAVE, tipos convertidos, POS bloqueo) y capturas. Clientes existentes intactos.

## Implementado (2026-08-05) — POS indicador de crédito + Clientes navegación/orden
- POS: al elegir cliente se muestra semáforo de crédito (🟢🟡🔴⚫) con Límite, Saldo y Disponible (`pos-credito-indicador`). Si `condicion=credito` y el cliente no tiene crédito → aviso rojo y botón Cobrar deshabilitado (backend ya devuelve 400).
- Clientes: tabla configurable (`COLS`) con encabezados ordenables asc/desc (menor↔mayor / A↔Z, locale es numeric), barra de navegación/paginación (tamaños 25/50/100/200, primera/anterior/siguiente/última, "Página X de N") y botón "Columnas vacías" que oculta columnas sin datos (mantiene Clave/Nombre y las especiales Crédito/Estado). Filtros rápidos y búsqueda ampliada ya existentes.
- Verificado con capturas: base real importada 688 clientes, orden por Nombre, ocultar vacías (RFC/Ciudad/Tel/Celular/Vend), paginación 14 páginas; POS semáforo "Crédito activo (disponible)".

## Implementado (2026-08-05) — Cuentas por Cobrar (CxC)
- Nuevo módulo `/app/cxc` (`CuentasPorCobrar.jsx`) + enlace en menú (perm `caja.entrada`, ícono HandCoins).
- Backend: `GET /cxc` (cartera con antigüedad: corriente/1-30/31-60/61-90/+90, totales cartera/por vencer/vencido/clientes, búsqueda y filtro solo_vencidos), `GET /cxc/{id}` (estado de cuenta: ventas a crédito con saldo/vencimiento/días + historial de abonos), `POST /cxc/{id}/abono` (aplica FIFO a ventas más antiguas, reduce `sale.saldo` y `client.saldo`, valida no exceder saldo; si método=efectivo y hay caja abierta, entra a Caja). Modelo `abonos` con folio AB, aplicaciones, usuario, caja_id.
- Antigüedad calculada por venta: vencimiento = fecha + `dias_credito` del cliente.
- Cancelación de venta a crédito ahora revierte solo el saldo pendiente (respeta abonos previos) y pone `sale.saldo=0`.
- UI: tarjetas resumen, barra de antigüedad, tabla de deudores con aging por cubeta y días de mora, diálogo de abono (monto/saldo total/método/referencia/nota) y estado de cuenta (ventas Pagada/Vigente/Vencida + abonos).
- Verificado con curl (venta crédito→CxC saldo/aging, abono parcial FIFO 500 saldo 1160→660, caja efectivo, validación exceso 400) y capturas (deudor demo con venta vencida 45d en bucket 31-60).

## Implementado (2026-08-06) — Fase 2 Bloque A: POS + Clientes + Ventas
- BUGFIX crítico (verificado testing agent iter.3): "el monto es menor que la venta". Causa: `calcular_venta` trataba el precio como neto y sumaba IVA encima, pero el POS envía precio_con_iva. Ahora extrae el IVA (neto=bruto/(1+tasa)); validación de contado con tolerancia de 1 centavo.
- POS: selector de cliente movido a la izquierda, ancho completo, con búsqueda por nombre/clave (filtra al escribir, `pos-cliente-search`). Al elegir cliente aplica su lista de precios predeterminada y su descuento permanente.
- POS: selector de lista de precios junto al cliente; al cambiar lista se recalculan todos los precios del carrito (F6 también). Incluye "Precio mínimo".
- POS: selector de precio por línea (`cart-price-*` → dialog) con Precio 1-5 + Precio mínimo (con importes) + Precio Libre (requiere permiso `producto.precio`).
- POS: casilla "Precios incluyen IVA" (default settings.precios_incluyen_iva=True, toggle requiere `config`/`producto.precio`). Cuando activa, el ticket muestra solo el total sin desglose de IVA.
- POS: métodos de pago con iconos + SPEI (Efectivo/Tarjeta/Transferencia/SPEI/Depósito/Otro).
- Clientes: nuevos campos `descuento_permanente` (%) y lista predeterminada con opción "Precio mínimo"; edición de lista/descuento solo con permiso `producto.precio` (cajero solo lectura).
- Ventas: botón "Remitir" (duplica venta con cliente/cantidades/precios/lista y abre el POS con todo cargado). Cancelar con motivo ya existía.
- Backend: Settings.precios_incluyen_iva (bool), ClientInput.descuento_permanente.
- Verificado por captura: POS renderiza sin errores, dialog de precio por línea, ticket sin desglose de IVA, total correcto.

### Fase 2 pendiente (por bloques, requiere aprobación/credenciales)
- Bloque B: Usuarios con permisos granulares + constructor de roles.
- Bloque C: Movimientos de Inventario + Kardex (entradas/salidas/ajustes/mermas/transferencias, motivo obligatorio).
- Bloque D: Productos (código de barras + búsqueda + subir imágenes con almacenamiento en la nube integrado; imágenes también en Categorías).
- Bloque E: Facturación CFDI 4.0 (Facturama) — dejar estructura lista sin credenciales; timbres en config y barra superior.
- Config: logo en tickets, tamaños POS80/Carta, decimales, IVA default, moneda, series/folios.
- WhatsApp: envío por enlace wa.me (ticket/factura/cotización). Correo (reenvío): pospuesto.

## Implementado (2026-08-06) — Fase 2 Bloque E: Facturación CFDI 4.0 (estructura Facturama)
- Arquitectura PAC-agnóstica (Facturama primero). Backend en server.py:
  - `pac_config` (colección): provider, environment sandbox/produccion, api_user, api_password (no se devuelve), rfc, razón social, régimen, serie, folio, lugar expedición, timbres_alerta.
  - Endpoints: GET/PUT `/facturacion/config` (contraseña enmascarada), GET `/facturacion/timbres` (Facturama /SuscriptionPlan, con alerta y cache), GET `/facturacion` (CFDI emitidos), GET `/facturacion/facturables` (ventas confirmadas no facturadas), POST `/facturacion/sale/{id}` (timbra CFDI 4.0 vía POST /3/cfdis, mapea venta→payload, marca sale.facturado), GET `/facturacion/{id}/{xml|pdf}` (descarga base64), POST `/facturacion/{id}/cancel?motivo=&uuid_reemplazo=` (motivos 01-04).
  - Mapeo de venta: precio_con_iva → base/IVA extraídos; receptor genérico XAXX010101000/S01/616 si no hay cliente.
  - httpx con Basic Auth. Si no está configurado, emitir devuelve 400 claro (verificado).
- Frontend `Facturacion.jsx` + ruta `/app/facturacion` + nav "Facturación": pestañas Emitidas / Por facturar / Configuración PAC. Badge de timbres en la barra superior (verde/rojo según alerta; "PAC sin configurar" si faltan credenciales). WhatsApp por enlace wa.me. XML/PDF y cancelar/sustituir.
- NOTA: sin credenciales de Facturama aún; el timbrado en vivo NO se pudo probar. La estructura está lista: al capturar usuario/contraseña API en Configuración → Facturación (y cargar el CSD en la cuenta Facturama), timbrará automáticamente. Verificado: config guarda, timbres responde "no configurado", emitir sin PAC devuelve mensaje claro, UI renderiza sin errores.


## Backlog (futuras fases — NO construir hasta solicitud)
- P1: Proveedores, Compras, Cuentas por cobrar/pagar, Cotizaciones
- P2: Facturación electrónica, Multi-almacén/sucursales, Catálogo online/e-commerce, Pedidos WhatsApp, App móvil, reportes avanzados, recuperación de contraseña por email, código de barras/escáner
