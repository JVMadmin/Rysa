"""visitas, ubicaciones de vendedor y rutas comerciales (campo + supervisión)

Revision ID: 0005_visitas_ubicaciones_rutas
Revises: 0004_iva_neto_precios
Create Date: 2026-08-18
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

NEW_COLLECTIONS = ["visits", "seller_locations", "sales_routes", "route_stops"]

revision = "0005_visitas_ubicaciones_rutas"
down_revision = "0004_iva_neto_precios"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for col in NEW_COLLECTIONS:
        op.execute(build_create_table(col))
        op.execute(build_index_ddl(col))
    # Clientes: coordenadas para el mapa (campo y supervisión).
    op.execute('ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "latitud" numeric')
    op.execute('ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "longitud" numeric')


def downgrade() -> None:
    op.execute('ALTER TABLE "clients" DROP COLUMN IF EXISTS "longitud"')
    op.execute('ALTER TABLE "clients" DROP COLUMN IF EXISTS "latitud"')
    for col in NEW_COLLECTIONS:
        op.execute(f'DROP TABLE IF EXISTS "{col}"')