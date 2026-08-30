"""Orquestador del DISCOVERY (fase 1): inventario + análisis + relaciones.

Produce:
  legacy_discovery.json            (datos estructurados completos)
  legacy_tables.csv                (resumen por tabla)
  legacy_relationships.csv         (relaciones comprobadas con métricas)
  RYSA_LEGACY_DISCOVERY_REPORT.md  (reporte maestro legible)

Nada de esto toca la base de datos ni importa nada (regla 53).
"""
from __future__ import annotations

import json
import traceback
from datetime import datetime, timezone
from pathlib import Path

from . import config, cdx_reader, fpt_reader
from .dbf_reader import read_header
from .relationship_analyzer import analyze_relationships
from .schema_analyzer import analyze_table
from .reports import write_all_reports

DBF_EXTS = {".dbf", ".bdf"}
CDX_EXTS = {".cdx"}
FPT_EXTS = {".fpt"}
TMP_EXTS = {".tmp"}


def inventory_files(legacy_dir: Path) -> dict:
    files = sorted([p for p in legacy_dir.iterdir() if p.is_file()])
    inv = {"total": len(files), "dbf": [], "bdf": [], "cdx": [], "fpt": [],
           "tmp": [], "other": [], "unreadable": []}
    for p in files:
        ext = p.suffix.lower()
        entry = {"name": p.name, "size_bytes": p.stat().st_size}
        if ext == ".dbf":
            inv["dbf"].append(entry)
        elif ext == ".bdf":
            inv["bdf"].append(entry)
        elif ext in CDX_EXTS:
            inv["cdx"].append(entry)
        elif ext in FPT_EXTS:
            inv["fpt"].append(entry)
        elif ext in TMP_EXTS:
            inv["tmp"].append(entry)
        else:
            inv["other"].append(entry)
    return inv


def check_bdf_signature(path: Path) -> str:
    """Regla 4: un .BDF NO se asume DBF. Se detecta por firma binaria."""
    with path.open("rb") as fh:
        b = fh.read(32)
    if len(b) < 32:
        return " demasiado corto para identificar"
    v = b[0]
    if v in (0x02, 0x03, 0x04, 0x05, 0x30, 0x31, 0x32, 0x43, 0x7B, 0x83, 0x8B,
             0xCB, 0xF5, 0xFB) and b[4:8] != b"\x00\x00\x00\x00":
        return " firma compatible con DBF (versión 0x%02X): tratarlo como DBF" % v
    return f" firma no-DBF (primer byte 0x{v:02X}): formato desconocido"


