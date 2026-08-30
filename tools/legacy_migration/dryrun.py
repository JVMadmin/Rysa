"""FASE 4 — DRY-RUN: simulación exacta de la futura importación.

SOLO LECTURA: hace SELECT sobre las tablas legacy_* de staging y sobre las
tablas productivas ÚNICAMENTE para verificar que siguen intactas. Nunca
escribe en producción. Repite la simulación dos veces y compara resultados
(idempotencia). Genera RYSA_LEGACY_DRY_RUN_REPORT.md + CSVs.
"""
from __future__ import annotations

import asyncio
import csv
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from . import config


def _r2(v):
    return None if v is None else round(float(v), 2)


async def _collect(conn) -> dict:
    """Una pasada completa de simulación (solo SELECT)."""
    m: dict = {}

    # --- tickets ---
    m["tickets_total_staged"] = await conn.fetchval(
        "SELECT count(*) FROM legacy_tickets")
    m["tickets_would_insert"] = await conn.fetchval(
        "SELECT count(*) FROM legacy_tickets t WHERE NOT EXISTS "
        "(SELECT 1 FROM sales s WHERE s.id = t.legacy_key)")
    m["tickets_would_skip_existing"] = m["tickets_total_staged"] - m["tickets_would_insert"]
    m["tickets_cancelled"] = await conn.fetchval(
        "SELECT count(*) FROM legacy_tickets WHERE legacy_cancelado")
    m["tickets_cancelled_con_saldo"] = await conn.fetchval(
        "SELECT count(*) FROM legacy_tickets WHERE legacy_cancelado "
        "AND COALESCE(legacy_saldo_original,0) > 0.01")
    m["tickets_cancelled_sin_saldo"] = m["tickets_cancelled"] - m["tickets_cancelled_con_saldo"]
    m["tickets_by_customer_status"] = {
        r["k"]: r["v"] for r in await conn.fetch(
            "SELECT customer_status AS k, count(*) AS v FROM legacy_tickets "
            "GROUP BY 1")}
    m["tickets_total_monto"] = _r2(await conn.fetchval(
        "SELECT COALESCE(sum(legacy_total),0) FROM legacy_tickets"))

    # identidad: unicidad (SERIE, FOLIO)
    m["tickets_identity"] = dict(await conn.fetchrow(
        "SELECT count(*) AS rows, count(DISTINCT (legacy_serie, legacy_folio)) "
        "AS uniq FROM legacy_tickets"))
    m["details_identity"] = dict(await conn.fetchrow(
        "SELECT count(*) AS rows, count(DISTINCT (doc_key, partida)) AS uniq "
        "FROM legacy_ticket_details"))

    # --- detalles ---
    m["details_total"] = await conn.fetchval(
        "SELECT count(*) FROM legacy_ticket_details")
    m["details_would_insert"] = m["details_total"]  # sin producto no se excluyen
    m["details_product_unmapped"] = await conn.fetchval(
        "SELECT count(*) FROM legacy_ticket_details "
        "WHERE mapping_status = 'PRODUCT_REVIEW_REQUIRED'")
    m["details_product_matched"] = m["details_total"] - m["details_product_unmapped"]
    m["details_monto_calculado"] = _r2(await conn.fetchval(
        "SELECT COALESCE(sum(legacy_importe_calculado),0) FROM legacy_ticket_details"))

    # --- CxC ---
    m["cxc_total"] = await conn.fetchval("SELECT count(*) FROM legacy_cxc_snapshot")
    m["cxc_by_status"] = {r["k"]: r["v"] for r in await conn.fetch(
        "SELECT status AS k, count(*) AS v FROM legacy_cxc_snapshot GROUP BY 1")}
    m["cxc_would_import"] = await conn.fetchval(
        "SELECT count(*) FROM legacy_cxc_snapshot "
        "WHERE status='READY' AND legacy_saldo > 0.01")
    m["cxc_would_import_saldo"] = _r2(await conn.fetchval(
        "SELECT COALESCE(sum(legacy_saldo),0) FROM legacy_cxc_snapshot "
        "WHERE status='READY' AND legacy_saldo > 0.01"))
    m["cxc_ready_zero"] = await conn.fetchval(
        "SELECT count(*) FROM legacy_cxc_snapshot "
        "WHERE status='READY' AND legacy_saldo <= 0.01")
    m["cxc_review_by_reason"] = {
        r["k"]: {"count": r["n"], "saldo": _r2(r["s"]), "diff": _r2(r["d"])}
        for r in await conn.fetch(
            "SELECT COALESCE(review_reason,'(sin razón)') AS k, count(*) AS n, "
            "COALESCE(sum(legacy_saldo),0) AS s, COALESCE(sum(difference),0) AS d "
            "FROM legacy_cxc_snapshot WHERE status='REVIEW_REQUIRED' GROUP BY 1")}
    m["cxc_review_total"] = sum(v["count"] for v in m["cxc_review_by_reason"].values())
    m["cxc_review_saldo"] = _r2(sum(v["saldo"] for v in m["cxc_review_by_reason"].values()))
    m["cxc_negative"] = {r["k"]: {"n": r["n"], "saldo": _r2(r["s"])}
                         for r in await conn.fetch(
        "SELECT count(*) AS n, COALESCE(sum(legacy_saldo),0) AS s, 'detalle' AS k "
        "FROM legacy_cxc_snapshot WHERE status='NEGATIVE'")}
    neg_rows = await conn.fetch(
        "SELECT legacy_serie, legacy_folio, legacy_cliente, legacy_saldo, "
        "review_reason FROM legacy_cxc_snapshot WHERE status='NEGATIVE'")
    m["cxc_negative_rows"] = [dict(r) for r in neg_rows]
    m["cxc_excluded"] = {r["k"]: {"n": r["n"], "saldo": _r2(r["s"])}
                         for r in await conn.fetch(
        "SELECT count(*) AS n, COALESCE(sum(legacy_saldo),0) AS s, "
        "'FACTURA_SERIE_F' AS k FROM legacy_cxc_snapshot WHERE status='EXCLUDED'")}

    # --- clientes ---
    m["customers_by_status"] = {r["k"]: r["v"] for r in await conn.fetch(
        "SELECT status AS k, count(*) AS v FROM legacy_customer_mapping GROUP BY 1")}
    m["customers_unmatched_keys"] = [r["legacy_customer_key"] for r in await conn.fetch(
        "SELECT legacy_customer_key FROM legacy_customer_mapping "
        "WHERE status='UNMATCHED' ORDER BY 1")]

    # --- productos ---
    m["products_by_status"] = {r["k"]: r["v"] for r in await conn.fetch(
        "SELECT mapping_status AS k, count(*) AS v FROM legacy_product_mapping GROUP BY 1")}

    # --- estado de cuenta virtual (top clientes con CxC READY) ---
    m["edocta_top"] = [dict(r) for r in await conn.fetch(
        "SELECT c.legacy_cliente, count(*) AS docs, "
        "COALESCE(sum(c.legacy_saldo),0) AS saldo_total "
        "FROM legacy_cxc_snapshot c WHERE c.status='READY' AND c.legacy_saldo > 0.01 "
        "GROUP BY 1 ORDER BY 2 DESC LIMIT 12")]
    m["edocta_cadenas"] = dict(await conn.fetchrow(
        "SELECT (SELECT count(*) FROM legacy_cxc_snapshot c WHERE c.status='READY' "
        " AND c.legacy_saldo > 0.01 AND EXISTS (SELECT 1 FROM legacy_tickets t "
        "   WHERE t.legacy_key = c.legacy_key)) AS cxc_con_ticket, "
        "(SELECT count(*) FROM legacy_tickets t WHERE EXISTS (SELECT 1 FROM "
        "   legacy_ticket_details d WHERE d.doc_key = t.legacy_key)) AS tickets_con_detalle"))
    m["clientes_afectados_edocta"] = await conn.fetchval(
        "SELECT count(DISTINCT legacy_cliente) FROM legacy_cxc_snapshot "
        "WHERE status='READY' AND legacy_saldo > 0.01")

    # --- producción: verificación de intacidad ---
    m["production"] = {
        "clients": await conn.fetchval("SELECT count(*) FROM clients"),
        "sales": await conn.fetchval("SELECT count(*) FROM sales"),
        "abonos": await conn.fetchval("SELECT count(*) FROM abonos"),
        "products": await conn.fetchval("SELECT count(*) FROM products"),
        "caja_movimientos": await conn.fetchval("SELECT count(*) FROM caja_movimientos"),
        "inventory_movements": await conn.fetchval(
            "SELECT count(*) FROM inventory_movements"),
    }
    return m


