"""Servicio transaccional del POS (PostgreSQL).

Implementa la creación/finalización de una venta como UNA única transacción
atómica sobre la misma conexión:

    BEGIN
      ├── validar + bloquear inventario (SELECT ... FOR UPDATE por producto)
      ├── crear venta (con items y pagos embebidos)
      ├── descontar inventario + kardex (inventory_movements)
      ├── registrar pago (dentro de la venta) + movimiento de caja
      ├── saldo cliente (crédito)
      └── auditoría
    COMMIT / ROLLBACK

Cualquier fallo produce ROLLBACK de TODO: no queda venta parcial, inventario
inconsistente, pago huérfano ni movimiento de caja sin venta.
"""
import json
import uuid
from datetime import datetime, timezone
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from .database import transaction, get_engine
from .adapter import _quote, _typed_cols


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_hhmm() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M")


def uid() -> str:
    return uuid.uuid4().hex


async def ensure_idempotency_table():
    eng = get_engine()
    async with eng.connect() as conn:
        await conn.execute(text(
            'CREATE TABLE IF NOT EXISTS "sale_idempotency" ('
            '  "idempotency_key" TEXT PRIMARY KEY, "sale_id" TEXT NOT NULL,'
            '  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now())'
        ))
        await conn.commit()


async def _existing_by_key(idempotency_key: str):
    """Devuelve la venta asociada a una idempotency_key, o None."""
    if not idempotency_key:
        return None
    await ensure_idempotency_table()
    eng = get_engine()
    async with eng.connect() as conn:
        res = await conn.execute(
            text('SELECT sale_id FROM "sale_idempotency" WHERE idempotency_key = :k'),
            {"k": idempotency_key})
        row = res.first()
        await conn.commit()
    if not row:
        return None
    sid = row[0]
    async with eng.connect() as conn:
        res2 = await conn.execute(
            text(f'SELECT doc FROM {_quote("sales")} WHERE "id" = CAST(:i AS text)'), {"i": sid})
        row2 = res2.first()
        await conn.commit()
    return dict(row2[0]) if row2 else None


