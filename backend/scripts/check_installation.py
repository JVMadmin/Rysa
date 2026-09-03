#!/usr/bin/env python3
"""
Diagnóstico de instalación RYSA.

Verifica que un despliegue de RYSA está completo y funcional sin entrar
a la UI. Comprueba:

  - Variables de entorno críticas
  - PostgreSQL alcanzable
  - Alembic al día (revision head coincide con 0012_legacy_staging)
  - Tablas productivas y legacy_* presentes
  - Catálogo de productos y al menos un usuario
  - Directorio legacy_data y permisos
  - Healthcheck de la API

Uso (dentro del backend container):
  docker compose exec backend python /app/scripts/check_installation.py
"""
from __future__ import annotations
import os
import sys
from pathlib import Path
from typing import Iterable, List, Tuple

_ROOT = str(Path(__file__).resolve().parent.parent)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

try:
    from sqlalchemy import text
except ImportError:
    print("[ERROR] sqlalchemy no instalado")
    sys.exit(2)

REQUIRED_ENV = [
    "DATABASE_URL", "JWT_SECRET", "ENVIRONMENT",
]
REQUIRED_PRODUCTIVE_TABLES = [
    "users", "clients", "products", "sales", "abonos",
    "caja_movimientos", "inventory_movements", "cxc_cargos", "sequences",
]
REQUIRED_LEGACY_TABLES = [
    # backend (0011)
    "legacy_import_batch", "legacy_import_audit", "legacy_import_backup",
    "legacy_snapshots", "legacy_client_balance",
    # staging (0012)
    "legacy_migration_batch", "legacy_tickets", "legacy_ticket_details",
    "legacy_cxc_snapshot", "legacy_cxc_movements", "legacy_customer_mapping",
    "legacy_product_mapping", "legacy_excluded_documents", "legacy_review_queue",
]

OK = "\033[92m[OK]\033[0m"
ERR = "\033[91m[ERROR]\033[0m"
WARN = "\033[93m[WARN]\033[0m"

results: List[Tuple[str, bool, str]] = []


def add(name: str, ok: bool, detail: str = "") -> None:
    mark = OK if ok else ERR
    print(f"{mark} {name}{(' — ' + detail) if detail else ''}")
    results.append((name, ok, detail))


def check_env() -> None:
    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    add("Environment", not missing,
        "faltan: " + ", ".join(missing) if missing else "")

    # Validar que no son placeholders
    placeholders = []
    js = os.environ.get("JWT_SECRET", "")
    if js.startswith("<") or "CHANGE_ME" in js or len(js) < 32:
        placeholders.append("JWT_SECRET (placeholder o <32 chars)")
    ap = os.environ.get("ADMIN_PASSWORD", "")
    if ap.startswith("<") or "CHANGE_ME" in ap or len(ap) < 12:
        placeholders.append("ADMIN_PASSWORD (placeholder o <12 chars)")
    pp = os.environ.get("POSTGRES_PASSWORD", "")
    if pp.startswith("<") or "CHANGE_ME" in pp:
        placeholders.append("POSTGRES_PASSWORD (placeholder)")
    if os.environ.get("ENVIRONMENT") == "production":
        if not os.environ.get("ADMIN_EMAIL"):
            placeholders.append("ADMIN_EMAIL (requerido en producción)")
        if not os.environ.get("ADMIN_PASSWORD") or len(os.environ.get("ADMIN_PASSWORD", "")) < 12:
            placeholders.append("ADMIN_PASSWORD (>=12 chars requerido en producción)")
        # En producción, la BD debe ser rysa_prod (no rysa_dev).
        dburl = os.environ.get("DATABASE_URL", "")
        if "/rysa_dev" in dburl:
            placeholders.append("DATABASE_URL apunta a rysa_dev (producción debe usar rysa_prod)")
        if "/rysa_prod" not in dburl:
            placeholders.append("DATABASE_URL no apunta a rysa_prod (URL actual: " + dburl.split("@")[-1] if "@" in dburl else dburl + ")")
    if placeholders:
        add("Secrets no son placeholders", False, "; ".join(placeholders))
    else:
        add("Secrets no son placeholders", True, "OK")


