"""Servicio transaccional del POS (PostgreSQL).

Implementa la creación/finalización de una venta como UNA única transacción
atómica sobre la misma conexión:

    BEGIN
      ├── reservar la llave de idempotencia (un reintento espera y devuelve la misma venta)
      ├── folio (solo si la venta se guarda: sin huecos por ventas rechazadas)
      ├── validar + bloquear inventario (un SELECT ... FOR UPDATE ordenado por id:
      │   dos cajas con los mismos productos no se bloquean entre sí)
      ├── crear venta (con items y pagos embebidos)
      ├── descontar inventario + kardex (inventory_movements), sumando renglones
      │   repetidos del mismo producto
      ├── registrar pago (dentro de la venta) + movimiento de caja
      ├── saldo cliente (crédito, revalidando el límite con la fila bloqueada)
      ├── consumir autorizaciones de precio manual (una sola vez)
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


_IDEMPOTENCY_READY = False


async def ensure_idempotency_table():
    """Crea la tabla de idempotencia UNA sola vez por proceso (evita un DDL
    por cada venta)."""
    global _IDEMPOTENCY_READY
    if _IDEMPOTENCY_READY:
        return
    eng = get_engine()
    async with eng.connect() as conn:
        await conn.execute(text(
            'CREATE TABLE IF NOT EXISTS "sale_idempotency" ('
            '  "idempotency_key" TEXT PRIMARY KEY, "sale_id" TEXT NOT NULL,'
            '  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now())'
        ))
        await conn.commit()
    _IDEMPOTENCY_READY = True


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


class _Duplicada(Exception):
    """La llave de idempotencia ya pertenece a otra venta (reintento)."""


async def folio_en_tx(conn, nombre: str, prefijo: str, ancho: int) -> str:
    """Siguiente folio dentro de la transacción de la venta: si la venta se
    revierte, el número vuelve a quedar libre (sin huecos). La fila de
    `sequences` queda bloqueada hasta el COMMIT, lo que ordena los folios."""
    seq = (await conn.execute(
        text('INSERT INTO "sequences" (name, seq) VALUES (:n, 1) '
             'ON CONFLICT (name) DO UPDATE SET seq = "sequences".seq + 1 RETURNING seq'),
        {"n": nombre})).scalar()
    return f"{prefijo}{str(int(seq)).zfill(ancho)}"


class VentaError(Exception):
    """Error de negocio controlado (se traduce a HTTP sin colapsar la API)."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


