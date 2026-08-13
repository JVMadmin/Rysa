"""sale_idempotency: idempotencia de ventas POS

Revision ID: 0002_sale_idempotency
Revises: 0001_initial
Create Date: 2026-08-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_sale_idempotency"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        'CREATE TABLE IF NOT EXISTS "sale_idempotency" ('
        '"idempotency_key" TEXT PRIMARY KEY, "sale_id" TEXT NOT NULL,'
        '"created_at" TIMESTAMPTZ NOT NULL DEFAULT now())'
    )


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS "sale_idempotency"')
