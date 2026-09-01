"""Cargos por interés moratorio en CxC (recalculo de deuda vencida).

Tabla NUEVA (no modifica ninguna existente):

- cxc_cargos: cada aplicación de interés sobre los tickets vencidos de un
  cliente. Conserva la tasa aplicada, el detalle por venta (saldo base,
  días vencido, interés calculado), el total cargado, usuario y nota. Es
  reversible una sola vez (cancelación auditada que recomputa saldos).

Índices:
- INDEX(doc->>'cliente_id')  -> historial de cargos por cliente
- INDEX(doc->>'estado')      -> vivos vs cancelados

Revision ID: 0010_cxc_cargos
Revises: 0009_comprobantes_pago
Create Date: 2026-09-01
"""
from alembic import op

revision = "0010_cxc_cargos"
down_revision = "0009_comprobantes_pago"
branch_labels = None
depends_on = None

_TABLAS = [
    '''CREATE TABLE IF NOT EXISTS "cxc_cargos" (
        "_id" TEXT PRIMARY KEY,
        "id"   TEXT,
        "doc"  JSONB NOT NULL DEFAULT '{}'::jsonb)''',
]

_IDX = [
    'CREATE INDEX IF NOT EXISTS ix_cargos_cliente '
    'ON "cxc_cargos" ((doc->>\'cliente_id\'))',
    'CREATE INDEX IF NOT EXISTS ix_cargos_estado '
    'ON "cxc_cargos" ((doc->>\'estado\'))',
]


def upgrade() -> None:
    for sql in _TABLAS:
        op.execute(sql)
    for sql in _IDX:
        op.execute(sql)


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS "cxc_cargos"')
