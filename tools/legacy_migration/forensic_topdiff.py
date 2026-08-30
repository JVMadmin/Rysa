"""Distribuciones y top diferencias (solo lectura sobre CSVs ya generados)."""
import csv, json
from collections import Counter
from pathlib import Path

OUT = Path("/repo/legacy_reports/forensic")
rows = list(csv.DictReader((OUT / "client_reconciliation.csv").open(encoding="utf-8-sig")))
print(f"filas: {len(rows)}")

def f(x): 
    try: return float(x)
    except: return 0.0

match = [r for r in rows if abs(f(r["diferencia"])) < 0.02]
diff  = [r for r in rows if abs(f(r["diferencia"])) >= 0.02]
print(f"match exacto: {len(match)}  con diferencia: {len(diff)}")
print(f"suma diferencias: {sum(f(r['diferencia']) for r in diff):,.2f}")

# buckets de diferencia
b = Counter()
for r in diff:
    d = f(r["diferencia"])
    if abs(d) < 10: b["<10"] += 1
    elif abs(d) < 100: b["10-100"] += 1
    elif abs(d) < 1000: b["100-1k"] += 1
    elif abs(d) < 10000: b["1k-10k"] += 1
    elif abs(d) < 100000: b["10k-100k"] += 1
    else: b[">100k"] += 1
print("buckets:", dict(b))

print("\nTOP 25 diferencias:")
for r in diff[:25]:
    print(f"  {r['cliente']:>8} {r['nombre'][:38]:38} saldo={f(r['saldo_clientes']):>12,.2f} "
          f"recon={f(r['saldo_reconstruido']):>12,.2f} diff={f(r['diferencia']):>12,.2f} "
          f"otros={r['otros']}")

# clientes con saldo_clientes>0 pero recon=0 (sin movimientos en CUENXCOB)
sin_mov = [r for r in rows if f(r["saldo_clientes"]) > 0.02 and f(r["saldo_reconstruido"]) == 0]
print(f"\nclientes con SALDO en CLIENTES pero CERO movimientos CUENXCOB: {len(sin_mov)}")
print(f"  suma: {sum(f(r['saldo_clientes']) for r in sin_mov):,.2f}")
for r in sin_mov[:15]:
    print(f"  {r['cliente']:>8} {r['nombre'][:40]:40} saldo={f(r['saldo_clientes']):>12,.2f}")

# recon con saldo pero sin ficha
sin_ficha = [r for r in rows if r["status"] == "N/A" and abs(f(r["saldo_reconstruido"])) > 0.02]
print(f"\nmovimientos CUENXCOB de clientes SIN ficha activa: {len(sin_ficha)} "
      f"suma recon={sum(f(r['saldo_reconstruido']) for r in sin_ficha):,.2f}")
