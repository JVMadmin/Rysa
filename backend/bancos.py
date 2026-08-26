"""CATÁLOGO ÚNICO de bancos para cuentas bancarias (selector + logos).

Fuente de verdad compartida por:
  - GET /api/catalogo-bancos      (frontend: selector y listado)
  - Hoja 2 del PDF de cotizaciones (storage.build_cotizacion_pdf)

Para agregar un banco nuevo basta añadir una entrada aquí y su logo en
backend/assets/bancos/ (PNG con fondo transparente preferible).
"""
import os
import unicodedata

from fastapi.responses import FileResponse

_DIR_LOGOS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "bancos")

BANCOS = [
    {"nombre": "BBVA", "aliases": ["bbva", "bbva mexico", "bbva bancomer", "bancomer"],
     "logo": "bbva.png", "color": "#072146"},
    {"nombre": "BanCoppel", "aliases": ["bancoppel", "coppel"],
     "logo": "bancoppel.png", "color": "#E4006E"},
    {"nombre": "Banamex", "aliases": ["banamex", "citibanamex", "citi mexico", "banamex citi"],
     "logo": "banamex.png", "color": "#00539F"},
    {"nombre": "Santander", "aliases": ["santander", "banco santander", "santander mexico"],
     "logo": "santander.png", "color": "#EC0000"},
    {"nombre": "Inbursa", "aliases": ["inbursa", "banco inbursa"],
     "logo": "inbursa.png", "color": "#009A44"},
    {"nombre": "Banco Azteca", "aliases": ["azteca", "banco azteca", "grupo azteca"],
     "logo": "azteca.png", "color": "#FFC10E"},
]


def _normaliza(txt: str) -> str:
    """minúsculas sin acentos ni espacios extra."""
    t = unicodedata.normalize("NFD", (txt or "").strip().lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.split())


def resolver_banco(nombre: str) -> dict | None:
    """Encuentra el banco del catálogo a partir de texto libre histórico."""
    n = _normaliza(nombre)
    if not n:
        return None
    for b in BANCOS:
        candidatos = [_normaliza(b["nombre"])] + [_normaliza(a) for a in b.get("aliases", [])]
        if n in candidatos:
            return b
    # coincidencia parcial razonable ("bbva méxico norte" -> BBVA)
    for b in BANCOS:
        for cand in [b["nombre"]] + list(b.get("aliases", [])):
            c = _normaliza(cand)
            if len(c) >= 5 and c in n:
                return b
    return None


def ruta_logo(banco_entry: dict | str) -> str | None:
    """Ruta absoluta del logo si existe en disco; None si no."""
    entry = banco_entry if isinstance(banco_entry, dict) else resolver_banco(banco_entry)
    if not entry:
        return None
    p = os.path.join(_DIR_LOGOS, entry["logo"])
    return p if os.path.exists(p) else None


def servir_logo(archivo: str) -> FileResponse:
    """Sirve el asset del logo (para <img> del frontend)."""
    nombre = os.path.basename(archivo)
    p = os.path.join(_DIR_LOGOS, nombre)
    if not os.path.exists(p):
        raise FileNotFoundError(nombre)
    media = "image/png" if nombre.lower().endswith(".png") else "image/svg+xml"
    return FileResponse(p, media_type=media, filename=nombre)
