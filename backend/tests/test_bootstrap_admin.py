"""Tests del bootstrap admin — verificar la regla de oro:
  reiniciar el backend no cambia la contraseña del admin existente.

Ejecutar con:  python -m pytest backend/tests/test_bootstrap_admin.py -v
o, dentro del contenedor backend:
  python -m pytest /app/tests/test_bootstrap_admin.py -v
"""
from __future__ import annotations
import os
import sys
import importlib
from unittest.mock import MagicMock, AsyncMock, patch

import pytest


# El test asume que la BD tiene al menos la tabla users con columnas
# (id, email, name, role, password_hash, active, token_version, doc).
# Usamos un fake conn basado en dicts para no necesitar PostgreSQL.


class _FakeRow:
    def __init__(self, *vals): self._v = vals
    def __getitem__(self, i): return self._v[i]
    def __eq__(self, other): return self._v == other


class _FakeConn:
    """Simula conn.execute() con respuestas por query."""
    def __init__(self):
        self.executed = []  # lista de (sql_normalizado, params)

    def _match(self, sql: str):
        s = sql.replace("\n", " ").replace("  ", " ").strip().lower()
        return s

    async def execute(self, sql, params=None):
        self.executed.append((self._match(sql), params or {}))
        s = self._match(sql)
        # SELECT del email
        if "from users where email" in s and "count" not in s:
            email = (params or {}).get("e")
            if self.users.get(email):
                u = self.users[email]
                return self._rows([_FakeRow(u["id"], u["role"], u["active"])])
            return self._rows([])
        # SELECT count admins
        if "count(*)" in s and "admin" in s:
            return self._rows([_FakeRow(len(self._admins))])
        # INSERT admin
        if "insert into users" in s:
            return self._rows([])
        return self._rows([])

    def _rows(self, items):
        r = MagicMock()
        r.first = MagicMock(return_value=items[0] if items else None)
        r.scalar = MagicMock(return_value=items[0][0] if items else None)
        r.fetchall = MagicMock(return_value=items)
        return r


class _FakeConnCtx:
    def __init__(self, conn): self.conn = conn
    async def __aenter__(self): return self.conn
    async def __aexit__(self, *a): return False


class _FakeEngine:
    def __init__(self, conn): self.conn = conn
    def begin(self): return _FakeConnCtx(self.conn)


def _make_users():
    return {
        "admin@gruporysa.com": {
            "id": "u1",
            "email": "admin@gruporysa.com",
            "role": "admin_propietario",
            "active": True,
            "password_hash": "HASH_ORIGINAL_EN_BD",
        }
    }


def _build(conn):
    users = _make_users()
    conn.users = users
    conn.admins = list(users.values())
    eng = _FakeEngine(conn)
    return eng, users


@pytest.fixture
def fresh_module(monkeypatch):
    """Recarga el módulo para leer variables de entorno frescas."""
    def _load(env):
        for k in ("ADMIN_EMAIL", "ADMIN_PASSWORD", "ADMIN_NAME", "ENVIRONMENT"):
            monkeypatch.delenv(k, raising=False)
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        if "bootstrap_admin" in sys.modules:
            del sys.modules["bootstrap_admin"]
        return importlib.import_module("scripts.bootstrap_admin")
    return _load


@pytest.mark.asyncio
async def test_first_run_creates_admin(fresh_module):
    """Primer arranque: el admin no existe, debe crearse con ADMIN_PASSWORD."""
    conn = _FakeConn()
    eng, users = _build(conn)
    bcrypt = pytest.importorskip("bcrypt")
    mod = fresh_module({
        "ADMIN_EMAIL": "admin@gruporysa.com",
        "ADMIN_PASSWORD": "PasswordInicialDev2026!",
        "ENVIRONMENT": "development",
    })
    with patch.object(mod, "get_engine", return_value=eng):
        rc = await mod.main()
    assert rc == 0
    # Hubo un INSERT (no UPDATE)
    inserts = [q for q, _ in conn.executed if "insert into users" in q]
    assert len(inserts) == 1