async def run(progress=print) -> dict:
    import asyncpg

    url = os.environ.get("DATABASE_URL", "").replace("+asyncpg", "")
    if not url:
        return {"status": "NO_DATABASE_URL"}
    started = datetime.now(timezone.utc)
    progress("pasada #1 de simulación ...")
    conn = await asyncpg.connect(url)
    try:
        m1 = await _collect(conn)
        progress("pasada #2 de simulación (idempotencia) ...")
        m2 = await _collect(conn)
        finished = datetime.now(timezone.utc)
        meta = {"generated_at": started.isoformat(),
                "duration_seconds": round((finished - started).total_seconds(), 1),
                "idempotente": json.dumps(m1, sort_keys=True, default=str) ==
                               json.dumps(m2, sort_keys=True, default=str)}
        recon = build_reconciliation(m1)
        progress("escribiendo reportes y CSVs ...")
        paths = await write_reports(conn, m1, recon, meta)
    finally:
        await conn.close()
    return {"status": "OK", "metrics": m1, "reconciliation": recon,
            "idempotente": meta["idempotente"], "outputs": paths, "meta": meta}


def build_reconciliation(m: dict) -> dict:
    return {
        "tickets": {
            "staged": m["tickets_total_staged"],
            "would_import": m["tickets_would_insert"],
            "skip_existing": m["tickets_would_skip_existing"],
            "ecuacion": m["tickets_total_staged"] ==
                        m["tickets_would_insert"] + m["tickets_would_skip_existing"],
        },
        "cxc": {
            "staged": m["cxc_total"],
            "would_import": m["cxc_would_import"],
            "ready_zero": m["cxc_ready_zero"],
            "review": m["cxc_review_total"],
            "negative": m["cxc_negative"]["detalle"]["n"],
            "excluded": m["cxc_excluded"]["FACTURA_SERIE_F"]["n"],
            "suma": m["cxc_would_import"] + m["cxc_ready_zero"] +
                    m["cxc_review_total"] + m["cxc_negative"]["detalle"]["n"] +
                    m["cxc_excluded"]["FACTURA_SERIE_F"]["n"],
            "ecuacion": m["cxc_total"] == (
                m["cxc_would_import"] + m["cxc_ready_zero"] +
                m["cxc_review_total"] + m["cxc_negative"]["detalle"]["n"] +
                m["cxc_excluded"]["FACTURA_SERIE_F"]["n"]),
        },
    }


