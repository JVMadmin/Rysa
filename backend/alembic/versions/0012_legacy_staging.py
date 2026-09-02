"""Tablas legacy_* del staging (FASE 3 del módulo de migración).

Reemplaza los CREATE TABLE IF NOT EXISTS que vivían en
tools/legacy_migration/staging.py:DDL. Los ALTER TABLE ... ADD COLUMN IF NOT EXISTS
para V7+ siguen siendo idempotentes y se dejan en el código legacyadmin/staging
como defensa (no rompen si la columna ya existe).

Revision ID: 0012_legacy_staging
Revises: 0011_legacy_import
Create Date: 2026-09-01
"""
from alembic import op

revision = "0012_legacy_staging"
down_revision = "0011_legacy_import"
branch_labels = None
depends_on = None

_TABLAS = [
    '''CREATE TABLE IF NOT EXISTS legacy_migration_batch (
         batch_id TEXT PRIMARY KEY,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         source_path TEXT,
         source_hash TEXT,
         status TEXT,
         records_discovered BIGINT,
         records_staged BIGINT,
         records_ready BIGINT,
         records_review BIGINT,
         records_excluded BIGINT,
         validations JSONB)''',

    '''CREATE TABLE IF NOT EXISTS legacy_customer_mapping (
         legacy_customer_key TEXT PRIMARY KEY,
         rysa_customer_id TEXT,
         status TEXT,
         match_type TEXT,
         legacy_nombre TEXT,
         legacy_deleted BOOLEAN DEFAULT false,
         last_batch_id TEXT,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now())''',

    '''CREATE TABLE IF NOT EXISTS legacy_product_mapping (
         legacy_product_key TEXT PRIMARY KEY,
         rysa_product_id TEXT,
         mapping_status TEXT,
         legacy_status TEXT,
         last_batch_id TEXT,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now())''',

    '''CREATE TABLE IF NOT EXISTS legacy_tickets (
         legacy_key TEXT PRIMARY KEY,
         legacy_serie TEXT,
         legacy_folio TEXT,
         legacy_cliente TEXT,
         legacy_fecha TEXT,
         legacy_total NUMERIC,
         legacy_condicion TEXT,
         legacy_vendedor TEXT,
         legacy_cancelado BOOLEAN,
         legacy_saldo_original NUMERIC,
         legacy_status TEXT,
         customer_status TEXT,
         source TEXT DEFAULT 'LEGACY',
         is_historical BOOLEAN DEFAULT true,
         legacy_table TEXT DEFAULT 'NOTAVTA',
         doc JSONB,
         migration_status TEXT,
         last_batch_id TEXT,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now())''',

    '''CREATE TABLE IF NOT EXISTS legacy_ticket_details (
         legacy_key TEXT PRIMARY KEY,
         doc_key TEXT,
         partida TEXT,
         legacy_codigo TEXT,
         legacy_cantidad NUMERIC,
         legacy_precio NUMERIC,
         legacy_importe_calculado NUMERIC,
         rysa_product_id TEXT,
         mapping_status TEXT,
         source TEXT DEFAULT 'LEGACY',
         legacy_table TEXT DEFAULT 'NVTAPAR',
         doc JSONB,
         last_batch_id TEXT,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now())''',

    '''CREATE TABLE IF NOT EXISTS legacy_cxc_snapshot (
         legacy_key TEXT PRIMARY KEY,
         legacy_serie TEXT,
         legacy_folio TEXT,
         legacy_cliente TEXT,
         legacy_condicion TEXT,
         legacy_saldo NUMERIC,
         calculated_saldo NUMERIC,
         difference NUMERIC,
         movement_count INT,
         deleted_movement_count INT,
         c_total NUMERIC,
         a_total NUMERIC,
         cancelado BOOLEAN,
         source TEXT DEFAULT 'LEGACY',
         legacy_table TEXT DEFAULT 'CXCDOCS',
         status TEXT,
         review_reason TEXT,
         last_batch_id TEXT,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now())''',

    '''CREATE TABLE IF NOT EXISTS legacy_cxc_movements (
         legacy_key TEXT PRIMARY KEY,
         doc_key TEXT,
         serie TEXT,
         folio TEXT,
         foliomovto TEXT,
         movto TEXT,
         cliente TEXT,
         monto NUMERIC,
         aplica TEXT,
         concepto TEXT,
         condicion TEXT,
         deleted BOOLEAN,
         legacy_table TEXT DEFAULT 'CUENXCOB',
         last_batch_id TEXT,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now())''',

    '''CREATE TABLE IF NOT EXISTS legacy_excluded_documents (
         legacy_key TEXT PRIMARY KEY,
         entity TEXT,
         serie TEXT,
         folio TEXT,
         reason TEXT DEFAULT 'FACTURA_SERIE_F',
         scope_status TEXT DEFAULT 'EXCLUDED_SCOPE',
         payload JSONB,
         last_batch_id TEXT,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now())''',

    '''CREATE TABLE IF NOT EXISTS legacy_review_queue (
         legacy_key TEXT,
         entity TEXT,
         reason TEXT,
         detail JSONB,
         status TEXT DEFAULT 'PENDING',
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         last_batch_id TEXT,
         PRIMARY KEY (entity, legacy_key, reason))''',

    # Las V2 (legacy_snapshots y legacy_client_balance) ya están en 0011
    # pero las recreamos con IF NOT EXISTS para que staging.py siga funcionando
    # si se ejecuta antes de que la migración los haya creado (defensa).
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
    'CREATE INDEX IF NOT EXISTS idx_ltix_tickets_folio ON legacy_tickets (legacy_serie, legacy_folio)',
    'CREATE INDEX IF NOT EXISTS idx_ltix_details_doc ON legacy_ticket_details (doc_key)',
    'CREATE INDEX IF NOT EXISTS idx_ltix_cxc_status ON legacy_cxc_snapshot (status)',
    'CREATE INDEX IF NOT EXISTS idx_ltix_cxcmov_doc ON legacy_cxc_movements (doc_key)',
    'CREATE INDEX IF NOT EXISTS idx_ltix_review_entity ON legacy_review_queue (entity, status)',
    'CREATE INDEX IF NOT EXISTS idx_ltix_balance_estado ON legacy_client_balance (snapshot_id, estado)',
    'CREATE INDEX IF NOT EXISTS idx_ltix_balance_key ON legacy_client_balance (legacy_customer_key)',
]


def upgrade() -> None:
    for sql in _TABLAS:
        op.execute(sql)
    for sql in _IDX:
        op.execute(sql)


def downgrade() -> None:
    for idx in [
        'idx_ltix_balance_key', 'idx_ltix_balance_estado',
        'idx_ltix_review_entity', 'idx_ltix_cxcmov_doc',
        'idx_ltix_cxc_status', 'idx_ltix_details_doc',
        'idx_ltix_tickets_folio',
    ]:
        op.execute(f'DROP INDEX IF EXISTS {idx}')
    for t in [
        'legacy_client_balance', 'legacy_snapshots', 'legacy_review_queue',
        'legacy_excluded_documents', 'legacy_cxc_movements', 'legacy_cxc_snapshot',
        'legacy_ticket_details', 'legacy_tickets', 'legacy_product_mapping',
        'legacy_customer_mapping', 'legacy_migration_batch',
    ]:
        op.execute(f'DROP TABLE IF EXISTS {t}')
