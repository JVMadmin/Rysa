"""Semántica oficial (CONCEPTO), cargos sin doc, abonos por concepto (solo lectura)."""
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

# --- 1) CONCEPTO.dbf: catálogo oficial ---
print("=== CONCEPTO.dbf (catálogo de conceptos) ===")
for r in iter_records(D/"CONCEPTO.dbf", only={"TIPO","CLAVE","DESCRIP","MOVTO","AFECTA","STATUS"}):
    if r.get("_deleted"): continue
    t = s(r.get("TIPO"))
    if t.upper().startswith("CXC") or t.upper() in ("1","2"):
        print(f"  TIPO={t:6} CLAVE={s(r.get('CLAVE')):4} MOVTO={s(r.get('MOVTO')):2} "
              f"AFECTA={s(r.get('AFECTA')):8} DESCRIP={s(r.get('DESCRIP'))[:50]}")

print("\n--- todos los TIPO en CONCEPTO ---")
tipos = defaultdict(int)
for r in iter_records(D/"CONCEPTO.dbf", only={"TIPO"}):
    if r.get("_deleted"): continue
    tipos[s(r.get("TIPO"))] += 1
print(dict(tipos))

# --- 2) CUENXCOB: por CONCEPTO x MOVTO ---
print("\n=== CUENXCOB: MOVTO x CONCEPTO ===")
mc = defaultdict(lambda: [0, 0.0])
for r in iter_records(D/"CUENXCOB.dbf", only={"MOVTO","CONCEPTO","MONTO"}):
    if r.get("_deleted"): continue
    e = mc[(s(r.get("MOVTO")), s(r.get("CONCEPTO")))]
    e[0] += 1; e[1] += f(r.get("MONTO"))
for (m, c), e in sorted(mc.items(), key=lambda kv: -kv[1][1]):
    print(f"  MOVTO={m:2} CONCEPTO={c:4} n={e[0]:6} MONTO={e[1]:>16,.2f}")

# --- 3) Cargos C sin documento correspondiente en CXCDOCS ---
print("\n=== Cargos C en CUENXCOB sin doc en CXCDOCS ===")
cxcdocs_keys = set()
for r in iter_records(D/"CXCDOCS.dbf", only={"TIPO","SERIE","FOLIO"}):
    if r.get("_deleted"): continue
    cxcdocs_keys.add((s(r.get("TIPO")), s(r.get("SERIE")), s(r.get("FOLIO"))))
sin_doc = defaultdict(lambda: [0, 0.0]); con_doc = [0, 0.0]
for r in iter_records(D/"CUENXCOB.dbf", only={"MOVTO","TIPO","SERIE","FOLIO","MONTO","CONCEPTO"}):
    if r.get("_deleted"): continue
    if s(r.get("MOVTO")) != "C": continue
    k = (s(r.get("TIPO")), s(r.get("SERIE")), s(r.get("FOLIO")))
    if k in cxcdocs_keys:
        con_doc[0] += 1; con_doc[1] += f(r.get("MONTO"))
    else:
        e = sin_doc[(s(r.get("CONCEPTO")), k[0])]
        e[0] += 1; e[1] += f(r.get("MONTO"))
print(f"  con doc: n={con_doc[0]} monto={con_doc[1]:,.2f}")
print(f"  SIN doc: n={sum(e[0] for e in sin_doc.values())} monto={sum(e[1] for e in sin_doc.values()):,.2f}")
for k, e in sorted(sin_doc.items(), key=lambda kv: -kv[1][1])[:15]:
    print(f"    concepto={k[0]:4} tipodoc={k[1]!r:6} n={e[0]:5} monto={e[1]:>14,.2f}")

# --- 4) CXCDOCS docs sin cargo en CUENXCOB ---
print("\n=== CXCDOCS docs sin cargo en CUENXCOB ===")
cuenc = set()
for r in iter_records(D/"CUENXCOB.dbf", only={"MOVTO","TIPO","SERIE","FOLIO"}):
    if r.get("_deleted"): continue
    if s(r.get("MOVTO")) == "C":
        cuenc.add((s(r.get("TIPO")), s(r.get("SERIE")), s(r.get("FOLIO"))))
n_sin = 0; m_sin = 0.0; m_sal = 0.0
for r in iter_records(D/"CXCDOCS.dbf", only={"TIPO","SERIE","FOLIO","MONTO","SALDO"}):
    if r.get("_deleted"): continue
    k = (s(r.get("TIPO")), s(r.get("SERIE")), s(r.get("FOLIO")))
    if k not in cuenc:
        n_sin += 1; m_sin += f(r.get("MONTO")); m_sal += f(r.get("SALDO"))
print(f"  docs CXCDOCS sin cargo: n={n_sin} MONTO={m_sin:,.2f} SALDO={m_sal:,.2f}")

# --- 5) Abonos A: ¿referencian docs que existen? / pagos ---
print("\n=== Abonos A por presencia de TIPO ===")
aa = defaultdict(lambda: [0, 0.0])
for r in iter_records(D/"CUENXCOB.dbf", only={"MOVTO","TIPO","CONCEPTO","MONTO"}):
    if r.get("_deleted"): continue
    if s(r.get("MOVTO")) != "A": continue
    e = aa[(s(r.get("TIPO")) or "(vacio)", s(r.get("CONCEPTO")))]
    e[0] += 1; e[1] += f(r.get("MONTO"))
for k, e in sorted(aa.items(), key=lambda kv: -kv[1][1])[:20]:
    print(f"  TIPO={k[0]:8} CONCEPTO={k[1]:4} n={e[0]:6} MONTO={e[1]:>16,.2f}")
