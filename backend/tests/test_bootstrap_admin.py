"""Tests del bootstrap admin — verificar el contrato:

  * BD vacía: crea admin usando ADMIN_EMAIL/ADMIN_PASSWORD (en doc JSONB).
  * Reinicio: NO sobrescribe al admin existente.
  * Cambio de ADMIN_PASSWORD en env: NO afecta al admin existente.
  * En producción, no crea admin nuevo si ya hay otros admins y el email no existe.
  * Idempotente en todos los caminos.

Estos tests mockean `pgstore.PGDatabase` y `pgstore.adapter` (el adapter que
el script importa y usa), no la capa SQL. No requieren PostgreSQL.

Ejecutar con:  python -m pytest backend/tests/test_bootstrap_admin.py -v
"""
from __future__ import annotations
import os
import sys
import importlib
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

BASE = Path(__file__).resolve().parent.parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

import pytest


# ---- Fake del adapter de pgstore.users ---------------------------------------


class _FakeUsers:
    """Sustituye a `db.users` con el mismo contrato que usa bootstrap_admin.

    Mantiene un dict de documentos en memoria y expone find_one, insert_one
    y count_documents como coroutines, igual que el adapter real."""

    def __init__(self, docs: dict | None = None):
        self._docs = docs or {}
        self.inserted: list[dict] = []
        self._async_fns = self._build_async_fns()

    def _build_async_fns(self):
        return {
            "find_one": self._find_one,
            "insert_one": self._insert_one,
            "count_documents": self._count_documents,
        }

    async def _find_one(self, flt):
        for d in self._docs.values():
            if all(d.get(k) == v for k, v in flt.items()):
                return dict(d)
        return None

    async def _insert_one(self, doc):
        key = doc.get("id") or doc.get("email")
        self._docs[key] = dict(doc)
        self.inserted.append(dict(doc))
        return None

    async def _count_documents(self, flt):
        # Soporta {"role": {"$regex": "^admin"}}
        import re
        cnt = 0
        for d in self._docs.values():
            match = True
            for k, v in flt.items():
                val = d.get(k)
                if isinstance(v, dict) and "$regex" in v:
                    if not re.search(v["$regex"], str(val or "")):
                        match = False
                        break
                elif val != v:
                    match = False
                    break
            if match:
                cnt += 1
        return cnt

    # Hace que find_one/insert_one/count_documents sean coroutines awaitable
    def __getattr__(self, name):
        if name in self._async_fns:
            async def _coro(*args, **kwargs):
                return await self._async_fns[name](*args, **kwargs)
            return _coro
        raise AttributeError(name)


class _FakeDB:
    def __init__(self, docs):
        self.users = _FakeUsers(docs)


@pytest.fixture
def fresh_module(monkeypatch):
    """Recarga el módulo para leer variables de entorno frescas."""
    def _load(env):
        for k in ("ADMIN_EMAIL", "ADMIN_PASSWORD", "ADMIN_NAME", "ENVIRONMENT", "DATABASE_URL"):
            monkeypatch.delenv(k, raising=False)
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        if "scripts.bootstrap_admin" in sys.modules:
            del sys.modules["scripts.bootstrap_admin"]
        if "scripts" in sys.modules:
            del sys.modules["scripts"]
        return importlib.import_module("scripts.bootstrap_admin")
    return _load


def _empty_db() -> _FakeDB:
    return _FakeDB({})


def _admin_doc(email="admin@gruporysa.com", role="admin_propietario", active=True, pw_hash="HASH_ORIGINAL"):
    return {
        "id": "u1",
        "email": email,
        "name": "Admin",
        "role": role,
        "active": active,
        "password_hash": pw_hash,
        "token_version": 0,
        "source": "manual",
        "created_at": "2026-01-01T00:00:00Z",
    }


# ---- Tests -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_first_run_creates_admin(fresh_module):
    """BD vacía: el admin no existe, debe crearse con ADMIN_PASSWORD.
    Verifica que el documento creado tiene todos los campos en `doc`."""
    db = _empty_db()
    mod = fresh_module({
        "ADMIN_EMAIL": "admin@gruporysa.com",
        "ADMIN_PASSWORD": "PasswordInicialDev2026!",
        "ENVIRONMENT": "development",
    })
    bcrypt = pytest.importorskip("bcrypt")
    with patch.object(mod, "pgstore", MagicMock(PGDatabase=lambda: db)):
        rc = await mod.main()
    assert rc == 0
    assert len(db.users.inserted) == 1
    admin = db.users.inserted[0]
    assert admin["email"] == "admin@gruporysa.com"
    assert admin["role"] == "admin_propietario"
    assert admin["active"] is True
    assert admin["token_version"] == 0
    assert admin["source"] == "bootstrap"
    # password_hash es bcrypt de "PasswordInicialDev2026!"
    assert admin["password_hash"] != "PasswordInicialDev2026!"
    assert bcrypt.checkpw(b"PasswordInicialDev2026!", admin["password_hash"].encode("utf-8"))


@pytest.mark.asyncio
async def test_restart_does_not_modify_existing_admin(fresh_module):
    """Re-arranque: NO debe hacer UPDATE ni tocar el password_hash existente."""
    db = _FakeDB({"u1": _admin_doc(pw_hash="HASH_ORIGINAL_EN_BD")})
    mod = fresh_module({
        "ADMIN_EMAIL": "admin@gruporysa.com",
        "ADMIN_PASSWORD": "PasswordNuevoEnEnv2026!",
        "ENVIRONMENT": "production",
    })
    with patch.object(mod, "pgstore", MagicMock(PGDatabase=lambda: db)):
        rc = await mod.main()
    assert rc == 0
    assert len(db.users.inserted) == 0
    # El password_hash sigue siendo el original
    assert db.users._docs["u1"]["password_hash"] == "HASH_ORIGINAL_EN_BD"
    assert db.users._docs["u1"]["role"] == "admin_propietario"
    assert db.users._docs["u1"]["token_version"] == 0


