"""¿Los A=0/CONCEPTO=51 corresponden a pagos en CAJAPAGO? (solo lectura)."""
from collections import defaultdict
from pathlib import Path

from tools.legacy_migration.config import resolve_legacy_data_path
from tools.legacy_migration.dbf_reader import iter_records

D = resolve_legacy_data_path()

def f(v):
    try: return float(v)
    except: return 0.0

def s(v): return (v or "").strip()

# --- CAJAPAGO: distribución TIPODOC x CONCEPTO ---
print("=== CAJAPAGO: TIPODOC x CONCEPTO ===")
tc = defaultdict(lambda: [0, 0.0])
for r in iter_records(D/"CAJAPAGO.dbf", only={"TIPODOC","CONCEPTO","TOTAL","MONTO","STATUS"}):
    if r.get("_deleted"): continue
    e = tc[(s(r.get("TIPODOC")), s(r.get("CONCEPTO")))]
    e[0] += 1; e[1] += f(r.get("TOTAL")) or f(r.get("MONTO"))
for k, e in sorted(tc.items(), key=lambda kv: -kv[1][1])[:25]:
    print(f"  TIPODOC={k[0]:6} CONCEPTO={k[1]:6} n={e[0]:6} MONTO={e[1]:>16,.2f}")

# --- índice CAJAPAGO por (serie, folio) ---
print("\n=== pagos CAJAPAGO de docs con A=0/51 ===")
pagos = defaultdict(lambda: [0, 0.0])
for r in iter_records(D/"CAJAPAGO.dbf", only={"TIPODOC","SERIE","FOLIO","TOTAL","MONTO","CONCEPTO","STATUS"}):
    if r.get("_deleted"): continue
    if s(r.get("STATUS")).upper() in ("C", "CANCELADO"): continue
    k = (s(r.get("SERIE")), s(r.get("FOLIO")))
    e = pagos[k]
    e[0] += 1; e[1] += f(r.get("TOTAL")) or f(r.get("MONTO"))

# movimientos A=0/51 en CUENXCOB -> doc (serie,folio)
a0_docs = []
for r in iter_records(D/"CUENXCOB.dbf", only={"CLIENTE","MOVTO","TIPO","SERIE","FOLIO","MONTO","CONCEPTO"}):
    if r.get("_deleted"): continue
    if s(r.get("MOVTO")) == "A" and s(r.get("CONCEPTO")) == "51" and f(r.get("MONTO")) == 0:
        a0_docs.append((s(r.get("CLIENTE")), s(r.get("SERIE")), s(r.get("FOLIO"))))
print(f"docs con A=0/51: {len(a0_docs)}")
encajapago = 0; suma = 0.0
for cli, ser, fol in a0_docs:
    p = pagos.get((ser, fol))
    if p and p[1] > 0:
        encajapago += 1; suma += p[1]
print(f"  con pago en CAJAPAGO: {encajapago}  suma pagos={suma:,.2f}")

# muestra
for cli, ser, fol in a0_docs[:8]:
    p = pagos.get((ser, fol))
    print(f"  cli={cli} doc={ser}-{fol} cajapago={p}")

# --- Reconstrucción alternativa: F2 = C - A - pagos_cajapago_de_A0 ---
print("\n=== Reconstrucción F2 = C - A(nozero) - pagos_caja_de_A0docs ===")
C = defaultdict(float); Anz = defaultdict(float); pay0 = defaultdict(float)
a0_set = {(cli, ser, fol) for cli, ser, fol in a0_docs}
for r in iter_records(D/"CUENXCOB.dbf", only={"CLIENTE","MOVTO","TIPO","SERIE","FOLIO","MONTO","CONCEPTO"}):
    if r.get("_deleted"): continue
    cli = s(r.get("CLIENTE")); monto = f(r.get("MONTO"))
    if s(r.get("MOVTO")) == "C":
        C[cli] += monto
    elif s(r.get("MOVTO")) == "A":
        if s(r.get("CONCEPTO")) == "51" and monto == 0:
            pass
        else:
            Anz[cli] += monto
for cli, ser, fol in a0_docs:
    p = pagos.get((ser, fol))
    if p and p[1] > 0:
        pay0[cli] += p[1]
F2 = {cli: C.get(cli,0) - Anz.get(cli,0) - pay0.get(cli,0) for cli in C}
print(f"F2 global = {sum(F2.values()):,.2f}  (F original = 3,147,481.00; A master = 2,547,638.50)")

# comparación por cliente contra master
saldo = {}
for r in iter_records(D/"CLIENTES.dbf", only={"CLAVE","SALDO"}):
    if r.get("_deleted"): continue
    saldo[s(r.get("CLAVE"))] = f(r.get("SALDO"))
m2 = sum(1 for cli, sv in saldo.items() if abs(sv - F2.get(cli, 0.0)) < 0.02)
m1 = sum(1 for cli, sv in saldo.items() if abs(sv - (C.get(cli,0) - Anz.get(cli,0) - sum(0 for _ in []))) < 0.02)
print(f"clientes que cuadran con F2: {m2} de {len(saldo)}")
diff2 = sum(sv - F2.get(cli, 0.0) for cli, sv in saldo.items())
print(f"suma diferencias (master - F2) = {diff2:,.2f}")
