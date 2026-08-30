"""Auditoría de códigos de cliente legacy vs RYSA (solo lectura en ambos lados)."""
import csv
import os
from collections import defaultdict
from pathlib import Path

import asyncio

from tools.legacy_migration.config import resolve_legacy_data_path, resolve_reports_dir
from tools.legacy_migration.dbf_reader import iter_records

OUT = resolve_reports_dir() / "forensic"
D = resolve_legacy_data_path()

def f(v):
    try: return float(v)
    except: return 0.0

def s(v): return (v or "").strip()

def norm_code(x):
    x = s(x)
    return x.lstrip("0") or ("0" if x else "")

def norm_name(x):
    import unicodedata
    x = s(x).upper()
    x = "".join(c for c in unicodedata.normalize("NFD", x)
                if unicodedata.category(c) != "Mn")
    return " ".join(x.split())

# --- legacy ---
leg = {}
for r in iter_records(D/"CLIENTES.dbf", only={"CLAVE","NOMBRE","SALDO","STATUS"}):
    if r.get("_deleted"): continue
    leg[s(r.get("CLAVE"))] = {"nombre": norm_name(r.get("NOMBRE")),
                              "saldo": f(r.get("SALDO"))}

# --- RYSA (vía DATABASE_URL, asyncpg) ---
import asyncpg

async def get_rysa():
    url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(url)
    rows = await conn.fetch("SELECT doc->>'codigo' AS codigo, doc->>'nombre' AS nombre, "
                            "(doc->>'saldo')::numeric AS saldo FROM clients")
    await conn.close()
    return {s(r["codigo"]): {"nombre": norm_name(r["nombre"]),
                             "saldo": float(r["saldo"] or 0)} for r in rows}

rysa = asyncio.run(get_rysa())
print(f"legacy activos: {len(leg)}  rysa: {len(rysa)}")

rysa_norm = defaultdict(list)
for k in rysa:
    rysa_norm[norm_code(k)].append(k)

rows = []
cnt = defaultdict(int)
for clave, l in leg.items():
    nc = norm_code(clave)
    exact = clave in rysa
    norm = (not exact) and len(rysa_norm.get(nc, [])) > 0
    name_hit = None
    if not exact and not norm:
        hits = [k for k, v in rysa.items() if v["nombre"] == l["nombre"] and l["nombre"]]
        if len(hits) == 1:
            name_hit = hits[0]
    if exact:
        mtype, conf, rc = "EXACT_MATCH", "HIGH", clave
    elif norm:
        mtype, conf, rc = "NORMALIZED_MATCH", "HIGH", rysa_norm[nc][0]
    elif name_hit:
        mtype, conf, rc = "NAME_MATCH", "MEDIUM", name_hit
    else:
        mtype, conf, rc = "UNMATCHED", "NONE", ""
    cnt[mtype] += 1
    r = rysa.get(rc, {"nombre": "", "saldo": 0.0})
    rows.append({"legacy_codigo": clave, "legacy_nombre": l["nombre"][:60],
                 "legacy_saldo": l["saldo"],
                 "rysa_codigo": rc, "rysa_nombre": r["nombre"][:60],
                 "rysa_saldo": r["saldo"],
                 "match_type": mtype, "confidence": conf})

with (OUT / "client_code_reconciliation.csv").open("w", newline="", encoding="utf-8-sig") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)

print("match types:", dict(cnt))
unm = [r for r in rows if r["match_type"] == "UNMATCHED"]
print(f"\nUNMATCHED ({len(unm)}): suma saldo legacy = {sum(r['legacy_saldo'] for r in unm):,.2f}")
for r in unm[:20]:
    print(f"  {r['legacy_codigo']:8} {r['legacy_nombre'][:45]:45} saldo={r['legacy_saldo']:,.2f}")

# rysa sin origen legacy
rysa_keys = {r["rysa_codigo"] for r in rows if r["rysa_codigo"]}
extra = [k for k in rysa if k not in rysa_keys]
print(f"\ncodigos RYSA sin ficha legacy: {len(extra)}")
for k in extra[:10]:
    print(f"  {k} {rysa[k]['nombre'][:45]} saldo={rysa[k]['saldo']:,.2f}")
# diferencia de saldos en matched
diffs = [(r["legacy_codigo"], r["rysa_saldo"] - r["legacy_saldo"]) for r in rows
         if r["match_type"] != "UNMATCHED" and abs(r["rysa_saldo"] - r["legacy_saldo"]) > 0.02]
print(f"\nmatched con saldo distinto legacy vs rysa: {len(diffs)}  suma={sum(d for _, d in diffs):,.2f}")
for c, d in sorted(diffs, key=lambda x: -abs(x[1]))[:10]:
    print(f"  {c}: diff={d:,.2f}")
