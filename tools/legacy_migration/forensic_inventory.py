"""Inventario forense completo: tabla, registros, campos (solo lectura)."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
disc = json.loads((ROOT / "legacy_reports" / "legacy_discovery.json").read_text(encoding="utf-8"))

tables = disc.get("tables") or disc.get("tablas") or []
if isinstance(tables, dict):
    tables = list(tables.values())

print(f"total_tablas={len(tables)}")
for t in tables:
    name = t.get("name") or t.get("archivo") or t.get("file")
    recs = t.get("records") or t.get("registros") or t.get("record_count") or "?"
    fields = t.get("fields") or t.get("campos") or []
    if isinstance(fields, list) and fields and isinstance(fields[0], dict):
        fnames = ",".join(f.get("name", "?") for f in fields)
    else:
        fnames = ",".join(str(f) for f in fields)
    print(f"{name}|{recs}|{fnames}")
