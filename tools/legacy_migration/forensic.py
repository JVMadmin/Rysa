"""AUDITORÍA FORENSE legacy — SOLO LECTURA (regla absoluta: NO importa nada).

Reconstruye el saldo desde TODAS las fuentes y lo compara contra
CLIENTES.SALDOS. Genera JSON + CSVs en legacy_reports/forensic/.

Uso:  python -m tools.legacy_migration.forensic
"""
from __future__ import annotations

import csv
import json
import shutil
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from .config import resolve_legacy_data_path, resolve_reports_dir
from .dbf_reader import iter_records, iter_field_values, read_header

D = resolve_legacy_data_path()
OUT = resolve_reports_dir() / "forensic"

# Archivos TMP fuera del análisis (no son tablas).
SKIP_TMP = True


def exists(name: str) -> bool:
    return (D / name).is_file()


def recs(name: str, only=None, include_deleted: bool = False):
    if not exists(name):
        return
    for r in iter_records(D / name, only=only):
        if not include_deleted and r.get("_deleted"):
            continue
        yield r


def fnum(v) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def money(x: float) -> float:
    return round(x + 1e-9, 2)


def main() -> int:
    if not D.is_dir():
        print(f"LEGACY DATA NO ENCONTRADO: {D}")
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    R: dict = {"generated_at": datetime.now(timezone.utc).isoformat(), "source": str(D)}

    # ------------------------------------------------------------------ #
    # 1) CLIENTES (incluye borrados aparte)                               #
    # ------------------------------------------------------------------ #
    print("[1/9] CLIENTES ...", flush=True)
    hdr = read_header(D / "CLIENTES.dbf")
    has_status = "STATUS" in hdr.field_names
    clientes = {}
    clientes_del = {}
    for r in recs("CLIENTES.dbf", only={"CLAVE", "NOMBRE", "SALDO", "STATUS",
                                        "CREDITO", "LIMCREDITO", "DIASCREDIT",
                                        "VENDEDOR", "TIPO"}):
        clave = (r.get("CLAVE") or "").strip()
        row = {"nombre": (r.get("NOMBRE") or "").strip(),
               "saldo": fnum(r.get("SALDO")),
               "status": (r.get("STATUS") or "").strip(),
               "credito": str(r.get("CREDITO")),
               "limcredito": fnum(r.get("LIMCREDITO"))}
        clientes[clave] = row
    for r in recs("CLIENTES.dbf", only={"CLAVE", "NOMBRE", "SALDO", "STATUS"},
                  include_deleted=True):
        if r.get("_deleted"):
            clientes_del[(r.get("CLAVE") or "").strip()] = {
                "nombre": (r.get("NOMBRE") or "").strip(),
                "saldo": fnum(r.get("SALDO"))}

    saldo_pos = sum(c["saldo"] for c in clientes.values() if c["saldo"] > 0)
    saldo_neg = sum(c["saldo"] for c in clientes.values() if c["saldo"] < 0)
    saldo_zero_n = sum(1 for c in clientes.values() if c["saldo"] == 0)
    A = money(sum(c["saldo"] for c in clientes.values()))
    A_del = money(sum(c["saldo"] for c in clientes_del.values()))
    A_total = money(A + A_del)
    statuses = defaultdict(lambda: [0, 0.0])
    for c in clientes.values():
        statuses[c["status"] or "(vacio)"][0] += 1
        statuses[c["status"] or "(vacio)"][1] += c["saldo"]
    codes_dup = [k for k, v in
                 defaultdict(int, {k: 1 for k in clientes}).items() if v > 1]
    # Formatos anómalos de CLAVE
    fmt = {"sin_cero_izq": [], "espacios": [], "no_numerico": [], "vacio": 0}
    norm_map = defaultdict(list)
    for k in clientes:
        if k == "":
            fmt["vacio"] += 1
            continue
        if k != k.strip():
            fmt["espacios"].append(k)
        core = k.strip()
        if core.isdigit():
            norm = core.lstrip("0") or "0"
            norm_map[norm].append(k)
            if core != core.lstrip("0") and len(core.lstrip("0")) > 0 and core.startswith("0"):
                pass  # cero a la izquierda es normal (00003)
        else:
            fmt["no_numerico"].append(k)
    norm_collisions = {n: ks for n, ks in norm_map.items() if len(ks) > 1}
    fmt["sin_cero_izq"] = sorted({k for ks in norm_collisions.values() for k in ks})

    R["clientes"] = {
        "n_activos": len(clientes), "n_borrados": len(clientes_del),
        "A_saldo_activos": A, "A_saldo_borrados": A_del, "A_saldo_total": A_total,
        "saldo_positivo": money(saldo_pos), "saldo_negativo": money(saldo_neg),
        "clientes_saldo_cero": saldo_zero_n,
        "por_status": {k: {"n": v[0], "saldo": money(v[1])}
                       for k, v in sorted(statuses.items())},
        "claves_vacias": fmt["vacio"],
        "claves_con_espacios": fmt["espacios"][:50],
        "claves_no_numericas": fmt["no_numerico"][:100],
        "colisiones_normalizadas": {k: v for k, v in
                                    list(norm_collisions.items())[:50]},
    }
    print(f"    A (activos) = {A:,.2f}  (+borrados {A_del:,.2f})")

    # ------------------------------------------------------------------ #
    # 2) CXCDOCS                                                          #
    # ------------------------------------------------------------------ #
    print("[2/9] CXCDOCS ...", flush=True)
    cxcd_tipo = defaultdict(lambda: [0, 0.0, 0.0, 0.0])  # n, MONTO, TOTAL, SALDO
    cxcd_cli = defaultdict(float)
    B = 0.0; B_total = 0.0; B_monto = 0.0
    for r in recs("CXCDOCS.dbf", only={"TIPO", "CLIENTE", "MONTO", "TOTAL", "SALDO"}):
        t = (r.get("TIPO") or "").strip()
        cxcd_tipo[t][0] += 1
        cxcd_tipo[t][1] += fnum(r.get("MONTO"))
        cxcd_tipo[t][2] += fnum(r.get("TOTAL"))
        cxcd_tipo[t][3] += fnum(r.get("SALDO"))
        cxcd_cli[(r.get("CLIENTE") or "").strip()] += fnum(r.get("SALDO"))
    B = money(sum(v[3] for v in cxcd_tipo.values()))
    B_total = money(sum(v[2] for v in cxcd_tipo.values()))
    B_monto = money(sum(v[1] for v in cxcd_tipo.values()))
    R["cxcdocs"] = {"B_saldo": B, "sum_TOTAL_cargos": B_total,
                    "sum_MONTO": B_monto,
                    "por_tipo": {k: {"n": v[0], "monto": money(v[1]),
                                     "total": money(v[2]), "saldo": money(v[3])}
                                 for k, v in sorted(cxcd_tipo.items())}}
    print(f"    B (SALDO) = {B:,.2f}   cargos(TOTAL) = {B_total:,.2f}")

    # ------------------------------------------------------------------ #
    # 3) Ventas: NOTAVTA + FACTURAS + NOTASDBT + TICKETS                  #
    # ------------------------------------------------------------------ #
    print("[3/9] NOTAVTA / FACTURAS / NOTASDBT / TICKETS ...", flush=True)
    def docsum(name, fields, groupers):
        g = {grp: defaultdict(lambda: [0, 0.0, 0.0]) for grp in groupers}
        tot = defaultdict(lambda: [0, 0.0, 0.0])
        cancel = {"n": 0, "total": 0.0, "saldo": 0.0}
        n = 0
        for r in recs(name, only=fields):
            n += 1
            fc = (r.get("FCANCELADA") or "").strip() if "FCANCELADA" in fields else ""
            cancelled = bool(fc)
            tot["n"][0] += 1
            tot["n"][1] += fnum(r.get("TOTAL"))
            tot["n"][2] += fnum(r.get("SALDO")) if "SALDO" in fields else 0.0
            if cancelled:
                cancel["n"] += 1
                cancel["total"] += fnum(r.get("TOTAL"))
                cancel["saldo"] += fnum(r.get("SALDO")) if "SALDO" in fields else 0.0
                continue
            for grp in groupers:
                key = (r.get(grp[0]) or "").strip() if len(grp) == 1 else \
                    tuple((r.get(x) or "").strip() for x in grp)
                g[grp][key][0] += 1
                g[grp][key][1] += fnum(r.get("TOTAL"))
                if "SALDO" in fields:
                    g[grp][key][2] += fnum(r.get("SALDO"))
        out = {"n": tot["n"][0], "sum_TOTAL": money(tot["n"][1]),
               "sum_SALDO": money(tot["n"][2]), "cancelados": {
                   "n": cancel["n"], "total": money(cancel["total"]),
                   "saldo": money(cancel["saldo"])}}
        for grp in groupers:
            lbl = "+".join(grp)
            out["por_" + lbl] = {str(k): {"n": v[0], "total": money(v[1]),
                                          "saldo": money(v[2])}
                                 for k, v in sorted(g[grp].items())}
        return out

    C_data = docsum("NOTAVTA.dbf",
                    {"SERIE", "FOLIO", "CLIENTE", "CONDICION", "TOTAL", "SALDO",
                     "FCANCELADA", "STATUS"}, [("CONDICION",), ("SERIE",)])
    R["notavta"] = C_data
    C = C_data["sum_SALDO"]
    print(f"    C (NOTAVTA.SALDO) = {C:,.2f}")

    R["facturas"] = docsum("FACTURAS.dbf",
                           {"CLIENTE", "CONDICION", "TOTAL", "SALDO",
                            "FCANCELADA", "STATUS"}, [("CONDICION",), ("SERIE",)])
    R["notasdbt"] = docsum("NOTASDBT.dbf",
                           {"CLIENTE", "CONDICION", "TOTAL", "SALDO",
                            "FCANCELADA", "STATUS"}, [("CONDICION",)])
    R["notacred"] = docsum("NOTACRED.dbf",
                           {"CLIENTE", "TIPO", "TOTAL", "FCANCELADA", "STATUS"},
                           [("TIPO",)])
    R["notadev"] = docsum("NOTADEV.dbf",
                          {"CLIENTE", "TIPO", "TOTAL", "FCANCELADA", "STATUS"},
                          [("TIPO",)])
    R["tickets"] = docsum("TICKETS.dbf",
                          {"TOTAL", "STATUS"}, [])
    print(f"    FACTURAS SALDO = {R['facturas']['sum_SALDO']:,.2f}"
          f"  NOTASDBT SALDO = {R['notasdbt']['sum_SALDO']:,.2f}")

    # ------------------------------------------------------------------ #
    # 4) CUENXCOB: movimientos                                            #
    # ------------------------------------------------------------------ #
    print("[4/9] CUENXCOB ...", flush=True)
    movto = defaultdict(lambda: [0, 0.0, 0.0])   # MOVTO -> n, MONTO, SALDO
    concepto = defaultdict(lambda: [0, 0.0])
    mov_cli = defaultdict(lambda: defaultdict(float))
    n_cuen = 0
    for r in recs("CUENXCOB.dbf", only={"MOVTO", "CONCEPTO", "MONTO", "SALDO",
                                        "CLIENTE", "TIPO", "SERIE", "FOLIO"}):
        n_cuen += 1
        m = (r.get("MOVTO") or "").strip()
        movto[m][0] += 1
        movto[m][1] += fnum(r.get("MONTO"))
        movto[m][2] += fnum(r.get("SALDO"))
        c = (r.get("CONCEPTO") or "").strip()
        concepto[c][0] += 1
        concepto[c][1] += fnum(r.get("MONTO"))
        mov_cli[(r.get("CLIENTE") or "").strip()][m] += fnum(r.get("MONTO"))
    D_saldo = money(sum(v[2] for v in movto.values()))
    R["cuenxcob"] = {
        "n": n_cuen, "D_sum_SALDO": D_saldo,
        "por_movto": {k: {"n": v[0], "monto": money(v[1]), "saldo": money(v[2])}
                      for k, v in sorted(movto.items())},
        "por_concepto": {k: {"n": v[0], "monto": money(v[1])}
                         for k, v in sorted(concepto.items(),
                                            key=lambda kv: -kv[1][1])[:40]},
    }
    print(f"    CUENXCOB movimientos = {n_cuen}  SALDO = {D_saldo:,.2f}")

    # ------------------------------------------------------------------ #
    # 5) CAJAPAGO y RELDOCTOS                                             #
    # ------------------------------------------------------------------ #
    print("[5/9] CAJAPAGO / RELDOCTOS ...", flush=True)
    cp = defaultdict(lambda: [0, 0.0])
    n_cp = 0
    for r in recs("CAJAPAGO.dbf", only={"TIPODOC", "CONCEPTO", "TOTAL", "MONTO",
                                        "STATUS", "CIERRE"}):
        n_cp += 1
        k = ((r.get("TIPODOC") or "").strip(), (r.get("CONCEPTO") or "").strip())
        cp[k][0] += 1
        cp[k][1] += fnum(r.get("TOTAL")) or fnum(r.get("MONTO"))
    R["cajapago"] = {"n": n_cp,
                     "por_tipodoc_concepto": {f"{a}|{b}": {"n": v[0],
                                                           "total": money(v[1])}
                                              for (a, b), v in
                                              sorted(cp.items(), key=lambda kv: -kv[1][1])[:40]}}
    print(f"    CAJAPAGO = {n_cp} movimientos")

    rel = defaultdict(lambda: [0, 0.0])
    n_rel = 0
    for r in recs("RELDOCTOS.dbf", only={"TIPO", "APLITIPO", "TOTAL", "STATUS"}):
        n_rel += 1
        k = ((r.get("TIPO") or "").strip(), (r.get("APLITIPO") or "").strip())
        rel[k][0] += 1
        rel[k][1] += fnum(r.get("TOTAL"))
    R["reldoctos"] = {"n": n_rel,
                      "por_tipo_aplitipo": {f"{a}-> {b}": {"n": v[0],
                                                           "total": money(v[1])}
                                            for (a, b), v in sorted(rel.items())}}
    print(f"    RELDOCTOS = {n_rel}")

    # ------------------------------------------------------------------ #
    # 6) RECONSTRUCCIÓN por cliente (CUENXCOB)                            #
    # ------------------------------------------------------------------ #
    print("[6/9] Reconstrucción por cliente ...", flush=True)
    # Semántica de MOVTO se valida abajo contra CXCDOCS/NOTAVTA (evidencia).
    cli_recon = {}
    for cli, mv in mov_cli.items():
        cargos = mv.get("C", 0.0)
        abonos = mv.get("A", 0.0)
        otros = {k: v for k, v in mv.items() if k not in ("C", "A")}
        recon = money(cargos - abonos + sum(otros.values()))
        cli_recon[cli] = {"cargos": money(cargos), "abonos": money(abonos),
                          "otros": {k: money(v) for k, v in otros.items()},
                          "reconstruido": recon}
    F = money(sum(v["reconstruido"] for v in cli_recon.values()))

    # Validación de semántica: cargos C deben ≈ SUM(CXCDOCS.TOTAL) (+ facturas crédito)
    R["validacion_semantica"] = {
        "sum_cargos_C": money(sum(v["cargos"] for v in cli_recon.values())),
        "sum_abonos_A": money(sum(v["abonos"] for v in cli_recon.values())),
        "otros_movtos": {k: money(sum(v["otros"].get(k, 0.0)
                                      for v in cli_recon.values()))
                         for k in ("D", "N", "X") if
                         any("otros" in v and k in v["otros"]
                             for v in cli_recon.values())},
    }

    # ------------------------------------------------------------------ #
    # 7) CSV por cliente: SALDOS vs reconstruido                          #
    # ------------------------------------------------------------------ #
    print("[7/9] CSV por cliente ...", flush=True)
    rows = []
    n_match = n_diff = 0
    tot_diff = 0.0
    for cli, c in clientes.items():
        rc = cli_recon.get(cli, {"cargos": 0.0, "abonos": 0.0, "otros": {},
                                 "reconstruido": 0.0})
        diff = money(c["saldo"] - rc["reconstruido"])
        if abs(diff) < 0.02:
            n_match += 1
        else:
            n_diff += 1
            tot_diff += diff
        rows.append({"cliente": cli, "nombre": c["nombre"][:60],
                     "status": c["status"],
                     "saldo_clientes": money(c["saldo"]),
                     "cargos": rc["cargos"], "abonos": rc["abonos"],
                     "otros": json.dumps(rc["otros"], ensure_ascii=False),
                     "saldo_reconstruido": rc["reconstruido"],
                     "diferencia": diff})
    # clientes recon con saldo pero sin ficha activa
    for cli, rc in cli_recon.items():
        if cli not in clientes:
            rows.append({"cliente": cli, "nombre": "(sin ficha activa)",
                         "status": "N/A", "saldo_clientes": 0.0,
                         "cargos": rc["cargos"], "abonos": rc["abonos"],
                         "otros": json.dumps(rc["otros"], ensure_ascii=False),
                         "saldo_reconstruido": rc["reconstruido"],
                         "diferencia": money(-rc["reconstruido"])})
    rows.sort(key=lambda r: -abs(r["diferencia"]))
    with (OUT / "client_reconciliation.csv").open("w", newline="",
                                                  encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    R["reconstruccion"] = {
        "F_saldo_reconstruido": F,
        "clientes_match": n_match, "clientes_con_diferencia": n_diff,
        "suma_diferencias": money(tot_diff),
        "F_vs_A": money(A - F),
    }
    print(f"    F = {F:,.2f}   A-F = {A - F:,.2f}")

    # ------------------------------------------------------------------ #
    # 8) Desglose de la brecha                                            #
    # ------------------------------------------------------------------ #
    # ¿CLIENTES.SALDO explica lo que CUENXCOB no? Comparar clientes con diff.
    top_diff = rows[:500]
    with (OUT / "unexplained_balances_top.csv").open("w", newline="",
                                                     encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(top_diff[0].keys()))
        w.writeheader()
        w.writerows(top_diff)

    R["brecha"] = {
        "A_clientes": A, "B_cxcdocs_saldo": B, "C_notavta_saldo": C,
        "D_cuenxcob_saldo": D_saldo, "F_reconstruido": F,
        "facturas_saldo": R["facturas"]["sum_SALDO"],
        "facturas_cargos": R["facturas"]["sum_TOTAL"],
        "notasdbt_saldo": R["notasdbt"]["sum_SALDO"],
        "notacred_total": R["notacred"]["sum_TOTAL"],
        "notadev_total": R["notadev"]["sum_TOTAL"],
        "cargos_C_total": R["validacion_semantica"]["sum_cargos_C"],
        "abonos_A_total": R["validacion_semantica"]["sum_abonos_A"],
    }

    # ------------------------------------------------------------------ #
    # 9) Guardar                                                          #
    # ------------------------------------------------------------------ #
    (OUT / "forensic_summary.json").write_text(
        json.dumps(R, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8")
    print(f"\nOK -> {OUT}")
    for k, v in R["brecha"].items():
        print(f"  {k:24s} = {v:,.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
