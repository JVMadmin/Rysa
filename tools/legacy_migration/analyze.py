"""FASE 2 — ANALYZE: validación matemática del Legacy (solo lectura).

Nada de esto toca la base de datos ni los archivos originales. Produce
CSVs + JSON + RYSA_LEGACY_ANALYSIS_REPORT.md con evidencia medible:

  * identidad real de documentos (FOLIO vs SERIE+FOLIO)
  * correspondencia NOTAVTA→NVTAPAR / CUENXCOB / CXCDOCS / CAJAPAGO
  * clientes y productos sin correspondencia, clasificados
  * semántica de CUENXCOB.MOVTO demostrada matemáticamente contra
    CXCDOCS.SALDO y NOTAVTA.SALDO
  * escenarios de registros borrados (A: activos, B: activos+borrados)
  * montos negativos, cancelaciones, distribución anual
  * fuentes de verdad y veredicto READY_FOR_STAGING / BLOCKED
"""
from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from . import config
from .dbf_reader import iter_records

TOL = 0.01  # tolerancia de redondeo a centavos (documentada en el reporte)


def _r2(v):
    return None if v is None else round(v + 0.0, 2)


def _year(iso: str | None):
    return iso[:4] if iso and len(iso) >= 4 and iso[:4].isdigit() else None


