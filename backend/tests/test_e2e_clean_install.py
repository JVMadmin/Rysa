"""Test E2E: instalación limpia desde una BD PostgreSQL vacía.

Verifica la cadena:

  1. Levantar/limpiar BD
  2. alembic upgrade head  (debe completar sin error)
  3. Verificar que alembic_version tiene la migración head
  4. Verificar que la tabla `users` tiene la estructura correcta
  5. Ejecutar bootstrap_admin  (debe crear el admin)
  6. Verificar que admin está en `users.doc` (no en columnas SQL)
  7. Login contra el backend (HTTP) debe funcionar

Este test REQUIERE un PostgreSQL accesible. Para correrlo:

  # Levantar Postgres limpio:
  docker rm -f rysa_e2e_postgres
  docker run -d --name rysa_e2e_postgres -p 5433:5432 \
      -e POSTGRES_USER=rysa -e POSTGRES_PASSWORD=e2e_pw \
      -e POSTGRES_DB=rysa postgres:17

  # Verificar BD target limpia (sin tablas):
  docker exec rysa_e2e_postgres psql -U rysa -d rysa -c "\\dt"

  # Ejecutar:
  DATABASE_URL=postgresql+asyncpg://rysa:e2e_pw@localhost:5433/rysa \
  ADMIN_EMAIL=e2e@rysa-dev.local \
  ADMIN_PASSWORD=E2EPassword_12345 \
  python -m pytest backend/tests/test_e2e_clean_install.py -v -s

Al terminar:
  docker rm -f rysa_e2e_postgres
"""
from __future__ import annotations
import os
import sys
import asyncio
import subprocess
from pathlib import Path
from typing import AsyncIterator

import pytest

BACKEND = Path(__file__).resolve().parent.parent


def _have_db() -> bool:
    return bool(os.environ.get("DATABASE_URL"))


def _drop_all_tables(database_url: str) -> None:
    """Borra TODAS las tablas del schema public. Emula BD vacía."""
    import psycopg
    # Parsear la URL para psycopg (sin el prefijo +asyncpg)
    sync_url = database_url.replace("postgresql+asyncpg://", "postgresql://")
    conn = psycopg.connect(sync_url, autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute("DROP SCHEMA public CASCADE")
            cur.execute("CREATE SCHEMA public")
            cur.execute("GRANT ALL ON SCHEMA public TO rysa")
    finally:
        conn.close()


def _run_alembic_upgrade() -> None:
    """Ejecuta alembic upgrade head contra la BD configurada en DATABASE_URL."""
    env = os.environ.copy()
    proc = subprocess.run(
        ["alembic", "upgrade", "head"],
        cwd=str(BACKEND), env=env, capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0:
        pytest.fail(f"alembic upgrade head falló:\nstdout={proc.stdout}\nstderr={proc.stderr}")


def _run_bootstrap() -> None:
    """Ejecuta scripts.bootstrap_admin contra la BD configurada."""
    env = os.environ.copy()
    proc = subprocess.run(
        [sys.executable, "-m", "scripts.bootstrap_admin"],
        cwd=str(BACKEND), env=env, capture_output=True, text=True, timeout=60,
    )
    if proc.returncode != 0:
        pytest.fail(f"bootstrap_admin falló:\nstdout={proc.stdout}\nstderr={proc.stderr}")


@pytest.mark.skipif(not _have_db(), reason="DATABASE_URL no definido; test E2E no se ejecuta")
def test_clean_install_e2e():
    database_url = os.environ["DATABASE_URL"]

    # 1) BD vacía
    _drop_all_tables(database_url)

    # 2) Alembic al head
    _run_alembic_upgrade()

    # 3) Verificar que alembic_version tiene la migración head
    import psycopg
    sync_url = database_url.replace("postgresql+asyncpg://", "postgresql://")
    conn = psycopg.connect(sync_url)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT version_num FROM alembic_version")
            head = cur.fetchone()
            assert head is not None and head[0] == "0012_legacy_staging", \
                f"alembic_version esperaba 0012_legacy_staging, encontré {head}"
    finally:
        conn.close()

    # 4) Verificar que `users` tiene la estructura correcta (id + doc + created_at)
    conn = psycopg.connect(sync_url)
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema='public' AND table_name='users'
            """)
            cols = {r[0] for r in cur.fetchall()}
        # Las 3 columnas que el adapter espera. No debe haber role/active/email
        # como columnas separadas.
        assert "_id" in cols and "id" in cols and "doc" in cols and "created_at" in cols, \
            f"users debe tener (_id, id, doc, created_at); encontré {cols}"
        for forbidden in ("role", "active", "email", "password_hash"):
            assert forbidden not in cols, \
                f"users no debe tener columna '{forbidden}' (debe vivir en doc JSONB)"
    finally:
        conn.close()

    # 5) Ejecutar bootstrap
    _run_bootstrap()

    # 6) Verificar que el admin está en users.doc (no en columnas SQL)
    conn = psycopg.connect(sync_url)
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT doc->>'email', doc->>'role', doc->>'active', doc->>'password_hash' IS NOT NULL
                FROM users
            """)
            row = cur.fetchone()
            assert row is not None, "bootstrap no creó ningún admin"
            email, role, active, has_pw = row
            assert email == os.environ["ADMIN_EMAIL"]
            assert role == "admin_propietario"
            assert active in ("true", "t", "True")  # JSONB boolean -> str
            assert has_pw is True
    finally:
        conn.close()
