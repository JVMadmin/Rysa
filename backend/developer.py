"""Módulo DESARROLLADOR (herramientas de desarrollo, pruebas y diagnóstico).

NO forma parte de la operación normal del ERP. Capas de protección para las
operaciones destructivas (todas deben cumplirse):

    1. ENVIRONMENT != production
    2. DEVELOPER_MODE = true
    3. Usuario autenticado
    4. Rol 'admin_desarrollador'
    5. Permiso 'developer_tools' (no otorgado por el comodín "*")

Además, cuando el entorno es producción las rutas destructivas NO se
registran en el router (404 natural), y las de lectura se bloquean con 404
como el resto de /dev/*.

El frontend NUNCA envía SQL: solo invoca operaciones predefinidas aquí.
Toda limpieza corre dentro de UNA transacción (ROLLBACK ante cualquier
fallo) y queda registrada en audit_logs.
"""
import os
import json
import re
import time
import uuid
import platform
import shutil
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel
from sqlalchemy import text

import pgstore
from pgstore.database import transaction
import storage
from deps import require_permission, iso_now

_BACKEND_DIR = Path(__file__).parent
_STARTED = time.time()

# --------------------------------------------------------------------------- #
# Entorno / modo desarrollador                                                 #
# --------------------------------------------------------------------------- #
_APP_ENV = os.environ.get("ENVIRONMENT", "development").lower()
_raw_mode = os.environ.get("DEVELOPER_MODE", "").strip().lower()
if _raw_mode in ("true", "1", "on", "yes"):
    DEVELOPER_MODE = True
elif _raw_mode in ("false", "0", "off", "no"):
    DEVELOPER_MODE = False
else:
    # Sin configuración explícita: activo solo fuera de producción.
    DEVELOPER_MODE = _APP_ENV != "production"

DESTRUCTIVE_ENABLED = (_APP_ENV != "production") and DEVELOPER_MODE
DEV_ROLE = "admin_desarrollador"
APP_VERSION = os.environ.get("RYSA_VERSION", "1.0.0")
API_VERSION = "v1"

router = APIRouter(prefix="/api")
destructive = APIRouter()  # sin prefijo: se incluye dentro de `router` (§77)

# --------------------------------------------------------------------------- #
# Bitácora en memoria de requests fallidos (alimentada por middleware)         #
# --------------------------------------------------------------------------- #
DEV_REQUEST_LOG = []
_MAX_REQUEST_LOG = 400


def record_request_error(entry: dict):
    DEV_REQUEST_LOG.append(entry)
    DEV_REQUEST_LOG[:] = DEV_REQUEST_LOG[-_MAX_REQUEST_LOG:]


# --------------------------------------------------------------------------- #
# Dependencias de autorización                                                 #
# --------------------------------------------------------------------------- #
async def dev_read(user: dict = Depends(require_permission("dev.info"))):
    """Lectura/diagnóstico: requiere permiso dev.info; 404 en producción."""
    if _APP_ENV == "production":
        raise HTTPException(status_code=404, detail="No encontrado")
    return user


async def dev_destructive(user: dict = Depends(require_permission("developer_tools"))):
    """Operaciones destructivas: TODAS las capas deben cumplirse."""
    if _APP_ENV == "production":
        raise HTTPException(status_code=404, detail="No encontrado")
    if not DEVELOPER_MODE:
        raise HTTPException(status_code=403, detail="DEVELOPER_MODE está desactivado")
    if user.get("role") != DEV_ROLE:
        raise HTTPException(status_code=403, detail="Se requiere el rol admin_desarrollador")
    return user


# --------------------------------------------------------------------------- #
# Helpers SQL                                                                  #
# --------------------------------------------------------------------------- #
async def _q(conn, sql: str, params: dict | None = None):
    return await conn.execute(text(sql), params or {})


async def _count(conn, tabla: str, where: str = "TRUE", params: dict | None = None) -> int:
    res = await _q(conn, f'SELECT count(*) FROM "{tabla}" WHERE {where}', params)
    return int(res.scalar() or 0)


async def _del(conn, tabla: str, where: str = "TRUE", params: dict | None = None) -> int:
    res = await _q(conn, f'DELETE FROM "{tabla}" WHERE {where}', params)
    return res.rowcount or 0


async def _ids(conn, tabla: str, where: str, params: dict | None = None) -> list:
    res = await _q(conn, f'SELECT "id" FROM "{tabla}" WHERE {where}', params)
    return [r[0] for r in res.fetchall()]


async def _audit_tx(conn, user: dict, accion: str, detalle: dict):
    doc = {
        "id": uuid.uuid4().hex,
        "usuario_id": user.get("id"),
        "usuario_nombre": user.get("name"),
        "accion": accion,
        "entidad": "developer",
        "registro_id": "",
        "detalle": json.dumps(detalle, ensure_ascii=False, default=str)[:2000],
        "fecha": iso_now(),
    }
    await _q(conn,
             'INSERT INTO audit_logs ("_id","id","doc") '
             'VALUES (CAST(:k AS text), CAST(:k AS text), CAST(:d AS jsonb))',
             {"k": doc["id"], "d": json.dumps(doc, ensure_ascii=False, default=str)})


