"""Tests del código de autorización y del precio manual autorizado.

Usan una base en memoria (mismo contrato async que pgstore) en lugar de
PostgreSQL, y llaman directo a las funciones de `autorizaciones.py`.

Ejecutar con:  python -m pytest tests/test_codigo_autorizacion.py -v -n 0
"""
from __future__ import annotations

import asyncio
import sys
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException

BASE = Path(__file__).resolve().parent.parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

import autorizaciones as autz  # noqa: E402
from deps import hash_password, now_utc  # noqa: E402

PASSWORD = "Clave_Segura_2026"
_PASSWORD_HASH = hash_password(PASSWORD)  # bcrypt es lento: una sola vez


# ---- Base en memoria ---------------------------------------------------------
class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return self._docs[:n]


def _proyectar(doc, proj):
    d = dict(doc)
    for k, v in (proj or {}).items():
        if v == 0:
            d.pop(k, None)
    incluir = [k for k, v in (proj or {}).items() if v == 1]
    if incluir:
        d = {k: d[k] for k in incluir if k in d}
    return d


class _Coleccion:
    def __init__(self):
        self.docs = {}

    def _key(self, doc):
        return doc.get("_id") or doc.get("id")

    def _match(self, doc, flt):
        return all(doc.get(k) == v for k, v in (flt or {}).items())

    async def find_one(self, flt=None, proj=None):
        for d in self.docs.values():
            if self._match(d, flt):
                return _proyectar(d, proj)
        return None

    def find(self, flt=None, proj=None):
        return _Cursor([_proyectar(d, proj) for d in self.docs.values() if self._match(d, flt)])

    async def insert_one(self, doc):
        self.docs[self._key(doc)] = dict(doc)

    async def update_one(self, flt, update, upsert=False):
        for k, d in self.docs.items():
            if self._match(d, flt):
                d.update(update.get("$set", {}))
                return 1
        if upsert:
            nuevo = {**flt, **update.get("$set", {})}
            self.docs[self._key(nuevo)] = nuevo
        return 0

    async def delete_one(self, flt):
        for k, d in list(self.docs.items()):
            if self._match(d, flt):
                del self.docs[k]
                return


class _DB:
    def __init__(self):
        self.users = _Coleccion()
        self.products = _Coleccion()
        self.codigos_autorizacion = _Coleccion()
        self.autorizaciones = _Coleccion()
        self.login_attempts = _Coleccion()


def _usuario(uid, role, modulos=None, active=True):
    return {"id": uid, "name": uid.capitalize() + " Prueba", "email": f"{uid}@rysa.test",
            "role": role, "modulos": modulos or [], "active": active,
            "password_hash": _PASSWORD_HASH}


@pytest.fixture
def db(monkeypatch):
    fake = _DB()
    for u in (_usuario("dueno", "admin_propietario"),
              _usuario("encargada", "encargado", ["autorizaciones"]),
              _usuario("cajero", "cajero"),
              _usuario("vendedor", "vendedor")):
        fake.users.docs[u["id"]] = u
    fake.products.docs["p1"] = {"id": "p1", "codigo": "VASO-8", "descripcion": "Vaso 8 oz", "estado": "activo"}
    fake.products.docs["p2"] = {"id": "p2", "codigo": "TAPA-8", "descripcion": "Tapa 8 oz", "estado": "activo"}
    auditoria = []

    async def _log(usuario, accion, entidad, registro_id="", detalle="", **_):
        auditoria.append((usuario.get("id"), accion, detalle))

    monkeypatch.setattr(autz, "db", fake)
    monkeypatch.setattr(autz, "log_audit", _log)
    fake.auditoria = auditoria
    return fake


def run(coro):
    return asyncio.run(coro)


def sesion(db, uid):
    """Usuario como lo entrega get_current_user (sin password_hash)."""
    u = dict(db.users.docs[uid])
    u.pop("password_hash")
    return u


def definir_codigo(db, uid, codigo):
    return run(autz.guardar_codigo(autz.CodigoInput(codigo=codigo, password=PASSWORD), sesion(db, uid)))


def pedir(db, uid, codigo, precio=86.2069, product_id="p1"):
    return run(autz.autorizar(autz.AutorizacionInput(codigo=codigo, product_id=product_id, precio=precio,
                                                     precio_anterior=100.0), sesion(db, uid)))


