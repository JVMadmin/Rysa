#!/usr/bin/env python3
"""Sincroniza los precios del ERP con ARTICULO.dbf del sistema anterior.

Solo toca precios: Precio 1..5 (sin y con IVA), tasa de IVA y precio mínimo
de cada producto (por código), y el precio de su presentación base. No cambia
costo, existencia, descripción, imágenes ni ventas. Los artículos del legacy
que no existen en el ERP (activos) se crean con sus datos básicos y precios.

PRECIO1..5 del legacy son SIN IVA (ver tools/legacy_migration/precios_legacy.py).

Modos (dentro del contenedor backend):
    python -m scripts.sincronizar_precios_legacy                 # simulación
    python -m scripts.sincronizar_precios_legacy --aplicar       # guarda snapshot y aplica
    python -m scripts.sincronizar_precios_legacy --verificar     # compara lo que cobra el ERP contra el legacy
    python -m scripts.sincronizar_precios_legacy --revertir PRECIOS-AAAAMMDDhhmmss

Por defecto lee LEGACY_DATA_PATH / legacy_data (lo que se despliega desde el
panel Legacy); --dir cambia la carpeta.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

_ROOT = str(Path(__file__).resolve().parent.parent)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

_CAMPOS = ("precios", "precio_sin_iva", "precio_con_iva", "iva_tasa", "precio_minimo",
           "precio_incluye_iva", "utilidad", "margen")


def _leer_legacy(carpeta: Path) -> dict:
    from tools.legacy_migration.dbf_reader import iter_records
    out = {}
    for r in iter_records(carpeta / "ARTICULO.dbf"):
        cod = str(r.get("CODIGO") or "").strip()
        if cod and not r.get("_deleted"):
            out[cod] = r
    return out


def _iguales(a, b) -> bool:
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


async def simular_o_aplicar(carpeta: Path, aplicar: bool) -> None:
    from sqlalchemy import text
    from pgstore.database import transaction
    from tools.legacy_migration.precios_legacy import precios_legacy

    legacy = _leer_legacy(carpeta)
    batch = f"PRECIOS-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    act = igual = creados = 0
    async with transaction() as conn:
        filas = (await conn.execute(text("SELECT id, doc FROM products"))).fetchall()
        por_codigo = {}
        for pid, doc in filas:
            por_codigo.setdefault(str((doc or {}).get("codigo") or "").strip(), []).append((pid, dict(doc or {})))
        if aplicar:
            await conn.execute(text("INSERT INTO import_batches (batch_id, tipo, estado, usuario_nombre, created_at) "
                                    "VALUES (:b, 'PRECIOS_LEGACY', 'APPLYING', 'sincronizar_precios_legacy', now())"), {"b": batch})
        for cod, rec in legacy.items():
            pl = precios_legacy(rec)
            existentes = por_codigo.get(cod, [])
            for pid, doc in existentes:
                if all(_iguales(doc.get(k), pl[k]) for k in _CAMPOS):
                    igual += 1
                    continue
                act += 1
                if not aplicar:
                    continue
                await conn.execute(text("INSERT INTO import_snapshots (id, batch_id, tabla, registro_id, estado_previo, created_at) "
                                        "VALUES (:i, :b, 'products', :r, CAST(:d AS jsonb), now())"),
                                   {"i": "snap_" + uuid.uuid4().hex, "b": batch, "r": pid, "d": json.dumps(doc, default=str)})
                doc.update(pl)
                doc["updated_at"] = datetime.now(timezone.utc).isoformat()
                await conn.execute(text("UPDATE products SET doc = CAST(:d AS jsonb), precio_con_iva = :c, precio_sin_iva = :s WHERE id = :i"),
                                   {"d": json.dumps(doc, ensure_ascii=False, default=str), "c": pl["precio_con_iva"],
                                    "s": pl["precio_sin_iva"], "i": pid})
                await conn.execute(text("UPDATE product_presentations SET precio = :p, updated_at = now() "
                                        "WHERE product_id = :i AND es_base = TRUE"), {"p": pl["precio_sin_iva"], "i": pid})
            if not existentes and str(rec.get("STATUS") or "A").strip().upper() == "A" and pl["precio_sin_iva"] > 0:
                creados += 1
                if not aplicar:
                    continue
                pid = uuid.uuid4().hex
                um = str(rec.get("UNIMEDIDA") or "").strip() or "PZA"
                costo = round(float(rec.get("COSTO") or 0), 4)
                ahora = datetime.now(timezone.utc).isoformat()
                doc = {"id": pid, "_id": pid, "codigo": cod, "sku": cod, "codigos_barras": [cod],
                       "descripcion": str(rec.get("DESCRIP") or "").strip(),
                       "descripcion_larga": str(rec.get("DESCRIPLRG") or "").strip(),
                       "linea": str(rec.get("LINEA") or "").strip(), "unidad_medida": um, "costo": costo,
                       "existencia": round(float(rec.get("EXISTENCIA") or 0), 3),
                       "stock_minimo": round(float(rec.get("STOCKMIN") or 0), 3), "estado": "activo",
                       "vendidas": 0.0, "source": "LEGACY", "created_at": ahora, "updated_at": ahora, **pl}
                await conn.execute(text('INSERT INTO products ("_id", "id", "doc", "created_at", "costo", "existencia", '
                                        '"stock_minimo", "vendidas", "precio_sin_iva", "precio_con_iva") '
                                        "VALUES (:i, :i, CAST(:d AS jsonb), now(), :c, :e, :m, 0.0, :s, :p)"),
                                   {"i": pid, "d": json.dumps(doc, ensure_ascii=False, default=str), "c": costo,
                                    "e": doc["existencia"], "m": doc["stock_minimo"], "s": pl["precio_sin_iva"], "p": pl["precio_con_iva"]})
                await conn.execute(text("INSERT INTO product_presentations (id, product_id, nombre, factor, precio, costo, "
                                        "es_base, es_predeterminada, activo, created_at, updated_at) "
                                        "VALUES (:pr, :i, :n, 1.0, :p, :c, TRUE, TRUE, TRUE, now(), now()) "
                                        "ON CONFLICT (product_id, nombre) DO NOTHING"),
                                   {"pr": f"pres_{pid}", "i": pid, "n": um, "p": pl["precio_sin_iva"], "c": costo})
                await conn.execute(text("INSERT INTO import_snapshots (id, batch_id, tabla, registro_id, estado_previo, created_at) "
                                        "VALUES (:i, :b, 'products_creado', :r, CAST('{"creado": true}' AS jsonb), now())"),
                                   {"i": "snap_" + uuid.uuid4().hex, "b": batch, "r": pid})
        sin_legacy = sum(len(v) for k, v in por_codigo.items() if k and k not in legacy)
        stats = {"legacy": len(legacy), "actualizados": act, "ya_iguales": igual, "creados": creados,
                 "en_erp_sin_legacy": sin_legacy}
        if aplicar:
            await conn.execute(text("UPDATE import_batches SET estado = 'COMPLETED', estadisticas = CAST(:s AS jsonb), "
                                    "applied_at = now() WHERE batch_id = :b"), {"s": json.dumps(stats), "b": batch})
    print(("APLICADO " + batch) if aplicar else "SIMULACIÓN", json.dumps(stats, ensure_ascii=False))


async def verificar(carpeta: Path) -> None:
    """Compara, lista por lista, lo que cobra el ERP (moneycalc, la misma regla
    del POS, catálogo, sitio, checador, app y agente) contra el legacy."""
    import moneycalc
    from deps import db
    from tools.legacy_migration.precios_legacy import precios_legacy

    legacy = _leer_legacy(carpeta)
    cfg = await db.settings.find_one({"_id": "app"}) or {}
    pct, modo = cfg.get("listas_precios_pct") or None, cfg.get("redondeo_precios") or "arriba_peso"
    prods = await db.products.find({}, {"_id": 0}).to_list(100000)
    revisados, variaciones, ejemplos = 0, 0, []
    for p in prods:
        rec = legacy.get(str(p.get("codigo") or "").strip())
        if not rec:
            continue
        revisados += 1
        esperado = precios_legacy(rec)
        listas = moneycalc.precios_lista(p, pct, modo)
        ultimo = None
        for i, l in enumerate(listas):
            e = esperado["precios"][i] if i < 5 else {"precio_con_iva": 0}
            if e["precio_con_iva"] > 0:
                ultimo = e
            objetivo = (e if e["precio_con_iva"] > 0 else ultimo) or {"precio_con_iva": 0, "precio_sin_iva": 0}
            if abs(l["precio_con_iva"] - objetivo["precio_con_iva"]) > 0.001 or abs(l["precio"] - round(objetivo["precio_sin_iva"], 6)) > 0.0000005:
                variaciones += 1
                if len(ejemplos) < 10:
                    ejemplos.append(f"{p.get('codigo')} P{i + 1}: ERP {l['precio_con_iva']} / legacy {objetivo['precio_con_iva']}")
    print(json.dumps({"revisados": revisados, "listas_con_variacion": variaciones, "ejemplos": ejemplos}, ensure_ascii=False))


async def revertir(batch: str) -> None:
    from sqlalchemy import text
    from pgstore.database import transaction
    async with transaction() as conn:
        filas = (await conn.execute(text("SELECT tabla, registro_id, estado_previo FROM import_snapshots WHERE batch_id = :b"),
                                    {"b": batch})).fetchall()
        for tabla, rid, previo in filas:
            if tabla == "products" and previo:
                p = dict(previo)
                await conn.execute(text("UPDATE products SET doc = CAST(:d AS jsonb), precio_con_iva = :c, precio_sin_iva = :s WHERE id = :i"),
                                   {"d": json.dumps(p, default=str), "c": float(p.get("precio_con_iva") or 0),
                                    "s": float(p.get("precio_sin_iva") or 0), "i": rid})
            elif tabla == "products_creado":
                await conn.execute(text("DELETE FROM product_presentations WHERE product_id = :i"), {"i": rid})
                await conn.execute(text("DELETE FROM products WHERE id = :i"), {"i": rid})
        await conn.execute(text("UPDATE import_batches SET estado = 'ROLLED_BACK' WHERE batch_id = :b"), {"b": batch})
    print("REVERTIDO", batch, len(filas), "registros")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", help="carpeta con ARTICULO.dbf (por defecto la del panel Legacy)")
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--verificar", action="store_true")
    ap.add_argument("--revertir", metavar="BATCH")
    a = ap.parse_args()
    if a.revertir:
        asyncio.run(revertir(a.revertir))
        return 0
    import tools.legacy_migration.config as leg_cfg
    carpeta = Path(a.dir) if a.dir else leg_cfg.resolve_legacy_data_path()
    if not (carpeta / "ARTICULO.dbf").is_file():
        print(f"No se encontró ARTICULO.dbf en {carpeta}")
        return 1
    asyncio.run(verificar(carpeta) if a.verificar else simular_o_aplicar(carpeta, a.aplicar))
    return 0


if __name__ == "__main__":
    sys.exit(main())
