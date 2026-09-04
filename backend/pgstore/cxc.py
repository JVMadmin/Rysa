"""Cuentas por Cobrar: abonos y cancelaciones ATÓMICOS en PostgreSQL.

Antes, `POST /cxc/{id}/abono` componía N updates sueltos vía el adapter
(cada uno en su propia transacción): un fallo a mitad dejaba saldos aplicados
parcialmente sin registro de abono, y dos abonos concurrentes podían dejar el
saldo del cliente NEGATIVO (check-then-act sin lock).

Aquí TODO ocurre en UNA transacción sobre la MISMA conexión:

    BEGIN
      ├── SELECT ... FOR UPDATE del cliente (serializa abonos del mismo cliente)
      ├── validaciones de negocio (saldo pendiente, monto <= saldo)
      ├── SELECT ... FOR UPDATE de las ventas a crédito con saldo (FIFO)
      ├── aplicar FIFO: sales.saldo (columna tipada + JSONB SIEMPRE juntas)
      ├── clients.saldo -= monto (columna + JSONB)
      ├── INSERT abono (+ movimiento de caja si efectivo)
      └── auditoría
    COMMIT / ROLLBACK

La cancelación de un abono es igualmente atómica y reversible una sola vez.
"""
import json
import uuid
from datetime import datetime, timezone
from sqlalchemy import text

from .database import transaction
from .adapter import _quote


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid() -> str:
    return uuid.uuid4().hex