def error(fn):
    with pytest.raises(HTTPException) as e:
        fn()
    return e.value.status_code, e.value.detail


# ---- Código en Mi cuenta -----------------------------------------------------
class TestCodigo:
    def test_codigos_triviales(self):
        for c in ("000000", "111111", "123456", "456789", "987654", "543210"):
            assert autz.codigo_trivial(c), c
        for c in ("482915", "120934", "908172"):
            assert not autz.codigo_trivial(c), c

    def test_guarda_hash_y_no_el_codigo(self, db):
        definir_codigo(db, "encargada", "482915")
        doc = db.codigos_autorizacion.docs["encargada"]
        assert "482915" not in str(doc)
        assert autz._coincide("482915", doc["hash"])
        estado = run(autz.estado_codigo(sesion(db, "encargada")))
        assert estado["configurado"] and estado["puede_autorizar"] and not estado["precio_manual_directo"]

    def test_estado_de_admin_y_de_cajero(self, db):
        assert run(autz.estado_codigo(sesion(db, "dueno")))["precio_manual_directo"]
        estado = run(autz.estado_codigo(sesion(db, "cajero")))
        assert not estado["puede_autorizar"] and not estado["configurado"]

    def test_rechaza_contrasena_incorrecta(self, db):
        status, _ = error(lambda: run(autz.guardar_codigo(
            autz.CodigoInput(codigo="482915", password="otra"), sesion(db, "encargada"))))
        assert status == 400
        assert not db.codigos_autorizacion.docs

    def test_rechaza_codigo_trivial_o_no_numerico(self, db):
        assert error(lambda: definir_codigo(db, "encargada", "123456"))[0] == 400
        assert error(lambda: definir_codigo(db, "encargada", "12a456"))[0] == 400

    def test_codigos_unicos(self, db):
        definir_codigo(db, "dueno", "482915")
        status, detalle = error(lambda: definir_codigo(db, "encargada", "482915"))
        assert status == 400 and "disponible" in detalle
        # Volver a guardar el propio código sí se permite.
        definir_codigo(db, "dueno", "482915")

    def test_cambiar_y_quitar(self, db):
        definir_codigo(db, "encargada", "482915")
        definir_codigo(db, "encargada", "730418")
        assert autz._coincide("730418", db.codigos_autorizacion.docs["encargada"]["hash"])
        run(autz.borrar_codigo(sesion(db, "encargada")))
        assert not db.codigos_autorizacion.docs


# ---- Autorizar con código ----------------------------------------------------
class TestAutorizar:
    def test_codigo_correcto_emite_autorizacion(self, db):
        definir_codigo(db, "encargada", "482915")
        r = pedir(db, "cajero", "482915")
        assert r["autorizador_nombre"] == "Encargada Prueba"
        a = db.autorizaciones.docs[r["id"]]
        assert a["solicitante_id"] == "cajero" and a["autorizador_id"] == "encargada"
        assert a["product_id"] == "p1" and a["precio"] == 86.2069 and a["usado"] is False
        assert ("encargada", "AUTORIZACION_OTORGADA") in [(u, ac) for u, ac, _ in db.auditoria]

    def test_codigo_incorrecto(self, db):
        definir_codigo(db, "encargada", "482915")
        assert error(lambda: pedir(db, "cajero", "482916")) == (403, "Código de autorización incorrecto")
        assert not db.autorizaciones.docs
        assert ("cajero", "AUTORIZACION_RECHAZADA") in [(u, ac) for u, ac, _ in db.auditoria]

    def test_bloqueo_tras_varios_fallos(self, db):
        definir_codigo(db, "encargada", "482915")
        for _ in range(autz.MAX_FALLOS):
            assert error(lambda: pedir(db, "cajero", "000001"))[0] == 403
        # Bloqueado: ni el código correcto pasa hasta que venza el bloqueo.
        assert error(lambda: pedir(db, "cajero", "482915"))[0] == 429
        # Otro cajero no queda bloqueado.
        assert pedir(db, "vendedor", "482915")["id"]

    def test_sin_permiso_o_inactivo_no_autoriza(self, db):
        definir_codigo(db, "encargada", "482915")
        db.users.docs["encargada"]["modulos"] = []          # le quitaron el módulo
        assert error(lambda: pedir(db, "cajero", "482915"))[0] == 403
        db.users.docs["encargada"]["modulos"] = ["autorizaciones"]
        db.users.docs["encargada"]["active"] = False        # usuario desactivado
        assert error(lambda: pedir(db, "cajero", "482915"))[0] == 403

    def test_quien_autoriza_puede_usar_su_propio_codigo(self, db):
        definir_codigo(db, "encargada", "482915")
        assert pedir(db, "encargada", "482915")["autorizador_nombre"] == "Encargada Prueba"

    def test_cajero_no_puede_definir_codigo(self, db):
        # La ruta exige autorizacion.otorgar; aquí se comprueba el permiso efectivo.
        assert not autz.user_has_permission(sesion(db, "cajero"), autz.PERM_OTORGAR)
        assert autz.user_has_permission(sesion(db, "encargada"), autz.PERM_OTORGAR)
        assert autz.user_has_permission(sesion(db, "dueno"), autz.PERM_OTORGAR)


