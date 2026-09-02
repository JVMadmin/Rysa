"""Bootstrap idempotente del administrador inicial de RYSA.

Reglas (CRÍTICAS):
  * ADMIN_EMAIL/ADMIN_PASSWORD SOLO se usan para crear el primer admin.
  * Si el admin ya existe (por email), NO se modifica nada:
    - no se cambia password
    - no se cambia rol
    - no se cambia token_version
    - no se altera active
  * Reiniciar el backend múltiples veces nunca debe sobrescribir
    credenciales que el usuario haya cambiado en la UI.
  * Si ADMIN_EMAIL/ADMIN_PASSWORD cambian posteriormente, el admin
    existente NO se ve afectado (solo se crearía un admin NUEVO con el
    email nuevo si no existe).
  * Salvaguarda: si la BD se queda SIN admins y ADMIN_EMAIL/ADMIN_PASSWORD
    están definidos, se crea uno de emergencia (log explícito).

Uso: el entrypoint del backend lo ejecuta antes de uvicorn
(`alembic upgrade head && python -m scripts.bootstrap_admin && uvicorn ...`).
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
        # Comprobar si el email ya existe
        row = (await conn.execute(
            text("SELECT id, role, active FROM users WHERE email = :e"),
            {"e": EMAIL})).first()

        if row is not None:
            # El admin ya existe. NO TOCAR NADA.
            # En particular: no resetear password (el usuario pudo haberla
            # cambiado desde la UI), no promover rol, no alterar token_version
            # (eso invalidaría sus sesiones).
            log.info(f"Admin ya existe ({row[0]}, role={row[1]}, active={row[2]}): "
                     "no se modifica. Para resetear credenciales, usa la UI "
                     "o cambia el password directamente en la BD.")
            return 0

        # No existe el email: comprobar si es el primer arranque
        # (es decir, no hay NINGÚN admin en la BD).
        n_admins = (await conn.execute(
            text("SELECT count(*) FROM users WHERE role LIKE 'admin%'"))).scalar() or 0
        if n_admins > 0 and ENV == "production":
            # En producción, no crear admins nuevos automáticamente: si el
            # email configurado no existe pero ya hay otros admins, es
            # probablemente un error de configuración. Log y salir.
            log.warning(
                f"ADMIN_EMAIL={EMAIL} no existe en la BD pero ya hay "
                f"{n_admins} admin(s). No se crea uno nuevo automáticamente. "
                "Si necesitas este usuario, créalo desde la UI."
            )
            return 0

        # Crear el primer admin (o admin de emergencia si la BD quedó vacía).
        import uuid as _uuid
        uid = _uuid.uuid4().hex
        await conn.execute(text(
            "INSERT INTO users (id, email, name, role, password_hash, active, token_version, doc) "
            "VALUES (CAST(:id AS text), :e, :n, 'admin_propietario', CAST(:ph AS text), true, 0, "
            "CAST('{\"source\":\"bootstrap\"}' AS jsonb)) "
            "ON CONFLICT (email) DO NOTHING"),
            {"id": uid, "e": EMAIL, "n": NAME, "ph": pw_hash})
        log.info(f"Admin creado: {EMAIL} (id={uid[:8]}...)")

    async with eng.connect() as conn:
        n = (await conn.execute(text("SELECT count(*) FROM users WHERE role LIKE 'admin%'"))).scalar()
    log.info(f"Total admins: {n}")
    return 0


if __name__ == "__main__":
    import asyncio
    sys.exit(asyncio.run(main()))
