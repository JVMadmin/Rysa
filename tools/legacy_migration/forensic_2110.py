"""¿2,110,892.76 = suma de saldos de una página/lista? (solo lectura)."""
import asyncio, os

import asyncpg

async def main():
    url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(url)
    rows = await conn.fetch(
        "SELECT doc->>'codigo' AS cod, (doc->>'saldo')::numeric AS saldo "
        "FROM clients ORDER BY doc->>'codigo'")
    target = 2110892.76
    cum = 0.0
    for i, r in enumerate(rows, 1):
        cum += float(r["saldo"] or 0)
        if abs(cum - target) < 0.02:
            print(f"EXACTO: suma de los primeros {i} clientes (orden codigo) = {cum:,.2f}")
            print(f"  cliente {i}: {r['cod']}")
            break
    # desc por saldo
    rows2 = await conn.fetch(
        "SELECT doc->>'codigo' AS cod, (doc->>'saldo')::numeric AS saldo "
        "FROM clients ORDER BY (doc->>'saldo')::numeric DESC")
    cum = 0.0
    for i, r in enumerate(rows2, 1):
        cum += float(r["saldo"] or 0)
        if abs(cum - target) < 0.02:
            print(f"EXACTO (desc saldo): primeros {i} = {cum:,.2f} (último {r['cod']})")
            break
    else:
        print(f"desc: acumulado tras {len(rows2)} = {cum:,.2f}")
    # suma de saldos excluyendo un solo cliente
    tot = sum(float(r["saldo"] or 0) for r in rows)
    for r in rows:
        if abs(tot - float(r["saldo"] or 0) - target) < 0.02:
            print(f"EXACTO: total menos cliente {r['cod']} (saldo {r['saldo']}) = {target:,.2f}")
    await conn.close()

asyncio.run(main())
