"""WhatsApp del ERP y Agente RYSA: conversaciones y mensajes.

wa_conversaciones: una por chat (id = chatId de WhatsApp), con modo bot/humano,
notas (memoria del contacto) y cliente ligado. wa_mensajes: cada mensaje con
su origen (cliente, bot, humano). Misma forma que el resto de colecciones del
adaptador pgstore (_id, id, doc JSONB, created_at).

Revision ID: 0019_whatsapp_agente
Revises: 0018_codigos_autorizacion
Create Date: 2026-10-24
"""
from alembic import op

revision = "0019_whatsapp_agente"
down_revision = "0018_codigos_autorizacion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for tabla in ("wa_conversaciones", "wa_mensajes"):
        op.execute(f'''
            CREATE TABLE IF NOT EXISTS "{tabla}" (
                "_id" TEXT PRIMARY KEY,
                "id" TEXT,
                "doc" JSONB NOT NULL,
                "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        ''')
        op.execute(f'CREATE INDEX IF NOT EXISTS idx_{tabla}_id ON "{tabla}" ("id")')
    op.execute('''CREATE INDEX IF NOT EXISTS idx_wa_mensajes_chat_fecha
                  ON "wa_mensajes" ((doc->>'chat_id'), (doc->>'fecha'))''')
    op.execute('''CREATE INDEX IF NOT EXISTS idx_wa_mensajes_wa_id ON "wa_mensajes" ((doc->>'wa_id'))''')


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS "wa_mensajes"')
    op.execute('DROP TABLE IF EXISTS "wa_conversaciones"')
