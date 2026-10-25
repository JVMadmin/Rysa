"""Rendimiento fase 2: índice parcial de ventas del ERP y pg_stat_statements.

El tablero y los desgloses suman solo ventas propias del ERP (no LEGACY). Con
66k ventas legacy, un índice de fecha limitado a las del ERP evita leer el
histórico en cada suma. pg_stat_statements (precargado en docker-compose)
permite ver las consultas más lentas en producción.

Revision ID: 0021_rendimiento_fase2
Revises: 0020_indices_rendimiento
Create Date: 2026-10-25
"""
from alembic import op
from sqlalchemy import text

revision = "0021_rendimiento_fase2"
down_revision = "0020_indices_rendimiento"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if conn.execute(text("SELECT to_regclass('public.sales')")).scalar() is not None:
        op.execute("""CREATE INDEX IF NOT EXISTS idx_sales_rysa_fecha ON sales ((doc->>'fecha'))
                      WHERE (doc->>'source') IS DISTINCT FROM 'LEGACY'""")
    try:
        with conn.begin_nested():  # requiere shared_preload_libraries; si no, se omite
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_stat_statements"))
    except Exception:
        pass


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_sales_rysa_fecha")
