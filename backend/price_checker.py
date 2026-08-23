"""RYSA CONSULTOR DE PRECIOS — API aislada (SOLO LECTURA).

Aplicacion independiente de consulta de precio publico de productos RYSA.

Arquitectura:
    DISPOSITIVO (kiosco/tablet)
        -> consultor-precios/ (SPA independiente)
        -> /api/public-price/*   (este servicio)
        -> PostgreSQL del ERP    (lectura unica, nunca escritura)

Garantias de diseno:
  * Solo endpoints de consulta de productos/precios publicos.
  * Nunca expone: costo, margen, existencias, proveedores, clientes, ventas,
    informacion financiera ni tablas paralelas de precios.
  * No expone PostgreSQL directamente: solo este contrato minimo JSON.
  * No modifica ningun dato (solo `find`/`find_one` de solo lectura).
  * Token opcional (PRICE_API_TOKEN) para restringir el acceso.

Los precios publicos se leen de la MISMA logica de listas del ERP
(product.precios[0] = Precio 1 = precio al publico) y del indicador fiscal
`precio_incluye_iva`. No hay listas de precios paralelas.

Ejecucion independiente (misma config que el ERP, con acceso a PostgreSQL):
    uvicorn price_checker:app --host 0.0.0.0 --port 8040
"""
import os
import sys
import re
from pathlib import Path
from datetime import datetime, timezone

from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional

from dotenv import load_dotenv

_BASE = Path(__file__).resolve().parent
load_dotenv(_BASE / ".env", override=False)
_env = os.environ.get("ENVIRONMENT", "development").lower()
if _env in ("development", "production"):
    _ef = _BASE / f".env.{_env}"
    if _ef.exists():
        load_dotenv(_ef, override=True)

if str(_BASE) not in sys.path:
    sys.path.insert(0, str(_BASE))

import pgstore  # noqa: E402

# --------------------------------------------------------------------------- #
# Configuracion
# --------------------------------------------------------------------------- #
TOKEN = (os.environ.get("PRICE_API_TOKEN") or os.environ.get("PRICE_CHECKER_TOKEN") or "").strip()
# Origenes permitidos (separados por coma). "*" habilita CORS abierto; es una
# API publica de consulta de precios. En produccion conviene restringirla.
_ORIGINS = [o.strip() for o in os.environ.get("PRICE_ALLOWED_ORIGINS", "*").split(",") if o.strip()]
# Base absoluta del ERP para resolver imagenes relativas (si aplica).
PUBLIC_IMG_BASE = os.environ.get("PRICE_IMG_BASE", "").rstrip("/")

app = FastAPI(title="RYSA Consultor de Precios API", version="1.0.0",
              docs_url="/api/public-price/docs",
              openapi_url="/api/public-price/openapi.json")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)

router = APIRouter(prefix="/api/public-price")

db = pgstore.PGDatabase()

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _validar_token(request: Request) -> None:
    """Valida el token opcional de la API del consultor (si esta configurado)."""
    if not TOKEN:
        return
    header = request.headers.get("x-price-token") or ""
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        header = header or auth[7:]
    if header.strip() != TOKEN:
        raise HTTPException(status_code=401, detail="Token no valido para el consultor de precios")


async def _settings() -> dict:
    """Config fiscal global del ERP (solo lectura)."""
    try:
        s = await db.settings.find_one({"_id": "app"}, {"_id": 0})
        return s or {}
    except Exception:
        return {}


def _primary_barcode(p: dict) -> str:
    barras = [str(x).strip() for x in (p.get("codigos_barras") or []) if str(x).strip()]
    numerico = next((b for b in barras if b.isdigit()), None)
    return numerico or (barras[0] if barras else "") or (p.get("codigo") or "")


