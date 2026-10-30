"""Bloqueo de cuentas por intentos fallidos y desbloqueo (PostgreSQL REAL).

- Una cuenta que no es de administrador queda bloqueada hasta que un
  administrador o desarrollador la desbloquee (no vence sola).
- Las de administrador solo se bloquean 15 minutos.
- Un rol con el módulo de Usuarios que no es administrador no puede desbloquear.

Ejecutar desde `backend/`:
    python -m pytest tests/test_bloqueo_cuentas.py -n 0
"""
import asyncio
import sys
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(BASE / ".env", override=False)

import pgstore  # noqa: E402
import deps  # noqa: E402
import server  # noqa: E402

IPS = [f"10.77.0.{i}" for i in range(server.LOGIN_USER_MAX_FAILURES)]


def _run(body):
    async def _main():
        await pgstore.init_db_pool()
        try:
            await body()
        finally:
            await pgstore.dispose()
    asyncio.run(_main())


async def _cuenta(rol):
    correo = f"{rol}-{uuid.uuid4().hex[:8]}@prueba.local"
    u = {"id": "u-" + uuid.uuid4().hex, "email": correo, "name": f"Prueba {rol}", "role": rol}
    await deps.db.users.insert_one(dict(u, active=True))
    return u


async def _fallar(u):
    # Una IP distinta por intento: así solo cuenta el bloqueo por usuario.
    for ip in IPS:
        await server.record_failed_login(ip, u["email"], u)


async def _limpiar(u):
    await deps.db.users.delete_one({"id": u["id"]})
    await server.reset_login_failures(u["email"])
    await deps.db.login_attempts.delete_many({"_id": {"$in": ["ip:" + ip for ip in IPS]}})
    await deps.db.audit_logs.delete_many({"registro_id": u["id"]})


def test_cajero_bloqueado_hasta_que_lo_desbloquee_un_admin():
    async def body():
        cajero = await _cuenta("cajero")
        try:
            await _fallar(cajero)
            with pytest.raises(HTTPException) as e:
                await server.check_login_rate_limit("10.77.9.9", cajero["email"])
            assert e.value.status_code == 423
            b = (await server.bloqueos_de_cuentas())[cajero["email"]]
            assert b["tipo"] == "manual" and b["fallos"] == server.LOGIN_USER_MAX_FAILURES
            # El indicador sale en la lista de usuarios.
            lista = await server.list_users({"id": "x", "role": "admin"})
            assert next(u for u in lista if u["id"] == cajero["id"])["bloqueo"]["tipo"] == "manual"
            # Un encargado (aunque tenga el módulo de Usuarios) no puede desbloquear.
            with pytest.raises(HTTPException) as e:
                await server.desbloquear_usuario(cajero["id"], {"id": "e", "name": "Enc", "role": "encargado"})
            assert e.value.status_code == 403
            # El dueño sí; después vuelve a poder entrar.
            await server.desbloquear_usuario(cajero["id"], {"id": "d", "name": "Dueño", "role": "admin_propietario"})
            await server.check_login_rate_limit("10.77.9.9", cajero["email"])
            assert cajero["email"] not in await server.bloqueos_de_cuentas()
        finally:
            await _limpiar(cajero)
    _run(body)


def test_admin_solo_se_bloquea_un_rato():
    async def body():
        admin = await _cuenta("admin_propietario")
        try:
            await _fallar(admin)
            with pytest.raises(HTTPException) as e:
                await server.check_login_rate_limit("10.77.9.9", admin["email"])
            assert e.value.status_code == 429
            assert (await server.bloqueos_de_cuentas())[admin["email"]]["tipo"] == "temporal"
            # Un desarrollador lo puede desbloquear antes de que venza.
            await server.desbloquear_usuario(admin["id"], {"id": "v", "name": "Dev", "role": "admin_desarrollador"})
            await server.check_login_rate_limit("10.77.9.9", admin["email"])
        finally:
            await _limpiar(admin)
    _run(body)
