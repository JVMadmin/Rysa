"""Análisis estructural y semántico de cada tabla DBF (solo evidencia real).

Clasificación de roles: se puntúan firmas de campos detectadas EN LOS DATOS
(nombres de campos reales + estadísticas), nunca solo el nombre del archivo.
La confianza es proporcional a la evidencia; todo resultado es
"possible_role" y UNKNOWN cuando no hay evidencia suficiente (regla 2).
"""
from __future__ import annotations

import re
from collections import Counter
from pathlib import Path
from typing import Optional

from . import config
from .dbf_reader import DbfFile, iter_records, read_header

# ---------------------------------------------------------------- patrones
P_DATE_NAME = re.compile(r"FECHA|DATE|F_ALTA|FEC", re.IGNORECASE)
P_CLIENTE = re.compile(r"^(CLIENTE|CLIENTE_ID|CLICliente|CVE_CLIE|COD_CLIE|CLAVE)", re.IGNORECASE)
P_FOLIO = re.compile(r"FOLIO|DOCTO|DOCUMENTO|TICKET", re.IGNORECASE)
P_SERIE = re.compile(r"SERIE|LETRA", re.IGNORECASE)
P_MONTO = re.compile(r"TOTAL|MONTO|IMPORTE|CARGO|ABONO|SALDO|SUBTOTAL|IVA", re.IGNORECASE)
P_CANTIDAD = re.compile(r"CANTIDAD|CANT|UNIDADES|PIEZAS", re.IGNORECASE)
P_PRECIO = re.compile(r"PRECIO|COSTO|P_UNIT|PU$", re.IGNORECASE)
P_CODIGO = re.compile(r"CODIGO|CLAVE|CVE|ARTICULO|SKU", re.IGNORECASE)
P_MOVTO = re.compile(r"MOVTO|TIPO|CLASE|CONCEPTO|OPERACION", re.IGNORECASE)
P_NOMBRE = re.compile(r"NOMBRE|RAZON|DESCRIPCION|DESC$", re.IGNORECASE)
P_ENTSAL = re.compile(r"ENTRADA|SALIDA|ENT|SAL", re.IGNORECASE)

FIELD_SCORES = [
    ("cliente", P_CLIENTE, 2), ("folio", P_FOLIO, 2), ("serie", P_SERIE, 1),
    ("monto", P_MONTO, 1), ("cantidad", P_CANTIDAD, 1), ("precio", P_PRECIO, 1),
    ("codigo", P_CODIGO, 1), ("movto", P_MOVTO, 2), ("nombre", P_NOMBRE, 1),
    ("fecha_name", P_DATE_NAME, 1),
]


def _match_any(names: list[str], rx: re.Pattern) -> bool:
    return any(rx.search(n) for n in names)


def _match_count(names: list[str], rx: re.Pattern) -> int:
    return sum(1 for n in names if rx.search(n))


