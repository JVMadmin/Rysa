"""Motor de detección de relaciones entre tablas legacy (solo evidencia).

Método (regla 2 — nada se asume):
  1. De cada tabla se toman campos candidatos a clave (por nombre).
  2. Los sets de valores reales se construyen UNA VEZ por (tabla, campo) con
     streaming de campo único (rápido) y se cachean para todos los pares.
  3. Para cada par semánticamente plausible se calcula: match_count,
     match %, distinct en origen/destino y cobertura real.
  4. Confianza: HIGH ≥ 99 % y cobertura ≥ 95 %; MEDIUM ≥ 90 %; LOW ≥ 70 %;
     debajo NO se reporta como relación (queda UNKNOWN).

Ejemplo de salida esperada:
  NOTAVTA.CLIENTE → CLIENTES.CLAVE  match 99.82 %  HIGH
"""
from __future__ import annotations

import re
from pathlib import Path

from . import config
from .dbf_reader import iter_field_values

_NAME_LINKS = [
    (re.compile(r"^(CLIENTE|CVE_CLIE|COD_CLIE|CLIENTE_ID)$", re.I), re.compile(r"^(CLAVE|CVE|CODIGO|CLAVECLI|CVE_CLI)$", re.I)),
    (re.compile(r"^(CODIGO|CVE|CLAVE)$", re.I), re.compile(r"^(CLAVE|CODIGO|CVE)$", re.I)),
    (re.compile(r"^(SERIE)$", re.I), re.compile(r"^(SERIE)$", re.I)),
    (re.compile(r"^(FOLIO)$", re.I), re.compile(r"^(FOLIO)$", re.I)),
    (re.compile(r"^(DOCTO|DOCUMENTO|NO_DOCTO)$", re.I), re.compile(r"^(FOLIO|DOCTO)$", re.I)),
    (re.compile(r"^(VENDEDOR|CVE_VEND)$", re.I), re.compile(r"^(CLAVE|CVE|NUM|NUMERO)$", re.I)),
    (re.compile(r"^(PROVEDOR|PROVEEDOR)$", re.I), re.compile(r"^(CLAVE|CVE|CODIGO)$", re.I)),
    (re.compile(r"^(CVE_PROD|COD_ART|ARTICULO|CVE_ART)$", re.I), re.compile(r"^(CLAVE|CODIGO|CVE)$", re.I)),
    (re.compile(r"^(CONCEPTO|CVE_CON)$", re.I), re.compile(r"^(CLAVE|CVE|CODIGO|CONCEPTO)$", re.I)),
    (re.compile(r"^(FORMAPAGO|FORMA_PAGO)$", re.I), re.compile(r"^(CLAVE|CVE|CODIGO|CLAVEPG)$", re.I)),
]

_DEST_ROLES = {"CLIENTS", "PRODUCTS", "SELLERS", "SUPPLIERS"}
_SRC_SKIP_ROLES = {"CLIENTS", "PRODUCTS", "SELLERS", "SUPPLIERS"}
_SRC_MIN_CONFIDENCE = 0.55


def _confidence(match_pct: float, cover_pct: float) -> str:
    if match_pct >= 99.0 and cover_pct >= 95.0:
        return "HIGH"
    if match_pct >= 90.0:
        return "MEDIUM"
    if match_pct >= 70.0:
        return "LOW"
    return "UNKNOWN"


def _candidate_fields(field_names: list[str]) -> list[str]:
    out = []
    for n in field_names:
        nu = n.upper()
        if re.match(r"^(CLAVE|CVE|CODIGO|COD|ID|FOLIO|SERIE|CLIENTE|DOCTO|DOCUMENTO|"
                    r"NO_DOCTO|TICKET|VENDEDOR|PROVEDOR|PROVEEDOR|CONCEPTO|FORMAPAGO|"
                    r"FORMA_PAGO|CVE_|COD_|ARTICULO|CUENTA|CTA)", nu) \
           or nu.endswith(("_ID", "FOLIO", "CLAVE", "CODIGO")):
            out.append(n)
    return out


def analyze_relationships(table_reports: list[dict], encoding: str = config.DEFAULT_ENCODING,
                          max_links_per_pair: int = 2,
                          progress=None) -> list[dict]:
    by_table = {r["table"]: r for r in table_reports}
    cache: dict[tuple[str, str], tuple[set, int, int]] = {}

    def build_set(table: str, field: str) -> tuple[set, int, int]:
        key = (table, field)
        if key in cache:
            return cache[key]
        rep = by_table[table]
        p = Path(rep["_path"])
        seen: set = set()
        total = nonempty = 0
        truncated = False
        for v in iter_field_values(p, field, encoding):
            total += 1
            if v is None or v == "":
                continue
            nonempty += 1
            if not truncated:
                seen.add(v)
                if len(seen) >= 1_000_000:
                    truncated = True
        out = (seen, total, nonempty)
        cache[key] = out
        return out

    dest_tables = {}
    for r in table_reports:
        if r["possible_role"] in _DEST_ROLES or r.get("role_confidence", 0) >= 0.6:
            dest_tables[r["table"]] = r

    results = []
    src_tables = [r for r in table_reports
                  if r["possible_role"] not in _SRC_SKIP_ROLES
                  and r.get("role_confidence", 0) >= _SRC_MIN_CONFIDENCE]
    pairs_planned = sum(
        1 for src in src_tables for sf in _candidate_fields(src["field_names"])
        for dst in dest_tables.values() if dst["table"] != src["table"]
        for df in _candidate_fields(dst["field_names"])
        if _plausible_pair(sf, df))
    done = 0

    for src in src_tables:
        src_fields = _candidate_fields(src["field_names"])
        for dst_name, dst in dest_tables.items():
            if dst_name == src["table"]:
                continue
            dst_fields = _candidate_fields(dst["field_names"])
            tried = 0
            for sf in src_fields:
                for df in dst_fields:
                    if not _plausible_pair(sf, df):
                        continue
                    done += 1
                    if progress:
                        progress(f"relación {src['table']}.{sf} → {dst_name}.{df} "
                                 f"({done}/{pairs_planned})")
                    if tried >= max_links_per_pair:
                        break
                    tried += 1
                    src_vals, src_total, src_ne = build_set(src["table"], sf)
                    if not src_vals:
                        continue
                    dst_vals, _dst_total, dst_ne = build_set(dst_name, df)
                    if not dst_vals:
                        continue
                    hits = sum(1 for v in src_vals if v in dst_vals)
                    match_pct = round(100.0 * hits / len(src_vals), 2)
                    cover_pct = round(100.0 * hits / max(1, src_total), 2)
                    conf = _confidence(match_pct, cover_pct)
                    if conf == "UNKNOWN":
                        continue
                    results.append({
                        "source": f"{src['table']}.{sf}",
                        "target": f"{dst_name}.{df}",
                        "src_distinct": len(src_vals),
                        "src_records": src_total,
                        "dst_distinct": len(dst_vals),
                        "dst_records": _dst_total,
                        "match_count": hits,
                        "match_percentage": match_pct,
                        "coverage_percentage": cover_pct,
                        "confidence": conf,
                        "note": ("muchos-a-uno plausible" if dst_ne > src_ne
                                 else "cardinalidad por revisar"),
                    })
    results.sort(key=lambda r: -r["match_percentage"])
    return results[:200]


def _plausible_pair(src_field: str, dst_field: str) -> bool:
    for src_rx, dst_rx in _NAME_LINKS:
        if src_rx.match(src_field) and dst_rx.match(dst_field):
            return True
    return False
