"""Pruebas específicas de la capa PostgreSQL (RYSA_DEV).

Cubren productos, clientes, ventas, caja, inventario, folios concurrentes y
rollback transaccional. Se ejecutan contra la base `rysa_dev`.

Ejecutar desde `backend/`:
    venv/Scripts/python -m pytest tests/test_postgresql.py -n 0
"""
import os
import sys
import uuid
import asyncio
from pathlib import Path
from collections import Counter

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from dotenv import load_dotenv
load_dotenv(BASE / ".env", override=False)

from sqlalchemy import text

import pgstore
import deps
from pgstore.adapter import _quote


def uid():
    return uuid.uuid4().hex


def _run(body):
    async def _main():
        await pgstore.init_db_pool()
        await body()
        await pgstore.dispose()
    asyncio.run(_main())


# --------------------------------------------------------------------------- #
# PRODUCTOS                                                                  #
# --------------------------------------------------------------------------- #
def test_producto_crud():
    async def body():
        db = deps.db
        pid = uid()
        p = {"id": pid, "codigo": f"P{pid[:5]}", "descripcion": "Producto Test PG",
             "costo": 12.5, "existencia": 100, "stock_minimo": 5, "iva_tasa": 16,
             "estado": "activo", "unidad_medida": "PZA", "precios": [],
             "legacy": {"status": "A"}}
        await db.products.insert_one(p)
        got = await db.products.find_one({"id": pid})
        assert got and got["descripcion"] == "Producto Test PG"

        await db.products.update_one({"id": pid}, {"$set": {"costo": 15.0}})
        got = await db.products.find_one({"id": pid})
        assert float(got["costo"]) == 15.0
        eng = pgstore.get_engine()
        async with eng.connect() as c:
            r = await c.execute(text(f'SELECT "costo" FROM {_quote("products")} WHERE "id"=:i'), {"i": pid})
            val = r.scalar_one(); await c.commit()
        assert float(val) == 15.0

        lst = await db.products.find({"descripcion": {"$regex": "Test", "$options": "i"}},
                                     {"_id": 0}).limit(50).to_list(50)
        assert any(x["id"] == pid for x in lst)

        page = await db.products.find({}, {"_id": 0}).sort("codigo", 1).limit(5).skip(0).to_list(5)
        assert len(page) <= 5

        await db.products.update_one({"id": pid}, {"$set": {"estado": "baja"}})
        assert (await db.products.find_one({"id": pid}))["estado"] == "baja"
        await db.products.delete_one({"id": pid})
        assert await db.products.find_one({"id": pid}) is None
    _run(body)


# --------------------------------------------------------------------------- #
# CLIENTES                                                                   #
# --------------------------------------------------------------------------- #
def test_cliente_crud():
    async def body():
        db = deps.db
        cid = uid()
        c = {"id": cid, "codigo": f"C{cid[:5]}", "nombre": "Cliente Test PG",
             "rfc": "XAXX010101000", "estado": "activo", "saldo": 0}
        await db.clients.insert_one(c)
        got = await db.clients.find_one({"id": cid})
        assert got["nombre"] == "Cliente Test PG"
        await db.clients.update_one({"id": cid}, {"$inc": {"saldo": 100}})
        assert float((await db.clients.find_one({"id": cid}))["saldo"]) == 100
        found = await db.clients.find({"nombre": {"$regex": "Test PG", "$options": "i"}},
                                      {"_id": 0}).to_list(50)
        assert any(x["id"] == cid for x in found)
        await db.clients.update_one({"id": cid}, {"$set": {"estado": "inactivo"}})
        assert (await db.clients.find_one({"id": cid}))["estado"] == "inactivo"
        await db.clients.delete_one({"id": cid})
    _run(body)


# --------------------------------------------------------------------------- #
# VENTAS (crear + total + pagos)                                            #
# --------------------------------------------------------------------------- #
def test_venta_crear_total_pago():
    async def body():
        db = deps.db
        paysid = uid()
        await db.sales.insert_one({
            "id": paysid, "folio": "T-TEST1", "fecha": "2026-01-01T00:00:00+00:00",
            "subtotal": 100, "iva_total": 16, "descuento_total": 0, "total": 116,
            "saldo": 0, "estado": "confirmada",
            "items": [{"product_id": uid(), "codigo": "X", "cantidad": 1, "precio": 116}],
            "pagos": [{"metodo": "efectivo", "monto": 116}]})
        s = await db.sales.find_one({"id": paysid})
        assert s and float(s["total"]) == 116
        assert s["pagos"][0]["monto"] == 116
        # paginación sobre ventas
        rows = await db.sales.find({}, {"_id": 0}).sort("folio", 1).limit(10).to_list(10)
        assert len(rows) <= 10
        await db.sales.delete_one({"id": paysid})
    _run(body)