def classify_role(table_name: str, field_names: list[str], has_date: bool,
                  stats: dict) -> tuple[str, float, list[str]]:
    """Devuelve (possible_role, confidence 0..1, evidencias[])."""
    tl = table_name.upper()
    evidence: list[str] = []
    scores: dict[str, float] = {}

    def add(role: str, pts: float, why: str) -> None:
        scores[role] = scores.get(role, 0.0) + pts
        evidence.append(f"{role}: {why}")

    name_hits = [n for n in field_names]
    is_cliente_table = bool(re.search(r"CLIENTE|CLI", tl))
    is_producto_table = bool(re.search(r"ARTICUL|PRODUCT|ARTI", tl))
    is_venta = bool(re.search(r"NOTAVTA|NOTA|VENTA|FACTURA|TICKET|REMIS", tl))
    is_partidas = bool(re.search(r"PAR$|PART|DETALLE|PARTS", tl))
    is_cxc = bool(re.search(r"CXC|CUENXCOB|COBRANZ|COBRO", tl))
    is_kardex = bool(re.search(r"KARDEX|MOVINV|MINV|INVENT", tl))
    is_vendedor = bool(re.search(r"VEND|EMPLE", tl))
    is_proveedor = bool(re.search(r"PROVE|PROV", tl))
    is_caja = bool(re.search(r"CAJA|PAGO", tl))

    has_cliente = _match_any(name_hits, P_CLIENTE)
    has_folio = _match_any(name_hits, P_FOLIO)
    has_monto = _match_any(name_hits, P_MONTO)
    has_cant = _match_any(name_hits, P_CANTIDAD)
    has_precio = _match_any(name_hits, P_PRECIO)
    has_codigo = _match_any(name_hits, P_CODIGO)
    has_movto = _match_any(name_hits, P_MOVTO)
    has_nombre = _match_any(name_hits, P_NOMBRE)
    has_entsal = _match_any(name_hits, P_ENTSAL)

    if is_cliente_table and has_nombre:
        add("CLIENTS", 4, f"nombre de tabla {tl} + campo nombre/{_match_count(name_hits, P_NOMBRE)} campos de nombre")
    if is_producto_table and has_codigo:
        add("PRODUCTS", 4, f"nombre {tl} + código/clave")
    if is_vendedor:
        add("SELLERS", 4, f"nombre de tabla {tl}")
    if is_proveedor:
        add("SUPPLIERS", 4, f"nombre de tabla {tl}")

    if is_venta and has_folio and has_cliente and has_monto:
        add("SALES_HEADER", 5, f"{tl}: folio+cliente+montos y {sum(1 for _ in name_hits)} campos")
    if is_partidas and has_cant and (has_precio or has_monto):
        add("SALES_DETAIL", 4, f"{tl}: cantidad + precio/importe")
    if is_cxc and has_cliente and (has_monto or has_movto):
        add("CXC_MOVEMENTS", 4, f"{tl}: cliente + monto/tipo de movimiento")
    if is_caja and has_monto:
        add("PAYMENTS", 3, f"{tl}: monto en contexto de caja/pagos")
    if is_kardex and has_codigo and (has_cant or has_entsal):
        add("INVENTORY", 4, f"{tl}: código + cantidades entradas/salidas")

    # Refuerzos genéricos
    if has_cliente and has_folio and has_monto and has_date:
        add("SALES_HEADER", 2, "firma genérica: cliente+folio+monto+fecha")
    if has_movto and has_monto and has_cliente:
        add("CXC_MOVEMENTS", 2, "firma genérica: cliente+movto+monto")
    if has_date:
        evidence.append("contiene campo(s) de fecha real(es) tipo D")

    if not scores:
        return "UNKNOWN", 0.0, evidence or ["sin firmas reconocibles"]
    role, pts = max(scores.items(), key=lambda kv: kv[1])
    total = sum(scores.values())
    confidence = round(min(0.95, 0.35 + 0.65 * (pts / total) * min(1.0, total / 6.0)), 2)
    return role, confidence, evidence[:8]


def _scan_dates_deleted(path: Path, hdr) -> tuple[int, int, Optional[str], Optional[str]]:
    """Escaneo crudo rápido de TODO el archivo: conteo físico real, borrados
    y rango global de fechas. Solo decodifica los campos tipo D (barato)."""
    total = deleted = 0
    dmin = dmax = None
    date_offsets = [(f.offset, f.length) for f in hdr.fields if f.ftype == "D"]
    rsize = hdr.record_size
    with path.open("rb") as fh:
        fh.seek(hdr.header_size)
        while True:
            raw = fh.read(rsize)
            if len(raw) < rsize:
                break
            total += 1
            if raw[0:1] == b"*":
                deleted += 1
                continue
            for off, ln in date_offsets:
                s = raw[1 + off: 1 + off + ln].decode("ascii", errors="replace").strip()
                if len(s) == 8 and s.isdigit():
                    iso = f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
                    if dmin is None or iso < dmin:
                        dmin = iso
                    if dmax is None or iso > dmax:
                        dmax = iso
    return total, deleted, dmin, dmax