# Tablas de datos operativos que se reportan como contadores/snapshot.
OPERATIONAL_TABLES = [
    "clients", "products", "sales", "pedidos", "abonos", "cajas",
    "caja_movimientos", "inventory_movements", "suspended_sales",
    "cfdi_documents", "favorites", "visits", "seller_locations",
    "sales_routes", "route_stops", "proveedores", "compras",
    "compras_ordenes", "compras_recepciones", "costos_historial",
    "cuentas_bancarias", "presupuestos", "recurrentes",
    "sale_idempotency", "product_stock", "sequences",
]
PRESERVED_TABLES = [
    "users", "settings", "sucursales", "categories", "price_lists",
    "mensajes", "plantillas", "pac_config", "files", "audit_logs",
    "login_attempts", "refresh_tokens", "centros_costo",
]


async def _tablas_existentes(conn) -> list:
    nombres = OPERATIONAL_TABLES + PRESERVED_TABLES
    res = await _q(conn,
                   "SELECT name FROM (VALUES " +
                   ",".join(f"('{n}')" for n in nombres) +
                   ") AS t(name) WHERE to_regclass(format('%I', t.name)) IS NOT NULL "
                   "ORDER BY name")
    return [r[0] for r in res.fetchall()]


async def snapshot_contadores(conn) -> dict:
    out = {}
    for t in await _tablas_existentes(conn):
        out[t] = await _count(conn, t)
    return out


# --------------------------------------------------------------------------- #
# Recomposición de consistencia tras limpiar                                    #
# --------------------------------------------------------------------------- #
async def _recompone_saldos_clientes(conn):
    """clients.saldo = suma de saldos de ventas REMANENTES por cliente."""
    await _q(conn,
             'UPDATE clients c SET "saldo" = COALESCE(s.tot, 0), '
             "doc = jsonb_set(c.doc, '{saldo}', CAST(CAST(COALESCE(s.tot,0) AS text) AS jsonb), true) "
             "FROM (SELECT doc->>'cliente_id' AS cid, SUM(\"saldo\") AS tot FROM sales "
             "WHERE doc->>'cliente_id' IS NOT NULL GROUP BY 1) s "
             'WHERE c."id" = s.cid')
    await _q(conn,
             'UPDATE clients c SET "saldo" = 0, doc = doc || \'{"saldo":0}\'::jsonb '
             'WHERE COALESCE(c."saldo",0) <> 0 AND c."id" NOT IN '
             "(SELECT DISTINCT doc->>'cliente_id' FROM sales WHERE doc->>'cliente_id' IS NOT NULL)")


async def _recompone_inventario_desde_kardex(conn):
    """Para productos CON kardex remanente: existencia/vendidas derivadas del
    kardex restante. Productos sin movimientos conservan su línea base."""
    await _q(conn,
             'UPDATE products p SET "existencia" = k.bal, '
             "doc = jsonb_set(p.doc, '{existencia}', CAST(CAST(k.bal AS text) AS jsonb), true) "
             "FROM (SELECT doc->>'product_id' AS pid, "
             'SUM(COALESCE("entrada",0) - COALESCE("salida",0)) AS bal '
             "FROM inventory_movements GROUP BY 1) k WHERE p.\"id\" = k.pid")
    await _q(conn,
             'UPDATE products p SET "vendidas" = v.tot, '
             "doc = jsonb_set(p.doc, '{vendidas}', CAST(CAST(v.tot AS text) AS jsonb), true) "
             "FROM (SELECT doc->>'product_id' AS pid, SUM(COALESCE(\"salida\",0)) AS tot "
             "FROM inventory_movements WHERE doc->>'tipo' = 'venta' GROUP BY 1) v "
             'WHERE p."id" = v.pid')


# --------------------------------------------------------------------------- #
# Pasos de limpieza (cada uno devuelve {tabla: eliminados})                     #
# --------------------------------------------------------------------------- #
async def _step_ventas(conn, incluir_cotizaciones: bool = False) -> dict:
    w_venta = "(doc->>'tipo_venta' <> 'cotizacion' OR doc->>'tipo_venta' IS NULL)"
    where = "TRUE" if incluir_cotizaciones else w_venta
    ids = await _ids(conn, "sales", where)
    out = {}
    if not ids and where != "TRUE":
        return {"sales": 0}
    out["abonos"] = await _del(conn, "abonos")
    out["caja_movimientos"] = await _del(
        conn, "caja_movimientos", "(doc->>'tipo' = ANY(ARRAY['venta','abono']))")
    out["inventory_movements"] = await _del(
        conn, "inventory_movements", "doc->>'tipo' = 'venta'")
    out["suspended_sales"] = await _del(conn, "suspended_sales")
    out["sale_idempotency"] = await _del(
        conn, "sale_idempotency", '"sale_id" = ANY(:ids)', {"ids": ids})
    out["cfdi_documents"] = await _del(
        conn, "cfdi_documents", "doc->>'sale_id' = ANY(:ids)", {"ids": ids})
    out["sales"] = await _del(conn, "sales", where)
    await _recompone_saldos_clientes(conn)
    await _recompone_inventario_desde_kardex(conn)
    return out


