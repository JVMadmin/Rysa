#!/usr/bin/env python3
"""Importa fotos REALES de producto revisadas (p. ej. de Open Food Facts) al ERP.

Entrada: CSV con columnas product_id, imagen y (opcional) fuente_url, licencia,
nombre_off. Solo se procesan las filas del CSV: la revisión humana ocurre antes
(se marcan o eliminan las filas dudosas).

Por cada fila:
  1. Descarga la imagen (solo https), valida que sea imagen real y la
     convierte a WebP (máx. 1000 px).
  2. La guarda en el almacenamiento local (uploads/productos/<id>.webp) y la
     registra en `files`.
  3. Actualiza el producto: imagen_url + imagen_fuente {origen, licencia, url}
     para la atribución que exige la licencia.

Opcional --limpiar-genericas: vacía imagen_url de los productos cuya foto es la
genérica de images.unsplash.com que asignó catalog_images.py (no muestran el
producto).

Por defecto es SIMULACIÓN (no escribe nada). Usa --aplicar para escribir.

Uso (dentro del contenedor backend):
    python -m scripts.importar_fotos --csv /tmp/fotos.csv
    python -m scripts.importar_fotos --csv /tmp/fotos.csv --aplicar
    python -m scripts.importar_fotos --limpiar-genericas --aplicar
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import io
import sys
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

_ROOT = str(Path(__file__).resolve().parent.parent)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

UA = "GrupoRYSA-ERP/1.0 (contacto@gruporysa.com)"
MAX_BYTES = 8 * 1024 * 1024


def _descargar(url: str) -> bytes:
    if not url.startswith("https://"):
        raise ValueError("solo se aceptan URLs https")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("imagen demasiado grande")
    return data


def _encuadrar(im):
    """Recorta el fondo liso (el color de la esquina), centra el producto y lo
    deja cuadrado con margen. Hay catálogos (REYMA) con el producto chico en
    una esquina de un lienzo blanco: en la ficha solo se veía blanco."""
    from PIL import Image, ImageChops
    fondo = im.getpixel((0, 0))
    mascara = ImageChops.difference(im, Image.new("RGB", im.size, fondo)).convert("L").point(lambda v: 255 if v > 18 else 0)
    caja = mascara.getbbox()
    if caja:
        im = im.crop(caja)
    lado = int(max(im.size) * 1.18)
    lienzo = Image.new("RGB", (lado, lado), fondo)
    lienzo.paste(im, ((lado - im.width) // 2, (lado - im.height) // 2))
    return lienzo


def _a_webp(data: bytes) -> bytes:
    from PIL import Image
    im = Image.open(io.BytesIO(data))
    im.verify()  # descarta archivos que no son imagen
    im = Image.open(io.BytesIO(data))
    if im.mode in ("RGBA", "LA", "P"):
        # Transparencia sobre blanco (convert("RGB") la volvía negra).
        im = im.convert("RGBA")
        blanco = Image.new("RGBA", im.size, (255, 255, 255, 255))
        blanco.alpha_composite(im)
        im = blanco
    im = _encuadrar(im.convert("RGB"))
    im.thumbnail((1000, 1000))
    out = io.BytesIO()
    im.save(out, "WEBP", quality=82, method=6)
    return out.getvalue()


async def importar(csv_path: str, aplicar: bool) -> None:
    import storage
    from deps import db

    filas = list(csv.DictReader(open(csv_path, encoding="utf-8-sig")))
    ok = err = 0
    for f in filas:
        pid = (f.get("product_id") or "").strip()
        url = (f.get("imagen") or "").strip()
        if not pid or not url:
            continue
        prod = await db.products.find_one({"id": pid}, {"_id": 0, "id": 1, "descripcion": 1})
        if not prod:
            print(f"  ✗ {pid}: producto no existe"); err += 1
            continue
        try:
            webp = _a_webp(_descargar(url))
        except Exception as e:
            print(f"  ✗ {prod['descripcion'][:50]}: {e}"); err += 1
            continue
        fuente = {
            "origen": f.get("origen") or "Open Food Facts",
            "licencia": f.get("licencia") or "CC BY-SA 3.0",
            "url": f.get("fuente_url") or url,
            "importada": datetime.now(timezone.utc).isoformat(),
        }
        print(f"  ✓ {prod['descripcion'][:50]} ({len(webp)//1024} KB)")
        ok += 1
        if not aplicar:
            continue
        path = f"uploads/productos/{pid}.webp"
        storage.put_object(path, webp, "image/webp")
        if not await db.files.find_one({"storage_path": path}):
            await db.files.insert_one({"id": uuid.uuid4().hex, "storage_path": path,
                                       "original_filename": f"{pid}.webp", "content_type": "image/webp",
                                       "size": len(webp), "is_deleted": False,
                                       "created_at": datetime.now(timezone.utc).isoformat()})
        await db.products.update_one({"id": pid}, {"$set": {
            "imagen_url": f"/api/files/{path}", "imagen_fuente": fuente,
            "imagen_actualizada": fuente["importada"]}})
    print(f"{'APLICADO' if aplicar else 'SIMULACIÓN'}: {ok} fotos válidas, {err} con error")


async def limpiar_genericas(aplicar: bool) -> None:
    from deps import db
    prods = await db.products.find({"imagen_url": {"$regex": "images\\.unsplash\\.com"}},
                                   {"_id": 0, "id": 1}).to_list(100000)
    print(f"Productos con foto genérica autoasignada: {len(prods)}")
    if aplicar:
        for p in prods:
            await db.products.update_one({"id": p["id"]}, {"$set": {"imagen_url": ""}})
        print("APLICADO: fotos genéricas retiradas")
    else:
        print("SIMULACIÓN: usa --aplicar para retirarlas")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", help="CSV revisado con product_id e imagen")
    ap.add_argument("--limpiar-genericas", action="store_true")
    ap.add_argument("--aplicar", action="store_true", help="escribir cambios (por defecto simula)")
    a = ap.parse_args()
    if not a.csv and not a.limpiar_genericas:
        ap.error("indica --csv y/o --limpiar-genericas")

    async def run():
        if a.limpiar_genericas:
            await limpiar_genericas(a.aplicar)
        if a.csv:
            await importar(a.csv, a.aplicar)
    asyncio.run(run())
    return 0


if __name__ == "__main__":
    sys.exit(main())
