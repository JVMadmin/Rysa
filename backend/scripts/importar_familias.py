#!/usr/bin/env python3
"""Asigna fotos ILUSTRATIVAS por familia a productos sin foto propia.

Entrada: una carpeta con las imágenes (ya en WebP, revisadas) y un JSON
`asignaciones.json` con la lista
    {"archivo": "rollo-natural.webp", "familia": "ROLLO NATURAL",
     "imagen_url": "...", "pagina_url": "...", "fuente": "web",
     "product_ids": ["...", ...]}

Cada imagen se guarda UNA vez (uploads/familias/<archivo>) y la comparten los
productos de su familia. El producto queda con imagen_url y
imagen_fuente.origen = "familia_<fuente>", que el sitio muestra con la
etiqueta "Imagen ilustrativa".

Nunca reemplaza una foto propia del producto (imagen_fuente.origen de
catálogo del fabricante u otra foto subida a mano); solo productos sin foto o
con la foto genérica de images.unsplash.com.

Por defecto es SIMULACIÓN. Usa --aplicar para escribir.

Uso (dentro del contenedor backend):
    python -m scripts.importar_familias --dir /tmp/familias
    python -m scripts.importar_familias --dir /tmp/familias --aplicar
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

_ROOT = str(Path(__file__).resolve().parent.parent)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

_ARCHIVO = re.compile(r"^[a-z0-9][a-z0-9._-]{0,80}\.webp$")


def _reemplazable(p: dict) -> bool:
    url = p.get("imagen_url") or ""
    origen = str((p.get("imagen_fuente") or {}).get("origen") or "")
    return not url or "images.unsplash.com" in url or origen.startswith("familia")


async def importar(carpeta: str, aplicar: bool) -> None:
    import storage
    from deps import db

    base = Path(carpeta)
    asignaciones = json.load(open(base / "asignaciones.json", encoding="utf-8"))
    ahora = datetime.now(timezone.utc).isoformat()
    subidas, asignados, conservados, err = set(), 0, 0, 0
    for a in asignaciones:
        archivo = a.get("archivo") or ""
        if not _ARCHIVO.match(archivo) or not (base / archivo).is_file():
            print(f"  ✗ archivo inválido o ausente: {archivo!r}"); err += 1
            continue
        path = f"uploads/familias/{archivo}"
        if archivo not in subidas:
            data = (base / archivo).read_bytes()
            if aplicar:
                storage.put_object(path, data, "image/webp")
                if not await db.files.find_one({"storage_path": path}):
                    await db.files.insert_one({"id": uuid.uuid4().hex, "storage_path": path,
                                               "original_filename": archivo, "content_type": "image/webp",
                                               "size": len(data), "is_deleted": False, "created_at": ahora})
            subidas.add(archivo)
        fuente = {"origen": f"familia_{a.get('fuente') or 'web'}", "familia": a.get("familia") or "",
                  "url": a.get("imagen_url") or "", "pagina": a.get("pagina_url") or "", "importada": ahora}
        for pid in a.get("product_ids") or []:
            p = await db.products.find_one({"id": pid}, {"_id": 0, "id": 1, "imagen_url": 1, "imagen_fuente": 1})
            if not p:
                err += 1
                continue
            if not _reemplazable(p):
                conservados += 1
                continue
            asignados += 1
            if aplicar:
                await db.products.update_one({"id": pid}, {"$set": {
                    "imagen_url": f"/api/files/{path}", "imagen_fuente": fuente, "imagen_actualizada": ahora}})
    print(f"{'APLICADO' if aplicar else 'SIMULACIÓN'}: {len(subidas)} imágenes, {asignados} productos con foto "
          f"ilustrativa, {conservados} conservan su foto propia, {err} errores")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", required=True, help="carpeta con asignaciones.json y las imágenes .webp")
    ap.add_argument("--aplicar", action="store_true", help="escribir cambios (por defecto simula)")
    a = ap.parse_args()
    asyncio.run(importar(a.dir, a.aplicar))
    return 0


if __name__ == "__main__":
    sys.exit(main())
