"""Bootstrap idempotente del administrador inicial de RYSA.

Reglas (CRÍTICAS):
  * ADMIN_EMAIL/ADMIN_PASSWORD SOLO se usan para crear el primer admin.
  * Si el admin ya existe (por email en doc->>'email'), NO se modifica nada:
    - no se cambia password_hash
    - no se cambia role
    - no se cambia token_version
    - no se altera active
  * Reiniciar el backend múltiples veces nunca debe sobrescribir
    credenciales que el usuario haya cambiado en la UI.
  * Si ADMIN_EMAIL/ADMIN_PASSWORD cambian posteriormente, el admin
    existente NO se ve afectado (solo se crearía un admin NUEVO con el
    email nuevo si no existe).
  * Salvaguarda: si la BD se queda SIN admins y ADMIN_EMAIL/ADMIN_PASSWORD
    están definidos, se crea uno de emergencia (log explícito).
  * En producción: si el email no existe pero ya hay otros admins, no se
    crea automáticamente (probable error de configuración).

Arquitectónico:
  * La tabla `users` tiene columnas `(_id TEXT PK, id TEXT, doc JSONB, created_at)`.
  * Todos los campos del usuario (email, name, role, password_hash, active,
    token_version) viven dentro de `doc` (JSONB).
  * Se usa el adapter pgstore de la misma manera que el resto del backend
    (db.users.find_one / insert_one). NO se escribe SQL crudo.

Uso: el entrypoint del backend lo ejecuta antes de uvicorn
(alembic upgrade head && python -m scripts.bootstrap_admin && uvicorn ...).
"""
from __future__ import annotations
import os
import sys
import logging
import uuid as _uuid
import datetime as _dt

from pathlib import Path
_ROOT = str(Path(__file__).resolve().parent.parent)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

logging.basicConfig(level=logging.INFO, format="[bootstrap] %(message)s")
log = logging.getLogger("bootstrap_admin")

EMAIL = os.environ.get("ADMIN_EMAIL", "").strip().lower()
PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
NAME = os.environ.get("ADMIN_NAME", "Admin").strip() or "Admin"
ENV = os.environ.get("ENVIRONMENT", "development").lower()

# Módulo pgstore para acceso a BD (mockeable en tests unitarios)
pgstore = None


def _ok(pw: str) -> bool:
    return len(pw) >= 12


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def _hash_password(plaintext: str) -> str:
    """Hash bcrypt compatible con deps.verify_password.

    No asumo que bcrypt esté instalado: import lazy para que el script
    falle con un mensaje claro si falta la dependencia."""
    import bcrypt
    return bcrypt.hashpw(plaintext.encode("utf-8"), bcrypt.gensalt(12)).decode("utf-8")


async def main() -> int:
    global pgstore
    if not EMAIL or not PASSWORD:
        log.info("ADMIN_EMAIL/ADMIN_PASSWORD no definidos, omitiendo bootstrap")
        return 0
    if not _ok(PASSWORD):
        log.warning("ADMIN_PASSWORD debe tener al menos 12 caracteres, omitiendo")
        return 0

    # Importación lazy si no fue inyectado por pruebas
    if pgstore is None:
        import pgstore as _real_pgstore  # noqa: WPS433
        pgstore = _real_pgstore

    db = pgstore.PGDatabase()

    # 1) ¿Ya existe el admin por email?
    existing = await db.users.find_one({"email": EMAIL})
    if existing is not None:
        # Admin existe: NO TOCAR NADA. Ni password, ni rol, ni active,
        # ni token_version (eso invalidaría todas sus sesiones).
        log.info(
            "Admin ya existe (id=%s, role=%s, active=%s): no se modifica. "
            "Para resetear credenciales, usa la UI o cambia el password "
            "directamente en la BD.",
            existing.get("id"),
            existing.get("role"),
            existing.get("active", True),
        )
        return 0

    # 2) Comprobar si hay otros admins ya en el sistema.
    n_admins = await db.users.count_documents({"role": {"$regex": "^admin"}})
    if n_admins > 0 and ENV == "production":
        # Producción: si el email configurado no existe pero ya hay otros
        # admins, no se crea automáticamente (probable error de configuración).
        log.warning(
            "ADMIN_EMAIL=%s no existe en la BD pero ya hay %d admin(s). "
            "No se crea uno nuevo automáticamente. Si necesitas este "
            "usuario, créalo desde la UI.",
            EMAIL, n_admins,
        )
        return 0

    # 3) Crear el primer admin (o admin de emergencia).
    pw_hash = _hash_password(PASSWORD)
    admin_id = _uuid.uuid4().hex
    doc = {
        "id": admin_id,
        "email": EMAIL,
        "name": NAME,
        "role": "admin_propietario",
        "active": True,
        "password_hash": pw_hash,
        "token_version": 0,
        "source": "bootstrap",
        "created_at": _now(),
    }
    await db.users.insert_one(doc)
    log.info("Admin creado: %s (id=%s, role=%s, source=bootstrap)",
             EMAIL, admin_id, doc["role"])

    # 4) Resumen
    n_total = await db.users.count_documents({"role": {"$regex": "^admin"}})
    log.info("Total admins: %d", n_total)
    return 0


if __name__ == "__main__":
    import asyncio
    sys.exit(asyncio.run(main()))
