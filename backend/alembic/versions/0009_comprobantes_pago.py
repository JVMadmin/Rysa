"""Comprobantes de pago por QR en cotizaciones (tokens + evidencias).

Tablas NUEVAS (no modifica ninguna existente):

- cot_pago_tokens : enlace/QR por cotización. Se guarda el hash SHA-256 del
  token para lookup público (el token crudo vive solo en la URL/PDF) junto
  con estado (activo|revocado), expiración y trazabilidad de quién lo creó.

- payment_evidence: comprobantes enviados por clientes desde la página
  pública del QR. Estado pendiente|aprobando|aprobado|rechazado, datos del
  archivo validado, método/referencia declarados y trazabilidad de revisión.

Índices clave:
- UNIQUE(doc->>'token_hash')                       -> lookup público O(1)
- INDEX(doc->>'cotizacion_id')                     -> historial por cotización
- UNIQUE parcial (cotizacion,metodo,referencia)    -> anti-duplicados §25,
  aplicada SOLO cuando hay referencia y el estado no es rechazado.

Revision ID: 0009_comprobantes_pago
Revises: 0008_integridad_indices
Create Date: 2026-08-25
"""
from alembic import op

revision = "0009_comprobantes_pago"
down_revision = "0008_integridad_indices"
branch_labels = None
depends_on = None

_TABLAS = [
    '''CREATE TABLE IF NOT EXISTS "cot_pago_tokens" (
        "_id" TEXT PRIMARY KEY,
        "id"   TEXT,
        "doc"  JSONB NOT NULL DEFAULT '{}'::jsonb)''',
    '''CREATE TABLE IF NOT EXISTS "payment_evidence" (
        "_id" TEXT PRIMARY KEY,
        "id"   TEXT,
        "doc"  JSONB NOT NULL DEFAULT '{}'::jsonb)''',
]

_IDX = [
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_cpt_token_hash '
    'ON "cot_pago_tokens" ((doc->>\'token_hash\'))',
    'CREATE INDEX IF NOT EXISTS ix_cpt_cotizacion '
    'ON "cot_pago_tokens" ((doc->>\'cotizacion_id\'))',
    'CREATE INDEX IF NOT EXISTS ix_pe_cotizacion '
    'ON "payment_evidence" ((doc->>\'cotizacion_id\'))',
    'CREATE INDEX IF NOT EXISTS ix_pe_estado '
    'ON "payment_evidence" ((doc->>\'estado\'))',
    # Anti-duplicados §25: misma cotización + método + referencia no puede
    # tener dos comprobantes vivos (pendiente/aprobando/aprobado). Solo aplica
    # cuando el cliente escribió referencia.
    '''CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_cot_met_ref_viva
       ON "payment_evidence" ((doc->>'cotizacion_id'),
                              (doc->>'metodo'),
                              (doc->>'referencia'))
       WHERE COALESCE(doc->>'referencia', '') <> ''
         AND doc->>'estado' IN ('pendiente', 'aprobando', 'aprobado')''',
]


def upgrade() -> None:
    for sql in _TABLAS:
        op.execute(sql)
    for sql in _IDX:
        op.execute(sql)


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS "payment_evidence"')
    op.execute('DROP TABLE IF EXISTS "cot_pago_tokens"')