async def _step_cotizaciones(conn) -> dict:
    ids = await _ids(conn, "sales", "doc->>'tipo_venta' = 'cotizacion'")
    if not ids:
        return {"sales": 0}
    out = {
        "sale_idempotency": await _del(conn, "sale_idempotency",
                                       '"sale_id" = ANY(:ids)', {"ids": ids}),
        "cfdi_documents": await _del(conn, "cfdi_documents",
                                     "doc->>'sale_id' = ANY(:ids)", {"ids": ids}),
    }
    out["sales"] = await _del(conn, "sales", "doc->>'tipo_venta' = 'cotizacion'")
    return out


async def _step_pedidos(conn) -> dict:
    return {"pedidos": await _del(conn, "pedidos")}


async def _step_compras(conn) -> dict:
    """Ciclo de compras (tipo compra|mixto) con sus dependientes."""
    rows = (await _q(conn,
                     'SELECT "id", doc->>\'folio\' FROM compras '
                     "WHERE doc->>'tipo' <> 'gasto' OR doc->>'tipo' IS NULL")).fetchall()
    ids = [r[0] for r in rows]
    out = {}
    out["costos_historial"] = await _del(
        conn, "costos_historial", "doc->>'compra_id' = ANY(:ids)", {"ids": ids})
    out["caja_movimientos"] = await _del(
        conn, "caja_movimientos",
        "(doc->>'compra_id' = ANY(:ids)) OR (doc->>'tipo' = 'compra')", {"ids": ids})
    out["inventory_movements"] = await _del(
        conn, "inventory_movements",
        "(doc->>'compra_id' = ANY(:ids)) OR (doc->>'tipo' = 'compra')", {"ids": ids})
    out["compras_recepciones"] = await _del(conn, "compras_recepciones")
    out["compras_ordenes"] = await _del(conn, "compras_ordenes")
    out["compras"] = await _del(
        conn, "compras", "doc->>'tipo' <> 'gasto' OR doc->>'tipo' IS NULL")
    await _recompone_inventario_desde_kardex(conn)
    return out


async def _step_gastos(conn) -> dict:
    ids = await _ids(conn, "compras", "doc->>'tipo' = 'gasto'")
    out = {"caja_movimientos": await _del(
        conn, "caja_movimientos", "doc->>'compra_id' = ANY(:ids)", {"ids": ids})}
    out["compras"] = await _del(conn, "compras", "doc->>'tipo' = 'gasto'")
    return out


async def _step_clientes(conn, forzar: bool) -> dict:
    bloqueos = {
        "ventas": await _count(conn, "sales"),
        "abonos": await _count(conn, "abonos"),
        "pedidos": await _count(conn, "pedidos"),
        "visitas": await _count(conn, "visits"),
    }
    activos = {k: v for k, v in bloqueos.items() if v > 0}
    if activos and not forzar:
        raise HTTPException(status_code=409, detail={
            "mensaje": "Hay documentos que referencian clientes. Límpialos primero "
                       "o repite la operación con limpieza en cascada.",
            "bloqueos": activos})
    out = {}
    if activos:
        out.update(await _step_ventas(conn, incluir_cotizaciones=True))
        out.update(await _step_pedidos(conn))
    out["visits"] = await _del(conn, "visits")
    out["clients"] = await _del(conn, "clients")
    return out


async def _step_productos(conn, forzar: bool) -> dict:
    ids = await _ids(conn, "products", "TRUE")
    if not ids:
        return {"products": 0}
    avisos = []
    refs = {
        "ventas_con_items": await _count(
            conn, "sales", "doc->'items' IS NOT NULL AND jsonb_path_exists(doc, '$.items[*].product_id')"),
        "pedidos_con_items": await _count(
            conn, "pedidos", "jsonb_path_exists(doc, '$.items[*].product_id')"),
        "compras_con_items": await _count(
            conn, "compras", "jsonb_path_exists(doc, '$.items[*].product_id')"),
    }
    con_refs = {k: v for k, v in refs.items() if v > 0}
    if con_refs:
        if not forzar:
            raise HTTPException(status_code=409, detail={
                "mensaje": "Existen ventas/pedidos/compras con líneas de estos productos "
                           "(guardan copia embebida). Usa cascada si aceptas borrarlos también.",
                "bloqueos": con_refs})
        avisos.append("Los documentos afectados guardaban copia embebida de los productos.")
    out = {}
    out["favorites"] = await _del(conn, "favorites",
                                  "doc->>'product_id' = ANY(:ids)", {"ids": ids})
    out["costos_historial"] = await _del(conn, "costos_historial",
                                         "doc->>'product_id' = ANY(:ids)", {"ids": ids})
    out["inventory_movements"] = await _del(conn, "inventory_movements",
                                            "doc->>'product_id' = ANY(:ids)", {"ids": ids})
    out["product_stock"] = await _del(conn, "product_stock",
                                      '"product_id" = ANY(:ids)', {"ids": ids})
    out["products"] = await _del(conn, "products", '"id" = ANY(:ids)', {"ids": ids})
    out["_avisos"] = avisos
    return out