# ------------------------------------------------------------------ reportes
def _cell(v):
    if isinstance(v, bool):
        return "SÍ" if v else "no"
    return v


async def write_reports(conn, m: dict, recon: dict, meta: dict) -> dict:
    outdir = config.resolve_reports_dir() / "dry_run"
    outdir.mkdir(parents=True, exist_ok=True)
    paths = {}

    summary = [
        ["SIMULACION", "VALOR"],
        ["tickets_total_staged", m["tickets_total_staged"]],
        ["tickets_would_insert", m["tickets_would_insert"]],
        ["tickets_would_skip_existing", m["tickets_would_skip_existing"]],
        ["tickets_cancelados", m["tickets_cancelled"]],
        ["tickets_cancelados_con_saldo", m["tickets_cancelled_con_saldo"]],
        ["tickets_total_monto", m["tickets_total_monto"]],
        ["details_total", m["details_total"]],
        ["details_would_insert", m["details_would_insert"]],
        ["details_product_unmapped", m["details_product_unmapped"]],
        ["details_monto_calculado", m["details_monto_calculado"]],
        ["cxc_total", m["cxc_total"]],
        ["cxc_would_import", m["cxc_would_import"]],
        ["cxc_would_import_saldo", m["cxc_would_import_saldo"]],
        ["cxc_ready_zero", m["cxc_ready_zero"]],
        ["cxc_review_total", m["cxc_review_total"]],
        ["cxc_review_saldo", m["cxc_review_saldo"]],
        ["cxc_negative_n", m["cxc_negative"]["detalle"]["n"]],
        ["cxc_negative_saldo", m["cxc_negative"]["detalle"]["saldo"]],
        ["cxc_excluded_n", m["cxc_excluded"]["FACTURA_SERIE_F"]["n"]],
        ["cxc_excluded_saldo", m["cxc_excluded"]["FACTURA_SERIE_F"]["saldo"]],
        ["clientes_afectados_edocta", m["clientes_afectados_edocta"]],
        ["idempotente", meta["idempotente"]],
        ["ecuacion_tickets", recon["tickets"]["ecuacion"]],
        ["ecuacion_cxc", recon["cxc"]["ecuacion"]],
        ["produccion_clients", m["production"]["clients"]],
        ["produccion_sales", m["production"]["sales"]],
        ["produccion_abonos", m["production"]["abonos"]],
        ["produccion_products", m["production"]["products"]],
    ]
    p = outdir / "dry_run_summary.csv"
    with p.open("w", newline="", encoding="utf-8-sig") as fh:
        csv.writer(fh).writerows(summary)
    paths["summary"] = str(p)

    # CSVs pesados y listados, con la conexión abierta
    heavy = {
        "tickets_would_import.csv":
            "SELECT legacy_key, legacy_serie, legacy_folio, legacy_cliente, "
            "legacy_fecha, legacy_total, legacy_condicion, legacy_vendedor, "
            "legacy_cancelado, legacy_saldo_original, customer_status "
            "FROM legacy_tickets ORDER BY legacy_folio",
        "ticket_details_would_import.csv":
            "SELECT legacy_key, doc_key, partida, legacy_codigo, "
            "legacy_cantidad, legacy_precio, legacy_importe_calculado, "
            "rysa_product_id, mapping_status FROM legacy_ticket_details "
            "ORDER BY doc_key, partida",
        "cxc_would_import.csv":
            "SELECT legacy_key, legacy_cliente, legacy_saldo, calculated_saldo, "
            "difference, movement_count, cancelado FROM legacy_cxc_snapshot "
            "WHERE status='READY' AND legacy_saldo > 0.01 ORDER BY legacy_saldo DESC",
        "review_queue.csv":
            "SELECT entity, legacy_key, reason FROM legacy_review_queue ORDER BY entity, reason",
        "excluded_documents.csv":
            "SELECT entity, legacy_key, serie, folio, reason FROM legacy_excluded_documents ORDER BY entity",
        "unmatched_customers.csv":
            "SELECT legacy_customer_key, legacy_nombre, status, match_type "
            "FROM legacy_customer_mapping WHERE status IN ('UNMATCHED','DELETED_LEGACY') ORDER BY 1",
        "unmatched_products.csv":
            "SELECT legacy_product_key, legacy_status FROM legacy_product_mapping "
            "WHERE mapping_status='PRODUCT_REVIEW_REQUIRED' ORDER BY 1",
        "negative_balances.csv":
            "SELECT legacy_serie, legacy_folio, legacy_cliente, legacy_saldo, "
            "review_reason FROM legacy_cxc_snapshot WHERE status='NEGATIVE' ORDER BY legacy_saldo",
        "cancelled_documents.csv":
            "SELECT legacy_key, legacy_cliente, legacy_fecha, legacy_total, "
            "legacy_saldo_original FROM legacy_tickets WHERE legacy_cancelado "
            "ORDER BY legacy_folio",
    }
    for name, sql in heavy.items():
        rows = await conn.fetch(sql)
        with (outdir / name).open("w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh)
            if rows:
                w.writerow([k for k in rows[0].keys()])
            for r in rows:
                w.writerow([_cell(v) for v in r.values()])
        paths[name] = str(outdir / name)

    md = build_markdown(m, recon, meta, paths)
    p = config.project_root() / "RYSA_LEGACY_DRY_RUN_REPORT.md"
    p.write_text(md, encoding="utf-8")
    paths["markdown"] = str(p)
    return paths


def build_markdown(m: dict, recon: dict, meta: dict, paths: dict) -> str:
    L: list[str] = []
    a = L.append
    a("# RYSA LEGACY DRY-RUN REPORT (FASE 4)\n")
    a(f"Generado: {meta['generated_at']} · Duración: {meta['duration_seconds']} s · "
      f"Idempotencia (2 pasadas idénticas): **{'OK' if meta['idempotente'] else '❌'}**\n")
    a("## 1. Tickets\n")
    a(f"- Total staged: {m['tickets_total_staged']:,}")
    a(f"- Would import: **{m['tickets_would_insert']:,}** · "
      f"skip (ya existen en sales): {m['tickets_would_skip_existing']:,}")
    a(f"- Cancelados: {m['tickets_cancelled']:,} "
      f"(con saldo {m['tickets_cancelled_con_saldo']:,} → ya en REVIEW; "
      f"sin saldo {m['tickets_cancelled_sin_saldo']:,})")
    a(f"- Monto total histórico: ${m['tickets_total_monto']:,}")
    a(f"- Identidad (SERIE,FOLIO): {m['tickets_identity']['rows']:,} filas / "
      f"{m['tickets_identity']['uniq']:,} únicas → "
      f"{'SIN duplicados' if m['tickets_identity']['rows']==m['tickets_identity']['uniq'] else '❌ duplicados'}")
    a(f"- Por mapping de cliente: `{m['tickets_by_customer_status']}`\n")
    a("## 2. Detalles\n")
    a(f"- Total: {m['details_total']:,} · would import: {m['details_would_insert']:,}")
    a(f"- Sin producto RYSA (PRODUCT_REVIEW_REQUIRED): **{m['details_product_unmapped']:,}** "
      f"· matched: {m['details_product_matched']:,}")
    a(f"- Monto calculado (CANTIDAD×PRECIO): ${m['details_monto_calculado']:,}")
    a(f"- Identidad (doc,partida): {m['details_identity']['rows']:,} / "
      f"{m['details_identity']['uniq']:,} únicas\n")
    a("## 3. CxC\n")
    a(f"- Total snapshot: {m['cxc_total']:,} · por estado: `{m['cxc_by_status']}`")
    a(f"- **Would import (READY, saldo>0): {m['cxc_would_import']:,} docs · "
      f"saldo total ${m['cxc_would_import_saldo']:,}**")
    a(f"- READY con saldo cero (sin deuda): {m['cxc_ready_zero']:,}")
    a(f"- REVIEW: {m['cxc_review_total']:,} docs · saldo ${m['cxc_review_saldo']:,}")
    a("- Desglose REVIEW:\n")
    a("| Razón | Docs | Saldo | Diferencia |")
    a("|---|---|---|---|")
    for k, v in m["cxc_review_by_reason"].items():
        a(f"| {k} | {v['count']:,} | {v['saldo']:,} | {v['diff']:,} |")
    a(f"\n- NEGATIVE: {m['cxc_negative']['detalle']['n']} docs · "
      f"${m['cxc_negative']['detalle']['saldo']:,} → NO entran a CxC")
    a(f"- EXCLUDED (serie F): {m['cxc_excluded']['FACTURA_SERIE_F']['n']} docs · "
      f"${m['cxc_excluded']['FACTURA_SERIE_F']['saldo']:,} → fuera del universo\n")
    a("## 4. Clientes y productos\n")
    a(f"- Clientes: `{m['customers_by_status']}`")
    a(f"- UNMATCHED ({len(m['customers_unmatched_keys'])}): "
      f"`{m['customers_unmatched_keys']}`")
    a(f"- Productos: `{m['products_by_status']}` → NO se crearán productos en "
      "este dry-run (regla 1); los detalles conservan su información legacy.\n")
    a("## 5. Estado de cuenta virtual (verificación de estructura)\n")
    a(f"- Clientes con CxC READY: {m['clientes_afectados_edocta']:,}")
    a(f"- Cadenas verificadas: {m['edocta_cadenas']['cxc_con_ticket']:,} docs CxC "
      "con ticket staged · "
      f"{m['edocta_cadenas']['tickets_con_detalle']:,} tickets con detalle "
      "(cliente→documento→ticket→detalle navegable)\n")
    a("| Cliente legacy | Docs pendientes | Saldo total |")
    a("|---|---|---|")
    for r in m["edocta_top"]:
        a(f"| {r['legacy_cliente']} | {r['docs']} | ${_r2(r['saldo_total']):,.2f} |")
    a("\n## 6. Aislamiento histórico (regla 11)\n")
    a("- Todos los tickets se importarían con `source='LEGACY'`, "
      "`is_historical=true` y `legacy_*` de trazabilidad.")
    a("- El importador NUNCA llamará a servicios de inventario/caja/FIFO; los "
      "saldos CxC se insertan como snapshot inicial documental, sin generar "
      "abonos ni movimientos actuales.")
    a("- Reportes actuales filtrarán por origen (por defecto solo RYSA).\n")
    a("## 7. Reconciliación STAGING vs DRY-RUN\n")
    a(f"- Tickets: {recon['tickets']['staged']:,} = would_import "
      f"{recon['tickets']['would_import']:,} + skip {recon['tickets']['skip_existing']:,} "
      f"→ {'OK' if recon['tickets']['ecuacion'] else '❌'}")
    c = recon["cxc"]
    a(f"- CxC: {c['staged']:,} = would_import {c['would_import']:,} + ready_zero "
      f"{c['ready_zero']:,} + review {c['review']:,} + negative {c['negative']:,} "
      f"+ excluded {c['excluded']:,} = {c['suma']:,} → "
      f"{'OK' if c['ecuacion'] else '❌'}\n")
    a("## 8. Producción verificada intacta\n")
    a(f"- clients={m['production']['clients']} · sales={m['production']['sales']} · "
      f"abonos={m['production']['abonos']} · products={m['production']['products']} · "
      f"caja_movimientos={m['production']['caja_movimientos']} · "
      f"inventory_movements={m['production']['inventory_movements']}\n")
    a("## 9. Estrategia transaccional del futuro import\n")
    a("```")
    a("BEGIN")
    a("  -- por chunk de N docs:")
    a("  INSERT sales (históricos, source=LEGACY, is_historical=true)")
    a("  INSERT detalles históricos (sin tocar inventario)")
    a("  INSERT cxc snapshot (saldo inicial documental; sin FIFO ni abonos)")
    a("  -- validación de integridad del chunk")
    a("COMMIT   -- o ROLLBACK ante cualquier error; nunca dejar parcial")
    a("```\n")
    a("## 10. Frontend futuro (solo diseño, sin implementar)\n")
    a("- Clientes → Estado de cuenta → Histórico Legacy → Ticket → Detalle")
    a("- Ventas: filtro Origen (RYSA | LEGACY | Todos); ticket LEGACY solo lectura")
    a("- CxC: saldo actual + documentos Legacy pendientes")
    a("- DevTools → Legacy Migration: Discovery · Analyze · Staging · Dry Run · "
      "Review Queue · Import (bloqueado hasta autorización) · Reports\n")
    a("## 11. Reportes\n")
    for k, v in paths.items():
        a(f"- `{v}`")
    a("\n## 12. Veredicto\n")
    ok = (recon["tickets"]["ecuacion"] and recon["cxc"]["ecuacion"]
          and meta["idempotente"]
          and m["production"]["sales"] == 0 and m["production"]["abonos"] == 0)
    a(f"**DRY-RUN {'VÁLIDO — LISTO PARA FASE 5 (diseño de importación + frontend)' if ok else 'CON PROBLEMAS'}** · "
      "Producción sin modificar. Import NO ejecutado.\n")
    return "\n".join(L)
