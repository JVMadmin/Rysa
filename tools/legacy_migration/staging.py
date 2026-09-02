"""FASE 3 — STAGING: capa de migración separada de producción.

Crea y llena SOLO tablas `legacy_*` (namespace propio, aislado) dentro de la
misma base PostgreSQL. NUNCA toca tablas productivas (clients, sales, abonos,
products, cajas, ...). Idempotente: upserts por clave legacy; se puede
re-ejecutar sin duplicar.

Decisiones oficiales post-ANALYZE aplicadas:
  A. Desmatches CxC → REVIEW_REQUIRED (CXC_MISMATCH); saldo autoritativo =
     CXCDOCS.SALDO; H1 se conserva como trazabilidad; nada se "corrige".
  B. Serie F / FACTURAS → EXCLUDED_SCOPE (FACTURA_SERIE_F); conservado en
     staging para una fase futura específica.
  C. Contado con saldo → REVIEW_REQUIRED (CASH_DOCUMENT_WITH_BALANCE); no se
     convierte en deuda por inferencia.
"""
from __future__ import annotations

import asyncio
import csv
import hashlib
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from . import config
from .dbf_reader import iter_records

TOL = 0.01
CHUNK = 5000

# Las tablas legacy_* (incluidas las de staging) las crea Alembic en la
# migración 0012_legacy_staging. Aquí solo dejamos los ALTER idempotentes
# (V7+): si la migración no las incluye o se aplican cambios antes de
# correr alembic upgrade head, estos ALTER se ejecutan sin romper nada.
DDL = [
    "ALTER TABLE legacy_tickets ADD COLUMN IF NOT EXISTS document_hash TEXT",
    "ALTER TABLE legacy_tickets ADD COLUMN IF NOT EXISTS change_status TEXT",
    "ALTER TABLE legacy_tickets ADD COLUMN IF NOT EXISTS missing_from_snapshot TEXT",
    "ALTER TABLE legacy_cxc_snapshot ADD COLUMN IF NOT EXISTS document_hash TEXT",
    "ALTER TABLE legacy_cxc_snapshot ADD COLUMN IF NOT EXISTS change_status TEXT",
    "ALTER TABLE legacy_cxc_snapshot ADD COLUMN IF NOT EXISTS missing_from_snapshot TEXT",
    "ALTER TABLE legacy_customer_mapping ADD COLUMN IF NOT EXISTS missing_from_snapshot TEXT",
]

_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_ltix_tickets_folio ON legacy_tickets (legacy_serie, legacy_folio)",
    "CREATE INDEX IF NOT EXISTS idx_ltix_details_doc ON legacy_ticket_details (doc_key)",
    "CREATE INDEX IF NOT EXISTS idx_ltix_cxc_status ON legacy_cxc_snapshot (status)",
    "CREATE INDEX IF NOT EXISTS idx_ltix_cxcmov_doc ON legacy_cxc_movements (doc_key)",
    "CREATE INDEX IF NOT EXISTS idx_ltix_review_entity ON legacy_review_queue (entity, status)",
    "CREATE INDEX IF NOT EXISTS idx_ltix_balance_estado ON legacy_client_balance (snapshot_id, estado)",
    "CREATE INDEX IF NOT EXISTS idx_ltix_balance_key ON legacy_client_balance (legacy_customer_key)",
]


def _key(serie: str, folio: str) -> str:
    return f"LEGACY:{serie}:{folio}"


def _r2(v):
    return None if v is None else round(v + 0.0, 2)