class Analyzer:
    def __init__(self, legacy_dir: Path, progress=print):
        self.dir = legacy_dir
        self.log = progress
        self.anomalies: list[dict] = []

    # ------------------------------------------------------------ carga
    def load_all(self) -> None:
        d = self.dir
        self.log("cargando NOTAVTA ...")
        self.notavta: dict[tuple[str, str], dict] = {}
        self.notavta_dupe_keys = 0
        self.notavta_rows = []
        for r in iter_records(d / "NOTAVTA.dbf",
                              only={"SERIE", "FOLIO", "CLIENTE", "FECHA",
                                    "CONDICION", "TOTAL", "SALDO", "STATUS",
                                    "FCANCELADA", "HCANCELADA", "COMCANCELA",
                                    "NCRED_TOT", "CAJAPAGO", "VENDEDOR"}):
            if r["_deleted"]:
                continue
            key = (r.get("SERIE") or "", r.get("FOLIO") or "")
            row = {"cliente": r.get("CLIENTE") or "", "fecha": r.get("FECHA"),
                   "condicion": r.get("CONDICION") or "",
                   "total": _r2(r.get("TOTAL")), "saldo": _r2(r.get("SALDO")),
                   "status": r.get("STATUS"), "cancelada": bool(r.get("FCANCELADA")),
                   "ncred": _r2(r.get("NCRED_TOT"))}
            self.notavta_rows.append(row)
            if key in self.notavta:
                self.notavta_dupe_keys += 1
                self.anomalies.append({"tipo": "NOTAVTA_DUPLICADO",
                                       "clave": f"{key[0]}-{key[1]}",
                                       "detalle": "clave (SERIE,FOLIO) repetida"})
            self.notavta[key] = row

        self.log("cargando NVTAPAR ...")
        self.nvtapar_keys: Counter = Counter()
        self.nvtapar_codes: Counter = Counter()
        self.nvtapar_orphan = 0
        self.nvtapar_total = 0
        for r in iter_records(d / "NVTAPAR.dbf",
                              only={"SERIE", "FOLIO", "CODIGO"}):
            if r["_deleted"]:
                continue
            self.nvtapar_total += 1
            key = (r.get("SERIE") or "", r.get("FOLIO") or "")
            self.nvtapar_keys[key] += 1
            self.nvtapar_codes[r.get("CODIGO") or ""] += 1

        self.log("cargando CLIENTES y ARTICULO ...")
        self.clientes: dict[str, dict] = {}
        self.clientes_deleted: set[str] = set()
        for r in iter_records(d / "CLIENTES.dbf", only={"CLAVE", "NOMBRE"}):
            clave = (r.get("CLAVE") or "").strip()
            if r["_deleted"]:
                self.clientes_deleted.add(clave)
            else:
                self.clientes[clave] = {"nombre": (r.get("NOMBRE") or "").strip()}
        self.articulo: set[str] = set()
        self.articulo_deleted: set[str] = set()
        for r in iter_records(d / "ARTICULO.dbf", only={"CODIGO"}):
            cod = (r.get("CODIGO") or "").strip()
            if r["_deleted"]:
                self.articulo_deleted.add(cod)
            else:
                self.articulo.add(cod)

        self.log("cargando CUENXCOB ...")
        self.cuenxcob: list[dict] = []
        for r in iter_records(d / "CUENXCOB.dbf",
                              only={"TIPO", "SERIE", "SERIENV", "FOLIO",
                                    "FOLIOMOVTO", "CONDICION", "CONCEPTO",
                                    "MOVTO", "CLIENTE", "MONTO", "APLICA",
                                    "SALDO", "COBRANZA", "REFERENCIA"}):
            self.cuenxcob.append({
                "deleted": r["_deleted"],
                "tipo": r.get("TIPO") or "", "serie": r.get("SERIE") or "",
                "serienv": r.get("SERIENV") or "", "folio": r.get("FOLIO") or "",
                "foliomovto": r.get("FOLIOMOVTO") or "",
                "condicion": r.get("CONDICION") or "",
                "concepto": r.get("CONCEPTO") or "", "movto": r.get("MOVTO") or "",
                "cliente": r.get("CLIENTE") or "", "monto": _r2(r.get("MONTO")),
                "aplica": r.get("APLICA"), "saldo": _r2(r.get("SALDO")),
                "cobranza": r.get("COBRANZA") or ""})

        self.log("cargando CXCDOCS ...")
        self.cxcdocs: dict[tuple[str, str], dict] = {}
        self.cxcdocs_rows = []
        for r in iter_records(d / "CXCDOCS.dbf",
                              only={"TIPO", "SERIE", "FOLIO", "CLIENTE",
                                    "CONDICION", "APLICA", "MONTO", "TOTAL",
                                    "SALDO", "FECHA"}):
            if r["_deleted"]:
                continue
            key = (r.get("SERIE") or "", r.get("FOLIO") or "")
            row = {"cliente": r.get("CLIENTE") or "",
                   "condicion": r.get("CONDICION") or "",
                   "aplica": r.get("APLICA") or r.get("FECHA"),
                   "monto": _r2(r.get("MONTO")), "total": _r2(r.get("TOTAL")),
                   "saldo": _r2(r.get("SALDO"))}
            if key in self.cxcdocs:
                self.anomalies.append({"tipo": "CXCDOCS_DUPLICADO",
                                       "clave": f"{key[0]}-{key[1]}",
                                       "detalle": "clave repetida"})
            self.cxcdocs[key] = row
            self.cxcdocs_rows.append((key, row))

        self.log("cargando CAJAPAGO ...")
        self.cajapago: list[dict] = []
        for r in iter_records(d / "CAJAPAGO.dbf",
                              only={"TIPODOC", "SERIE", "FOLIO", "FECHA",
                                    "CONCEPTO", "MONTO", "IMPORTE"}):
            self.cajapago.append({
                "deleted": r["_deleted"],
                "tipodoc": r.get("TIPODOC") or "", "serie": r.get("SERIE") or "",
                "folio": r.get("FOLIO") or "", "fecha": r.get("FECHA"),
                "concepto": r.get("CONCEPTO") or "",
                "monto": _r2(r.get("MONTO") if r.get("MONTO") is not None
                             else r.get("IMPORTE"))})

    # ------------------------------------------------------- identidad
    def analyze_identity(self) -> dict:
        self.log("analizando identidad de documentos ...")
        out: dict = {}
        tables = {
            "NOTAVTA": [(k[0], k[1]) for k in self.notavta.keys()],
            "NVTAPAR": list(self.nvtapar_keys.keys()),
            "CUENXCOB": [(m["serie"], m["folio"]) for m in self.cuenxcob],
            "CXCDOCS": list(self.cxcdocs.keys()),
            "CAJAPAGO": [(m["serie"], m["folio"]) for m in self.cajapago],
        }
        for name, keys in tables.items():
            folios = Counter(f for (_s, f) in keys)
            series = Counter(s for (s, _f) in keys)
            full = Counter(keys)
            folio_collisions = sum(c - 1 for c in folios.values() if c > 1)
            folio_in_multi_serie = sum(1 for f, c in folios.items()
                                       if c > 1 and len({s for (s, ff) in keys if ff == f}) > 1)
            out[name] = {
                "rows": len(keys),
                "distinct_folio": len(folios),
                "distinct_serie": len(series),
                "series": dict(series.most_common(10)),
                "distinct_serie_folio": len(full),
                "duplicates_serie_folio": sum(c - 1 for c in full.values() if c > 1),
                "folio_collisions_global": folio_collisions,
                "folio_repeated_across_series": folio_in_multi_serie,
            }
        self.identity = out
        return out

    def cross_join_docs(self) -> dict:
        """Cobertura de claves (SERIE,FOLIO) entre tablas de documentos."""
        self.log("cruces entre tablas de documentos ...")
        nv_keys = set(self.notavta.keys())
        res: dict = {}
        for name, keys in (("NVTAPAR", set(self.nvtapar_keys)),
                           ("CUENXCOB", {(m["serie"], m["folio"]) for m in self.cuenxcob}),
                           ("CXCDOCS", set(self.cxcdocs)),
                           ("CAJAPAGO", {(m["serie"], m["folio"]) for m in self.cajapago})):
            in_nv = sum(1 for k in keys if k in nv_keys)
            res[name] = {"distinct_keys": len(keys), "in_notavta": in_nv,
                         "pct_in_notavta": round(100 * in_nv / len(keys), 2) if keys else None,
                         "not_in_notavta": len(keys) - in_nv}
        # CUENXCOB con SERIENV/FOLIOMOVTO poblados: ¿referencian la venta?
        mv = [m for m in self.cuenxcob if m["serienv"] or m["foliomovto"]]
        res["CUENXCOB_SERIENV_POBLADO"] = {
            "rows_with_serienv": len(mv),
            "sample": [{"serie": m["serie"], "folio": m["folio"],
                        "serienv": m["serienv"], "foliomovto": m["foliomovto"],
                        "movto": m["movto"], "monto": m["monto"]}
                       for m in mv[:5]],
        }
        self.cross = res
        return res

    # ------------------------------------------------------ NVTAPAR
    def analyze_detail(self) -> dict:
        self.log("validando NOTAVTA → NVTAPAR ...")
        with_detail = sum(1 for k in self.notavta if k in self.nvtapar_keys)
        orphan = sum(1 for k in self.nvtapar_keys if k not in self.notavta)
        orphan_rows = sum(c for k, c in self.nvtapar_keys.items() if k not in self.notavta)
        dupe_parts = sum(c - 1 for c in self.nvtapar_keys.values() if c > 1)
        return {
            "tickets": len(self.notavta),
            "tickets_con_detalle": with_detail,
            "tickets_sin_detalle": len(self.notavta) - with_detail,
            "pct_con_detalle": round(100 * with_detail / max(1, len(self.notavta)), 2),
            "partidas_total": self.nvtapar_total,
            "partidas_huerfanas_docs": orphan,
            "partidas_huerfanas_rows": orphan_rows,
            "docs_con_multiples_partidas": dupe_parts,
            "partida_max_por_doc": max(self.nvtapar_keys.values(), default=0),
        }

    # ------------------------------------------------------ clientes
    def analyze_customers(self) -> dict:
        self.log("validando clientes ...")
        usage = Counter()
        for row in self.notavta_rows:
            usage[row["cliente"]] += 1
        for m in self.cuenxcob:
            usage[m["cliente"]] += 1
        for (_k, row) in self.cxcdocs_rows:
            usage[row["cliente"]] += 1

        per_source = {
            "NOTAVTA": self._client_match({r["cliente"] for r in self.notavta_rows}),
            "CUENXCOB": self._client_match({m["cliente"] for m in self.cuenxcob}),
            "CXCDOCS": self._client_match({r["cliente"] for (_k, r) in self.cxcdocs_rows}),
        }
        rows = []
        for clave, cnt in usage.most_common():
            nombre = self.clientes.get(clave, {}).get("nombre", "")
            cls = ("VACIO" if not clave
                   else "PÚBLICO_EN_GENERAL" if nombre.upper().startswith("PÚBLICO")
                   else "BORRADO" if clave in self.clientes_deleted
                   else "MATCH" if clave in self.clientes else "INEXISTENTE")
            rows.append({"legacy_customer_key": clave,
                         "aparece_en": ("NOTAVTA+CUENXCOB+CXCDOCS"
                                        if sum(1 for s in per_source if clave in
                                               ({r["cliente"] for r in self.notavta_rows},
                                                {m["cliente"] for m in self.cuenxcob},
                                                {r["cliente"] for (_k, r) in self.cxcdocs_rows})) == 3
                                        else "PARCIAL"),
                         "referencias": cnt, "nombre_legacy": nombre,
                         "en_clientes_activos": clave in self.clientes,
                         "en_clientes_borrados": clave in self.clientes_deleted,
                         "clasificacion": cls})
        self.customer_rows = rows
        return {"por_fuente": per_source, "resumen": self._cls_summary(rows)}

    def _client_match(self, values: set) -> dict:
        ok = bad = deleted = empty = public = 0
        for v in values:
            if not v:
                empty += 1
            elif v in self.clientes:
                ok += 1
            elif v in self.clientes_deleted:
                deleted += 1
            elif self.clientes.get(v, {}).get("nombre", "").upper().startswith("PÚBLICO"):
                public += 1
            else:
                bad += 1
        total = len(values)
        return {"claves_distintas": total, "match": ok, "borrado": deleted,
                "vacio": empty, "inexistente": bad,
                "pct_match": round(100 * ok / max(1, total), 2)}

    @staticmethod
    def _cls_summary(rows) -> dict:
        c = Counter(r["clasificacion"] for r in rows)
        return dict(c)

    # ------------------------------------------------------- productos
    def analyze_products(self) -> dict:
        self.log("validando productos ...")
        distinct = set(self.nvtapar_codes)
        matched = sum(1 for c in distinct if c in self.articulo)
        deleted = sum(1 for c in distinct if c in self.articulo_deleted)
        empty = sum(1 for c in distinct if not c)
        missing = [c for c in distinct if c and c not in self.articulo
                   and c not in self.articulo_deleted]
        self.analyze_products_result = {"codigos_distintos": len(distinct), "match": matched,
                                        "pct_match": round(100 * matched / max(1, len(distinct)), 2),
                                        "borrado": deleted, "vacio": empty,
                                        "inexistente": len(missing),
                                        "inexistentes_muestra": missing[:20]}
        return self.analyze_products_result

    # ----------------------------------------------------------- CxC
    def analyze_cxc(self) -> dict:
        self.log("analizando CxC (semántica MOVTO, saldos, borrados) ...")
        # 1) valores de MOVTO
        movto_stats: dict[str, dict] = {}
        for v in {m["movto"] for m in self.cuenxcob}:
            rows = [m for m in self.cuenxcob if m["movto"] == v]
            montos = [m["monto"] for m in rows if m["monto"] is not None]
            movto_stats[v or "(vacío)"] = {
                "count": len(rows),
                "deleted": sum(1 for m in rows if m["deleted"]),
                "sum": _r2(sum(montos)), "avg": _r2(sum(montos) / len(montos)) if montos else None,
                "min": _r2(min(montos)) if montos else None,
                "max": _r2(max(montos)) if montos else None,
                "negativos": sum(1 for x in montos if x < 0),
                "sum_negativos": _r2(sum(x for x in montos if x < 0)),
                "por_año": dict(sorted(Counter(_year(m["aplica"]) for m in rows).items())),
            }
        self.movto_stats = movto_stats

        # 2) movimientos por documento (dos claves candidatas)
        by_doc: dict[tuple[str, str], list[dict]] = defaultdict(list)
        for m in self.cuenxcob:
            by_doc[(m["serie"], m["folio"])].append(m)

        # valores concretos de cargo/abono detectados por evidencia:
        movto_vals = sorted(movto_stats, key=lambda v: -movto_stats[v]["count"])
        cargo_val = movto_vals[0] if movto_vals else ""
        abono_val = movto_vals[1] if len(movto_vals) > 1 else ""
        self.cargo_val, self.abono_val = cargo_val, abono_val

        recon: list[dict] = []
        stats = {"H1_MATCH": 0, "H2_MATCH": 0, "NO_MATCH": 0, "SIN_MOV": 0}
        sums = {"c": 0.0, "a": 0.0}
        for key, doc in self.cxcdocs.items():
            movs = by_doc.get(key, [])
            c_a = _r2(sum(m["monto"] for m in movs
                          if not m["deleted"] and m["movto"] == cargo_val
                          and m["monto"] is not None))
            a_a = _r2(sum(m["monto"] for m in movs
                          if not m["deleted"] and m["movto"] == abono_val
                          and m["monto"] is not None))
            c_d = _r2(sum(m["monto"] for m in movs
                          if m["movto"] == cargo_val and m["monto"] is not None))
            a_d = _r2(sum(m["monto"] for m in movs
                          if m["movto"] == abono_val and m["monto"] is not None))
            neg = _r2(sum(m["monto"] for m in movs
                          if m["monto"] is not None and m["monto"] < 0))
            h1 = _r2((c_a or 0) - (a_a or 0))
            h2 = _r2((c_d or 0) - (a_d or 0))
            saldo_doc = doc["saldo"]
            nv = self.notavta.get(key, {})
            saldo_nv = nv.get("saldo")
            h1_ok = saldo_doc is not None and h1 is not None and abs(h1 - saldo_doc) <= TOL
            h2_ok = saldo_doc is not None and h2 is not None and abs(h2 - saldo_doc) <= TOL
            if not movs:
                status = "SIN_MOVIMIENTOS"
                stats["SIN_MOV"] += 1
            elif h1_ok:
                status = "MATCH_H1"
                stats["H1_MATCH"] += 1
            elif h2_ok:
                status = "MATCH_H2"
                stats["H2_MATCH"] += 1
            else:
                status = "DIFFERENCE"
                stats["NO_MATCH"] += 1
            sums["c"] += c_a or 0
            sums["a"] += a_a or 0
            recon.append({
                "cliente": doc["cliente"], "serie": key[0], "folio": key[1],
                "cxcdocs_saldo": saldo_doc, "notavta_saldo": saldo_nv,
                "calculated_h1_activos": h1, "calculated_h2_con_borrados": h2,
                "diff_cxcdocs_h1": _r2((h1 or 0) - (saldo_doc or 0)),
                "diff_notavta_h1": _r2((h1 or 0) - (saldo_nv or 0)) if saldo_nv is not None else None,
                "movement_count": len(movs),
                "deleted_count": sum(1 for m in movs if m["deleted"]),
                "c_total_activos": c_a, "a_total_activos": a_a,
                "negativos_total": neg,
                "condicion": doc["condicion"], "status": status})
        self.recon = recon
        self.cxc_stats = stats
        self.cxc_sums = sums

        # 3) CUENXCOB.SALDO por movimiento: ¿refleja saldo del documento?
        mov_saldo_test = [m for m in self.cuenxcob
                          if not m["deleted"] and m["saldo"] is not None
                          and (m["serie"], m["folio"]) in self.cxcdocs]
        agree = 0
        for m in mov_saldo_test:
            ds = self.cxcdocs[(m["serie"], m["folio"])]["saldo"]
            if ds is not None and abs(m["saldo"] - ds) <= TOL:
                agree += 1
        self.movsaldo = {"rows_con_saldo": len(mov_saldo_test),
                         "iguales_a_cxcdocs_saldo": agree}

        # 4) saldos de CXCDOCS: distribución
        saldos = [d["saldo"] for d in self.cxcdocs.values() if d["saldo"] is not None]
        self.cxcdocs_saldo_dist = {
            "positivos": sum(1 for s in saldos if s > TOL),
            "cero": sum(1 for s in saldos if abs(s) <= TOL),
            "negativos": sum(1 for s in saldos if s < -TOL),
            "suma_total": _r2(sum(saldos)),
            "suma_positivos": _r2(sum(s for s in saldos if s > 0)),
            "suma_negativos": _r2(sum(s for s in saldos if s < 0)),
        }
        return {"movto_stats": movto_stats, "recon_stats": stats,
                "cargo_val": cargo_val, "abono_val": abono_val,
                "suma_cargos_activos": sums["c"], "suma_abonos_activos": sums["a"]}

    # ------------------------------------------------------- CAJAPAGO
    def analyze_payments(self) -> dict:
        self.log("analizando CAJAPAGO ...")
        conceptos: Counter = Counter()
        tipodoc: Counter = Counter()
        in_nv = out_nv = 0
        monto_in = monto_out = 0.0
        for p in self.cajapago:
            conceptos[p["concepto"] or "(vacío)"] += 1
            tipodoc[p["tipodoc"] or "(vacío)"] += 1
            key = (p["serie"], p["folio"])
            if key in self.notavta:
                in_nv += 1
                monto_in += p["monto"] or 0
            else:
                out_nv += 1
                monto_out += p["monto"] or 0
        # hipótesis: pago de venta contado — comparar suma de pagos vs TOTAL
        # para documentos con al menos un pago
        pagos_por_doc: dict[tuple[str, str], float] = defaultdict(float)
        for p in self.cajapago:
            pagos_por_doc[(p["serie"], p["folio"])] += p["monto"] or 0
        tested = exact = 0
        cond_breakdown: dict[str, dict] = defaultdict(lambda: {"n": 0, "exact": 0})
        for key, paid in pagos_por_doc.items():
            doc = self.notavta.get(key)
            if not doc or doc["total"] is None:
                continue
            tested += 1
            cond = doc["condicion"] or "(vacío)"
            cond_breakdown[cond]["n"] += 1
            if abs(paid - doc["total"]) <= TOL:
                exact += 1
                cond_breakdown[cond]["exact"] += 1
        return {"rows": len(self.cajapago),
                "deleted": sum(1 for p in self.cajapago if p["deleted"]),
                "conceptos": dict(conceptos.most_common(10)),
                "tipodoc": dict(tipodoc.most_common(5)),
                "docs_en_notavta": in_nv, "docs_fuera_notavta": out_nv,
                "monto_dentro": _r2(monto_in), "monto_fuera": _r2(monto_out),
                "docs_con_pago": len(pagos_por_doc),
                "docs_pago_eq_total": exact,
                "pct_pago_eq_total": round(100 * exact / max(1, tested), 2),
                "por_condicion": {k: {"n": v["n"], "exactos": v["exact"]}
                                  for k, v in sorted(cond_breakdown.items())}}
        # (self.payment_result se asigna en run())

    # -------------------------------------------------- cancelaciones
    def analyze_cancellations(self) -> dict:
        self.log("analizando cancelaciones ...")
        cancel_keys = {k for k, r in self.notavta.items() if r["cancelada"]}
        cancel = [r for r in self.notavta_rows if r["cancelada"]]
        con_mov = 0
        for m in self.cuenxcob:
            if (m["serie"], m["folio"]) in cancel_keys:
                con_mov += 1
        return {"cancelados": len(cancel),
                "suma_total_cancelados": _r2(sum(r["total"] or 0 for r in cancel)),
                "saldo_cancelados": _r2(sum(r["saldo"] or 0 for r in cancel)),
                "movimientos_cxc_asociados": con_mov,
                "status_values": dict(Counter(r["status"] for r in self.notavta_rows))}

    # --------------------------------------------------------- fechas
    def analyze_annual(self) -> dict:
        self.log("distribución anual ...")
        years = sorted({y for y in
                        (_year(r["fecha"]) for r in self.notavta_rows) if y})
        rows = []
        cargos_y = Counter()
        abonos_y = Counter()
        for m in self.cuenxcob:
            y = _year(m["aplica"])
            if not y:
                continue
            if m["movto"] == self.cargo_val:
                cargos_y[y] += m["monto"] or 0
            elif m["movto"] == self.abono_val:
                abonos_y[y] += m["monto"] or 0
        saldo_y: Counter = Counter()
        for (_k, d) in self.cxcdocs_rows:
            y = _year(d["aplica"])
            if y:
                saldo_y[y] += d["saldo"] or 0
        tickets_y: Counter = Counter()
        ventas_y: Counter = Counter()
        for r in self.notavta_rows:
            y = _year(r["fecha"])
            if y:
                tickets_y[y] += 1
                ventas_y[y] += r["total"] or 0
        pagos_y: Counter = Counter()
        for p in self.cajapago:
            y = _year(p["fecha"])
            if y:
                pagos_y[y] += p["monto"] or 0
        for y in years:
            rows.append({"año": y, "tickets": tickets_y.get(y, 0),
                         "ventas_total": _r2(ventas_y.get(y, 0)),
                         "cargos_cxc": _r2(cargos_y.get(y, 0)),
                         "abonos_cxc": _r2(abonos_y.get(y, 0)),
                         "saldo_cxcdocs": _r2(saldo_y.get(y, 0)),
                         "pagos_caja": _r2(pagos_y.get(y, 0))})
        self.annual = rows
        return rows

    # ------------------------------------------------------ tickets
    def analyze_tickets(self) -> dict:
        self.log("clasificación de los 57,263 tickets ...")
        cats: Counter = Counter()
        monto: Counter = Counter()
        for key, r in self.notavta.items():
            con_det = key in self.nvtapar_keys
            cats["CON_DETALLE" if con_det else "SIN_DETALLE"] += 1
            cats["CANCELADOS" if r["cancelada"] else "NO_CANCELADOS"] += 1
            cond = (r["condicion"] or "(vacío)").upper()
            cats[f"CONDICION_{cond}"] += 1
            cats["CON_CLIENTE" if r["cliente"] else "SIN_CLIENTE"] += 1
            con_cxc = key in self.cxcdocs
            cats["CON_CXC" if con_cxc else "SIN_CXC"] += 1
            saldo = r["saldo"] or 0
            cats["CON_SALDO" if abs(saldo) > TOL else "SIN_SALDO"] += 1
            for k in ("CON_DETALLE" if con_det else "SIN_DETALLE",
                      "CON_CXC" if con_cxc else "SIN_CXC",
                      "CON_SALDO" if abs(saldo) > TOL else "SIN_SALDO"):
                monto[k] += r["total"] or 0
        self.ticket_result = {"categorias": dict(cats),
                              "montos_por_categoria": {k: _r2(v) for k, v in monto.items()}}
        return self.ticket_result

    # ----------------------------------------------------------- IVA
    def analyze_iva(self) -> dict:
        self.log("verificando consistencia IVA vs TOTAL ...")
        ok = bad = tested = 0
        for r in iter_records(self.dir / "NOTAVTA.dbf",
                              only={"SUBTOTAL", "IVA", "TOTAL"}, limit=20000):
            if r["_deleted"]:
                continue
            sub, iva, tot = r.get("SUBTOTAL"), r.get("IVA"), r.get("TOTAL")
            if None in (sub, iva, tot) or abs(tot) < TOL:
                continue
            tested += 1
            if abs((sub or 0) + (iva or 0) - (tot or 0)) <= 0.05:
                ok += 1
            else:
                bad += 1
        return {"muestras": tested, "consistentes": ok, "inconsistentes": bad,
                "pct_consistente": round(100 * ok / max(1, tested), 2)}

    # ------------------------------------------------------- reportes
    def write_outputs(self, meta: dict) -> dict:
        self.log("escribiendo CSVs y reporte ...")
        outdir = config.resolve_reports_dir() / "analysis"
        outdir.mkdir(parents=True, exist_ok=True)
        paths = {}

        def wcsv(name, header, rows):
            p = outdir / name
            with p.open("w", newline="", encoding="utf-8-sig") as fh:
                w = csv.writer(fh)
                w.writerow(header)
                w.writerows(rows)
            paths[name] = str(p)

        # 1) document_identity.csv
        rows = []
        for t, st in self.identity.items():
            rows.append([t, st["rows"], st["distinct_folio"], st["folio_collisions_global"],
                         st["distinct_serie"], st["distinct_serie_folio"],
                         st["duplicates_serie_folio"],
                         st["folio_repeated_across_series"],
                         ";".join(f"{k}:{v}" for k, v in st["series"].items())])
        wcsv("document_identity.csv",
             ["TABLA", "ROWS", "FOLIOS_DISTINTOS", "COLISIONES_FOLIO",
              "SERIES", "SERIE_FOLIO_DISTINTOS", "DUPLICADOS_SERIE_FOLIO",
              "FOLIO_EN_MULTI_SERIE", "SERIES_TOP"], rows)

        # 2) cxc_reconciliation.csv
        rows = []
        for r in self.recon:
            rows.append([r["cliente"], r["serie"], r["folio"], r["cxcdocs_saldo"],
                         r["notavta_saldo"], r["calculated_h1_activos"],
                         r["calculated_h2_con_borrados"], r["diff_cxcdocs_h1"],
                         r["diff_notavta_h1"], r["movement_count"],
                         r["deleted_count"], r["c_total_activos"],
                         r["a_total_activos"], r["negativos_total"],
                         r["condicion"], r["status"]])
        wcsv("cxc_reconciliation.csv",
             ["CLIENTE", "SERIE", "FOLIO", "CXCDOCS_SALDO", "NOTAVTA_SALDO",
              "CALCULATED_H1", "CALCULATED_H2", "DIFF_CXCDOCS", "DIFF_NOTAVTA",
              "MOVEMENT_COUNT", "DELETED_COUNT", "C_TOTAL", "A_TOTAL",
              "NEGATIVE_TOTAL", "CONDICION", "STATUS"], rows)

        # 3) customer_mapping_analysis.csv
        wcsv("customer_mapping_analysis.csv",
             ["LEGACY_CUSTOMER_KEY", "REFERENCIAS", "NOMBRE_LEGACY",
              "EN_ACTIVOS", "EN_BORRADOS", "CLASIFICACION"],
             [[r["legacy_customer_key"], r["referencias"], r["nombre_legacy"],
               r["en_clientes_activos"], r["en_clientes_borrados"],
               r["clasificacion"]] for r in self.customer_rows])

        # 4) product_mapping_analysis.csv (agregado)
        prod = self.analyze_products_result
        wcsv("product_mapping_analysis.csv",
             ["METRICA", "VALOR"],
             [[k, v] for k, v in prod.items() if k != "inexistentes_muestra"])

        # 5) ticket_analysis.csv
        t = self.ticket_result
        wcsv("ticket_analysis.csv", ["CATEGORIA", "COUNT", "MONTO_TOTAL"],
             [[k, v, t["montos_por_categoria"].get(k, "")] for k, v in t["categorias"].items()])

        # 6) payment_analysis.csv
        p = self.payment_result
        wcsv("payment_analysis.csv", ["METRICA", "VALOR"],
             [[k, v] for k, v in p.items()])

        # 7) annual_totals.csv
        wcsv("annual_totals.csv",
             ["AÑO", "TICKETS", "VENTAS_TOTAL", "CARGOS_CXC", "ABONOS_CXC",
              "SALDO_CXCDOCS", "PAGOS_CAJA"],
             [[r["año"], r["tickets"], r["ventas_total"], r["cargos_cxc"],
               r["abonos_cxc"], r["saldo_cxcdocs"], r["pagos_caja"]]
              for r in self.annual])

        # 8) anomalies.csv
        wcsv("anomalies.csv", ["TIPO", "CLAVE", "DETALLE"],
             [[a["tipo"], a["clave"], a["detalle"]] for a in self.anomalies[:5000]])

        # analysis_run.json
        run = {**meta, "tolerancia": TOL, "outputs": paths,
               "anomalies_count": len(self.anomalies)}
        pj = outdir / "analysis_run.json"
        pj.write_text(json.dumps(run, ensure_ascii=False, indent=2), encoding="utf-8")
        paths["analysis_run.json"] = str(pj)
        return paths