async def _step_inventario(conn) -> dict:
    out = {"inventory_movements": await _del(conn, "inventory_movements")}
    await _q(conn, 'UPDATE products SET "existencia" = 0, "vendidas" = 0, '
                   'doc = doc || \'{"existencia":0,"vendidas":0}\'::jsonb '
                   'WHERE COALESCE("existencia",0) <> 0 OR COALESCE("vendidas",0) <> 0')
    await _q(conn, "UPDATE product_stock SET existencia = 0 WHERE COALESCE(existencia,0) <> 0")
    out["_nota"] = ("Kardex vaciado; existencias de products y product_stock reiniciadas a 0.")
    return out


async def _step_caja(conn) -> dict:
    out = {"caja_movimientos": await _del(conn, "caja_movimientos"),
           "cajas": await _del(conn, "cajas")}
    out["_nota"] = ("Las ventas/compras históricas conservan caja_id como referencia "
                    "informativa; los totales de caja siempre se calculan desde movimientos.")
    return out


async def _step_proveedores(conn, forzar: bool) -> dict:
    bloqueos = {
        "compras": await _count(conn, "compras"),
        "compras_ordenes": await _count(conn, "compras_ordenes"),
        "recurrentes": await _count(conn, "recurrentes"),
    }
    activos = {k: v for k, v in bloqueos.items() if v > 0}
    if activos and not forzar:
        raise HTTPException(status_code=409, detail={
            "mensaje": "Hay compras/órdenes/recurrentes ligados a proveedores.",
            "bloqueos": activos})
    out = {}
    if activos:
        out.update(await _step_compras(conn))
        out["recurrentes"] = await _del(conn, "recurrentes")
    out["proveedores"] = await _del(conn, "proveedores")
    return out


async def _step_cxc(conn) -> dict:
    """CxC es una proyección (ventas a crédito + abonos): se eliminan los
    abonos y se ponen en cero los saldos pendientes."""
    out = {"abonos": await _del(conn, "abonos")}
    res = await _q(conn, 'UPDATE sales SET "saldo" = 0, doc = doc || \'{"saldo":0}\'::jsonb '
                         'WHERE COALESCE("saldo",0) <> 0')
    out["sales_saldo_en_cero"] = res.rowcount or 0
    res = await _q(conn, 'UPDATE clients SET "saldo" = 0, doc = doc || \'{"saldo":0}\'::jsonb '
                         'WHERE COALESCE("saldo",0) <> 0')
    out["clients_saldo_en_cero"] = res.rowcount or 0
    return out


async def _step_cxp(conn) -> dict:
    """CxP es proyección de compras.saldo_pendiente: se marcan como pagadas."""
    res = await _q(conn,
                   'UPDATE compras SET "abonado" = "total", "saldo_pendiente" = 0, '
                   "doc = jsonb_set(jsonb_set(jsonb_set(doc, '{abonado}', to_jsonb(\"total\"), true), "
                   "'{saldo_pendiente}', '0'::jsonb, true), '{estado}', '\"pagada\"'::jsonb, true) "
                   'WHERE COALESCE("saldo_pendiente",0) <> 0')
    return {"compras_marcadas_pagadas": res.rowcount or 0}


async def _step_vendedores_prueba(conn) -> dict:
    demos = (await _q(conn,
                      "SELECT \"id\" FROM users WHERE doc->>'email' ~ '@rysa\\.dev$'")).fetchall()
    ids = [r[0] for r in demos]
    if not ids:
        return {"users": 0}
    out = {}
    out["refresh_tokens"] = await _del(conn, "refresh_tokens",
                                       "doc->>'user_id' = ANY(:ids)", {"ids": ids})
    out["seller_locations"] = await _del(conn, "seller_locations",
                                         "doc->>'vendedor_id' = ANY(:ids)", {"ids": ids})
    out["visits"] = await _del(conn, "visits",
                               "doc->>'vendedor_id' = ANY(:ids)", {"ids": ids})
    rutas = await _ids(conn, "sales_routes", "doc->>'vendedor_id' = ANY(:ids)", {"ids": ids})
    out["route_stops"] = await _del(conn, "route_stops",
                                    "doc->>'route_id' = ANY(:ids)", {"ids": rutas})
    out["sales_routes"] = await _del(conn, "sales_routes",
                                     "doc->>'vendedor_id' = ANY(:ids)", {"ids": ids})
    await _q(conn, "UPDATE clients SET doc = doc - 'vendedor_id' - 'vendedor' "
                   "WHERE doc->>'vendedor_id' = ANY(:ids)", {"ids": ids})
    out["users"] = await _del(conn, "users", '"id" = ANY(:ids)', {"ids": ids})
    return out


