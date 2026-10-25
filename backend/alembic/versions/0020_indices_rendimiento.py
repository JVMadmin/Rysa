"""Índices de rendimiento (pruebas de carga del 25-oct-2026).

Con 66k ventas, CxC por cliente, cierre de caja, búsqueda por folio, ventas
del mes, supervisión de campo y archivos recorrían la tabla completa. Las
expresiones coinciden con las que genera pgstore.adapter.compile_filter
(`t.doc->>'campo'` y columnas tipadas como `saldo`).

El índice de fecha que ya existía (`text_pattern_ops`) no sirve para rangos
ni para ORDER BY con la collation en_US de la base; este sí.

Las tablas que el adaptador crea al primer uso pueden no existir todavía: en
ese caso se omiten (la próxima migración o el arranque las indexa).

Revision ID: 0020_indices_rendimiento
Revises: 0019_whatsapp_agente
Create Date: 2026-10-25
"""
from alembic import op
from sqlalchemy import text

revision = "0020_indices_rendimiento"
down_revision = "0019_whatsapp_agente"
branch_labels = None
depends_on = None

INDICES = [
    # sales
    ("sales", "idx_sales_fecha", "((doc->>'fecha'))"),
    ("sales", "idx_sales_cliente_fecha", "((doc->>'cliente_id'), (doc->>'fecha'))"),
    ("sales", "idx_sales_caja", "((doc->>'caja_id'))"),
    ("sales", "idx_sales_vendedor_fecha", "((doc->>'vendedor_id'), (doc->>'fecha'))"),
    ("sales", "idx_sales_folio", "((doc->>'folio'))"),
    ("sales", "idx_sales_tipo_fecha", "((doc->>'tipo_venta'), (doc->>'fecha'))"),
    ("sales", "idx_sales_saldo_pend", "(saldo) WHERE saldo > 0"),
    # abonos, caja, campo, archivos, autorizaciones, pedidos
    ("abonos", "idx_abonos_fecha", "((doc->>'fecha'))"),
    ("abonos", "idx_abonos_usuario_fecha", "((doc->>'usuario_id'), (doc->>'fecha'))"),
    ("caja_movimientos", "idx_caja_mov_caja", "((doc->>'caja_id'))"),
    ("seller_locations", "idx_seller_loc_vend_fecha", "((doc->>'vendedor_id'), (doc->>'fecha'))"),
    ("visits", "idx_visits_vend_fecha", "((doc->>'vendedor_id'), (doc->>'fecha'))"),
    ("visits", "idx_visits_cliente", "((doc->>'cliente_id'))"),
    ("files", "idx_files_storage_path", "((doc->>'storage_path'))"),
    ("autorizaciones", "idx_autz_estado", "((doc->>'estado'))"),
    ("pedidos", "idx_pedidos_idem", "((doc->>'idempotency_key'))"),
    ("pedidos", "idx_pedidos_cliente", "((doc->>'cliente_id'))"),
    ("inventory_movements", "idx_invmov_producto_fecha", "((doc->>'product_id'), (doc->>'fecha'))"),
    ("legacy_tickets", "idx_ltix_cliente_fecha", "(legacy_cliente, legacy_fecha DESC)"),
]

# Búsqueda de ventas por folio o cliente con "contiene" (~*): índice trigram.
TRIGRAM = [
    ("sales", "idx_sales_folio_trgm", "((doc->>'folio') gin_trgm_ops)"),
    ("sales", "idx_sales_cliente_trgm", "((doc->>'cliente_nombre') gin_trgm_ops)"),
]


def _existe(conn, tabla: str) -> bool:
    return conn.execute(text("SELECT to_regclass(:t)"), {"t": f"public.{tabla}"}).scalar() is not None


def upgrade() -> None:
    conn = op.get_bind()
    for tabla, nombre, expr in INDICES:
        if _existe(conn, tabla):
            op.execute(f'CREATE INDEX IF NOT EXISTS {nombre} ON "{tabla}" {expr}')
    try:
        with conn.begin_nested():  # savepoint: si falla no aborta la migración
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        trigram = True
    except Exception:  # sin permiso para extensiones: la búsqueda funciona igual, sin índice
        trigram = False
    if trigram:
        for tabla, nombre, expr in TRIGRAM:
            if _existe(conn, tabla):
                op.execute(f'CREATE INDEX IF NOT EXISTS {nombre} ON "{tabla}" USING gin {expr}')
    op.execute("ANALYZE sales")


def downgrade() -> None:
    for tabla, nombre, _ in INDICES + TRIGRAM:
        op.execute(f"DROP INDEX IF EXISTS {nombre}")
