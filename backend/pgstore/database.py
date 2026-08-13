"""PostgreSQL async engine y pool (SQLAlchemy + asyncpg) para Grupo RYSA ERP.

Capa de base de datos PostgreSQL:
- conexiones async
- pooling (SQLAlchemy AsyncEngine)
- manejo de errores
- cierre correcto de conexiones
"""
import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from sqlalchemy.engine import URL

_engine: AsyncEngine | None = None


def get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL no está definida. Revisa backend/.env")
    return url


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            get_database_url(),
            echo=False,
            pool_size=10,
            max_overflow=10,
            pool_pre_ping=True,
            pool_recycle=1800,
            # Evitar colgarse indefinidamente: límites de conexión y de comando.
            connect_args={"timeout": 15, "command_timeout": 60},
        )
    return _engine


async def dispose():
    global _engine
    if _engine is not None:
        try:
            await _engine.dispose()
        except Exception:
            # Cierre robusto: si alguna conexión queda a medio cerrar (p. ej.
            # proactor de Windows tras mucha concurrencia), no debe romper el
            # apagado del proceso.
            pass
        _engine = None


async def init_db_pool():
    """Verifica conectividad y crea el pool."""
    eng = get_engine()
    async with eng.connect() as conn:
        await conn.execute(__import__("sqlalchemy").text("SELECT 1"))
    return eng


from contextlib import asynccontextmanager


@asynccontextmanager
async def transaction():
    """Contexto de transacción: una sola conexión/transacción para varias
    operaciones. Commits al salir sin error, ROLLBACK si algo lanza excepción.

    Uso (integrar venta + inventario + caja atómicamente):
        async with pgstore.transaction() as conn:
            await conn.execute(text('INSERT INTO sales ...'))
            await conn.execute(text('UPDATE products SET ...'))
            # si algo falla -> todo revierte
    """
    eng = get_engine()
    async with eng.connect() as conn:
        trans = await conn.begin()
        try:
            yield conn
            await trans.commit()
        except Exception:
            await trans.rollback()
            raise
