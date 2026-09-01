"""Migración Legacy — módulo administrativo de IMPORTACIÓN (FASE 5).

Construye la infraestructura de importación controlada del histórico Legacy
(staging → producción) y su consulta en RYSA. La importación NUNCA se
ejecuta sola: solo mediante POST /legacy/import con doble confirmación,
validaciones previas en verde y capas de permiso.

Protecciones (todas obligatorias para importar):
    1. ENVIRONMENT != production  (404 en producción, igual que /dev/*)
    2. DEVELOPER_MODE = true
    3. LEGACY_MIGRATION_ENABLED = true (interruptor específico de migración)
    4. Usuario autenticado con rol 'admin_desarrollador'
    5. Confirmación textual exacta: "IMPORTAR LEGACY"
    6. Validaciones pre-import (staging íntegro, identidad, mapping, backup)

Garantías de la importación (V2, auditoría forense 2026-08-30):
    * SOLO toca: sales (docs source=LEGACY, capa documental/histórica con su
      saldo para FIFO) + sus propias tablas legacy_import_*.  NUNCA inventario,
      caja, abonos históricos ni FIFO.
    * clients.saldo NUNCA se modifica por el import: el maestro legacy
      (CLIENTES.SALDO) ya fue importado con la migración de clientes; aplicar
      el "delta CxC READY" duplicaría la deuda (~$789K).
    * Idempotente: INSERT ... ON CONFLICT DO NOTHING por clave legacy.
    * Chunks configurables (LEGACY_IMPORT_CHUNK, default 1000) con progreso
      persistido en legacy_import_batch.
    * Rollback completo por batch (borra sales LEGACY del batch; no hay deltas
      de saldo que revertir bajo la política V2).
    * Validación post-import incluye clients_saldo_intacto (antes/después).
    * Auditoría en audit_logs + legacy_import_audit.
"""
import asyncio
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Body, UploadFile, File
from sqlalchemy import text

import pgstore  # noqa: F401  (mantiene el patrón de los módulos del backend)
from pgstore.database import transaction, get_engine
from deps import require_permission, iso_now, get_current_user

router = APIRouter(prefix="/api")

_APP_ENV = os.environ.get("ENVIRONMENT", "development").lower()
_raw_mode = os.environ.get("DEVELOPER_MODE", "").strip().lower()
DEVELOPER_MODE = _raw_mode in ("true", "1", "on", "yes") or (
    not _raw_mode and _APP_ENV != "production")
_raw_enabled = os.environ.get("LEGACY_MIGRATION_ENABLED", "").strip().lower()
LEGACY_ENABLED = _raw_enabled in ("true", "1", "on", "yes")
DEV_ROLE = "admin_desarrollador"
CONFIRMACION_IMPORT = "IMPORTAR LEGACY"
CONFIRMACION_ROLLBACK = "REVERTIR LEGACY"


# --------------------------------------------------------------------------- #
# Guardas                                                                     #
# --------------------------------------------------------------------------- #
async def legacy_read(user: dict = Depends(require_permission("dev.info"))):
    """Lectura del módulo: permiso dev.info; 404 en producción."""
    if _APP_ENV == "production":
        raise HTTPException(status_code=404, detail="No encontrado")
    return user


async def legacy_admin(user: dict = Depends(require_permission("developer_tools"))):
    """Operaciones de importación: TODAS las capas deben cumplirse."""
    if _APP_ENV == "production":
        raise HTTPException(status_code=404, detail="No encontrado")
    if not DEVELOPER_MODE:
        raise HTTPException(status_code=403, detail="DEVELOPER_MODE está desactivado")
    if not LEGACY_ENABLED:
        raise HTTPException(status_code=403, detail=(
            "LEGACY_MIGRATION_ENABLED=false: la importación Legacy está "
            "deshabilitada en este entorno"))
    if user.get("role") != DEV_ROLE:
        raise HTTPException(status_code=403,
                            detail="Se requiere el rol admin_desarrollador")
    return user


async def legacy_query(user: dict = Depends(require_permission("cxc.ver"))):
    """Consulta ligera para módulos operativos (CxC): usuario autenticado
    con permiso de ver cartera."""
    return user