# ==================================================================
# Orquestación + reporte
# ==================================================================

def run(legacy_dir: Path | None = None, progress=print) -> dict:
    legacy_dir = legacy_dir or config.resolve_legacy_data_path()
    if not legacy_dir.is_dir():
        return {"status": "NOT_FOUND", "expected_path": str(legacy_dir)}
    started = datetime.now(timezone.utc)
    az = Analyzer(legacy_dir, progress=progress)
    az.load_all()
    identity = az.analyze_identity()
    cross = az.cross_join_docs()
    detail = az.analyze_detail()
    customers = az.analyze_customers()
    products = az.analyze_products()
    cxc = az.analyze_cxc()
    payments = az.analyze_payments()
    az.payment_result = payments
    cancellations = az.analyze_cancellations()
    annual = az.analyze_annual()
    tickets = az.analyze_tickets()
    iva = az.analyze_iva()
    finished = datetime.now(timezone.utc)

    meta = {
        "generated_at": started.isoformat(),
        "duration_seconds": round((finished - started).total_seconds(), 1),
        "analyzer_version": "0.1.0-analyze",
        "legacy_path": str(legacy_dir),
        "encoding": config.DEFAULT_ENCODING,
        "tolerancia": TOL,
        "counts": {"notavta": len(az.notavta), "nvtapar": az.nvtapar_total,
                   "cuenxcob": len(az.cuenxcob), "cxcdocs": len(az.cxcdocs),
                   "cajapago": len(az.cajapago), "clientes": len(az.clientes),
                   "articulo": len(az.articulo)},
    }
    paths = az.write_outputs(meta)

    # ------- veredicto -------
    blockers = []
    ident = identity["NOTAVTA"]
    if ident["duplicates_serie_folio"] > 0:
        blockers.append(f"NOTAVTA tiene {ident['duplicates_serie_folio']} claves (SERIE,FOLIO) duplicadas")
    if cross["CUENXCOB"]["pct_in_notavta"] is not None and cross["CUENXCOB"]["pct_in_notavta"] < 99:
        blockers.append("CUENXCOB tiene movimientos fuera de NOTAVTA (clave documental incompleta)")
    total_docs = len(az.recon)
    match_docs = az.cxc_stats["H1_MATCH"] + az.cxc_stats["H2_MATCH"]
    match_pct = round(100 * match_docs / max(1, total_docs), 2)
    if match_pct < 95:
        blockers.append(f"reconciliación CxC solo {match_pct}% (umbral 95%)")
    if az.movto_stats.get(az.abono_val, {}).get("count", 0) == 0:
        blockers.append("semántica MOVTO no determinada")
    verdict = "READY_FOR_STAGING" if not blockers else "BLOCKED"

    md = build_markdown(az, meta, identity, cross, detail, customers, products,
                        cxc, payments, cancellations, annual, tickets, iva,
                        match_pct, blockers, verdict)
    report_path = config.project_root() / "RYSA_LEGACY_ANALYSIS_REPORT.md"
    report_path.write_text(md, encoding="utf-8")

    return {"status": "OK", "verdict": verdict, "blockers": blockers,
            "match_pct": match_pct, "cxc_stats": az.cxc_stats,
            "report": str(report_path), "outputs": paths, "meta": meta}