@pytest.mark.asyncio
async def test_restart_does_not_modify_existing_admin(fresh_module):
    """RE-ARRANQUE con admin existente: NO debe hacer UPDATE de password.

    El usuario pudo haber cambiado la contraseña en la UI. El bootstrap
    debe respetarla.
    """
    conn = _FakeConn()
    eng, users = _build(conn)
    mod = fresh_module({
        "ADMIN_EMAIL": "admin@gruporysa.com",
        "ADMIN_PASSWORD": "PasswordCambiadoPorElUsuario2026!",
        "ENVIRONMENT": "production",
    })
    with patch.object(mod, "get_engine", return_value=eng):
        rc = await mod.main()
    assert rc == 0
    # No debe haber NINGÚN update ni insert del admin existente
    inserts = [q for q, _ in conn.executed if "insert into users" in q]
    updates = [q for q, _ in conn.executed if "update users" in q]
    assert inserts == [], f"No debe insertar cuando el admin ya existe: {inserts}"
    assert updates == [], f"No debe actualizar al admin existente: {updates}"
    # El hash en memoria sigue siendo el original
    assert users["admin@gruporysa.com"]["password_hash"] == "HASH_ORIGINAL_EN_BD"


@pytest.mark.asyncio
async def test_no_admin_email_no_bootstrap(fresh_module):
    """Sin ADMIN_EMAIL/ADMIN_PASSWORD: no tocar nada, exit 0."""
    conn = _FakeConn()
    eng, users = _build(conn)
    mod = fresh_module({})
    with patch.object(mod, "get_engine", return_value=eng):
        rc = await mod.main()
    assert rc == 0
    inserts = [q for q, _ in conn.executed if "insert into users" in q]
    updates = [q for q, _ in conn.executed if "update users" in q]
    assert inserts == [] and updates == []


@pytest.mark.asyncio
async def test_short_password_skipped(fresh_module):
    """Password < 12 chars: no hacer nada (ni crear, ni tocar)."""
    conn = _FakeConn()
    eng, users = _build(conn)
    mod = fresh_module({
        "ADMIN_EMAIL": "admin@gruporysa.com",
        "ADMIN_PASSWORD": "corto",
        "ENVIRONMENT": "production",
    })
    with patch.object(mod, "get_engine", return_value=eng):
        rc = await mod.main()
    assert rc == 0
    inserts = [q for q, _ in conn.executed if "insert into users" in q]
    assert inserts == []


@pytest.mark.asyncio
async def test_emergency_recreate_when_no_admins(fresh_module):
    """Si la BD se quedó sin admins y ADMIN_EMAIL/ADMIN_PASSWORD están
    definidos, se crea uno de emergencia (salvaguarda)."""
    conn = _FakeConn()
    # BD vacía de admins pero hay otros usuarios (no admin)
    conn.users = {}
    conn.admins = []  # no admins
    eng = _FakeEngine(conn)
    mod = fresh_module({
        "ADMIN_EMAIL": "recovery@gruporysa.com",
        "ADMIN_PASSWORD": "PasswordDeEmergencia2026!",
        "ENVIRONMENT": "production",
    })
    with patch.object(mod, "get_engine", return_value=eng):
        rc = await mod.main()
    assert rc == 0
    inserts = [q for q, _ in conn.executed if "insert into users" in q]
    assert len(inserts) == 1


@pytest.mark.asyncio
async def test_existing_admin_in_production_with_other_admins(fresh_module):
    """Si el email no existe pero hay otros admins en producción:
    no se crea automáticamente (es un error de configuración)."""
    conn = _FakeConn()
    conn.users = {}  # el email configurado no existe
    conn.admins = [{"id": "otro", "role": "admin"}]  # pero ya hay admin
    eng = _FakeEngine(conn)
    mod = fresh_module({
        "ADMIN_EMAIL": "nuevo@gruporysa.com",
        "ADMIN_PASSWORD": "PasswordInicialDev2026!",
        "ENVIRONMENT": "production",
    })
    with patch.object(mod, "get_engine", return_value=eng):
        rc = await mod.main()
    assert rc == 0
    inserts = [q for q, _ in conn.executed if "insert into users" in q]
    assert inserts == [], "No debe crear admin nuevo en producción si ya hay otros"


@pytest.mark.asyncio
async def test_admin_in_development_with_other_admins_can_be_created(fresh_module):
    """En development, aunque haya otros admins, se crea el del ADMIN_EMAIL
    si el email no existe (útil para entornos de prueba con varios admins)."""
    conn = _FakeConn()
    conn.users = {}
    conn.admins = [{"id": "otro", "role": "admin"}]
    eng = _FakeEngine(conn)
    mod = fresh_module({
        "ADMIN_EMAIL": "nuevo@rysa-dev.local",
        "ADMIN_PASSWORD": "PasswordInicialDev2026!",
        "ENVIRONMENT": "development",
    })
    with patch.object(mod, "get_engine", return_value=eng):
        rc = await mod.main()
    assert rc == 0
    inserts = [q for q, _ in conn.executed if "insert into users" in q]
    assert len(inserts) == 1, "En development sí debe crear aunque haya otros admins"