# ---- Venta con precio manual -------------------------------------------------
def linea(precio=86.2069, product_id="p1", manual=True, autorizacion_id=None, codigo="VASO-8"):
    return {"product_id": product_id, "codigo": codigo, "precio": precio,
            "precio_manual": manual, "autorizacion_id": autorizacion_id}


class TestVenta:
    def test_admin_no_necesita_autorizacion(self, db):
        items = [linea()]
        assert run(autz.validar_precios_manuales(sesion(db, "dueno"), items)) == []
        assert items[0]["precio_manual"] and items[0]["autorizado_por_id"] == "dueno"

    def test_sin_autorizacion_se_rechaza(self, db):
        assert error(lambda: run(autz.validar_precios_manuales(sesion(db, "cajero"), [linea()])))[0] == 403

    def test_lineas_normales_no_cambian(self, db):
        items = [linea(manual=False, autorizacion_id="cualquiera")]
        assert run(autz.validar_precios_manuales(sesion(db, "cajero"), items)) == []
        assert "precio_manual" not in items[0] and "autorizacion_id" not in items[0]

    def test_autorizacion_valida_se_consume(self, db):
        definir_codigo(db, "encargada", "482915")
        aid = pedir(db, "cajero", "482915")["id"]
        items = [linea(autorizacion_id=aid)]
        usadas = run(autz.validar_precios_manuales(sesion(db, "cajero"), items))
        assert usadas == [aid] and items[0]["autorizado_por_nombre"] == "Encargada Prueba"
        run(autz.registrar_precios_manuales(sesion(db, "cajero"), {"id": "v1", "folio": "V000123"}, items, usadas))
        a = db.autorizaciones.docs[aid]
        assert a["usado"] is True and a["venta_folio"] == "V000123"
        assert ("cajero", "PRECIO_MANUAL") in [(u, ac) for u, ac, _ in db.auditoria]
        # No se puede reutilizar en otra venta.
        assert error(lambda: run(autz.validar_precios_manuales(
            sesion(db, "cajero"), [linea(autorizacion_id=aid)])))[0] == 409

    def test_precio_distinto_al_autorizado(self, db):
        definir_codigo(db, "encargada", "482915")
        aid = pedir(db, "cajero", "482915", precio=86.2069)["id"]
        assert error(lambda: run(autz.validar_precios_manuales(
            sesion(db, "cajero"), [linea(precio=50.0, autorizacion_id=aid)])))[0] == 403

    def test_autorizacion_de_otro_usuario_o_producto(self, db):
        definir_codigo(db, "encargada", "482915")
        aid = pedir(db, "vendedor", "482915")["id"]
        assert error(lambda: run(autz.validar_precios_manuales(
            sesion(db, "cajero"), [linea(autorizacion_id=aid)])))[0] == 403
        assert error(lambda: run(autz.validar_precios_manuales(
            sesion(db, "vendedor"), [linea(product_id="p2", codigo="TAPA-8", autorizacion_id=aid)])))[0] == 403

    def test_autorizacion_vencida(self, db):
        definir_codigo(db, "encargada", "482915")
        aid = pedir(db, "cajero", "482915")["id"]
        db.autorizaciones.docs[aid]["expira"] = (now_utc() - timedelta(minutes=1)).isoformat()
        assert error(lambda: run(autz.validar_precios_manuales(
            sesion(db, "cajero"), [linea(autorizacion_id=aid)])))[0] == 409
