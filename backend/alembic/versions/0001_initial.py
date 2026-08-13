"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-08-12
"""
import sys
from pathlib import Path
from alembic import op
import sqlalchemy as sa

_BACKEND = Path(__file__).resolve().parent.parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from pgstore.adapter import (  # noqa: E402
    KNOWN_COLLECTIONS, build_create_table, build_index_ddl,
)

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    for col in KNOWN_COLLECTIONS:
        if col == "counters":
            continue
        op.execute(build_create_table(col))
        op.execute(build_index_ddl(col))
    op.execute(
        'CREATE TABLE IF NOT EXISTS "sequences" ('
        '"name" TEXT PRIMARY KEY, "seq" BIGINT NOT NULL DEFAULT 0)'
    )


def downgrade() -> None:
    for col in KNOWN_COLLECTIONS:
        if col == "counters":
            continue
        op.execute(f'DROP TABLE IF EXISTS "{col}"')
    op.execute('DROP TABLE IF EXISTS "sequences"')