_FOLIO_SEQUENCES = ["venta", "cotizacion", "recarga", "abono", "compra", "gasto",
                    "orden", "recepcion", "pedido", "retiro", "producto", "cliente"]


async def _reset_total(conn) -> dict:
    """Limpieza completa de DATOS OPERATIVOS. Preserva estructura, catálogos
    estructurales, usuarios (salvo demo vía paso aparte), configuración y
    auditoría. Orden respetando dependencias lógicas."""
    out = {}
    out["suspended_sales"] = await _del(conn, "suspended_sales")
    out["sale_idempotency"] = await _del(conn, "sale_idempotency")
    out["cfdi_documents"] = await _del(conn, "cfdi_documents")
    out["abonos"] = await _del(conn, "abonos")
    out["sales"] = await _del(conn, "sales")
    out["pedidos"] = await _del(conn, "pedidos")
    out["compras_recepciones"] = await _del(conn, "compras_recepciones")
    out["compras_ordenes"] = await _del(conn, "compras_ordenes")
    out["compras"] = await _del(conn, "compras")
    out["costos_historial"] = await _del(conn, "costos_historial")
    out["recurrentes"] = await _del(conn, "recurrentes")
    out["presupuestos"] = await _del(conn, "presupuestos")
    out["caja_movimientos"] = await _del(conn, "caja_movimientos")
    out["cajas"] = await _del(conn, "cajas")
    out["inventory_movements"] = await _del(conn, "inventory_movements")
    out["favorites"] = await _del(conn, "favorites")
    out["route_stops"] = await _del(conn, "route_stops")
    out["sales_routes"] = await _del(conn, "sales_routes")
    out["seller_locations"] = await _del(conn, "seller_locations")
    out["visits"] = await _del(conn, "visits")
    out["clients"] = await _del(conn, "clients")
    out["product_stock"] = await _del(conn, "product_stock")
    out["products"] = await _del(conn, "products")
    out["proveedores"] = await _del(conn, "proveedores")
    out["cuentas_bancarias"] = await _del(conn, "cuentas_bancarias")
    out["sequences_reiniciadas"] = await _del(
        conn, "sequences", "name = ANY(:n)", {"n": _FOLIO_SEQUENCES})
    out["_preservado"] = ("Estructura, migraciones, usuarios, roles, settings, sucursales, "
                          "categorías, listas de precios, plantillas, archivos y auditoría "
                          "se conservan intactos.")
    return out


async def _run_step(entidad: str, conn, forzar: bool) -> dict:
    if entidad == "ventas":
        return await _step_ventas(conn)
    if entidad == "cotizaciones":
        return await _step_cotizaciones(conn)
    if entidad == "pedidos":
        return await _step_pedidos(conn)
    if entidad == "compras":
        return await _step_compras(conn)
    if entidad == "gastos":
        return await _step_gastos(conn)
    if entidad == "clientes":
        return await _step_clientes(conn, forzar)
    if entidad == "productos":
        return await _step_productos(conn, forzar)
    if entidad == "inventario":
        return await _step_inventario(conn)
    if entidad == "caja":
        return await _step_caja(conn)
    if entidad == "proveedores":
        return await _step_proveedores(conn, forzar)
    if entidad == "cxc":
        return await _step_cxc(conn)
    if entidad == "cxp":
        return await _step_cxp(conn)
    if entidad == "vendedores_prueba":
        return await _step_vendedores_prueba(conn)
    if entidad == "reset_total":
        return await _reset_total(conn)
    raise HTTPException(status_code=404, detail="Operación desconocida")


