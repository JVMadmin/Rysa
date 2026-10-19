"""Editor de formatos v2: formato activo por tipo de documento y notas de versión.

- document_template_activos: qué plantilla personalizada usa cada tipo de
  documento (ticket, carta_venta, cotizacion, abono, compra, entrega). Sin
  fila = se usa el PREDETERMINADO DEL SISTEMA (generadores de storage.py),
  que nunca se modifica y siempre se puede restaurar.
- document_template_versions.nota: comentario opcional de cada versión.
- Se eliminan las plantillas de EJEMPLO sembradas por 0014 (y por scripts
  manuales) que nunca se editaron: tenían esquema v1 (solo simulador) y
  ningún documento real las usaba. Cualquier plantilla con ediciones de un
  usuario se conserva.

Revision ID: 0016_formatos_activos
Revises: 0015_import_total_replacement
Create Date: 2026-10-19
"""
from alembic import op

revision = "0016_formatos_activos"
down_revision = "0015_import_total_replacement"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('''
        CREATE TABLE IF NOT EXISTS document_template_activos (
            tipo TEXT PRIMARY KEY,
            template_id TEXT NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
            activado_por TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    ''')
    op.execute('ALTER TABLE document_template_versions ADD COLUMN IF NOT EXISTS nota TEXT;')
    op.execute('''
        DELETE FROM document_templates t
        WHERE t.version_actual = 1
          AND NOT EXISTS (
              SELECT 1 FROM document_template_versions v
              WHERE v.template_id = t.id
                AND COALESCE(v.creado_por, 'sistema') <> 'sistema'
          )
          AND NOT EXISTS (
              SELECT 1 FROM document_template_versions v
              WHERE v.template_id = t.id
                AND v.configuracion ? 'bloques'
          );
    ''')


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS document_template_activos;')
    op.execute('ALTER TABLE document_template_versions DROP COLUMN IF EXISTS nota;')
