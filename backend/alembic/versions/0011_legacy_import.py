"""Tablas legacy_* del backend (namespace del importador).

Cubre las 5 tablas que antes vivían como DDL inline en
backend/legacyadmin.py:_DDL/_IDX. Mantener la migración sincronizada con
el código y nunca reintroducir CREATE TABLE IF NOT EXISTS fuera de aquí.

Revision ID: 0011_legacy_import
Revises: 0010_cxc_cargos
Create Date: 2026-09-01
"""
from alembic import op

revision = "0011_legacy_import"
down_revision = "0010_cxc_cargos"
branch_labels = None
depends_on = None

_TABLAS = [
    '''CREATE TABLE IF NOT EXISTS legacy_import_batch (
         batch_id TEXT PRIMARY KEY,
         staging_batch_id TEXT,
         started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         finished_at TIMESTAMPTZ,
         status TEXT NOT NULL DEFAULT 'PENDING',
         phase TEXT DEFAULT '',
         tickets_imported BIGINT DEFAULT 0,
         details_imported BIGINT DEFAULT 0,
         cxc_imported BIGINT DEFAULT 0,
         cxc_saldo_total NUMERIC DEFAULT 0,
         clientes_saldo_actualizados INT DEFAULT 0,
         skipped_duplicates BIGINT DEFAULT 0,
         cxc_sin_cliente_rysa INT DEFAULT 0,
         errors INT DEFAULT 0,
         error_detail TEXT DEFAULT '',
         validations JSONB,
         created_by TEXT)''',

    '''CREATE TABLE IF NOT EXISTS legacy_import_audit (
         id BIGSERIAL PRIMARY KEY,
         batch_id TEXT NOT NULL,
         kind TEXT NOT NULL,
         entity_key TEXT,
         payload JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now())''',

    '''CREATE TABLE IF NOT EXISTS legacy_import_backup (
         id BIGSERIAL PRIMARY KEY,
         batch_id TEXT NOT NULL,
         kind TEXT NOT NULL,
         entity_key TEXT,
         payload JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now())''',

    '''CREATE TABLE IF NOT EXISTS legacy_snapshots (
         snapshot_id TEXT PRIMARY KEY,
         batch_id TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         source_path TEXT,
         source_hash TEXT,
         files_count INT,
         notes TEXT)''',

    '''CREATE TABLE IF NOT EXISTS legacy_client_balance (
         snapshot_id TEXT,
         legacy_customer_key TEXT,
         legacy_nombre TEXT,
         master_saldo NUMERIC,
         docs_saldo NUMERIC,
         ledger_saldo NUMERIC,
         diff_docs NUMERIC,
         diff_ledger NUMERIC,
         estado TEXT,
         rysa_customer_id TEXT,
         last_batch_id TEXT,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         PRIMARY KEY (snapshot_id, legacy_customer_key))''',
]

_IDX = [
    'CREATE INDEX IF NOT EXISTS idx_limp_batch ON legacy_import_audit (batch_id)',
    'CREATE INDEX IF NOT EXISTS idx_lbackup_batch ON legacy_import_backup (batch_id)',
    # índice parcial para acelerar queries por source=LEGACY
    "CREATE INDEX IF NOT EXISTS idx_sales_legacy ON sales ((doc->>'source')) "
    "WHERE doc->>'source' = 'LEGACY'",
]


def upgrade() -> None:
    for sql in _TABLAS:
        op.execute(sql)
    for sql in _IDX:
        op.execute(sql)


def downgrade() -> None:
    # El índice sobre sales es la única dependencia de una tabla productiva.
    op.execute('DROP INDEX IF EXISTS idx_sales_legacy')
    op.execute('DROP TABLE IF EXISTS legacy_client_balance')
    op.execute('DROP TABLE IF EXISTS legacy_snapshots')
    op.execute('DROP TABLE IF EXISTS legacy_import_backup')
    op.execute('DROP TABLE IF EXISTS legacy_import_audit')
    op.execute('DROP TABLE IF EXISTS legacy_import_batch')