# Catálogo de operaciones para el plan/UI.
ENTIDADES = {
    "clientes":          {"label": "Clientes", "peligro": "alta",
                          "confirmar": "LIMPIAR",
                          "descripcion": "Clientes y visitas asociadas. Bloquea si hay ventas/abonos/pedidos que los referencian (usa cascada para limpiarlos también)."},
    "productos":         {"label": "Productos", "peligro": "alta",
                          "confirmar": "LIMPIAR",
                          "descripcion": "Catálogo de productos con su kardex, stock por sucursal, favoritos e historial de costos. Las ventas/pedidos/compras existentes conservan copia embebida."},
    "inventario":        {"label": "Inventario", "peligro": "alta",
                          "confirmar": "LIMPIAR",
                          "descripcion": "Vacia el kardex y reinicia existencias de todos los productos a 0. No borra productos."},
    "ventas":            {"label": "Ventas (y recargas)", "peligro": "critica",
                          "confirmar": "LIMPIAR",
                          "descripcion": "Todas las ventas confirmadas/canceladas y recargas, con sus abonos, movimientos de caja, kardex, CFDIs e idempotencia. Recompone saldos de clientes e inventario."},
    "cotizaciones":      {"label": "Cotizaciones", "peligro": "media",
                          "confirmar": "LIMPIAR",
                          "descripcion": "Solo documentos tipo cotización dentro de ventas."},
    "pedidos":           {"label": "Pedidos", "peligro": "alta",
                          "confirmar": "LIMPIAR",
                          "descripcion": "Todos los pedidos (borradores, confirmados, entregados)."},
    "compras":           {"label": "Compras", "peligro": "critica",
                          "confirmar": "LIMPIAR",
                          "descripcion": "Compras (tipo compra/mixto), órdenes y recepciones, más sus movimientos de caja, kardex e historial de costos. La CxP desaparece al ser proyección."},
    "gastos":            {"label": "Gastos", "peligro": "alta",
                          "confirmar": "LIMPIAR",
                          "descripcion": "Documentos tipo gasto y sus salidas de caja asociadas."},
    "proveedores":       {"label": "Proveedores", "peligro": "alta",
                          "confirmar": "LIMPIAR",
                          "descripcion": "Proveedores. Bloquea si hay compras/órdenes/recurrentes ligados (cascada disponible)."},
    "cxc":               {"label": "Cuentas por cobrar", "peligro": "alta",
                          "confirmar": "LIMPIAR",
                          "descripcion": "Elimina abonos y pone en cero saldos pendientes de ventas y clientes (la CxC es una proyección)."},
    "cxp":               {"label": "Cuentas por pagar", "peligro": "alta",
                          "confirmar": "LIMPIAR",
                          "descripcion": "Marca todas las compras con saldo pendiente como pagadas (CxP = proyección)."},
    "caja":              {"label": "Caja", "peligro": "critica",
                          "confirmar": "LIMPIAR",
                          "descripcion": "Elimina cortes de caja y todos sus movimientos."},
    "vendedores_prueba": {"label": "Vendedores de prueba (@rysa.dev)", "peligro": "alta",
                          "confirmar": "LIMPIAR",
                          "descripcion": "Cuentas demo @rysa.dev con sesiones, GPS, visitas, rutas; desasigna sus clientes."},
}

# =========================================================================== #
# ENDPOINTS DE LECTURA / DIAGNÓSTICO                                          #
# =========================================================================== #
@router.get("/dev/status")
async def dev_status(user: dict = Depends(dev_read)):
    return {
        "entorno": _APP_ENV,
        "developer_mode": DEVELOPER_MODE,
        "destructivo_habilitado": DESTRUCTIVE_ENABLED,
        "rol_requerido": DEV_ROLE,
        "app_version": APP_VERSION,
        "api_version": API_VERSION,
        "python": platform.python_version(),
        "uptime_s": round(time.time() - _STARTED, 1),
        "errores_en_memoria": len(DEV_REQUEST_LOG),
        "generado": iso_now(),
}


@router.get("/dev/diagnostico-full")
async def dev_diagnostico_full(user: dict = Depends(dev_read)):
    componentes = []

    def add(cid, nombre, ok, detalle="", extra=None):
        comp = {"id": cid, "nombre": nombre, "ok": bool(ok), "detalle": detalle}
        if extra:
            comp.update(extra)
        componentes.append(comp)

    add("backend", "Backend", True,
        f"FastAPI · Python {platform.python_version()} · uptime {_format_uptime()}")

    t0 = time.perf_counter()
    try:
        eng = pgstore.get_engine()
        async with eng.connect() as conn:
            ver = (await conn.execute(text("SELECT version()"))).scalar()
            lat = round((time.perf_counter() - t0) * 1000, 1)
        add("postgresql", "PostgreSQL", True, f"{lat} ms",
            {"latencia_ms": lat, "version": (ver or "")[:60]})
    except Exception as e:
        add("postgresql", "PostgreSQL", False, str(e)[:300])

    try:
        mig = await _estado_migraciones()
        ok = bool(mig["actual"]) and mig["pendientes"] == 0
        add("migraciones", "Migraciones", ok,
            f"actual: {mig['actual'] or '—'} · head: {mig['head'] or '—'} · "
            f"pendientes: {mig['pendientes']}", mig)
    except Exception as e:
        add("migraciones", "Migraciones", False, str(e)[:300])

    try:
        storage.init_storage()
        base = Path(storage.base_upload_dir())
        probe = base / ".__diag_dev.tmp"
        probe.write_bytes(b"ok")
        assert probe.read_bytes() == b"ok"
        probe.unlink()
        libre = shutil.disk_usage(base).free
        add("storage", "Storage", True, f"{base} · libre {_human(libre)}")
    except Exception as e:
        add("storage", "Storage", False, str(e)[:300])

    t0 = time.perf_counter()
    try:
        async with pgstore.get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        add("api", "API (self-ping)", True,
            f"{round((time.perf_counter()-t0)*1000,1)} ms")
    except Exception as e:
        add("api", "API (self-ping)", False, str(e)[:300])

    return {"generado": iso_now(), "entorno": _APP_ENV,
            "developer_mode": DEVELOPER_MODE, "componentes": componentes,
            "todo_ok": all(c["ok"] for c in componentes)}


