"""Servicio transaccional de Compras/Gastos (PostgreSQL).

Crea/confirma una compra (o gasto) de forma ATÓMICA sobre la misma conexión:

    BEGIN
      - crear el documento de compra (con items embebidos)
      - por cada item con `afecta_inventario`:
          · incrementar existencia del producto (+ kardex en inventory_movements)
          · actualizar costo y ultima_compra cuando corresponda
          · registrar historial de costos (costos_historial)
      - confirmar auditoría
    COMMIT / ROLLBACK

Cualquier fallo produce ROLLBACK de TODO: no queda compra parcial ni inventario
incrementado parcialmente. `tipo` = compra | gasto | mixto; cada item decide si
afecta inventario.
"""
import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import text

from .database import transaction, get_engine
from .adapter import _quote, _typed_cols, _ensure_table


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid() -> str:
    return uuid.uuid4().hex


class CompraError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


async def _insert_compra(conn, doc):
    doc_json = json.dumps(doc, ensure_ascii=False, default=str)
    typed = {c: doc.get(c) for c in _typed_cols("compras") if doc.get(c) is not None}
    cols = '"_id", "id", "doc"' + (", " + ", ".join(f'"{c}"' for c in typed) if typed else "")
    ph = "CAST(:k AS text), CAST(:k AS text), CAST(:d AS jsonb)" + (
        ", " + ", ".join(f":{c}" for c in typed) if typed else "")
    params = {"k": doc["id"], "d": doc_json}
    params.update(typed)
    await conn.execute(
        text(f'INSERT INTO {_quote("compras")} ({cols}) VALUES ({ph})'), params)


async def _insert_doc(conn, table: str, doc: dict):
    """Inserta un documento en una tabla documental genérica (JSONB + columnas tipadas)."""
    doc_json = json.dumps(doc, ensure_ascii=False, default=str)
    typed = {c: doc.get(c) for c in _typed_cols(table) if doc.get(c) is not None}
    cols = '"_id", "id", "doc"' + (", " + ", ".join(f'"{c}"' for c in typed) if typed else "")
    ph = "CAST(:k AS text), CAST(:k AS text), CAST(:d AS jsonb)" + (
        ", " + ", ".join(f":{c}" for c in typed) if typed else "")
    params = {"k": doc["id"], "d": doc_json}
    params.update(typed)
    await conn.execute(
        text(f'INSERT INTO {_quote(table)} ({cols}) VALUES ({ph})'), params)


