"""Bootstrap idempotente del primer administrador de RYSA.

Se ejecuta al arrancar el backend (entrypoint del contenedor). Crea o
actualiza el usuario configurado en ADMIN_EMAIL / ADMIN_PASSWORD si está
definido y no hay otro admin presente.

Reglas:
  * Si ADMIN_EMAIL o ADMIN_PASSWORD no están definidos: log informativo y
    exit 0 (no fatal). Útil para despliegues donde el admin se crea por
    otro medio.
  * Si ADMIN_PASSWORD < 12 caracteres: log warning y exit 0.
  * Si ya existe un usuario con ese email: actualiza el password y fuerza
    rol `admin_propietario` + `active=true`. Idempotente.
  * Si existe otro admin pero el email configurado no está: crea el nuevo
    admin (otro admin puede coexistir).
  * Si el rol del email configurado no es admin: lo promueve.

Este script es seguro de correr múltiples veces: no duplica usuarios ni
rompe configuraciones existentes.
"""
from __future__ import annotations
import os
import sys
import logging

logging.basicConfig(level=logging.INFO, format="[bootstrap] %(message)s")
log = logging.getLogger("bootstrap_admin")

EMAIL = os.environ.get("ADMIN_EMAIL", "").strip().lower()
PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
NAME = os.environ.get("ADMIN_NAME", "Admin").strip() or "Admin"
ENV = os.environ.get("ENVIRONMENT", "development").lower()


def _ok(pw: str) -> bool:
    return len(pw) >= 12


async def main() -> int:
    if not EMAIL or not PASSWORD:
        log.info("ADMIN_EMAIL/ADMIN_PASSWORD no definidos, omitiendo bootstrap")
        return 0
    if not _ok(PASSWORD):
        log.warning("ADMIN_PASSWORD debe tener al menos 12 caracteres, omitiendo")
        return 0

    from pgstore.database import get_engine
    from sqlalchemy import text
    import bcrypt

    eng = get_engine()
    pw_hash = bcrypt.hashpw(PASSWORD.encode("utf-8"), bcrypt.gensalt(12)).decode("utf-8")
    async with eng.begin() as conn:
        row = (await conn.execute(
            text("SELECT id, role, active, password_hash FROM users WHERE email = :e"),
            {"e": EMAIL})).first()
        if row is None:
            # No existe: crear (idempotente vía ON CONFLICT)
            import uuid as _uuid
            uid = _uuid.uuid4().hex
            await conn.execute(text(
                "INSERT INTO users (id, email, name, role, password_hash, active, token_version, doc) "
                "VALUES (CAST(:id AS text), :e, :n, :r, CAST(:ph AS text), true, 0, CAST(:d AS jsonb)) "
                "ON CONFLICT (email) DO NOTHING"),
                {"id": uid, "e": EMAIL, "n": NAME, "r": "admin_propietario",
                 "ph": pw_hash, "d": '{"source":"bootstrap"}'})
            log.info(f"Admin creado: {EMAIL}")
        else:
            # Existe: promover y resetear password. Idempotente.
            await conn.execute(text(
                "UPDATE users SET role = 'admin_propietario', active = true, "
                "password_hash = CAST(:ph AS text), "
                "token_version = token_version + 1 "
                "WHERE email = :e"),
                {"ph": pw_hash, "e": EMAIL})
            log.info(f"Admin actualizado (rol forzado a admin_propietario, password reseteado): {EMAIL}")

    # Resumen de admins para auditoría
    async with eng.connect() as conn:
        n = (await conn.execute(text("SELECT count(*) FROM users WHERE role LIKE 'admin%'"))).scalar()
    log.info(f"Total de usuarios admin: {n}")
    return 0


if __name__ == "__main__":
    import asyncio
    sys.exit(asyncio.run(main()))
