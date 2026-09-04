"""Tablas para Reemplazo Total de Datos, Snapshots y Rollback.

Revision ID: 0015_import_total_replacement
Revises: 0014_document_templates
Create Date: 2026-09-03
"""
from alembic import op

revision = "0015_import_total_replacement"
down_revision = "0014_document_templates"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.execute('''
        CREATE TABLE IF NOT EXISTS import_batches (
            batch_id TEXT PRIMARY KEY,
            tipo TEXT NOT NULL DEFAULT 'TOTAL_ZIP',
            estado TEXT NOT NULL DEFAULT 'UPLOADED',
            usuario_id TEXT,
            usuario_nombre TEXT,
            archivo_nombre TEXT,
            estadisticas JSONB,
            errores JSONB,
            warnings JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            applied_at TIMESTAMPTZ
        );
    ''')
    op.execute('''
        CREATE TABLE IF NOT EXISTS import_snapshots (
            id TEXT PRIMARY KEY,
            batch_id TEXT NOT NULL REFERENCES import_batches(batch_id) ON DELETE CASCADE,
            tabla TEXT NOT NULL,
            registro_id TEXT NOT NULL,
            estado_previo JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    ''')
    op.execute('CREATE INDEX IF NOT EXISTS idx_imp_snap_batch ON import_snapshots (batch_id);')
    op.execute('CREATE INDEX IF NOT EXISTS idx_imp_snap_tabla ON import_snapshots (tabla, registro_id);')

def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS import_snapshots CASCADE;')
    op.execute('DROP TABLE IF EXISTS import_batches CASCADE;')
