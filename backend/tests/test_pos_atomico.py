"""Pruebas de la transacción atómica del POS (PostgreSQL REAL).

Verifican atomicidad, rollback en cada etapa, inventario concurrente, folios,
ventas concurrentes, idempotencia y consistencia directamente en la base.

Ejecutar desde `backend/`:
    venv/Scripts/python -m pytest tests/test_pos_atomico.py -n 0
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
from pgstore import pos
from pgstore.adapter import _quote
import deps


def uid():
    return uuid.uuid4().hex


USER = {"id": "testuser", "name": "Test User PG"}


def make_sale(items, condicion="contado", pagos=None, tipo="directa", folio="V-PG",
              cliente_id=None, cliente_nombre="Publico General", caja_id=None):
    total = round(sum(i["cantidad"] * i["precio"] for i in items), 2)
    subtotal = round(total / 1.16, 2)
    iva = round(total - subtotal, 2)
    saldo = total if condicion == "credito" else 0
    return {"id": uid(), "folio": folio, "fecha": pos.now_iso(), "hora": pos.now_hhmm(),
            "usuario_id": USER["id"], "usuario_nombre": USER["name"],
            "vendedor_id": USER["id"], "vendedor_nombre": USER["name"],
            "cliente_id": cliente_id, "cliente_nombre": cliente_nombre,
            "items": items, "subtotal": subtotal, "iva_total": iva, "descuento_total": 0,
            "total": total, "tipo_venta": tipo, "condicion": condicion,
            "pagos": pagos or [{"metodo": "efectivo", "monto": total}],
            "cambio": 0, "saldo": saldo, "estado": "confirmada", "factura": False,
            "caja_id": caja_id, "lista_precios": 1}


async def _make_product(db, existencia=10):
    pid = uid()
    await db.products.insert_one({
        "id": pid, "codigo": pid[:7], "descripcion": "ATOM", "existencia": existencia,
        "costo": 5, "iva_tasa": 16, "estado": "activo", "unidad_medida": "PZA",
        "controles": {"controlar_inventario": True, "permitir_inventario_negativo": False}})
    return pid


def _item(pid, cant=1, precio=10.0):
    return {"product_id": pid, "codigo": pid[:7], "descripcion": "ATOM", "cantidad": cant,
            "unidad": "PZA", "precio": precio, "iva_tasa": 16, "descuento": 0}


async def _existencia(db, pid):
    p = await db.products.find_one({"id": pid})
    return float(p["existencia"])


async def _count(table, where):
    eng = pgstore.get_engine()
    async with eng.connect() as c:
        r = await c.execute(text(f'SELECT COUNT(*) FROM {_quote(table)} t WHERE {where}'))
        n = r.scalar_one(); await c.commit()
    return n


def _run(body):
    async def _main():
        await pgstore.init_db_pool()
        await body()
        await pgstore.dispose()
    asyncio.run(_main())


def _call(db, sale, caja=None, cliente=None, fault=None, idem=None):
    return pos.crear_venta_pg(
        user=USER, sale=sale, items=sale["items"], pagos=sale["pagos"], total=sale["total"],
        es_cotizacion=sale["tipo_venta"] == "cotizacion", caja=caja,
        condicion=sale["condicion"], cliente=cliente, folio=sale["folio"],
        idempotency_key=idem, fault=fault)


# --------------------------------------------------------------------------- #
# 1. VENTA NORMAL (todo registrado)                                         #
# --------------------------------------------------------------------------- #
def test_venta_normal():
    async def body():
        db = deps.db
        pid = await _make_product(db, 10)
        caja_id = uid()
        await db.cajas.insert_one({"id": caja_id, "caja_nombre": "C", "usuario_id": USER["id"],
                                   "usuario_nombre": USER["name"], "fondo_inicial": 0, "estado": "abierta"})
        sale = make_sale([_item(pid, 2, 10.0)], caja_id=caja_id)
        res = await _call(db, sale, caja={"id": caja_id})
        assert res["folio"] == sale["folio"]
        assert await _existencia(db, pid) == 8
        # venta, kardex, caja, auditoría
        assert await db.sales.find_one({"id": sale["id"]}) is not None
        movs = await db.inventory_movements.find({"product_id": pid}, {"_id": 0}).to_list(100)
        assert any(m["tipo"] == "venta" and float(m["salida"]) == 2 for m in movs)
        cm = await db.caja_movimientos.find({"caja_id": caja_id}, {"_id": 0}).to_list(100)
        assert any(m["tipo"] == "venta" and float(m["monto"]) == 20.0 for m in cm)
        audit = await db.audit_logs.find({"registro_id": sale["id"]}, {"_id": 0}).to_list(10)
        assert any(a["accion"] == "crear" and a["entidad"] == "venta" for a in audit)
        # limpieza
        await db.sales.delete_one({"id": sale["id"]})
        await db.inventory_movements.delete_many({"product_id": pid})
        await db.caja_movimientos.delete_many({"caja_id": caja_id})
        await db.audit_logs.delete_many({"registro_id": sale["id"]})
        await db.cajas.delete_one({"id": caja_id})
        await db.products.delete_one({"id": pid})
    _run(body)


# --------------------------------------------------------------------------- #
# ROLLBACK en cada etapa (consulta directa a la BD)                          #
# --------------------------------------------------------------------------- #
def _rollback_case(fault, label):
    def test():
        async def body():
            db = deps.db
            pid = await _make_product(db, 10)
            caja_id = uid()
            await db.cajas.insert_one({"id": caja_id, "caja_nombre": "C",
                                       "usuario_id": USER["id"], "usuario_nombre": USER["name"],
                                       "fondo_inicial": 0, "estado": "abierta"})
            sale = make_sale([_item(pid, 1, 10.0)], caja_id=caja_id)
            try:
                await _call(db, sale, caja={"id": caja_id}, fault=fault)
                raise AssertionError("no forzó fallo")
            except RuntimeError:
                pass
            # NADA debe persistirse
            assert await db.sales.find_one({"id": sale["id"]}) is None, f"{label}: venta presente"
            assert await _existencia(db, pid) == 10, f"{label}: inventario modificado"
            assert await _count("inventory_movements", f"t.doc->>'product_id' = '{pid}'") == 0
            assert await _count("caja_movimientos", f"t.doc->>'caja_id' = '{caja_id}'") == 0
            assert await _count("audit_logs", f"t.doc->>'registro_id' = '{sale['id']}'") == 0
            await db.cajas.delete_one({"id": caja_id})
            await db.products.delete_one({"id": pid})
        _run(body)
    return test


test_rollback_despues_venta = _rollback_case("venta", "después de crear venta")
test_rollback_despues_inventario = _rollback_case("inventario", "después de descontar inventario")
test_rollback_despues_pago = _rollback_case("pago", "después de registrar pago/caja")
test_rollback_despues_caja = _rollback_case("caja", "después de movimiento de caja")
test_rollback_despues_auditoria = _rollback_case("audit", "después de auditoría")


# --------------------------------------------------------------------------- #
# Crédito: rollback también revierte el saldo del cliente                    #
# --------------------------------------------------------------------------- #
def test_rollback_credito():
    async def body():
        db = deps.db
        pid = await _make_product(db, 10)
        cid = uid()
        await db.clients.insert_one({"id": cid, "codigo": "CLI", "nombre": "Cliente Crédito",
                                     "credito_autorizado": True, "limite_credito": 1000, "saldo": 0,
                                     "estado": "activo"})
        sale = make_sale([_item(pid, 1, 10.0)], condicion="credito", cliente_id=cid,
                         cliente_nombre="Cliente Crédito")
        # normal
        await _call(db, sale, cliente={"id": cid, "nombre": "Cliente Crédito"})
        cli = await db.clients.find_one({"id": cid})
        assert float(cli["saldo"]) == 10.0
        # con fallo post-venta -> saldo revierte
        s2 = make_sale([_item(pid, 1, 10.0)], condicion="credito", cliente_id=cid,
                       cliente_nombre="Cliente Crédito")
        try:
            await _call(db, s2, cliente={"id": cid}, fault="venta")
        except RuntimeError:
            pass
        cli = await db.clients.find_one({"id": cid})
        assert float(cli["saldo"]) == 10.0, "saldo de cliente no revirtió"
        await db.sales.delete_one({"id": sale["id"]})
        await db.inventory_movements.delete_many({"product_id": pid})
        await db.audit_logs.delete_many({"registro_id": sale["id"]})
        await db.clients.delete_one({"id": cid})
        await db.products.delete_one({"id": pid})
    _run(body)


# --------------------------------------------------------------------------- #
# Inventario concurrente: solo una de dos ventas consume la unidad           #
# --------------------------------------------------------------------------- #
def test_inventario_concurrente():
    async def body():
        db = deps.db
        pid = await _make_product(db, 1)

        async def vender(tag):
            sale = make_sale([_item(pid, 1, 10.0)], folio=f"V-{tag}")
            try:
                await _call(db, sale)
                return "ok"
            except pos.VentaError as e:
                return f"reject:{e.status}"

        r = await asyncio.gather(vender("A"), vender("B"))
        assert sorted(x.startswith("reject") for x in r).count(True) == 1
        assert any(x == "ok" for x in r)
        assert await _existencia(db, pid) == 0, "existencia final debe ser 0"
        ok_count = await _count("inventory_movements", f"t.doc->>'product_id' = '{pid}'")
        assert ok_count == 1, f"kardex: se registraron {ok_count} movimientos (esperado 1)"
        await db.inventory_movements.delete_many({"product_id": pid})
        await db.products.delete_one({"id": pid})
    _run(body)


# --------------------------------------------------------------------------- #
# Folios: 100 concurrentes -> 100 únicos                                     #
# --------------------------------------------------------------------------- #
def test_folios_100_concurrentes():
    async def body():
        name = f"seq_{uid()[:8]}"
        results = await asyncio.gather(*[deps.next_counter(name, "V", 6) for _ in range(100)])
        assert len(results) == 100
        assert len(set(results)) == 100
        eng = pgstore.get_engine()
        async with eng.begin() as c:
            await c.execute(text("DELETE FROM sequences WHERE name=:n"), {"n": name})
    _run(body)


# --------------------------------------------------------------------------- #
# Ventas concurrentes (20 y 50)                                             #
# --------------------------------------------------------------------------- #
def test_ventas_concurrentes():
    async def body():
        db = deps.db
        for n in (20, 50):
            pid = await _make_product(db, 200)
            caja_id = uid()
            await db.cajas.insert_one({"id": caja_id, "caja_nombre": "C", "usuario_id": USER["id"],
                                       "usuario_nombre": USER["name"], "fondo_inicial": 0, "estado": "abierta"})
            folios = await asyncio.gather(*[
                (lambda sale: _call(db, sale, caja={"id": caja_id}))(
                    make_sale([_item(pid, 1, 10.0)], folio=f"V-{i}", caja_id=caja_id))
                for i in range(n)
            ])
            fset = [f["folio"] for f in folios]
            assert len(set(fset)) == n, f"{n}: folios duplicados"
            assert await _existencia(db, pid) == 200 - n, f"{n}: inventario incorrecto"
            assert await _count("inventory_movements", f"t.doc->>'product_id' = '{pid}'") == n
            assert await _count("caja_movimientos", f"t.doc->>'caja_id' = '{caja_id}'") == n
            # limpieza
            sales = await db.sales.find({"cliente_nombre": "Publico General", "caja_id": caja_id},
                                        {"_id": 0}).to_list(200)
            for s in sales:
                await db.sales.delete_one({"id": s["id"]})
            await db.inventory_movements.delete_many({"product_id": pid})
            await db.caja_movimientos.delete_many({"caja_id": caja_id})
            await db.cajas.delete_one({"id": caja_id})
            await db.products.delete_one({"id": pid})
    _run(body)


# --------------------------------------------------------------------------- #
# Idempotencia y reintento concurrente                                       #
# --------------------------------------------------------------------------- #
def test_idempotencia():
    async def body():
        db = deps.db
        pid = await _make_product(db, 10)
        key = "key-" + uid()
        sale = make_sale([_item(pid, 1, 10.0)], folio="V-IDEM")
        a = await _call(db, sale, idem=key)
        b = await _call(db, dict(sale), idem=key)
        assert a["id"] == b["id"]
        assert await _existencia(db, pid) == 9, "inventario descontado dos veces"
        # reintento concurrente (misma key, simultáneo)
        sale2 = make_sale([_item(pid, 1, 10.0)], folio="V-IDEM2")
        r1, r2 = await asyncio.gather(
            _call(db, dict(sale2), idem=key), _call(db, dict(sale2), idem=key))
        assert r1["id"] == r2["id"] == a["id"]
        assert await _existencia(db, pid) == 9, "reintento concurrente descontó dos veces"
        assert await _count("sales", f"t.doc->>'id' = '{a['id']}'") == 1
        for s in [sale, sale2]:
            await db.sales.delete_one({"id": s["id"]})
        await db.inventory_movements.delete_many({"product_id": pid})
        await db.products.delete_one({"id": pid})
        await db.audit_logs.delete_many({"registro_id": a["id"]})
        eng = pgstore.get_engine()
        async with eng.begin() as c:
            await c.execute(text('DELETE FROM "sale_idempotency" WHERE idempotency_key=:k'), {"k": key})
    _run(body)
