"""Códigos de autorización y autorizaciones de movimientos.

`codigos_autorizacion`: hash bcrypt del código de 6 dígitos de cada usuario
que puede autorizar (uno por usuario, _id = id del usuario).
`autorizaciones`: autorizaciones de un solo uso emitidas al teclear un código
(por ahora: precio manual en el POS); la venta las marca como usadas.
Misma forma que el resto de colecciones del adaptador pgstore.

Revision ID: 0018_codigos_autorizacion
Revises: 0017_jornadas_vendedores
Create Date: 2026-10-23
"""
from alembic import op

revision = "0018_codigos_autorizacion"
down_revision = "0017_jornadas_vendedores"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for tabla in ("codigos_autorizacion", "autorizaciones"):
        op.execute(f'''
            CREATE TABLE IF NOT EXISTS "{tabla}" (
                "_id" TEXT PRIMARY KEY,
                "id" TEXT,
                "doc" JSONB NOT NULL,
                "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        ''')
        op.execute(f'CREATE INDEX IF NOT EXISTS idx_{tabla}_id ON "{tabla}" ("id")')


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS "autorizaciones"')
    op.execute('DROP TABLE IF EXISTS "codigos_autorizacion"')
