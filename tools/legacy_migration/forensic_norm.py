"""Matching CAJAPAGO normalizando folios + distribución de docs marcados (solo lectura)."""
from collections import defaultdict
from pathlib import Path

from tools.legacy_migration.config import resolve_legacy_data_path
from tools.legacy_migration.dbf_reader import iter_records

D = resolve_legacy_data_path()

def f(v):
    try: return float(v)
    except: return 0.0

def s(v): return (v or "").strip()

def norm(x):
    x = s(x)
    return x.lstrip("0") or "0"

# CAJAPAGO: muestra de folios y formato
print("=== muestra CAJAPAGO (TIPODOC=n) ===")
n_shown = 0
pagos = defaultdict(list)
for r in iter_records(D/"CAJAPAGO.dbf", only={"TIPODOC","SERIE","FOLIO","TOTAL","MONTO","CONCEPTO","STATUS","FECHA","CLIENTE"}):
    if r.get("_deleted"): continue
    if s(r.get("STATUS")).upper() in ("C", "CANCELADO"): continue
    k = (norm(r.get("SERIE")), norm(r.get("FOLIO")))
    pagos[k].append(r)
    if n_shown < 6 and s(r.get("TIPODOC")) == "n":
        print(f"  {dict((k2, r.get(k2)) for k2 in ('TIPODOC','SERIE','FOLIO','TOTAL','MONTO','CONCEPTO','FECHA'))}")
        n_shown += 1

print(f"\ntotal pagos indexados: {sum(len(v) for v in pagos.values())}")

# movimientos CUENXCOB
movs = defaultdict(list)
for r in iter_records(D/"CUENXCOB.dbf",
                      only={"CLIENTE","MOVTO","TIPO","SERIE","FOLIO","MONTO","CONCEPTO","APLICA"}):
    if r.get("_deleted"): continue
    if s(r.get("MOVTO")) not in ("C", "A"): continue
    key = (norm(r.get("SERIE")), norm(r.get("FOLIO")))
    movs[key].append(r)

marked = [(k, lst) for k, lst in movs.items()
          if any(s(r.get("MOVTO")) == "A" and s(r.get("CONCEPTO")) == "51" and f(r.get("MONTO")) == 0
                 for r in lst)]
print(f"docs marcados A=0/51: {len(marked)}")

con_pago = 0; con_pago_monto = 0.0; sin_pago = 0; sin_pago_monto = 0.0
por_cliente = defaultdict(float)
for k, lst in marked:
    cargos = sum(f(r.get("MONTO")) for r in lst if s(r.get("MOVTO")) == "C")
    reales = sum(f(r.get("MONTO")) for r in lst
                 if s(r.get("MOVTO")) == "A" and f(r.get("MONTO")) > 0
                 and s(r.get("CONCEPTO")) != "51")
    if reales > 0:
        continue
    pg = pagos.get(k)
    cli = s(lst[0].get("CLIENTE"))
    if pg:
        pmonto = sum(f(p.get("TOTAL")) or f(p.get("MONTO")) for p in pg)
        con_pago += 1; con_pago_monto += cargos
        por_cliente[cli] += 0
    else:
        sin_pago += 1; sin_pago_monto += cargos
        por_cliente[cli] += cargos

print(f"\nmarcados SIN abono real: {sin_pago + con_pago}")
print(f"  con pago en CAJAPAGO (folio normalizado): n={con_pago} cargos={con_pago_monto:,.2f}")
print(f"  sin pago en CAJAPAGO:                     n={sin_pago} cargos={sin_pago_monto:,.2f}")
print("\nclientes con docs marcados sin pago (top 15):")
for cli, m in sorted(por_cliente.items(), key=lambda kv: -kv[1])[:15]:
    print(f"  {cli}: {m:,.2f}")