def _public_dto(p: dict, settings: dict) -> Optional[dict]:
    """Construye el DTO minimo de precio publico.

    Reglas de IVA (respetando la configuracion fiscal del producto):
      - `precio_con_iva` (bruto) es el PRECIO PUBLICO FINAL.
      - `precio_sin_iva` (neto)  es el subtotal.
      - `iva_importe` = bruto - neto  (nunca se vuelve a sumar IVA).
    Ambas se leen de la lista publica `precios[0]` (Precio 1) del ERP. Si el
    producto no tiene precio publico se excluye (no se podria responder).
    El indicador `incluye_iva` solo informa como se desglosa; el precio final
    no cambia y el impuesto nunca se duplica.
    """
    if not p:
        return None
    precios = p.get("precios") or []
    p1 = precios[0] if precios else {}
    bruto = float(p.get("precio_con_iva") or 0) or float(p1.get("precio_con_iva") or 0)
    neto = float(p.get("precio_sin_iva") or 0) or float(p1.get("precio_sin_iva") or 0)
    iva_tasa = float(p.get("iva_tasa") or 0)
    if neto <= 0 and bruto > 0:
        neto = round(bruto / (1 + iva_tasa / 100), 2) if iva_tasa > 0 else bruto
    if bruto <= 0 and neto > 0:
        bruto = round(neto * (1 + iva_tasa / 100), 2) if iva_tasa > 0 else neto
    if bruto <= 0 or neto <= 0:
        return None  # sin precio publico disponible
    incluye = p.get("precio_incluye_iva")
    if incluye is None:
        incluye = bool(settings.get("precios_incluyen_iva", True))
    img = (p.get("imagen_url") or p.get("imagen") or p.get("foto") or "").strip()
    if img and img.startswith("/") and PUBLIC_IMG_BASE:
        img = PUBLIC_IMG_BASE + (img if img.startswith("/") else "/" + img)
    return {
        "id": p.get("id"),
        "codigo": p.get("codigo"),
        "sku": p.get("sku") or "",
        "barcode": _primary_barcode(p),
        "codigos_barras": p.get("codigos_barras") or [],
        "nombre": (p.get("descripcion") or p.get("descriplrg") or "").strip(),
        "descripcion": (p.get("descripcion_larga") or "").strip(),
        "presentacion": (p.get("empaque") or "").strip(),
        "unidad": (p.get("unidad_medida") or "PZA").strip(),
        "imagen": img,
        "precio_publico": round(bruto, 2),
        "precio_sin_iva": round(neto, 2),
        "iva": iva_tasa,
        "iva_importe": round(bruto - neto, 2),
        "incluye_iva": bool(incluye),
        "sucursal": None,
        "actualizacion": _iso_now(),
    }


# --------------------------------------------------------------------------- #
# Endpoints (SOLO LECTURA)
# --------------------------------------------------------------------------- #
@router.get("/health")
async def health(request: Request):
    await _validar_token(request)
    return {"ok": True, "servicio": "rysa-consultor-precios", "hora": _iso_now()}


@router.get("/sucursales")
async def sucursales(request: Request):
    """Lista minima de sucursales (nombre) para declarar la del dispositivo.

    Prepara la estructura multisucursal; por ahora todos los dispositivos usan
    la misma lista de precios publicos y los nombres no alteran los precios."""
    await _validar_token(request)
    docs = await db.sucursales.find({}, {"_id": 0, "id": 1, "nombre": 1}).sort("nombre", 1).to_list(100)
    return [{"id": d.get("id") or d.get("sucursal_id"),
             "nombre": d.get("nombre") or d.get("sucursal") or "Principal"} for d in docs]


def _barcode_regex(code: str) -> dict:
    # Coincidencia exacta de un elemento del arreglo codigos_barras (JSON).
    return {"$regex": re.escape(code), "$options": "i"}


@router.get("/products/search")
async def search_products(request: Request,
                          q: Optional[str] = None,
                          limit: int = 25,
                          sucursal: Optional[str] = None):
    await _validar_token(request)
    term = (q or "").strip()[:100]
    if not term:
        return {"q": "", "sucursal": sucursal, "total": 0, "results": []}
    rx = {"$regex": re.escape(term), "$options": "i"}
    flt = {
        "estado": "activo",
        "$or": [
            {"codigo": rx},
            {"sku": rx},
            {"descripcion": rx},
            {"descripcion_larga": rx},
            {"linea": rx},
            {"clasificacion": rx},
            {"codigos_barras": {"$regex": re.escape(term), "$options": "i"}},
        ],
    }
    docs = await db.products.find(flt, {"_id": 0}).sort("descripcion", 1).limit(50).to_list(50)
    settings = await _settings()
    out = []
    for d in docs:
        dto = _public_dto(d, settings)
        if dto:
            out.append(dto)
            if len(out) >= int(limit):
                break
    return {"q": term, "sucursal": sucursal, "total": len(out), "results": out}


@router.get("/products/codigo/{codigo}")
async def by_codigo(request: Request, codigo: str, sucursal: Optional[str] = None):
    await _validar_token(request)
    code = codigo.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Codigo vacio")
    settings = await _settings()
    for flt in ({"codigo": code}, {"sku": code}):
        p = await db.products.find_one({**flt, "estado": "activo"}, {"_id": 0})
        dto = _public_dto(p, settings) if p else None
        if dto:
            return {"found": True, "sucursal": sucursal, "product": dto}
    return {"found": False, "sucursal": sucursal, "product": None}


@router.get("/products/barcode/{barcode}")
async def by_barcode(request: Request, barcode: str, sucursal: Optional[str] = None):
    await _validar_token(request)
    code = barcode.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Codigo de barras vacio")
    settings = await _settings()
    for flt in ({"codigo": code}, {"sku": code}):
        p = await db.products.find_one({**flt, "estado": "activo"}, {"_id": 0})
        dto = _public_dto(p, settings) if p else None
        if dto:
            return {"found": True, "sucursal": sucursal, "product": dto}
    p = await db.products.find_one(
        {"estado": "activo", "codigos_barras": _barcode_regex(code)}, {"_id": 0})
    dto = _public_dto(p, settings) if p else None
    if dto:
        return {"found": True, "sucursal": sucursal, "product": dto}
    return {"found": False, "sucursal": sucursal, "product": None}


app.include_router(router)