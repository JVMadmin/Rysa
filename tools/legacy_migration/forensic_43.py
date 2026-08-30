"""Desglose forense de los 43 clientes con diferencia (solo lectura)."""
import csv
from collections import defaultdict
from pathlib import Path

from tools.legacy_migration.config import resolve_legacy_data_path
from tools.legacy_migration.dbf_reader import iter_records

D = resolve_legacy_data_path()
OUT = Path("/repo/legacy_reports/forensic")

def f(v):
    try: return float(v)
    except: return 0.0

def s(v): return (v or "").strip()

rows = list(csv.DictReader((OUT/"client_reconciliation.csv").open(encoding="utf-8-sig")))
TARGETS = {r["cliente"] for r in rows if abs(f(r["diferencia"])) >= 0.02}
print(f"targets: {len(TARGETS)}")

# ---------- CUENXCOB por cliente ----------
C = defaultdict(float); A_ = defaultdict(float); A0 = defaultdict(int)
C_n = defaultdict(int); A_n = defaultdict(int)
cxcb_serie_folio = defaultdict(set)   # (serie,folio) de cargos
for r in iter_records(D/"CUENXCOB.dbf", only={"CLIENTE","MOVTO","TIPO","SERIE","FOLIO","MONTO","CONCEPTO"}):
    if r.get("_deleted"): continue
    cli = s(r.get("CLIENTE"))
    m = s(r.get("MOVTO")); monto = f(r.get("MONTO"))
    if m == "C":
        C[cli] += monto; C_n[cli] += 1
        cxcb_serie_folio[cli].add((s(r.get("SERIE")), s(r.get("FOLIO"))))
    elif m == "A":
        A_[cli] += monto; A_n[cli] += 1
        if monto == 0: A0[cli] += 1

# ---------- CXCDOCS por cliente (MONTO = cargo original) ----------
CX = defaultdict(float); CX_n = defaultdict(int); CXS = defaultdict(float)
for r in iter_records(D/"CXCDOCS.dbf", only={"CLIENTE","MONTO","SALDO","TIPO","SERIE","FOLIO"}):
    if r.get("_deleted"): continue
    cli = s(r.get("CLIENTE"))
    CX[cli] += f(r.get("MONTO")); CX_n[cli] += 1; CXS[cli] += f(r.get("SALDO"))

# ---------- NOTAVTA canceladas de los targets (cargos posiblemente inválidos) ----------
NV_CAN = defaultdict(float); NV_CAN_n = defaultdict(int)
NV_CRED = defaultdict(float)  # total de tickets crédito R no cancelados
for r in iter_records(D/"NOTAVTA.dbf", only={"CLIENTE","SERIE","FOLIO","TOTAL","CONDICION","FCANCELADA"}):
    if r.get("_deleted"): continue
    cli = s(r.get("CLIENTE"))
    if s(r.get("FCANCELADA")):
        if cli in TARGETS:
            NV_CAN[cli] += f(r.get("TOTAL")); NV_CAN_n[cli] += 1

# ---------- DOCCANCL (registro de cancelaciones) ----------
print("=== DOCCANCL por TIPO ===")
dc = defaultdict(int)
for r in iter_records(D/"DOCCANCL.dbf", only={"TIPO","SERIE","FOLIO"}):
    if r.get("_deleted"): continue
    dc[s(r.get("TIPO"))] += 1
print(dict(dc))
canceladas = set()
for r in iter_records(D/"DOCCANCL.dbf", only={"TIPO","SERIE","FOLIO"}):
    if r.get("_deleted"): continue
    canceladas.add((s(r.get("TIPO")), s(r.get("SERIE")), s(r.get("FOLIO"))))

# ---------- tabla comparativa ----------
print("\ncliente | saldoCLI | C-A(cuenx) | C(cargos) | A(abonos) | A0 | CXCDOCS.MONTO | CXCDOCS.SALDO | cancelNV | C-cancel |  diff_orig")
res = []
for r in rows:
    cli = r["cliente"]
    if cli not in TARGETS: continue
    saldo = f(r["saldo_clientes"]); recon = f(r["saldo_reconstruido"]); orig = f(r["diferencia"])
    c = C.get(cli,0); a = A_.get(cli,0); cx = CX.get(cli,0)
    cxc_canc = 0.0
    # cargos cuyo documento está en DOCCANCL (aprox por (n,serie,folio))
    for (ser, fol) in cxcb_serie_folio[cli]:
        if ("n", ser, fol) in canceladas:
            # necesita el monto del cargo; recalcula abajo
            pass
    print(f"{cli} | {saldo:>12,.2f} | {c-a:>12,.2f} | {c:>12,.2f} | {a:>12,.2f} | {A0.get(cli,0):3} | "
          f"{cx:>12,.2f} | {CXS.get(cli,0):>10,.2f} | canNV_n={NV_CAN_n.get(cli,0)} {NV_CAN.get(cli,0):>10,.2f} | diff={orig:>11,.2f}")
    res.append({"cliente": cli, "saldo": saldo, "c": c, "a": a, "cxa": c-a,
                "cxcdocs_monto": cx, "cxcdocs_saldo": CXS.get(cli,0), "diff": orig})

# total de A con MONTO=0 en todos los targets
print(f"\nA con MONTO=0 en targets: {sum(A0.get(c,0) for c in TARGETS)}")
# ¿C canceladas? suma de cargos de targets asociados a docs cancelados
tot_canc_cargo = 0.0; n_canc_cargo = 0
for r in iter_records(D/"CUENXCOB.dbf", only={"CLIENTE","MOVTO","TIPO","SERIE","FOLIO","MONTO"}):
    if r.get("_deleted"): continue
    cli = s(r.get("CLIENTE"))
    if cli not in TARGETS: continue
    if s(r.get("MOVTO")) == "C" and (s(r.get("TIPO")), s(r.get("SERIE")), s(r.get("FOLIO"))) in canceladas:
        tot_canc_cargo += f(r.get("MONTO")); n_canc_cargo += 1
print(f"cargos CUENXCOB de targets con doc EN DOCCANCL: n={n_canc_cargo} suma={tot_canc_cargo:,.2f}")