@router.get("/dev/db/contadores")
async def dev_contadores(user: dict = Depends(dev_read)):
    async with pgstore.get_engine().connect() as conn:
        res = await _q(conn,
                       "SELECT name FROM (VALUES " +
                       ",".join(f"('{n}')" for n in OPERATIONAL_TABLES + ["audit_logs"]) +
                       ") AS t(name) WHERE to_regclass(format('%I', t.name)) IS NOT NULL")
        tablas = [r[0] for r in res.fetchall()]
        conteos = [{"tabla": t, "registros": await _count(conn, t)} for t in tablas]
    return {"generado": iso_now(), "tablas": conteos}


@router.get("/dev/migraciones")
async def dev_migraciones(user: dict = Depends(dev_read)):
    return await _estado_migraciones()


@router.get("/dev/logs")
async def dev_logs(estado: int | None = None, limite: int = 150,
                   user: dict = Depends(dev_read)):
    items = list(reversed(DEV_REQUEST_LOG))
    if estado:
        items = [e for e in items if e.get("estado") == estado]
    resumen = {}
    for e in DEV_REQUEST_LOG:
        resumen[e["estado"]] = resumen.get(e["estado"], 0) + 1
    return {"total_en_memoria": len(DEV_REQUEST_LOG),
            "resumen_por_estado": dict(sorted(resumen.items())),
            "items": items[:max(1, min(limite, 400))]}


@router.delete("/dev/logs")
async def dev_limpiar_logs(user: dict = Depends(dev_read)):
    n = len(DEV_REQUEST_LOG)
    DEV_REQUEST_LOG.clear()
    return {"ok": True, "eliminados": n}


@router.post("/dev/backup")
async def dev_backup(user: dict = Depends(dev_destructive)):
    """Backup best-effort con pg_dump (si está disponible en el sistema)."""
    url = os.environ.get("DATABASE_URL", "")
    m = re.match(r"postgresql(?:\+asyncpg)?://([^:@]+):([^@]+)@([^:/]+)(?::(\d+))?/(\w+)", url)
    if not m:
        return {"ok": False,
                "motivo": "No se pudo interpretar DATABASE_URL; realiza el backup manualmente (pg_dump)."}
    usuario, password, host, puerto, db = m.groups()
    pg_dump = shutil.which("pg_dump")
    if not pg_dump:
        return {"ok": False,
                "motivo": "pg_dump no está disponible en este contenedor/host; realiza el backup manualmente antes de continuar."}
    outdir = _BACKEND_DIR / "backups"
    outdir.mkdir(exist_ok=True)
    destino = outdir / f"rysa_backup_{time.strftime('%Y%m%d_%H%M%S')}.sql"
    env = dict(os.environ)
    env["PGPASSWORD"] = password
    cmd = [pg_dump, "-h", host, "-p", puerto or "5432", "-U", usuario,
           "-d", db, "--no-owner", "-f", str(destino)]
    try:
        proc = subprocess.run(cmd, env=env, capture_output=True, timeout=180)
    except Exception as e:
        return {"ok": False, "motivo": f"Fallo al ejecutar pg_dump: {e}"}
    finally:
        env["PGPASSWORD"] = ""
    if proc.returncode != 0:
        return {"ok": False,
                "motivo": f"pg_dump devolvió código {proc.returncode}: {proc.stderr.decode(errors='ignore')[:300]}"}
    return {"ok": True, "archivo": destino.name,
            "bytes": destino.stat().st_size,
            "ruta": str(destino)}


# --- Plan de limpieza (contadores para la UI) --------------------------------
@router.get("/dev/clean/plan")
async def dev_clean_plan(user: dict = Depends(dev_destructive)):
    async with pgstore.get_engine().connect() as conn:
        conteos = await snapshot_contadores(conn)
    plan = []
    for key, info in ENTIDADES.items():
        principal = {
            "clientes": "clients", "productos": "products", "inventario": "inventory_movements",
            "ventas": "sales", "cotizaciones": "sales", "pedidos": "pedidos",
            "compras": "compras", "gastos": "compras", "proveedores": "proveedores",
            "cxc": "abonos", "cxp": "compras", "caja": "cajas",
            "vendedores_prueba": "users",
        }[key]
        plan.append({"key": key, **info,
                     "registros": conteos.get(principal, 0),
                     "tabla_principal": principal})
    return {"plan": plan, "contadores": conteos,
            "entorno": _APP_ENV, "developer_mode": DEVELOPER_MODE}


class ConfirmIn(BaseModel):
    confirmar: str = ""
    forzar: bool = False


