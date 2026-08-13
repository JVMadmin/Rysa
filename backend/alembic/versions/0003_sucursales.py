"""sucursales y preparacion multi-sucursal (tenant): nuevas colecciones + product_stock

Revision ID: 0003_sucursales
Revises: 0002_sale_idempotency
Create Date: 2026-08-12
"""
import sys
from pathlib import Path
from alembic import op
import sqlalchemy as sa

_BACKEND = Path(__file__).resolve().parent.parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from pgstore.adapter import (  # noqa: E402
    build_create_table, build_index_ddl,
)

NEW_COLLECTIONS = ["sucursales", "price_lists", "mensajes", "plantillas"]

revision = "0003_sucursales"
down_revision = "0002_sale_idempotency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for col in NEW_COLLECTIONS:
        op.execute(build_create_table(col))
        op.execute(build_index_ddl(col))
    # Tabla relacional de existencias por sucursal (PG-only, constraints).
    op.execute(
        'CREATE TABLE IF NOT EXISTS "product_stock" ('
        '"product_id" TEXT NOT NULL,'
        '"sucursal_id" TEXT NOT NULL,'
        '"existencia" NUMERIC NOT NULL DEFAULT 0,'
        '"stock_minimo" NUMERIC NOT NULL DEFAULT 0,'
        '"updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),'
        'PRIMARY KEY ("product_id", "sucursal_id"))'
    )
    op.execute(
        'CREATE INDEX IF NOT EXISTS idx_product_stock_sucursal '
        'ON "product_stock" ("sucursal_id")'
    )


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS "product_stock"')
    for col in NEW_COLLECTIONS:
        op.execute(f'DROP TABLE IF EXISTS "{col}"')