# --------------------------------------------------------------------------- #
# FOLIOS CONCURRENTES (varias cajas a la vez)                               #
# --------------------------------------------------------------------------- #
def test_folios_unicos_concurrentes():
    async def body():
        name = f"test_seq_{uid()[:8]}"
        results = await asyncio.gather(*[deps.next_counter(name, "V", 6) for _ in range(50)])
        assert len(results) == 50
        assert len(set(results)) == 50, "Folios duplicados bajo concurrencia"
        eng = pgstore.get_engine()
        async with eng.begin() as c:
            await c.execute(text("DELETE FROM sequences WHERE name=:n"), {"n": name})
    _run(body)


# --------------------------------------------------------------------------- #
# TRANSACCIONES (rollback atómico venta+inventario)                         #
# --------------------------------------------------------------------------- #
def test_rollback_transaccional():
    async def body():
        db = deps.db
        pid = uid()
        await db.products.insert_one({"id": pid, "codigo": pid[:6], "descripcion": "Inv",
                                      "existencia": 10, "estado": "activo"})
        sid = uid()

        async def fallida():
            async with pgstore.transaction() as conn:
                await conn.execute(text(
                    "INSERT INTO sales (_id, id, doc) VALUES (CAST(:k AS text),CAST(:k AS text), jsonb_build_object('id', CAST(:k AS text),'folio','T001'))"),
                    {"k": sid})
                await conn.execute(text(
                    f'UPDATE {_quote("products")} SET doc = jsonb_set(doc, \'{{existencia}}\', '
                    "CAST(CAST(COALESCE((doc->>'existencia')::numeric,0) - 1 AS text) AS jsonb), true), "
                    f'\"existencia\" = COALESCE(\"existencia\",0) - 1 WHERE id = CAST(:i AS text)'), {"i": pid})
                raise RuntimeError("fuerza rollback")

        try:
            await fallida()
            raise AssertionError("no lanzó")
        except RuntimeError:
            pass
        assert await db.sales.find_one({"id": sid}) is None, "Venta no debería existir"
        assert float((await db.products.find_one({"id": pid}))["existencia"]) == 10

        async def exitosa():
            async with pgstore.transaction() as conn:
                await conn.execute(text(
                    "INSERT INTO sales (_id, id, doc) VALUES (CAST(:k AS text),CAST(:k AS text), jsonb_build_object('id', CAST(:k AS text),'folio','T002'))"),
                    {"k": sid})
                await conn.execute(text(
                    f'UPDATE {_quote("products")} SET doc = jsonb_set(doc, \'{{existencia}}\', '
                    "CAST(CAST(COALESCE((doc->>'existencia')::numeric,0) - 1 AS text) AS jsonb), true), "
                    f'\"existencia\" = COALESCE(\"existencia\",0) - 1 WHERE id = CAST(:i AS text)'), {"i": pid})
        await exitosa()
        assert await db.sales.find_one({"id": sid}) is not None
        assert float((await db.products.find_one({"id": pid}))["existencia"]) == 9

        await db.sales.delete_one({"id": sid})
        await db.products.delete_one({"id": pid})
    _run(body)


# --------------------------------------------------------------------------- #
# CAJA e INVENTARIO                                                         #
# --------------------------------------------------------------------------- #
def test_caja_inventario():
    async def body():
        db = deps.db
        u = await db.users.find_one({"role": "admin"})
        assert u is not None
        cid = uid()
        await db.cajas.insert_one({"id": cid, "caja_nombre": "Caja Test",
                                   "usuario_id": u["id"], "usuario_nombre": u["name"],
                                   "fondo_inicial": 500, "estado": "abierta"})
        await db.caja_movimientos.insert_one({"id": uid(), "caja_id": cid, "tipo": "entrada",
                                              "concepto": "Fondo", "monto": 500,
                                              "usuario_id": u["id"], "usuario_nombre": u["name"]})
        movs = await db.caja_movimientos.find({"caja_id": cid}, {"_id": 0}).to_list(50)
        assert any(float(m["monto"]) == 500 for m in movs)
        await db.cajas.delete_one({"id": cid})
    _run(body)
