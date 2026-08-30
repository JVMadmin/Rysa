"""Escritura de reportes del Discovery: JSON + CSV + Markdown."""
from __future__ import annotations

import csv
import json
from pathlib import Path

from .config import DEFAULT_ENCODING

# Extensiones de salida elegidas para consunción directa (regla 10/58).


def write_all_reports(result: dict, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {}

    p_json = out_dir / "legacy_discovery.json"
    p_json.write_text(json.dumps(result, ensure_ascii=False, indent=2,
                                 default=_json_default), encoding="utf-8")
    paths["json"] = str(p_json)

    p_tables = out_dir / "legacy_tables.csv"
    with p_tables.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["TABLE", "RECORDS", "DELETED", "FIELDS", "DATE_MIN",
                    "DATE_MAX", "MEMO", "CDX", "SIZE_KB", "POSSIBLE_ROLE",
                    "CONFIDENCE", "EVIDENCE"])
        for t in result["tables"]:
            w.writerow([
                t["table"], t["records_scanned"], t["records_deleted"],
                len(t["fields"]), t["date_min"] or "", t["date_max"] or "",
                "SÍ" if t["memo"] else "no", ";".join(t["cdx_files"]),
                round(t["size_bytes"] / 1024), t["possible_role"],
                t["role_confidence"], " | ".join(t["role_evidence"][:3])])
    paths["tables_csv"] = str(p_tables)

    p_rel = out_dir / "legacy_relationships.csv"
    with p_rel.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["SOURCE", "TARGET", "MATCH_COUNT", "MATCH_PCT",
                    "COVERAGE_PCT", "SRC_DISTINCT", "DST_DISTINCT",
                    "CONFIDENCE", "NOTE"])
        for r in result.get("relationships", []):
            if "error" in r:
                continue
            w.writerow([r["source"], r["target"], r["match_count"],
                        r["match_percentage"], r["coverage_percentage"],
                        r["src_distinct"], r["dst_distinct"], r["confidence"],
                        r["note"]])
    paths["relationships_csv"] = str(p_rel)

    p_md = Path(result["project_root"]) / "RYSA_LEGACY_DISCOVERY_REPORT.md"
    p_md.write_text(build_markdown(result), encoding="utf-8")
    paths["markdown"] = str(p_md)
    return paths


def _json_default(o):
    if isinstance(o, (set, frozenset)):
        return list(o)[:50]
    return str(o)


def build_markdown(result: dict) -> str:
    if result.get("status") == "NOT_FOUND":
        return (f"# RYSA LEGACY DISCOVERY REPORT\n\n"
                f"**LEGACY DATA NO ENCONTRADO**\n\nRuta esperada:\n\n"
                f"```\n{result['expected_path']}\n```\n\n"
                "Coloca ahí los archivos originales (DBF/BDF, CDX, FPT) y "
                "vuelve a ejecutar DISCOVERY.\n")

    c = result["counts"]
    t = result["totals"]
    lines = [
        "# RYSA LEGACY DISCOVERY REPORT",
        "",
        f"Generado: {result['generated_at']} · Duración: "
        f"{result['duration_seconds']} s · Codificación asumida: "
        f"{DEFAULT_ENCODING} (configurable vía LEGACY_DBF_ENCODING)",
        "",
        "## 1. Inventario",
        "",
        f"| Item | Cantidad |",
        f"|---|---|",
        f"| Archivos totales | {c['total_files']} |",
        f"| DBF | {c['dbf']} |",
        f"| BDF | {c['bdf']} |",
        f"| CDX | {c['cdx']} |",
        f"| FPT | {c['fpt']} |",
        f"| TMP | {c['tmp']} |",
        f"| Otros | {c['other']} |",
        f"| Ilegibles | {c['unreadable']} |",
        f"| Tablas analizadas | {t['tables_analyzed']} |",
        f"| Registros escaneados | {t['records_scanned']:,} |",
        f"| Rango de fechas real | {t['date_min']} → {t['date_max']} |",
        "",
        f"Fuente: `{result['legacy_path']}` (SOLO LECTURA, sin modificar).",
        "",
        "## 2. Tablas (resumen ordenado por registros)",
        "",
        "| TABLA | REGISTROS | CAMPOS | FECHA_MIN | FECHA_MAX | MEMO | CDX | ROL POSIBLE | CONFIANZA |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for tb in sorted(result["tables"], key=lambda x: -x["records_scanned"]):
        lines.append(
            f"| {tb['table']} | {tb['records_scanned']:,} | {len(tb['fields'])} "
            f"| {tb['date_min'] or '—'} | {tb['date_max'] or '—'} "
            f"| {'SÍ' if tb['memo'] else ''} | {len(tb['cdx_files'])} "
            f"| {tb['possible_role']} | {tb['role_confidence']} |")
    lines += ["", "## 3. Roles posibles — evidencia", ""]
    for tb in sorted(result["tables"], key=lambda x: (-x["role_confidence"], x["table"])):
        if tb["possible_role"] == "UNKNOWN":
            continue
        lines.append(f"- **{tb['table']}** → {tb['possible_role']} "
                     f"({tb['role_confidence']:.2f}): " +
                     "; ".join(tb["role_evidence"][:3]))
    lines += ["", "## 4. Relaciones comprobadas", ""]
    rels = result.get("relationships", [])
    if rels and "error" not in rels[0]:
        lines += ["| ORIGEN | DESTINO | MATCH | COBERTURA | CONFIANZA | NOTA |",
                  "|---|---|---|---|---|---|"]
        for r in rels[:40]:
            lines.append(
                f"| {r['source']} | {r['target']} | {r['match_percentage']}% "
                f"| {r['coverage_percentage']}% | {r['confidence']} | {r['note']} |")
    else:
        lines.append("_Sin relaciones comprobadas (o análisis no disponible)._")
    if result.get("bdf_signature_check"):
        lines += ["", "## 5. Verificación de archivos .BDF", ""]
        for b in result["bdf_signature_check"]:
            lines.append(f"- `{b['name']}`:{b.get('signature_note', '')}")
    if result["files"]["unreadable"]:
        lines += ["", "## 6. Archivos ilegibles", ""]
        for u in result["files"]["unreadable"]:
            lines.append(f"- `{u['name']}`: {u['error']}")
    lines += ["", "## 7. Aviso de alcance", "",
              "Este reporte es SOLO DISCOVERY: no se importó nada, no se "
              "modificó la base de RYSA y los archivos originales permanecen "
              "intactos. Los roles son **posibles**, respaldados por evidencia "
              "de campos y datos; ninguna relación es definitiva hasta su "
              "validación cruzada completa.", ""]
    return "\n".join(lines)
