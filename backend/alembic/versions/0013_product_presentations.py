"""Presentaciones de producto y conversiones a unidad base.

Revision ID: 0013_product_presentations
Revises: 0012_legacy_staging
Create Date: 2026-09-03
"""
from alembic import op

revision = "0013_product_presentations"
down_revision = "0012_legacy_staging"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.execute('''
        CREATE TABLE IF NOT EXISTS product_presentations (
            id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL REFERENCES products("_id") ON DELETE CASCADE,
            nombre TEXT NOT NULL,
            factor NUMERIC(12, 4) NOT NULL DEFAULT 1.0,
            codigo_barras TEXT,
            sku TEXT,
            precio NUMERIC(12, 2),
            costo NUMERIC(12, 4),
            es_base BOOLEAN NOT NULL DEFAULT FALSE,
            es_predeterminada BOOLEAN NOT NULL DEFAULT FALSE,
            activo BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_product_presentation_nombre UNIQUE (product_id, nombre),
            CONSTRAINT chk_factor_positivo CHECK (factor > 0)
        );
    ''')
    op.execute('CREATE INDEX IF NOT EXISTS idx_prod_pres_prod ON product_presentations (product_id);')
    op.execute('CREATE INDEX IF NOT EXISTS idx_prod_pres_barcode ON product_presentations (codigo_barras) WHERE codigo_barras IS NOT NULL;')

    # Sembrar presentación base para productos existentes
    op.execute('''
        INSERT INTO product_presentations (
            id, product_id, nombre, factor, codigo_barras, precio, costo,
            es_base, es_predeterminada, activo, created_at, updated_at
        )
        SELECT 
            'pres_' || id,
            id,
            COALESCE(NULLIF(doc->>'unidad_medida', ''), 'PZA'),
            1.0,
            NULLIF(doc->>'codigo_barras', ''),
            precio_con_iva,
            costo,
            TRUE,
            TRUE,
            TRUE,
            now(),
            now()
        FROM products
        ON CONFLICT (product_id, nombre) DO NOTHING;
    ''')

def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS product_presentations CASCADE;')