@pytest.mark.asyncio
async def test_no_admin_email_no_bootstrap(fresh_module):
    """Sin ADMIN_EMAIL/ADMIN_PASSWORD: no tocar nada, exit 0."""
    db = _empty_db()
    mod = fresh_module({})
    with patch.object(mod, "pgstore", MagicMock(PGDatabase=lambda: db)):
        rc = await mod.main()
    assert rc == 0
    assert len(db.users.inserted) == 0


@pytest.mark.asyncio
async def test_short_password_skipped(fresh_module):
    """Password < 12 chars: no hacer nada (ni crear, ni tocar)."""
    db = _empty_db()
    mod = fresh_module({
        "ADMIN_EMAIL": "admin@gruporysa.com",
        "ADMIN_PASSWORD": "corto",
        "ENVIRONMENT": "production",
    })
    with patch.object(mod, "pgstore", MagicMock(PGDatabase=lambda: db)):
        rc = await mod.main()
    assert rc == 0
    assert len(db.users.inserted) == 0


@pytest.mark.asyncio
async def test_emergency_recreate_when_no_admins(fresh_module):
    """BD sin admins y ADMIN_EMAIL/ADMIN_PASSWORD definidos: crea uno de emergencia."""
    db = _FakeDB({"x": {"id": "x", "email": "x@x", "role": "vendedor", "active": True}})
    mod = fresh_module({
        "ADMIN_EMAIL": "recovery@gruporysa.com",
        "ADMIN_PASSWORD": "PasswordDeEmergencia2026!",
        "ENVIRONMENT": "production",
    })
    with patch.object(mod, "pgstore", MagicMock(PGDatabase=lambda: db)):
        rc = await mod.main()
    assert rc == 0
    assert len(db.users.inserted) == 1
    assert db.users.inserted[0]["role"] == "admin_propietario"


@pytest.mark.asyncio
async def test_existing_admin_in_production_with_other_admins(fresh_module):
    """Producción: el email no existe pero hay otros admins, no crea uno nuevo."""
    db = _FakeDB({"otro": _admin_doc(email="otro@x", role="admin")})
    mod = fresh_module({
        "ADMIN_EMAIL": "nuevo@gruporysa.com",
        "ADMIN_PASSWORD": "PasswordInicialDev2026!",
        "ENVIRONMENT": "production",
    })
    with patch.object(mod, "pgstore", MagicMock(PGDatabase=lambda: db)):
        rc = await mod.main()
    assert rc == 0
    assert len(db.users.inserted) == 0


@pytest.mark.asyncio
async def test_admin_in_development_with_other_admins_can_be_created(fresh_module):
    """Development: aunque haya otros admins, crea el del ADMIN_EMAIL si no existe."""
    db = _FakeDB({"otro": _admin_doc(email="otro@x", role="admin")})
    mod = fresh_module({
        "ADMIN_EMAIL": "nuevo@rysa-dev.local",
        "ADMIN_PASSWORD": "PasswordInicialDev2026!",
        "ENVIRONMENT": "development",
    })
    with patch.object(mod, "pgstore", MagicMock(PGDatabase=lambda: db)):
        rc = await mod.main()
    assert rc == 0
    assert len(db.users.inserted) == 1


@pytest.mark.asyncio
async def test_data_is_in_doc_not_in_sql_columns(fresh_module):
    """Contrato arquitectónico: el admin se almacena SOLO en doc JSONB.

    El adapter de pgstore.users solo escribe en la columna `doc` (el schema
    no tiene columnas role/active/email a nivel SQL). Este test verifica
    que el documento creado tiene todos los campos como claves de un dict
    (no propiedades de un objeto con tipado SQL)."""
    db = _empty_db()
    mod = fresh_module({
        "ADMIN_EMAIL": "admin@rysa-dev.local",
        "ADMIN_PASSWORD": "PasswordInicialDev2026!",
        "ENVIRONMENT": "development",
    })
    with patch.object(mod, "pgstore", MagicMock(PGDatabase=lambda: db)):
        await mod.main()
    admin = db.users.inserted[0]
    # El documento es un dict plano (lo que se serializa al JSONB `doc`).
    assert isinstance(admin, dict)
    # Todos los campos están como keys de primer nivel, no como atributos
    # de una clase SQL.
    for required_key in ("id", "email", "name", "role", "active",
                         "password_hash", "token_version", "source", "created_at"):
        assert required_key in admin, f"Falta {required_key} en el documento del admin"
    # Y el adapter solo expone insert_one (que serializa a doc).
    # Si en el futuro alguien cambia a SQL crudo, este test fallará.


@pytest.mark.asyncio
async def test_idempotent_repeated_calls(fresh_module):
    """Llamar main() N veces seguidas nunca duplica ni corrompe."""
    db = _empty_db()
    mod = fresh_module({
        "ADMIN_EMAIL": "admin@gruporysa.com",
        "ADMIN_PASSWORD": "PasswordInicialDev2026!",
        "ENVIRONMENT": "development",
    })
    with patch.object(mod, "pgstore", MagicMock(PGDatabase=lambda: db)):
        for _ in range(5):
            rc = await mod.main()
            assert rc == 0
    # Solo 1 inserción total en 5 ejecuciones.
    assert len(db.users.inserted) == 1