class CxcError(Exception):
    """Error de negocio controlado (el endpoint lo traduce a HTTP)."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


async def abonar_pg(*, client_id: str, monto: float, metodo: str, referencia: str,
                    nota: str, user: dict, caja, folio: str) -> dict:
    """Registra un abono FIFO de forma atómica. Devuelve la misma respuesta que
    devolvía el endpoint original."""
    user_id = user.get("id")
    user_name = user.get("name")

    async with transaction() as conn:
        # A) Bloquear al cliente: serializa abonos/cancelaciones simultáneos
        #    sobre el mismo cliente y elimina la condición de carrera del saldo.
        crow = (await conn.execute(
            text(f'SELECT "doc" FROM {_quote("clients")} '
                 'WHERE "id" = CAST(:i AS text) FOR UPDATE'),
            {"i": client_id})).first()
        if crow is None:
            raise CxcError(404, "Cliente no encontrado")
        cli = dict(crow[0])
        saldo_cli = round(float(cli.get("saldo", 0) or 0), 2)
        if saldo_cli <= 0:
            raise CxcError(400, "El cliente no tiene saldo pendiente")
        if monto > saldo_cli + 0.01:
            raise CxcError(400, f"El abono ({monto}) excede el saldo del cliente ({saldo_cli})")

        # B) Ventas a crédito con saldo, de la más antigua a la más nueva (FIFO).
        srows = (await conn.execute(
            text(f'SELECT "id", "doc", "saldo" FROM {_quote("sales")} '
                 "WHERE doc->>'cliente_id' = :c AND doc->>'condicion' = 'credito' "
                 "AND doc->>'estado' = 'confirmada' "
                 "AND COALESCE(CAST(doc->>'saldo' AS numeric), 0) > 0 "
                 "ORDER BY doc->>'fecha' ASC FOR UPDATE"),
            {"c": client_id})).fetchall()

        restante = float(monto)
        aplicaciones = []
        for sid, sdoc, scol in srows:
            if restante <= 0.001:
                break
            sal_doc = round(float((sdoc or {}).get("saldo", 0) or 0), 2)
            aplica = min(restante, sal_doc)
            if aplica <= 0:
                continue
            nuevo = round(sal_doc - aplica, 2)
            await conn.execute(
                text(f'UPDATE {_quote("sales")} SET "saldo" = :ns, '
                     "doc = jsonb_set(doc, '{saldo}', "
                     "CAST(CAST(:ns2 AS numeric) AS text)::jsonb, true) "
                     'WHERE "id" = CAST(:i AS text)'),
                {"ns": nuevo, "ns2": nuevo, "i": sid})
            aplicaciones.append({"sale_id": sid, "folio": (sdoc or {}).get("folio"),
                                 "monto": round(aplica, 2)})
            restante = round(restante - aplica, 2)

        # C) Saldo del cliente: columna tipada y JSONB siempre juntas.
        nuevo_saldo_cli = round(saldo_cli - float(monto), 2)
        await conn.execute(
            text(f'UPDATE {_quote("clients")} SET "saldo" = :ns, '
                 "doc = jsonb_set(doc, '{saldo}', "
                 "CAST(CAST(:ns2 AS numeric) AS text)::jsonb, true) "
                 'WHERE "id" = CAST(:i AS text)'),
            {"ns": nuevo_saldo_cli, "ns2": nuevo_saldo_cli, "i": client_id})

        # D) Registro del abono.
        doc = {"id": uid(), "folio": folio, "cliente_id": client_id,
               "cliente_codigo": cli.get("codigo"), "cliente_nombre": cli.get("nombre"),
               "monto": round(float(monto), 2), "metodo": metodo,
               "referencia": referencia or "", "nota": nota or "", "fecha": now_iso(),
               "saldo_anterior": saldo_cli, "saldo_restante": nuevo_saldo_cli,
               "aplicaciones": aplicaciones, "usuario_id": user_id,
               "usuario_nombre": user_name,
               "caja_id": caja["id"] if caja else None, "estado": "confirmado"}
        await conn.execute(
            text(f'INSERT INTO {_quote("abonos")} '
                 '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
            {"k": doc["id"], "d": json.dumps(doc, ensure_ascii=False, default=str)})

        # E) Caja (efectivo entra).
        if caja and metodo == "efectivo":
            cm = {"id": uid(), "caja_id": caja["id"], "tipo": "entrada",
                  "concepto": f"Abono {folio} · {cli.get('nombre')}",
                  "monto": round(float(monto), 2), "referencia": folio,
                  "usuario_id": user_id, "usuario_nombre": user_name, "fecha": now_iso()}
            await conn.execute(
                text(f'INSERT INTO {_quote("caja_movimientos")} '
                     '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
                {"k": cm["id"], "d": json.dumps(cm, ensure_ascii=False, default=str)})

        # F) Auditoría (se confirma con la transacción).
        audit = {"id": uid(), "usuario_id": user_id, "usuario_nombre": user_name,
                 "accion": "abono", "entidad": "cliente", "registro_id": client_id,
                 "detalle": f"{folio} monto {monto} metodo {metodo}", "fecha": now_iso()}
        await conn.execute(
            text(f'INSERT INTO {_quote("audit_logs")} '
                 '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
            {"k": audit["id"], "d": json.dumps(audit, ensure_ascii=False, default=str)})

    return {"ok": True, "folio": folio, "saldo_anterior": saldo_cli,
            "saldo_actual": nuevo_saldo_cli, "aplicaciones": aplicaciones,
            "caja_afectada": bool(caja and metodo == "efectivo"), "abono": doc}


async def cancelar_abono_pg(*, abono_id: str, motivo: str, user: dict) -> dict:
    """Cancela un abono confirmado recomponiendo saldos de forma atómica
    (reversible una sola vez; conserva historial/comprobante)."""
    user_id = user.get("id")
    user_name = user.get("name")

    async with transaction() as conn:
        arow = (await conn.execute(
            text(f'SELECT "doc" FROM {_quote("abonos")} '
                 'WHERE "id" = CAST(:i AS text) FOR UPDATE'),
            {"i": abono_id})).first()
        if arow is None:
            raise CxcError(404, "Abono no encontrado")
        abono = dict(arow[0])
        if abono.get("estado") == "cancelado":
            raise CxcError(409, "El abono ya está cancelado")
        if not abono.get("cliente_id"):
            raise CxcError(400, "El abono no tiene cliente asociado")

        crow = (await conn.execute(
            text(f'SELECT "doc" FROM {_quote("clients")} '
                 'WHERE "id" = CAST(:i AS text) FOR UPDATE'),
            {"i": abono["cliente_id"]})).first()
        if crow is None:
            raise CxcError(404, "Cliente no encontrado")
        cli = dict(crow[0])

        monto = round(float(abono.get("monto", 0) or 0), 2)

        # A) Revertir aplicaciones: sumar de vuelta el saldo a cada venta.
        for ap in abono.get("aplicaciones", []):
            vrow = (await conn.execute(
                text(f'SELECT "doc" FROM {_quote("sales")} '
                     'WHERE "id" = CAST(:i AS text) FOR UPDATE'),
                {"i": ap.get("sale_id")})).first()
            if vrow is None:
                continue
            sale = dict(vrow[0])
            sal = float(sale.get("saldo", 0) or 0)
            nuevo = round(sal + float(ap.get("monto", 0) or 0), 2)
            await conn.execute(
                text(f'UPDATE {_quote("sales")} SET "saldo" = :ns, '
                     "doc = jsonb_set(doc, '{saldo}', "
                     "CAST(CAST(:ns2 AS numeric) AS text)::jsonb, true) "
                     'WHERE "id" = CAST(:i AS text)'),
                {"ns": nuevo, "ns2": nuevo, "i": ap.get("sale_id")})

        # B) Recomponer saldo del cliente.
        nuevo_saldo = round(float(cli.get("saldo", 0) or 0) + monto, 2)
        await conn.execute(
            text(f'UPDATE {_quote("clients")} SET "saldo" = :ns, '
                 "doc = jsonb_set(doc, '{saldo}', "
                 "CAST(CAST(:ns2 AS numeric) AS text)::jsonb, true) "
                 'WHERE "id" = CAST(:i AS text)'),
            {"ns": nuevo_saldo, "ns2": nuevo_saldo, "i": abono["cliente_id"]})

        # C) Caja: si el abono fue efectivo, revertirlo (retiro).
        if abono.get("caja_id"):
            cm = {"id": uid(), "caja_id": abono["caja_id"], "tipo": "retiro",
                  "concepto": f"Cancelación abono {abono.get('folio')}", "monto": monto,
                  "referencia": abono.get("folio"), "usuario_id": user_id,
                  "usuario_nombre": user_name, "fecha": now_iso()}
            await conn.execute(
                text(f'INSERT INTO {_quote("caja_movimientos")} '
                     '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
                {"k": cm["id"], "d": json.dumps(cm, ensure_ascii=False, default=str)})

        # D) Marcar cancelado (conservando comprobante/historial original).
        await conn.execute(
            text(f'UPDATE {_quote("abonos")} SET '
                 "doc = jsonb_set(doc, '{estado}', CAST(:est AS jsonb), true) || "
                 "jsonb_build_object('cancelacion', CAST(:canc AS jsonb)) "
                 'WHERE "id" = CAST(:i AS text)'),
            {"est": json.dumps("cancelado"),
             "canc": json.dumps({"usuario": user_name, "usuario_id": user_id,
                                 "fecha": now_iso(), "motivo": motivo},
                                ensure_ascii=False, default=str),
             "i": abono_id})

        # E) Auditoría.
        audit = {"id": uid(), "usuario_id": user_id, "usuario_nombre": user_name,
                 "accion": "abono_cancelar", "entidad": "abono", "registro_id": abono_id,
                 "detalle": f"{abono.get('folio')} monto {monto} motivo {motivo}",
                 "fecha": now_iso()}
        await conn.execute(
            text(f'INSERT INTO {_quote("audit_logs")} '
                 '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
            {"k": audit["id"], "d": json.dumps(audit, ensure_ascii=False, default=str)})

    return {"ok": True, "folio": abono.get("folio"), "saldo_recompuesto": nuevo_saldo}


# --------------------------------------------------------------------------- #
# Cargos por interés moratorio                                                #
#                                                                             #
# El interés se aplica SOBRE los tickets VENCIDOS (fecha + dias_credito <      #
# hoy) con saldo pendiente. Por cada venta:                                   #
#     base    = saldo actual − interés ya acumulado (interes_acumulado)       #
#     interés = base · (tasa_pct/100) · (dias_vencido/30)   [tasa MENSUAL]    #
# El interés se suma al saldo de la venta y al saldo del cliente; queda       #
# registrado en cxc_cargos (reversible una sola vez) y en audit_logs. Los     #
# abonos FIFO posteriores lo liquidan como parte de la deuda.                 #
# --------------------------------------------------------------------------- #

def _dias_vencido_de(fecha_iso: str, dias_credito: int, hoy) -> int:
    try:
        f = datetime.fromisoformat((fecha_iso or "")[:10]).date()
    except (ValueError, TypeError):
        return 0
    return (hoy - f).days - int(dias_credito or 0)


async def aplicar_interes_pg(*, client_id: str, tasa_pct: float, nota: str,
                             user: dict, sale_ids=None, dias=None,
                             calculo: str = "moratorio") -> dict:
    """Aplica interés moratorio ATÓMICAMENTE (cliente y ventas bloqueados con
    FOR UPDATE). Dos modos:
      · por cliente (default): todas las ventas a crédito VENCIDAS con saldo.
      · por selección (sale_ids): documentos específicos (legacy o nuevos,
        uno o varios tickets); `dias` permite cobrar días explícitos aunque
        el documento no esté vencido aún.
    Dos cálculos:
      · moratorio (default): base · tasa% · (días/30), prorrateo mensual.
      · inmediato: base · tasa% una sola vez, sin prorrateo por días."""
    user_id = user.get("id")
    user_name = user.get("name")
    hoy = datetime.now(timezone.utc).date()
    manual = bool(sale_ids)
    calculo = calculo if calculo in ("moratorio", "inmediato") else "moratorio"

    async with transaction() as conn:
        crow = (await conn.execute(
            text(f'SELECT "doc" FROM {_quote("clients")} '
                 'WHERE "id" = CAST(:i AS text) FOR UPDATE'),
            {"i": client_id})).first()
        if crow is None:
            raise CxcError(404, "Cliente no encontrado")
        cli = dict(crow[0])
        saldo_cli = round(float(cli.get("saldo", 0) or 0), 2)
        if saldo_cli <= 0:
            raise CxcError(400, "El cliente no tiene saldo pendiente")
        dias_credito = int(cli.get("dias_credito", 0) or 0)

        omitidos = 0
        if manual:
            ids = [str(x) for x in sale_ids][:500]
            if not ids:
                raise CxcError(400, "No se seleccionaron documentos")
            srows = (await conn.execute(
                text(f'SELECT "id", "doc", "saldo" FROM {_quote("sales")} '
                     'WHERE "id" = ANY(CAST(:ids AS text[])) '
                     "AND doc->>'cliente_id' = :c "
                     "AND doc->>'estado' = 'confirmada' "
                     "AND COALESCE(CAST(doc->>'saldo' AS numeric), 0) > 0 "
                     "ORDER BY doc->>'fecha' ASC FOR UPDATE"),
                {"ids": ids, "c": client_id})).fetchall()
            encontrados = {r[0] for r in srows}
            # Los documentos seleccionados sin saldo (pagados) o inexistentes
            # simplemente NO se cobran; no bloquean el resto de la selección.
            omitidos = len([i for i in ids if i not in encontrados])
        else:
            srows = (await conn.execute(
                text(f'SELECT "id", "doc", "saldo" FROM {_quote("sales")} '
                     "WHERE doc->>'cliente_id' = :c AND doc->>'condicion' = 'credito' "
                     "AND doc->>'estado' = 'confirmada' "
                     "AND COALESCE(CAST(doc->>'saldo' AS numeric), 0) > 0 "
                     "ORDER BY doc->>'fecha' ASC FOR UPDATE"),
                {"c": client_id})).fetchall()

        detalle = []
        total_interes = 0.0
        for sid, sdoc, scol in srows:
            sdoc = sdoc or {}
            dv = int(dias) if dias is not None else _dias_vencido_de(sdoc.get("fecha"), dias_credito, hoy)
            if calculo == "moratorio":
                if not manual and dv <= 0:
                    continue
                if manual and dias is None and dv <= 0:
                    # Documento seleccionado aún no vencido sin días explícitos:
                    # nada que cobrar.
                    continue
            sal_doc = round(float(sdoc.get("saldo", 0) or 0), 2)
            acumulado = round(float(sdoc.get("interes_acumulado", 0) or 0), 2)
            base = round(sal_doc - acumulado, 2)
            if base <= 0:
                continue
            if calculo == "inmediato":
                # Cargo inmediato: una sola vez sobre el saldo base.
                interes = round(base * (float(tasa_pct) / 100.0), 2)
                dv = 0
            else:
                interes = round(base * (float(tasa_pct) / 100.0) * (dv / 30.0), 2)
            if interes <= 0.005:
                continue
            nuevo = round(sal_doc + interes, 2)
            nuevo_acum = round(acumulado + interes, 2)
            await conn.execute(
                text(f'UPDATE {_quote("sales")} SET "saldo" = :ns, '
                     "doc = jsonb_set(jsonb_set(doc, '{saldo}', "
                     "CAST(CAST(:ns2 AS numeric) AS text)::jsonb, true), "
                     "'{interes_acumulado}', "
                     "CAST(CAST(:na AS numeric) AS text)::jsonb, true) "
                     'WHERE "id" = CAST(:i AS text)'),
                {"ns": nuevo, "ns2": nuevo, "na": nuevo_acum, "i": sid})
            detalle.append({"sale_id": sid, "folio": sdoc.get("folio"),
                            "fecha": sdoc.get("fecha"),
                            "saldo_base": base, "dias_vencido": dv,
                            "interes": interes})
            total_interes = round(total_interes + interes, 2)

        if not detalle:
            if manual:
                raise CxcError(400, "Ninguno de los documentos seleccionados tiene "
                                    "saldo base para cobrar interés (o el interés "
                                    "calculado es $0.00; en moratorio indica los días "
                                    "o usa el cálculo inmediato)")
            raise CxcError(400, "No hay ventas vencidas a las que aplicar interés "
                                "(o el interés calculado es $0.00)")

        nuevo_saldo_cli = round(saldo_cli + total_interes, 2)
        await conn.execute(
            text(f'UPDATE {_quote("clients")} SET "saldo" = :ns, '
                 "doc = jsonb_set(doc, '{saldo}', "
                 "CAST(CAST(:ns2 AS numeric) AS text)::jsonb, true) "
                 'WHERE "id" = CAST(:i AS text)'),
            {"ns": nuevo_saldo_cli, "ns2": nuevo_saldo_cli, "i": client_id})

        folio = f"INT-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
        doc = {"id": uid(), "folio": folio, "cliente_id": client_id,
               "cliente_codigo": cli.get("codigo"),
               "cliente_nombre": cli.get("nombre"),
               "tasa_pct": round(float(tasa_pct), 4),
               "tipo": "interes_moratorio",
               "modo": "seleccion" if manual else "cliente",
               "calculo": calculo,
               "dias_cobrados": int(dias) if dias is not None else None,
               "total": total_interes,
               "detalle": detalle, "nota": nota or "",
               "fecha": now_iso(),
               "saldo_anterior": saldo_cli,
               "saldo_actual": nuevo_saldo_cli,
               "usuario_id": user_id, "usuario_nombre": user_name,
               "estado": "confirmado"}
        await conn.execute(
            text(f'INSERT INTO {_quote("cxc_cargos")} '
                 '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
            {"k": doc["id"], "d": json.dumps(doc, ensure_ascii=False, default=str)})

        audit = {"id": uid(), "usuario_id": user_id, "usuario_nombre": user_name,
                 "accion": "cxc_interes", "entidad": "cliente",
                 "registro_id": client_id,
                 "detalle": f"{folio} tasa {tasa_pct}% interés ${total_interes:,.2f}",
                 "fecha": now_iso()}
        await conn.execute(
            text(f'INSERT INTO {_quote("audit_logs")} '
                 '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
            {"k": audit["id"], "d": json.dumps(audit, ensure_ascii=False, default=str)})

    return {"ok": True, "folio": folio, "total_interes": total_interes,
            "ventas_afectadas": len(detalle), "detalle": detalle,
            "documentos_omitidos": omitidos,
            "saldo_anterior": saldo_cli, "saldo_actual": nuevo_saldo_cli,
            "cargo": doc}


async def cancelar_cargo_pg(*, cargo_id: str, motivo: str, user: dict) -> dict:
    """Cancela un cargo de interés reversible una sola vez: resta el interés
    de cada venta afectada y del saldo del cliente, con auditoría."""
    user_id = user.get("id")
    user_name = user.get("name")

    async with transaction() as conn:
        grow = (await conn.execute(
            text(f'SELECT "doc" FROM {_quote("cxc_cargos")} '
                 'WHERE "id" = CAST(:i AS text) FOR UPDATE'),
            {"i": cargo_id})).first()
        if grow is None:
            raise CxcError(404, "Cargo no encontrado")
        cargo = dict(grow[0])
        if cargo.get("estado") == "cancelado":
            raise CxcError(409, "El cargo ya está cancelado")
        if not cargo.get("cliente_id"):
            raise CxcError(400, "El cargo no tiene cliente asociado")

        crow = (await conn.execute(
            text(f'SELECT "doc" FROM {_quote("clients")} '
                 'WHERE "id" = CAST(:i AS text) FOR UPDATE'),
            {"i": cargo["cliente_id"]})).first()
        if crow is None:
            raise CxcError(404, "Cliente no encontrado")
        cli = dict(crow[0])

        total = round(float(cargo.get("total", 0) or 0), 2)

        # A) Revertir el interés por venta (saldo y acumulado).
        for ap in cargo.get("detalle", []):
            vrow = (await conn.execute(
                text(f'SELECT "doc" FROM {_quote("sales")} '
                     'WHERE "id" = CAST(:i AS text) FOR UPDATE'),
                {"i": ap.get("sale_id")})).first()
            if vrow is None:
                continue
            sale = dict(vrow[0])
            sal = round(float(sale.get("saldo", 0) or 0), 2)
            acum = round(float(sale.get("interes_acumulado", 0) or 0), 2)
            int_ap = round(float(ap.get("interes", 0) or 0), 2)
            nuevo = round(max(0.0, sal - int_ap), 2)
            nuevo_acum = round(max(0.0, acum - int_ap), 2)
            await conn.execute(
                text(f'UPDATE {_quote("sales")} SET "saldo" = :ns, '
                     "doc = jsonb_set(jsonb_set(doc, '{saldo}', "
                     "CAST(CAST(:ns2 AS numeric) AS text)::jsonb, true), "
                     "'{interes_acumulado}', "
                     "CAST(CAST(:na AS numeric) AS text)::jsonb, true) "
                     'WHERE "id" = CAST(:i AS text)'),
                {"ns": nuevo, "ns2": nuevo, "na": nuevo_acum,
                 "i": ap.get("sale_id")})

        # B) Recomponer saldo del cliente.
        nuevo_saldo = round(float(cli.get("saldo", 0) or 0) - total, 2)
        await conn.execute(
            text(f'UPDATE {_quote("clients")} SET "saldo" = :ns, '
                 "doc = jsonb_set(doc, '{saldo}', "
                 "CAST(CAST(:ns2 AS numeric) AS text)::jsonb, true) "
                 'WHERE "id" = CAST(:i AS text)'),
            {"ns": nuevo_saldo, "ns2": nuevo_saldo, "i": cargo["cliente_id"]})

        # C) Marcar cancelado.
        await conn.execute(
            text(f'UPDATE {_quote("cxc_cargos")} SET '
                 "doc = jsonb_set(doc, '{estado}', CAST(:est AS jsonb), true) || "
                 "jsonb_build_object('cancelacion', CAST(:canc AS jsonb)) "
                 'WHERE "id" = CAST(:i AS text)'),
            {"est": json.dumps("cancelado"),
             "canc": json.dumps({"usuario": user_name, "usuario_id": user_id,
                                 "fecha": now_iso(), "motivo": motivo},
                                ensure_ascii=False, default=str),
             "i": cargo_id})

        audit = {"id": uid(), "usuario_id": user_id, "usuario_nombre": user_name,
                 "accion": "cxc_cargo_cancelar", "entidad": "cxc_cargo",
                 "registro_id": cargo_id,
                 "detalle": f"{cargo.get('folio')} ${total:,.2f} motivo {motivo}",
                 "fecha": now_iso()}
        await conn.execute(
            text(f'INSERT INTO {_quote("audit_logs")} '
                 '("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
            {"k": audit["id"], "d": json.dumps(audit, ensure_ascii=False, default=str)})

    return {"ok": True, "folio": cargo.get("folio"),
            "interes_revertido": total, "saldo_actual": nuevo_saldo}


async def recalcular_saldos_cxc(conn, client_ids: list[str] | None = None) -> dict:
    """Recalcula los saldos de ventas y clientes de forma exacta e idempotente.

    Garantías operativas (Auditoría Forense CxC & Reemplazo Total ZIP):
    1. Para ventas LEGACY (source == 'LEGACY'):
       - El saldo base deudor proviene de `legacy_cxc_snapshot` (documentos vivos con saldo en FoxPro).
       - Ventas históricas que ya fueron saldadas en FoxPro (legacy_saldo <= 0.01 o no registradas con adeudo)
         tienen saldo = 0.00 inmutable para no inflar compras históricas pagadas como deuda activa.
       - Si una venta legacy tiene adeudo en legacy_cxc_snapshot, se asegura condición='credito' para su
         gestión y abono en CxC.
       - Se restan los abonos registrados en el nuevo ERP (tabla `abonos`) aplicados a dicha venta y se suman
         intereses acumulados.
    2. Para ventas NATIVAS (source != 'LEGACY'):
       - El saldo base es total de la venta a crédito.
       - Se descuentan abonos aplicados en el ERP y se suman intereses acumulados.
    3. Para el saldo del cliente (clients.saldo):
       - Es la deuda viva real del cliente:
         saldo_ventas = suma de sales.saldo para ventas confirmadas de este cliente con saldo > 0.
         saldo_maestro = saldo del maestro legacy (CLIENTES.dbf / legacy_client_balance) menos abonos totales del cliente en el ERP.
         saldo_cliente = max(saldo_ventas, max(0.0, saldo_maestro)).
       - Si el cliente no tiene adeudo en ventas ni en maestro, saldo = $0.00 (nunca revive clientes liquidados).
    """
    # 1. Preload legacy snapshot map (docs with legacy_saldo > 0.01)
    snap_rows = (await conn.execute(text(
        "SELECT legacy_key, legacy_saldo FROM legacy_cxc_snapshot WHERE legacy_saldo > 0.01"
    ))).fetchall()
    legacy_cxc_map = {r[0]: float(r[1]) for r in snap_rows}

    # 2. Preload latest legacy client master balances
    lcb_rows = (await conn.execute(text('''
        SELECT DISTINCT ON (legacy_customer_key) legacy_customer_key, master_saldo 
        FROM legacy_client_balance 
        ORDER BY legacy_customer_key, updated_at DESC
    '''))).fetchall()
    legacy_client_map = {r[0]: float(r[1]) for r in lcb_rows if float(r[1] or 0) > 0.01}

    # 3. Fetch target clients
    if client_ids:
        clis = (await conn.execute(
            text('SELECT "id", "doc", "saldo" FROM clients WHERE "id" = ANY(:cids)'),
            {"cids": client_ids}
        )).fetchall()
    else:
        clis = (await conn.execute(text('SELECT "id", "doc", "saldo" FROM clients'))).fetchall()

    target_cids = [r[0] for r in clis]
    if not target_cids:
        return {"clientes_recalculados": 0, "ventas_recalculadas": 0, "cartera_total": 0.0}

    # 4. Fetch sales in batch for target clients (confirmed sales that are credit, in legacy snapshot, or currently have saldo > 0)
    sales_query = """
        SELECT id, doc->>'cliente_id' as cid, doc->>'source' as src, doc->>'condicion' as cond,
               total, saldo, doc->>'interes_acumulado' as interes, doc
        FROM sales
        WHERE doc->>'cliente_id' = ANY(:cids) AND doc->>'estado' = 'confirmada'
          AND (doc->>'condicion' = 'credito' OR id = ANY(:snap_keys) OR saldo > 0)
    """
    srows = (await conn.execute(
        text(sales_query),
        {"cids": target_cids, "snap_keys": list(legacy_cxc_map.keys())}
    )).fetchall()

    # Group sales by cid
    sales_by_client = {}
    for r in srows:
        sales_by_client.setdefault(r.cid, []).append(r)

    # 5. Fetch active abonos in batch for target clients
    abono_rows = (await conn.execute(
        text("SELECT doc FROM abonos WHERE doc->>'cliente_id' = ANY(:cids) "
             "AND (doc->>'cancelado' IS NULL OR doc->>'cancelado' = 'false')"),
        {"cids": target_cids}
    )).fetchall()

    abonos_by_client = {}
    for r in abono_rows:
        doc = dict(r[0])
        cid = doc.get("cliente_id")
        if cid:
            abonos_by_client.setdefault(cid, []).append(doc)

    recalculados_clientes = 0
    recalculadas_ventas = 0
    total_cartera = 0.0

    sales_updates = []
    client_updates = []

    for cid, cdoc, current_saldo in clis:
        codigo = (cdoc or {}).get("codigo", "")
        client_sales = sales_by_client.get(cid, [])
        client_abonos = abonos_by_client.get(cid, [])

        pagos_por_venta = {}
        total_abonos_cliente = 0.0
        for ab in client_abonos:
            m = float(ab.get("monto", 0.0) or 0.0)
            total_abonos_cliente += m
            for ap in ab.get("aplicaciones", []):
                sid = ap.get("sale_id")
                if sid:
                    pagos_por_venta[sid] = pagos_por_venta.get(sid, 0.0) + float(ap.get("monto", 0.0) or 0.0)

        saldo_sales = 0.0
        for s in client_sales:
            sid = s.id
            sdoc = dict(s.doc)
            is_legacy = s.src == "LEGACY"
            cond = s.cond or "contado"
            pagado = pagos_por_venta.get(sid, 0.0)
            interes = float(s.interes or 0.0)

            if is_legacy:
                base = legacy_cxc_map.get(sid, 0.0)
                if base <= 0.0:
                    nuevo_saldo = 0.0
                else:
                    nuevo_saldo = round(max(0.0, base - pagado + interes), 2)
                    if sdoc.get("condicion") != "credito":
                        sdoc["condicion"] = "credito"
            else:
                if cond != "credito":
                    nuevo_saldo = 0.0
                else:
                    stot = float(s.total or sdoc.get("total", 0) or 0.0)
                    nuevo_saldo = round(max(0.0, stot - pagado + interes), 2)

            curr_s_saldo = float(s.saldo or 0.0)
            needs_update = (abs(nuevo_saldo - curr_s_saldo) > 0.001) or (is_legacy and base > 0.0 and s.cond != "credito")
            if needs_update:
                sdoc["saldo"] = nuevo_saldo
                sales_updates.append({"sid": sid, "ns": nuevo_saldo, "d": json.dumps(sdoc, ensure_ascii=False, default=str)})
                recalculadas_ventas += 1

            if nuevo_saldo > 0.001:
                saldo_sales = round(saldo_sales + nuevo_saldo, 2)

        # Determinar saldo del cliente
        master_base = float(legacy_client_map.get(codigo, 0.0) or (cdoc or {}).get("legacy_master_saldo", 0.0) or 0.0)
        if saldo_sales > 0.001:
            saldo_cliente = max(saldo_sales, round(max(0.0, master_base - total_abonos_cliente), 2))
        elif master_base > 0.001:
            saldo_cliente = round(max(0.0, master_base - total_abonos_cliente), 2)
        else:
            saldo_cliente = 0.0

        curr_c_saldo = float(current_saldo or (cdoc or {}).get("saldo", 0.0) or 0.0)
        if abs(saldo_cliente - curr_c_saldo) > 0.001:
            new_cdoc = dict(cdoc) if cdoc else {}
            new_cdoc["saldo"] = saldo_cliente
            client_updates.append({"cid": cid, "sc": saldo_cliente, "d": json.dumps(new_cdoc, ensure_ascii=False, default=str)})
            recalculados_clientes += 1

        total_cartera = round(total_cartera + saldo_cliente, 2)

    # Batch updates for sales (chunks of 500)
    for i in range(0, len(sales_updates), 500):
        chunk = sales_updates[i:i + 500]
        for item in chunk:
            await conn.execute(
                text('UPDATE sales SET "saldo" = :ns, doc = CAST(:d AS jsonb) WHERE "id" = CAST(:sid AS text)'),
                item
            )

    # Batch updates for clients (chunks of 500)
    for i in range(0, len(client_updates), 500):
        chunk = client_updates[i:i + 500]
        for item in chunk:
            await conn.execute(
                text('UPDATE clients SET "saldo" = :sc, doc = CAST(:d AS jsonb) WHERE "id" = CAST(:cid AS text)'),
                item
            )

    return {
        "clientes_recalculados": recalculados_clientes,
        "ventas_recalculadas": recalculadas_ventas,
        "cartera_total": total_cartera
    }