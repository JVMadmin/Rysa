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

## Backlog (futuras fases — NO construir hasta solicitud)
- P1: Proveedores, Compras, Cuentas por cobrar/pagar, Cotizaciones
- P2: Facturación electrónica, Multi-almacén/sucursales, Catálogo online/e-commerce, Pedidos WhatsApp, App móvil, reportes avanzados, recuperación de contraseña por email, código de barras/escáner