def run_discovery(legacy_dir: Path | None = None,
                  progress=None) -> dict:
    def log(msg: str) -> None:
        if progress:
            progress(msg)

    legacy_dir = legacy_dir or config.resolve_legacy_data_path()
    if not legacy_dir.is_dir():
        return {
            "status": "NOT_FOUND",
            "expected_path": str(legacy_dir),
            "message": ("No se encontró la carpeta legacy_data. "
                        "Coloca ahí los archivos DBF/BDF/CDX/FPT del sistema "
                        "anterior y vuelve a ejecutar DISCOVERY."),
        }

    started = datetime.now(timezone.utc)
    log(f"inventario de {legacy_dir} ...")
    inv = inventory_files(legacy_dir)

    # --- BDF: detectar formato real ---
    for e in inv["bdf"]:
        e["signature_note"] = check_bdf_signature(legacy_dir / e["name"])

    # --- DBF: validar header + análisis completo ---
    dbf_reports: list[dict] = []
    dbf_by_base: dict[str, Path] = {}
    total_dbf = len(inv["dbf"])
    for idx, e in enumerate(inv["dbf"], 1):
        p = legacy_dir / e["name"]
        log(f"tabla {idx}/{total_dbf}: {e['name']} ...")
        try:
            rep = analyze_table(p, config.DEFAULT_ENCODING)
            rep["_path"] = str(p)
            dbf_reports.append(rep)
            dbf_by_base[p.stem.lower()] = p
        except Exception as exc:  # tabla ilegible: reportar y continuar
            inv["unreadable"].append({"name": e["name"], "error": str(exc),
                                      "trace": traceback.format_exc(limit=2)})

    # --- CDX: asociar por nombre base y analizar ---
    cdx_reports = []
    for e in inv["cdx"]:
        p = legacy_dir / e["name"]
        rep = {"file": e["name"], "size_bytes": e["size_bytes"]}
        base = p.stem.lower()
        rep["linked_table"] = base.upper() if base in dbf_by_base else None
        try:
            c = cdx_reader.read_cdx(p)
            rep.update({
                "parsed": c.parsed, "page_size": c.page_size,
                "root_page": c.root_page,
                "tags": [t.__dict__ for t in c.tags],
                "warnings": c.warnings,
            })
        except Exception as exc:
            rep.update({"parsed": False, "error": str(exc)})
        cdx_reports.append(rep)

    # --- FPT: asociar por nombre base ---
    fpt_reports = []
    memo_links: dict[str, list[str]] = {}
    for e in inv["fpt"]:
        p = legacy_dir / e["name"]
        rep = {"file": e["name"], "size_bytes": e["size_bytes"]}
        base = p.stem.lower()
        rep["linked_table"] = base.upper() if base in dbf_by_base else None
        try:
            f = fpt_reader.read_fpt(p)
            rep.update({
                "parsed": f.parsed, "block_size": f.block_size,
                "next_free_block": f.next_free_block,
                "blocks_total_estimated": f.blocks_total_estimated,
                "sample_text": f.sample_text[:200],
                "warnings": f.warnings,
            })
            if f.parsed and rep["linked_table"]:
                memo_links.setdefault(rep["linked_table"], []).append(e["name"])
        except Exception as exc:
            rep.update({"parsed": False, "error": str(exc)})
        fpt_reports.append(rep)

    # memo links a reportes de tabla
    for rep in dbf_reports:
        rep["memo_files"] = memo_links.get(rep["table"], [])
        rep["cdx_files"] = [
            c["file"] for c in cdx_reports
            if c.get("linked_table") == rep["table"]]

    # --- Relaciones (evidencia real, streaming con caché) ---
    log("análisis de relaciones (streaming) ...")
    relationships = []
    try:
        relationships = analyze_relationships(
            dbf_reports, config.DEFAULT_ENCODING, progress=log)
    except Exception as exc:
        relationships = [{"error": f"análisis de relaciones falló: {exc}"}]
    log("escribiendo reportes ...")

    total_records = sum(r["records_scanned"] for r in dbf_reports)
    date_min = min([r["date_min"] for r in dbf_reports if r["date_min"]], default=None)
    date_max = max([r["date_max"] for r in dbf_reports if r["date_max"]], default=None)

    result = {
        "status": "OK",
        "generated_at": started.isoformat(),
        "project_root": str(config.project_root()),
        "legacy_path": str(legacy_dir),
        "files": {k: v for k, v in inv.items()},
        "counts": {
            "total_files": inv["total"],
            "dbf": len(inv["dbf"]), "bdf": len(inv["bdf"]),
            "cdx": len(inv["cdx"]), "fpt": len(inv["fpt"]),
            "tmp": len(inv["tmp"]), "other": len(inv["other"]),
            "unreadable": len(inv["unreadable"]),
        },
        "totals": {
            "tables_analyzed": len(dbf_reports),
            "records_scanned": total_records,
            "date_min": date_min,
            "date_max": date_max,
        },
        "tables": dbf_reports,
        "cdx": cdx_reports,
        "fpt": fpt_reports,
        "relationships": relationships,
        "bdf_signature_check": inv["bdf"],
    }
    finished = datetime.now(timezone.utc)
    result["duration_seconds"] = round((finished - started).total_seconds(), 1)

    # Persistir reportes
    out = write_all_reports(result, config.resolve_reports_dir())
    result["report_files"] = out
    return result
