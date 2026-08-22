"""Compras/Gastos, Proveedores, Cuentas bancarias e historial de costos.

Módulo de compras y gastos (ERP) con afectación transaccional de inventario,
catálogo de proveedores, cuentas bancarias y evolución de costos por producto.

Revision ID: 0006_compras_gastos_proveedores
Revises: 0005_visitas_ubicaciones_rutas
Create Date: 2026-08-19
"""
import sys
from pathlib import Path
from alembic import op

_BACKEND = Path(__file__).resolve().parent.parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from pgstore.adapter import (  # noqa: E402
    build_create_table, build_index_ddl,
)

# Colecciones nuevas usadas por el módulo Compras y Gastos.
COLLECTIONS = [
    "proveedores",        # catálogo de proveedores
    "compras",            # compras / gastos / mixtos (tipo: compra|gasto|mixto)
    "cuentas_bancarias",  # cuentas bancarias para pagos y cotizaciones
    "costos_historial",   # evolución de costo por producto/proveedor
]

revision = "0006_compras_gastos_proveedores"
down_revision = "0005_visitas_ubicaciones_rutas"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for col in COLLECTIONS:
        op.execute(build_create_table(col))
        op.execute(build_index_ddl(col))


def downgrade() -> None:
    for col in reversed(COLLECTIONS):
        op.execute(f'DROP TABLE IF EXISTS "{col}"')