async def crear_venta_pg(*, user, sale, items, pagos, total, es_cotizacion,
                         caja, condicion, cliente, folio, idempotency_key=None,
                         fault=None, override_inv=None, serie=None,
                         autorizaciones=None, validar_credito=False):
    """Persiste la venta atómicamente en PostgreSQL.

    `sale` es el documento completo de la venta ya construido por el endpoint
    (incluye items/pagos/totales). Devuelve el documento de la venta.

    `fault` es un gancho de inyección de fallo SOLO para pruebas de rollback:
      "venta", "inventario", "pago", "caja", "audit" -> fuerza error tras el paso.

    `override_inv` (dict opcional) autoriza inventario negativo en esta venta
    (rol verificado por el endpoint con `inventario.autorizar_negativo`).

    `serie` = (secuencia, prefijo, ancho): el folio se asigna DENTRO de la
    transacción cuando `folio` es None. `autorizaciones`: ids de autorización
    de precio manual que esta venta consume (una sola vez). `validar_credito`:
    revalida el límite de crédito con la fila del cliente bloqueada.
    """
    if idempotency_key:
        existing = await _existing_by_key(idempotency_key)
        if existing:
            return existing
        await ensure_idempotency_table()

    user_id = user.get("id")
    user_name = user.get("name")

    try:
        async with transaction() as conn:
            _id = sale["id"]
            # 0) Idempotencia al INICIO: un reintento simultáneo con la misma llave
            #    espera a que termine el primero y luego devuelve esa misma venta,
            #    sin hacer el trabajo ni consumir folio.
            if idempotency_key:
                ok = (await conn.execute(
                    text('INSERT INTO "sale_idempotency" (idempotency_key, sale_id) '
                         'VALUES (:k, :s) ON CONFLICT (idempotency_key) DO NOTHING RETURNING sale_id'),
                    {"k": idempotency_key, "s": _id})).first()
                if ok is None:
                    raise _Duplicada()

            # 1) Folio dentro de la transacción (sin huecos si la venta falla)
            if folio is None and serie:
                folio = await folio_en_tx(conn, *serie)
                sale["folio"] = folio

            # A) Inventario: bloquear las filas en orden fijo (por id) y validar la
            #    existencia contra la suma de todos los renglones del producto.
            plan = []
            if not es_cotizacion:
                ids = sorted({it["product_id"] for it in items if it.get("product_id")})
                prods = {}
                if ids:
                    for row in (await conn.execute(
                            text('SELECT "id","doc" FROM products WHERE "id" = ANY(:ids) ORDER BY "id" FOR UPDATE'),
                            {"ids": ids})).fetchall():
                        prods[row[0]] = dict(row[1])
                pedido = {}
                for it in items:
                    pid = it.get("product_id")
                    if not pid:
                        continue  # línea sin inventario (p. ej. recarga remitida)
                    if pid not in prods:
                        raise VentaError(400, f"Producto {it.get('codigo')} no existe")
                    cant_base = round(float(it["cantidad"]) * float(it.get("factor") or 1.0), 3)
                    pedido[pid] = round(pedido.get(pid, 0.0) + cant_base, 3)
                for pid, total_base in pedido.items():
                    prod = prods[pid]
                    if prod.get("estado") != "activo":
                        raise VentaError(400, f"Producto {prod.get('codigo')} no está activo")
                    controles = prod.get("controles", {}) or {}
                    controlar = controles.get("controlar_inventario", True)
                    permitir_neg = controles.get("permitir_inventario_negativo", False)
                    exist_antes = float(prod.get("existencia", 0) or 0)
                    if controlar and not permitir_neg and not override_inv and exist_antes < total_base:
                        raise VentaError(409,
                                         f"Existencia insuficiente de {prod.get('codigo')} "
                                         f"(disp: {exist_antes} {prod.get('unidad_medida','PZA')}, req: {total_base})")
                # Un movimiento de kardex por renglón, con la existencia corrida.
                corrida = {pid: float(prods[pid].get("existencia", 0) or 0) for pid in pedido}
                for it in items:
                    pid = it.get("product_id")
                    if not pid:
                        continue
                    prod = prods[pid]
                    cant_comercial = float(it["cantidad"])
                    factor = float(it.get("factor") or 1.0)
                    cant_base = round(cant_comercial * factor, 3)
                    anterior = corrida[pid]
                    corrida[pid] = round(anterior - cant_base, 3)
                    plan.append({"id": pid, "cant": cant_base, "item": it,
                                 "cant_comercial": cant_comercial, "factor": factor,
                                 "presentacion": it.get("presentacion") or prod.get("unidad_medida", "PZA"),
                                 "anterior": anterior, "resultante": corrida[pid],
                                 "descripcion": prod.get("descripcion", ""),
                                 "codigo": prod.get("codigo", ""),
                                 "costo": float(prod.get("costo") or 0)})

            # B) Crear venta (items y pagos quedan embebidos en el documento)
            await _insert_sale(conn, sale)
            if fault == "venta":
                raise RuntimeError("FAULT:venta (después de crear venta, antes de inventario)")

            # C) Descontar inventario (una vez por producto) + kardex (por renglón)
            if not es_cotizacion:
                # La venta solo toca existencia y vendidas: marca `existencia_at` y
                # no `updated_at`, que queda para ediciones del producto. Así el
                # catálogo del POS en caché (/products/pos-index) no se rehace
                # con cada venta; las existencias van por /products/existencias.
                for pid, final in corrida.items():
                    vendidas = round(float(prods[pid].get("existencia", 0) or 0) - final, 3)
                    await conn.execute(
                        text('UPDATE products SET "existencia" = :ne, '
                             'doc = jsonb_set(jsonb_set(jsonb_set(doc, \'{existencia}\', CAST(:nej AS jsonb), true), '
                             '\'{existencia_at}\', CAST(:upd AS jsonb), true), '
                             '\'{vendidas}\', CAST(CAST(COALESCE((doc->>\'vendidas\')::numeric,0) + CAST(:vdj AS numeric) AS text) AS jsonb), true) '
                             'WHERE "id" = CAST(:i AS text)'),
                        {"ne": final, "nej": json.dumps(final),
                         "vdj": vendidas, "upd": json.dumps(now_iso()), "i": pid})
                for inv in plan:
                    await _insert_movimiento(conn, inv, inv["item"], folio, user_id, user_name)
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

            # E) Crédito: aumenta el saldo del cliente. Con `validar_credito` el
            #    límite se revisa en el mismo UPDATE: dos ventas simultáneas del
            #    mismo cliente ya no pueden pasarlo.
            if condicion == "credito" and cliente:
                cond_limite = ''
                if validar_credito:
                    cond_limite = (' AND COALESCE("saldo",0) + :t <= COALESCE("limite_credito", '
                                   '(doc->>\'limite_credito\')::numeric, 0) + 0.01')
                r = (await conn.execute(
                    text('UPDATE clients SET "saldo" = COALESCE("saldo",0) + :t, '
                         'doc = jsonb_set(doc, \'{saldo}\', '
                         'CAST(CAST(COALESCE((doc->>\'saldo\')::numeric,0) + CAST(:t2 AS numeric) AS text) AS jsonb), true) '
                         'WHERE "id" = CAST(:i AS text)' + cond_limite + ' RETURNING "saldo"'),
                    {"t": float(sale.get("total", total)), "t2": float(sale.get("total", total)),
                     "i": cliente["id"]})).first()
                if r is None and validar_credito:
                    raise VentaError(409, "La venta excede el crédito disponible del cliente")

            # E2) Autorizaciones de precio manual: se consumen aquí, una sola vez.
            for aid in (autorizaciones or []):
                usada = (await conn.execute(
                    text('UPDATE autorizaciones SET doc = doc || jsonb_build_object('
                         '\'usado\', true, \'usado_at\', CAST(:f AS text), '
                         '\'venta_id\', CAST(:s AS text), \'venta_folio\', CAST(:fo AS text)) '
                         'WHERE "id" = CAST(:a AS text) AND COALESCE(doc->>\'usado\', \'false\') <> \'true\' '
                         'RETURNING "id"'),
                    {"f": now_iso(), "s": _id, "fo": folio or "", "a": aid})).first()
                if usada is None:
                    raise VentaError(409, "Una autorización de precio manual ya se usó en otra venta. "
                                          "Vuelve a autorizarla con F6.")
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

        # COMMIT implícito al salir de transaction()
        return sale
    except _Duplicada:
        existing = await _existing_by_key(idempotency_key)
        if existing:
            return existing
        raise VentaError(409, "Esta venta ya se está registrando; vuelve a intentar en unos segundos")
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
           "entrada": 0, "salida": inv.get("cant", it["cantidad"]),
           "existencia_anterior": inv["anterior"],
           "existencia_resultante": inv["resultante"],
           "presentacion": inv.get("presentacion") or it.get("presentacion") or "PZA",
           "factor": inv.get("factor", 1.0),
           "cantidad_comercial": inv.get("cant_comercial", it["cantidad"]),
           "cantidad_base": inv.get("cant", it["cantidad"]),
           "costo": inv["costo"], "motivo": "", "observaciones": "",
           "usuario_id": user_id, "usuario_nombre": user_name,
           "referencia": f"Venta {folio}", "fecha": now_iso(),
           "hora": datetime.now(timezone.utc).strftime("%H:%M:%S")}
    await conn.execute(
        text(f'INSERT INTO {_quote("inventory_movements")} '
             '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
        {"k": mov["id"], "d": json.dumps(mov, ensure_ascii=False, default=str)})


async def cancela_venta_pg(*, user, sale_id: str, motivo: str):
    """Cancela una venta de forma ATÓMICA en PostgreSQL.

    Revertir todo o nada: inventario (+ kardex y 'vendidas'), caja, saldo del
    cliente y el estado de la venta. Usa SELECT ... FOR UPDATE sobre la venta
    para impedir dobles cancelaciones concurrentes y sobre cada producto para
    no perder unidades devueltas.
    """
    user_id = user.get("id")
    user_name = user.get("name")

    async with transaction() as conn:
        row = (await conn.execute(
            text(f'SELECT "id","doc" FROM {_quote("sales")} '
                 'WHERE "id" = CAST(:i AS text) FOR UPDATE'),
            {"i": sale_id})).first()
        if row is None:
            raise VentaError(404, "Venta no encontrada")
        sale = dict(row[1])
        if sale.get("estado") == "cancelada":
            raise VentaError(409, "La venta ya está cancelada")
        if sale.get("estado") != "confirmada":
            raise VentaError(409, "Solo se pueden cancelar ventas confirmadas")

        folio = sale.get("folio", "")
        # A) Revertir inventario bloqueando cada producto.
        for it in sale.get("items", []):
            pid = it.get("product_id")
            if not pid:
                continue  # línea sin inventario (p. ej. recarga remitida)
            prow = (await conn.execute(
                text(f'SELECT "id","doc" FROM {_quote("products")} '
                     'WHERE "id" = CAST(:i AS text) FOR UPDATE'),
                {"i": pid})).first()
            if prow is None:
                continue
            prod = dict(prow[1])
            factor = float(it.get("factor") or 1.0)
            cant_comercial = float(it.get("cantidad") or 0)
            cant_base = round(float(it.get("cantidad_base") or (cant_comercial * factor)), 3)
            actual = round(float(prod.get("existencia", 0) or 0), 3)
            nuevo = round(actual + cant_base, 3)
            await conn.execute(
                text(f'UPDATE {_quote("products")} SET "existencia" = :ne, '
                     'doc = jsonb_set(jsonb_set(jsonb_set(doc, \'{existencia}\', CAST(:nej AS jsonb), true), '
                     '\'{existencia_at}\', CAST(:upd AS jsonb), true), '
                     '\'{vendidas}\', CAST(CAST(COALESCE((doc->>\'vendidas\')::numeric,0) - CAST(:vnd AS numeric) AS text) AS jsonb), true) '
                     f'WHERE "id" = CAST(:i AS text)'),
                {"ne": nuevo, "nej": json.dumps(nuevo), "vnd": cant_base,
                 "upd": json.dumps(now_iso()), "i": pid})
            mov = {"id": uid(), "product_id": pid,
                   "codigo": prod.get("codigo", it.get("codigo")),
                   "descripcion": prod.get("descripcion", it.get("descripcion")),
                   "tipo": "devolucion", "documento": folio,
                   "entrada": cant_base, "salida": 0,
                   "existencia_anterior": actual,
                   "existencia_resultante": nuevo,
                   "presentacion": it.get("presentacion") or prod.get("unidad_medida", "PZA"),
                   "factor": factor,
                   "cantidad_comercial": cant_comercial,
                   "cantidad_base": cant_base,
                   "costo": float(prod.get("costo") or it.get("costo") or 0),
                   "motivo": motivo, "observaciones": f"Cancelación {folio}",
                   "usuario_id": user_id, "usuario_nombre": user_name,
                   "referencia": f"Cancelación {folio}", "venta_id": sale_id,
                   "caja_id": sale.get("caja_id") or "",
                   "fecha": now_iso(),
                   "hora": datetime.now(timezone.utc).strftime("%H:%M:%S")}
            await conn.execute(
                text(f'INSERT INTO {_quote("inventory_movements")} '
                     '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
                {"k": mov["id"], "d": json.dumps(mov, ensure_ascii=False, default=str)})

        # B) Revertir caja: el efectivo vuelve a salir (devolución).
        if sale.get("caja_id") and sale.get("condicion") == "contado":
            efectivo = sum(float(p.get("monto", 0) or 0)
                           for p in sale.get("pagos", []) if p.get("metodo") == "efectivo")
            if efectivo > 0:
                monto = round(min(efectivo, float(sale.get("total", 0) or 0)), 2)
                cm = {"id": uid(), "caja_id": sale["caja_id"], "tipo": "devolucion",
                      "concepto": f"Cancelación {folio}", "monto": monto,
                      "referencia": folio, "usuario_id": user_id,
                      "usuario_nombre": user_name, "fecha": now_iso()}
                await conn.execute(
                    text(f'INSERT INTO {_quote("caja_movimientos")} '
                         '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
                    {"k": cm["id"], "d": json.dumps(cm, ensure_ascii=False, default=str)})

        # C) Revertir crédito: descuenta el saldo pendiente (respetando abonos).
        if sale.get("condicion") == "credito" and sale.get("cliente_id"):
            pendiente = round(float(sale.get("saldo", sale.get("total", 0) or 0)), 2)
            if pendiente > 0:
                await conn.execute(
                    text(f'UPDATE {_quote("clients")} SET "saldo" = COALESCE("saldo",0) - :s, '
                         'doc = jsonb_set(doc, \'{saldo}\', '
                         'CAST(CAST(COALESCE((doc->>\'saldo\')::numeric,0) - CAST(:s2 AS numeric) AS text) AS jsonb), true) '
                         f'WHERE "id" = CAST(:i AS text)'),
                    {"s": float(pendiente), "s2": float(pendiente), "i": sale["cliente_id"]})

        # D) Marcar la venta como cancelada (idempotente: FOR UPDATE ya protegió
        #    la doble cancelación simultánea). Se actualiza la columna tipada
        #    "saldo" JUNTO con el JSONB para que nunca diverjan.
        cancelacion = {"usuario": user_name, "usuario_id": user_id,
                       "fecha": now_iso(), "motivo": motivo}
        await conn.execute(
            text(f'UPDATE {_quote("sales")} SET '
                 '"saldo" = 0, '
                 'doc = jsonb_set(jsonb_set(jsonb_set(doc, \'{estado}\', CAST(:est AS jsonb), true), '
                 '\'{cancelacion}\', CAST(:canc AS jsonb), true), '
                 '\'{saldo}\', CAST(CAST(0 AS numeric) AS text)::jsonb, true) '
                 f'WHERE "id" = CAST(:i AS text)'),
            {"est": json.dumps("cancelada"), "canc": json.dumps(cancelacion, ensure_ascii=False, default=str),
             "i": sale_id})

        # E) Auditoría (se confirma con la transacción).
        audit = {"id": uid(), "usuario_id": user_id, "usuario_nombre": user_name,
                 "accion": "cancelar", "entidad": "venta", "registro_id": sale_id,
                 "detalle": f"{folio} motivos: {motivo}", "fecha": now_iso()}
        await conn.execute(
            text(f'INSERT INTO {_quote("audit_logs")} '
                 '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
            {"k": audit["id"], "d": json.dumps(audit, ensure_ascii=False, default=str)})

    # Lectura final fuera de la transacción (como hacía el endpoint original).
    eng = get_engine()
    async with eng.connect() as conn:
        res = await conn.execute(
            text(f'SELECT doc FROM {_quote("sales")} WHERE "id" = CAST(:i AS text)'),
            {"i": sale_id})
        r = res.first()
        await conn.commit()
    if not r:
        raise VentaError(404, "Venta no encontrada")
    return dict(r[0])
