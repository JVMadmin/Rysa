"""Constructor visual de machotes y versiones documentales.

Revision ID: 0014_document_templates
Revises: 0013_product_presentations
Create Date: 2026-09-03
"""
import json
from alembic import op

revision = "0014_document_templates"
down_revision = "0013_product_presentations"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.execute('''
        CREATE TABLE IF NOT EXISTS document_templates (
            id TEXT PRIMARY KEY,
            tipo TEXT NOT NULL,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            activo BOOLEAN NOT NULL DEFAULT TRUE,
            version_actual INTEGER NOT NULL DEFAULT 1,
            sucursal_id TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_template_tipo_nombre UNIQUE (tipo, nombre)
        );
    ''')
    op.execute('''
        CREATE TABLE IF NOT EXISTS document_template_versions (
            id TEXT PRIMARY KEY,
            template_id TEXT NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
            version INTEGER NOT NULL,
            formato_fisico TEXT NOT NULL DEFAULT '80mm',
            configuracion JSONB NOT NULL,
            estado TEXT NOT NULL DEFAULT 'ACTIVO',
            creado_por TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_template_version UNIQUE (template_id, version)
        );
    ''')
    op.execute('CREATE INDEX IF NOT EXISTS idx_tpl_tipo ON document_templates (tipo);')
    op.execute('CREATE INDEX IF NOT EXISTS idx_tpl_ver_template ON document_template_versions (template_id);')

    # Sembrar plantillas base de fábrica
    # 1. Ticket de venta (80mm)
    cfg_ticket = {
        "formato_fisico": "80mm",
        "margenes": {"arriba": 3, "abajo": 3, "izquierda": 3, "derecha": 3},
        "fuente": "Helvetica",
        "elementos": [
            {"id": "el_logo", "tipo": "logo", "align": "center", "visible": True},
            {"id": "el_empresa", "tipo": "empresa", "align": "center", "bold": True, "font_size": 11, "visible": True},
            {"id": "el_rfc", "tipo": "campo", "contenido": "RFC: {{empresa.rfc}}", "align": "center", "font_size": 8, "visible": True},
            {"id": "el_dir", "tipo": "campo", "contenido": "{{empresa.direccion}}", "align": "center", "font_size": 8, "visible": True},
            {"id": "el_tel", "tipo": "campo", "contenido": "Tel: {{empresa.telefono}}", "align": "center", "font_size": 8, "visible": True},
            {"id": "el_sep1", "tipo": "separador", "visible": True},
            {"id": "el_folio", "tipo": "campo", "contenido": "Folio: {{doc.folio}}", "align": "left", "bold": True, "font_size": 9, "visible": True},
            {"id": "el_fecha", "tipo": "campo", "contenido": "Fecha: {{doc.fecha}} {{doc.hora}}", "align": "left", "font_size": 8, "visible": True},
            {"id": "el_cliente", "tipo": "campo", "contenido": "Cliente: {{cliente.nombre}}", "align": "left", "font_size": 8, "visible": True},
            {"id": "el_sep2", "tipo": "separador", "visible": True},
            {"id": "el_items", "tipo": "tabla_productos", "visible": True, "columnas": [
                {"campo": "cantidad", "titulo": "CANT", "ancho_pct": 15, "align": "left"},
                {"campo": "descripcion", "titulo": "DESCRIPCIÓN", "ancho_pct": 50, "align": "left"},
                {"campo": "precio", "titulo": "PRECIO", "ancho_pct": 15, "align": "right"},
                {"campo": "importe", "titulo": "TOTAL", "ancho_pct": 20, "align": "right"}
            ]},
            {"id": "el_sep3", "tipo": "separador", "visible": True},
            {"id": "el_subtotal", "tipo": "totales_linea", "etiqueta": "SUBTOTAL", "valor": "{{doc.subtotal}}", "visible": True},
            {"id": "el_iva", "tipo": "totales_linea", "etiqueta": "IVA", "valor": "{{doc.iva}}", "visible": True},
            {"id": "el_total", "tipo": "totales_linea", "etiqueta": "TOTAL", "valor": "{{doc.total}}", "bold": True, "font_size": 11, "visible": True},
            {"id": "el_letra", "tipo": "campo", "contenido": "({{doc.total_letra}})", "align": "center", "font_size": 7, "visible": True},
            {"id": "el_sep4", "tipo": "separador", "visible": True},
            {"id": "el_pie", "tipo": "texto", "contenido": "¡Gracias por su compra!", "align": "center", "font_size": 8, "visible": True},
            {"id": "el_qr", "tipo": "qr", "contenido": "{{doc.qr_url}}", "align": "center", "visible": True}
        ]
    }

    # 2. Carta de Venta / Nota de Entrega (Carta)
    cfg_carta = {
        "formato_fisico": "carta",
        "margenes": {"arriba": 15, "abajo": 15, "izquierda": 15, "derecha": 15},
        "fuente": "Helvetica",
        "elementos": [
            {"id": "c_encabezado", "tipo": "encabezado_empresa", "visible": True},
            {"id": "c_datos_doc", "tipo": "datos_documento", "visible": True},
            {"id": "c_cliente", "tipo": "datos_cliente", "visible": True},
            {"id": "c_tabla", "tipo": "tabla_productos", "visible": True, "columnas": [
                {"campo": "codigo", "titulo": "CÓDIGO", "ancho_pct": 15, "align": "left"},
                {"campo": "descripcion", "titulo": "DESCRIPCIÓN", "ancho_pct": 40, "align": "left"},
                {"campo": "presentacion", "titulo": "PRESENTACIÓN", "ancho_pct": 15, "align": "center"},
                {"campo": "cantidad", "titulo": "CANTIDAD", "ancho_pct": 10, "align": "right"},
                {"campo": "precio", "titulo": "PRECIO UNIT.", "ancho_pct": 10, "align": "right"},
                {"campo": "importe", "titulo": "IMPORTE", "ancho_pct": 10, "align": "right"}
            ]},
            {"id": "c_totales", "tipo": "bloque_totales", "visible": True},
            {"id": "c_firmas", "tipo": "bloque_firmas", "leyenda": "Recibí de conformidad", "visible": True}
        ]
    }

    raw_ticket = json.dumps(cfg_ticket).replace("'", "''")
    raw_carta = json.dumps(cfg_carta).replace("'", "''")

    op.execute(f'''
        INSERT INTO document_templates (id, tipo, nombre, descripcion, activo, version_actual, created_at, updated_at)
        VALUES 
            ('tpl_ticket_default', 'ticket', 'Ticket Estándar 80mm', 'Plantilla predeterminada de ticket para punto de venta', TRUE, 1, now(), now()),
            ('tpl_carta_default', 'carta_venta', 'Nota de Venta Tamaño Carta', 'Formato profesional tamaño carta con desglose completo y firmas', TRUE, 1, now(), now())
        ON CONFLICT (tipo, nombre) DO NOTHING;
    ''')

    op.execute(f'''
        INSERT INTO document_template_versions (id, template_id, version, formato_fisico, configuracion, estado, creado_por, created_at)
        VALUES 
            ('ver_ticket_1', 'tpl_ticket_default', 1, '80mm', '{raw_ticket}'::jsonb, 'ACTIVO', 'sistema', now()),
            ('ver_carta_1', 'tpl_carta_default', 1, 'carta', '{raw_carta}'::jsonb, 'ACTIVO', 'sistema', now())
        ON CONFLICT (template_id, version) DO NOTHING;
    ''')

def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS document_template_versions CASCADE;')
    op.execute('DROP TABLE IF EXISTS document_templates CASCADE;')
