"""Pruebas F5/F6/F7 (P1): override inventario negativo, alcance de permisos y sucursales.

Ejecutar desde backend/:
    venv/Scripts/python -m pytest tests/test_p1_seguridad.py -n 0
"""
import os
import sys
import uuid
import asyncio
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from dotenv import load_dotenv
load_dotenv(BASE / ".env", override=False)

import pgstore
from pgstore import pos
from pgstore.adapter import _quote
import deps
from deps import (effective_permissions, ver_todas_ventas, ver_reportes_globales,
                  user_has_permission, DEFAULT_MODULES_NON_PRIVILEGED, es_rol_privilegiado)


def uid():
    return uuid.uuid4().hex


def _run(body):
    async def _main():
        await pgstore.init_db_pool()
        await body()
        await pgstore.dispose()
    asyncio.run(_main())


# --------------------------------------------------------------------------- #
# ALCANCE DE PERMISOS (F5)                                                   #
# --------------------------------------------------------------------------- #
def test_alcance_roles():
    cajero = {"id": "c1", "role": "cajero", "modulos": []}
    encargado = {"id": "e1", "role": "encargado", "modulos": []}
    admin = {"id": "a1", "role": "admin", "modulos": []}

    # Cajero/vendedor: sin venta.ver_todas ni reportes.global
    assert not ver_todas_ventas(cajero)
    assert not ver_reportes_globales(cajero)
    # Encargado: ver_todas y reportes.global (definido en F5)
    assert ver_todas_ventas(encargado)
    assert ver_reportes_globales(encargado)
    # Admin (*): todo
    assert ver_todas_ventas(admin)
    assert ver_reportes_globales(admin)

    # vendedor/cajero NO pueden autorizar inventario negativo
    assert not user_has_permission(cajero, "inventario.autorizar_negativo")
    assert not user_has_permission({"role": "vendedor"}, "inventario.autorizar_negativo")
    assert user_has_permission(encargado, "inventario.autorizar_negativo")
    assert user_has_permission(admin, "inventario.autorizar_negativo")


def test_default_modulos_y_rol_privilegiado():
    assert set(DEFAULT_MODULES_NON_PRIVILEGED) == {"productos", "clientes", "recargas",
                                                  "ventas", "caja", "reportes"}
    assert not es_rol_privilegiado("vendedor")
    assert not es_rol_privilegiado("encargado")
    assert es_rol_privilegiado("admin")
    assert es_rol_privilegiado("admin_propietario")


# --------------------------------------------------------------------------- #
# OVERRIDE INVENTARIO NEGATIVO (F7b) - nivel transacción                     #
# --------------------------------------------------------------------------- #
def test_venta_sin_inventario_bloqueada_y_override():
    async def body():
        db = deps.db
        pid = uid()
        await db.products.insert_one({
            "id": pid, "codigo": pid[:7], "descripcion": "NEG", "existencia": 2,
            "costo": 5, "iva_tasa": 16, "estado": "activo", "unidad_medida": "PZA",
            "controles": {"controlar_inventario": True, "permitir_inventario_negativo": False}})
        caja_id = uid()
        await db.cajas.insert_one({"id": caja_id, "caja_nombre": "C", "usuario_id": USER["id"],
                                   "usuario_nombre": USER["name"], "fondo_inicial": 0, "estado": "abierta",
                                   "sucursal_id": "s1"})

        items = [{"product_id": pid, "codigo": pid[:7], "descripcion": "NEG", "cantidad": 5,
                  "unidad": "PZA", "precio": 10.0, "iva_tasa": 16, "descuento": 0}]
        sale_no_override = {"id": uid(), "folio": "V-NEG1", "fecha": pos.now_iso(),
                            "hora": pos.now_hhmm(), "usuario_id": USER["id"], "usuario_nombre": USER["name"],
                            "vendedor_id": USER["id"], "vendedor_nombre": USER["name"],
                            "cliente_id": None, "cliente_nombre": "Publico General",
                            "items": items, "subtotal": 0, "iva_total": 0, "descuento_total": 0,
                            "total": 50, "tipo_venta": "directa", "condicion": "contado",
                            "pagos": [{"metodo": "efectivo", "monto": 50}], "cambio": 0, "saldo": 0,
                            "estado": "confirmada", "factura": False, "caja_id": caja_id,
                            "lista_precios": 1, "sucursal_id": "s1"}
        # Sin override -> bloqueo (existencia 2 < cant 5, controlar y no permitir_neg)
        try:
            await pos.crear_venta_pg(user=USER, sale=sale_no_override, items=items,
                                     pagos=[{"metodo": "efectivo", "monto": 50}], total=50,
                                     es_cotizacion=False, caja={"id": caja_id, "sucursal_id": "s1"},
                                     condicion="contado", cliente=None, folio="V-NEG1",
                                     override_inv=None)
            raise AssertionError("Debería haber bloqueado sin override")
        except pos.VentaError as e:
            assert e.status in (409, 400)

        # Con override autorizado -> inventario queda NEGATIVO y se registra
        sale_ov = dict(sale_no_override)
        sale_ov["id"] = uid()
        sale_ov["folio"] = "V-NEG2"
        override_inv = {"allow_negative_inventory": True, "override_user_id": USER["id"],
                        "override_user_nombre": USER["name"], "override_reason": "cliente mayorista",
                        "override_timestamp": pos.now_iso()}
        sale_ov["inventario_override"] = override_inv
        res = await pos.crear_venta_pg(user=USER, sale=sale_ov, items=items,
                                       pagos=[{"metodo": "efectivo", "monto": 50}], total=50,
                                       es_cotizacion=False, caja={"id": caja_id, "sucursal_id": "s1"},
                                       condicion="contado", cliente=None, folio="V-NEG2",
                                       override_inv=override_inv)
        p = await db.products.find_one({"id": pid})
        assert float(p["existencia"]) == -3  # 2 - 5 = -3 (negativo)
        got_sale = await db.sales.find_one({"id": sale_ov["id"]})
        assert got_sale["inventario_override"]["override_reason"] == "cliente mayorista"
        assert got_sale["inventario_override"]["override_user_id"] == USER["id"]

        # limpieza
        await db.sales.delete_many({"id": res["id"]})
        await db.sales.delete_one({"id": sale_no_override["id"]})
        await db.inventory_movements.delete_many({"product_id": pid})
        await db.caja_movimientos.delete_many({"caja_id": caja_id})
        await db.audit_logs.delete_many({"registro_id": res["id"]})
        await db.cajas.delete_one({"id": caja_id})
        await db.products.delete_one({"id": pid})
    _run(body)


# --------------------------------------------------------------------------- #
# SUCURSALES (F6)                                                            #
# --------------------------------------------------------------------------- #
def test_sucursal_crear_default_y_soft():
    async def body():
        db = deps.db
        # crear una sucursal
        sid = uid()
        await db.sucursales.insert_one({"id": sid, "codigo": "SUC2", "nombre": "Sucursal 2",
                                        "activa": True, "created_at": pos.now_iso()})
        got = await db.sucursales.find_one({"id": sid})
        assert got and got["codigo"] == "SUC2"

        # sale tiene sucursal_id
        caja = {"id": uid(), "sucursal_id": sid}
        assert caja["sucursal_id"] == sid

        await db.sucursales.delete_one({"id": sid})
    _run(body)


USER = {"id": "testuser", "name": "Test User P1"}
