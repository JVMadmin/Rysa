"""Alembic env (async, PostgreSQL).

Genera el esquema a partir de las definiciones de `pgstore.adapter`
(build_create_table / build_index_ddl) y la tabla `sequences`.
"""
import asyncio
import os
import sys
import logging
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from dotenv import load_dotenv

_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND))
load_dotenv(_BACKEND / ".env", override=False)

from pgstore.adapter import (  # noqa: E402
    KNOWN_COLLECTIONS, build_create_table, build_index_ddl,
)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])

target_metadata = None


def _schema_content() -> str:
    """Definición completa del esquema (tablas + secuencias)."""
    parts = []
    for col in KNOWN_COLLECTIONS:
        if col == "counters":
            continue  # los contadores viven en `sequences`
        parts.append(build_create_table(col))
        parts.append(build_index_ddl(col))
    parts.append(
        'CREATE TABLE IF NOT EXISTS "sequences" ('
        '"name" TEXT PRIMARY KEY, "seq" BIGINT NOT NULL DEFAULT 0)'
    )
    return "\n".join(parts)


def run_migrations_offline() -> None:
    context.configure(url=config.get_main_option("sqlalchemy.url"),
                      target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.", poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