def analyze_table(dbf_path: Path, encoding: str = config.DEFAULT_ENCODING,
                  full_scan: Optional[bool] = None) -> dict:
    """Análisis completo de una tabla: estructura + estadísticas de datos.

    full_scan=None → decide por tamaño (config.LARGE_TABLE_BYTES). En tablas
    grandes, las estadísticas costosas (distinct) se toman sobre una muestra
    streaming; el conteo físico y rangos de fecha SIEMPRE son sobre todo el
    archivo.
    """
    hdr = read_header(dbf_path, encoding)
    fields = hdr.fields
    fstats = {f.name: {"empty": 0, "non_empty": 0, "distinct": set(),
                       "truncated": False,
                       "num_min": None, "num_max": None, "num_sum": 0.0}
              for f in fields}
    date_fields = [f.name for f in fields if f.ftype == "D"]
    movto_fields = [f.name for f in fields if P_MOVTO.search(f.name)]
    move_stats = Counter()

    big = dbf_path.stat().st_size >= config.LARGE_TABLE_BYTES
    do_full = (not big) if full_scan is None else full_scan
    sample_rows = None if do_full else config.SAMPLE_RECORDS_LARGE_TABLE

    stats_rows = 0  # registros cubiertos por el pase de estadísticas (posible muestra)
    for row in iter_records(dbf_path, encoding, limit=sample_rows):
        stats_rows += 1
        if row["_deleted"]:
            continue
        for f in fields:
            v = row.get(f.name)
            st = fstats[f.name]
            if v is None or v == "":
                st["empty"] += 1
                continue
            st["non_empty"] += 1
            if isinstance(v, (int, float)):
                if st["num_min"] is None or v < st["num_min"]:
                    st["num_min"] = v
                if st["num_max"] is None or v > st["num_max"]:
                    st["num_max"] = v
                st["num_sum"] += v
            if len(st["distinct"]) < config.MAX_DISTINCT_VALUES:
                # solo interesa unicidad si el campo puede ser clave
                if f.ftype in ("C", "N", "I") and _is_key_candidate_name(f.name):
                    st["distinct"].add(v)
                elif f.ftype in ("C", "N", "I") and _looks_selective(f.name):
                    st["distinct"].add(v)
            elif not st["truncated"]:
                st["truncated"] = True
        for mname in movto_fields[:2]:
            v = row.get(mname)
            if v not in (None, ""):
                move_stats[str(v)[:20]] += 1

    role, confidence, evidence = classify_role(
        dbf_path.stem, [f.name for f in fields], bool(date_fields), {})

    # Conteo físico real + rango de fechas SIEMPRE sobre el archivo completo
    # (evidencia sin muestreo); el muestreo solo aplica a stats por campo.
    scanned, deleted, date_min, date_max = _scan_dates_deleted(dbf_path, hdr)
    field_report = []
    for f in fields:
        st = fstats[f.name]
        filled = st["non_empty"]
        uniq = len(st["distinct"])
        report = {
            "name": f.name, "type": f.ftype, "length": f.length,
            "decimals": f.decimals,
            "empty_pct": round(100.0 * st["empty"] / stats_rows, 2) if stats_rows else 0.0,
        }
        if _is_key_candidate_name(f.name) or _looks_selective(f.name):
            report["distinct_scanned"] = uniq
            report["distinct_truncated"] = st["truncated"]
            if filled > 0 and not st["truncated"]:
                report["unique_100pct"] = (uniq == filled and filled > 0)
        if st["num_min"] is not None and f.decimals >= 0 and f.ftype in ("N", "F", "I", "B", "Y"):
            report["num_min"] = st["num_min"]
            report["num_max"] = st["num_max"]
            if not big:
                report["num_sum"] = round(st["num_sum"], 2)
        field_report.append(report)

    return {
        "file": dbf_path.name,
        "table": dbf_path.stem.upper(),
        "size_bytes": dbf_path.stat().st_size,
        "version": hdr.version_label,
        "last_update": hdr.last_update,
        "encoding": hdr.encoding,
        "code_page": hdr.code_page_byte,
        "records_declared": hdr.record_count_declared,
        "records_scanned": scanned,
        "records_deleted": deleted,
        "header_size": hdr.header_size,
        "record_size": hdr.record_size,
        "memo": hdr.has_memo_fields,
        "fields": field_report,
        "field_names": [f.name for f in fields],
        "date_min": date_min,
        "date_max": date_max,
        "date_fields": date_fields,
        "movto_values": dict(move_stats.most_common(50)),
        "possible_role": role,
        "role_confidence": confidence,
        "role_evidence": evidence,
        "warnings": hdr.warnings,
        "scanned_mode": "full" if do_full else f"sample({sample_rows})",
    }


def _is_key_candidate_name(name: str) -> bool:
    n = name.upper()
    return bool(re.match(r"^(CLAVE|CVE|CODIGO|COD|ID|FOLIO|NUM|NO_|N_|CTA|CUENTA)$", n)
                or re.match(r"^(CLAVE|CODIGO|FOLIO|CVE)_", n)
                or n.endswith(("_ID", "ID", "FOLIO", "CLAVE", "CODIGO"))
                or n in ("CLAVE", "FOLIO", "CODIGO", "ID"))


def _looks_selective(name: str) -> bool:
    n = name.upper()
    return bool(re.match(r"^(SERIE|RFC|MOVTO|TIPO|STATUS|ESTADO|CONDICION)$", n))