@destructive.post("/dev/clean/{entidad}")
async def dev_clean(entidad: str, data: ConfirmIn = Body(default=ConfirmIn()),
                    user: dict = Depends(dev_destructive)):
    if entidad == "reset_total":
        raise HTTPException(status_code=400, detail="Usa el endpoint /dev/reset-pruebas")
    if entidad not in ENTIDADES:
        raise HTTPException(status_code=404, detail="Operación desconocida")
    info = ENTIDADES[entidad]
    if (data.confirmar or "").strip() != info["confirmar"]:
        raise HTTPException(status_code=400,
                            detail=f"Confirmación inválida: escribe exactamente '{info['confirmar']}'")
    t0 = time.perf_counter()
    async with transaction() as conn:
        antes = await snapshot_contadores(conn)
        detalle = await _run_step(entidad, conn, data.forzar)
        despues = await snapshot_contadores(conn)
        await _audit_tx(conn, user, f"DEV_LIMPIAR_{entidad.upper()}", {
            "operacion": f"LIMPIAR {entidad}", "forzar": data.forzar,
            "eliminados": {k: v for k, v in detalle.items() if not k.startswith("_")},
            "notas": {k: v for k, v in detalle.items() if k.startswith("_")},
        })
    return {"ok": True, "entidad": entidad, "label": info["label"],
            "antes": antes,
            "eliminados": {k: v for k, v in detalle.items() if not k.startswith("_")},
            "avisos": [v for k, v in detalle.items() if k.startswith("_")],
            "despues": despues,
            "duracion_ms": round((time.perf_counter() - t0) * 1000, 1),
            "rollback": False}


@destructive.post("/dev/reset-pruebas")
async def dev_reset_pruebas(data: ConfirmIn = Body(default=ConfirmIn()),
                            user: dict = Depends(dev_destructive)):
    """☢️ Reinicio total del entorno de pruebas (§69/74). Requiere escribir
    exactamente ELIMINAR TODO. Una sola transacción: o todo o nada."""
    if (data.confirmar or "").strip() != "ELIMINAR TODO":
        raise HTTPException(status_code=400,
                            detail='Confirmación inválida: escribe exactamente "ELIMINAR TODO"')
    t0 = time.perf_counter()
    async with transaction() as conn:
        antes = await snapshot_contadores(conn)
        detalle = await _reset_total(conn)
        despues = await snapshot_contadores(conn)
        await _audit_tx(conn, user, "DEV_RESET_PRUEBAS", {
            "operacion": "REINICIAR DATOS DE PRUEBA (reset total)",
            "eliminados": {k: v for k, v in detalle.items() if not k.startswith("_")},
        })
    return {"ok": True, "entidad": "reset_total", "antes": antes,
            "eliminados": {k: v for k, v in detalle.items() if not k.startswith("_")},
            "avisos": [v for k, v in detalle.items() if k.startswith("_")],
            "despues": despues,
            "duracion_ms": round((time.perf_counter() - t0) * 1000, 1)}


# Registro condicional: en producción (o DEVELOPER_MODE=false) las rutas
# destructivas NO existen en la aplicación (§77).
if DESTRUCTIVE_ENABLED:
    router.include_router(destructive)


# =========================================================================== #
# Utilidades internas                                                          #
# =========================================================================== #
def _human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def _format_uptime() -> str:
    s = int(time.time() - _STARTED)
    h, rem = divmod(s, 3600)
    m, _ = divmod(rem, 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


_REV_RE = re.compile(r"^revision(?::\s*str)?\s*=\s*[\"']([0-9A-Za-z_]+)[\"']", re.M)
_DOWN_RE = re.compile(r"^down_revision(?::\s*[^=]+)?\s*=\s*(.+?)$", re.M)


def _parse_down(raw: str) -> list:
    raw = raw.strip()
    if raw == "None":
        return []
    return re.findall(r"[\"']([0-9A-Za-z_]+)[\"']", raw)


async def _estado_migraciones() -> dict:
    versions_dir = _BACKEND_DIR / "alembic" / "versions"
    revs, downs = {}, {}
    for f in versions_dir.glob("*.py"):
        src = f.read_text(encoding="utf-8", errors="ignore")
        mrev = _REV_RE.search(src)
        if not mrev:
            continue
        rev = mrev.group(1)
        revs[rev] = f.stem
        mdn = _DOWN_RE.search(src)
        for d in (_parse_down(mdn.group(1)) if mdn else []):
            downs.setdefault(d, []).append(rev)
    heads = [r for r in revs if r not in downs]
    head = heads[0] if len(heads) == 1 else ", ".join(sorted(heads))
    actual = None
    try:
        eng = pgstore.get_engine()
        async with eng.connect() as conn:
            actual = (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar()
    except Exception:
        actual = None
    pendientes = 0
    if head and actual != head:
        vistos, frontera = set(), [actual] if actual else []
        pasos = 0
        while frontera:
            nxt = []
            for cur in frontera:
                for hijo in downs.get(cur, []):
                    if hijo in vistos:
                        continue
                    vistos.add(hijo)
                    nxt.append(hijo)
            frontera = nxt
            pasos += len(nxt)
        pendientes = pasos if actual else len(revs)
    return {"actual": actual, "head": head, "pendientes": pendientes,
            "total_revisiones": len(revs)}
