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


## Backlog (futuras fases — NO construir hasta solicitud)
- P1: Proveedores, Compras, Cuentas por cobrar/pagar, Cotizaciones
- P2: Facturación electrónica, Multi-almacén/sucursales, Catálogo online/e-commerce, Pedidos WhatsApp, App móvil, reportes avanzados, recuperación de contraseña por email, código de barras/escáner
