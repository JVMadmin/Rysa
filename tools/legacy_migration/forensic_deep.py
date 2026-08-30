"""Profundización: semántica de campos y desglose de clientes con diferencia."""
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

# --- 1) NOTAVTA.SALDO: distribución por CONDICION ---
print("=== NOTAVTA.SALDO por CONDICION ===")
dist = defaultdict(lambda: [0, 0.0, 0, 0.0, 0, 0.0])  # cond: n,saldo_pos_n... 
cnt = defaultdict(lambda: [0, 0.0, 0.0])
for r in iter_records(D/"NOTAVTA.dbf", only={"CONDICION","TOTAL","SALDO","FCANCELADA","STATUS"}):
    if r.get("_deleted"): continue
    c = s(r.get("CONDICION")) or "(vacio)"
    sd = f(r.get("SALDO"))
    e = cnt[c]
    e[0] += 1; e[1] += f(r.get("TOTAL")); e[2] += sd
    if sd > 0: e[0] if False else None
for c, e in sorted(cnt.items()):
    print(f"  {c:12} n={e[0]:6} sumTOTAL={e[1]:>15,.2f} sumSALDO={e[2]:>15,.2f}")

# distribución de SALDO signo por condicion
print("\n=== NOTAVTA: distribución del signo de SALDO ===")
sg = defaultdict(lambda: [0,0,0])
for r in iter_records(D/"NOTAVTA.dbf", only={"CONDICION","SALDO"}):
    if r.get("_deleted"): continue
    c = s(r.get("CONDICION")) or "(vacio)"
    sd = f(r.get("SALDO"))
    sg[c][0 if sd > 0 else (1 if sd < 0 else 2)] += 1
for c, e in sorted(sg.items()):
    print(f"  {c:12} saldo>0: {e[0]:6}  saldo<0: {e[1]:6}  saldo=0: {e[2]:6}")

# --- 2) CXCDOCS: MONTO/TOTAL/SALDO por TIPO ---
print("\n=== CXCDOCS por TIPO: n, MONTO, TOTAL, SALDO ===")
cd = defaultdict(lambda: [0,0.0,0.0,0.0])
for r in iter_records(D/"CXCDOCS.dbf", only={"TIPO","MONTO","TOTAL","SALDO"}):
    if r.get("_deleted"): continue
    e = cd[s(r.get("TIPO")) or "(vacio)"]
    e[0]+=1; e[1]+=f(r.get("MONTO")); e[2]+=f(r.get("TOTAL")); e[3]+=f(r.get("SALDO"))
for t, e in sorted(cd.items()):
    print(f"  {t:6} n={e[0]:5} MONTO={e[1]:>15,.2f} TOTAL={e[2]:>15,.2f} SALDO={e[3]:>15,.2f}")

# --- 3) FACTURAS: por CONDICION ---
print("\n=== FACTURAS por CONDICION: n, TOTAL, SALDO ===")
fa = defaultdict(lambda: [0,0.0,0.0])
for r in iter_records(D/"FACTURAS.dbf", only={"CONDICION","TOTAL","SALDO","FCANCELADA"}):
    if r.get("_deleted"): continue
    if s(r.get("FCANCELADA")): continue
    e = fa[s(r.get("CONDICION")) or "(vacio)"]
    e[0]+=1; e[1]+=f(r.get("TOTAL")); e[2]+=f(r.get("SALDO"))
for t, e in sorted(fa.items()):
    print(f"  {t:12} n={e[0]:5} TOTAL={e[1]:>15,.2f} SALDO={e[2]:>15,.2f}")

# --- 4) Clientes con diferencia: desglose de movimientos CUENXCOB ---
print("\n=== Desglose de top clientes con diferencia ===")
TARGETS = {"00004", "00034", "00358", "00019", "00003", "00010", "00377", "00064"}
movs = defaultdict(lambda: defaultdict(lambda: [0, 0.0]))  # cli -> (movto,tipo) -> n, monto
for r in iter_records(D/"CUENXCOB.dbf", only={"CLIENTE","MOVTO","TIPO","MONTO","SALDO","SERIE","FOLIO","CONCEPTO"}):
    if r.get("_deleted"): continue
    cli = s(r.get("CLIENTE"))
    if cli not in TARGETS: continue
    k = (s(r.get("MOVTO")), s(r.get("TIPO")))
    e = movs[cli][k]
    e[0]+=1; e[1]+=f(r.get("MONTO"))
for cli in sorted(TARGETS):
    if cli not in movs: 
        print(f"  {cli}: sin movimientos"); continue
    print(f"  cliente {cli}:")
    for (m,t), e in sorted(movs[cli].items()):
        print(f"    MOVTO={m:3} TIPO={t:4} n={e[0]:4} MONTO={e[1]:>14,.2f}")

# --- 5) Documentos abiertos (SALDO>0) por tipo para un cliente ---
print("\n=== 00004: documentos con SALDO en CXCDOCS / NOTAVTA / FACTURAS ===")
for name, keyf, extra in (("CXCDOCS.dbf", "CLIENTE", ("TIPO","SERIE","FOLIO","TOTAL","MONTO")),
                          ("NOTAVTA.dbf", "CLIENTE", ("SERIE","FOLIO","TOTAL","CONDICION","FCANCELADA")),
                          ("FACTURAS.dbf", "CLIENTE", ("SERIE","FOLIO","TOTAL","CONDICION","FCANCELADA"))):
    tot = 0.0; n = 0
    for r in iter_records(D/name, only={keyf, "SALDO", *extra}):
        if r.get("_deleted"): continue
        if s(r.get(keyf)) != "00004": continue
        sd = f(r.get("SALDO"))
        if abs(sd) > 0.005:
            n += 1; tot += sd
            if n <= 8:
                print(f"    {name:14} {dict((k, r.get(k)) for k in extra)} SALDO={sd:,.2f}")
    print(f"    => {name}: docs con SALDO!=0: {n}  suma={tot:,.2f}")

# --- 6) CUENXCOB 00004: últimos movimientos por referencias ---
print("\n=== 00004: TODOS los movimientos CUENXCOB (para inspección) ===")
rows = []
for r in iter_records(D/"CUENXCOB.dbf", only={"CLIENTE","MOVTO","TIPO","SERIE","FOLIO","MONTO","SALDO","CONCEPTO","APLICA","FOLIOMOVTO"}):
    if r.get("_deleted"): continue
    if s(r.get("CLIENTE")) != "00004": continue
    rows.append(r)
print(f"  total movimientos 00004: {len(rows)}")
cargos = sum(f(r.get("MONTO")) for r in rows if s(r.get("MOVTO"))=="C")
abonos = sum(f(r.get("MONTO")) for r in rows if s(r.get("MOVTO"))=="A")
print(f"  cargos C={cargos:,.2f}  abonos A={abonos:,.2f}  C-A={cargos-abonos:,.2f}")
for r in rows[-12:]:
    print(f"    MOVTO={s(r.get('MOVTO')):2} TIPO={s(r.get('TIPO')):4} SERIE={s(r.get('SERIE')):4} "
          f"FOLIO={s(r.get('FOLIO')):8} MONTO={f(r.get('MONTO')):>12,.2f} SALDO={f(r.get('SALDO')):>12,.2f} "
          f"CONCEPTO={s(r.get('CONCEPTO')):12} APLICA={r.get('APLICA')}")
