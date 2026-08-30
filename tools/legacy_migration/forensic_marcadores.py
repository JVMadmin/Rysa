"""H1: A=0/51 = marcador de doc liquidado. ¿Tiene abono real el mismo doc? (solo lectura)."""
from collections import defaultdict
from pathlib import Path

from tools.legacy_migration.config import resolve_legacy_data_path
from tools.legacy_migration.dbf_reader import iter_records

D = resolve_legacy_data_path()

def f(v):
    try: return float(v)
    except: return 0.0

def s(v): return (v or "").strip()

# índice: doc -> lista de movimientos
movs = defaultdict(list)
for r in iter_records(D/"CUENXCOB.dbf",
                      only={"CLIENTE","MOVTO","TIPO","SERIE","FOLIO","MONTO","CONCEPTO","APLICA"}):
    if r.get("_deleted"): continue
    if s(r.get("MOVTO")) not in ("C", "A"): continue
    key = (s(r.get("SERIE")), s(r.get("FOLIO")))
    movs[key].append(r)

paired_total = 0.0; paired_n = 0
paired_with_real = 0; paired_with_real_monto = 0.0
paired_sin_real = 0; paired_sin_real_monto = 0.0
for key, lst in movs.items():
    cargos = [r for r in lst if s(r.get("MOVTO")) == "C"]
    marcadores = [r for r in lst if s(r.get("MOVTO")) == "A" and s(r.get("CONCEPTO")) == "51" and f(r.get("MONTO")) == 0]
    reales = [r for r in lst if s(r.get("MOVTO")) == "A" and f(r.get("MONTO")) > 0]
    if not cargos or not marcadores:
        continue
    for m in marcadores:
        csum = sum(f(r.get("MONTO")) for r in cargos)
        paired_total += csum; paired_n += 1
        if reales:
            paired_with_real += 1
            paired_with_real_monto += sum(f(r.get("MONTO")) for r in reales)
        else:
            paired_sin_real += 1
            paired_sin_real_monto += csum

print(f"docs con cargo + marcador A=0/51: {paired_n}")
print(f"  suma cargos emparejados: {paired_total:,.2f}")
print(f"  con abono REAL mismo doc: n={paired_with_real}  abonos={paired_with_real_monto:,.2f}")
print(f"  SIN abono real:           n={paired_sin_real}  cargos={paired_sin_real_monto:,.2f}")

# global: F3 = C - A_reales - cargos_de_docs_marcados_sin_abono
C = defaultdict(float); Ar = defaultdict(float); mark = defaultdict(float)
for key, lst in movs.items():
    has_marker = any(s(r.get("MOVTO")) == "A" and s(r.get("CONCEPTO")) == "51"
                     and f(r.get("MONTO")) == 0 for r in lst)
    reales = sum(f(r.get("MONTO")) for r in lst
                 if s(r.get("MOVTO")) == "A" and f(r.get("MONTO")) > 0)
    csum = sum(f(r.get("MONTO")) for r in lst if s(r.get("MOVTO")) == "C")
    cli = s(lst[0].get("CLIENTE"))
    C[cli] += csum
    Ar[cli] += reales
    if has_marker and not reales:
        mark[cli] += csum

saldo = {}
for r in iter_records(D/"CLIENTES.dbf", only={"CLAVE","SALDO"}):
    if r.get("_deleted"): continue
    saldo[s(r.get("CLAVE"))] = f(r.get("SALDO"))

F3 = {cli: C.get(cli,0) - Ar.get(cli,0) - mark.get(cli,0) for cli in C}
tot = sum(F3.values())
m3 = sum(1 for cli, sv in saldo.items() if abs(sv - F3.get(cli, 0.0)) < 0.02)
print(f"\nF3 global = {tot:,.2f}  (master = 2,547,638.50)")
print(f"clientes que cuadran con F3: {m3} de {len(saldo)}")
print(f"suma marcadores sin abono (mark) = {sum(mark.values()):,.2f}")
diff3 = sum(sv - F3.get(cli, 0.0) for cli, sv in saldo.items())
print(f"master - F3 = {diff3:,.2f}")