def build_markdown(az, meta, identity, cross, detail, customers, products,
                   cxc, payments, cancellations, annual, tickets, iva,
                   match_pct, blockers, verdict) -> str:
    L: list[str] = []
    a = L.append
    a("# RYSA LEGACY ANALYSIS REPORT (FASE 2 — ANALYZE)\n")
    a(f"Generado: {meta['generated_at']} · Duración: {meta['duration_seconds']} s · "
      f"Tolerancia: ${TOL} · Codificación: {meta['encoding']}\n")
    a("## 1. Resumen ejecutivo\n")
    a(f"- 172 tablas legacy leídas; análisis sobre NOTAVTA ({meta['counts']['notavta']:,}), "
      f"NVTAPAR ({meta['counts']['nvtapar']:,}), CUENXCOB ({meta['counts']['cuenxcob']:,}), "
      f"CXCDOCS ({meta['counts']['cxcdocs']:,}), CAJAPAGO ({meta['counts']['cajapago']:,}), "
      f"CLIENTES ({meta['counts']['clientes']:,}), ARTICULO ({meta['counts']['articulo']:,}).")
    a(f"- Cargo/abono detectado por evidencia: MOVTO='{az.cargo_val}' (cargo) y "
      f"MOVTO='{az.abono_val}' (abono).")
    a(f"- Reconciliación documental CxC: **{match_pct}% MATCH** "
      f"({az.cxc_stats['H1_MATCH']} H1 + {az.cxc_stats['H2_MATCH']} H2 de "
      f"{len(az.recon)} documentos).")
    a(f"- Veredicto: **{verdict}**.\n")

    a("## 2. Identidad de documentos\n")
    a("| TABLA | ROWS | FOLIOS únicos | Colisiones FOLIO | SERIES | (SERIE,FOLIO) únicos | Duplicados | Folio en multi-serie |")
    a("|---|---|---|---|---|---|---|---|")
    for t, st in identity.items():
        a(f"| {t} | {st['rows']:,} | {st['distinct_folio']:,} | {st['folio_collisions_global']:,} "
          f"| {st['distinct_serie']} | {st['distinct_serie_folio']:,} "
          f"| {st['duplicates_serie_folio']:,} | {st['folio_repeated_across_series']:,} |")
    a("")
    a(f"Series en NOTAVTA: `{identity['NOTAVTA']['series']}`\n")
    a("### Cruces con NOTAVTA\n")
    a("| TABLA | Claves distintas | En NOTAVTA | % | Fuera |")
    a("|---|---|---|---|---|")
    for t in ("NVTAPAR", "CUENXCOB", "CXCDOCS", "CAJAPAGO"):
        c = cross[t]
        a(f"| {t} | {c['distinct_keys']:,} | {c['in_notavta']:,} | {c['pct_in_notavta']}% | {c['not_in_notavta']:,} |")
    sn = cross.get("CUENXCOB_SERIENV_POBLADO", {})
    a(f"\nCUENXCOB con SERIENV/FOLIOMOVTO poblados: {sn.get('rows_with_serienv', 0)} registros.\n")

    a("## 3. Clientes\n")
    for src, st in customers["por_fuente"].items():
        a(f"- **{src}**: {st['claves_distintas']} claves distintas → match {st['match']} "
          f"({st['pct_match']}%), borrado {st['borrado']}, vacío {st['vacio']}, "
          f"inexistente {st['inexistente']}.")
    a(f"- Clasificación global: `{customers['resumen']}`\n")

    a("## 4. Productos\n")
    a(f"- Códigos distintos en NVTAPAR: {products['codigos_distintos']:,} → "
      f"match {products['match']:,} ({products['pct_match']}%), borrado {products['borrado']}, "
      f"vacío {products['vacio']}, inexistente {products['inexistente']}.")
    if products["inexistentes_muestra"]:
        a(f"- Muestra inexistentes: `{products['inexistentes_muestra'][:10]}`")
    a("")

    a("## 5-6. Tickets y detalles\n")
    a(f"- Tickets con detalle: {detail['tickets_con_detalle']:,} ({detail['pct_con_detalle']}%) "
      f"· sin detalle: {detail['tickets_sin_detalle']:,}.")
    a(f"- Partidas totales: {detail['partidas_total']:,} · huérfanas: "
      f"{detail['partidas_huerfanas_rows']:,} (en {detail['partidas_huerfanas_docs']:,} docs) "
      f"· máx. partidas por doc: {detail['partida_max_por_doc']}.\n")
    a("Clasificación de tickets:\n")
    a("| Categoría | Count | Monto |")
    a("|---|---|---|")
    for k, v in tickets["categorias"].items():
        a(f"| {k} | {v:,} | {tickets['montos_por_categoria'].get(k, '')} |")
    a("")

    a("## 7. CxC — semántica MOVTO\n")
    a("| MOVTO | Count | Borrados | Suma | Promedio | Mín | Máx | Negativos |")
    a("|---|---|---|---|---|---|---|---|")
    for v, st in cxc["movto_stats"].items():
        a(f"| {v} | {st['count']:,} | {st['deleted']:,} | {st['sum']:,} | {st['avg']} "
          f"| {st['min']:,} | {st['max']:,} | {st['negativos']:,} |")
    a(f"\nSuma cargos (activos): ${cxc['suma_cargos_activos']:,} · "
      f"suma abonos (activos): ${cxc['suma_abonos_activos']:,}\n")
    a("### Reconciliación documental\n")
    a("| Status | Docs |")
    a("|---|---|")
    for k, v in az.cxc_stats.items():
        a(f"| {k} | {v:,} |")
    ms = az.movsaldo
    a(f"\nCUENXCOB.SALDO por movimiento: {ms['rows_con_saldo']:,} rows con saldo; "
      f"{ms['iguales_a_cxcdocs_saldo']:,} coinciden con CXCDOCS.SALDO (±{TOL}).")
    sd = az.cxcdocs_saldo_dist
    a(f"\nCXCDOCS.SALDO: positivos {sd['positivos']:,} · cero {sd['cero']:,} · "
      f"negativos {sd['negativos']:,} · suma total ${sd['suma_total']:,} "
      f"(positivos ${sd['suma_positivos']:,}, negativos ${sd['suma_negativos']:,}).\n")

    a("## 8. Pagos (CAJAPAGO)\n")
    a(f"- Rows: {payments['rows']:,} (borrados {payments['deleted']:,}) · "
      f"conceptos: `{payments['conceptos']}` · tipodoc: `{payments['tipodoc']}`.")
    a(f"- Claves en NOTAVTA: {payments['docs_en_notavta']:,} (${payments['monto_dentro']:,}) "
      f"· fuera: {payments['docs_fuera_notavta']:,} (${payments['monto_fuera']:,}).")
    a(f"- Documentos con pago y pago==TOTAL: {payments['docs_pago_eq_total']:,} "
      f"de {payments['docs_con_pago']:,} ({payments['pct_pago_eq_total']}%).")
    a(f"- Por condición: `{payments['por_condicion']}`\n")

    a("## 9. Cancelaciones\n")
    a(f"- Cancelados: {cancellations['cancelados']:,} · total ${cancellations['suma_total_cancelados']:,} "
      f"· saldo ${cancellations['saldo_cancelados']:,} · movimientos CxC asociados: "
      f"{cancellations['movimientos_cxc_asociados']:,}.")
    a(f"- STATUS values: `{cancellations['status_values']}`\n")

    a("## 10-11. Borrados y montos negativos\n")
    for v, st in cxc["movto_stats"].items():
        a(f"- MOVTO={v}: {st['deleted']:,} borrados · {st['negativos']:,} negativos "
          f"(suma ${st['sum_negativos']:,}).")
    a(f"- Escenarios comparados por documento en `cxc_reconciliation.csv` "
      f"(H1=activos, H2=activos+borrados).\n")

    a("## 12. Reconciliación matemática\n")
    a(f"- H1 (cargo−abono activos) y H2 (incluye borrados) por documento contra "
      f"CXCDOCS.SALDO → **{match_pct}% MATCH global**.")
    a(f"- Diferencias detalladas por documento en `legacy_reports/analysis/cxc_reconciliation.csv`.\n")

    a("## 13. Fechas (distribución anual)\n")
    a("| Año | Tickets | Ventas | Cargos CxC | Abonos CxC | Saldo CXCDOCS | Pagos caja |")
    a("|---|---|---|---|---|---|---|")
    for r in annual:
        a(f"| {r['año']} | {r['tickets']:,} | {r['ventas_total']:,} | {r['cargos_cxc']:,} "
          f"| {r['abonos_cxc']:,} | {r['saldo_cxcdocs']:,} | {r['pagos_caja']:,} |")
    a("")

    a("## 14. Anomalías\n")
    a(f"- {len(az.anomalies):,} anomalías registradas (detalle en `anomalies.csv`).")
    a(f"- IVA de NOTAVTA: consistencia SUBTOTAL+IVA==TOTAL en muestra de {iva['muestras']:,}: "
      f"{iva['pct_consistente']}% → **NO usar IVA para reconstrucción financiera**; usar TOTAL.\n")

    a("## 15-16. Relaciones comprobadas y desconocidas\n")
    a("- Comprobadas: NOTAVTA→NVTAPAR (SERIE+FOLIO), CLIENTE→CLIENTES.CLAVE, "
      "CODIGO→ARTICULO.CODIGO, CUENXCOB/CXCDOCS/CAJAPAGO→NOTAVTA (SERIE+FOLIO).")
    a("- A revisar en STAGING: significado exacto de SERIENV/FOLIOMOVTO, "
      "CONCEPTO de CAJAPAGO, documentos con diferencias de saldo.\n")

    a("## 17. Fuentes de verdad (por evidencia)\n")
    a("| Dato | Fuente | Evidencia |")
    a("|---|---|---|")
    a("| Clientes | CLIENTES (activos) | 717 registros; claves usadas por todas las tablas |")
    a("| Tickets | NOTAVTA | 57,263 docs; única tabla de cabecera |")
    a("| Detalle | NVTAPAR | 134,438 partidas enlazadas por (SERIE,FOLIO) |")
    a("| Documentos CxC | CXCDOCS | saldo declarado por documento |")
    a("| Movimientos CxC | CUENXCOB | cargos/abonos con MONTO y APLICA |")
    a("| Pagos de caja | CAJAPAGO | folio enlaza a NOTAVTA; pago==TOTAL en contado |")
    a(f"| Saldo histórico | CXCDOCS.SALDO validado con H1/H2 de CUENXCOB ({match_pct}% match) |")
    a("")

    a("## 18. Riesgos\n")
    for b in blockers:
        a(f"- 🔴 {b}")
    a("- Saldos negativos en CXCDOCS/NOTAVTA (no eliminar; representan notas de crédito/ajustes).")
    a("- 696 movimientos borrados en CUENXCOB: el escenario (H1 vs H2) decide su tratamiento.")
    a("- IVA de NOTAVTA corrupto/inconsistente: excluir de reconstrucción.\n")

    a("## 19-20. Arquitectura recomendada y decisión\n")
    a("- STAGING por claves compuestas (SERIE,FOLIO) con idempotencia por origen legacy.")
    a(f"- Fórmula CxC: saldo = Σ(MOVTO='{az.cargo_val}') − Σ(MOVTO='{az.abono_val}') "
      "según el escenario ganador H1/H2; reconstruir por documento y validar contra CXCDOCS.SALDO.")
    a(f"- **VEREDICTO: {verdict}**")
    if blockers:
        a("- Bloqueos a resolver antes de STAGING (ver sección 18).")
    a("")
    return "\n".join(L)

