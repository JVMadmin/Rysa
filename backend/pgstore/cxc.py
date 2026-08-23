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