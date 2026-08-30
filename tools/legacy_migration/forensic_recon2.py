"""¿CLIENTES.SALDO = SUM(CXCDOCS.SALDO) o = C-A? Comparación global (solo lectura)."""
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

saldo = {}
for r in iter_records(D/"CLIENTES.dbf", only={"CLAVE","SALDO"}):
    if r.get("_deleted"): continue
    saldo[s(r.get("CLAVE"))] = f(r.get("SALDO"))

CXS = defaultdict(float); CXN = defaultdict(int)
for r in iter_records(D/"CXCDOCS.dbf", only={"CLIENTE","SALDO"}):
    if r.get("_deleted"): continue
    cli = s(r.get("CLIENTE"))
    if f(r.get("SALDO")) != 0:
        CXS[cli] += f(r.get("SALDO")); CXN[cli] += 1

CA = defaultdict(float)
C = defaultdict(float); A = defaultdict(float)
for r in iter_records(D/"CUENXCOB.dbf", only={"CLIENTE","MOVTO","MONTO"}):
    if r.get("_deleted"): continue
    cli = s(r.get("CLIENTE")); m = s(r.get("MOVTO")); monto = f(r.get("MONTO"))
    if m == "C": C[cli] += monto
    elif m == "A": A[cli] += monto
    CA[cli] = C[cli] - A[cli]

n = len(saldo)
m_cxs = m_ca = m_both = m_none = 0
diff_cxs = 0.0; diff_ca = 0.0
tot_saldo = tot_cxs = tot_ca = 0.0
for cli, sv in saldo.items():
    cx = CXS.get(cli, 0.0); ca = CA.get(cli, 0.0)
    tot_saldo += sv; tot_cxs += cx; tot_ca += ca
    ok_cxs = abs(sv - cx) < 0.02
    ok_ca = abs(sv - ca) < 0.02
    if ok_cxs: m_cxs += 1
    if ok_ca: m_ca += 1
    if ok_cxs and ok_ca: m_both += 1
    if not ok_cxs and not ok_ca: m_none += 1
    diff_cxs += sv - cx
    diff_ca += sv - ca

print(f"clientes activos: {n}")
print(f"SUM(saldo)        = {tot_saldo:>15,.2f}")
print(f"SUM(CXCDOCS.SALDO de clientes) = {tot_cxs:>15,.2f}")
print(f"SUM(C-A)          = {tot_ca:>15,.2f}")
print(f"\nmatch saldo==CXS : {m_cxs}")
print(f"match saldo==C-A : {m_ca}")
print(f"match ambos      : {m_both}")
print(f"match ninguno    : {m_none}")
print(f"\nsaldo-CXS global = {diff_cxs:,.2f}")
print(f"saldo-(C-A) global = {diff_ca:,.2f}")

# clientes con saldo > suma docs (saldo no soportado por documentos)
over = [(cli, sv - CXS.get(cli,0.0)) for cli, sv in saldo.items()
        if sv - CXS.get(cli, 0.0) > 0.02]
print(f"\nclientes con saldo > docs abiertos: {len(over)}  suma={sum(d for _,d in over):,.2f}")
under = [(cli, sv - CXS.get(cli,0.0)) for cli, sv in saldo.items()
         if sv - CXS.get(cli, 0.0) < -0.02]
print(f"clientes con saldo < docs abiertos: {len(under)}  suma={sum(d for _,d in under):,.2f}")

# desglose B: docs por saldo
tot_docs = tot_cxs
print(f"\nB = SUM(CXCDOCS.SALDO todos) = {tot_docs:,.2f}")
