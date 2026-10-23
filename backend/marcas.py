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
     "resumen": "Charolas, vasos soufflé, tapas y popotes desechables.",
     "sitio": "https://www.primocuevas.com.mx",
     "catalogo": "https://cdn.shopify.com/s/files/1/0703/3405/4509/files/Catalogo_Primo_Cuevas_2026_VF6.pdf"},
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
    {"slug": "banaplastic", "nombre": "Banaplastic", "lineas": ["BANAPLASTIC"],
     "resumen": "Bolsas plásticas.", "sitio": "", "catalogo": ""},
    {"slug": "anguiplast", "nombre": "Anguiplast", "lineas": ["ANGUIPLAST"],
     "resumen": "Artículos plásticos.", "sitio": "", "catalogo": ""},
    {"slug": "truper", "nombre": "Truper", "lineas": ["TRUPER"],
     "resumen": "Herramienta para el campo y la ferretería: machetes, limas, piedras para afilar.",
     "sitio": "https://www.truper.com", "catalogo": ""},
]

# Muchos productos no tienen la marca en `linea` pero sí en la descripción
# ("ROLLO NATURAL REYMA 18 X 26"): se reconoce por palabra completa.
_MARCA_EN_TEXTO = [(m["slug"], re.compile(r"\b(" + "|".join(re.escape(l) for l in m["lineas"]) + r")\b"))
                   for m in MARCAS]

# Categorías del sitio (mismos slugs que frontend/src/data/categorias.js). El
# ERP no guarda la familia del producto, así que se deduce de la descripción;
# gana la primera regla que coincide. Abarrotes y bebidas no se publican.
CATEGORIAS = [
    ("reposteria", r"^(\d+(\.\d+)? X \d+.*(CENEFA|ADHESIVO|SELLO)|BASE\b|CENEFA|MOLDE|CAPACILLO|ADHESIVO|BROCHETA|PALILLO|VELA\b|COLORANTE|VAINILLA|GRENETINA|"
                   r"PAPEL (CHINA|CREPE|ENCERADO|ESTRAZA|CEBOLLA|BLANCO|ALUMINIO)|ALUMINIO|CHAROLA DE ALUMINIO)|ALUMINIO|CAPACILLO"),
    ("bolsas", r"^(BOLSA|ROLLO|ASA\b|CELOFAN|ZIP\b|VITAFILM|CLINGFILM|EMPLAYE|STRETCH|PELICULA|POLIBURBUJA)|POLISEDA|POLIPAPEL|CAMISETA"),
    ("desechables", r"^(VASO|TAPA|CHAROLA|CONTENEDOR|CONT\b|MANTEL|BISAGRA|DOMO|PLATO|POPOTE|CUCHAR|TENEDOR|CUCHILLO|SERVILLETA|COPA|"
                    r"ENVASE|CONO|ANFORA|CAJA PIZZA|CAJA PARA|PALITO|AGITADOR|SOUF|PORTAVASO|BOTELLA PET|BOTELLA \d)"),
    ("limpieza", r"^(ESCOBA|TRAPEADOR|FIBRA|CEPILLO|JABON|DETERGENTE|LAVA|CLORO|PINO|SUAVIZANTE|GUANTE|MOP\b|RECOGEDOR|"
                 r"JALADOR|ATOMIZADOR|DESENGRASANTE|AROMATIZANTE|FRANELA|JERGA|PAPEL HIGIENICO|PAPEL ROLLO|TOALLA|SANITAS|"
                 r"CUBETA EXPRIMIDORA|PASTILLA|SACUDIDOR|MICROFIBRA|ESCOBETA|FABULOSO|SUAVITEL|CLORALEX)"),
    ("recipientes", r"^(CUBETA|PALANGANA|TAMBO|BATEA|TINA\b|CANASTA|BOTE\b|BOTELLA|GARRAFA|GALON|HIELERA|BEBEDERO|JAULA|"
                    r"EMBUDO|COLADOR|TABLA|PAVERA|MOLCAJETE|CESTO|HUACAL|JARRA|VITROLERO|ORGANIZADOR|CAJA ORGANIZADORA|"
                    r"COMEDERO|CUBETAS|TINACO|BANDEJA|TAZON|RECIPIENTE|BOWL|ENSALADERA|TANQUE|JARDINERA|POLLERA|MESA\b)"),
    ("ferreteria-campo", r"^(LONA|CINTA|CUERDA|MALLA|LIMA\b|FOCO|MORRAL|SOMBRERO|MACHETE|LAZO|CORDEL|TENSOR|COSTAL|MECAPAL|"
                         r"PIEDRA|HILO|LIGA|PINZA|ENCENDEDOR|CERILLO|MANDIL|TENDEDERO|ACHA\b|HACHA|PILA|ENERGIZER|LLAVERO|"
                         r"CANDADO|CLAVO|ALAMBRE|FUNDA|LINTERNA|NAVAJA|GUADAÑA|AZADON|PALA\b|RASTRILLO|RAFIA|AGUJA\b|PEGA\b|SOMBRILLA)|TRUPER"),
]
_CATEGORIAS_RX = [(slug, re.compile(rx)) for slug, rx in CATEGORIAS]
CATEGORIA_SLUGS = {slug for slug, _ in CATEGORIAS}
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


