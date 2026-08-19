"""neto/bruto/IVA de productos y utilidad/margen

Revision ID: 0004_iva_neto_precios
Revises: 0003_sucursales
Create Date: 2026-08-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_iva_neto_precios"
down_revision = "0003_sucursales"
branch_labels = None
depends_on = None

_NEW_PRODUCT_COLS = ["precio_sin_iva", "precio_con_iva", "utilidad", "margen"]

_BACKFILL_SQL = [
    # Los productos existentes se capturaron con precios QUE INCLUYEN IVA
    # (brutos: 'PRECIOn = precio con IVA'). Lo registramos para que el sistema
    # maneje neto/bruto correctamente sin reinterpretar datos históricos.
    "UPDATE products SET doc = jsonb_set(doc, '{precio_incluye_iva}', CAST('true' AS jsonb), true) "
    "WHERE doc->>'precio_incluye_iva' IS NULL",
    # Neto/bruto canónicos a partir de la primera lista de precios (o el costo).
    "UPDATE products SET "
    "  doc = jsonb_set(jsonb_set(doc, '{precio_sin_iva}', "
    "        COALESCE(doc->'precios'->0->'precio_sin_iva', to_jsonb(COALESCE((doc->>'costo')::numeric, 0))), true), "
    "        '{precio_con_iva}', "
    "        COALESCE(doc->'precios'->0->'precio_con_iva', to_jsonb(COALESCE((doc->>'costo')::numeric, 0))), true) "
    "WHERE doc->>'precio_sin_iva' IS NULL AND doc->>'precio_con_iva' IS NULL",
    # Utilidad/margen sobre el precio neto de la primera lista.
    "UPDATE products SET "
    "  doc = jsonb_set(jsonb_set(doc, '{utilidad}', "
    "        to_jsonb(COALESCE(CAST(doc->>'precio_sin_iva' AS numeric), 0) - COALESCE((doc->>'costo')::numeric, 0)), true), "
    "        '{margen}', "
    "        to_jsonb(CASE WHEN COALESCE((doc->>'precio_sin_iva')::numeric, 0) > 0 THEN "
    "             round(((COALESCE(CAST(doc->>'precio_sin_iva' AS numeric), 0) - COALESCE((doc->>'costo')::numeric, 0)) "
    "             / COALESCE((doc->>'precio_sin_iva')::numeric, 1)) * 100, 2) ELSE 0 END), true) "
    "WHERE doc->>'utilidad' IS NULL AND doc->>'margen' IS NULL",
]


def upgrade() -> None:
    for col in _NEW_PRODUCT_COLS:
        op.execute(f'ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "{col}" numeric')
    for sql in _BACKFILL_SQL:
        try:
            op.execute(sql)
        except Exception:
            pass  # backfill best-effort; los flujos normales recalcularán al editar


def downgrade() -> None:
    for col in _NEW_PRODUCT_COLS:
        op.execute(f'ALTER TABLE "products" DROP COLUMN IF EXISTS "{col}"')