"""Indices para busqueda rapida del Consultor de Precios (solo lectura).

Acelera la consulta por codigo, SKU, nombre y codigo de barras del servicio
independiente /api/public-price/* (backend/price_checker.py).

Revision ID: 0007_precios_publicos_consultor
Revises: 0006_compras_gastos_proveedores
Create Date: 2026-08-22
"""
from alembic import op

revision = "0007_precios_publicos_consultor"
down_revision = "0006_compras_gastos_proveedores"
branch_labels = None
depends_on = None

# Indices expresion sobre el documento JSONB de `products` (tabla del adapter
# postgres). Aceleran las consultas de igualdad de codigo/sku y el filtro por
# estado activo que usa el consultor. La busqueda por texto usa lower() para
# normalizar mayusculas/minusculas igual que el $regex con $options i.
INDEXES = [
    'CREATE INDEX IF NOT EXISTS idx_products_doc_codigo '
    '  ON "products" ((doc->>\'codigo\'))',
    'CREATE INDEX IF NOT EXISTS idx_products_doc_sku '
    '  ON "products" ((doc->>\'sku\'))',
    'CREATE INDEX IF NOT EXISTS idx_products_doc_estado '
    '  ON "products" ((doc->>\'estado\'))',
    'CREATE INDEX IF NOT EXISTS idx_products_doc_descripcion_lower '
    '  ON "products" (lower(doc->>\'descripcion\'))',
]


def upgrade() -> None:
    for ddl in INDEXES:
        op.execute(ddl)


def downgrade() -> None:
    for name in (
        "idx_products_doc_codigo",
        "idx_products_doc_sku",
        "idx_products_doc_estado",
        "idx_products_doc_descripcion_lower",
    ):
        op.execute(f'DROP INDEX IF EXISTS "{name}"')