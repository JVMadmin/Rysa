"""Jornadas de la app de vendedores.

Cada login de la app (POST /auth/login-movil) abre una jornada que vence a
las 23:59 (hora del centro de México); "Cerrar jornada" la cierra con la hora
y el número de ubicaciones enviadas en el día. Misma forma que el resto de
colecciones del adaptador pgstore (_id, id, doc JSONB, created_at).

Revision ID: 0017_jornadas_vendedores
Revises: 0016_formatos_activos
Create Date: 2026-10-22
"""
from alembic import op

revision = "0017_jornadas_vendedores"
down_revision = "0016_formatos_activos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('''
        CREATE TABLE IF NOT EXISTS "jornadas" (
            "_id" TEXT PRIMARY KEY,
            "id" TEXT,
            "doc" JSONB NOT NULL,
            "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    ''')
    op.execute('CREATE INDEX IF NOT EXISTS idx_jornadas_id ON "jornadas" ("id")')
    op.execute('''CREATE INDEX IF NOT EXISTS idx_jornadas_vendedor_estado
                  ON "jornadas" ((doc->>'vendedor_id'), (doc->>'estado'))''')


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS "jornadas"')
