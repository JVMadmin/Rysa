"""Integridad e indices para ~50 usuarios concurrentes (auditoria pre-produccion).

1. UNICIDAD que antes NO estaba garantizada en PostgreSQL:
   - users.email y clients.codigo son UNIQUE en la logica de la app, pero el
     adaptador PG trata create_index() como NO-OP -> hoy podrian existir
     duplicados. Se crean UNIQUE con tolerancia: si ya hay duplicados se cae
     a indice normal + NOTICE (no rompe el deploy).
   - cajas: una sola caja ABIERTA por usuario (indice unico parcial). Antes la
     doble apertura solo se evitaba a nivel app (ventana de carrera real).
     Primero se cierran aperturas duplicadas previas conservando la mas nueva.
2. Indices para consultas calientes del ERP (ventas por vendedor/fecha,
   kardex por producto, cartera por vendedor, codigo de barras, abonos).

Revision ID: 0008_integridad_indices_concurrencia
Revises: 0007_precios_publicos_consultor
Create Date: 2026-08-22
"""
from alembic import op

revision = "0008_integridad_indices"
down_revision = "0007_precios_publicos_consultor"
branch_labels = None
depends_on = None

# Cierra cajas abiertas duplicadas (mismo usuario): conserva la mas reciente.
# Sin 'cierre' detallado; los endpoints ya toleran cierre ausente.
_CERRAR_CAJAS_DUP = """
UPDATE "cajas" c
SET doc = jsonb_set(c.doc, '{estado}', '"cerrada"', true)
WHERE c.doc->>'estado' = 'abierta'
  AND c."id" NOT IN (
    SELECT DISTINCT ON (doc->>'usuario_id') "id"
    FROM "cajas"
    WHERE doc->>'estado' = 'abierta'
    ORDER BY doc->>'usuario_id' ASC,
             COALESCE(doc->>'fecha_apertura', '') DESC
  )
"""

# Crea UNIQUE y si existen duplicados previos cae a indice normal (deploy-safe).
def _unique_or_normal(nombre_unique: str, tabla: str, expr: str, nombre_normal: str) -> str:
    return f"""
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS {nombre_unique} ON {tabla} ({expr});
EXCEPTION WHEN others THEN
  CREATE INDEX IF NOT EXISTS {nombre_normal} ON {tabla} ({expr});
  RAISE NOTICE '% (se uso indice normal en su lugar)', SQLERRM;
END $$;
"""


def upgrade() -> None:
    # --- Integridad ---
    op.execute(_CERRAR_CAJAS_DUP)
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_cajas_usuario_abierta "
        "ON \"cajas\" ((doc->>'usuario_id')) "
        "WHERE doc->>'estado' = 'abierta'"
    )
    op.execute(_unique_or_normal(
        "uq_users_email", '"users"', "(lower(doc->>'email'))", "idx_users_doc_email"))
    op.execute(_unique_or_normal(
        "uq_clients_codigo", '"clients"', "(doc->>'codigo')", "idx_clients_doc_codigo"))

    # --- Consultas calientes ---
    op.execute("CREATE INDEX IF NOT EXISTS idx_sales_vendedor "
               "ON \"sales\" ((doc->>'vendedor_id'))")
    # Prefijos de fecha (regex ^YYYY-MM-DD usados por dashboard/reportes):
    op.execute("CREATE INDEX IF NOT EXISTS idx_sales_fecha_prefix "
               "ON \"sales\" ((doc->>'fecha') text_pattern_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_inv_mov_producto_fecha "
               "ON \"inventory_movements\" ((doc->>'product_id'), (doc->>'fecha'))")
    op.execute("CREATE INDEX IF NOT EXISTS idx_clients_vendedor "
               "ON \"clients\" ((doc->>'vendedor_id'))")
    op.execute("CREATE INDEX IF NOT EXISTS idx_products_codigos_barras "
               "ON \"products\" ((doc->>'codigos_barras'))")
    op.execute("CREATE INDEX IF NOT EXISTS idx_abonos_cliente "
               "ON \"abonos\" ((doc->>'cliente_id'))")
    op.execute("CREATE INDEX IF NOT EXISTS idx_audit_logs_fecha "
               "ON \"audit_logs\" ((doc->>'fecha'))")


def downgrade() -> None:
    for name in (
        "idx_audit_logs_fecha",
        "idx_abonos_cliente",
        "idx_products_codigos_barras",
        "idx_clients_vendedor",
        "idx_inv_mov_producto_fecha",
        "idx_sales_fecha_prefix",
        "idx_sales_vendedor",
        "uq_clients_codigo",
        "idx_clients_doc_codigo",
        "uq_users_email",
        "idx_users_doc_email",
        "uq_cajas_usuario_abierta",
    ):
        op.execute(f'DROP INDEX IF EXISTS "{name}"')