# --------------------------------------------------------------------------- #
# DDL de las tablas de importación (auto-instalables, namespace legacy_*)      #
# --------------------------------------------------------------------------- #
_DDL = [
    """CREATE TABLE IF NOT EXISTS legacy_import_batch (
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
         created_by TEXT)""",
    """ALTER TABLE legacy_import_batch ADD COLUMN IF NOT EXISTS validations JSONB""",
    """CREATE TABLE IF NOT EXISTS legacy_import_audit (
         id BIGSERIAL PRIMARY KEY,
         batch_id TEXT NOT NULL,
         kind TEXT NOT NULL,
         entity_key TEXT,
         payload JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    """CREATE TABLE IF NOT EXISTS legacy_import_backup (
         id BIGSERIAL PRIMARY KEY,
         batch_id TEXT NOT NULL,
         kind TEXT NOT NULL,
         entity_key TEXT,
         payload JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    # ---------------- V2: snapshots versionados + saldo maestro ----------------
    """CREATE TABLE IF NOT EXISTS legacy_snapshots (
         snapshot_id TEXT PRIMARY KEY, batch_id TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         source_path TEXT, source_hash TEXT, files_count INT, notes TEXT)""",
    """CREATE TABLE IF NOT EXISTS legacy_client_balance (
         snapshot_id TEXT, legacy_customer_key TEXT, legacy_nombre TEXT,
         master_saldo NUMERIC, docs_saldo NUMERIC, ledger_saldo NUMERIC,
         diff_docs NUMERIC, diff_ledger NUMERIC, estado TEXT,
         rysa_customer_id TEXT, last_batch_id TEXT,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         PRIMARY KEY (snapshot_id, legacy_customer_key))""",
]
_IDX = [
    "CREATE INDEX IF NOT EXISTS idx_limp_batch ON legacy_import_audit (batch_id)",
    "CREATE INDEX IF NOT EXISTS idx_lbackup_batch ON legacy_import_backup (batch_id)",
    "CREATE INDEX IF NOT EXISTS idx_sales_legacy ON sales ((doc->>'source')) "
    "WHERE doc->>'source' = 'LEGACY'",
]


async def _ensure_tables():
    eng = get_engine()
    async with eng.begin() as conn:
        for ddl in _DDL:
            await conn.execute(text(ddl))
        for ix in _IDX:
            await conn.execute(text(ix))


# --------------------------------------------------------------------------- #
# Estado / dashboard                                                          #
# --------------------------------------------------------------------------- #
async def _status_payload(conn) -> dict:
    async def one(sql: str):
        r = await conn.execute(text(sql))
        return r.scalar() or 0

    staging_ok = await one(
        "SELECT count(*) FROM information_schema.tables "
        "WHERE table_name = 'legacy_tickets'")
    tickets = await one("SELECT count(*) FROM legacy_tickets") if staging_ok else 0
    details = await one("SELECT count(*) FROM legacy_ticket_details") if staging_ok else 0
    cxc_ready = await one(
        "SELECT count(*) FROM legacy_cxc_snapshot WHERE status='READY' "
        "AND legacy_saldo > 0.01") if staging_ok else 0
    cxc_saldo = float(await one(
        "SELECT COALESCE(sum(legacy_saldo),0) FROM legacy_cxc_snapshot "
        "WHERE status='READY' AND legacy_saldo > 0.01")) if staging_ok else 0.0
    cxc_review = await one(
        "SELECT count(*) FROM legacy_cxc_snapshot "
        "WHERE status='REVIEW_REQUIRED'") if staging_ok else 0
    cxc_negative = await one(
        "SELECT count(*) FROM legacy_cxc_snapshot "
        "WHERE status='NEGATIVE'") if staging_ok else 0
    cxc_excluded = await one(
        "SELECT count(*) FROM legacy_cxc_snapshot "
        "WHERE status='EXCLUDED'") if staging_ok else 0
    products_pending = await one(
        "SELECT count(*) FROM legacy_product_mapping "
        "WHERE mapping_status='PRODUCT_REVIEW_REQUIRED'") if staging_ok else 0
    prod = {
        "clients": await one("SELECT count(*) FROM clients"),
        "sales": await one("SELECT count(*) FROM sales"),
        "sales_legacy": await one(
            "SELECT count(*) FROM sales WHERE doc->>'source' = 'LEGACY'"),
        "abonos": await one("SELECT count(*) FROM abonos"),
        "products": await one("SELECT count(*) FROM products"),
        "caja_movimientos": await one("SELECT count(*) FROM caja_movimientos"),
        "inventory_movements": await one(
            "SELECT count(*) FROM inventory_movements"),
    }
    batch = None
    if staging_ok:
        b = (await conn.execute(text(
            "SELECT batch_id, status, phase, tickets_imported, details_imported, "
            "cxc_imported, cxc_saldo_total, finished_at, error_detail "
            "FROM legacy_import_batch ORDER BY started_at DESC LIMIT 1"))).first()
        if b:
            batch = {
                "batch_id": b[0], "status": b[1], "phase": b[2],
                "tickets_imported": int(b[3]), "details_imported": int(b[4]),
                "cxc_imported": int(b[5]), "cxc_saldo_total": float(b[6] or 0),
                "finished_at": str(b[7]) if b[7] else None,
                "error_detail": b[8] or "",
            }
    snapshot = None
    cambios = None
    if staging_ok:
        snap_row = (await conn.execute(text(
            """SELECT s.snapshot_id, s.batch_id, s.created_at, s.source_hash,
                      b.validations->'cambios' AS cambios
               FROM legacy_snapshots s
               LEFT JOIN legacy_migration_batch b ON b.batch_id = s.batch_id
               ORDER BY s.created_at DESC LIMIT 1"""))).first()
        if snap_row:
            snapshot = {"snapshot_id": snap_row[0], "batch_id": snap_row[1],
                        "created_at": str(snap_row[2]),
                        "source_hash": snap_row[3]}
            cambios = snap_row[4]
    etapas = {
        "discovery": staging_ok > 0,       # staging implica discovery previo
        "analyze": staging_ok > 0,
        "staging": staging_ok > 0 and tickets > 0,
        "dry_run": staging_ok > 0 and cxc_ready > 0,
        "import": bool(batch and batch["status"] == "COMPLETED"),
    }
    importado = bool(batch and batch["status"] == "COMPLETED")
    # ---- Importación INCREMENTAL (delta): staging con claves nuevas o
    # documentos modificados vs producción. Detectable solo si ya hubo import.
    if staging_ok and importado:
        delta = await _delta_counts(conn)
    else:
        delta = {"nuevos": 0, "actualizables": 0}
    return {
        "enabled": LEGACY_ENABLED,
        "developer_mode": DEVELOPER_MODE,
        "entorno": _APP_ENV,
        "etapas": etapas,
        "import_habilitado": all([etapas["staging"], etapas["dry_run"],
                                  LEGACY_ENABLED, DEVELOPER_MODE,
                                  _APP_ENV != "production", not importado]),
        "importado": importado,
        "import_incremental_habilitado": all([
            etapas["staging"], etapas["dry_run"], importado,
            LEGACY_ENABLED, DEVELOPER_MODE, _APP_ENV != "production",
            (delta["nuevos"] + delta["actualizables"]) > 0]),
        "delta": delta,
        "batch": batch,
        "snapshot": snapshot,
        "cambios": cambios,
        "staging": {
            "tickets": int(tickets), "detalles": int(details),
            "cxc_ready": int(cxc_ready), "cxc_saldo": round(cxc_saldo, 2),
            "cxc_review": int(cxc_review), "cxc_negative": int(cxc_negative),
            "cxc_excluded": int(cxc_excluded),
            "productos_pendientes": int(products_pending),
        },
        "produccion": prod,
    }


@router.get("/legacy/status")
async def legacy_status(user: dict = Depends(legacy_read)):
    await _ensure_tables()
    async with transaction() as conn:
        return await _status_payload(conn)


@router.get("/legacy/public-summary")
async def legacy_public_summary(user: dict = Depends(legacy_query)):
    """Resumen agregado SIN datos técnicos para módulos operativos (CxC)."""
    try:
        async with transaction() as conn:
            r = (await conn.execute(text(
                "SELECT count(*), COALESCE(sum(legacy_saldo),0) "
                "FROM legacy_cxc_snapshot WHERE status='READY' "
                "AND legacy_saldo > 0.01"))).first()
            n = await conn.execute(text(
                "SELECT count(*) FROM sales WHERE doc->>'source'='LEGACY'"))
            return {"disponible": True, "cxc_pendientes": int(r[0]),
                    "cxc_saldo": round(float(r[1] or 0), 2),
                    "tickets_legacy": int(n.scalar() or 0)}
    except Exception:
        return {"disponible": False}


# --------------------------------------------------------------------------- #
# Snapshots versionados (V7)                                                  #
# --------------------------------------------------------------------------- #
@router.get("/legacy/snapshots")
async def legacy_snapshots(user: dict = Depends(legacy_read)):
    """Lista de snapshots legacy con su resumen de cambios (V7)."""
    await _ensure_tables()
    async with transaction() as conn:
        snaps = (await conn.execute(text(
            """SELECT s.snapshot_id, s.batch_id, s.created_at, s.source_path,
                      s.source_hash, s.files_count,
                      b.validations->'cambios' AS cambios,
                      b.validations->'balances' AS balances
               FROM legacy_snapshots s
               LEFT JOIN legacy_migration_batch b ON b.batch_id = s.batch_id
               ORDER BY s.created_at DESC LIMIT 50"""))).fetchall()
    return {"snapshots": [dict(zip(
        ("snapshot_id", "batch_id", "created_at", "source_path", "source_hash",
         "files_count", "cambios", "balances"), r)) for r in snaps]}


# --------------------------------------------------------------------------- #
# Cola de revisión                                                            #
# --------------------------------------------------------------------------- #
@router.get("/legacy/review")
async def legacy_review(motivo: str = "", user: dict = Depends(legacy_read)):
    """Documentos CxC en revisión + negativos + excluidos, filtrables."""
    where = "WHERE status IN ('REVIEW_REQUIRED','NEGATIVE','EXCLUDED')"
    params = {}
    if motivo:
        where += " AND review_reason LIKE :m"
        params["m"] = f"%{motivo}%"
    async with transaction() as conn:
        rows = (await conn.execute(text(
            f"SELECT legacy_key, legacy_serie, legacy_folio, legacy_cliente, "
            f"legacy_condicion, legacy_saldo, calculated_saldo, difference, "
            f"status, review_reason, cancelado FROM legacy_cxc_snapshot {where} "
            f"ORDER BY status, legacy_folio LIMIT 500"), params)).fetchall()
        resumen = (await conn.execute(text(
            "SELECT status, COALESCE(review_reason,'') AS motivo, count(*) AS n, "
            "COALESCE(sum(legacy_saldo),0) AS saldo FROM legacy_cxc_snapshot "
            "WHERE status IN ('REVIEW_REQUIRED','NEGATIVE','EXCLUDED') "
            "GROUP BY 1,2 ORDER BY 1,3 DESC"))).fetchall()
        prods = (await conn.execute(text(
            "SELECT m.legacy_product_key, m.legacy_status, "
            "COALESCE(count(d.legacy_key),0) AS apariciones "
            "FROM legacy_product_mapping m LEFT JOIN legacy_ticket_details d "
            "ON d.legacy_codigo = m.legacy_product_key "
            "WHERE m.mapping_status='PRODUCT_REVIEW_REQUIRED' "
            "GROUP BY 1,2 ORDER BY apariciones DESC LIMIT 300"))).fetchall()
        clientes = (await conn.execute(text(
            "SELECT legacy_customer_key, legacy_nombre, status, match_type "
            "FROM legacy_customer_mapping "
            "WHERE status IN ('UNMATCHED','DELETED_LEGACY') ORDER BY 1"))).fetchall()
    return {
        "documentos": [dict(zip(
            ("legacy_key", "serie", "folio", "cliente", "condicion", "saldo",
             "calculado", "diferencia", "status", "motivo", "cancelado"), r))
        for r in rows],
        "resumen": [dict(zip(("status", "motivo", "count", "saldo"), r))
                    for r in resumen],
        "productos": [dict(zip(("codigo", "legacy_status", "apariciones"), r))
                      for r in prods],
        "clientes": [dict(zip(("clave", "nombre", "status", "match_type"), r))
                     for r in clientes],
    }


# --------------------------------------------------------------------------- #
# Conciliación V2: maestro vs documentos vs ledger por cliente                #
# --------------------------------------------------------------------------- #
@router.get("/legacy/reconciliation")
async def legacy_reconciliation(estado: str = "", q: str = "",
                                user: dict = Depends(legacy_read)):
    """Conciliación del saldo por cliente para el snapshot más reciente.

    master_saldo = CLIENTES.SALDO (fuente maestra legacy)
    docs_saldo   = SUM(CXCDOCS.SALDO) documentos abiertos
    ledger_saldo = SUM(CUENXCOB.C − CUENXCOB.A)
    estado       = MATCH / DIFFERENCE / REVIEW
    """
    await _ensure_tables()
    async with transaction() as conn:
        snap = (await conn.execute(text(
            "SELECT snapshot_id FROM legacy_snapshots "
            "ORDER BY created_at DESC LIMIT 1"))).first()
        if snap is None:
            return {"disponible": False,
                    "mensaje": "Aún no hay snapshot; ejecutar staging"}
        snapshot_id = snap[0]
        where = "WHERE snapshot_id = :s"
        params: dict = {"s": snapshot_id}
        if estado:
            where += " AND estado = :e"
            params["e"] = estado
        if q:
            where += " AND (legacy_customer_key ILIKE :q OR legacy_nombre ILIKE :q)"
            params["q"] = f"%{q}%"
        resumen = (await conn.execute(text(
            f"""SELECT estado, count(*), COALESCE(sum(master_saldo),0),
                       COALESCE(sum(docs_saldo),0), COALESCE(sum(ledger_saldo),0)
                FROM legacy_client_balance WHERE snapshot_id = :s
                GROUP BY estado ORDER BY estado"""), {"s": snapshot_id})).fetchall()
        rows = (await conn.execute(text(
            f"""SELECT legacy_customer_key, legacy_nombre, master_saldo,
                       docs_saldo, ledger_saldo, diff_docs, diff_ledger,
                       estado, rysa_customer_id
                FROM legacy_client_balance {where}
                ORDER BY GREATEST(ABS(COALESCE(diff_docs,0)),
                                  ABS(COALESCE(diff_ledger,0))) DESC
                LIMIT 300"""), params)).fetchall()
        tot = (await conn.execute(text(
            """SELECT COALESCE(sum(master_saldo),0), COALESCE(sum(docs_saldo),0),
                      COALESCE(sum(ledger_saldo),0)
               FROM legacy_client_balance WHERE snapshot_id = :s"""),
            {"s": snapshot_id})).first()
    return {
        "disponible": True,
        "snapshot_id": snapshot_id,
        "resumen": [dict(zip(("estado", "clientes", "master", "docs", "ledger"), r))
                    for r in resumen],
        "totales": {"master": round(float(tot[0] or 0), 2),
                    "docs": round(float(tot[1] or 0), 2),
                    "ledger": round(float(tot[2] or 0), 2)},
        "clientes": [dict(zip(("clave", "nombre", "master", "docs", "ledger",
                               "diff_docs", "diff_ledger", "estado", "rysa_id"),
                              r)) for r in rows],
    }


# --------------------------------------------------------------------------- #
# Validaciones pre-import                                                     #
# --------------------------------------------------------------------------- #
async def _validate_import(conn) -> tuple[bool, list[str], dict]:
    bloqueos: list[str] = []
    async def one(sql: str, params=None):
        r = await conn.execute(text(sql), params or {})
        return r.scalar() or 0

    tickets = await one("SELECT count(*) FROM legacy_tickets")
    details = await one("SELECT count(*) FROM legacy_ticket_details")
    cxc_ready = await one(
        "SELECT count(*) FROM legacy_cxc_snapshot WHERE status='READY' "
        "AND legacy_saldo > 0.01")
    cxc_saldo = float(await one(
        "SELECT COALESCE(sum(legacy_saldo),0) FROM legacy_cxc_snapshot "
        "WHERE status='READY' AND legacy_saldo > 0.01"))
    if tickets == 0:
        bloqueos.append("staging vacío: ejecuta STAGING antes de importar")
    t_rows, t_uniq = (await conn.execute(text(
        "SELECT count(*), count(DISTINCT (legacy_serie, legacy_folio)) "
        "FROM legacy_tickets"))).first()
    if t_rows != t_uniq:
        bloqueos.append(f"identidad de tickets no única: {t_rows} filas vs "
                        f"{t_uniq} claves")
    d_rows, d_uniq = (await conn.execute(text(
        "SELECT count(*), count(DISTINCT (doc_key, partida)) "
        "FROM legacy_ticket_details"))).first()
    if d_rows != d_uniq:
        bloqueos.append(f"identidad de detalles no única: {d_rows} vs {d_uniq}")
    clientes_mapeados = await one(
        "SELECT count(*) FROM legacy_customer_mapping WHERE status='MATCHED'")
    if clientes_mapeados == 0:
        bloqueos.append("sin clientes MATCHED: el mapping legacy→RYSA está vacío")

    # ---- batch anterior: detección de importación interrumpida ----
    prev = (await conn.execute(text(
        "SELECT batch_id, status FROM legacy_import_batch "
        "ORDER BY started_at DESC LIMIT 1"))).first()
    stale_marcado = None
    if prev and prev[1] == "RUNNING":
        vivo = _TAREA.get("corriendo") == prev[0]
        if not vivo:
            # proceso reiniciado con batch RUNNING: marcarlo como interrumpido
            await conn.execute(text(
                "UPDATE legacy_import_batch SET status='FAILED', finished_at=now(), "
                "error_detail='Importación interrumpida (proceso reiniciado); "
                "reanudable ejecutando import nuevamente (idempotente)' "
                "WHERE batch_id=:b"), {"b": prev[0]})
            stale_marcado = prev[0]
        else:
            bloqueos.append(f"la importación {prev[0]} está en curso")

    sales_legacy = await one(
        "SELECT count(*) FROM sales WHERE doc->>'source'='LEGACY'")
    # Reanudación: se permite si TODAS las ventas LEGACY existentes pertenecen
    # al universo del staging (sus _id son deterministas) → ON CONFLICT
    # deduplica y se inserta el resto. Bloqueo solo si hay más ventas LEGACY
    # que claves de staging (estado imposible → intervención manual).
    if sales_legacy > tickets:
        bloqueos.append(
            f"hay {sales_legacy} ventas LEGACY previas > {tickets} claves de "
            "staging: estado inconsistente, revisar rollback/import anterior")
    # staging batch vigente
    st_batch = (await conn.execute(text(
        "SELECT batch_id FROM legacy_migration_batch ORDER BY created_at DESC "
        "LIMIT 1"))).first()
    if not st_batch:
        bloqueos.append("no existe batch de staging (legacy_migration_batch)")
    resumen = {"tickets": int(tickets), "detalles": int(details),
               "cxc_ready": int(cxc_ready), "cxc_saldo": round(cxc_saldo, 2),
               "clientes_mapeados": int(clientes_mapeados),
               "sales_legacy_previas": int(sales_legacy),
               "staging_batch": st_batch[0] if st_batch else None,
               "prev_batch": prev[0] if prev else None,
               "prev_status": prev[1] if prev else None,
               "stale_marcado": stale_marcado,
               "reanudacion": bool(sales_legacy and 0 < sales_legacy <= tickets)}
    return (not bloqueos), bloqueos, resumen


@router.post("/legacy/validate")
async def legacy_validate(user: dict = Depends(legacy_read)):
    await _ensure_tables()
    async with transaction() as conn:
        ok, bloqueos, resumen = await _validate_import(conn)
    return {"ok": ok, "bloqueos": bloqueos, "resumen": resumen}


# --------------------------------------------------------------------------- #
# IMPORTACIÓN (no se ejecuta sola)                                            #
# --------------------------------------------------------------------------- #
_TAREA: dict = {}


def _sale_doc(t: dict, items: list, cxc: dict | None, batch_id: str,
              cliente_id: str, cliente_nombre: str) -> dict:
    serie = t["legacy_serie"] or ""
    folio = t["legacy_folio"] or ""
    folio_disp = f"{serie}-{folio.lstrip('0') or '0'}"
    cancelado = bool(t.get("legacy_cancelado"))
    condicion_legacy = (t.get("legacy_condicion") or "").upper()
    condicion = "credito" if condicion_legacy == "R" else "contado"
    saldo = 0.0
    if cxc:
        saldo = round(float(cxc["saldo"] or 0), 2)
    return {
        "id": t["legacy_key"],
        "folio": folio_disp,
        "serie": serie,
        "fecha": (t.get("legacy_fecha") or "")[:10],
        "condicion": condicion,
        "estado": "cancelada" if cancelado else "confirmada",
        "tipo_venta": "venta",
        "cliente_id": cliente_id,
        "cliente_nombre": cliente_nombre,
        "vendedor_nombre": t.get("legacy_vendedor") or "",
        "total": round(float(t.get("legacy_total") or 0), 2),
        "saldo": saldo,
        "facturado": False,
        "items": items,
        "pagos": [],
        "source": "LEGACY",
        "is_historical": True,
        "legacy_batch": batch_id,
        "legacy_table": "NOTAVTA",
        "legacy_serie": serie,
        "legacy_folio": folio,
        "legacy_cliente": t.get("legacy_cliente") or "",
        "legacy_condicion": condicion_legacy,
        "legacy_saldo_original": round(float(t.get("legacy_saldo_original") or 0), 2),
        "legacy_cancelado": cancelado,
    }


def _legacy_item(d: dict, nombres: dict | None = None) -> dict:
    """Partida histórica compatible con el render de Ventas.jsx
    (descripcion/unidad/precio_bruto/importe_bruto) preservando los campos
    legacy. `nombres` mapea código legacy -> descripción real del catálogo
    RYSA (ARTICULO.DESCRIP) para mostrar el nombre y no solo el código."""
    cod = d["legacy_codigo"] or ""
    pid = d["rysa_product_id"]
    nombre = (nombres or {}).get(cod) or cod
    return {
        "product_id": pid or None,
        "descripcion": nombre,
        "nombre": nombre,
        "unidad": "",
        "cantidad": float(d["legacy_cantidad"] or 0),
        "precio": float(d["legacy_precio"] or 0),
        "precio_bruto": float(d["legacy_precio"] or 0),
        "descuento": 0,
        "importe": float(d["legacy_importe_calculado"] or 0),
        "importe_bruto": float(d["legacy_importe_calculado"] or 0),
        "codigo_legacy": cod,
        "mapping_status": d["mapping_status"],
    }


async def _cargar_nombres_products(eng) -> dict:
    """Mapa código legacy -> descripción real del catálogo RYSA (products,
    importado de ARTICULO.DESCRIP). Para mostrar el nombre en las partidas."""
    from sqlalchemy import text
    async with eng.connect() as conn:
        rows = (await conn.execute(text(
            "SELECT doc->>'codigo', doc->>'descripcion' FROM products "
            "WHERE doc->>'codigo' IS NOT NULL"))).fetchall()
    return {r[0]: r[1] for r in rows if r[1]}


async def _run_import(batch_id: str, staging_batch: str | None, user: dict):
    """Tarea de fondo: importación por chunks. Idempotente por clave legacy."""
    from pgstore.database import get_engine
    eng = get_engine()
    try:
        async with eng.begin() as conn:
            # ---- BACKUP verificable del estado que se va a tocar ----
            await conn.execute(text(
                "INSERT INTO legacy_import_backup (batch_id, kind, entity_key, payload) "
                "SELECT :b, 'clients', \"_id\", doc FROM clients"),
                {"b": batch_id})
            clientes_saldo_antes = float((await conn.execute(text(
                "SELECT COALESCE(sum(COALESCE(\"saldo\",0)),0) FROM clients")
            )).scalar() or 0)
            for tabla in ("sales", "abonos", "caja_movimientos",
                          "inventory_movements", "products"):
                n = (await conn.execute(text(
                    f"SELECT count(*) FROM {tabla}"))).scalar() or 0
                await conn.execute(text(
                    "INSERT INTO legacy_import_backup (batch_id, kind, entity_key, payload) "
                    "VALUES (:b, 'precount', :t, CAST(:p AS jsonb))"),
                    {"b": batch_id, "t": tabla,
                     "p": json.dumps({"count": int(n)})})
            await conn.execute(text(
                "UPDATE legacy_import_batch SET status='RUNNING', phase='backup' "
                "WHERE batch_id=:b"), {"b": batch_id})

        chunk = int(os.environ.get("LEGACY_IMPORT_CHUNK", "1000") or "1000")
        ticket_importados = 0
        detalle_importados = 0
        saltados = 0
        cxc_importados = 0
        cxc_saldo_total = 0.0
        cxc_sin_cliente = 0

        # ---- mapas desde staging (una sola lectura) ----
        nombres_prod = await _cargar_nombres_products(eng)
        async with eng.connect() as conn:
            tickets = (await conn.execute(text(
                "SELECT legacy_key, legacy_serie, legacy_folio, legacy_cliente, "
                "legacy_fecha, legacy_total, legacy_condicion, legacy_vendedor, "
                "legacy_cancelado, legacy_saldo_original FROM legacy_tickets "
                "ORDER BY legacy_folio"))).mappings().all()
            details: dict[str, list] = {}
            for d in (await conn.execute(text(
                    "SELECT doc_key, legacy_codigo, legacy_cantidad, legacy_precio, "
                    "legacy_importe_calculado, rysa_product_id, mapping_status "
                    "FROM legacy_ticket_details ORDER BY doc_key, partida"
            ))).mappings().all():
                details.setdefault(d["doc_key"], []).append(d)
            cxc_ready = {
                r["legacy_key"]: {"saldo": float(r["legacy_saldo"] or 0)}
                for r in (await conn.execute(text(
                    "SELECT legacy_key, legacy_saldo FROM legacy_cxc_snapshot "
                    "WHERE status='READY' AND legacy_saldo > 0.01"
                ))).mappings().all()}
            mapping = {r["legacy_customer_key"]: r["rysa_customer_id"]
                       for r in (await conn.execute(text(
                    "SELECT legacy_customer_key, rysa_customer_id "
                    "FROM legacy_customer_mapping WHERE status='MATCHED'"
                ))).mappings().all()}
            nombres = {r["legacy_customer_key"]: r["legacy_nombre"]
                       for r in (await conn.execute(text(
                    "SELECT legacy_customer_key, legacy_nombre "
                    "FROM legacy_customer_mapping"))).mappings().all()}

        total = len(tickets)
        total_detalles = sum(len(v) for v in details.values())
        for i in range(0, total, chunk):
            lote = tickets[i:i + chunk]
            async with eng.begin() as conn:
                for t in lote:
                    key = t["legacy_key"]
                    its = [_legacy_item(d, nombres_prod) for d in details.get(key, [])]
                    detalle_importados += len(its)
                    cli_clave = t["legacy_cliente"] or ""
                    cliente_id = mapping.get(cli_clave, "")
                    doc = _sale_doc(t, its, cxc_ready.get(key), batch_id,
                                    cliente_id,
                                    nombres.get(cli_clave, cli_clave))
                    es_cxc = key in cxc_ready
                    res = await conn.execute(text(
                        'INSERT INTO sales ("_id","id","doc","created_at","total","saldo") '
                        'VALUES (:k,:k,CAST(:d AS jsonb),now(),:t,:s) '
                        'ON CONFLICT ("_id") DO NOTHING'),
                        {"k": key, "d": json.dumps(doc, ensure_ascii=False, default=str),
                         "t": doc["total"], "s": doc["saldo"]})
                    if (res.rowcount or 0) > 0:
                        ticket_importados += 1
                        if es_cxc:
                            cxc_importados += 1
                            cxc_saldo_total += doc["saldo"]
                            if not cliente_id:
                                cxc_sin_cliente += 1
                    else:
                        saltados += 1
            # progreso persistido por chunk
            async with eng.begin() as conn:
                await conn.execute(text(
                    "UPDATE legacy_import_batch SET phase='tickets', "
                    "tickets_imported=:t, details_imported=:d, "
                    "cxc_imported=:c, cxc_saldo_total=:s, skipped_duplicates=:k, "
                    "cxc_sin_cliente_rysa=:sc WHERE batch_id=:b"),
                    {"t": ticket_importados, "d": detalle_importados,
                     "c": cxc_importados, "s": round(cxc_saldo_total, 2),
                     "k": saltados, "sc": cxc_sin_cliente, "b": batch_id})

        # ---- V2: clients.saldo NUNCA se modifica por el import ----
        # El saldo operativo del cliente ya contiene el saldo legacy (maestro
        # CLIENTES.SALDO importado con la migración de clientes). Aplicar aquí
        # el "delta CxC" duplicaría la deuda (auditoría forense 2026-08-30).
        # Los documentos LEGACY importados (sales.saldo) son la capa
        # documental/consultable; clients.saldo queda INVARIABLE.
        async with eng.begin() as conn:
            await conn.execute(text(
                "INSERT INTO legacy_import_audit (batch_id, kind, entity_key, payload) "
                "VALUES (:b, 'saldo_policy_v2', 'clients', CAST(:p AS jsonb))"),
                {"b": batch_id,
                 "p": json.dumps({
                     "politica": "clients.saldo no se modifica en el import",
                     "razon": "el maestro legacy ya está en clients.saldo; "
                              "aplicar delta duplicaría la deuda",
                     "saldo_clientes_antes": clientes_saldo_antes})})
            await conn.execute(text(
                "UPDATE legacy_import_batch SET phase='saldo_policy' "
                "WHERE batch_id=:b"), {"b": batch_id})

        # ---- VALIDACIÓN POST-IMPORT (obligatoria antes de COMPLETED) ----
        async with eng.begin() as conn:
            async def one(sql: str, params=None):
                r = await conn.execute(text(sql), params or {})
                return r.scalar() or 0

            sl = await one("SELECT count(*) FROM sales WHERE doc->>'source'='LEGACY'")
            sl_total = await one(
                "SELECT COALESCE(sum((doc->>'total')::numeric),0) "
                "FROM sales WHERE doc->>'source'='LEGACY'")
            sl_items = await one(
                "SELECT COALESCE(sum(jsonb_array_length(doc->'items')),0) "
                "FROM sales WHERE doc->>'source'='LEGACY'")
            sl_cxc = await one(
                "SELECT count(*) FROM sales WHERE doc->>'source'='LEGACY' "
                "AND CAST(doc->>'saldo' AS numeric) > 0.01")
            sl_cxc_suma = await one(
                "SELECT COALESCE(sum(CAST(doc->>'saldo' AS numeric)),0) "
                "FROM sales WHERE doc->>'source'='LEGACY' "
                "AND CAST(doc->>'saldo' AS numeric) > 0.01")
            # tablas que NO deben cambiar por la migración (vs precounts)
            precounts = {}
            for r2 in (await conn.execute(text(
                    "SELECT entity_key, (payload->>'count') AS n "
                    "FROM legacy_import_backup WHERE batch_id=:b AND kind='precount'"),
                    {"b": batch_id})).fetchall():
                precounts[r2[0]] = int(r2[1] or 0)
            sin_cambios = {}
            for tabla in ("abonos", "caja_movimientos", "inventory_movements",
                          "products"):
                ahora = int(await one(f"SELECT count(*) FROM {tabla}"))
                sin_cambios[tabla] = {"antes": precounts.get(tabla),
                                      "despues": ahora,
                                      "ok": precounts.get(tabla) == ahora}
            cxc_esperado = len(cxc_ready)
            cxc_saldo_esperado = round(sum(float(v["saldo"] or 0)
                                           for v in cxc_ready.values()), 2)
            clientes_saldo_despues = float(await one(
                "SELECT COALESCE(sum(COALESCE(\"saldo\",0)),0) FROM clients"))
            validaciones = {
                "tickets_legacy": {"esperado": total, "importado": int(sl),
                                   "ok": sl == total},
                "detalles_legacy": {"esperado": int(total_detalles),
                                    "importado": int(sl_items),
                                    "ok": sl_items == total_detalles},
                "cxc_legacy": {"esperado": cxc_esperado, "importado": int(sl_cxc),
                               "ok": sl_cxc == cxc_esperado},
                "cxc_saldo": {"esperado": cxc_saldo_esperado,
                              "importado": round(float(sl_cxc_suma), 2),
                              "ok": abs(float(sl_cxc_suma) - cxc_saldo_esperado) <= 0.02},
                "clients_saldo_intacto": {
                    "antes": round(clientes_saldo_antes, 2),
                    "despues": round(clientes_saldo_despues, 2),
                    "ok": abs(clientes_saldo_antes - clientes_saldo_despues) <= 0.02},
                "tablas_intactas": sin_cambios,
            }
            todo_ok = all([validaciones["tickets_legacy"]["ok"],
                           validaciones["detalles_legacy"]["ok"],
                           validaciones["cxc_legacy"]["ok"],
                           validaciones["cxc_saldo"]["ok"],
                           validaciones["clients_saldo_intacto"]["ok"],
                           all(v["ok"] for v in sin_cambios.values())])
            await conn.execute(text(
                "UPDATE legacy_import_batch SET status=:st, "
                "phase='validacion', finished_at=now(), "
                "clientes_saldo_actualizados=:n, tickets_imported=:t, "
                "details_imported=:d, cxc_imported=:c, cxc_saldo_total=:s, "
                "skipped_duplicates=:k, cxc_sin_cliente_rysa=:sc, "
                "errors=:e, validations=CAST(:v AS jsonb) "
                "WHERE batch_id=:b"),
                {"st": "COMPLETED" if todo_ok else "FAILED",
                 "n": 0, "t": ticket_importados,
                 "d": detalle_importados, "c": cxc_importados,
                 "s": round(cxc_saldo_total, 2), "k": saltados,
                 "sc": cxc_sin_cliente,
                 "e": 0 if todo_ok else 1,
                 "v": json.dumps(validaciones, default=str),
                 "b": batch_id})
            if not todo_ok:
                raise RuntimeError(
                    "validación post-import falló: " +
                    json.dumps(validaciones, default=str)[:1500])
            # auditoría operativa
            await conn.execute(text(
                'INSERT INTO audit_logs ("_id","id","doc") '
                'VALUES (CAST(:k AS text), CAST(:k AS text), CAST(:d AS jsonb))'),
                {"k": uuid.uuid4().hex, "d": json.dumps({
                    "id": uuid.uuid4().hex, "usuario_id": user.get("id"),
                    "usuario_nombre": user.get("name"),
                    "accion": "legacy_import", "entidad": "migracion_legacy",
                    "registro_id": batch_id,
                    "detalle": json.dumps({
                        "batch": batch_id, "tickets": ticket_importados,
                        "detalles": detalle_importados, "cxc": cxc_importados,
                        "saldo": round(cxc_saldo_total, 2),
                        "validaciones": "OK"}),
                    "fecha": iso_now()}, default=str)})
    except Exception as exc:  # noqa: BLE001
        try:
            async with eng.begin() as conn:
                await conn.execute(text(
                    "UPDATE legacy_import_batch SET status='FAILED', finished_at=now(), "
                    "error_detail=:e WHERE batch_id=:b AND status<>'ROLLED_BACK'"),
                    {"e": str(exc)[:2000], "b": batch_id})
        except Exception:
            pass
    finally:
        _TAREA.pop("corriendo", None)


@router.post("/legacy/import")
async def legacy_import(user: dict = Depends(legacy_admin),
                        body: dict = Body(...)):
    confirmacion = (body.get("confirmacion") or "").strip()
    backup_ok = bool(body.get("backup_confirmado"))
    if confirmacion != CONFIRMACION_IMPORT:
        raise HTTPException(status_code=400, detail=(
            f"Confirmación inválida: escribe exactamente '{CONFIRMACION_IMPORT}'"))
    if not backup_ok:
        raise HTTPException(status_code=400, detail=(
            "Debes confirmar el backup de la base antes de importar"))
    if _TAREA.get("corriendo"):
        raise HTTPException(status_code=409, detail="Ya hay una importación en curso")
    await _ensure_tables()
    async with transaction() as conn:
        ok, bloqueos, resumen = await _validate_import(conn)
    if not ok:
        raise HTTPException(status_code=409, detail={
            "mensaje": "IMPORTACIÓN BLOQUEADA: validaciones fallidas",
            "bloqueos": bloqueos, "resumen": resumen})
    batch_id = f"IMP-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    async with transaction() as conn:
        await conn.execute(text(
            "INSERT INTO legacy_import_batch (batch_id, staging_batch_id, status, "
            "phase, created_by) VALUES (:b, :s, 'PENDING', 'inicio', :u)"),
            {"b": batch_id, "s": resumen.get("staging_batch"),
             "u": user.get("name")})
    _TAREA["corriendo"] = batch_id
    asyncio.create_task(_run_import(batch_id, resumen.get("staging_batch"), user))
    return {"ok": True, "batch_id": batch_id,
            "mensaje": "Importación iniciada; consulta /legacy/status para progreso"}


# --------------------------------------------------------------------------- #
# IMPORTACIÓN INCREMENTAL (delta)                                             #
#                                                                             #
# Re-importa SOLO la diferencia entre el staging vigente y producción:        #
#   * NUEVOS   : claves de staging ausentes en sales → INSERT (idempotente).  #
#   * ACTUALIZ : documentos cuyo change_status (V7) es UPDATED/CANCELLED en   #
#     tickets o en el snapshot CxC → se ACTUALIZAN solo si ningún abono de    #
#     producción ha tocado su saldo (saldo == total); si hay abonos van a     #
#     la cola de revisión y NO se tocan.                                      #
# clients.saldo NUNCA se modifica (política V2). El rollback del batch solo   #
# revierte los NUEVOS (los actualizados conservan su legacy_batch original).  #
# --------------------------------------------------------------------------- #
CONFIRMACION_INCREMENTAL = "IMPORTAR DELTA"


@router.post("/legacy/import-incremental")
async def legacy_import_incremental(user: dict = Depends(legacy_admin),
                                    body: dict = Body(...)):
    confirmacion = (body.get("confirmacion") or "").strip()
    backup_ok = bool(body.get("backup_confirmado"))
    if confirmacion != CONFIRMACION_INCREMENTAL:
        raise HTTPException(status_code=400, detail=(
            f"Confirmación inválida: escribe exactamente "
            f"'{CONFIRMACION_INCREMENTAL}'"))
    if not backup_ok:
        raise HTTPException(status_code=400, detail=(
            "Debes confirmar el backup de la base antes de importar"))
    if _TAREA.get("corriendo"):
        raise HTTPException(status_code=409, detail="Ya hay una importación en curso")
    await _ensure_tables()
    async with transaction() as conn:
        ok, bloqueos, resumen = await _validate_import(conn)
        if not ok:
            raise HTTPException(status_code=409, detail={
                "mensaje": "IMPORTACIÓN INCREMENTAL BLOQUEADA",
                "bloqueos": bloqueos, "resumen": resumen})
        delta = await _delta_counts(conn)
    if (delta["nuevos"] + delta["actualizables"]) == 0:
        return {"ok": True, "sin_cambios": True,
                "mensaje": "Staging y producción ya están sincronizados; "
                           "no hay nada que importar"}
    batch_id = f"IMPINC-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    async with transaction() as conn:
        await conn.execute(text(
            "INSERT INTO legacy_import_batch (batch_id, staging_batch_id, status, "
            "phase, created_by) VALUES (:b, :s, 'PENDING', 'inicio', :u)"),
            {"b": batch_id, "s": resumen.get("staging_batch"), "u": user.get("name")})
    _TAREA["corriendo"] = batch_id
    asyncio.create_task(_run_incremental(batch_id, resumen.get("staging_batch"), user))
    return {"ok": True, "batch_id": batch_id, "delta": delta,
            "mensaje": "Importación incremental iniciada"}


async def _delta_counts(conn) -> dict:
    """Nuevos (staging sin venta en producción) y actualizables
    (change_status UPDATED/CANCELLED en tickets o snapshot CxC)."""
    nuevos = int((await conn.execute(text(
        "SELECT count(*) FROM legacy_tickets t "
        "LEFT JOIN sales s ON s.\"id\" = t.legacy_key "
        "WHERE s.\"id\" IS NULL"))).scalar() or 0)
    actualizables = int((await conn.execute(text(
        "SELECT count(*) FROM legacy_tickets t JOIN sales s "
        "ON s.\"id\" = t.legacy_key "
        "WHERE t.change_status IN ('UPDATED','CANCELLED') "
        "OR EXISTS (SELECT 1 FROM legacy_cxc_snapshot c "
        "           WHERE c.legacy_key = t.legacy_key "
        "           AND c.change_status IN ('UPDATED','CANCELLED'))")
    )).scalar() or 0)
    return {"nuevos": nuevos, "actualizables": actualizables}


async def _run_incremental(batch_id: str, staging_batch: str | None, user: dict):
    """Fase incremental: INSERT de nuevos + UPDATE condicional de modificados."""
    from pgstore.database import get_engine
    eng = get_engine()
    try:
        async with eng.begin() as conn:
            await conn.execute(text(
                "INSERT INTO legacy_import_backup (batch_id, kind, entity_key, payload) "
                "SELECT :b, 'clients', \"_id\", doc FROM clients"), {"b": batch_id})
            for tabla in ("sales", "abonos", "caja_movimientos",
                          "inventory_movements", "products"):
                n = (await conn.execute(text(
                    f"SELECT count(*) FROM {tabla}"))).scalar() or 0
                await conn.execute(text(
                    "INSERT INTO legacy_import_backup (batch_id, kind, entity_key, payload) "
                    "VALUES (:b, 'precount', :t, CAST(:p AS jsonb))"),
                    {"b": batch_id, "t": tabla,
                     "p": json.dumps({"count": int(n)})})
            await conn.execute(text(
                "UPDATE legacy_import_batch SET status='RUNNING', phase='backup' "
                "WHERE batch_id=:b"), {"b": batch_id})

        chunk = int(os.environ.get("LEGACY_IMPORT_CHUNK", "1000") or "1000")
        nuevos = actualizados = saltados = revisar = 0
        cxc_importados = 0
        cxc_saldo_total = 0.0

        nombres_prod = await _cargar_nombres_products(eng)
        async with eng.connect() as conn:
            tickets = (await conn.execute(text(
                "SELECT legacy_key, legacy_serie, legacy_folio, legacy_cliente, "
                "legacy_fecha, legacy_total, legacy_condicion, legacy_vendedor, "
                "legacy_cancelado, legacy_saldo_original, change_status "
                "FROM legacy_tickets ORDER BY legacy_folio"))).mappings().all()
            details: dict[str, list] = {}
            for d in (await conn.execute(text(
                    "SELECT doc_key, legacy_codigo, legacy_cantidad, legacy_precio, "
                    "legacy_importe_calculado, rysa_product_id, mapping_status "
                    "FROM legacy_ticket_details ORDER BY doc_key, partida"
            ))).mappings().all():
                details.setdefault(d["doc_key"], []).append(d)
            cxc_ready = {
                r["legacy_key"]: {"saldo": float(r["legacy_saldo"] or 0)}
                for r in (await conn.execute(text(
                    "SELECT legacy_key, legacy_saldo FROM legacy_cxc_snapshot "
                    "WHERE status='READY' AND legacy_saldo > 0.01"
                ))).mappings().all()}
            # claves modificadas en el snapshot CxC (V7)
            cxc_changed = {r[0] for r in (await conn.execute(text(
                "SELECT legacy_key FROM legacy_cxc_snapshot "
                "WHERE change_status IN ('UPDATED','CANCELLED')"))).fetchall()}
            mapping = {r["legacy_customer_key"]: r["rysa_customer_id"]
                       for r in (await conn.execute(text(
                    "SELECT legacy_customer_key, rysa_customer_id "
                    "FROM legacy_customer_mapping WHERE status='MATCHED'"
                ))).mappings().all()}
            nombres = {r["legacy_customer_key"]: r["legacy_nombre"]
                       for r in (await conn.execute(text(
                    "SELECT legacy_customer_key, legacy_nombre "
                    "FROM legacy_customer_mapping"))).mappings().all()}

        # Procesar: nuevos (no existen) + modificados (change_status/cxc_changed)
        pendientes = [t for t in tickets
                      if t["change_status"] in ("CREATED", "UPDATED", "CANCELLED")
                      or t["legacy_key"] in cxc_changed]
        total = len(pendientes)
        for i in range(0, total, chunk):
            lote = pendientes[i:i + chunk]
            async with eng.begin() as conn:
                for t in lote:
                    key = t["legacy_key"]
                    cli_clave = t["legacy_cliente"] or ""
                    cliente_id = mapping.get(cli_clave, "")
                    cliente_nombre = nombres.get(cli_clave, cli_clave)
                    existing = (await conn.execute(text(
                        'SELECT "doc" FROM sales WHERE "id" = CAST(:k AS text) '
                        'FOR UPDATE'), {"k": key})).first()
                    if existing is None:
                        # ---- NUEVO: mismo camino que el import completo ----
                        its = [_legacy_item(d, nombres_prod) for d in details.get(key, [])]
                        doc = _sale_doc(t, its, cxc_ready.get(key), batch_id,
                                        cliente_id, cliente_nombre)
                        es_cxc = key in cxc_ready
                        await conn.execute(text(
                            'INSERT INTO sales ("_id","id","doc","created_at","total","saldo") '
                            'VALUES (:k,:k,CAST(:d AS jsonb),now(),:t,:s)'),
                            {"k": key,
                             "d": json.dumps(doc, ensure_ascii=False, default=str),
                             "t": doc["total"], "s": doc["saldo"]})
                        nuevos += 1
                        if es_cxc:
                            cxc_importados += 1
                            cxc_saldo_total += doc["saldo"]
                        continue
                    # ---- MODIFICADO: update condicional ----
                    ex = dict(existing[0])
                    sal_actual = round(float(ex.get("saldo", 0) or 0), 2)
                    total_doc = round(float(ex.get("total", 0) or 0), 2)
                    # abonos de producción tocaron el saldo → NO tocar
                    if abs(sal_actual - total_doc) > 0.01 and total_doc > 0:
                        revisar += 1
                        continue
                    nuevo_saldo = (round(float(cxc_ready[key]["saldo"]), 2)
                                   if key in cxc_ready else 0.0)
                    cancelado = bool(t.get("legacy_cancelado"))
                    its = [_legacy_item(d, nombres_prod) for d in details.get(key, [])]
                    nuevo_doc = _sale_doc(t, its, cxc_ready.get(key),
                                          ex.get("legacy_batch") or batch_id,
                                          cliente_id, cliente_nombre)
                    await conn.execute(text(
                        'UPDATE sales SET "saldo" = :s, "total" = :t, '
                        "doc = CAST(:d AS jsonb) "
                        'WHERE "id" = CAST(:k AS text)'),
                        {"s": nuevo_doc["saldo"], "t": nuevo_doc["total"],
                         "d": json.dumps(nuevo_doc, ensure_ascii=False, default=str),
                         "k": key})
                    actualizados += 1
            async with eng.begin() as conn:
                await conn.execute(text(
                    "UPDATE legacy_import_batch SET phase='tickets', "
                    "tickets_imported=:n, details_imported=:a, "
                    "cxc_imported=:c, cxc_saldo_total=:s, "
                    "skipped_duplicates=:k, cxc_sin_cliente_rysa=:r "
                    "WHERE batch_id=:b"),
                    {"n": nuevos, "a": actualizados, "c": cxc_importados,
                     "s": round(cxc_saldo_total, 2), "k": saltados,
                     "r": revisar, "b": batch_id})

        # ---- política V2: clients.saldo intocable ----
        async with eng.begin() as conn:
            await conn.execute(text(
                "INSERT INTO legacy_import_audit (batch_id, kind, entity_key, payload) "
                "VALUES (:b, 'saldo_policy_v2', 'clients', CAST(:p AS jsonb))"),
                {"b": batch_id, "p": json.dumps({
                    "politica": "clients.saldo no se modifica en el import incremental",
                    "razon": "el maestro legacy ya está en clients.saldo"})})

        # ---- validación post ----
        async with eng.begin() as conn:
            async def one(sql: str, params=None):
                r = await conn.execute(text(sql), params or {})
                return r.scalar() or 0

            sl = await one("SELECT count(*) FROM sales WHERE doc->>'source'='LEGACY'")
            claves_staging = await one("SELECT count(*) FROM legacy_tickets")
            faltantes = await one(
                "SELECT count(*) FROM legacy_tickets t "
                "LEFT JOIN sales s ON s.\"id\" = t.legacy_key WHERE s.\"id\" IS NULL")
            clientes_antes = float((await conn.execute(text(
                "SELECT COALESCE(sum(COALESCE(\"saldo\",0)),0) FROM clients "
                "WHERE \"_id\" IN (SELECT entity_key FROM legacy_import_backup "
                "WHERE batch_id=:b AND kind='clients')"), {"b": batch_id}
            )).scalar() or 0)
            clientes_despues = float(await one(
                "SELECT COALESCE(sum(COALESCE(\"saldo\",0)),0) FROM clients"))
            precounts = {}
            for r2 in (await conn.execute(text(
                    "SELECT entity_key, (payload->>'count') AS n "
                    "FROM legacy_import_backup WHERE batch_id=:b AND kind='precount'"),
                    {"b": batch_id})).fetchall():
                precounts[r2[0]] = int(r2[1] or 0)
            sin_cambios = {}
            for tabla in ("abonos", "caja_movimientos", "inventory_movements",
                          "products"):
                ahora = int(await one(f"SELECT count(*) FROM {tabla}"))
                sin_cambios[tabla] = {"antes": precounts.get(tabla),
                                      "despues": ahora,
                                      "ok": precounts.get(tabla) == ahora}
            validaciones = {
                "universo_cubierto": {"staging": int(claves_staging),
                                      "faltantes": int(faltantes),
                                      "ok": int(faltantes) == 0},
                "sales_legacy": {"antes": None, "despues": int(sl)},
                "clients_saldo_intacto": {
                    "antes": round(clientes_antes, 2),
                    "despues": round(clientes_despues, 2),
                    "ok": abs(clientes_antes - clientes_despues) <= 0.02},
                "tablas_intactas": sin_cambios,
            }
            todo_ok = (int(faltantes) == 0
                       and validaciones["clients_saldo_intacto"]["ok"]
                       and all(v["ok"] for v in sin_cambios.values()))
            await conn.execute(text(
                "UPDATE legacy_import_batch SET status=:st, phase='validacion', "
                "finished_at=now(), tickets_imported=:n, details_imported=:a, "
                "cxc_imported=:c, cxc_saldo_total=:s, "
                "clientes_saldo_actualizados=:r, errors=:e, "
                "validations=CAST(:v AS jsonb) WHERE batch_id=:b"),
                {"st": "COMPLETED" if todo_ok else "FAILED",
                 "n": nuevos, "a": actualizados, "c": cxc_importados,
                 "s": round(cxc_saldo_total, 2), "r": revisar,
                 "e": 0 if todo_ok else 1,
                 "v": json.dumps(validaciones, default=str), "b": batch_id})
            if not todo_ok:
                raise RuntimeError("validación post-import incremental falló: "
                                   + json.dumps(validaciones, default=str)[:1500])
            await conn.execute(text(
                'INSERT INTO audit_logs ("_id","id","doc") '
                'VALUES (CAST(:k AS text), CAST(:k AS text), CAST(:d AS jsonb))'),
                {"k": uuid.uuid4().hex, "d": json.dumps({
                    "id": uuid.uuid4().hex, "usuario_id": user.get("id"),
                    "usuario_nombre": user.get("name"),
                    "accion": "legacy_import_incremental",
                    "entidad": "migracion_legacy", "registro_id": batch_id,
                    "detalle": json.dumps({
                        "batch": batch_id, "nuevos": nuevos,
                        "actualizados": actualizados,
                        "revisar_con_abonos": revisar,
                        "cxc_nuevos": cxc_importados}),
                    "fecha": iso_now()}, default=str)})
    except Exception as exc:  # noqa: BLE001
        try:
            async with eng.begin() as conn:
                await conn.execute(text(
                    "UPDATE legacy_import_batch SET status='FAILED', "
                    "finished_at=now(), error_detail=:e WHERE batch_id=:b "
                    "AND status<>'ROLLED_BACK'"),
                    {"e": str(exc)[:2000], "b": batch_id})
        except Exception:
            pass
    finally:
        _TAREA.pop("corriendo", None)


@router.get("/legacy/progress")
async def legacy_progress(user: dict = Depends(legacy_read)):
    await _ensure_tables()
    async with transaction() as conn:
        b = (await conn.execute(text(
            "SELECT batch_id, status, phase, tickets_imported, details_imported, "
            "cxc_imported, cxc_saldo_total, clientes_saldo_actualizados, "
            "skipped_duplicates, cxc_sin_cliente_rysa, errors, error_detail, "
            "started_at, finished_at FROM legacy_import_batch "
            "ORDER BY started_at DESC LIMIT 1"))).first()
    if not b:
        return {"hay_batch": False}
    keys = ("batch_id", "status", "phase", "tickets_imported",
            "details_imported", "cxc_imported", "cxc_saldo_total",
            "clientes_saldo_actualizados", "skipped_duplicates",
            "cxc_sin_cliente_rysa", "errors", "error_detail", "started_at",
            "finished_at")
    data = dict(zip(keys, b))
    data["tickets_imported"] = int(data["tickets_imported"] or 0)
    data["details_imported"] = int(data["details_imported"] or 0)
    data["cxc_imported"] = int(data["cxc_imported"] or 0)
    data["cxc_saldo_total"] = round(float(data["cxc_saldo_total"] or 0), 2)
    data["hay_batch"] = True
    return data


@router.post("/legacy/rollback")
async def legacy_rollback(user: dict = Depends(legacy_admin),
                          body: dict = Body(...)):
    confirmacion = (body.get("confirmacion") or "").strip()
    if confirmacion != CONFIRMACION_ROLLBACK:
        raise HTTPException(status_code=400, detail=(
            f"Confirmación inválida: escribe exactamente '{CONFIRMACION_ROLLBACK}'"))
    await _ensure_tables()
    async with transaction() as conn:
        b = (await conn.execute(text(
            "SELECT batch_id FROM legacy_import_batch "
            "WHERE status IN ('COMPLETED','FAILED','RUNNING') "
            "ORDER BY started_at DESC LIMIT 1"))).first()
        if not b:
            raise HTTPException(status_code=404,
                                detail="No hay importación pendiente de revertir")
        batch_id = b[0]
        deltas = (await conn.execute(text(
            "SELECT entity_key, (payload->>'delta')::numeric FROM legacy_import_audit "
            "WHERE batch_id=:b AND kind='client_saldo_delta'"),
            {"b": batch_id})).fetchall()
        for cliente_id, delta in deltas:
            row = (await conn.execute(text(
                'SELECT "doc" FROM clients WHERE "id" = CAST(:i AS text) FOR UPDATE'),
                {"i": cliente_id})).first()
            if row is None:
                continue
            cli = dict(row[0])
            nuevo = round(float(cli.get("saldo", 0) or 0) - float(delta or 0), 2)
            await conn.execute(text(
                'UPDATE clients SET "saldo" = :s, '
                "doc = jsonb_set(doc, '{saldo}', "
                "CAST(CAST(:s2 AS numeric) AS text)::jsonb, true) "
                'WHERE "id" = CAST(:i AS text)'),
                {"s": nuevo, "s2": nuevo, "i": cliente_id})
        borrados = await conn.execute(text(
            "DELETE FROM sales WHERE doc->>'source'='LEGACY' "
            "AND doc->>'legacy_batch'=:b"), {"b": batch_id})
        await conn.execute(text(
            "UPDATE legacy_import_batch SET status='ROLLED_BACK', finished_at=now() "
            "WHERE batch_id=:b"), {"b": batch_id})
        await conn.execute(text(
            "INSERT INTO legacy_import_audit (batch_id, kind, entity_key, payload) "
            "VALUES (:b, 'rollback', :u, CAST(:p AS jsonb))"),
            {"b": batch_id, "u": user.get("name"),
             "p": json.dumps({"ventas_eliminadas": int(borrados.rowcount or 0),
                              "clientes_revertidos": len(deltas),
                              "por": user.get("name")})})
        n = borrados.rowcount or 0
    return {"ok": True, "batch_id": batch_id, "ventas_eliminadas": int(n),
            "clientes_revertidos": len(deltas)}


# --------------------------------------------------------------------------- #
# Estado de cuenta combinado (cliente → histórico)                            #
# --------------------------------------------------------------------------- #
@router.get("/legacy/estado-cuenta")
async def legacy_estado_cuenta(codigo: str,
                               user: dict = Depends(get_current_user)):
    """Documentos históricos LEGACY de un cliente (por clave legacy) +
    saldos, para el tab Histórico en Clientes. Mismo nivel de acceso que
    el listado de clientes (usuario autenticado)."""
    async with transaction() as conn:
        rows = (await conn.execute(text(
            "SELECT s.\"doc\" FROM sales s WHERE s.doc->>'source'='LEGACY' "
            "AND s.doc->>'legacy_cliente' = :c "
            "ORDER BY s.doc->>'fecha' DESC LIMIT 500"),
            {"c": codigo})).fetchall()
        docs = []
        for (d,) in rows:
            d = dict(d)
            docs.append({
                "folio": d.get("folio"), "fecha": (d.get("fecha") or "")[:10],
                "total": d.get("total"), "saldo": d.get("saldo"),
                "estado": d.get("estado"), "condicion": d.get("condicion"),
                "origen": "LEGACY", "key": d.get("id"),
                "partidas": len(d.get("items") or []),
                "cancelado": bool(d.get("legacy_cancelado")),
            })
    return {"codigo": codigo, "documentos": docs,
            "total_documentos": len(docs),
            "saldo_historico": round(sum(float(d.get("saldo") or 0) for d in docs), 2)}


# --------------------------------------------------------------------------- #
# Despliegue de datos legacy por ZIP (Herramientas de desarrollador)          #
#                                                                             #
# Permite subir un ZIP con los ~370 archivos DBF/CDX/FPT y desplegarlos en    #
# la carpeta legacy_data desde la UI, para ejecutar las fases de migración    #
# en el momento que se requiera sin copias manuales (docker cp / scp).        #
#                                                                             #
# NOTA de seguridad: a diferencia de las fases destructivas (import/rollback, #
# 404 en producción), este endpoint SOLO despliega ARCHIVOS en la carpeta     #
# legacy_data: no toca la base de datos. Por eso está disponible también en   #
# producción, siempre con las capas 2-4 (DEVELOPER_MODE + LEGACY_ENABLED +    #
# rol admin_desarrollador + permiso developer_tools). Cada despliegue queda   #
# auditado en legacy_import_audit (kind='data_deploy').                       #
# --------------------------------------------------------------------------- #
_LEGACY_EXT_OK = {".dbf", ".cdx", ".fpt", ".bdf", ".dbt", ".mdx", ".ndx", ".tmp"}
_LEGACY_KEY_FILES = ["ARTICULO.dbf", "NOTAVTA.dbf", "NVTAPAR.dbf",
                     "CLIENTES.dbf", "CXCDOCS.dbf", "CUENXCOB.dbf"]
_LEGACY_ZIP_MAX_MB = int(os.environ.get("LEGACY_ZIP_MAX_MB", "300") or "300")


def _legacy_data_dir() -> Path:
    """Misma resolución que tools/legacy_migration/config.py:
    1. LEGACY_DATA_PATH (env) · 2. <cwd>/legacy_data."""
    env = os.environ.get("LEGACY_DATA_PATH", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    return (Path(os.getcwd()) / "legacy_data").resolve()


def _move_file(src: Path, dst: Path) -> None:
    """Mueve un archivo (incluso entre bind mounts / dispositivos distintos).

    shutil.copyfile usa os.copy_file_range/sendfile, que bajo presión de
    memoria del host falla con [Errno 12] (ENOMEM, observable con
    Kardex.cdx). Copia por chunks en user-space: robusto y de memoria plana.
    """
    CH = 4 * 1024 * 1024
    try:
        os.replace(src, dst)
        return
    except OSError:
        pass
    with src.open("rb") as fs, dst.open("wb") as fd:
        while True:
            buf = fs.read(CH)
            if not buf:
                break
            fd.write(buf)
    src.unlink(missing_ok=True)


async def legacy_data_admin(user: dict = Depends(require_permission("developer_tools"))):
    """Despliegue de datos legacy: mismo rol/permiso que las fases, PERO
    disponible también en producción (no escribe en la BD)."""
    if not DEVELOPER_MODE:
        raise HTTPException(status_code=403, detail="DEVELOPER_MODE está desactivado")
    if not LEGACY_ENABLED:
        raise HTTPException(status_code=403, detail=(
            "LEGACY_MIGRATION_ENABLED=false: el módulo Legacy está "
            "deshabilitado en este entorno"))
    if user.get("role") != DEV_ROLE:
        raise HTTPException(status_code=403,
                            detail="Se requiere el rol admin_desarrollador")
    return user


def _legacy_dir_summary(d: Path) -> dict:
    """Inventario de la carpeta legacy_data (contadores por extensión)."""
    if not d.is_dir():
        return {"existe": False, "ruta": str(d), "archivos": 0,
                "por_extension": {}, "bytes_total": 0,
                "tablas_clave": {}, "actualizado": None}
    por_ext: dict[str, int] = {}
    bytes_total = 0
    newest = 0.0
    key: dict[str, dict] = {}
    for p in d.iterdir():
        if not p.is_file():
            continue
        ext = p.suffix.lower()
        por_ext[ext] = por_ext.get(ext, 0) + 1
        bytes_total += p.stat().st_size
        newest = max(newest, p.stat().st_mtime)
        if p.name in _LEGACY_KEY_FILES:
            key[p.name] = {"bytes": p.stat().st_size,
                           "modificado": datetime.fromtimestamp(
                               p.stat().st_mtime, tz=timezone.utc).isoformat()}
    return {"existe": True, "ruta": str(d), "archivos": sum(por_ext.values()),
            "por_extension": por_ext, "bytes_total": bytes_total,
            "tablas_clave": key,
            "actualizado": datetime.fromtimestamp(newest, tz=timezone.utc).isoformat()
            if newest else None}


@router.get("/legacy/data/status")
async def legacy_data_status(user: dict = Depends(legacy_data_admin)):
    d = _legacy_data_dir()
    s = _legacy_dir_summary(d)
    prev = sorted(d.parent.glob(f"{d.name}_prev_*"))
    s["backup_previo"] = prev[-1].name if prev else None
    s["zip_max_mb"] = _LEGACY_ZIP_MAX_MB
    s["extensiones_permitidas"] = sorted(_LEGACY_EXT_OK)
    return s


@router.post("/legacy/data/deploy")
async def legacy_data_deploy(file: UploadFile = File(...),
                             user: dict = Depends(legacy_data_admin)):
    """Despliega un ZIP con los archivos legacy (DBF/CDX/FPT/...) en la
    carpeta legacy_data. Atómico: extrae a un directorio temporal y hace
    swap, conservando el despliegue anterior como legacy_data_prev_<ts>.

    Validaciones: extensión permitida, sin rutas peligrosas (path traversal),
    tope de tamaño (LEGACY_ZIP_MAX_MB, default 300 MB) y tope de archivos.
    """
    import zipfile
    from io import BytesIO

    d = _legacy_data_dir()
    content = await file.read()
    max_bytes = _LEGACY_ZIP_MAX_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(400, f"El ZIP excede el tope de {_LEGACY_ZIP_MAX_MB} MB "
                                 f"({len(content) / 1024 / 1024:.1f} MB)")
    try:
        zf = zipfile.ZipFile(BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(400, "El archivo no es un ZIP válido")
    if zf.testzip() is not None:
        raise HTTPException(400, "ZIP corrupto (CRC inválido)")

    miembros: list[zipfile.ZipInfo] = []
    bases: list[str] = []
    rechazados: list[str] = []
    for m in zf.infolist():
        nombre = m.filename.replace("\\", "/")
        base = nombre.rsplit("/", 1)[-1]
        if not base or nombre.startswith("/") or ".." in nombre.split("/"):
            rechazados.append(f"{m.filename} (ruta peligrosa)")
            continue
        if Path(base).suffix.lower() not in _LEGACY_EXT_OK:
            rechazados.append(f"{m.filename} (extensión no permitida)")
            continue
        if m.file_size > 64 * 1024 * 1024:
            rechazados.append(f"{m.filename} (archivo > 64 MB)")
            continue
        miembros.append(m)
        bases.append(base)
    if len(miembros) > 2000:
        raise HTTPException(400, f"Demasiados archivos en el ZIP ({len(miembros)} > 2000)")
    if not miembros:
        raise HTTPException(400, "El ZIP no contiene archivos legacy válidos "
                                 "(DBF/CDX/FPT/BDF/TMP)")
    if not any(b in _LEGACY_KEY_FILES for b in bases):
        raise HTTPException(400, "El ZIP no contiene las tablas clave "
                                 f"({', '.join(_LEGACY_KEY_FILES)})")
    total_descomprimido = sum(m.file_size for m in miembros)
    if total_descomprimido > 2 * 1024 * 1024 * 1024:
        raise HTTPException(400, "Contenido descomprimido > 2 GB")

    # Extraer a un directorio temporal y hacer swap A NIVEL DE CONTENIDO
    # (d puede ser un bind mount: no se puede renombrar el punto de montaje).
    d.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    tmp = d.parent / f".legacy_deploy_{ts}"
    prev = d.parent / f"{d.name}_prev_{ts}"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    extraidos = 0
    try:
        for m, base in zip(miembros, bases):
            destino = tmp / base
            with zf.open(m) as src, destino.open("wb") as out:
                shutil.copyfileobj(src, out)
            extraidos += 1
        zf.close()
        d.mkdir(parents=True, exist_ok=True)
        # 1) contenido actual → backup prev_<ts> (copia user-space: atraviesa
        #    mounts y no depende de copy_file_range)
        prev.mkdir(exist_ok=True)
        for p in list(d.iterdir()):
            if p.is_file():
                _move_file(p, prev / p.name)
        # 2) contenido nuevo → d (con restauración total si algo falla)
        try:
            for p in list(tmp.iterdir()):
                _move_file(p, d / p.name)
        except Exception:
            for p in list(d.iterdir()):
                if p.is_file():
                    p.unlink(missing_ok=True)
            for p in list(prev.iterdir()):
                if p.is_file():
                    _move_file(p, d / p.name)
            raise
        shutil.rmtree(tmp, ignore_errors=True)
        # conservar solo el último backup
        for p in sorted(d.parent.glob(f"{d.name}_prev_*"))[:-1]:
            shutil.rmtree(p, ignore_errors=True)
    except Exception as e:
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(500, f"Fallo durante el despliegue: {str(e)[:120]}")

    resumen = _legacy_dir_summary(d)
    resumen["extraidos"] = extraidos
    resumen["rechazados"] = rechazados
    resumen["backup_previo"] = prev.name
    resumen["bytes_zip"] = len(content)
    try:
        async with transaction() as conn:
            await conn.execute(text(
                "INSERT INTO legacy_import_audit (batch_id, kind, entity_key, payload) "
                "VALUES (:b, 'data_deploy', :u, CAST(:p AS jsonb))"),
                {"b": f"DEPLOY-{ts}", "u": user.get("name"),
                 "p": json.dumps({"archivos": extraidos, "rechazados": len(rechazados),
                                  "bytes_zip": len(content), "ruta": str(d)})})
    except Exception:
        pass  # la auditoría no debe romper el despliegue
    return resumen
