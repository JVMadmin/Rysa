"""Marcas del sitio público: catálogo por marca con los precios de Grupo RYSA.

`lineas` son los valores del campo `linea` del inventario (es la marca o
fabricante). Solo se publican marcas de plásticos, empaques y desechables;
abarrotes y líneas genéricas (PASTAS, PAPEL, LIMAS…) quedan fuera.
Solo se enlaza el sitio del fabricante cuando se verificó que es la misma
empresa (garduno.com.mx, cubasa.com.mx e ideal.com.mx son otras empresas).
Las fotos de producto vienen del catálogo del fabricante (campo imagen_url,
con su fuente en imagen_fuente) cuando se pudo identificar el producto.
"""
import re

from fastapi import APIRouter, HTTPException, Response

import moneycalc

router = APIRouter(prefix="/api/publico")

MARCAS = [
    {"slug": "reyma", "nombre": "REYMA", "lineas": ["REYMA"],
     "resumen": "Vasos, contenedores, charolas, bolsas y película plástica.",
     "sitio": "https://www.reyma.com.mx", "catalogo": "https://www.reyma.com.mx/productos/"},
    {"slug": "inix", "nombre": "INIX", "lineas": ["INIX"],
     "resumen": "Bisagras, domos, contenedores, vasos y productos compostables.",
     "sitio": "https://www.inix.mx", "catalogo": "https://www.inix.mx/documentos/Catalogo_Inix.pdf"},
    {"slug": "chiaplast", "nombre": "Chiaplast", "lineas": ["CHIAPLAST"],
     "resumen": "Bolsas de polietileno: camiseta, basura, rollo y transparentes.",
     "sitio": "https://chiaplast.com", "catalogo": ""},
    {"slug": "aguirey", "nombre": "Aguirey", "lineas": ["AGUIREY"],
     "resumen": "Artículos plásticos para el hogar y la limpieza.", "sitio": "", "catalogo": ""},
    {"slug": "politab", "nombre": "Politab", "lineas": ["POLITAB"],
     "resumen": "Bolsas naturales y de polietileno.", "sitio": "", "catalogo": ""},
    {"slug": "primo", "nombre": "PRIMO", "lineas": ["PRIMO"],
     "resumen": "Vasos, tapas y charolas desechables.", "sitio": "", "catalogo": ""},
    {"slug": "dinastia", "nombre": "Dinastía", "lineas": ["DINASTIA"],
     "resumen": "Bolsas y empaques plásticos.", "sitio": "", "catalogo": ""},
    {"slug": "garduno", "nombre": "Garduño", "lineas": ["GARDUÑO", "GARDUNO"],
     "resumen": "Repostería y presentación: bases, charolas y empaques.",
     "sitio": "", "catalogo": ""},
    {"slug": "serviplastic", "nombre": "Serviplastic", "lineas": ["SERVIPLASTIC"],
     "resumen": "Desechables y empaques plásticos.", "sitio": "", "catalogo": ""},
    {"slug": "cubasa", "nombre": "Cubasa", "lineas": ["CUBASA"],
     "resumen": "Cubetas, tinas y recipientes plásticos.", "sitio": "", "catalogo": ""},
    {"slug": "ideal", "nombre": "Ideal", "lineas": ["IDEAL"],
     "resumen": "Productos de limpieza.", "sitio": "", "catalogo": ""},
    {"slug": "poliplast", "nombre": "Poliplast", "lineas": ["POLIPLAST"],
     "resumen": "Bolsas y película plástica.", "sitio": "", "catalogo": ""},
    {"slug": "coplasur", "nombre": "Coplasur", "lineas": ["COPLASUR"],
     "resumen": "Bolsas plásticas.", "sitio": "", "catalogo": ""},
    {"slug": "tarasquito", "nombre": "Tarasquito", "lineas": ["TARASQUITO"],
     "resumen": "Desechables.", "sitio": "", "catalogo": ""},
]
_POR_SLUG = {m["slug"]: m for m in MARCAS}

# Fotos genéricas autoasignadas (no son del producto): no se publican.
_GENERICA = re.compile(r"(^|//)images\.unsplash\.com/")


def _imagen(p: dict) -> str:
    u = p.get("imagen_url") or ""
    return "" if not u or _GENERICA.search(u) else u


async def _config_precios(db) -> tuple:
    cfg = await db.settings.find_one({"_id": "app"}) or {}
    return cfg.get("listas_precios_pct") or None, cfg.get("redondeo_precios") or "arriba_peso"


def _linea(p: dict) -> str:
    return (p.get("linea") or "").strip().upper()


async def _activos(db) -> list:
    return await db.products.find({"estado": "activo"}, {
        "_id": 0, "id": 1, "codigo": 1, "descripcion": 1, "linea": 1, "unidad_medida": 1, "costo": 1,
        "iva_tasa": 1, "precios": 1, "imagen_url": 1, "imagen_fuente": 1}).sort("descripcion", 1).to_list(5000)


def _publico(p: dict, pct, modo) -> dict:
    listas = moneycalc.precios_lista(p, pct, modo)
    fuente = p.get("imagen_fuente") or {}
    return {
        "id": p.get("id"), "codigo": p.get("codigo") or "", "descripcion": p.get("descripcion") or "",
        "unidad": p.get("unidad_medida") or "PZA",
        "precio": listas[0]["precio_con_iva"] if listas else 0.0,
        "imagen": _imagen(p),
        "imagen_fuente": fuente.get("origen") if _imagen(p) else "",
    }


def init(db):
    @router.get("/marcas")
    async def marcas(response: Response):
        response.headers["Cache-Control"] = "public, max-age=600"
        conteo = {}
        for p in await _activos(db):
            conteo[_linea(p)] = conteo.get(_linea(p), 0) + 1
        out = []
        for m in MARCAS:
            n = sum(conteo.get(l, 0) for l in m["lineas"])
            if n:
                out.append({k: m[k] for k in ("slug", "nombre", "resumen", "sitio", "catalogo")} | {"productos": n})
        return out

    @router.get("/marcas/{slug}")
    async def marca(slug: str, response: Response):
        m = _POR_SLUG.get(slug)
        if not m:
            raise HTTPException(404, "Marca no encontrada")
        response.headers["Cache-Control"] = "public, max-age=300"
        pct, modo = await _config_precios(db)
        prods = [_publico(p, pct, modo) for p in await _activos(db) if _linea(p) in m["lineas"]]
        prods = [p for p in prods if p["precio"] > 0]
        return {k: m[k] for k in ("slug", "nombre", "resumen", "sitio", "catalogo")} | {"productos": prods}

    return router
