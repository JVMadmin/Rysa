# One-off: rellena descripcion/nombre de partidas LEGACY con la descripción
# real del catálogo (products, importado de ARTICULO.DESCRIP) usando el
# codigo_legacy. Idempotente: solo toca partidas cuyo descripcion != nombre.
import asyncio
import json

from sqlalchemy import text

from pgstore.database import get_engine

CHUNK = 500


async def main():
    eng = get_engine()
    async with eng.connect() as conn:
        rows = (await conn.execute(text(
            "SELECT doc->>'codigo', doc->>'descripcion' FROM products "
            "WHERE doc->>'codigo' IS NOT NULL"))).fetchall()
    nombres = {r[0]: r[1] for r in rows if r[1]}
    print(f"catalogo: {len(nombres)} productos con codigo")

    ventas_fix = partidas_fix = 0
    offset = 0
    while True:
        async with eng.connect() as conn:
            rows = (await conn.execute(text(
                'SELECT "_id", doc FROM sales WHERE doc->>\'source\'=\'LEGACY\' '
                'ORDER BY "_id" LIMIT :l OFFSET :o'),
                {"l": CHUNK, "o": offset})).fetchall()
        if not rows:
            break
        offset += len(rows)
        for rid, doc in rows:
            items = doc.get("items") or []
            changed = False
            for it in items:
                cod = it.get("codigo_legacy") or ""
                nom = nombres.get(cod)
                if nom and it.get("descripcion") != nom:
                    it["descripcion"] = nom
                    it["nombre"] = nom
                    changed = True
                    partidas_fix += 1
            if changed:
                async with eng.begin() as conn:
                    await conn.execute(text(
                        'UPDATE sales SET doc = CAST(:d AS jsonb) WHERE "_id" = CAST(:k AS text)'),
                        {"d": json.dumps(doc, ensure_ascii=False, default=str), "k": rid})
                ventas_fix += 1
        print(f"progreso: {offset} ventas revisadas...")
    print(f"LISTO: {ventas_fix} ventas actualizadas, {partidas_fix} partidas renombradas")


asyncio.run(main())