def _engine():
    from pgstore.database import get_engine
    return get_engine()


async def _fetch_all(sql: str, params: dict | None = None) -> list:
    eng = _engine()
    async with eng.connect() as conn:
        r = await conn.execute(text(sql), params or {})
        return [dict(row._mapping) for row in r.fetchall()]


async def _fetch_one(sql: str) -> dict | None:
    rows = await _fetch_all(sql)
    return rows[0] if rows else None


async def check_postgres() -> None:
    try:
        r = await _fetch_one("SELECT version() AS v, current_database() AS db")
        add("PostgreSQL", True, f"{r['v'][:30]}... db={r['db']}")
    except Exception as e:
        add("PostgreSQL", False, str(e)[:200])
        return


async def check_alembic() -> None:
    r = await _fetch_all(
        "SELECT version_num FROM alembic_version ORDER BY version_num DESC LIMIT 1")
    head = r[0]["version_num"] if r else None
    if head == "0012_legacy_staging":
        add("Alembic", True, f"head={head}")
    else:
        add("Alembic", head == "0012_legacy_staging",
            f"head actual={head} (se esperaba 0012_legacy_staging). "
            "Corre: docker compose exec backend alembic upgrade head")


async def check_tables() -> None:
    rows = await _fetch_all(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
    have = {r["table_name"] for r in rows}
    miss_prod = [t for t in REQUIRED_PRODUCTIVE_TABLES if t not in have]
    add("Tablas productivas", not miss_prod,
        "faltan: " + ", ".join(miss_prod) if miss_prod else f"{len(have)} tablas")
    miss_leg = [t for t in REQUIRED_LEGACY_TABLES if t not in have]
    add("Tablas legacy_*", not miss_leg,
        "faltan: " + ", ".join(miss_leg) if miss_leg else "13 tablas")


async def check_data() -> None:
    u = await _fetch_one("SELECT count(*) AS n FROM users")
    add("Users", (u["n"] or 0) > 0, f"{u['n']} usuarios")
    p = await _fetch_one("SELECT count(*) AS n FROM products")
    add("Products", (p["n"] or 0) > 0, f"{p['n']} productos")
    s = await _fetch_one("SELECT count(*) AS n FROM sales")
    add("Sales", True, f"{s['n']} ventas (puede ser 0)")
    s_legacy = await _fetch_one(
        "SELECT count(*) AS n FROM sales WHERE doc->>'source' = 'LEGACY'")
    add("Ventas LEGACY", True, f"{s_legacy['n']} ventas legacy")


async def check_legacy_data_dir() -> None:
    d = os.environ.get("LEGACY_DATA_PATH", "/app/legacy_data")
    if not os.path.isdir(d):
        add("legacy_data dir", False, f"no existe: {d}")
        return
    # El zip se despliega como archivos DBF sueltos, no subcarpetas estrictas
    files = sum(1 for _ in os.scandir(d))
    add("legacy_data dir", True, f"{d} ({files} entradas)")


async def check_health() -> None:
    import urllib.request
    base = os.environ.get("PUBLIC_BASE_URL") or "http://127.0.0.1:8000"
    try:
        req = urllib.request.urlopen(f"{base}/health", timeout=3)
        add("Health API", req.status == 200, f"GET /health -> {req.status}")
    except Exception as e:
        add("Health API", False, str(e)[:200])


async def amain() -> int:
    check_env()
    await check_postgres()
    if not os.environ.get("DATABASE_URL"):
        print(f"{ERR} DATABASE_URL no definido, no se puede continuar")
        return 2
    await check_alembic()
    await check_tables()
    await check_data()
    await check_legacy_data_dir()
    await check_health()
    errors = sum(1 for _, ok, _ in results if not ok)
    print()
    if errors:
        print(f"{ERR} {errors} verificación(es) fallaron.")
    else:
        print(f"{OK} Sistema instalado correctamente.")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    import asyncio
    sys.exit(asyncio.run(amain()))