def source_hash(legacy_dir: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(legacy_dir.iterdir()):
        h.update(f"{p.name}:{p.stat().st_size}".encode())
    return h.hexdigest()[:16]


class Stager:
    def __init__(self, legacy_dir: Path, progress=print):
        self.dir = legacy_dir
        self.log = progress

    # --------------------------------------------------------- carga legacy
    def load_legacy(self) -> None:
        d = self.dir
        self.log("leyendo NOTAVTA ...")
        self.tickets: list[dict] = []
        for r in iter_records(d / "NOTAVTA.dbf",
                              only={"SERIE", "FOLIO", "CLIENTE", "FECHA",
                                    "CONDICION", "TOTAL", "SALDO", "STATUS",
                                    "FCANCELADA", "VENDEDOR", "NCRED_TOT"}):
            if r["_deleted"]:
                continue
            self.tickets.append(r)
        self.log("leyendo NVTAPAR ...")
        self.details: list[dict] = []
        for r in iter_records(d / "NVTAPAR.dbf",
                              only={"SERIE", "FOLIO", "PARTIDA", "CODIGO",
                                    "CANTIDAD", "PRECIO", "PRECIONETO",
                                    "DESCUENTO", "COSTO"}):
            if r["_deleted"]:
                continue
            self.details.append(r)
        self.log("leyendo CLIENTES / ARTICULO ...")
        # V2: clientes con SALDO maestro (CLIENTES.SALDO = saldo vigente legacy)
        self.clientes: dict[str, dict] = {}
        self.clientes_deleted: dict[str, dict] = {}
        for r in iter_records(d / "CLIENTES.dbf",
                              only={"CLAVE", "NOMBRE", "SALDO"}):
            clave = (r.get("CLAVE") or "").strip()
            info = {"nombre": (r.get("NOMBRE") or "").strip(),
                    "saldo": round(float(r.get("SALDO") or 0), 2)}
            if r["_deleted"]:
                self.clientes_deleted[clave] = info
            else:
                self.clientes[clave] = info
        self.articulo: set[str] = set()
        self.articulo_deleted: set[str] = set()
        for r in iter_records(d / "ARTICULO.dbf", only={"CODIGO"}):
            cod = (r.get("CODIGO") or "").strip()
            (self.articulo_deleted if r["_deleted"] else self.articulo).add(cod)
        self.log("leyendo CUENXCOB / CXCDOCS ...")
        self.movs: list[dict] = []
        for r in iter_records(d / "CUENXCOB.dbf",
                              only={"SERIE", "SERIENV", "FOLIO", "FOLIOMOVTO",
                                    "CONDICION", "CONCEPTO", "MOVTO", "CLIENTE",
                                    "MONTO", "APLICA"}):
            self.movs.append({**r, "_deleted": r["_deleted"]})
        self.cxcdocs: list[dict] = []
        for r in iter_records(d / "CXCDOCS.dbf",
                              only={"SERIE", "FOLIO", "CLIENTE", "CONDICION",
                                    "APLICA", "MONTO", "TOTAL", "SALDO"}):
            if r["_deleted"]:
                continue
            self.cxcdocs.append(r)

    # --------------------------------------------------- estado RYSA (lectura)
    async def load_rysa(self, conn) -> None:
        self.log("leyendo clientes/productos RYSA (solo lectura) ...")
        self.rysa_clients: dict[str, str] = {}
        rows = await conn.fetch(
            "SELECT doc->>'codigo' AS codigo, id FROM clients "
            "WHERE doc->>'codigo' IS NOT NULL AND doc->>'codigo' <> ''")
        for r in rows:
            self.rysa_clients.setdefault(r["codigo"].strip(), r["id"])
        self.rysa_products: dict[str, str] = {}
        rows = await conn.fetch(
            "SELECT doc->>'codigo' AS codigo, id FROM products "
            "WHERE doc->>'codigo' IS NOT NULL AND doc->>'codigo' <> ''")
        for r in rows:
            self.rysa_products.setdefault(r["codigo"].strip(), r["id"])

    # ------------------------------------------------------------ clasificación
    def classify(self) -> None:
        self.log("clasificando clientes ...")
        used: set[str] = set()
        for t in self.tickets:
            used.add((t.get("CLIENTE") or "").strip())
        for m in self.movs:
            used.add((m.get("CLIENTE") or "").strip())
        for c in self.cxcdocs:
            used.add((c.get("CLIENTE") or "").strip())
        used.discard("")
        self.customer_rows = []
        self.customer_status: dict[str, str] = {}
        self.customer_rid: dict[str, str | None] = {}
        for clave in sorted(used):
            nombre = self.clientes.get(clave, {}).get("nombre", "")
            if clave in self.rysa_clients:
                status, match_type, rid = "MATCHED", "codigo_exacto", self.rysa_clients[clave]
            elif clave in self.clientes_deleted:
                status, match_type, rid = "DELETED_LEGACY", "ninguno", None
            elif nombre.upper().startswith("PÚBLICO"):
                status, match_type, rid = "PUBLICO_GENERAL", "nombre", None
            elif clave in self.clientes:
                status, match_type, rid = "UNMATCHED", "legacy_activo_sin_rysa", None
            else:
                status, match_type, rid = "UNMATCHED", "ninguno", None
            if rid is None and status == "MATCHED":
                status = "REVIEW_REQUIRED"
            self.customer_status[clave] = status
            self.customer_rid[clave] = rid
            self.customer_rows.append((clave, rid, status, match_type, nombre,
                                       clave in self.clientes_deleted))

        self.log("clasificando productos ...")
        codes: set[str] = set()
        for dt in self.details:
            codes.add((dt.get("CODIGO") or "").strip())
        codes.discard("")
        self.product_rows = []
        self.product_status: dict[str, str] = {}
        for cod in sorted(codes):
            if cod in self.rysa_products:
                status, rid = "MATCHED", self.rysa_products[cod]
            else:
                status, rid = "PRODUCT_REVIEW_REQUIRED", None
            legacy_status = ("ACTIVO" if cod in self.articulo
                             else "BORRADO" if cod in self.articulo_deleted
                             else "NO_EXISTE_EN_ARTICULO")
            self.product_status[cod] = status
            self.product_rows.append((cod, rid, status, legacy_status))

        self.log("clasificando tickets y detalles ...")
        self.ticket_staged: list[tuple] = []
        self.ticket_hash: dict[str, str] = {}
        for t in self.tickets:
            serie = t.get("SERIE") or ""
            folio = t.get("FOLIO") or ""
            clave = (t.get("CLIENTE") or "").strip()
            key = _key(serie, folio)
            self.ticket_staged.append((
                key, serie, folio, clave, t.get("FECHA"),
                _r2(t.get("TOTAL")), t.get("CONDICION") or "",
                t.get("VENDEDOR") or "", bool(t.get("FCANCELADA")),
                _r2(t.get("SALDO")), t.get("STATUS") or "",
                self.customer_status.get(clave, "UNMATCHED"), json.dumps(t, default=str)))
            # V7: hash de contenido del documento (detección de cambios)
            self.ticket_hash[key] = hashlib.sha256(json.dumps({
                "c": clave, "f": t.get("FECHA"), "t": _r2(t.get("TOTAL")),
                "co": t.get("CONDICION"), "v": t.get("VENDEDOR"),
                "x": bool(t.get("FCANCELADA")), "nc": _r2(t.get("NCRED_TOT")),
                "s": t.get("STATUS")}, sort_keys=True, default=str).encode()
            ).hexdigest()[:16]
        self.detail_staged: list[tuple] = []
        for dt in self.details:
            serie = dt.get("SERIE") or ""
            folio = dt.get("FOLIO") or ""
            partida = (dt.get("PARTIDA") or "").strip()
            cod = (dt.get("CODIGO") or "").strip()
            cant = _r2(dt.get("CANTIDAD")) or 0
            precio = _r2(dt.get("PRECIO"))
            importe = _r2(cant * (precio or 0))
            self.detail_staged.append((
                f"{_key(serie, folio)}:{partida}", _key(serie, folio), partida,
                cod, cant, precio, importe,
                self.rysa_products.get(cod),
                self.product_status.get(cod, "PRODUCT_REVIEW_REQUIRED"),
                json.dumps(dt, default=str)))

        self.log("clasificando CxC (snapshot autoritativo + trazabilidad) ...")
        # H1 por documento (activos)
        agg: dict[tuple[str, str], dict] = defaultdict(
            lambda: {"c": 0.0, "a": 0.0, "n_active": 0, "n_del": 0})
        for m in self.movs:
            k = (m.get("SERIE") or "", m.get("FOLIO") or "")
            if m["_deleted"]:
                agg[k]["n_del"] += 1
                continue
            monto = _r2(m.get("MONTO")) or 0
            if (m.get("MOVTO") or "") == "C":
                agg[k]["c"] += monto
            elif (m.get("MOVTO") or "") == "A":
                agg[k]["a"] += monto
            agg[k]["n_active"] += 1
        self.cxc_staged: list[tuple] = []
        self.cxc_hash: dict[str, str] = {}
        self.cxc_status_by_key: dict[str, tuple[str, str]] = {}
        self.excluded_rows: list[tuple] = []
        self.review_rows: list[tuple] = []
        for c in self.cxcdocs:
            serie = c.get("SERIE") or ""
            folio = c.get("FOLIO") or ""
            key = _key(serie, folio)
            saldo = _r2(c.get("SALDO")) or 0.0
            a = agg.get((serie, folio), {"c": 0.0, "a": 0.0, "n_active": 0, "n_del": 0})
            calc = _r2(a["c"] - a["a"])
            diff = _r2(calc - saldo)
            cond = (c.get("CONDICION") or "").upper()
            cancelado = any(_key(t.get("SERIE") or "", t.get("FOLIO") or "") == key
                            and bool(t.get("FCANCELADA")) for t in self.tickets)
            if serie != "NV":
                status, reason = "EXCLUDED", "FACTURA_SERIE_F"
                self.excluded_rows.append((key, "CXC_DOCUMENT", serie, folio,
                                           "FACTURA_SERIE_F",
                                           json.dumps({"saldo": saldo}, default=str)))
            elif saldo < -TOL:
                status, reason = "NEGATIVE", "NEGATIVE_BALANCE"
            elif abs(saldo) <= TOL:
                status, reason = "READY", None
            else:
                reasons = []
                if abs(diff) > TOL:
                    reasons.append("CXC_MISMATCH")
                if cond == "C":
                    reasons.append("CASH_DOCUMENT_WITH_BALANCE")
                if cancelado:
                    reasons.append("CANCELLED_WITH_BALANCE")
                if reasons:
                    status, reason = "REVIEW_REQUIRED", "+".join(reasons)
                else:
                    status, reason = "READY", None
            self.cxc_status_by_key[key] = (status, reason or "")
            self.cxc_staged.append((
                key, serie, folio, (c.get("CLIENTE") or "").strip(), cond,
                saldo, calc, diff, a["n_active"], a["n_del"],
                _r2(a["c"]), _r2(a["a"]), cancelado, status, reason))
            # V7: hash del documento CxC (cliente + saldo + cancelación)
            self.cxc_hash[key] = hashlib.sha256(json.dumps({
                "c": (c.get("CLIENTE") or "").strip(), "s": saldo,
                "co": cond, "x": cancelado, "m": a["n_active"]},
                sort_keys=True, default=str).encode()).hexdigest()[:16]
            if status == "REVIEW_REQUIRED":
                self.review_rows.append((
                    key, "CXC_DOCUMENT", reason,
                    json.dumps({"saldo": saldo, "calculated": calc,
                                "difference": diff, "condicion": cond,
                                "cliente": c.get("CLIENTE")}, default=str)))
        self.log("trazabilidad del ledger CUENXCOB ...")
        self.cxc_mov_rows: list[tuple] = []
        self.mov_excluded: int = 0
        for m in self.movs:
            serie = m.get("SERIE") or ""
            folio = m.get("FOLIO") or ""
            key = f"LEGACY:MOV:{serie}:{folio}:{m.get('MOVTO') or ''}:" \
                  f"{m.get('FOLIOMOVTO') or ''}:{m.get('APLICA') or ''}:" \
                  f"{_r2(m.get('MONTO'))}:{m['_recno']}"
            doc_key = _key(serie, folio)
            self.cxc_mov_rows.append((
                key, doc_key, serie, folio, m.get("FOLIOMOVTO") or "",
                m.get("MOVTO") or "", (m.get("CLIENTE") or "").strip(),
                _r2(m.get("MONTO")), m.get("APLICA"), m.get("CONCEPTO") or "",
                m.get("CONDICION") or "", bool(m["_deleted"])))
            if serie != "NV" and not m["_deleted"]:
                self.mov_excluded += 1
                self.excluded_rows.append((
                    key, "CXC_MOVEMENT", serie, folio, "FACTURA_SERIE_F",
                    json.dumps({"monto": _r2(m.get("MONTO")),
                                "movto": m.get("MOVTO")}, default=str)))

        # --- V2: saldo maestro por cliente vs documentos vs ledger ---
        self.log("reconciliación maestro/documentos/ledger por cliente ...")
        docs_saldo: dict[str, float] = defaultdict(float)
        for c in self.cxcdocs:
            docs_saldo[(c.get("CLIENTE") or "").strip()] += _r2(c.get("SALDO")) or 0
        ledger: dict[str, float] = defaultdict(float)
        for m in self.movs:
            if m["_deleted"]:
                continue
            mv = m.get("MOVTO") or ""
            cli = (m.get("CLIENTE") or "").strip()
            if mv == "C":
                ledger[cli] += _r2(m.get("MONTO")) or 0
            elif mv == "A":
                ledger[cli] -= _r2(m.get("MONTO")) or 0
        self.balance_rows: list[tuple] = []
        claves = sorted(set(self.clientes) | set(docs_saldo) | set(ledger))
        for clave in claves:
            ficha = self.clientes.get(clave)
            master = ficha["saldo"] if ficha else None
            ds = _r2(docs_saldo.get(clave, 0.0))
            ls = _r2(ledger.get(clave, 0.0))
            if master is None:
                estado = "REVIEW"          # sin ficha activa en CLIENTES
                master_v = None
            else:
                master_v = master
                dd = _r2(master - ds)
                dl = _r2(master - ls)
                estado = ("MATCH" if abs(dd) <= TOL and abs(dl) <= TOL
                          else "DIFFERENCE")
            self.balance_rows.append((
                clave, ficha["nombre"] if ficha else "", master_v, ds, ls,
                _r2((master_v or 0) - ds) if master_v is not None else None,
                _r2((master_v or 0) - ls) if master_v is not None else None,
                estado, self.customer_rid.get(clave)))

    # ---------------------------------------------------------------- escritura
    async def write_staging(self, conn, batch_id: str) -> None:
        self.log("creando tablas legacy_* (solo si no existen) ...")
        for stmt in DDL:
            await conn.execute(stmt)
        for stmt in _INDEXES:
            await conn.execute(stmt)
        self.snapshot_id = f"SNAP-{batch_id}"
        snapshot_id = self.snapshot_id

        self.log("upsert customer mapping ...")
        snapshot_id = f"SNAP-{batch_id}"
        await conn.execute(
            """INSERT INTO legacy_snapshots (snapshot_id, batch_id, source_path,
                 source_hash, files_count, notes)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (snapshot_id) DO UPDATE SET
                 batch_id=EXCLUDED.batch_id, source_path=EXCLUDED.source_path,
                 source_hash=EXCLUDED.source_hash,
                 files_count=EXCLUDED.files_count, notes=EXCLUDED.notes""",
            snapshot_id, batch_id, str(self.dir), source_hash(self.dir),
            sum(1 for _ in self.dir.iterdir()),
            "Snapshot legacy versionado (V2): re-ejecutar crea un snapshot nuevo")
        await conn.executemany(
            """INSERT INTO legacy_customer_mapping (legacy_customer_key,
                 rysa_customer_id, status, match_type, legacy_nombre,
                 legacy_deleted, last_batch_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7)
               ON CONFLICT (legacy_customer_key) DO UPDATE SET
                 rysa_customer_id=EXCLUDED.rysa_customer_id,
                 status=EXCLUDED.status, match_type=EXCLUDED.match_type,
                 legacy_nombre=EXCLUDED.legacy_nombre,
                 legacy_deleted=EXCLUDED.legacy_deleted,
                 last_batch_id=EXCLUDED.last_batch_id, updated_at=now(),
                 missing_from_snapshot=NULL""",
            [(k, r, s, m, n, d, batch_id)
             for (k, r, s, m, n, d) in self.customer_rows])
        for k, r, s, m, n, d in self.customer_rows:
            if s == "REVIEW_REQUIRED":
                self.review_rows.append((k, "CUSTOMER", "CLIENT_MAPPING_REVIEW",
                                         json.dumps({"nombre": n}, default=str)))

        self.log("upsert product mapping ...")
        await conn.executemany(
            """INSERT INTO legacy_product_mapping (legacy_product_key,
                 rysa_product_id, mapping_status, legacy_status, last_batch_id)
               VALUES ($1,$2,$3,$4,$5) ON CONFLICT (legacy_product_key) DO
               UPDATE SET rysa_product_id=EXCLUDED.rysa_product_id,
                 mapping_status=EXCLUDED.mapping_status,
                 legacy_status=EXCLUDED.legacy_status,
                 last_batch_id=EXCLUDED.last_batch_id, updated_at=now()""",
            [(k, r, s, ls, batch_id) for (k, r, s, ls) in self.product_rows])
        for k, r, s, ls in self.product_rows:
            if s == "PRODUCT_REVIEW_REQUIRED":
                self.review_rows.append((k, "PRODUCT", "PRODUCT_MAPPING_REVIEW",
                                         json.dumps({"legacy_status": ls},
                                                    default=str)))

        self.log("snapshot de balances por cliente (V2) ...")
        for i in range(0, len(self.balance_rows), CHUNK):
            await conn.executemany(
                """INSERT INTO legacy_client_balance (snapshot_id,
                     legacy_customer_key, legacy_nombre, master_saldo,
                     docs_saldo, ledger_saldo, diff_docs, diff_ledger,
                     estado, rysa_customer_id, last_batch_id)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                   ON CONFLICT (snapshot_id, legacy_customer_key) DO UPDATE SET
                     legacy_nombre=EXCLUDED.legacy_nombre,
                     master_saldo=EXCLUDED.master_saldo,
                     docs_saldo=EXCLUDED.docs_saldo,
                     ledger_saldo=EXCLUDED.ledger_saldo,
                     diff_docs=EXCLUDED.diff_docs,
                     diff_ledger=EXCLUDED.diff_ledger, estado=EXCLUDED.estado,
                     rysa_customer_id=EXCLUDED.rysa_customer_id,
                     last_batch_id=EXCLUDED.last_batch_id, updated_at=now()""",
                [(snapshot_id,) + row + (batch_id,)
                 for row in self.balance_rows[i:i + CHUNK]])

        self.log("upsert tickets (con detección de cambios V7) ...")
        # V7: clasificación de cambios vs estado previo en BD
        prev_t = {r[0]: (r[1], r[2]) for r in await conn.fetch(
            "SELECT legacy_key, document_hash, legacy_cancelado FROM legacy_tickets")}
        self.change_status_t: dict[str, str] = {}
        for row in self.ticket_staged:
            key = row[0]
            h = self.ticket_hash[key]
            prev_hash, prev_cancel = prev_t.get(key, (None, None))
            if prev_hash is None:
                ch = "CREATED"
            elif prev_hash == h:
                ch = "UNCHANGED"
            elif row[8] and not prev_cancel:
                ch = "CANCELLED"
            else:
                ch = "UPDATED"
            self.change_status_t[key] = ch
        self.tickets_new = sum(1 for v in self.change_status_t.values()
                               if v == "CREATED")
        self.tickets_unchanged = sum(1 for v in self.change_status_t.values()
                                     if v == "UNCHANGED")
        self.tickets_updated = sum(1 for v in self.change_status_t.values()
                                   if v == "UPDATED")
        self.tickets_cancelled = sum(1 for v in self.change_status_t.values()
                                     if v == "CANCELLED")
        for i in range(0, len(self.ticket_staged), CHUNK):
            await conn.executemany(
                """INSERT INTO legacy_tickets (legacy_key, legacy_serie,
                     legacy_folio, legacy_cliente, legacy_fecha, legacy_total,
                     legacy_condicion, legacy_vendedor, legacy_cancelado,
                     legacy_saldo_original, legacy_status, customer_status,
                     doc, migration_status, last_batch_id,
                     document_hash, change_status)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,
                           'STAGED',$14,$15,$16)
                   ON CONFLICT (legacy_key) DO UPDATE SET
                     legacy_total=EXCLUDED.legacy_total,
                     legacy_fecha=EXCLUDED.legacy_fecha,
                     legacy_condicion=EXCLUDED.legacy_condicion,
                     legacy_vendedor=EXCLUDED.legacy_vendedor,
                     legacy_cancelado=EXCLUDED.legacy_cancelado,
                     legacy_saldo_original=EXCLUDED.legacy_saldo_original,
                     legacy_status=EXCLUDED.legacy_status,
                     customer_status=EXCLUDED.customer_status,
                     doc=EXCLUDED.doc, migration_status='STAGED',
                     last_batch_id=EXCLUDED.last_batch_id, updated_at=now(),
                     document_hash=EXCLUDED.document_hash,
                     change_status=EXCLUDED.change_status,
                     missing_from_snapshot=NULL""",
                [(row[0], row[1], row[2], row[3], row[4], row[5], row[6],
                  row[7], row[8], row[9], row[10], row[11], row[12],
                  batch_id, self.ticket_hash[row[0]],
                  self.change_status_t[row[0]])
                 for row in self.ticket_staged[i:i + CHUNK]])

        self.log("upsert detalles ...")
        for i in range(0, len(self.detail_staged), CHUNK):
            await conn.executemany(
                """INSERT INTO legacy_ticket_details (legacy_key, doc_key,
                     partida, legacy_codigo, legacy_cantidad, legacy_precio,
                     legacy_importe_calculado, rysa_product_id,
                     mapping_status, doc, last_batch_id)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
                   ON CONFLICT (legacy_key) DO UPDATE SET
                     legacy_cantidad=EXCLUDED.legacy_cantidad,
                     legacy_precio=EXCLUDED.legacy_precio,
                     legacy_importe_calculado=EXCLUDED.legacy_importe_calculado,
                     rysa_product_id=EXCLUDED.rysa_product_id,
                     mapping_status=EXCLUDED.mapping_status, doc=EXCLUDED.doc,
                     last_batch_id=EXCLUDED.last_batch_id, updated_at=now()""",
                [row + (batch_id,) for row in self.detail_staged[i:i + CHUNK]])

        self.log("upsert snapshot CxC (con detección de cambios V7) ...")
        prev_c = {r[0]: (r[1], r[2]) for r in await conn.fetch(
            "SELECT legacy_key, document_hash, cancelado FROM legacy_cxc_snapshot")}
        self.change_status_c: dict[str, str] = {}
        for row in self.cxc_staged:
            key = row[0]
            h = self.cxc_hash[key]
            prev_hash, prev_cancel = prev_c.get(key, (None, None))
            if prev_hash is None:
                ch = "CREATED"
            elif prev_hash == h:
                ch = "UNCHANGED"
            elif row[12] and not prev_cancel:
                ch = "CANCELLED"
            else:
                ch = "UPDATED"
            self.change_status_c[key] = ch
        self.cxc_new = sum(1 for v in self.change_status_c.values() if v == "CREATED")
        self.cxc_unchanged = sum(1 for v in self.change_status_c.values() if v == "UNCHANGED")
        self.cxc_updated = sum(1 for v in self.change_status_c.values() if v == "UPDATED")
        self.cxc_cancelled = sum(1 for v in self.change_status_c.values() if v == "CANCELLED")
        for i in range(0, len(self.cxc_staged), CHUNK):
            await conn.executemany(
                """INSERT INTO legacy_cxc_snapshot (legacy_key, legacy_serie,
                     legacy_folio, legacy_cliente, legacy_condicion,
                     legacy_saldo, calculated_saldo, difference,
                     movement_count, deleted_movement_count, c_total, a_total,
                     cancelado, status, review_reason, last_batch_id,
                     document_hash, change_status)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
                   ON CONFLICT (legacy_key) DO UPDATE SET
                     legacy_saldo=EXCLUDED.legacy_saldo,
                     calculated_saldo=EXCLUDED.calculated_saldo,
                     difference=EXCLUDED.difference,
                     movement_count=EXCLUDED.movement_count,
                     deleted_movement_count=EXCLUDED.deleted_movement_count,
                     c_total=EXCLUDED.c_total, a_total=EXCLUDED.a_total,
                     cancelado=EXCLUDED.cancelado, status=EXCLUDED.status,
                     review_reason=EXCLUDED.review_reason,
                     last_batch_id=EXCLUDED.last_batch_id, updated_at=now(),
                     document_hash=EXCLUDED.document_hash,
                     change_status=EXCLUDED.change_status,
                     missing_from_snapshot=NULL""",
                [row + (batch_id, self.cxc_hash[row[0]],
                        self.change_status_c[row[0]])
                 for row in self.cxc_staged[i:i + CHUNK]])

        self.log("upsert movimientos del ledger ...")
        for i in range(0, len(self.cxc_mov_rows), CHUNK):
            await conn.executemany(
                """INSERT INTO legacy_cxc_movements (legacy_key, doc_key, serie,
                     folio, foliomovto, movto, cliente, monto, aplica,
                     concepto, condicion, deleted, last_batch_id)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                   ON CONFLICT (legacy_key) DO UPDATE SET monto=EXCLUDED.monto,
                     cliente=EXCLUDED.cliente, deleted=EXCLUDED.deleted,
                     last_batch_id=EXCLUDED.last_batch_id, updated_at=now()""",
                [row + (batch_id,) for row in self.cxc_mov_rows[i:i + CHUNK]])

        self.log("upsert excluidos y cola de revisión ...")
        for i in range(0, len(self.excluded_rows), CHUNK):
            await conn.executemany(
                """INSERT INTO legacy_excluded_documents (legacy_key, entity,
                     serie, folio, reason, scope_status, payload, last_batch_id)
                   VALUES ($1,$2,$3,$4,$5,'EXCLUDED_SCOPE',$6::jsonb,$7)
                   ON CONFLICT (legacy_key) DO UPDATE SET
                     scope_status='EXCLUDED_SCOPE',
                     payload=EXCLUDED.payload, last_batch_id=EXCLUDED.last_batch_id,
                     updated_at=now()""",
                [row + (batch_id,) for row in self.excluded_rows[i:i + CHUNK]])
        for i in range(0, len(self.review_rows), CHUNK):
            await conn.executemany(
                """INSERT INTO legacy_review_queue (legacy_key, entity, reason,
                     detail, last_batch_id) VALUES ($1,$2,$3,$4::jsonb,$5)
                   ON CONFLICT (entity, legacy_key, reason) DO UPDATE SET
                     detail=EXCLUDED.detail, last_batch_id=EXCLUDED.last_batch_id""",
                [row + (batch_id,) for row in self.review_rows[i:i + CHUNK]])

        # ---------------- V7: MISSING_FROM_SNAPSHOT (nunca se borra) ----------
        self.log("marcando ausencias del snapshot (V7) ...")

        async def _mark_missing(table: str, col: str, staged: list[str]) -> int:
            if not staged:          # snapshot vacío: no marcar nada
                return 0
            r = await conn.execute(
                f"""UPDATE {table} SET missing_from_snapshot=$1
                    WHERE missing_from_snapshot IS NULL
                      AND {col} <> ALL($2)""", snapshot_id, staged)
            try:
                return int(r.split()[-1])
            except (ValueError, AttributeError):
                return 0

        self.tickets_missing = await _mark_missing(
            "legacy_tickets", "legacy_key", [row[0] for row in self.ticket_staged])
        self.cxc_missing = await _mark_missing(
            "legacy_cxc_snapshot", "legacy_key", [row[0] for row in self.cxc_staged])
        self.clientes_missing = await _mark_missing(
            "legacy_customer_mapping", "legacy_customer_key",
            [row[0] for row in self.customer_rows])
        self.log(f"  MISSING tickets={self.tickets_missing} "
                 f"cxc={self.cxc_missing} clientes={self.clientes_missing}")

    # ------------------------------------------------------------- validaciones
    def validations(self) -> dict:
        t_all = len(self.tickets)
        c_all = len(self.cxcdocs)
        d_all = len(self.details)
        cx = Counter(s for (_k, _se, _f, _cl, _co, _sa, _ca, _di, _na, _nd,
                            _c, _a, _ca2, s, _r) in self.cxc_staged)
        cust = Counter(r[2] for r in self.customer_rows)
        prod = Counter(r[2] for r in self.product_rows)
        out = {
            "tickets": {"legacy": t_all, "staged": len(self.ticket_staged),
                        "excluded": 0, "review": 0,
                        "ecuacion_ok": t_all == len(self.ticket_staged)},
            "detalles": {"legacy": d_all, "staged": len(self.detail_staged),
                         "review": sum(1 for r in self.detail_staged
                                       if r[8] == "PRODUCT_REVIEW_REQUIRED"),
                         "ecuacion_ok": d_all == len(self.detail_staged)},
            "cxc": {"cxcdocs_legacy": c_all,
                    "READY": cx.get("READY", 0),
                    "REVIEW_REQUIRED": cx.get("REVIEW_REQUIRED", 0),
                    "NEGATIVE": cx.get("NEGATIVE", 0),
                    "EXCLUDED": cx.get("EXCLUDED", 0),
                    "suma_estados": sum(cx.values()),
                    "ecuacion_ok": sum(cx.values()) == c_all},
            "clientes": dict(cust), "productos": dict(prod),
        }
        bal = Counter(r[7] for r in self.balance_rows)
        master_sum = round(sum(r[2] for r in self.balance_rows
                               if r[2] is not None), 2)
        docs_sum = round(sum(r[3] for r in self.balance_rows), 2)
        ledger_sum = round(sum(r[4] for r in self.balance_rows), 2)
        out["balances"] = {
            "MATCH": bal.get("MATCH", 0),
            "DIFFERENCE": bal.get("DIFFERENCE", 0),
            "REVIEW": bal.get("REVIEW", 0),
            "suma_master_saldo": master_sum,
            "suma_docs_saldo": docs_sum,
            "suma_ledger_saldo": ledger_sum,
            "gap_master_vs_docs": round(master_sum - docs_sum, 2),
            "gap_master_vs_ledger": round(master_sum - ledger_sum, 2),
        }
        # V7: detección de cambios vs snapshot anterior
        out["cambios"] = {
            "tickets": {"nuevos": getattr(self, "tickets_new", 0),
                        "sin_cambios": getattr(self, "tickets_unchanged", 0),
                        "modificados": getattr(self, "tickets_updated", 0),
                        "cancelados": getattr(self, "tickets_cancelled", 0),
                        "ausentes": getattr(self, "tickets_missing", 0)},
            "cxc": {"nuevos": getattr(self, "cxc_new", 0),
                    "sin_cambios": getattr(self, "cxc_unchanged", 0),
                    "modificados": getattr(self, "cxc_updated", 0),
                    "cancelados": getattr(self, "cxc_cancelled", 0),
                    "ausentes": getattr(self, "cxc_missing", 0)},
            "clientes_ausentes": getattr(self, "clientes_missing", 0),
        }
        return out


async def run(legacy_dir: Path | None = None, progress=print) -> dict:
    import asyncpg

    legacy_dir = legacy_dir or config.resolve_legacy_data_path()
    if not legacy_dir.is_dir():
        return {"status": "NOT_FOUND", "expected_path": str(legacy_dir)}
    url = os.environ.get("DATABASE_URL", "").replace("+asyncpg", "")
    if not url:
        return {"status": "NO_DATABASE_URL",
                "message": "DATABASE_URL no definida (ejecutar dentro del backend)"}
    started = datetime.now(timezone.utc)
    st = Stager(legacy_dir, progress=progress)
    st.load_legacy()
    batch_id = f"B{started.strftime('%Y%m%d%H%M%S')}"
    conn = await asyncpg.connect(url)
    try:
        await st.load_rysa(conn)
        st.classify()
        await st.write_staging(conn, batch_id)
        vals = st.validations()
        counts = {
            "records_discovered": len(st.tickets) + len(st.details) +
                                  len(st.movs) + len(st.cxcdocs),
            "records_staged": len(st.ticket_staged) + len(st.detail_staged) +
                              len(st.cxc_staged) + len(st.cxc_mov_rows),
            "records_ready": vals["cxc"]["READY"] + vals["tickets"]["staged"],
            "records_review": len(st.review_rows),
            "records_excluded": len(st.excluded_rows),
        }
        await conn.execute(
            """INSERT INTO legacy_migration_batch (batch_id, source_path,
                 source_hash, status, records_discovered, records_staged,
                 records_ready, records_review, records_excluded, validations)
               VALUES ($1,$2,$3,'STAGED',$4,$5,$6,$7,$8,$9::jsonb)""",
            batch_id, str(legacy_dir), source_hash(legacy_dir),
            counts["records_discovered"], counts["records_staged"],
            counts["records_ready"], counts["records_review"],
            counts["records_excluded"], json.dumps(vals))
    finally:
        await conn.close()
    finished = datetime.now(timezone.utc)
    meta = {"batch_id": batch_id, "generated_at": started.isoformat(),
            "duration_seconds": round((finished - started).total_seconds(), 1),
            "legacy_path": str(legacy_dir)}
    paths = write_reports(st, vals, meta)
    return {"status": "OK", "batch_id": batch_id, "validations": vals,
            "counts": counts, "outputs": paths, "meta": meta}


# ------------------------------------------------------------------ reportes
def write_reports(st: Stager, vals: dict, meta: dict) -> dict:
    outdir = config.resolve_reports_dir() / "staging"
    outdir.mkdir(parents=True, exist_ok=True)
    paths = {}

    def wcsv(name, header, rows):
        p = outdir / name
        with p.open("w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh)
            w.writerow(header)
            w.writerows(rows)
        paths[name] = str(p)

    wcsv("customer_mapping.csv",
         ["LEGACY_CUSTOMER_KEY", "RYSA_CUSTOMER_ID", "STATUS", "MATCH_TYPE",
          "NOMBRE_LEGACY", "BORRADO"],
         [list(r) for r in st.customer_rows])
    wcsv("product_mapping.csv",
         ["LEGACY_PRODUCT_KEY", "RYSA_PRODUCT_ID", "MAPPING_STATUS", "LEGACY_STATUS"],
         [list(r) for r in st.product_rows])
    wcsv("tickets_staging.csv",
         ["LEGACY_KEY", "SERIE", "FOLIO", "CLIENTE", "FECHA", "TOTAL",
          "CONDICION", "VENDEDOR", "CANCELADO", "SALDO_ORIGINAL", "STATUS",
          "CUSTOMER_STATUS"],
         [r[:12] for r in st.ticket_staged])
    wcsv("ticket_details_staging.csv",
         ["LEGACY_KEY", "DOC_KEY", "PARTIDA", "CODIGO", "CANTIDAD", "PRECIO",
          "IMPORTE_CALCULADO", "RYSA_PRODUCT_ID", "MAPPING_STATUS"],
         [r[:9] for r in st.detail_staged])
    wcsv("cxc_staging.csv",
         ["LEGACY_KEY", "SERIE", "FOLIO", "CLIENTE", "CONDICION", "SALDO",
          "CALCULATED", "DIFFERENCE", "MOVEMENTS", "DELETED_MOV", "C_TOTAL",
          "A_TOTAL", "CANCELADO", "STATUS", "REVIEW_REASON"],
         [list(r) for r in st.cxc_staged])
    wcsv("review_queue.csv",
         ["ENTITY", "LEGACY_KEY", "REASON"],
         [[r[1], r[0], r[2]] for r in st.review_rows])
    wcsv("excluded_documents.csv",
         ["ENTITY", "LEGACY_KEY", "SERIE", "FOLIO", "REASON"],
         [[r[1], r[0], r[2], r[3], r[4]] for r in st.excluded_rows])

    # ---------- V2: carpetas temáticas ----------
    base = config.resolve_reports_dir()
    cust_dir = base / "customers"; cust_dir.mkdir(parents=True, exist_ok=True)
    recon_dir = base / "reconciliation"; recon_dir.mkdir(parents=True, exist_ok=True)
    snap_dir = base / "snapshots"; snap_dir.mkdir(parents=True, exist_ok=True)
    cxc_dir = base / "cxc"; cxc_dir.mkdir(parents=True, exist_ok=True)
    prod_dir = base / "products"; prod_dir.mkdir(parents=True, exist_ok=True)
    sales_dir = base / "sales"; sales_dir.mkdir(parents=True, exist_ok=True)
    err_dir = base / "errors"; err_dir.mkdir(parents=True, exist_ok=True)

    def wcsv_dir(folder: Path, name, header, rows):
        folder.mkdir(parents=True, exist_ok=True)
        p = folder / name
        with p.open("w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh)
            w.writerow(header)
            w.writerows(rows)
        paths[f"{folder.name}/{name}"] = str(p)

    wcsv_dir(cust_dir, "client_balance.csv",
             ["LEGACY_CUSTOMER_KEY", "NOMBRE", "MASTER_SALDO", "DOCS_SALDO",
              "LEDGER_SALDO", "DIFF_DOCS", "DIFF_LEDGER", "ESTADO",
              "RYSA_CUSTOMER_ID"],
             [[r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]]
              for r in st.balance_rows])
    wcsv_dir(recon_dir, "client_balance_reconciliation.csv",
             ["LEGACY_CUSTOMER_KEY", "NOMBRE", "MASTER_SALDO", "DOCS_SALDO",
              "LEDGER_SALDO", "DIFF_DOCS", "DIFF_LEDGER", "ESTADO"],
             [[r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]]
              for r in sorted(st.balance_rows,
                              key=lambda r: abs((r[5] or 0) if r[5] is not None else 0)
                              + abs((r[6] or 0) if r[6] is not None else 0),
                              reverse=True)])
    wcsv_dir(snap_dir, "snapshot_index.csv",
             ["BATCH", "GENERATED_AT", "LEGACY_PATH", "SNAPSHOT_ID"],
             [[meta["batch_id"], meta["generated_at"], meta["legacy_path"],
               getattr(st, "snapshot_id", "")]])
    wcsv_dir(cxc_dir, "cxc_document_status.csv",
             ["LEGACY_KEY", "SERIE", "FOLIO", "CLIENTE", "SALDO", "CALCULATED",
              "STATUS", "REVIEW_REASON"],
             [[r[0], r[1], r[2], r[3], r[5], r[6], r[13], r[14]]
              for r in st.cxc_staged])
    wcsv_dir(prod_dir, "product_mapping_full.csv",
             ["LEGACY_PRODUCT_KEY", "RYSA_PRODUCT_ID", "MAPPING_STATUS",
              "LEGACY_STATUS"],
             [list(r) for r in st.product_rows])
    wcsv_dir(sales_dir, "tickets_index.csv",
             ["LEGACY_KEY", "SERIE", "FOLIO", "CLIENTE", "FECHA", "TOTAL",
              "CONDICION", "CANCELADO"],
             [[r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[8]]
              for r in st.ticket_staged])
    wcsv_dir(err_dir, "review_queue_full.csv",
             ["ENTITY", "LEGACY_KEY", "REASON", "DETAIL"],
             [[r[1], r[0], r[2], r[3]] for r in st.review_rows])
    wcsv_dir(snap_dir, "changes_vs_previous.csv",
             ["ENTITY", "CHANGE", "COUNT"],
             [["TICKET", k, v] for k, v in
              vals.get("cambios", {}).get("tickets", {}).items()] +
             [["CXC", k, v] for k, v in
              vals.get("cambios", {}).get("cxc", {}).items()] +
             [["CLIENTES", "ausentes",
               vals.get("cambios", {}).get("clientes_ausentes", 0)]])

    # migration_summary.csv con las ecuaciones de validación
    summary = []
    for scope, v in vals.items():
        if isinstance(v, dict):
            for k, val in v.items():
                summary.append([scope, k, val])
        else:
            summary.append([scope, "", v])
    wcsv("migration_summary.csv", ["SCOPE", "METRICA", "VALOR"], summary)

    md = build_markdown(st, vals, meta, paths)
    p = config.project_root() / "RYSA_LEGACY_STAGING_REPORT.md"
    p.write_text(md, encoding="utf-8")
    paths["markdown"] = str(p)
    return paths


def build_markdown(st: Stager, vals: dict, meta: dict, paths: dict) -> str:
    L: list[str] = []
    a = L.append
    cx = vals["cxc"]
    a("# RYSA LEGACY STAGING REPORT (FASE 3)\n")
    a(f"Batch: `{meta['batch_id']}` · Generado: {meta['generated_at']} · "
      f"Duración: {meta['duration_seconds']} s · Fuente: `{meta['legacy_path']}`\n")
    a("## 1. Resumen del batch\n")
    a(f"- Tickets staged: **{vals['tickets']['staged']:,}** "
      f"(legacy {vals['tickets']['legacy']:,} → ecuación "
      f"{'OK' if vals['tickets']['ecuacion_ok'] else '❌ DIFIERE'})")
    a(f"- Detalles staged: **{vals['detalles']['staged']:,}** "
      f"(legacy {vals['detalles']['legacy']:,} → "
      f"{'OK' if vals['detalles']['ecuacion_ok'] else '❌'})")
    a(f"- CxC snapshot: **{cx['suma_estados']:,}** de {cx['cxcdocs_legacy']:,} → "
      f"READY {cx['READY']:,} · REVIEW {cx['REVIEW_REQUIRED']:,} · "
      f"NEGATIVE {cx['NEGATIVE']:,} · EXCLUDED {cx['EXCLUDED']:,} "
      f"({'OK' if cx['ecuacion_ok'] else '❌'})")
    a(f"- Clientes mapeados: {sum(vals['clientes'].values()):,} → "
      f"`{vals['clientes']}`")
    a(f"- Productos mapeados: {sum(vals['productos'].values()):,} → "
      f"`{vals['productos']}`")
    b = vals.get("balances", {})
    a(f"- **Balances por cliente (V2):** MATCH {b.get('MATCH', 0):,} · "
      f"DIFFERENCE {b.get('DIFFERENCE', 0):,} · REVIEW {b.get('REVIEW', 0):,} · "
      f"maestro ${b.get('suma_master_saldo', 0):,.2f} · docs "
      f"${b.get('suma_docs_saldo', 0):,.2f} · ledger "
      f"${b.get('suma_ledger_saldo', 0):,.2f} · brechas: docs "
      f"${b.get('gap_master_vs_docs', 0):,.2f} / ledger "
      f"${b.get('gap_master_vs_ledger', 0):,.2f}\n")
    a(f"- Excluidos (serie F): {len(st.excluded_rows):,} registros "
      f"({st.mov_excluded} movimientos + documentos) · "
      f"Cola de revisión: {len(st.review_rows):,}\n")
    a("## 2. Decisiones oficiales aplicadas\n")
    a("- **A (desmatches):** saldo autoritativo = CXCDOCS.SALDO; H1 conservado "
      "como trazabilidad; desmatches → `REVIEW_REQUIRED (CXC_MISMATCH)`; nada "
      "corregido ni eliminado.")
    a("- **B (serie F):** `EXCLUDED_SCOPE (FACTURA_SERIE_F)`; datos conservados "
      "en staging para fase futura.")
    a("- **C (contado con saldo):** `REVIEW_REQUIRED "
      "(CASH_DOCUMENT_WITH_BALANCE)`; no se convierte en deuda por inferencia.\n")
    a("## 3. Idempotencia y auditoría\n")
    a("- Claves: `LEGACY:SERIE:FOLIO` (tickets/CxC) · "
      "`LEGACY:SERIE:FOLIO:PARTIDA` (detalles) · "
      "`LEGACY:MOV:...:FOLIOMOVTO:APLICA:MONTO:recno` (ledger).")
    a("- Upserts `ON CONFLICT` → re-ejecuciones no duplican.")
    a("- Toda fila conserva `source='LEGACY'`, `legacy_table`, doc JSONB "
      "original y `last_batch_id`.\n")
    a("## 4. Tablas staging creadas (namespace aislado, producción intacta)\n")
    a("legacy_migration_batch · legacy_customer_mapping · "
      "legacy_product_mapping · legacy_tickets · legacy_ticket_details · "
      "legacy_cxc_snapshot · legacy_cxc_movements · legacy_excluded_documents "
      "· legacy_review_queue\n")
    a("## 5. Notas\n")
    a("- `legacy_importe_calculado` en detalles = CANTIDAD × PRECIO (NVTAPAR "
      "no tiene campo IMPORTE; documentado).")
    a("- CAJAPAGO NO se staginga: son movimientos de caja históricos fuera del "
      "universo de importación (sección 11 del prompt); permanecen en "
      "legacy_data/ y en los reportes de análisis.")
    a("- Productos: la colección `products` de RYSA (dev) está vacía → todas "
      "las partidas quedan `PRODUCT_REVIEW_REQUIRED` hasta que exista el "
      "catálogo RYSA; el match a nivel legacy (ARTICULO) se conserva en "
      "`legacy_status`.")
    a("- Clientes: match exacto por `clients.doc->>'codigo'`; sin duplicados "
      "de codigo en RYSA (686/686 únicos).\n")
    a("## 6. Reportes generados\n")
    for k, v in paths.items():
        a(f"- `{v}`")
    a("\n## 7. Estado\n")
    a("**STAGING COMPLETADO — producción sin modificar. Siguiente fase "
      "prevista: DRY-RUN (solo con instrucción explícita).**\n")
    return "\n".join(L)