class VentaError(Exception):
    """Error de negocio controlado (se traduce a HTTP sin colapsar la API)."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


async def crear_venta_pg(*, user, sale, items, pagos, total, es_cotizacion,
                         caja, condicion, cliente, folio, idempotency_key=None,
                         fault=None, override_inv=None):
    """Persiste la venta atómicamente en PostgreSQL.

    `sale` es el documento completo de la venta ya construido por el endpoint
    (incluye items/pagos/totales). Devuelve el documento de la venta.

    `fault` es un gancho de inyección de fallo SOLO para pruebas de rollback:
      "venta", "inventario", "pago", "caja", "audit" -> fuerza error tras el paso.

    `override_inv` (dict opcional) autoriza inventario negativo en esta venta
    (rol verificado por el endpoint con `inventario.autorizar_negativo`).
    """
    if idempotency_key:
        existing = await _existing_by_key(idempotency_key)
        if existing:
            return existing

    user_id = user.get("id")
    user_name = user.get("name")

    try:
        async with transaction() as conn:
            # A) Inventario: bloquear fila del producto y validar existencia
            plan = []
            if not es_cotizacion:
                for it in items:
                    if not it.get("product_id"):
                        continue  # línea sin inventario (p. ej. recarga remitida)
                    row = (await conn.execute(
                        text('SELECT "id","doc" FROM products WHERE "id" = CAST(:i AS text) FOR UPDATE'),
                        {"i": it["product_id"]})).first()
                    if row is None:
                        raise VentaError(400, f"Producto {it.get('codigo')} no existe")
                    prod = dict(row[1])
                    if prod.get("estado") != "activo":
                        raise VentaError(400, f"Producto {prod.get('codigo')} no está activo")
                    controles = prod.get("controles", {}) or {}
                    controlar = controles.get("controlar_inventario", True)
                    permitir_neg = controles.get("permitir_inventario_negativo", False)
                    exist_antes = float(prod.get("existencia", 0) or 0)
                    cant = float(it["cantidad"])
                    if controlar and not permitir_neg and not override_inv and exist_antes < cant:
                        raise VentaError(409,
                                         f"Existencia insuficiente de {prod.get('codigo')} "
                                         f"(disp: {exist_antes})")
                    plan.append({"id": it["product_id"], "cant": cant,
                                 "anterior": exist_antes,
                                 "resultante": round(exist_antes - cant, 3),
                                 "descripcion": prod.get("descripcion", ""),
                                 "codigo": prod.get("codigo", ""),
                                 "costo": float(prod.get("costo") or 0)})

            # B) Crear venta (items y pagos quedan embebidos en el documento)
            _id = sale["id"]
            await _insert_sale(conn, sale)
            if fault == "venta":
                raise RuntimeError("FAULT:venta (después de crear venta, antes de inventario)")

            # C) Descontar inventario + kardex
            if not es_cotizacion:
                for inv in plan:
                    # Descontar inventario en columna tipada y en JSONB + incrementar 'vendidas'
                    await conn.execute(
                        text('UPDATE products SET "existencia" = :ne, '
                             'doc = jsonb_set(jsonb_set(jsonb_set(doc, \'{existencia}\', CAST(:nej AS jsonb), true), '
                             '\'{updated_at}\', CAST(:upd AS jsonb), true), '
                             '\'{vendidas}\', CAST(CAST(COALESCE((doc->>\'vendidas\')::numeric,0) + CAST(:vdj AS numeric) AS text) AS jsonb), true) '
                             'WHERE "id" = CAST(:i AS text)'),
                        {"ne": inv["resultante"], "nej": json.dumps(inv["resultante"]),
                         "vdj": float(inv["cant"]), "upd": json.dumps(now_iso()), "i": inv["id"]})
                    it = next(x for x in items if x["product_id"] == inv["id"])
                    await _insert_movimiento(conn, inv, it, folio, user_id, user_name)
                if fault == "inventario":
                    raise RuntimeError("FAULT:inventario (después de descontar inventario)")

            # D) Caja: efectivo entra (relación Pago -> Caja)
            if caja and not es_cotizacion and condicion == "contado":
                efectivo = sum(float(p["monto"]) for p in pagos if p.get("metodo") == "efectivo")
                if efectivo > 0:
                    monto_caja = min(efectivo, float(total))
                    cm = {"id": uid(), "caja_id": caja["id"], "tipo": "venta",
                          "concepto": f"Venta {folio}", "monto": round(monto_caja, 2),
                          "referencia": folio, "usuario_id": user_id,
                          "usuario_nombre": user_name, "fecha": now_iso()}
                    await conn.execute(
                        text(f'INSERT INTO {_quote("caja_movimientos")} '
                             '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
                        {"k": cm["id"], "d": json.dumps(cm, ensure_ascii=False, default=str)})
            if fault == "pago":
                raise RuntimeError("FAULT:pago (después de registrar pago/caja)")

            # E) Crédito: aumenta el saldo del cliente
            if condicion == "credito" and cliente:
                await conn.execute(
                    text('UPDATE clients SET "saldo" = COALESCE("saldo",0) + :t, '
                         'doc = jsonb_set(doc, \'{saldo}\', '
                         'CAST(CAST(COALESCE((doc->>\'saldo\')::numeric,0) + CAST(:t2 AS numeric) AS text) AS jsonb), true) '
                         'WHERE "id" = CAST(:i AS text)'),
                    {"t": float(sale.get("total", total)), "t2": float(sale.get("total", total)),
                     "i": cliente["id"]})
            if fault == "caja":
                raise RuntimeError("FAULT:caja (después de movimiento de caja)")

            # F) Auditoría (se confirma con la transacción)
            audit = {"id": uid(), "usuario_id": user_id, "usuario_nombre": user_name,
                     "accion": "crear", "entidad": "cotizacion" if es_cotizacion else "venta",
                     "registro_id": _id, "detalle": f"{folio} total {total}", "fecha": now_iso()}
            await conn.execute(
                text(f'INSERT INTO {_quote("audit_logs")} '
                     '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
                {"k": audit["id"], "d": json.dumps(audit, ensure_ascii=False, default=str)})
            if fault == "audit":
                raise RuntimeError("FAULT:audit (después de auditoría)")

            # G) Idempotencia
            if idempotency_key:
                await conn.execute(
                    text('INSERT INTO "sale_idempotency" (idempotency_key, sale_id) '
                         'VALUES (:k, :s)'),
                    {"k": idempotency_key, "s": _id})
        # COMMIT implícito al salir de transaction()
        return sale
    except IntegrityError as e:
        # Reintento concurrente con la misma idempotency_key -> devolver la venta existente
        if idempotency_key and getattr(e.orig, "sqlstate", "") == "23505":
            existing = await _existing_by_key(idempotency_key)
            if existing:
                return existing
        raise
    except VentaError as e:
        raise


async def _insert_sale(conn, sale):
    doc_json = json.dumps(sale, ensure_ascii=False, default=str)
    typed = {c: sale.get(c) for c in _typed_cols("sales") if sale.get(c) is not None}
    cols = '"_id", "id", "doc"' + (", " + ", ".join(f'"{c}"' for c in typed) if typed else "")
    ph = "CAST(:k AS text), CAST(:k AS text), CAST(:d AS jsonb)" + (
        ", " + ", ".join(f":{c}" for c in typed) if typed else "")
    params = {"k": sale["id"], "d": doc_json}
    params.update(typed)
    await conn.execute(
        text(f'INSERT INTO {_quote("sales")} ({cols}) VALUES ({ph})'), params)


async def _insert_movimiento(conn, inv, it, folio, user_id, user_name):
    mov = {"id": uid(), "product_id": inv["id"],
           "codigo": inv.get("codigo", it.get("codigo")),
           "descripcion": inv.get("descripcion", it.get("descripcion")),
           "tipo": "venta", "documento": folio,
           "entrada": 0, "salida": it["cantidad"],
           "existencia_anterior": inv["anterior"],
           "existencia_resultante": inv["resultante"],
           "costo": inv["costo"], "motivo": "", "observaciones": "",
           "usuario_id": user_id, "usuario_nombre": user_name,
           "referencia": f"Venta {folio}", "fecha": now_iso(),
           "hora": datetime.now(timezone.utc).strftime("%H:%M:%S")}
    await conn.execute(
        text(f'INSERT INTO {_quote("inventory_movements")} '
             '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
        {"k": mov["id"], "d": json.dumps(mov, ensure_ascii=False, default=str)})