def marca_de(p: dict) -> str:
    """Slug de la marca: por `linea` o, si no la tiene, por la descripción."""
    linea = _linea(p)
    for m in MARCAS:
        if linea in m["lineas"]:
            return m["slug"]
    desc = (p.get("descripcion") or "").upper()
    for slug, rx in _MARCA_EN_TEXTO:
        if rx.search(desc):
            return slug
    return ""


def categoria_de(p: dict) -> str:
    desc = re.sub(r"\s+", " ", (p.get("descripcion") or "").upper()).strip()
    for slug, rx in _CATEGORIAS_RX:
        if rx.search(desc):
            return slug
    return ""


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
        # Foto de otro producto de la misma familia (no es el artículo exacto).
        "ilustrativa": bool(_imagen(p)) and str(fuente.get("origen") or "").startswith("familia"),
        "marca": marca_de(p),
    }


def init(db):
    @router.get("/marcas")
    async def marcas(response: Response):
        response.headers["Cache-Control"] = "public, max-age=600"
        conteo = {}
        for p in await _activos(db):
            conteo[marca_de(p)] = conteo.get(marca_de(p), 0) + 1
        out = []
        for m in MARCAS:
            n = conteo.get(m["slug"], 0)
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
        prods = [_publico(p, pct, modo) for p in await _activos(db) if marca_de(p) == slug]
        prods = [p for p in prods if p["precio"] > 0]
        return {k: m[k] for k in ("slug", "nombre", "resumen", "sitio", "catalogo")} | {"productos": prods}

    @router.get("/categorias/{slug}")
    async def categoria(slug: str, response: Response):
        """Productos de una categoría del sitio con su marca (si se conoce) y
        las marcas presentes, para filtrar en la página de la categoría."""
        if slug not in CATEGORIA_SLUGS:
            raise HTTPException(404, "Categoría no encontrada")
        response.headers["Cache-Control"] = "public, max-age=300"
        pct, modo = await _config_precios(db)
        prods = [_publico(p, pct, modo) for p in await _activos(db) if categoria_de(p) == slug]
        prods = [p for p in prods if p["precio"] > 0]
        conteo = {}
        for p in prods:
            if p["marca"]:
                conteo[p["marca"]] = conteo.get(p["marca"], 0) + 1
        marcas = [{"slug": m["slug"], "nombre": m["nombre"], "productos": conteo[m["slug"]]}
                  for m in MARCAS if m["slug"] in conteo]
        return {"slug": slug, "productos": prods, "marcas": marcas}

    return router