async def _inserir_movimiento(conn, mov):
    await conn.execute(
        text(f'INSERT INTO {_quote("inventory_movements")} '
             '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
        {"k": mov["id"], "d": json.dumps(mov, ensure_ascii=False, default=str)})


async def _inserir_costo_historial(conn, h):
    await conn.execute(
        text(f'INSERT INTO {_quote("costos_historial")} '
             '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
        {"k": h["id"], "d": json.dumps(h, ensure_ascii=False, default=str)})


async def registrar_compra_pg(*, user, doc, user_id=None, user_name=None):
    """Persiste la compra atómicamente.
    `doc` es el documento completo ya construido por el endpoint.
    Devuelve el documento confirmado."""
    user_id = user_id or user.get("id")
    user_name = user_name or user.get("name")
    compra_id = doc["id"]
    folio = doc.get("folio", "")

    async with transaction() as conn:
        await _insert_compra(conn, doc)

        for it in doc.get("items", []):
            if not it.get("afecta_inventario"):
                continue
            pid = it.get("product_id")
            if not pid:
                continue
            row = (await conn.execute(
                text('SELECT "id","doc" FROM products WHERE "id" = CAST(:i AS text) FOR UPDATE'),
                {"i": pid})).first()
            if row is None:
                raise CompraError(400, f"Producto {it.get('codigo')} no existe")
            prod = dict(row[1])
            cant = float(it.get("cantidad", 0) or 0)
            costo = float(it.get("costo", 0) or 0)
            anterior = round(float(prod.get("existencia", 0) or 0), 3)
            resultante = round(anterior + cant, 3)
            costo_anterior = float(prod.get("costo", 0) or 0)

            # 1) Incrementar existencia + actualizar costo / última compra.
            upd = {
                "ne": resultante, "nej": json.dumps(resultante),
                "costo": costo, "costo_j": json.dumps(costo),
                "upd": json.dumps(now_iso()),
                "i": pid,
            }
            await conn.execute(
                text('UPDATE products SET "existencia" = :ne, '
                     'doc = jsonb_set(jsonb_set(jsonb_set(jsonb_set(doc, '
                     '\'{existencia}\', CAST(:nej AS jsonb), true), '
                     '\'{costo}\', CAST(:costo_j AS jsonb), true), '
                     '\'{ultima_compra}\', CAST(:upd2 AS jsonb), true), '
                     '\'{updated_at}\', CAST(:upd AS jsonb), true) '
                     'WHERE "id" = CAST(:i AS text)'),
                {**upd, "upd2": json.dumps(now_iso())})

            # 2) Kardex (entrada por compra).
            mov = {"id": uid(), "product_id": pid,
                   "codigo": it.get("codigo", prod.get("codigo")),
                   "descripcion": it.get("descripcion", prod.get("descripcion")),
                   "tipo": "compra", "documento": folio,
                   "entrada": cant, "salida": 0,
                   "existencia_anterior": anterior,
                   "existencia_resultante": resultante,
                   "costo": costo, "motivo": "", "observaciones": f"Compra {folio}",
                   "usuario_id": user_id, "usuario_nombre": user_name,
                   "referencia": f"Compra {folio}", "compra_id": compra_id,
                   "fecha": now_iso(),
                   "hora": datetime.now(timezone.utc).strftime("%H:%M:%S")}
            await _inserir_movimiento(conn, mov)

            # 3) Historial de costos (no sobrescribir, conservar traza).
            h = {"id": uid(), "product_id": pid,
                 "codigo": it.get("codigo", prod.get("codigo")),
                 "descripcion": it.get("descripcion", prod.get("descripcion")),
                 "fecha": doc.get("fecha_recepcion") or now_iso(),
                 "proveedor_id": doc.get("proveedor_id"),
                 "proveedor_nombre": doc.get("proveedor_nombre"),
                 "factura": doc.get("factura_numero") or "",
                 "compra_id": compra_id, "folio": folio,
                 "cantidad": cant, "costo": costo,
                 "costo_anterior": costo_anterior,
                 "usuario_id": user_id, "usuario_nombre": user_name,
                 "created_at": now_iso()}
            await _inserir_costo_historial(conn, h)

        # 4) Auditoría (se confirma con la transacción).
        audit = {"id": uid(), "usuario_id": user_id, "usuario_nombre": user_name,
                 "accion": "crear", "entidad": "compra",
                 "registro_id": compra_id,
                 "detalle": f"{folio} tipo {doc.get('tipo')} total {doc.get('total')}",
                 "fecha": now_iso()}
        await conn.execute(
            text(f'INSERT INTO {_quote("audit_logs")} '
                 '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
            {"k": audit["id"], "d": json.dumps(audit, ensure_ascii=False, default=str)})

    return doc


async def cancela_compra_pg(*, user, compra_id: str, motivo: str, user_id=None, user_name=None):
    """Cancela una compra de forma ATÓMICA revirtiendo el inventario.
    Protege contra doble reversión con SELECT ... FOR UPDATE sobre la compra.
    """
    user_id = user_id or user.get("id")
    user_name = user_name or user.get("name")

    async with transaction() as conn:
        row = (await conn.execute(
            text(f'SELECT "id","doc" FROM {_quote("compras")} '
                 'WHERE "id" = CAST(:i AS text) FOR UPDATE'),
            {"i": compra_id})).first()
        if row is None:
            raise CompraError(404, "Compra no encontrada")
        doc = dict(row[1])
        if doc.get("estado") == "cancelada":
            raise CompraError(409, "La compra ya está cancelada")
        if doc.get("estado") != "confirmada":
            raise CompraError(409, "Solo se pueden cancelar compras confirmadas")

        folio = doc.get("folio", "")

        # Revertir inventario por cada item que lo afectó.
        for it in doc.get("items", []):
            if not it.get("afecta_inventario"):
                continue
            pid = it.get("product_id")
            if not pid:
                continue
            prow = (await conn.execute(
                text(f'SELECT "id","doc" FROM {_quote("products")} '
                     'WHERE "id" = CAST(:i AS text) FOR UPDATE'),
                {"i": pid})).first()
            if prow is None:
                continue
            prod = dict(prow[1])
            cant = float(it.get("cantidad", 0) or 0)
            actual = round(float(prod.get("existencia", 0) or 0), 3)
            nuevo = round(actual - cant, 3)
            await conn.execute(
                text(f'UPDATE {_quote("products")} SET "existencia" = :ne, '
                     'doc = jsonb_set(jsonb_set(doc, \'{existencia}\', CAST(:nej AS jsonb), true), '
                     '\'{updated_at}\', CAST(:upd AS jsonb), true) '
                     f'WHERE "id" = CAST(:i AS text)'),
                {"ne": nuevo, "nej": json.dumps(nuevo),
                 "upd": json.dumps(now_iso()), "i": pid})
            mov = {"id": uid(), "product_id": pid,
                   "codigo": prod.get("codigo", it.get("codigo")),
                   "descripcion": prod.get("descripcion", it.get("descripcion")),
                   "tipo": "devolucion_compra", "documento": folio,
                   "entrada": 0, "salida": cant,
                   "existencia_anterior": actual,
                   "existencia_resultante": nuevo,
                   "costo": float(prod.get("costo") or it.get("costo") or 0),
                   "motivo": motivo, "observaciones": f"Cancelación {folio}",
                   "usuario_id": user_id, "usuario_nombre": user_name,
                   "referencia": f"Cancelación {folio}", "compra_id": compra_id,
                   "fecha": now_iso(),
                   "hora": datetime.now(timezone.utc).strftime("%H:%M:%S")}
            await _inserir_movimiento(conn, mov)

        cancelacion = {"usuario": user_name, "usuario_id": user_id,
                       "fecha": now_iso(), "motivo": motivo}
        await conn.execute(
            text(f'UPDATE {_quote("compras")} SET '
                 'doc = jsonb_set(jsonb_set(doc, \'{estado}\', CAST(:est AS jsonb), true), '
                 '\'{cancelacion}\', CAST(:canc AS jsonb), true) '
                 f'WHERE "id" = CAST(:i AS text)'),
            {"est": json.dumps("cancelada"),
             "canc": json.dumps(cancelacion, ensure_ascii=False, default=str),
             "i": compra_id})

        audit = {"id": uid(), "usuario_id": user_id, "usuario_nombre": user_name,
                 "accion": "cancelar", "entidad": "compra", "registro_id": compra_id,
                 "detalle": f"{folio} motivo: {motivo}", "fecha": now_iso()}
        await conn.execute(
            text(f'INSERT INTO {_quote("audit_logs")} '
                 '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
            {"k": audit["id"], "d": json.dumps(audit, ensure_ascii=False, default=str)})

    # Lectura final fuera de la transacción.
    eng = get_engine()
    async with eng.connect() as conn:
        res = await conn.execute(
            text(f'SELECT doc FROM {_quote("compras")} WHERE "id" = CAST(:i AS text)'),
            {"i": compra_id})
        r = res.first()
        await conn.commit()
    if not r:
        raise CompraError(404, "Compra no encontrada")
    return dict(r[0])


async def recibir_orden_pg(*, user, orden, recepcion, compra, user_id=None, user_name=None):
    """Confirma una recepción de mercancía de forma ATÓMICA.

    - Valida que cada cantidad recibida no supere lo pendiente de la orden.
    - Incrementa inventario SOLO por lo recibido (kardex + costos_historial).
    - Actualiza la orden (recibido/pendiente y estado parcial/recibida).
    - Registra la recepción y la compra/factura asociada (para CxP/reportes).
    Cualquier fallo produce ROLLBACK de todo.
    """
    user_id = user_id or user.get("id")
    user_name = user_name or user.get("name")
    orden_id = orden["id"]

    # La tabla de recepciones puede no existir aún (solo se inserta aquí, sin
    # pasar por el adapter). Aseguramos el esquema fuera de la transacción.
    await _ensure_table("compras_recepciones")

    async with transaction() as conn:
        row = (await conn.execute(
            text(f'SELECT "id","doc" FROM {_quote("compras_ordenes")} '
                 'WHERE "id" = CAST(:i AS text) FOR UPDATE'),
            {"i": orden_id})).first()
        if row is None:
            raise CompraError(404, "Orden de compra no encontrada")
        ord_doc = dict(row[1])
        if ord_doc.get("estado") in ("cancelada", "recibida"):
            raise CompraError(409, f"La orden está {ord_doc.get('estado')} y no admite más recepciones")

        by_pid = {}
        for oi in ord_doc.get("items", []):
            if oi.get("product_id"):
                by_pid[oi["product_id"]] = oi

        nuevos_items = []
        for r in recepcion.get("items", []):
            pid = r.get("product_id")
            qty = round(float(r.get("cantidad", 0) or 0), 3)
            if qty <= 0:
                continue
            oi = by_pid.get(pid)
            if oi is None:
                raise CompraError(400, f"El producto {r.get('descripcion') or r.get('codigo')} no está en la orden")
            pendiente = round(float(oi.get("pendiente", 0) or 0), 3)
            if qty > pendiente + 1e-9:
                raise CompraError(400, f"{r.get('descripcion')}: recibes {qty} pero solo quedan {pendiente} pendientes")

            # Bloquear y actualizar el producto (solo lo realmente recibido).
            prow = (await conn.execute(
                text(f'SELECT "id","doc" FROM {_quote("products")} '
                     'WHERE "id" = CAST(:i AS text) FOR UPDATE'),
                {"i": pid})).first()
            if prow is None:
                raise CompraError(400, f"Producto {r.get('codigo')} no existe")
            prod = dict(prow[1])
            anterior = round(float(prod.get("existencia", 0) or 0), 3)
            resultante = round(anterior + qty, 3)
            costo = float(r.get("costo", 0) or 0)
            costo_anterior = float(prod.get("costo", 0) or 0)
            await conn.execute(
                text(f'UPDATE {_quote("products")} SET "existencia" = :ne, '
                     'doc = jsonb_set(jsonb_set(jsonb_set(jsonb_set(doc, '
                     '\'{existencia}\', CAST(:nej AS jsonb), true), '
                     '\'{costo}\', CAST(:costoj AS jsonb), true), '
                     '\'{ultima_compra}\', CAST(:upd2 AS jsonb), true), '
                     '\'{updated_at}\', CAST(:upd AS jsonb), true) '
                     f'WHERE "id" = CAST(:i AS text)'),
                {"ne": resultante, "nej": json.dumps(resultante),
                 "costoj": json.dumps(costo), "upd2": json.dumps(now_iso()),
                 "upd": json.dumps(now_iso()), "i": pid})

            # Kardex (entrada por recepción).
            mov = {"id": uid(), "product_id": pid,
                   "codigo": r.get("codigo", prod.get("codigo")),
                   "descripcion": r.get("descripcion", prod.get("descripcion")),
                   "tipo": "recepcion", "documento": recepcion.get("folio", ""),
                   "entrada": qty, "salida": 0,
                   "existencia_anterior": anterior, "existencia_resultante": resultante,
                   "costo": costo, "motivo": "",
                   "observaciones": f"Recepción {recepcion.get('folio')} / Orden {ord_doc.get('folio')}",
                   "usuario_id": user_id, "usuario_nombre": user_name,
                   "referencia": f"Recepción {recepcion.get('folio')}",
                   "orden_id": orden_id, "recepcion_id": recepcion["id"],
                   "fecha": now_iso(),
                   "hora": datetime.now(timezone.utc).strftime("%H:%M:%S")}
            await _inserir_movimiento(conn, mov)

            # Historial de costos (traza).
            h = {"id": uid(), "product_id": pid,
                 "codigo": r.get("codigo", prod.get("codigo")),
                 "descripcion": r.get("descripcion", prod.get("descripcion")),
                 "fecha": recepcion.get("fecha") or now_iso(),
                 "proveedor_id": ord_doc.get("proveedor_id"),
                 "proveedor_nombre": ord_doc.get("proveedor_nombre"),
                 "factura": recepcion.get("factura_numero") or "",
                 "compra_id": compra.get("id"), "folio": compra.get("folio"),
                 "cantidad": qty, "costo": costo, "costo_anterior": costo_anterior,
                 "usuario_id": user_id, "usuario_nombre": user_name,
                 "created_at": now_iso()}
            await _inserir_costo_historial(conn, h)

            # Acumular recibido/pendiente en el item de la orden.
            nuevos_items.append({**oi, "recibido": round(float(oi.get("recibido", 0) or 0) + qty, 3),
                                 "pendiente": round(pendiente - qty, 3)})

        if not nuevos_items:
            raise CompraError(400, "No hay cantidades recibidas que registrar")

        items_orden = [next((ni for ni in nuevos_items if ni.get("product_id") == oi.get("product_id")), oi)
                       for oi in ord_doc.get("items", [])]
        pend_total = sum(float(i.get("pendiente", 0) or 0) for i in items_orden)
        estado_nuevo = "recibida" if pend_total <= 1e-9 else "parcialmente_recibida"
        await conn.execute(
            text(f'UPDATE {_quote("compras_ordenes")} SET '
                 'doc = jsonb_set(jsonb_set(jsonb_set(doc, \'{items}\', CAST(:items AS jsonb), true), '
                 '\'{estado}\', CAST(:est AS jsonb), true), '
                 '\'{actualizado_en}\', CAST(:upd AS jsonb), true) '
                 f'WHERE "id" = CAST(:i AS text)'),
            {"items": json.dumps(items_orden, ensure_ascii=False, default=str),
             "est": json.dumps(estado_nuevo),
             "upd": json.dumps(now_iso()), "i": orden_id})

        # Registrar recepción y compra asociada.
        await _insert_doc(conn, "compras_recepciones", recepcion)
        await _insert_compra(conn, compra)

        # Auditoría (se confirma con la transacción).
        for entidad, detalle in (("recepcion", recepcion.get("folio", "")),
                                 ("compra", compra.get("folio", ""))):
            audit = {"id": uid(), "usuario_id": user_id, "usuario_nombre": user_name,
                     "accion": "crear", "entidad": entidad,
                     "registro_id": recepcion.get("id"),
                     "detalle": detalle, "fecha": now_iso()}
            await conn.execute(
                text(f'INSERT INTO {_quote("audit_logs")} '
                     '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
                {"k": audit["id"], "d": json.dumps(audit, ensure_ascii=False, default=str)})

    return {"recepcion": recepcion, "compra": compra, "estado_orden": estado_nuevo}
