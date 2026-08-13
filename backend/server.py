"""Grupo RYSA ERP - API principal (FastAPI + PostgreSQL)."""
import os
import json
from dotenv import load_dotenv
from pathlib import Path

_ENV_BASE = Path(__file__).parent
# ENVIRONMENT definido por el entorno del sistema (p. ej. systemd en el VPS).
_env_active_os = os.environ.get("ENVIRONMENT", "").lower()
# Cargar siempre `.env` (base/local). Las variables del SO tienen prioridad.
load_dotenv(_ENV_BASE / '.env', override=False)
# Si el proceso indica el entorno explícitamente, cargar también `.env.<entorno>`.
if _env_active_os in ("development", "production"):
    _env_file = _ENV_BASE / f".env.{_env_active_os}"
    if _env_file.exists():
        load_dotenv(_env_file, override=True)

import io
import uuid
import re
import time
import logging
import jwt
from typing import List, Optional
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Response, UploadFile, File, Request
from fastapi.responses import StreamingResponse, JSONResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr, ConfigDict
import pandas as pd
from datetime import datetime, date, timedelta
import httpx
import base64
import platform

from deps import (
    db, client, now_utc, iso_now, hash_password, verify_password,
    create_access_token, create_refresh_token, decode_token, hash_token,
    get_current_user, require_permission, has_permission, effective_permissions,
    user_has_permission, next_counter, log_audit, revoke_user_sessions, MODULES,
    ROLE_PERMISSIONS, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS,
    ver_todas_ventas, DEFAULT_MODULES_NON_PRIVILEGED,
    es_rol_privilegiado,
)
import pgstore.pos as _pgpos
import storage
import pac_provider

_APP_ENV = os.environ.get("ENVIRONMENT", "development").lower()
logging.basicConfig(level=logging.DEBUG if _APP_ENV == "development" else logging.INFO)
logger = logging.getLogger("rysa")

app = FastAPI(title="Grupo RYSA ERP")
api = APIRouter(prefix="/api")

# Roles que se consideran administración del sistema (admin, propietario, desarrollador)
ADMIN_SYSTEM_ROLES = {"admin", "admin_propietario", "admin_desarrollador"}

# --- Bitácora en memoria de errores no controlados (para developer admin) ---
DEV_ERRORS = []

@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    import traceback
    # El detalle completo solo se registra internamente; el cliente recibe un
    # mensaje genérico. En producción no se retiene la traza en memoria.
    if _APP_ENV != "production":
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        record = {
            "id": uid(), "fecha": iso_now(),
            "ruta": f"{request.method} {request.url.path}",
            "tipo": type(exc).__name__, "mensaje": str(exc)[:800], "detalle": tb[-2000:],
        }
        DEV_ERRORS.append(record)
        DEV_ERRORS[:] = DEV_ERRORS[-200:]
    logger.exception("Error no controlado: %s", exc)
    return JSONResponse(status_code=500, content={"detail": "Error interno del servidor"})

def es_admin_sistema(user: dict) -> bool:
    """Solo admin/propietario/desarrollador pueden administrar usuarios y módulos."""
    return user_has_permission(user, "usuarios.admin")

def uid() -> str:
    return uuid.uuid4().hex

SEARCH_MAX_LENGTH = 100

def sanitize_search_term(q) -> str:
    """Normaliza y escapa un término de búsqueda para $regex.
    Escapa metacaracteres (búsqueda literal) y limita la longitud para evitar
    patrones arbitrariamente costosos en la base de datos."""
    if not q:
        return ""
    s = str(q).strip()
    if len(s) > SEARCH_MAX_LENGTH:
        s = s[:SEARCH_MAX_LENGTH]
    return re.escape(s)

# ==========================================================================
# ESTRUCTURA COMPLETA DE 85 COLUMNAS (nomenclatura DBF/XBase)
# ==========================================================================
COLS_85 = [
    ("POSICION", "C"), ("CODIGO", "C"), ("DESCRIP", "C"), ("DESCRIPLRG", "M"), ("CLASIFICA", "C"),
    ("CATEGORIA", "C"), ("CATEGOCVE", "C"), ("DEPTOCVE", "C"), ("LINEA", "C"), ("UNIMEDIDA", "C"),
    ("UNIMEDCVE", "C"), ("CVEPROSER", "C"), ("SATOBJIMP", "C"), ("UBICACION", "C"), ("EMPAQUE", "N"),
    ("UNIMEDEMPQ", "C"), ("EXISTENCIA", "N"), ("INSUMO", "L"), ("PROVEEDOR", "C"), ("FECHAALTA", "D"),
    ("ULTFCOSTO", "D"), ("ULTCOSTO", "N"), ("COSTO", "N"), ("COSTODLLS", "N"), ("UTILMINIMO", "N"),
    ("UTILPRECI1", "N"), ("UTILPRECI2", "N"), ("UTILPRECI3", "N"), ("UTILPRECI4", "N"), ("UTILPRECI5", "N"),
    ("EXENTO", "L"), ("IMPUESTO", "N"), ("T_IEPS", "N"), ("IEPS", "N"), ("ISH", "N"),
    ("RET_ISR", "N"), ("RET_IVA", "N"), ("PRECIOVTA", "N"), ("PRECVTACTR", "N"), ("PRECVTAUSO", "N"),
    ("PRECIO1", "N"), ("PRECIO2", "N"), ("PRECIO3", "N"), ("PRECIO4", "N"), ("PRECIO5", "N"),
    ("PRECIOMIN", "N"), ("ULTFDEVCOM", "D"), ("ULTCDEVCOM", "N"), ("ULTFCOMPRA", "D"), ("ULTCCOMPRA", "N"),
    ("ULTFDEVVEN", "D"), ("ULTCDEVVEN", "N"), ("ULTFVENTA", "D"), ("ULTCVENTA", "N"), ("VTA_MES", "N"),
    ("VTA_ANUAL", "N"), ("XENTREGAR", "N"), ("XRECIBIR", "N"), ("STOCKMIN", "N"), ("STOCKMAX", "N"),
    ("PORPEDIR", "L"), ("IMAGEN", "M"), ("FOTO", "M"), ("FICHATEC", "M"), ("NUMSERIES", "L"),
    ("FACTCOMENT", "L"), ("INTEGRADO", "L"), ("VALEXIST", "L"), ("MODIPRECIO", "L"), ("APLIDESCTO", "L"),
    ("TOPECOSTO", "L"), ("INVENTARIO", "L"), ("MOVKARDEX", "L"), ("VENTAWEB", "L"), ("LOTES", "L"),
    ("CONTROLADO", "L"), ("BASCULA", "L"), ("ASOCIADO", "L"), ("FLETE", "L"), ("COMENTARIO", "M"),
    ("ROTACION", "C"), ("ULTPRECIO", "D"), ("COMISION", "N"), ("COMITIPO", "C"), ("STATUS", "C"),
]
COL_ORDER = [n for n, _ in COLS_85]
IMPORT_ALIASES = {"DESCRIPCION": "DESCRIP", "UNIDAD_MEDIDA": "UNIMEDIDA", "STOCK_MINIMO": "STOCKMIN",
                  "ESTADO": "STATUS", "CLASIFICACION": "CLASIFICA"}
STATUS_TO_ESTADO = {"A": "activo", "1": "activo", "ACTIVO": "activo", "B": "baja", "BAJA": "baja",
                    "S": "suspendido", "SUSPENDIDO": "suspendido"}

def _p_num(v):
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if s == "" or s.lower() in ("nan", "none"):
        return None
    try:
        return float(s)
    except Exception:
        return "__ERR__"

def _p_bool(v):
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in ("true", "1", "1.0", "si", "sí", "s", "yes", "y", "verdadero", ".t.", "t"):
        return True
    if s in ("false", "0", "0.0", "no", "n", "", ".f.", "f", "nan"):
        return False
    return "__ERR__"

def _p_date(v):
    if v is None:
        return None
    s = str(v).strip()
    if s == "" or s.lower() in ("nat", "nan", "none"):
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d", "%d-%m-%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except Exception:
            pass
    try:
        return pd.to_datetime(s).date().isoformat()
    except Exception:
        return "__ERR__"

def parse_row(canon: dict):
    """canon: {COLNAME_UPPER: raw}. Devuelve (data lowercase, errores)."""
    data, errores = {}, []
    for name, t in COLS_85:
        raw = canon.get(name, "")
        key = name.lower()
        if t in ("C", "M"):
            data[key] = "" if raw is None else str(raw).strip()
        elif t == "N":
            val = _p_num(raw)
            if val == "__ERR__":
                errores.append({"campo": name, "valor": str(raw), "motivo": "Número inválido"}); data[key] = None
            else:
                data[key] = val
        elif t == "D":
            val = _p_date(raw)
            if val == "__ERR__":
                errores.append({"campo": name, "valor": str(raw), "motivo": "Fecha inválida"}); data[key] = None
            else:
                data[key] = val
        elif t == "L":
            val = _p_bool(raw)
            if val == "__ERR__":
                errores.append({"campo": name, "valor": str(raw), "motivo": "Booleano inválido"}); data[key] = False
            else:
                data[key] = val
    if not data.get("codigo"):
        errores.append({"campo": "CODIGO", "valor": "", "motivo": "Código obligatorio"})
    if not data.get("descrip"):
        errores.append({"campo": "DESCRIP", "valor": "", "motivo": "Descripción obligatoria"})
    return data, errores

def build_product_doc(d: dict) -> dict:
    """Documento de producto: conserva los 85 campos y sincroniza los campos usados por POS/Inventario."""
    iva = d.get("impuesto")
    iva = float(iva) if iva not in (None, 0, "") else 16.0
    costo = float(d.get("costo") or 0)
    precios = []
    for i in range(1, 6):
        con = d.get(f"precio{i}"); util = d.get(f"utilpreci{i}")
        if con:
            con = float(con); sin = round(con / (1 + iva / 100), 2)
            u = round((sin / costo - 1) * 100, 2) if costo else float(util or 0)
        else:
            u = float(util or 0); sin = round(costo * (1 + u / 100), 2); con = round(sin * (1 + iva / 100), 2)
        precios.append({"nombre": f"Precio {i}", "utilidad_pct": u, "precio_sin_iva": sin, "precio_con_iva": round(con, 2)})
    status = str(d.get("status", "")).upper()
    doc = dict(d)  # conserva los 85 campos tal cual
    doc.update({
        "descripcion": d.get("descrip", ""),
        "descripcion_larga": d.get("descriplrg", ""),
        "linea": d.get("linea", ""),
        "clasificacion": d.get("clasifica", ""),
        "unidad_medida": d.get("unimedida") or "PZA",
        "empaque": d.get("empaque") or "",
        "ubicacion": d.get("ubicacion", ""),
        "costo": costo,
        "stock_minimo": float(d.get("stockmin") or 0),
        "iva_tasa": iva,
        "estado": STATUS_TO_ESTADO.get(status, "activo"),
        "precios": precios,
        "precio_minimo": float(d.get("preciomin") or 0),
        "imagen_url": d.get("imagen") or d.get("foto") or "",
        "sku": d.get("codigo", ""),
        "sinonimos": [],
        "sat": {"clave_sat": d.get("cveproser", ""), "unidad_sat": d.get("unimedcve", ""),
                "impuestos": "Exento" if d.get("exento") else "IVA"},
        "controles": {"permitir_venta": True, "controlar_inventario": bool(d.get("inventario", True)),
                      "permitir_inventario_negativo": False,
                      "mostrar_pos": not bool(d.get("insumo", False)),
                      "mostrar_catalogo": bool(d.get("ventaweb", False))},
        "ficha_tecnica": {},
        "proveedores": [d.get("proveedor")] if d.get("proveedor") else [],
    })
    return doc

# =========================================================================
# MODELOS
# =========================================================================
class LoginInput(BaseModel):
    email: str
    password: str

class UserCreate(BaseModel):
    email: EmailStr
    name: str
    password: str
    role: str = "vendedor"
    modulos: List[str] = Field(default_factory=list)
    sucursal_id: Optional[str] = None

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = None
    modulos: Optional[List[str]] = None
    sucursal_id: Optional[str] = None

class PrecioItem(BaseModel):
    nombre: str = "Precio 1"
    utilidad_pct: float = 0.0
    precio_sin_iva: float = 0.0
    precio_con_iva: float = 0.0

class ProductInput(BaseModel):
    # Mass assignment seguro: SOLO se aceptan los campos declarados.
    # Se declaran los 85 campos legacy DBF (COLS_85) + campos ERP modernos.
    model_config = ConfigDict(extra="forbid")

    # --- Campos ERP modernos ---
    codigo: Optional[str] = None
    sku: Optional[str] = ""
    descripcion: str
    descripcion_larga: Optional[str] = ""
    estado: str = "activo"  # activo | baja | suspendido
    linea: Optional[str] = ""
    clasificacion: Optional[str] = ""
    unidad_medida: str = "PZA"
    empaque: Optional[str] = ""
    costo: float = 0.0
    existencia: float = 0.0
    ubicacion: Optional[str] = ""
    stock_minimo: float = 0.0
    iva_tasa: float = 16.0
    precios: List[PrecioItem] = Field(default_factory=list)
    precio_minimo: float = 0.0
    sat: dict = Field(default_factory=dict)
    controles: dict = Field(default_factory=dict)
    ficha_tecnica: dict = Field(default_factory=dict)
    proveedores: List[str] = Field(default_factory=list)
    sinonimos: List[str] = Field(default_factory=list)
    imagen_url: Optional[str] = ""
    codigos_barras: List[str] = Field(default_factory=list)

    # --- Campos legacy DBF (nomenclatura XBase) ---
    # Los numéricos se aceptan como texto porque el formulario envía "" en
    # blanco y así se evita romper la validación manteniendo la persistencia.
    posicion: Optional[str] = ""
    descrip: Optional[str] = ""
    descriplrg: Optional[str] = ""
    clasifica: Optional[str] = ""
    categoria: Optional[str] = ""
    categocve: Optional[str] = ""
    deptocve: Optional[str] = ""
    unimedida: Optional[str] = ""
    unimedcve: Optional[str] = ""
    cveproser: Optional[str] = ""
    satobjimp: Optional[str] = ""
    unimedempq: Optional[str] = ""
    insumo: Optional[bool] = False
    proveedor: Optional[str] = ""
    fechaalta: Optional[str] = ""
    ultfcosto: Optional[str] = ""
    ultcosto: Optional[str] = ""
    costodlls: Optional[str] = ""
    utilminimo: Optional[str] = ""
    utilpreci1: Optional[str] = ""
    utilpreci2: Optional[str] = ""
    utilpreci3: Optional[str] = ""
    utilpreci4: Optional[str] = ""
    utilpreci5: Optional[str] = ""
    exento: Optional[bool] = False
    impuesto: Optional[str] = ""
    t_ieps: Optional[str] = ""
    ieps: Optional[str] = ""
    ish: Optional[str] = ""
    ret_isr: Optional[str] = ""
    ret_iva: Optional[str] = ""
    preciovta: Optional[str] = ""
    precvtactr: Optional[str] = ""
    precvtauso: Optional[str] = ""
    precio1: Optional[str] = ""
    precio2: Optional[str] = ""
    precio3: Optional[str] = ""
    precio4: Optional[str] = ""
    precio5: Optional[str] = ""
    preciomin: Optional[str] = ""
    ultfdevcom: Optional[str] = ""
    ultcdevcom: Optional[str] = ""
    ultfcompra: Optional[str] = ""
    ultccompra: Optional[str] = ""
    ultfdevven: Optional[str] = ""
    ultcdevven: Optional[str] = ""
    ultfventa: Optional[str] = ""
    ultcventa: Optional[str] = ""
    vta_mes: Optional[str] = ""
    vta_anual: Optional[str] = ""
    xentregar: Optional[str] = ""
    xrecibir: Optional[str] = ""
    stockmin: Optional[str] = ""
    stockmax: Optional[str] = ""
    porpedir: Optional[bool] = False
    imagen: Optional[str] = ""
    foto: Optional[str] = ""
    fichatec: Optional[str] = ""
    numseries: Optional[bool] = False
    factcoment: Optional[bool] = False
    integrado: Optional[bool] = False
    valexist: Optional[bool] = False
    modiprecio: Optional[bool] = False
    aplidescto: Optional[bool] = False
    topecosto: Optional[bool] = False
    inventario: Optional[bool] = False
    movkardex: Optional[bool] = False
    ventaweb: Optional[bool] = False
    lotes: Optional[bool] = False
    controlado: Optional[bool] = False
    bascula: Optional[bool] = False
    asociado: Optional[bool] = False
    flete: Optional[bool] = False
    comentario: Optional[str] = ""
    rotacion: Optional[str] = ""
    ultprecio: Optional[str] = ""
    comision: Optional[str] = ""
    comitipo: Optional[str] = ""
    status: Optional[str] = ""

class InventoryAdjust(BaseModel):
    tipo: str  # entrada | salida | ajuste | merma | devolucion | correccion
    cantidad: float
    concepto: Optional[str] = ""
    documento: Optional[str] = ""
    costo: Optional[float] = 0.0
    motivo: Optional[str] = ""
    observaciones: Optional[str] = ""

class ClientInput(BaseModel):
    # --- General ---
    codigo: Optional[str] = None            # CLAVE (identificador único)
    nombre: str                             # NOMBRE
    razon_social: Optional[str] = ""
    status: Optional[str] = ""              # STATUS legacy (1 char)
    estado: str = "activo"                  # activo | suspendido | inactivo
    tipo: str = "publico"                   # clasificación moderna
    tipo_clave: Optional[str] = ""          # TIPO legacy (1 char)
    fecha_alta: Optional[str] = ""          # FECHAALTA
    contrasena: Optional[str] = ""          # CONTRASENA
    # --- Contacto ---
    representa: Optional[str] = ""          # REPRESENTA
    tel_oficina: Optional[str] = ""         # TELOFICINA
    tel_residencia: Optional[str] = ""      # TELRESIDEN
    tel_fax: Optional[str] = ""             # TEL_FAX
    telefono: Optional[str] = ""            # compat
    celular: Optional[str] = ""             # CELULAR
    whatsapp: Optional[str] = ""            # compat
    correo: Optional[str] = ""              # compat (1 correo)
    correos: Optional[str] = ""             # CORREOS (varios)
    # --- Dirección ---
    direccion: Optional[str] = ""           # DIRECCION
    calle: Optional[str] = ""               # compat
    numero_exterior: Optional[str] = ""     # NOEXTERIOR
    numero_interior: Optional[str] = ""     # NOINTERIOR
    colonia: Optional[str] = ""             # COLONIA
    ciudad_edo: Optional[str] = ""          # CIUDADEDO
    localidad: Optional[str] = ""           # LOCALIDAD
    municipio: Optional[str] = ""           # compat
    ciudad: Optional[str] = ""              # CIUDAD
    estado_geo: Optional[str] = ""          # ESTADO (geográfico)
    pais: Optional[str] = "México"          # PAIS
    cp: Optional[str] = ""                  # CODPOSTAL
    referencias: Optional[str] = ""         # REFERENCIA
    id_localidad: Optional[str] = ""
    id_colonia: Optional[str] = ""
    id_ciudad: Optional[str] = ""
    id_estado: Optional[str] = ""
    id_pais: Optional[str] = ""
    # --- Fiscales ---
    rfc: Optional[str] = ""                 # RFC
    reg_fiscal: Optional[str] = ""          # REGFISCAL
    uso_cfdi: Optional[str] = ""            # USOCFDI
    resfiscal: Optional[str] = ""           # RESFISCAL
    nregidtrib: Optional[str] = ""          # NREGIDTRIB
    # --- Comercial ---
    vendedor: Optional[str] = ""            # VENDEDOR
    almacen: Optional[str] = ""             # ALMACEN
    precio_venta: Optional[int] = 1         # PRECIOVTA (lista de precios)
    lista_precios: int = 1                  # compat POS
    condicion_pago: str = "contado"
    # --- Crédito ---
    credito_autorizado: bool = False        # CREDITO
    limite_credito: float = 0.0             # LIMCREDITO
    lim_descuento: Optional[float] = 0.0    # LIMDESCTO
    descuento_permanente: Optional[float] = 0.0  # % descuento fijo del cliente
    dias_credito: Optional[int] = 0         # DIASCREDIT
    saldo: Optional[float] = 0.0            # SALDO
    venta_credito: Optional[float] = 0.0    # VTACREDITO
    # --- Retenciones ---
    ret_isr: bool = False                   # RET_ISR
    ret_iva: bool = False                   # RET_IVA
    ret_isr_tasa: Optional[float] = 0.0     # RET_ISRTAS
    ret_iva_tasa: Optional[float] = 0.0     # RET_IVATAS
    # --- Estadísticas ---
    mensual: Optional[float] = 0.0          # MENSUAL
    anual: Optional[float] = 0.0            # ANUAL
    ult_fecha_compra: Optional[str] = ""    # ULTFCOMPRA
    ult_monto_compra: Optional[float] = 0.0 # ULTCCOMPRA
    # --- Otros ---
    comentario: Optional[str] = ""          # COMENTARIO
    ofertas: bool = False                   # OFERTAS

class CreditInput(BaseModel):
    credito_autorizado: bool
    limite_credito: float = 0.0

class QuickToggle(BaseModel):
    valor: bool

class AbonoInput(BaseModel):
    monto: float
    metodo: str = "efectivo"  # efectivo | tarjeta | transferencia | deposito | otros
    referencia: Optional[str] = ""
    nota: Optional[str] = ""

class CajaOpen(BaseModel):
    fondo_inicial: float = 0.0
    caja_nombre: Optional[str] = ""

class CajaOpenPorUsuario(BaseModel):
    usuario_id: str
    fondo_inicial: float = 0.0
    caja_nombre: Optional[str] = ""

class CajaMovimiento(BaseModel):
    tipo: str  # entrada | retiro | gasto | ajuste
    concepto: str
    monto: float
    referencia: Optional[str] = ""

class CajaClose(BaseModel):
    efectivo_contado: float
    caja_id: Optional[str] = None

class SaleItem(BaseModel):
    product_id: Optional[str] = None  # None para líneas sin inventario (p. ej. recargas)
    codigo: str
    descripcion: str
    cantidad: float
    unidad: str = "PZA"
    precio: float
    iva_tasa: float = 16.0
    descuento: float = 0.0  # monto de descuento por linea

class Pago(BaseModel):
    metodo: str  # efectivo | tarjeta | transferencia | deposito | otros
    monto: float

class SaleInput(BaseModel):
    cliente_id: Optional[str] = None
    items: List[SaleItem]
    descuento_global: float = 0.0
    condicion: str = "contado"  # contado | credito
    pagos: List[Pago] = Field(default_factory=list)
    lista_precios: int = 1
    tipo_venta: str = "directa"  # directa | cotizacion
    vendedor_id: Optional[str] = None
    idempotency_key: Optional[str] = None  # evita ventas duplicadas en POS
    # Override de inventario negativo (solo roles autorizados, con auditoría).
    allow_negative_inventory: bool = False
    override_reason: Optional[str] = None

class CancelInput(BaseModel):
    motivo: str

class RecargaInput(BaseModel):
    compania: str
    telefono: str
    monto: float
    metodo: str = "efectivo"
    referencia_tae: Optional[str] = ""
    comision: Optional[float] = 0.0

class SucursalItem(BaseModel):
    nombre: str = ""
    codigo: Optional[str] = ""
    direccion: Optional[str] = ""
    ciudad: Optional[str] = ""
    estado: Optional[str] = ""
    cp: Optional[str] = ""
    telefono: Optional[str] = ""
    activa: bool = True

class SettingsInput(BaseModel):
    empresa_nombre: str = "Grupo RYSA"
    rfc: Optional[str] = ""
    telefono: Optional[str] = ""
    correo: Optional[str] = ""
    direccion: Optional[str] = ""
    ciudad: Optional[str] = ""
    estado: Optional[str] = ""
    cp: Optional[str] = ""
    iva_tasa: float = 16.0
    moneda: str = "MXN"
    precios_incluyen_iva: bool = True
    listas_precios_nombres: List[str] = Field(default_factory=lambda: ["Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5"])
    listas_precios_pct: List[float] = Field(default_factory=lambda: [40, 30, 20, 15, 10])
    logo_url: Optional[str] = ""
    ticket_config: dict = Field(default_factory=dict)
    sucursales: List[SucursalItem] = Field(default_factory=list)

# =========================================================================
# INVENTARIO (KARDEX) - helper
# =========================================================================
async def registrar_movimiento(product: dict, tipo: str, entrada: float, salida: float,
                                usuario: dict, documento: str = "", referencia: str = "",
                                costo: float = 0.0, motivo: str = "", observaciones: str = ""):
    anterior = round(float(product.get("existencia", 0)), 3)
    nueva_existencia = round(anterior + entrada - salida, 3)
    await db.products.update_one({"id": product["id"]}, {"$set": {"existencia": nueva_existencia, "updated_at": iso_now()}})
    # Contador de unidades vendidas (para catálogo "más vendidos" en POS)
    if tipo == "venta" and salida > 0:
        await db.products.update_one({"id": product["id"]}, {"$inc": {"vendidas": float(salida)}})
    now = now_utc()
    await db.inventory_movements.insert_one({
        "id": uid(), "product_id": product["id"], "codigo": product.get("codigo"),
        "descripcion": product.get("descripcion"), "tipo": tipo,
        "documento": documento, "entrada": entrada, "salida": salida,
        "existencia_anterior": anterior, "existencia_resultante": nueva_existencia,
        "costo": round(float(costo or 0), 4), "motivo": motivo, "observaciones": observaciones,
        "usuario_id": usuario.get("id"), "usuario_nombre": usuario.get("name"),
        "referencia": referencia, "fecha": iso_now(),
        "hora": now.strftime("%H:%M:%S"),
    })
    return nueva_existencia

# =========================================================================
# AUTH
# =========================================================================
def public_user(u: dict) -> dict:
    u = dict(u)
    u.pop("password_hash", None)
    u.pop("_id", None)
    return u

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"

# -------------------------------------------------------------------------
# Rate limiting de login persistente en PostgreSQL (compartido entre workers).
# Tabla dedicada `login_attempts`, no un diccionario en memoria.
# -------------------------------------------------------------------------
LOGIN_IP_WINDOW_SECONDS = 60            # ventana de conteo por IP
LOGIN_IP_MAX_FAILURES = 8               # máximo de fallos por minuto y por IP
LOGIN_USER_MAX_FAILURES = 8             # fallos acumulados para bloquear el usuario
LOGIN_USER_LOCK_MINUTES = 15            # duración del bloqueo temporal
_CLEANUP_LAST_RUN = [0.0]


def _iso_to_dt(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def _cookie_secure() -> bool:
    return os.environ.get("ENVIRONMENT", "development").lower() == "production"


def set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    secure = _cookie_secure()
    response.set_cookie(ACCESS_COOKIE, access_token, httponly=True, secure=secure,
                        samesite="lax", max_age=ACCESS_TOKEN_TTL_SECONDS, path="/")
    response.set_cookie(REFRESH_COOKIE, refresh_token, httponly=True, secure=secure,
                        samesite="lax", max_age=REFRESH_TOKEN_TTL_SECONDS, path="/")


def clear_auth_cookies(response: Response):
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/")


async def store_refresh_token(token: str, user_id: str, token_version: int):
    payload = decode_token(token)
    now = now_utc()
    await db.refresh_tokens.insert_one({
        "_id": payload["jti"],
        "user_id": user_id,
        "token_hash": hash_token(token),
        "token_version": int(token_version or 0),
        "created_at": iso_now(),
        "expires_at": now + timedelta(seconds=REFRESH_TOKEN_TTL_SECONDS),
        "active": True,
    })


async def _cleanup_login_attempts():
    now = time.time()
    if now - _CLEANUP_LAST_RUN[0] < 300:
        return
    _CLEANUP_LAST_RUN[0] = now
    try:
        cutoff_ip = (now_utc() - timedelta(minutes=30)).isoformat()
        cutoff_user = (now_utc() - timedelta(hours=24)).isoformat()
        await db.login_attempts.delete_many({"kind": "ip", "last_at": {"$lt": cutoff_ip}})
        await db.login_attempts.delete_many({"kind": "user", "last_at": {"$lt": cutoff_user}})
    except Exception:
        pass


async def check_login_rate_limit(ip: str, email: str):
    if os.environ.get("LOGIN_RATE_LIMIT", "on").lower() == "off":
        return
    now = now_utc()
    doc = await db.login_attempts.find_one({"_id": "ip:" + ip})
    if doc:
        ws = _iso_to_dt(doc.get("window_start"))
        if (ws and (now - ws) < timedelta(seconds=LOGIN_IP_WINDOW_SECONDS)
                and int(doc.get("count", 0)) >= LOGIN_IP_MAX_FAILURES):
            raise HTTPException(status_code=429,
                                detail="Demasiados intentos. Intenta de nuevo en un minuto.")
    if email:
        u = await db.login_attempts.find_one({"_id": "user:" + email.lower()})
        if u:
            lu = _iso_to_dt(u.get("locked_until"))
            if lu and lu > now:
                raise HTTPException(status_code=429,
                                    detail="Cuenta temporalmente bloqueada por demasiados intentos. Intenta en unos minutos.")


async def record_failed_login(ip: str, email: str):
    now = now_utc()
    ip_key = "ip:" + ip
    doc = await db.login_attempts.find_one({"_id": ip_key})
    if doc:
        ws = _iso_to_dt(doc.get("window_start"))
        if ws and (now - ws) >= timedelta(seconds=LOGIN_IP_WINDOW_SECONDS):
            await db.login_attempts.update_one({"_id": ip_key},
                                               {"$set": {"count": 1, "window_start": iso_now(), "last_at": iso_now()}})
        else:
            await db.login_attempts.update_one({"_id": ip_key},
                                               {"$inc": {"count": 1}, "$set": {"last_at": iso_now()}})
    else:
        await db.login_attempts.insert_one({"_id": ip_key, "kind": "ip", "count": 1,
                                            "window_start": iso_now(), "last_at": iso_now()})
    if email:
        ukey = "user:" + email.lower()
        u = await db.login_attempts.find_one({"_id": ukey})
        fails = int((u or {}).get("fails", 0)) + 1
        locked_until = None
        if fails >= LOGIN_USER_MAX_FAILURES:
            locked_until = (now + timedelta(minutes=LOGIN_USER_LOCK_MINUTES)).isoformat()
        await db.login_attempts.update_one({"_id": ukey},
                                           {"$set": {"kind": "user", "fails": fails,
                                                     "locked_until": locked_until, "last_at": iso_now()}},
                                           upsert=True)


async def reset_login_failures(email: str):
    if email:
        await db.login_attempts.delete_one({"_id": "user:" + email.lower()})


def _password_ok(password: str) -> bool:
    return bool(password) and len(password) >= 12


@api.post("/auth/login")
async def login(data: LoginInput, response: Response, request: Request):
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")
    email = data.email.strip().lower()
    await _cleanup_login_attempts()
    await check_login_rate_limit(ip, email)

    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user["password_hash"]):
        await record_failed_login(ip, email)
        await log_audit({"id": None, "name": email or "?"}, "LOGIN_FAILURE", "auth",
                        detalle=(email or "sin correo"), ip=ip, user_agent=ua)
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")
    if not user.get("active", True):
        await log_audit({"id": user.get("id"), "name": user.get("name")}, "LOGIN_FAILURE", "auth",
                        registro_id=user.get("id"), detalle=f"Usuario desactivado", ip=ip, user_agent=ua)
        raise HTTPException(status_code=403, detail="Usuario desactivado")

    await reset_login_failures(email)
    token_version = int(user.get("token_version", 0))
    access = create_access_token(user["id"], user["email"], token_version)
    refresh = create_refresh_token(user["id"], token_version)
    await store_refresh_token(refresh, user["id"], token_version)
    set_auth_cookies(response, access, refresh)
    await log_audit(user, "LOGIN_SUCCESS", "auth", registro_id=user["id"],
                    detalle=f"IP {ip}", ip=ip, user_agent=ua)
    return {"token": access, "user": public_user(user)}


@api.post("/auth/refresh")
async def refresh_session(response: Response, request: Request):
    rt = request.cookies.get(REFRESH_COOKIE)
    if not rt:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Sesión expirada")
    try:
        payload = decode_token(rt)
    except jwt.ExpiredSignatureError:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Sesión expirada")
    except Exception:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Token inválido")
    if payload.get("type") != "refresh":
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Token inválido")

    jti = payload.get("jti")
    record = await db.refresh_tokens.find_one({"_id": jti, "active": True})
    if not record:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Sesión expirada")

    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user or not user.get("active", True):
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Sesión expirada")
    token_version = int(user.get("token_version", 0))
    if token_version != int(payload.get("token_version", 0)):
        await db.refresh_tokens.update_one({"_id": jti}, {"$set": {"active": False, "revoked_at": iso_now()}})
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Sesión invalidada")

    # Rotación: se revoca el refresh actual y se emite uno nuevo (nunca en localStorage).
    await db.refresh_tokens.update_one({"_id": jti}, {"$set": {"active": False, "rotated_at": iso_now()}})
    access = create_access_token(user["id"], user["email"], token_version)
    new_refresh = create_refresh_token(user["id"], token_version)
    await store_refresh_token(new_refresh, user["id"], token_version)
    set_auth_cookies(response, access, new_refresh)
    return {"token": access}


@api.post("/auth/logout")
async def logout(response: Response, request: Request):
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")
    usuario = None
    rt = request.cookies.get(REFRESH_COOKIE)
    if rt:
        try:
            payload = decode_token(rt)
            if payload.get("type") == "refresh":
                await db.refresh_tokens.update_one(
                    {"_id": payload.get("jti"), "active": True},
                    {"$set": {"active": False, "revoked_at": iso_now()}})
                user_doc = await db.users.find_one({"id": payload.get("sub")})
                if user_doc:
                    usuario = user_doc
        except Exception:
            pass
    clear_auth_cookies(response)
    if usuario:
        await log_audit(usuario, "LOGOUT", "auth", registro_id=usuario["id"], ip=ip, user_agent=ua)
    return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": user, "permissions": sorted(effective_permissions(user))}

# =========================================================================
# USUARIOS
# =========================================================================
def _validar_modulos(modulos: List[str]):
    desconocidos = [m for m in modulos if m not in MODULES]
    if desconocidos:
        raise HTTPException(400, f"Módulos desconocidos: {', '.join(desconocidos)}")

@api.get("/users")
async def list_users(user: dict = Depends(require_permission("usuarios.ver"))):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(500)
    return users

@api.post("/users")
async def create_user(data: UserCreate, user: dict = Depends(require_permission("usuarios.crear"))):
    _validar_modulos(data.modulos)
    if not _password_ok(data.password):
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 12 caracteres")
    if data.role in ADMIN_SYSTEM_ROLES or data.modulos:
        if not es_admin_sistema(user):
            raise HTTPException(403, "Solo administradores/propietario pueden asignar roles privilegiados o módulos")
    email = data.email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="El correo ya está registrado")
    # Módulos: si el rol no es privilegiado y no se especifican, se otorgan los
    # módulos por defecto (Productos, Inventario, Clientes, Recargas, Ventas,
    # Caja, Reportes). Solo un admin/propietario puede especificarlos a mano.
    modulos = data.modulos
    if not es_rol_privilegiado(data.role) and not modulos:
        modulos = DEFAULT_MODULES_NON_PRIVILEGED
    sucursal_id = data.sucursal_id or await _default_sucursal_id()
    doc = {"id": uid(), "email": email, "name": data.name, "role": data.role,
           "modulos": modulos, "password_hash": hash_password(data.password),
           "sucursal_id": sucursal_id, "active": True, "token_version": 0, "created_at": iso_now()}
    await db.users.insert_one(doc)
    await log_audit(user, "crear", "usuario", doc["id"],
                    f"Usuario {email} · rol {data.role} · {'+'.join(modulos) or 'sin módulos'}")
    return public_user(doc)

@api.put("/users/{user_id}")
async def update_user(user_id: str, data: UserUpdate, user: dict = Depends(require_permission("usuarios.editar"))):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(404, "Usuario no encontrado")
    rol_privilegiado = target.get("role") in ADMIN_SYSTEM_ROLES
    cambia_a_admin = data.role in ADMIN_SYSTEM_ROLES if data.role else False
    toca_modulos = data.modulos is not None
    if rol_privilegiado or cambia_a_admin or toca_modulos:
        if not es_admin_sistema(user):
            raise HTTPException(403, "Solo administradores/propietario pueden editar administradores o asignar módulos")
    upd = {k: v for k, v in data.model_dump().items() if v is not None}
    if "modulos" in upd:
        _validar_modulos(upd["modulos"])
    cambia_password = "password" in upd
    if cambia_password:
        if not _password_ok(upd["password"]):
            raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 12 caracteres")
        upd["password_hash"] = hash_password(upd.pop("password"))
    cambia_rol = "role" in upd and upd["role"] != target.get("role")
    desactiva = "active" in upd and upd["active"] is False and target.get("active", True)
    await db.users.update_one({"id": user_id}, {"$set": upd})
    if cambia_password or cambia_rol or desactiva:
        # Invalidar todas las sesiones anteriores del usuario objetivo.
        await revoke_user_sessions(user_id)
        if cambia_password:
            await log_audit(user, "PASSWORD_CHANGE", "usuario", user_id)
        if desactiva:
            await log_audit(user, "ACCOUNT_DISABLED", "usuario", user_id)
        await log_audit(user, "TOKEN_REVOKED", "usuario", user_id,
                        "Sesiones invalidadas por cambio de password/rol o desactivación")
    await log_audit(user, "editar", "usuario", user_id, f"campos: {', '.join(sorted(upd))}")
    return await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})

@api.get("/roles")
async def list_roles(user: dict = Depends(get_current_user)):
    return {
        "roles": {r: sorted(p) for r, p in ROLE_PERMISSIONS.items()},
        "modulos": {k: v["label"] for k, v in MODULES.items()},
    }

# =========================================================================
# PRODUCTOS
# =========================================================================
def calc_precios(costo: float, precios: List[dict], iva_tasa: float) -> List[dict]:
    out = []
    for p in precios:
        util = float(p.get("utilidad_pct", 0) or 0)
        if p.get("precio_sin_iva"):
            sin_iva = float(p["precio_sin_iva"])
            con_iva = round(sin_iva * (1 + iva_tasa / 100), 2)
        elif p.get("precio_con_iva"):
            con_iva = float(p["precio_con_iva"])
            sin_iva = round(con_iva / (1 + iva_tasa / 100), 2)
            util = round((sin_iva / costo - 1) * 100, 2) if costo else util
        else:
            sin_iva = round(costo * (1 + util / 100), 2)
            con_iva = round(sin_iva * (1 + iva_tasa / 100), 2)
        out.append({"nombre": p.get("nombre", "Precio"), "utilidad_pct": util,
                    "precio_sin_iva": sin_iva, "precio_con_iva": round(con_iva, 2)})
    return out

@api.get("/products")
async def list_products(response: Response, estado: Optional[str] = None, q: Optional[str] = None,
                        filtro: Optional[str] = None, categoria: Optional[str] = None,
                        skip: int = 0, limit: int = 100,
                        user: dict = Depends(get_current_user)):
    limit = max(1, min(int(limit), 500))
    skip = max(0, int(skip))
    query = {}
    if estado:
        query["estado"] = estado
    if categoria:
        query["clasificacion"] = categoria
    if q:
        rx = {"$regex": sanitize_search_term(q), "$options": "i"}
        query["$or"] = [{"codigo": rx}, {"descripcion": rx}, {"sku": rx},
                        {"linea": rx}, {"clasificacion": rx}, {"sinonimos": rx},
                        {"codigos_barras": rx}]
    if filtro in ("bajo_stock", "sin_existencia"):
        docs = await db.products.find(query, {"_id": 0}).sort("descripcion", 1).to_list(20000)
        if filtro == "bajo_stock":
            docs = [p for p in docs if 0 < float(p.get("existencia", 0)) <= float(p.get("stock_minimo", 0))]
        else:
            docs = [p for p in docs if float(p.get("existencia", 0)) <= 0]
        total = len(docs)
        docs = docs[skip:skip + limit]
    else:
        total = await db.products.count_documents(query)
        docs = await db.products.find(query, {"_id": 0}).sort("descripcion", 1).skip(skip).limit(limit).to_list(limit)
    response.headers["X-Total-Count"] = str(total)
    return docs

# --- Catálogo POS: más vendidos y favoritos por usuario ---
@api.get("/products/bestsellers")
async def list_bestsellers(estado: Optional[str] = None, limit: int = 24,
                           user: dict = Depends(get_current_user)):
    limit = max(1, min(int(limit), 100))
    query = {"vendidas": {"$gt": 0}}
    if estado:
        query["estado"] = estado
    docs = await db.products.find(query, {"_id": 0}).sort("vendidas", -1).limit(limit).to_list(limit)
    return docs

@api.get("/favorites")
async def list_favorites(user: dict = Depends(get_current_user)):
    favs = await db.favorites.find({"user_id": user["id"]}, {"_id": 0, "product_id": 1}).to_list(5000)
    ids = [f["product_id"] for f in favs]
    if not ids:
        return []
    products = await db.products.find({"id": {"$in": ids}, "estado": "activo"}, {"_id": 0}).to_list(5000)
    by_id = {p["id"]: p for p in products}
    return [by_id[i] for i in ids if i in by_id]

@api.post("/favorites/{product_id}")
async def add_favorite(product_id: str, user: dict = Depends(get_current_user)):
    p = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Producto no encontrado")
    exists = await db.favorites.find_one({"user_id": user["id"], "product_id": product_id})
    if not exists:
        await db.favorites.insert_one({"id": uid(), "user_id": user["id"], "product_id": product_id,
                                       "fecha": iso_now()})
    return {"ok": True}

@api.delete("/favorites/{product_id}")
async def remove_favorite(product_id: str, user: dict = Depends(get_current_user)):
    await db.favorites.delete_one({"user_id": user["id"], "product_id": product_id})
    return {"ok": True}

@api.get("/products/{product_id}")
async def get_product(product_id: str, user: dict = Depends(get_current_user)):
    p = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Producto no encontrado")
    return p

@api.post("/products")
async def create_product(data: ProductInput, user: dict = Depends(require_permission("producto.crear"))):
    codigo = (data.codigo or "").strip() or await next_counter("producto", "P", 5)
    if await db.products.find_one({"codigo": codigo}):
        raise HTTPException(400, "El código ya existe")
    doc = data.model_dump()
    doc["codigo"] = codigo
    doc["id"] = uid()
    doc["precios"] = calc_precios(doc["costo"], doc["precios"], doc["iva_tasa"])
    doc["created_at"] = iso_now()
    doc["updated_at"] = iso_now()
    existencia_inicial = float(doc.get("existencia", 0))
    doc["existencia"] = 0
    await db.products.insert_one(doc)
    if existencia_inicial > 0:
        await registrar_movimiento(doc, "entrada", existencia_inicial, 0, user, "Alta inicial")
    await log_audit(user, "crear", "producto", doc["id"], f"{codigo} - {doc['descripcion']}")
    return await db.products.find_one({"id": doc["id"]}, {"_id": 0})

@api.put("/products/{product_id}")
async def update_product(product_id: str, data: ProductInput, user: dict = Depends(require_permission("producto.editar"))):
    existing = await db.products.find_one({"id": product_id})
    if not existing:
        raise HTTPException(404, "Producto no encontrado")
    doc = data.model_dump()
    doc.pop("existencia", None)  # existencia solo cambia por movimientos
    doc["codigo"] = existing["codigo"]
    doc["precios"] = calc_precios(doc["costo"], doc["precios"], doc["iva_tasa"])
    doc["updated_at"] = iso_now()
    await db.products.update_one({"id": product_id}, {"$set": doc})
    await log_audit(user, "editar", "producto", product_id, existing["codigo"])
    return await db.products.find_one({"id": product_id}, {"_id": 0})

@api.patch("/products/{product_id}/estado")
async def change_estado(product_id: str, estado: str, user: dict = Depends(require_permission("producto.baja"))):
    await db.products.update_one({"id": product_id}, {"$set": {"estado": estado, "updated_at": iso_now()}})
    await log_audit(user, "cambio_estado", "producto", product_id, f"estado={estado}")
    return await db.products.find_one({"id": product_id}, {"_id": 0})

@api.get("/products/{product_id}/movimientos")
async def product_movements(product_id: str, user: dict = Depends(get_current_user)):
    movs = await db.inventory_movements.find({"product_id": product_id}, {"_id": 0}).sort("fecha", 1).to_list(1000)
    return movs

@api.post("/products/{product_id}/ajuste")
async def adjust_inventory(product_id: str, data: InventoryAdjust, user: dict = Depends(require_permission("inventario.ajuste"))):
    p = await db.products.find_one({"id": product_id})
    if not p:
        raise HTTPException(404, "Producto no encontrado")
    entrada = salida = 0.0
    if data.tipo in ("entrada", "devolucion"):
        entrada = abs(data.cantidad)
    elif data.tipo in ("salida", "merma"):
        salida = abs(data.cantidad)
    elif data.tipo in ("ajuste", "correccion"):
        # ajuste/corrección puede ser + o -
        if data.cantidad >= 0:
            entrada = data.cantidad
        else:
            salida = abs(data.cantidad)
    else:
        raise HTTPException(400, "Tipo de movimiento inválido")
    costo = float(data.costo) if (data.costo and float(data.costo) > 0) else float(p.get("costo", 0) or 0)
    nueva = await registrar_movimiento(p, data.tipo, entrada, salida, user, data.documento,
                                       data.concepto, costo=costo, motivo=data.motivo or "",
                                       observaciones=data.observaciones or "")
    await log_audit(user, "ajuste_inventario", "producto", product_id, f"{data.tipo} {data.cantidad}")
    return {"existencia": nueva}

@api.get("/inventory/movements")
async def inventory_movements(tipo: Optional[str] = None, q: Optional[str] = None,
                              desde: Optional[str] = None, hasta: Optional[str] = None,
                              skip: int = 0, limit: int = 200,
                              user: dict = Depends(get_current_user)):
    limit = max(1, min(int(limit), 500))
    skip = max(0, int(skip))
    query: dict = {}
    if tipo and tipo != "all":
        query["tipo"] = tipo
    if q:
        rx = {"$regex": sanitize_search_term(q), "$options": "i"}
        query["$or"] = [{"codigo": rx}, {"descripcion": rx}, {"documento": rx}, {"usuario_nombre": rx}]
    if desde or hasta:
        rango: dict = {}
        if desde:
            rango["$gte"] = desde
        if hasta:
            rango["$lte"] = hasta + "T23:59:59"
        query["fecha"] = rango
    total = await db.inventory_movements.count_documents(query)
    docs = await db.inventory_movements.find(query, {"_id": 0}).sort("fecha", -1).skip(skip).limit(limit).to_list(limit)
    return {"total": total, "movimientos": docs}

# =========================================================================
# CATEGORÍAS
# =========================================================================
class CategoryInput(BaseModel):
    nombre: str
    clave: Optional[str] = ""
    descripcion: Optional[str] = ""
    ficha_tecnica: Optional[str] = ""
    imagen_url: Optional[str] = ""

@api.get("/categories")
async def list_categories(user: dict = Depends(get_current_user)):
    counts = {}
    async for r in db.products.aggregate([
        {"$match": {"clasificacion": {"$nin": ["", None]}}},
        {"$group": {"_id": "$clasificacion", "count": {"$sum": 1}}},
    ]):
        counts[r["_id"]] = r["count"]
    managed = {}
    async for c in db.categories.find({}, {"_id": 0}):
        managed[c["nombre"]] = c
    nombres = set(counts) | set(managed)
    out = []
    for n in sorted(nombres):
        m = managed.get(n, {})
        out.append({"nombre": n, "clave": m.get("clave", ""), "descripcion": m.get("descripcion", ""),
                    "ficha_tecnica": m.get("ficha_tecnica", ""), "imagen_url": m.get("imagen_url", ""),
                    "count": counts.get(n, 0)})
    return out

@api.post("/categories")
async def upsert_category(data: CategoryInput, user: dict = Depends(require_permission("producto.editar"))):
    if not data.nombre.strip():
        raise HTTPException(400, "El nombre es obligatorio")
    doc = data.model_dump()
    doc["updated_at"] = iso_now()
    await db.categories.update_one({"nombre": data.nombre}, {"$set": doc}, upsert=True)
    await log_audit(user, "editar", "categoria", data.nombre, "Categoría actualizada")
    return {"ok": True, "nombre": data.nombre}

# =========================================================================
# CLIENTES
# =========================================================================
# Mapeo de la estructura DBF heredada -> campos internos (nombre, tipo)
# tipo: text | num | int | bool | date
CLIENT_IMPORT_MAP = {
    "CLAVE": ("codigo", "text"), "NOMBRE": ("nombre", "text"),
    "CONTRASENA": ("contrasena", "text"), "REPRESENTA": ("representa", "text"),
    "TELOFICINA": ("tel_oficina", "text"), "TELRESIDEN": ("tel_residencia", "text"),
    "TEL_FAX": ("tel_fax", "text"), "CELULAR": ("celular", "text"),
    "DIRECCION": ("direccion", "text"), "NOINTERIOR": ("numero_interior", "text"),
    "NOEXTERIOR": ("numero_exterior", "text"), "COLONIA": ("colonia", "text"),
    "CIUDADEDO": ("ciudad_edo", "text"), "LOCALIDAD": ("localidad", "text"),
    "REFERENCIA": ("referencias", "text"), "CIUDAD": ("ciudad", "text"),
    "ESTADO": ("estado_geo", "text"), "PAIS": ("pais", "text"),
    "ID_LOCALID": ("id_localidad", "text"), "ID_COLONIA": ("id_colonia", "text"),
    "ID_CIUDAD": ("id_ciudad", "text"), "ID_ESTADO": ("id_estado", "text"),
    "ID_PAIS": ("id_pais", "text"), "RESFISCAL": ("resfiscal", "text"),
    "NREGIDTRIB": ("nregidtrib", "text"), "CODPOSTAL": ("cp", "text"),
    "RFC": ("rfc", "text"), "ALMACEN": ("almacen", "text"),
    "FECHAALTA": ("fecha_alta", "date"), "VENDEDOR": ("vendedor", "text"),
    "PRECIOVTA": ("precio_venta", "int"), "TIPO": ("tipo_clave", "text"),
    "SALDO": ("saldo", "num"), "MENSUAL": ("mensual", "num"), "ANUAL": ("anual", "num"),
    "CREDITO": ("credito_autorizado", "bool"), "RET_ISR": ("ret_isr", "bool"),
    "RET_IVA": ("ret_iva", "bool"), "RET_ISRTAS": ("ret_isr_tasa", "num"),
    "RET_IVATAS": ("ret_iva_tasa", "num"), "LIMDESCTO": ("lim_descuento", "num"),
    "LIMCREDITO": ("limite_credito", "num"), "DIASCREDIT": ("dias_credito", "int"),
    "VTACREDITO": ("venta_credito", "num"), "ULTFCOMPRA": ("ult_fecha_compra", "date"),
    "ULTCCOMPRA": ("ult_monto_compra", "num"), "COMENTARIO": ("comentario", "text"),
    "USOCFDI": ("uso_cfdi", "text"), "REGFISCAL": ("reg_fiscal", "text"),
    "STATUS": ("status", "text"), "OFERTAS": ("ofertas", "bool"), "CORREOS": ("correos", "text"),
}
CLIENT_LEGACY_ORDER = list(CLIENT_IMPORT_MAP.keys())
RFC_RE = re.compile(r"^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

def _to_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    s = str(v).strip().upper()
    return s in ("1", "TRUE", "T", ".T.", "SI", "SÍ", "S", "X", "Y", "YES", "VERDADERO")

def _to_num(v) -> float:
    if v is None or v == "":
        return 0.0
    try:
        return float(str(v).replace(",", "").replace("$", "").strip())
    except Exception:
        return 0.0

def _to_date(v) -> str:
    s = str(v).strip()
    if not s or s.lower() in ("nan", "nat", "none"):
        return ""
    return s[:10] if len(s) >= 10 and s[4] in "-/" else s

def legacy_status_to_estado(s: str) -> str:
    c = (s or "").strip().upper()[:1]
    if c == "S":
        return "suspendido"
    if c in ("B", "I", "C"):
        return "inactivo"
    return "activo"

def normalize_client_doc(doc: dict) -> dict:
    """Sincroniza campos derivados/compat sin romper POS."""
    doc["lista_precios"] = int(doc.get("precio_venta") or doc.get("lista_precios") or 1)
    if not doc.get("telefono"):
        doc["telefono"] = doc.get("tel_oficina") or doc.get("tel_residencia") or ""
    if not doc.get("correo") and doc.get("correos"):
        doc["correo"] = str(doc["correos"]).split(",")[0].split(";")[0].strip()
    return doc

def parse_client_row(row: dict):
    """Convierte una fila (headers legacy en mayúsculas) a doc interno + errores."""
    data, errores = {}, []
    for legacy, (field, kind) in CLIENT_IMPORT_MAP.items():
        if legacy not in row:
            continue
        raw = row.get(legacy, "")
        if kind == "bool":
            data[field] = _to_bool(raw)
        elif kind == "num":
            data[field] = round(_to_num(raw), 4)
        elif kind == "int":
            data[field] = int(_to_num(raw))
        elif kind == "date":
            data[field] = _to_date(raw)
        else:
            data[field] = str(raw).strip()
    if data.get("status"):
        data["estado"] = legacy_status_to_estado(data["status"])
    clave = data.get("codigo", "").strip()
    if not clave:
        errores.append({"campo": "CLAVE", "valor": "", "motivo": "CLAVE es obligatoria"})
    if not data.get("nombre", "").strip():
        errores.append({"campo": "NOMBRE", "valor": "", "motivo": "NOMBRE es obligatorio"})
    rfc = data.get("rfc", "").strip().upper()
    if rfc and not RFC_RE.match(rfc):
        errores.append({"campo": "RFC", "valor": rfc, "motivo": "RFC con formato inválido"})
    correo = data.get("correo") or (str(data.get("correos", "")).split(",")[0].strip())
    if correo and not EMAIL_RE.match(correo):
        errores.append({"campo": "CORREOS", "valor": correo, "motivo": "Correo con formato inválido"})
    for f in ("limite_credito", "saldo", "dias_credito"):
        if data.get(f, 0) < 0:
            errores.append({"campo": f, "valor": data.get(f), "motivo": "No puede ser negativo"})
    return data, errores


@api.get("/clients")
async def list_clients(q: Optional[str] = None, estado: Optional[str] = None,
                       tipo: Optional[str] = None, filtro: Optional[str] = None,
                       user: dict = Depends(get_current_user)):
    query = {}
    if estado:
        query["estado"] = estado
    if tipo:
        query["tipo"] = tipo
    # Filtros rápidos
    if filtro == "con_credito":
        query["credito_autorizado"] = True
    elif filtro == "sin_credito":
        query["credito_autorizado"] = {"$ne": True}
    elif filtro == "con_saldo":
        query["saldo"] = {"$gt": 0}
    elif filtro == "sin_saldo":
        query["$or"] = [{"saldo": {"$lte": 0}}, {"saldo": {"$exists": False}}]
    elif filtro in ("activo", "suspendido", "inactivo"):
        query["estado"] = filtro
    elif filtro == "con_ofertas":
        query["ofertas"] = True
    elif filtro == "sin_ofertas":
        query["ofertas"] = {"$ne": True}
    if q:
        rx = {"$regex": sanitize_search_term(q), "$options": "i"}
        query["$and"] = query.get("$and", []) + [{"$or": [
            {"codigo": rx}, {"nombre": rx}, {"razon_social": rx}, {"rfc": rx},
            {"representa": rx}, {"telefono": rx}, {"tel_oficina": rx}, {"celular": rx},
            {"correo": rx}, {"correos": rx}, {"ciudad": rx}, {"estado_geo": rx}]}]
    clients = await db.clients.find(query, {"_id": 0}).sort("nombre", 1).to_list(5000)
    now = now_utc()
    mes = now.strftime("%Y-%m")
    anio = str(now.year)
    sales = await db.sales.find({"estado": "confirmada"}, {"_id": 0, "cliente_id": 1, "total": 1, "fecha": 1}).to_list(20000)
    mes_map, anio_map = {}, {}
    for s in sales:
        cid = s.get("cliente_id")
        if not cid:
            continue
        f = s.get("fecha", "")
        if f[:7] == mes:
            mes_map[cid] = mes_map.get(cid, 0) + s["total"]
        if f[:4] == anio:
            anio_map[cid] = anio_map.get(cid, 0) + s["total"]
    for c in clients:
        c["compras_mes"] = round(mes_map.get(c["id"], 0), 2)
        c["compras_anio"] = round(anio_map.get(c["id"], 0), 2)
        c["credito_disponible"] = round(float(c.get("limite_credito", 0)) - float(c.get("saldo", 0)), 2)
    return clients

@api.post("/clients")
async def create_client(data: ClientInput, user: dict = Depends(require_permission("cliente.crear"))):
    codigo = (data.codigo or "").strip() or await next_counter("cliente", "C", 5)
    if await db.clients.find_one({"codigo": codigo}):
        raise HTTPException(400, f"La CLAVE '{codigo}' ya existe")
    doc = normalize_client_doc(data.model_dump())
    doc["codigo"] = codigo
    doc["id"] = uid()
    doc["saldo"] = float(data.saldo or 0.0)
    doc["created_at"] = iso_now()
    await db.clients.insert_one(doc)
    await log_audit(user, "crear", "cliente", doc["id"], doc["nombre"])
    return await db.clients.find_one({"id": doc["id"]}, {"_id": 0})

@api.put("/clients/{client_id}")
async def update_client(client_id: str, data: ClientInput, user: dict = Depends(require_permission("cliente.editar"))):
    existing = await db.clients.find_one({"id": client_id})
    if not existing:
        raise HTTPException(404, "Cliente no encontrado")
    doc = normalize_client_doc(data.model_dump())
    doc["codigo"] = existing["codigo"]
    doc["saldo"] = existing.get("saldo", 0.0)  # saldo lo gobiernan las ventas, no la edición
    await db.clients.update_one({"id": client_id}, {"$set": doc})
    await log_audit(user, "editar", "cliente", client_id)
    return await db.clients.find_one({"id": client_id}, {"_id": 0})

@api.patch("/clients/{client_id}/estado")
async def client_estado(client_id: str, estado: str, user: dict = Depends(require_permission("cliente.baja"))):
    await db.clients.update_one({"id": client_id}, {"$set": {"estado": estado}})
    await log_audit(user, "cambio_estado", "cliente", client_id, f"estado={estado}")
    return await db.clients.find_one({"id": client_id}, {"_id": 0})

@api.patch("/clients/{client_id}/credito-toggle")
async def toggle_credito(client_id: str, data: QuickToggle, user: dict = Depends(require_permission("credito.autorizar"))):
    c = await db.clients.find_one({"id": client_id})
    if not c:
        raise HTTPException(404, "Cliente no encontrado")
    await db.clients.update_one({"id": client_id}, {"$set": {"credito_autorizado": data.valor}})
    await log_audit(user, "editar", "cliente", client_id, f"crédito {'habilitado' if data.valor else 'deshabilitado'}")
    return await db.clients.find_one({"id": client_id}, {"_id": 0})

@api.patch("/clients/{client_id}/credito")
async def set_credito(client_id: str, data: CreditInput, user: dict = Depends(require_permission("credito.autorizar"))):
    c = await db.clients.find_one({"id": client_id})
    if not c:
        raise HTTPException(404, "Cliente no encontrado")
    await db.clients.update_one({"id": client_id}, {"$set": {
        "credito_autorizado": data.credito_autorizado, "limite_credito": data.limite_credito}})
    await log_audit(user, "editar", "cliente", client_id, f"crédito autorizado={data.credito_autorizado} límite={data.limite_credito}")
    return await db.clients.find_one({"id": client_id}, {"_id": 0})

# =========================================================================
# CAJA
# =========================================================================
async def _default_sucursal_id() -> Optional[str]:
    """Devuelve la sucursal activa por defecto (la primera). Crea "Matriz" si no hay."""
    s = await db.sucursales.find_one({"activa": True}, {"_id": 0})
    if s:
        return s["id"]
    # Compatibilidad con la semilla cosmética previa en settings.sucursales.
    st = await db.settings.find_one({"_id": "app"}, {"_id": 0})
    nombre = "Matriz"
    for su in (st or {}).get("sucursales", []):
        if su.get("activa"):
            nombre = su.get("nombre", "Matriz")
            break
    doc = {"id": uid(), "codigo": "MATRIZ", "nombre": nombre, "activa": True,
           "direccion": "", "ciudad": "", "estado": "", "cp": "", "telefono": "",
           "created_at": iso_now()}
    await db.sucursales.insert_one(doc)
    return doc["id"]

async def caja_abierta_de(user_id: str):
    return await db.cajas.find_one({"usuario_id": user_id, "estado": "abierta"}, {"_id": 0})

async def asignar_caja_numero(target: dict) -> int:
    """Asigna una sola vez un número de caja único por usuario (sin repetir).
    El rol administrador/propietario nunca recibe el número 1."""
    num = target.get("caja_numero")
    if not num:
        used = set()
        async for u in db.users.find({"active": True, "caja_numero": {"$exists": True}},
                                     {"id": 1, "caja_numero": 1}):
            if u["id"] != target.get("id"):
                used.add(u["caja_numero"])
        num = 1
        while True:
            if num in used:
                num += 1
                continue
            if target.get("role") in ADMIN_SYSTEM_ROLES and num == 1:
                num += 1
                continue
            break
        await db.users.update_one({"id": target["id"]}, {"$set": {"caja_numero": num}})
    return int(num)

@api.get("/caja/actual")
async def caja_actual(user: dict = Depends(get_current_user)):
    caja = await caja_abierta_de(user["id"])
    if not caja:
        return {"caja": None}
    movs = await db.caja_movimientos.find({"caja_id": caja["id"]}, {"_id": 0}).sort("fecha", 1).to_list(1000)
    return {"caja": caja, "movimientos": movs, "resumen": resumen_caja(caja, movs)}

def resumen_caja(caja: dict, movs: List[dict]) -> dict:
    ventas_efectivo = sum(m["monto"] for m in movs if m["tipo"] == "venta")
    entradas = sum(m["monto"] for m in movs if m["tipo"] == "entrada")
    retiros = sum(m["monto"] for m in movs if m["tipo"] in ("retiro", "gasto"))
    devoluciones = sum(m["monto"] for m in movs if m["tipo"] == "devolucion")
    esperado = round(caja["fondo_inicial"] + ventas_efectivo + entradas - retiros - devoluciones, 2)
    return {"fondo_inicial": caja["fondo_inicial"], "ventas_efectivo": round(ventas_efectivo, 2),
            "entradas": round(entradas, 2), "retiros": round(retiros, 2),
            "devoluciones": round(devoluciones, 2), "efectivo_esperado": esperado}

@api.post("/caja/abrir")
async def abrir_caja(data: CajaOpen, user: dict = Depends(require_permission("caja.abrir"))):
    if await caja_abierta_de(user["id"]):
        raise HTTPException(400, "Ya tienes una caja abierta")
    caja_numero = user.get("caja_numero")
    if (data.caja_nombre or "").strip():
        nombre = data.caja_nombre.strip()
    else:
        caja_numero = await asignar_caja_numero(user)
        nombre = f"Caja {caja_numero}"
    doc = {"id": uid(), "usuario_id": user["id"], "usuario_nombre": user["name"],
           "caja_nombre": nombre, "caja_numero": caja_numero, "fondo_inicial": data.fondo_inicial,
           "sucursal_id": user.get("sucursal_id") or await _default_sucursal_id(),
           "estado": "abierta", "fecha_apertura": iso_now(), "fecha_cierre": None}
    await db.cajas.insert_one(doc)
    await log_audit(user, "abrir_caja", "caja", doc["id"], f"fondo {data.fondo_inicial}")
    return await db.cajas.find_one({"id": doc["id"]}, {"_id": 0})

@api.post("/caja/abrir-por-usuario")
async def abrir_caja_por_usuario(data: CajaOpenPorUsuario, user: dict = Depends(get_current_user)):
    if not es_admin_sistema(user):
        raise HTTPException(403, "Solo administradores/propietario pueden abrir cajas de otros usuarios")
    target = await db.users.find_one({"id": data.usuario_id})
    if not target or not target.get("active", True):
        raise HTTPException(404, "Usuario no encontrado o desactivado")
    if await caja_abierta_de(data.usuario_id):
        raise HTTPException(400, f"{target['name']} ya tiene una caja abierta")
    caja_numero = target.get("caja_numero")
    if (data.caja_nombre or "").strip():
        nombre = data.caja_nombre.strip()
    else:
        caja_numero = await asignar_caja_numero(target)
        nombre = f"Caja {caja_numero}"
    doc = {"id": uid(), "usuario_id": data.usuario_id, "usuario_nombre": target["name"],
           "caja_nombre": nombre, "caja_numero": caja_numero, "fondo_inicial": data.fondo_inicial,
           "sucursal_id": target.get("sucursal_id") or await _default_sucursal_id(),
           "estado": "abierta", "fecha_apertura": iso_now(), "fecha_cierre": None}
    await db.cajas.insert_one(doc)
    await log_audit(user, "abrir_caja_por_usuario", "caja", doc["id"],
                    f"{target['name']} fondo {data.fondo_inicial}")
    return await db.cajas.find_one({"id": doc["id"]}, {"_id": 0})

@api.post("/caja/movimiento")
async def caja_movimiento(data: CajaMovimiento, user: dict = Depends(require_permission("caja.entrada"))):
    caja = await caja_abierta_de(user["id"])
    if not caja:
        raise HTTPException(400, "No tienes caja abierta")
    doc = {"id": uid(), "caja_id": caja["id"], "tipo": data.tipo, "concepto": data.concepto,
           "monto": abs(data.monto), "referencia": data.referencia,
           "usuario_id": user["id"], "usuario_nombre": user["name"], "fecha": iso_now()}
    await db.caja_movimientos.insert_one(doc)
    await log_audit(user, "caja_movimiento", "caja", caja["id"], f"{data.tipo} {data.monto}")
    return {"ok": True}

@api.post("/caja/cerrar")
async def cerrar_caja(data: CajaClose, user: dict = Depends(require_permission("caja.cerrar"))):
    if data.caja_id:
        if not es_admin_sistema(user):
            raise HTTPException(403, "Solo administradores/propietario pueden cerrar cajas de otros usuarios")
        caja = await db.cajas.find_one({"id": data.caja_id})
        if not caja:
            raise HTTPException(404, "Caja no encontrada")
        if caja.get("estado") != "abierta":
            raise HTTPException(400, "La caja ya está cerrada")
    else:
        caja = await caja_abierta_de(user["id"])
        if not caja:
            raise HTTPException(400, "No tienes caja abierta")
    movs = await db.caja_movimientos.find({"caja_id": caja["id"]}, {"_id": 0}).to_list(1000)
    res = resumen_caja(caja, movs)
    diferencia = round(data.efectivo_contado - res["efectivo_esperado"], 2)
    cierre = {**res, "efectivo_contado": data.efectivo_contado, "diferencia": diferencia}
    await db.cajas.update_one({"id": caja["id"]}, {"$set": {
        "estado": "cerrada", "fecha_cierre": iso_now(), "cierre": cierre}})
    await log_audit(user, "cerrar_caja", "caja", caja["id"], f"diferencia {diferencia}")
    return {"cierre": cierre}

@api.get("/caja/operadores")
async def caja_operadores(user: dict = Depends(require_permission("caja.ver"))):
    if not es_admin_sistema(user):
        raise HTTPException(403, "Solo administradores/propietario pueden ver el estado global de cajas")
    usuarios = await db.users.find({"active": True}, {"_id": 0, "password_hash": 0}).to_list(1000)
    abiertas_por_usuario = {}
    cursor = db.cajas.find({"estado": "abierta"}, {"_id": 0})
    async for c in cursor:
        abiertas_por_usuario.setdefault(c["usuario_id"], []).append(c)
    out = []
    for u in usuarios:
        abiertas = abiertas_por_usuario.get(u["id"], [])
        if abiertas:
            caja = sorted(abiertas, key=lambda c: c.get("fecha_apertura", ""))[0]
            movs = await db.caja_movimientos.find({"caja_id": caja["id"]}, {"_id": 0}).to_list(1000)
            out.append({
                "usuario_id": u["id"], "usuario_nombre": u["name"], "role": u.get("role"),
                "caja_numero": u.get("caja_numero"),
                "estado": "abierta", "caja": caja, "resumen": resumen_caja(caja, movs)})
        else:
            ultima = await db.cajas.find({"usuario_id": u["id"], "estado": "cerrada"},
                                         {"_id": 0}).sort("fecha_cierre", -1).to_list(1)
            out.append({
                "usuario_id": u["id"], "usuario_nombre": u["name"], "role": u.get("role"),
                "caja_numero": u.get("caja_numero"),
                "estado": "cerrada", "caja": ultima[0] if ultima else None, "resumen": None})
    return out

@api.get("/caja/historial")
async def caja_historial(desde: Optional[str] = None, hasta: Optional[str] = None,
                         estado: Optional[str] = None, user: dict = Depends(require_permission("caja.ver"))):
    query = {}
    if not es_admin_sistema(user):
        query["usuario_id"] = user["id"]
    if estado in ("abierta", "cerrada"):
        query["estado"] = estado
    cajas = await db.cajas.find(query, {"_id": 0}).sort("fecha_apertura", -1).to_list(500)
    d = desde[:10] if desde else None
    h = hasta[:10] if hasta else None
    if d or h:
        cajas = [c for c in cajas if (not d or (c.get("fecha_apertura", "")[:10] >= d)) and (not h or (c.get("fecha_apertura", "")[:10] <= h))]
    return cajas

# =========================================================================
# VENTAS / POS
# =========================================================================
def calcular_venta(items: List[dict], descuento_global: float):
    # Los precios que envía el POS YA incluyen IVA (precio_con_iva). Se extrae el
    # IVA de cada línea en lugar de sumarlo encima, para coincidir con el ticket.
    subtotal = 0.0   # neto (sin IVA)
    iva_total = 0.0
    desc_lineas = 0.0
    for it in items:
        base = it["cantidad"] * it["precio"]          # con IVA
        desc = it.get("descuento", 0.0)               # con IVA
        bruto = base - desc                           # con IVA
        tasa = it.get("iva_tasa", 16.0) / 100
        neto = bruto / (1 + tasa) if (1 + tasa) else bruto
        subtotal += neto
        iva_total += bruto - neto
        desc_lineas += desc
    dg = min(max(descuento_global, 0.0), subtotal + iva_total)
    subtotal_final = subtotal - dg
    total = max(0.0, round(subtotal_final + iva_total, 2))
    return {"subtotal": round(subtotal_final, 2), "iva_total": round(iva_total, 2),
            "descuento_total": round(desc_lineas + dg, 2), "total": total}

@api.get("/sales")
async def list_sales(rango: Optional[str] = None, estado: Optional[str] = None,
                     desde: Optional[str] = None, hasta: Optional[str] = None,
                     vendedor_id: Optional[str] = None, q: Optional[str] = None,
                     user: dict = Depends(get_current_user)):
    if vendedor_id and not ver_todas_ventas(user):
        raise HTTPException(403, "No tienes permiso para filtrar ventas de otros operadores")
    query = {}
    if estado:
        query["estado"] = estado
    if not ver_todas_ventas(user):
        # Usuario normal: solo ve SUS ventas (las realiza él mismo).
        query["vendedor_id"] = user["id"]
    elif vendedor_id:
        query["vendedor_id"] = vendedor_id
    if q:
        rx = {"$regex": sanitize_search_term(q), "$options": "i"}
        query["$or"] = [{"folio": rx}, {"cliente_nombre": rx}]
    sales = await db.sales.find(query, {"_id": 0}).sort("fecha", -1).to_list(3000)
    now = now_utc()
    d = desde[:10] if desde else None
    h = hasta[:10] if hasta else None
    if rango and rango not in ("all", "rango"):
        if rango == "hoy":
            d = h = now.date().isoformat()
        elif rango == "semana":
            d = (now - timedelta(days=now.weekday())).date().isoformat(); h = now.date().isoformat()
        elif rango == "mes":
            d = now.strftime("%Y-%m-01"); h = now.date().isoformat()
        elif rango == "mes_anterior":
            first_this = now.replace(day=1)
            last_prev = first_this - timedelta(days=1)
            d = last_prev.strftime("%Y-%m-01"); h = last_prev.date().isoformat()
        elif rango == "anio":
            d = f"{now.year}-01-01"; h = now.date().isoformat()
    if d or h:
        sales = [s for s in sales if (not d or s.get("fecha", "")[:10] >= d) and (not h or s.get("fecha", "")[:10] <= h)]
    return sales

@api.get("/sales/{sale_id}")
async def get_sale(sale_id: str, user: dict = Depends(get_current_user)):
    s = await db.sales.find_one({"id": sale_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Venta no encontrada")
    # Visibilidad: solo roles autorizados ven ventas ajenas.
    if not ver_todas_ventas(user) and s.get("vendedor_id") != user["id"]:
        raise HTTPException(403, "No tienes permiso para ver esta venta")
    return s

@api.put("/sales/{sale_id}/cliente")
async def set_sale_cliente(sale_id: str, payload: dict, user: dict = Depends(require_permission("venta.crear"))):
    s = await db.sales.find_one({"id": sale_id})
    if not s:
        raise HTTPException(404, "Venta no encontrada")
    if not ver_todas_ventas(user) and s.get("vendedor_id") != user["id"]:
        raise HTTPException(403, "No tienes permiso para modificar esta venta")
    if s.get("facturado"):
        raise HTTPException(400, "La venta ya fue facturada")
    await db.sales.update_one({"id": sale_id}, {"$set": {
        "cliente_id": payload.get("cliente_id"), "cliente_nombre": payload.get("cliente_nombre", "")}})
    return {"ok": True}

@api.post("/sales")
async def create_sale(data: SaleInput, user: dict = Depends(require_permission("venta.crear"))):
    if not data.items:
        raise HTTPException(400, "La venta no tiene productos")
    cliente = None
    if data.cliente_id:
        cliente = await db.clients.find_one({"id": data.cliente_id}, {"_id": 0})
    cliente_nombre = cliente["nombre"] if cliente else "Público General"
    # Vendedor: automático = usuario autenticado. Solo roles autorizados con
    # `venta.cambiar_operador` pueden registrar la venta a nombre de otro operador.
    # El resto SIEMPRE usa su propio id (imposible suplantar operador).
    puede_cambiar_operador = user_has_permission(user, "venta.cambiar_operador")
    vendedor_id = data.vendedor_id if (puede_cambiar_operador and data.vendedor_id) else user["id"]
    vendedor_nombre = user["name"]
    if vendedor_id != user["id"]:
        v = await db.users.find_one({"id": vendedor_id}, {"_id": 0})
        if v:
            vendedor_nombre = v["name"]
    items = [it.model_dump() for it in data.items]
    es_cotizacion = data.tipo_venta == "cotizacion"
    # Override de inventario negativo: solo roles con el permiso dedicado pueden
    # vender con existencia insuficiente (queda inventario negativo).
    override_inv = None
    if data.allow_negative_inventory and not es_cotizacion:
        if not user_has_permission(user, "inventario.autorizar_negativo"):
            raise HTTPException(403, "No tienes permiso para vender sin inventario suficiente")
        override_inv = {
            "allow_negative_inventory": True,
            "override_user_id": user["id"],
            "override_user_nombre": user["name"],
            "override_reason": (data.override_reason or "").strip(),
            "override_timestamp": iso_now(),
        }
    # Caja obligatoria: ninguna venta (no cotización) puede finalizar sin caja abierta.
    if not es_cotizacion:
        caja = await caja_abierta_de(user["id"])
        if not caja:
            raise HTTPException(409, "No hay caja abierta. Abre una caja antes de vender.")
        if caja.get("estado") != "abierta":
            raise HTTPException(409, "La caja no está abierta")
    else:
        caja = None
    for it in items:
        if not it["product_id"]:
            continue  # línea sin inventario (p. ej. recarga remitida)
        p = await db.products.find_one({"id": it["product_id"]})
        if not p:
            raise HTTPException(400, f"Producto {it['codigo']} no existe")
        if p.get("estado") != "activo":
            raise HTTPException(400, f"Producto {p['codigo']} no está activo")
        if not es_cotizacion:
            controles = p.get("controles", {}) or {}
            controlar = controles.get("controlar_inventario", True)
            permitir_neg = controles.get("permitir_inventario_negativo", False)
            if controlar and not permitir_neg and not override_inv and float(p.get("existencia", 0)) < it["cantidad"]:
                raise HTTPException(400, f"Existencia insuficiente de {p['codigo']} (disp: {p.get('existencia',0)})")
    totales = calcular_venta(items, data.descuento_global)
    total = totales["total"]
    pagos = [p.model_dump() for p in data.pagos]
    pagado = sum(p["monto"] for p in pagos)
    cambio = 0.0
    saldo = 0.0
    now = now_utc()

    # Idempotencia POS: un reintento con la misma key devuelve la venta existente
    # sin generar un folio nuevo ni una segunda venta.
    if data.idempotency_key:
        existing = await _pgpos._existing_by_key(data.idempotency_key)
        if existing:
            return existing

    if es_cotizacion:
        folio = await next_counter("cotizacion", "COT", 6)
        estado = "cotizacion"
    else:
        if data.condicion == "contado":
            if round(pagado, 2) + 0.01 < round(total, 2):
                raise HTTPException(400, f"El pago ({round(pagado,2)}) es menor al total ({round(total,2)})")
            cambio = max(0.0, round(pagado - total, 2))
        else:
            if not cliente:
                raise HTTPException(400, "Selecciona un cliente para venta a crédito")
            if not cliente.get("credito_autorizado", False):
                raise HTTPException(400, "El cliente no tiene crédito autorizado")
            disponible = float(cliente.get("limite_credito", 0)) - float(cliente.get("saldo", 0))
            if total > disponible + 0.01:
                raise HTTPException(400, f"Excede el crédito disponible ({round(disponible, 2)})")
            saldo = total
        folio = await next_counter("venta", "V", 6)
        estado = "confirmada"
    sale = {
        "id": uid(), "folio": folio, "fecha": iso_now(),
        "hora": now.strftime("%H:%M"), "usuario_id": user["id"], "usuario_nombre": user["name"],
        "vendedor_id": vendedor_id, "vendedor_nombre": vendedor_nombre,
        "cliente_id": data.cliente_id, "cliente_nombre": cliente_nombre,
        "items": items, **totales, "tipo_venta": data.tipo_venta, "condicion": data.condicion,
        "pagos": pagos, "cambio": cambio, "saldo": saldo, "estado": estado,
        "factura": False, "caja_id": caja["id"] if (caja and not es_cotizacion) else None,
        "sucursal_id": (caja or {}).get("sucursal_id") or user.get("sucursal_id"),
        "lista_precios": data.lista_precios,
    }
    if override_inv:
        sale["inventario_override"] = override_inv

    # --- Persistencia atómica (PostgreSQL): una sola transacción ---
    try:
        return await _pgpos.crear_venta_pg(
            user=user, sale=sale, items=items, pagos=pagos, total=total,
            es_cotizacion=es_cotizacion, caja=caja, condicion=data.condicion,
            cliente=cliente, folio=folio, idempotency_key=data.idempotency_key,
            override_inv=override_inv)
    except _pgpos.VentaError as e:
        raise HTTPException(status_code=e.status, detail=e.message)

@api.post("/recargas")
async def crear_recarga(data: RecargaInput, user: dict = Depends(require_permission("venta.crear"))):
    if data.monto <= 0:
        raise HTTPException(400, "El monto debe ser mayor a 0")
    if not data.telefono.strip():
        raise HTTPException(400, "Captura el número de teléfono")
    now = now_utc()
    folio = await next_counter("recarga", "R", 6)
    descripcion = f"Recarga {data.compania} · {data.telefono}".strip()
    total = round(float(data.monto), 2)
    items = [{"product_id": None, "codigo": "RECARGA", "descripcion": descripcion, "cantidad": 1,
              "unidad": "SERV", "precio": total, "iva_tasa": 0, "descuento": 0, "importe": total}]
    # Caja obligatoria para recargas (cobro en mostrador).
    caja = await caja_abierta_de(user["id"])
    if not caja:
        raise HTTPException(409, "No hay caja abierta. Abre una caja antes de registrar la recarga.")
    sale = {
        "id": uid(), "folio": folio, "fecha": iso_now(), "hora": now.strftime("%H:%M"),
        "usuario_id": user["id"], "usuario_nombre": user["name"],
        "vendedor_id": user["id"], "vendedor_nombre": user["name"],
        "cliente_id": None, "cliente_nombre": "Público General",
        "items": items, "subtotal": total, "iva_total": 0.0, "descuento_global": 0.0, "total": total,
        "tipo_venta": "recarga", "condicion": "contado",
        "pagos": [{"metodo": data.metodo, "monto": total}], "cambio": 0.0, "saldo": 0.0,
        "estado": "confirmada", "factura": False, "caja_id": caja["id"] if caja else None,
        "sucursal_id": caja.get("sucursal_id") or user.get("sucursal_id"),
        "lista_precios": 1, "compania": data.compania, "telefono": data.telefono,
        "referencia_tae": (data.referencia_tae or "").strip(),
        "comision": round(float(data.comision or 0), 2),
    }
    await db.sales.insert_one(sale)
    if caja and data.metodo == "efectivo":
        await db.caja_movimientos.insert_one({
            "id": uid(), "caja_id": caja["id"], "tipo": "venta", "concepto": f"Recarga {folio}",
            "monto": total, "referencia": folio, "usuario_id": user["id"],
            "usuario_nombre": user["name"], "fecha": iso_now()})
    await log_audit(user, "crear", "recarga", sale["id"], f"{folio} {descripcion} {total}")
    return await db.sales.find_one({"id": sale["id"]}, {"_id": 0})

@api.post("/sales/{sale_id}/cancelar")
async def cancel_sale(sale_id: str, data: CancelInput, user: dict = Depends(require_permission("venta.cancelar"))):
    sale = await db.sales.find_one({"id": sale_id})
    if not sale:
        raise HTTPException(404, "Venta no encontrada")
    if not ver_todas_ventas(user) and sale.get("vendedor_id") != user["id"]:
        raise HTTPException(403, "No tienes permiso para cancelar esta venta")
    if sale["estado"] == "cancelada":
        raise HTTPException(400, "La venta ya está cancelada")
    es_confirmada = sale["estado"] == "confirmada"
    if es_confirmada:
        # Revertir inventario
        for it in sale["items"]:
            p = await db.products.find_one({"id": it["product_id"]})
            if p:
                await registrar_movimiento(p, "devolucion", it["cantidad"], 0, user, sale["folio"], f"Cancelación {sale['folio']}")
        # Revertir caja
        if sale.get("caja_id") and sale["condicion"] == "contado":
            efectivo = sum(pg["monto"] for pg in sale["pagos"] if pg["metodo"] == "efectivo")
            if efectivo > 0:
                await db.caja_movimientos.insert_one({
                    "id": uid(), "caja_id": sale["caja_id"], "tipo": "devolucion",
                    "concepto": f"Cancelación {sale['folio']}", "monto": round(min(efectivo, sale["total"]), 2),
                    "referencia": sale["folio"], "usuario_id": user["id"],
                    "usuario_nombre": user["name"], "fecha": iso_now()})
        # Revertir crédito (solo el saldo pendiente, respetando abonos previos)
        if sale["condicion"] == "credito" and sale.get("cliente_id"):
            pendiente = round(float(sale.get("saldo", sale["total"])), 2)
            if pendiente > 0:
                await db.clients.update_one({"id": sale["cliente_id"]}, {"$inc": {"saldo": -pendiente}})
            await db.sales.update_one({"id": sale_id}, {"$set": {"saldo": 0.0}})
    await db.sales.update_one({"id": sale_id}, {"$set": {
        "estado": "cancelada",
        "cancelacion": {"usuario": user["name"], "fecha": iso_now(), "motivo": data.motivo}}})
    await log_audit(user, "cancelar", "venta", sale_id, data.motivo)
    return await db.sales.find_one({"id": sale_id}, {"_id": 0})

# Ventas suspendidas
@api.post("/sales/suspend")
async def suspend_sale(data: SaleInput, user: dict = Depends(require_permission("venta.crear"))):
    doc = {"id": uid(), "usuario_id": user["id"], "fecha": iso_now(),
           "payload": data.model_dump(), "estado": "suspendida"}
    await db.suspended_sales.insert_one(doc)
    return {"id": doc["id"]}

@api.get("/sales-suspended")
async def list_suspended(user: dict = Depends(get_current_user)):
    return await db.suspended_sales.find({"usuario_id": user["id"]}, {"_id": 0}).sort("fecha", -1).to_list(100)

@api.delete("/sales-suspended/{sid}")
async def delete_suspended(sid: str, user: dict = Depends(require_permission("venta.crear"))):
    await db.suspended_sales.delete_one({"id": sid})
    return {"ok": True}

# =========================================================================
# CUENTAS POR COBRAR (CxC)
# =========================================================================
AGING_KEYS = ["corriente", "b1_30", "b31_60", "b61_90", "b90"]

def _parse_date(s):
    try:
        return date.fromisoformat(str(s)[:10])
    except Exception:
        return None

def _dias_vencido(fecha_iso, dias_credito, hoy):
    d = _parse_date(fecha_iso)
    if not d:
        return 0, None
    vence = d + timedelta(days=int(dias_credito or 0))
    return (hoy - vence).days, vence.isoformat()

def _bucket(dv):
    if dv <= 0:
        return "corriente"
    if dv <= 30:
        return "b1_30"
    if dv <= 60:
        return "b31_60"
    if dv <= 90:
        return "b61_90"
    return "b90"

@api.get("/cxc")
async def cxc_list(q: Optional[str] = None, solo_vencidos: Optional[bool] = False,
                   estado: Optional[str] = None, vendedor_id: Optional[str] = None,
                   facturada: Optional[str] = None,
                   user: dict = Depends(require_permission("cxc.ver"))):
    hoy = now_utc().date()
    clientes = await db.clients.find({"saldo": {"$gt": 0}}, {"_id": 0}).to_list(20000)
    cmap = {c["id"]: c for c in clientes}
    sf = {"condicion": "credito", "estado": "confirmada", "saldo": {"$gt": 0}}
    if vendedor_id:
        sf["vendedor_id"] = vendedor_id
    sales = await db.sales.find(sf, {"_id": 0, "cliente_id": 1, "fecha": 1, "saldo": 1,
                                     "total": 1, "vendedor_id": 1, "facturado": 1, "folio": 1}).to_list(100000)
    agg = {}
    for s in sales:
        cid = s.get("cliente_id")
        if not cid or cid not in cmap:
            continue
        cli = cmap[cid]
        dv, _ = _dias_vencido(s["fecha"], cli.get("dias_credito", 0), hoy)
        a = agg.get(cid)
        if not a:
            a = {k: 0.0 for k in AGING_KEYS}
            a.update({"vencido": 0.0, "max_dias": 0, "n": 0, "monto_original": 0.0, "con_abonos": 0, "sin_abonos": 0, "facturadas": 0, "no_facturadas": 0, "folios": []})
            agg[cid] = a
        a[_bucket(dv)] += s["saldo"]
        a["monto_original"] += float(s.get("total", 0))
        a["n"] += 1
        a["folios"].append(s.get("folio", ""))
        if float(s.get("saldo", 0)) < float(s.get("total", 0)) - 0.01:
            a["con_abonos"] += 1
        else:
            a["sin_abonos"] += 1
        if s.get("facturado"):
            a["facturadas"] += 1
        else:
            a["no_facturadas"] += 1
        if dv > 0:
            a["vencido"] += s["saldo"]
            a["max_dias"] = max(a["max_dias"], dv)
    rows = []
    ql = (q or "").lower().strip()
    for cid, cli in cmap.items():
        a = agg.get(cid)
        if not a:
            continue
        pendiente_total = sum(a[k] for k in AGING_KEYS)
        abonado_parcial = a["monto_original"] > pendiente_total
        if a["vencido"] > 0:
            st = "vencida"
        elif pendiente_total <= 0:
            st = "liquidada"
        elif abonado_parcial:
            st = "parcialmente_pagada"
        else:
            st = "pendiente"
        item = {
            "cliente_id": cid, "codigo": cli.get("codigo"), "nombre": cli.get("nombre"),
            "telefono": cli.get("telefono"), "celular": cli.get("celular"),
            "limite_credito": round(float(cli.get("limite_credito", 0)), 2),
            "dias_credito": cli.get("dias_credito", 0),
            "saldo": round(float(cli.get("saldo", 0)), 2),
            "monto_original": round(a["monto_original"], 2),
            "vencido": round(a["vencido"], 2),
            "max_dias": a["max_dias"],
            "ventas_pendientes": a["n"],
            "estado": st,
            "con_abonos": a["con_abonos"], "sin_abonos": a["sin_abonos"],
            "facturadas": a["facturadas"], "no_facturadas": a["no_facturadas"],
            "aging": {k: round(a[k], 2) for k in AGING_KEYS},
        }
        if solo_vencidos and item["vencido"] <= 0:
            continue
        if estado and estado != "todos" and st != estado:
            continue
        if facturada == "si" and item["facturadas"] == 0:
            continue
        if facturada == "no" and item["no_facturadas"] == 0:
            continue
        if ql and ql not in str(cli.get("nombre", "")).lower() and ql not in str(cli.get("codigo", "")).lower():
            continue
        rows.append(item)
    rows.sort(key=lambda r: r["vencido"] * 1e9 + r["saldo"], reverse=True)
    tot = {"cartera": round(sum(r["saldo"] for r in rows), 2),
           "vencido": round(sum(r["vencido"] for r in rows), 2),
           "clientes": len(rows)}
    tot["por_vencer"] = round(tot["cartera"] - tot["vencido"], 2)
    for k in AGING_KEYS:
        tot[k] = round(sum(r["aging"][k] for r in rows), 2)
    return {"totales": tot, "clientes": rows}

@api.get("/cxc/{client_id}")
async def cxc_detail(client_id: str, user: dict = Depends(require_permission("cxc.ver"))):
    cli = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not cli:
        raise HTTPException(404, "Cliente no encontrado")
    hoy = now_utc().date()
    sales = await db.sales.find({"cliente_id": client_id, "condicion": "credito", "estado": "confirmada"},
                                {"_id": 0}).sort("fecha", 1).to_list(20000)
    ventas = []
    for s in sales:
        dv, vence = _dias_vencido(s["fecha"], cli.get("dias_credito", 0), hoy)
        saldo = round(float(s.get("saldo", 0)), 2)
        ventas.append({"id": s["id"], "folio": s["folio"], "fecha": s["fecha"], "total": s["total"],
                       "saldo": saldo, "vence": vence, "dias_vencido": max(dv, 0),
                       "pagada": saldo <= 0.001})
    abonos = await db.abonos.find({"cliente_id": client_id}, {"_id": 0}).sort("fecha", -1).to_list(5000)
    return {
        "cliente": {"id": cli["id"], "codigo": cli.get("codigo"), "nombre": cli.get("nombre"),
                    "telefono": cli.get("telefono"), "celular": cli.get("celular"),
                    "limite_credito": round(float(cli.get("limite_credito", 0)), 2),
                    "dias_credito": cli.get("dias_credito", 0),
                    "saldo": round(float(cli.get("saldo", 0)), 2)},
        "ventas": ventas, "abonos": abonos,
    }

@api.get("/cxc/{client_id}/adeudo-pdf")
async def cxc_adeudo_pdf(client_id: str, user: dict = Depends(require_permission("cxc.ver"))):
    """PDF detallado de adeudo para imprimir y entregar al cliente."""
    cli = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not cli:
        raise HTTPException(404, "Cliente no encontrado")
    hoy = now_utc().date()
    sales = await db.sales.find({"cliente_id": client_id, "condicion": "credito", "estado": "confirmada"},
                                {"_id": 0}).sort("fecha", 1).to_list(20000)
    abonos = await db.abonos.find({"cliente_id": client_id}, {"_id": 0}).to_list(5000)
    total_vendido = round(sum(float(s.get("total", 0)) for s in sales), 2)
    total_abonos = round(sum(float(a.get("monto", 0)) for a in abonos), 2)
    saldo = round(float(cli.get("saldo", 0)), 2)

    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors
    from io import BytesIO

    buf = BytesIO()
    st = getSampleStyleSheet()
    doc = SimpleDocTemplate(buf, pagesize=letter)
    flow = []
    flow.append(Paragraph(f"<b>ESTADO DE CUENTA / ADEUDO</b>", st['Title']))
    flow.append(Spacer(1, 4 * mm))
    flow.append(Paragraph(f"<b>Cliente:</b> {cli.get('nombre')} ({cli.get('codigo')})", st['Normal']))
    flow.append(Paragraph(f"<b>RFC:</b> {cli.get('rfc') or '—'} &nbsp;&nbsp; <b>Fecha:</b> {hoy.isoformat()}", st['Normal']))
    flow.append(Spacer(1, 3 * mm))
    rows = [["Venta", "Fecha", "Producto", "Descripción", "Cant", "Precio", "Total"]]
    total_items = 0.0
    for s in sales:
        for it in s.get("items", []):
            cant = it.get("cantidad", 0); precio = float(it.get("precio", 0))
            imp = float(it.get("importe", cant * precio))
            total_items += imp
            rows.append([s.get("folio", ""), (s.get("fecha", "") or "")[:10],
                         str(it.get("codigo", "") or ""), str(it.get("descripcion", ""))[:28],
                         cant, f"${precio:,.2f}", f"${imp:,.2f}"])
    t = Table(rows, repeatRows=1)
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#B95A3A')),
                           ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                           ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                           ('GRID', (0, 0), (-1, -1), 0.3, colors.grey),
                           ('FONTSIZE', (0, 0), (-1, -1), 7.5)]))
    flow.append(t)
    flow.append(Spacer(1, 3 * mm))
    flow.append(Paragraph(f"<b>Detalle vendido:</b> ${total_items:,.2f}", st['Normal']))
    flow.append(Paragraph(f"<b>Abonos:</b> ${total_abonos:,.2f}", st['Normal']))
    flow.append(Paragraph(f"<b>Saldo pendiente:</b> ${saldo:,.2f}", st['Heading3']))
    doc.build(flow)
    buf.seek(0)
    from fastapi.responses import StreamingResponse
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f'inline; filename="{cli.get("codigo")}-adeudo.pdf"'})

@api.post("/cxc/{client_id}/recordatorio")
async def cxc_recordatorio(client_id: str, user: dict = Depends(require_permission("cxc.ver"))):
    """Genera el recordatorio de saldo pendiente (WhatsApp/correo) con plantilla."""
    cli = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not cli:
        raise HTTPException(404, "Cliente no encontrado")
    saldo = round(float(cli.get("saldo", 0)), 2)
    if saldo <= 0:
        raise HTTPException(400, "El cliente no tiene saldo pendiente")
    wt = (await db.settings.find_one({"_id": "app"}, {"_id": 0}) or {}).get("ticket_config", {}) or {}
    plantilla = (await db.settings.find_one({"_id": "app"}, {"_id": 0}) or {}).get("plantilla_recordatorio") or \
        "Estimado {cliente}, le recordamos que tiene un saldo pendiente de ${saldo}. Si ya lo cubrió, ignore este mensaje."
    texto = plantilla.replace("{cliente}", cli.get("nombre", "")).replace("{saldo}", f"{saldo:,.2f}")
    telefono = (cli.get("whatsapp") or cli.get("celular") or cli.get("telefono") or "").strip()
    digits = "".join(ch for ch in telefono if ch.isdigit())
    wa_url = ""
    if len(digits) >= 10:
        phone = digits if len(digits) == 12 else ("52" + digits if len(digits) == 10 else digits)
        wa_url = f"https://wa.me/{phone}?text={__import__('urllib.parse', fromlist=['quote']).quote(texto)}"
    # Registrar historial de mensaje
    msg = {"id": uid(), "cliente_id": client_id, "cliente_nombre": cli.get("nombre", ""),
           "canal": "whatsapp", "tipo": "recordatorio_cxc", "contenido": texto,
           "destinatario": telefono, "estado": "generado", "usuario_id": user["id"],
           "usuario_nombre": user["name"], "fecha": iso_now(), "wa_url": wa_url}
    await db.mensajes.insert_one(msg)
    await log_audit(user, "recordatorio_cxc", "cliente", client_id,
                    f"Recordatorio saldo {saldo}")
    return {"texto": texto, "telefono": telefono, "wa_url": wa_url, "historico_id": msg["id"]}

@api.post("/cxc/{client_id}/abono")
async def cxc_abono(client_id: str, data: AbonoInput, user: dict = Depends(require_permission("caja.entrada"))):
    cli = await db.clients.find_one({"id": client_id})
    if not cli:
        raise HTTPException(404, "Cliente no encontrado")
    monto = round(float(data.monto), 2)
    if monto <= 0:
        raise HTTPException(400, "El monto debe ser mayor a cero")
    saldo_cli = round(float(cli.get("saldo", 0)), 2)
    if saldo_cli <= 0:
        raise HTTPException(400, "El cliente no tiene saldo pendiente")
    if monto > saldo_cli + 0.01:
        raise HTTPException(400, f"El abono ({monto}) excede el saldo del cliente ({saldo_cli})")
    sales = await db.sales.find({"cliente_id": client_id, "condicion": "credito", "estado": "confirmada",
                                 "saldo": {"$gt": 0}}, {"_id": 0}).sort("fecha", 1).to_list(20000)
    restante = monto
    aplicaciones = []
    for s in sales:
        if restante <= 0.001:
            break
        aplica = min(restante, round(float(s.get("saldo", 0)), 2))
        if aplica <= 0:
            continue
        nuevo = round(float(s["saldo"]) - aplica, 2)
        await db.sales.update_one({"id": s["id"]}, {"$set": {"saldo": nuevo}})
        aplicaciones.append({"sale_id": s["id"], "folio": s["folio"], "monto": round(aplica, 2)})
        restante = round(restante - aplica, 2)
    await db.clients.update_one({"id": client_id}, {"$inc": {"saldo": -monto}})
    caja = await caja_abierta_de(user["id"])
    folio = await next_counter("abono", "AB", 6)
    doc = {"id": uid(), "folio": folio, "cliente_id": client_id, "cliente_codigo": cli.get("codigo"),
           "cliente_nombre": cli.get("nombre"), "monto": monto, "metodo": data.metodo,
           "referencia": data.referencia or "", "nota": data.nota or "", "fecha": iso_now(),
           "aplicaciones": aplicaciones, "usuario_id": user["id"], "usuario_nombre": user["name"],
           "caja_id": caja["id"] if caja else None}
    await db.abonos.insert_one(doc)
    if caja and data.metodo == "efectivo":
        await db.caja_movimientos.insert_one({
            "id": uid(), "caja_id": caja["id"], "tipo": "entrada",
            "concepto": f"Abono {folio} · {cli.get('nombre')}", "monto": monto, "referencia": folio,
            "usuario_id": user["id"], "usuario_nombre": user["name"], "fecha": iso_now()})
    await log_audit(user, "abono", "cliente", client_id, f"{folio} monto {monto} metodo {data.metodo}")
    return {"ok": True, "folio": folio, "saldo_anterior": saldo_cli,
            "saldo_actual": round(saldo_cli - monto, 2), "aplicaciones": aplicaciones,
            "caja_afectada": bool(caja and data.metodo == "efectivo")}

# =========================================================================
# DASHBOARD
# =========================================================================
@api.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    now = now_utc()
    hoy = now.date().isoformat()
    mes = now.strftime("%Y-%m")
    # Modo: admin/propietario/dev ven el negocio completo; el resto solo su operación
    es_global = "*" in effective_permissions(user)
    mq = {"estado": "confirmada"}
    if not es_global:
        mq["usuario_id"] = user["id"]
    sales = await db.sales.find(mq, {"_id": 0}).to_list(5000)
    ventas_hoy = [s for s in sales if s["fecha"][:10] == hoy]
    ventas_mes = [s for s in sales if s["fecha"][:7] == mes]
    total_hoy = round(sum(s["total"] for s in ventas_hoy), 2)
    total_mes = round(sum(s["total"] for s in ventas_mes), 2)
    # Caja: la propia (operador) o el consolidado de todas las cajas abiertas (admin)
    caja = await caja_abierta_de(user["id"])
    total_caja = 0.0
    caja_info = None
    if es_global:
        cajas_abiertas = await db.cajas.find({"estado": "abierta"}, {"_id": 0}).to_list(500)
        for c in cajas_abiertas:
            movs = await db.caja_movimientos.find({"caja_id": c["id"]}, {"_id": 0}).to_list(1000)
            total_caja = round(total_caja + resumen_caja(c, movs)["efectivo_esperado"], 2)
    else:
        if caja:
            movs = await db.caja_movimientos.find({"caja_id": caja["id"]}, {"_id": 0}).to_list(1000)
            res = resumen_caja(caja, movs)
            total_caja = res["efectivo_esperado"]
            caja_info = {"id": caja["id"], "caja_nombre": caja.get("caja_nombre") or "Caja 1",
                         "fondo_inicial": caja.get("fondo_inicial"), "resumen": res}
        else:
            # Sin caja abierta: mostrar el último corte cerrado del usuario
            ultima = await db.cajas.find({"usuario_id": user["id"], "estado": "cerrada"},
                                         {"_id": 0}).sort("fecha_cierre", -1).to_list(1)
            if ultima:
                cierre = ultima[0].get("cierre") or {}
                total_caja = round(float(cierre.get("efectivo_esperado", 0)), 2)
                caja_info = {"id": ultima[0]["id"], "caja_nombre": ultima[0].get("caja_nombre") or "Caja 1",
                             "fondo_inicial": ultima[0].get("fondo_inicial"), "cerrada": True,
                             "resumen": cierre}
    # Productos (datos compartidos del negocio)
    products = await db.products.find({"estado": "activo"}, {"_id": 0}).to_list(5000)
    bajo_stock = [p for p in products if 0 < float(p.get("existencia", 0)) <= float(p.get("stock_minimo", 0))]
    sin_existencia = [p for p in products if float(p.get("existencia", 0)) <= 0]
    clientes = await db.clients.count_documents({})
    # ventas por dia ultimos 7 (alcance del dashboard)
    serie = []
    for i in range(6, -1, -1):
        d = (now - __import__("datetime").timedelta(days=i)).date().isoformat()
        tot = round(sum(s["total"] for s in sales if s["fecha"][:10] == d), 2)
        serie.append({"dia": d[5:], "total": tot})
    recientes = sorted(sales, key=lambda s: s["fecha"], reverse=True)[:8]
    base = {
        "ventas_hoy": total_hoy, "ventas_mes": total_mes,
        "num_ventas_hoy": len(ventas_hoy), "total_caja": total_caja,
        "bajo_stock": len(bajo_stock), "sin_existencia": len(sin_existencia),
        "clientes": clientes, "productos": len(products),
        "serie_ventas": serie, "mode": "global" if es_global else "propio",
        "caja_info": caja_info,
        "ventas_recientes": [{"folio": s["folio"], "cliente": s["cliente_nombre"],
                              "total": s["total"], "fecha": s["fecha"], "estado": s["estado"]} for s in recientes],
        "alertas_stock": [{"codigo": p["codigo"], "descripcion": p["descripcion"],
                           "existencia": p.get("existencia", 0), "stock_minimo": p.get("stock_minimo", 0)}
                          for p in (bajo_stock + sin_existencia)[:10]],
    }
    if es_global:
        base.update(await _dashboard_global_breakdown())
    return base


async def _dashboard_global_breakdown() -> dict:
    """Desglose global: ventas por caja y por usuario (solo admin/propietario)."""
    sales = await db.sales.find({"estado": "confirmada"}, {"_id": 0}).to_list(100000)
    # Por usuario
    por_usuario = {}
    for s in sales:
        uid_ = s.get("usuario_id") or "?"
        e = por_usuario.setdefault(uid_, {"usuario_id": uid_, "usuario_nombre": s.get("usuario_nombre") or "—",
                                          "num_ventas": 0, "total": 0.0})
        e["num_ventas"] += 1
        e["total"] = round(e["total"] + float(s.get("total", 0)), 2)
    # Por caja
    cajas = await db.cajas.find({}, {"_id": 0}).sort("fecha_apertura", -1).to_list(500)
    ventas_caja = {}
    for s in sales:
        cid = s.get("caja_id")
        if cid:
            e = ventas_caja.setdefault(cid, {"num_ventas": 0, "total": 0.0})
            e["num_ventas"] += 1
            e["total"] = round(e["total"] + float(s.get("total", 0)), 2)
    por_caja = []
    for c in cajas:
        res = {"efectivo_esperado": 0.0}
        v = ventas_caja.get(c["id"], {"num_ventas": 0, "total": 0.0})
        if c["estado"] == "abierta":
            movs = await db.caja_movimientos.find({"caja_id": c["id"]}, {"_id": 0}).to_list(1000)
            res = resumen_caja(c, movs)
        else:
            cierre = c.get("cierre") or {}
            res["efectivo_esperado"] = cierre.get("efectivo_esperado", 0.0)
        por_caja.append({
            "caja_id": c["id"], "caja_nombre": c.get("caja_nombre") or "Caja 1",
            "usuario_nombre": c.get("usuario_nombre") or "—", "estado": c["estado"],
            "fecha_apertura": c.get("fecha_apertura"), "fondo_inicial": c.get("fondo_inicial"),
            "efectivo_esperado": round(float(res.get("efectivo_esperado", 0)), 2),
            "ventas_total": round(float(v["total"]), 2), "num_ventas": v["num_ventas"],
        })
    sin_caja = {"num_ventas": 0, "total": 0.0}
    for s in sales:
        if not s.get("caja_id"):
            sin_caja["num_ventas"] += 1
            sin_caja["total"] = round(sin_caja["total"] + float(s.get("total", 0)), 2)
    if sin_caja["num_ventas"]:
        por_caja.append({"caja_id": None, "caja_nombre": "Sin caja", "usuario_nombre": "—",
                         "estado": "—", "fecha_apertura": "", "fondo_inicial": 0.0,
                         "efectivo_esperado": 0.0, "ventas_total": sin_caja["total"],
                         "num_ventas": sin_caja["num_ventas"]})
    return {
        "por_usuario": sorted(por_usuario.values(), key=lambda r: -r["total"]),
        "por_caja": por_caja,
        "totales_globales": {
            "ventas": round(sum(float(s.get("total", 0)) for s in sales), 2),
            "num_ventas": len(sales),
            "cajas_abiertas": sum(1 for c in cajas if c["estado"] == "abierta"),
        },
    }

# =========================================================================
# EXCEL - IMPORT / EXPORT
# =========================================================================
PROD_COLS = ["codigo", "descripcion", "linea", "clasificacion", "costo", "existencia",
             "unidad_medida", "stock_minimo", "estado"]
CLIENT_COLS = ["codigo", "nombre", "razon_social", "rfc", "telefono", "whatsapp",
               "correo", "direccion", "ciudad", "estado_geo", "cp", "tipo", "estado"]

def df_to_excel_bytes(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Datos")
    buf.seek(0)
    return buf.read()

@api.get("/products/export/excel")
async def export_products(estado: Optional[str] = None, q: Optional[str] = None,
                          user: dict = Depends(require_permission("exportar"))):
    query = {}
    if estado:
        query["estado"] = estado
    if q:
        rx = {"$regex": sanitize_search_term(q), "$options": "i"}
        query["$or"] = [{"codigo": rx}, {"descripcion": rx}, {"sku": rx},
                        {"linea": rx}, {"clasificacion": rx}, {"sinonimos": rx},
                        {"codigos_barras": rx}]
    products = await db.products.find(query, {"_id": 0}).sort("descripcion", 1).to_list(100000)
    rows = []
    for p in products:
        rows.append({
            "codigo": p.get("codigo"), "descripcion": p.get("descripcion"),
            "linea": p.get("linea"), "clasificacion": p.get("clasificacion"),
            "costo": p.get("costo"), "existencia": p.get("existencia"),
            "unidad_medida": p.get("unidad_medida"), "stock_minimo": p.get("stock_minimo"),
            "precio_1": (p.get("precios") or [{}])[0].get("precio_con_iva") if p.get("precios") else 0,
            "estado": p.get("estado"),
        })
    data = df_to_excel_bytes(pd.DataFrame(rows or [{c: None for c in PROD_COLS}]))
    return StreamingResponse(io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=productos.xlsx"})

@api.get("/products/plantilla/excel")
async def plantilla_products(user: dict = Depends(get_current_user)):
    df = pd.DataFrame(columns=COL_ORDER)
    data = df_to_excel_bytes(df)
    return StreamingResponse(io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=plantilla_productos_85.xlsx"})

def read_import_table(content: bytes, filename: str):
    """Lee XLSX/XLS/CSV de forma robusta. Devuelve un DataFrame (todo texto)."""
    name = (filename or "").lower()
    if name.endswith(".csv"):
        try:
            return pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False)
        except Exception:
            return pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False, sep=";", encoding="latin-1")
    errores = []
    engines = ["openpyxl", "xlrd"] if name.endswith(".xlsx") else ["xlrd", "openpyxl"]
    for eng in engines:
        try:
            return pd.read_excel(io.BytesIO(content), dtype=str, keep_default_na=False, engine=eng)
        except Exception as e:
            errores.append(f"{eng}: {str(e)[:80]}")
    # Algunos ERP exportan .xls que en realidad es HTML/XML
    try:
        dfs = pd.read_html(io.BytesIO(content))
        if dfs:
            return dfs[0].astype(str).fillna("")
    except Exception as e:
        errores.append(f"html: {str(e)[:80]}")
    try:
        return pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False, sep=None, engine="python")
    except Exception as e:
        errores.append(f"csv: {str(e)[:80]}")
    raise HTTPException(400, "No se pudo leer el archivo. Formatos soportados: XLSX, XLS, CSV. " + " | ".join(errores[:2]))

@api.post("/products/import/preview")
async def import_preview(file: UploadFile = File(...), user: dict = Depends(require_permission("importar"))):
    content = await file.read()
    try:
        df = read_import_table(content, file.filename or "")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Error al procesar el archivo: {str(e)[:150]}")
    df.columns = [IMPORT_ALIASES.get(str(c).strip().upper(), str(c).strip().upper()) for c in df.columns]
    rows = df.to_dict("records")
    if not rows:
        raise HTTPException(400, "El archivo no contiene registros o no es un formato válido (XLSX, XLS, CSV).")
    if not any(str(c).strip().upper() == "CODIGO" for c in df.columns):
        raise HTTPException(400, "El archivo no tiene la columna CODIGO. Descarga la plantilla de 85 columnas.")
    all_codes = [str(r.get("CODIGO", "")).strip() for r in rows if str(r.get("CODIGO", "")).strip()]
    existentes_db = set()
    if all_codes:
        async for p in db.products.find({"codigo": {"$in": all_codes}}, {"_id": 0, "codigo": 1}):
            existentes_db.add(p["codigo"])
    preview, codigos = [], set()
    nuevos = existentes = con_errores = 0
    for i, r in enumerate(rows):
        canon = {k: r.get(k, "") for k in COL_ORDER}
        data, errores = parse_row(canon)
        codigo = data.get("codigo", "")
        if codigo and codigo in codigos:
            errores.append({"campo": "CODIGO", "valor": codigo, "motivo": "Código duplicado en el archivo"})
        codigos.add(codigo)
        existe = codigo in existentes_db
        if errores:
            con_errores += 1
        elif existe:
            existentes += 1
        else:
            nuevos += 1
        preview.append({"fila": i + 2, "codigo": codigo, "descripcion": data.get("descrip", ""),
                        "accion": "actualizar" if existe else "crear", "existe": existe,
                        "errores": errores, "data": data})
    return {"total": len(preview), "nuevos": nuevos, "existentes": existentes,
            "con_errores": con_errores, "columnas": COL_ORDER, "preview": preview}

@api.post("/products/import/confirm")
async def import_confirm(payload: dict, user: dict = Depends(require_permission("importar"))):
    rows = payload.get("rows", [])
    mode = payload.get("mode", "ambos")  # nuevos | actualizar | ambos
    actualizar_existencia = bool(payload.get("actualizar_existencia", False))
    creados = actualizados = omitidos = 0
    for row in rows:
        if row.get("errores"):
            omitidos += 1; continue
        d = row.get("data", {})
        codigo = str(d.get("codigo", "")).strip()
        if not codigo:
            omitidos += 1; continue
        existing = await db.products.find_one({"codigo": codigo})
        if existing and mode == "nuevos":
            omitidos += 1; continue
        if not existing and mode == "actualizar":
            omitidos += 1; continue
        doc = build_product_doc(d)
        doc["codigo"] = codigo
        doc["updated_at"] = iso_now()
        ex_val = doc.pop("existencia", None)
        if existing:
            await db.products.update_one({"codigo": codigo}, {"$set": doc})
            if actualizar_existencia and ex_val is not None:
                prod = await db.products.find_one({"codigo": codigo})
                diff = float(ex_val) - float(prod.get("existencia", 0))
                if abs(diff) > 0.0001:
                    if diff > 0:
                        await registrar_movimiento(prod, "ajuste", diff, 0, user, "Importación", "Ajuste por importación")
                    else:
                        await registrar_movimiento(prod, "ajuste", 0, -diff, user, "Importación", "Ajuste por importación")
            actualizados += 1
        else:
            doc["id"] = uid(); doc["existencia"] = 0; doc["created_at"] = iso_now()
            await db.products.insert_one(doc)
            if ex_val and float(ex_val) > 0:
                prod = await db.products.find_one({"id": doc["id"]})
                await registrar_movimiento(prod, "entrada", float(ex_val), 0, user, "Importación", "Inventario inicial")
            creados += 1
    if creados or actualizados:
        await log_audit(user, "importar", "producto", "", f"{creados} creados, {actualizados} actualizados, {omitidos} omitidos")
    return {"creados": creados, "actualizados": actualizados, "omitidos": omitidos}

@api.get("/clients/export/excel")
async def export_clients(q: Optional[str] = None, estado: Optional[str] = None, tipo: Optional[str] = None,
                         filtro: Optional[str] = None, user: dict = Depends(require_permission("exportar"))):
    clients = await list_clients(q=q, estado=estado, tipo=tipo, filtro=filtro, user=user)
    rows = []
    for cl in clients:
        row = {}
        for legacy, (field, kind) in CLIENT_IMPORT_MAP.items():
            v = cl.get(field, "")
            if kind == "bool":
                v = ".T." if v else ".F."
            row[legacy] = v
        rows.append(row)
    df = pd.DataFrame(rows or [{c: None for c in CLIENT_LEGACY_ORDER}], columns=CLIENT_LEGACY_ORDER)
    data = df_to_excel_bytes(df)
    return StreamingResponse(io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=clientes.xlsx"})

@api.get("/clients/plantilla/excel")
async def plantilla_clients(user: dict = Depends(get_current_user)):
    df = pd.DataFrame(columns=CLIENT_LEGACY_ORDER)
    data = df_to_excel_bytes(df)
    return StreamingResponse(io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=plantilla_clientes.xlsx"})

@api.post("/clients/import/preview")
async def import_clients_preview(file: UploadFile = File(...), user: dict = Depends(require_permission("importar"))):
    content = await file.read()
    df = read_import_table(content, file.filename or "").fillna("")
    df.columns = [str(c).strip().upper() for c in df.columns]
    rows = df.to_dict("records")
    if not rows:
        raise HTTPException(400, "El archivo no contiene registros.")
    if not any(c == "CLAVE" for c in df.columns) and not any(c == "NOMBRE" for c in df.columns):
        raise HTTPException(400, "El archivo no tiene columnas CLAVE/NOMBRE. Descarga la plantilla de clientes.")
    all_codes = [str(r.get("CLAVE", "")).strip() for r in rows if str(r.get("CLAVE", "")).strip()]
    existentes_db = set()
    if all_codes:
        async for c in db.clients.find({"codigo": {"$in": all_codes}}, {"_id": 0, "codigo": 1}):
            existentes_db.add(c["codigo"])
    preview, vistos = [], set()
    nuevos = existentes = con_errores = 0
    for i, r in enumerate(rows):
        data, errores = parse_client_row(r)
        clave = data.get("codigo", "")
        if clave and clave in vistos:
            errores.append({"campo": "CLAVE", "valor": clave, "motivo": "CLAVE duplicada en el archivo"})
        vistos.add(clave)
        existe = clave in existentes_db
        if errores:
            con_errores += 1
        elif existe:
            existentes += 1
        else:
            nuevos += 1
        preview.append({"fila": i + 2, "clave": clave, "nombre": data.get("nombre", ""),
                        "accion": "actualizar" if existe else "crear", "existe": existe,
                        "errores": errores, "data": data})
    return {"total": len(preview), "nuevos": nuevos, "existentes": existentes,
            "con_errores": con_errores, "columnas": CLIENT_LEGACY_ORDER, "preview": preview}

@api.post("/clients/import/confirm")
async def import_clients(payload: dict, user: dict = Depends(require_permission("importar"))):
    rows = payload.get("rows", [])
    mode = payload.get("mode", "ambos")  # nuevos | actualizar | ambos
    actualizar_saldo = bool(payload.get("actualizar_saldo", False))
    creados = actualizados = omitidos = 0
    for r in rows:
        if r.get("errores"):
            omitidos += 1
            continue
        data = r.get("data", {})
        clave = str(data.get("codigo", "")).strip()
        if not clave:
            omitidos += 1
            continue
        existing = await db.clients.find_one({"codigo": clave})
        if existing:
            if mode == "nuevos":
                omitidos += 1
                continue
            doc = normalize_client_doc(dict(data))
            doc.pop("id", None)
            if actualizar_saldo:
                doc["saldo"] = float(data.get("saldo") or 0.0)  # carga de saldo inicial desde archivo
            else:
                doc.pop("saldo", None)  # por defecto el saldo lo gobiernan las ventas
            doc["codigo"] = clave
            doc["updated_at"] = iso_now()
            await db.clients.update_one({"codigo": clave}, {"$set": doc})
            actualizados += 1
        else:
            if mode == "actualizar":
                omitidos += 1
                continue
            doc = normalize_client_doc(dict(data))
            doc["id"] = uid()
            doc["codigo"] = clave
            doc.setdefault("tipo", "publico")
            doc.setdefault("estado", "activo")
            doc["saldo"] = float(data.get("saldo") or 0.0)
            doc["created_at"] = iso_now()
            await db.clients.insert_one(doc)
            creados += 1
    if creados or actualizados:
        await log_audit(user, "importar", "cliente", "", f"{creados} creados, {actualizados} actualizados, {omitidos} omitidos")
    return {"creados": creados, "actualizados": actualizados, "omitidos": omitidos}

# =========================================================================
# EXPORTACIÓN / IMPORTACIÓN GLOBAL DE DATOS (solo administradores)
# Formato: ZIP con manifiesto de versión + un JSON por entidad.
# =========================================================================
import zipfile

EXPORT_COLLECTIONS = ["sucursales", "users", "products", "clients", "sales",
                      "cajas", "caja_movimientos", "inventory_movements", "abonos",
                      "cfdi_documents", "categories", "suspended_sales", "settings",
                      "mensajes", "plantillas"]
EXPORT_SKIP_SECRET_KEYS = {"password_hash", "api_key", "api_password", "api_user",
                           "token", "secret", "csrf", "refresh_token"}

def _sanitize_export(doc: dict) -> dict:
    out = {}
    for k, v in (doc or {}).items():
        if str(k).lower() in EXPORT_SKIP_SECRET_KEYS:
            continue
        out[k] = v
    return out

@api.get("/datos/export")
async def exportar_datos(user: dict = Depends(require_permission("exportar"))):
    """Exporta la BD a un ZIP (manifiesto + JSON por entidad). Solo admin."""
    if not user_has_permission(user, "config"):
        raise HTTPException(403, "La exportación global requiere rol administrador")
    buf = io.BytesIO()
    payload = {"formato": "rysa-datos", "version": 2, "fecha": iso_now(), "colecciones": {}}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for col in EXPORT_COLLECTIONS:
            try:
                docs = await getattr(db, col).find({}, {"_id": 0}).to_list(1000000)
                payload["colecciones"][col] = len(docs)
                z.writestr(f"{col}.json", json.dumps([_sanitize_export(d) for d in docs], ensure_ascii=False, default=str))
            except Exception as e:
                payload["colecciones"][col] = f"error: {e}"
        z.writestr("manifest.json", json.dumps(payload, ensure_ascii=False))
    buf.seek(0)
    await log_audit(user, "exportar_datos", "sistema", "", "Exportación global de datos (admin)")
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": 'attachment; filename="rysa_export.zip"'})

@api.post("/datos/import")
async def importar_datos(file: UploadFile = File(...), user: dict = Depends(require_permission("config"))):
    """Importa un ZIP de rysa_export: valida versión/integridad y restaura por entidad.
    NOTA: excluye `users` y `settings` (para evitar escalamiento de privilegios desde un archivo)."""
    data = await file.read()
    if len(data) > 100 * 1024 * 1024:
        raise HTTPException(400, "Archivo demasiado grande")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(400, "Archivo ZIP inválido")
    if "manifest.json" not in z.namelist():
        raise HTTPException(400, "Manifiesto no encontrado: no es un respaldo de RYSA")
    manifest = json.loads(z.read("manifest.json"))
    if manifest.get("formato") != "rysa-datos":
        raise HTTPException(400, "Formato de respaldo no válido")
    if int(manifest.get("version", 1)) < 1:
        raise HTTPException(400, "Versión de respaldo no soportada")
    resultados = {}
    for col in EXPORT_COLLECTIONS:
        if col in ("users", "settings"):
            continue  # no se restauran usuarios (escalamiento) ni settings sensibles
        if f"{col}.json" not in z.namelist():
            continue
        docs = json.loads(z.read(f"{col}.json"))
        n0 = await getattr(db, col).count_documents({})
        creados = 0
        for d in docs:
            if not d.get("id") and not d.get("codigo"):
                continue
            try:
                flt = {"id": d["id"]} if d.get("id") else {"codigo": d["codigo"]}
                if await getattr(db, col).find_one(flt):
                    continue
                await getattr(db, col).insert_one(d)
                creados += 1
            except Exception:
                continue
        resultados[col] = {"previos": n0, "creados": creados}
    await log_audit(user, "importar_datos", "sistema", "", "Importación global de datos (admin)")
    return {"ok": True, "resumen": resultados}

# =========================================================================
# AUDITORÍA
# =========================================================================
@api.get("/audit")
async def audit(user: dict = Depends(require_permission("auditoria.ver"))):
    return await db.audit_logs.find({}, {"_id": 0}).sort("fecha", -1).to_list(300)

# =========================================================================
# HERRAMIENTAS DE DESARROLLADOR / MANTENIMIENTO (solo admin_desarrollador)
# En producción estos endpoints NO existen (404), independientemente del rol.
# =========================================================================
def _dev_only(user: dict = Depends(require_permission("dev.errores"))):
    if _APP_ENV == "production":
        raise HTTPException(status_code=404, detail="No encontrado")
    return user

@api.get("/dev/errores")
async def dev_errores(user: dict = Depends(_dev_only)):
    return {"errores": list(reversed(DEV_ERRORS))}

@api.delete("/dev/errores")
async def dev_buscar_errores(user: dict = Depends(_dev_only)):
    DEV_ERRORS.clear()
    await log_audit(user, "dev_limpiar", "dev", "errores", "Bitácora de errores limpiada")
    return {"ok": True}

@api.get("/dev/info")
async def dev_info(user: dict = Depends(_dev_only)):
    counts = {}
    for col in ("users", "products", "clients", "sales", "cajas", "caja_movimientos",
                "abonos", "audit_logs", "counters"):
        try:
            counts[col] = await getattr(db, col).count_documents({})
        except Exception:
            counts[col] = 0
    return {
        "entorno": _APP_ENV,
        "python": platform.python_version(),
        "fecha_servidor": iso_now(),
        "roles": {r: sorted(p) for r, p in ROLE_PERMISSIONS.items()},
        "colecciones": counts,
        "errores_en_memoria": len(DEV_ERRORS),
        "admin_system_roles": sorted(ADMIN_SYSTEM_ROLES),
    }

# =========================================================================
# SUCURSALES
# =========================================================================
@api.get("/sucursales")
async def list_sucursales(user: dict = Depends(get_current_user)):
    sucs = await db.sucursales.find({}, {"_id": 0}).to_list(500)
    sucs.sort(key=lambda s: s.get("codigo", ""))
    return sucs

@api.post("/sucursales")
async def create_sucursal(data: SucursalItem, user: dict = Depends(require_permission("config"))):
    nombre = (data.nombre or "").strip()
    if not nombre:
        raise HTTPException(400, "La sucursal requiere un nombre")
    codigo = (data.codigo or nombre).strip().upper()
    doc = {"id": uid(), "codigo": codigo, "nombre": nombre, "activa": True,
           "direccion": data.direccion, "ciudad": data.ciudad, "estado": data.estado,
           "cp": data.cp, "telefono": data.telefono, "created_at": iso_now()}
    await db.sucursales.insert_one(doc)
    await log_audit(user, "crear", "sucursal", doc["id"], nombre)
    return await db.sucursales.find_one({"id": doc["id"]}, {"_id": 0})

@api.put("/sucursales/{sucursal_id}")
async def update_sucursal(sucursal_id: str, data: SucursalItem,
                          user: dict = Depends(require_permission("config"))):
    doc = data.model_dump()
    await db.sucursales.update_one({"id": sucursal_id}, {"$set": doc})
    await log_audit(user, "editar", "sucursal", sucursal_id, data.nombre)
    return await db.sucursales.find_one({"id": sucursal_id}, {"_id": 0})

@api.delete("/sucursales/{sucursal_id}")
async def delete_sucursal(sucursal_id: str, user: dict = Depends(require_permission("config"))):
    await db.sucursales.delete_one({"id": sucursal_id})
    return {"ok": True}

# =========================================================================
# CONFIGURACIÓN / SETTINGS
# =========================================================================
@api.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    s = await db.settings.find_one({"_id": "app"}, {"_id": 0})
    return s or {}

@api.get("/settings/branding")
async def get_branding():
    """Branding público (logo + nombre) para Login/Landing, con fallback."""
    s = await db.settings.find_one({"_id": "app"}, {"_id": 0}) or {}
    return {
        "empresa_nombre": s.get("empresa_nombre", "Grupo RYSA"),
        "logo_url": s.get("logo_url") or "",
    }


@api.put("/settings")
async def update_settings(data: SettingsInput, user: dict = Depends(require_permission("config"))):
    doc = data.model_dump()
    await db.settings.update_one({"_id": "app"}, {"$set": doc}, upsert=True)
    await log_audit(user, "editar", "configuracion", "app", "Actualización de configuración")
    return doc

# =========================================================================
# ARCHIVOS / OBJECT STORAGE (imágenes de productos/categorías, PDFs de ticket)
# =========================================================================
@api.post("/uploads/image")
async def upload_image(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(400, "La imagen no debe superar 8 MB.")
    
    # Validar tipo MIME real por firma de bytes
    real_mime = storage.detect_mime_type(data)
    if real_mime not in ["image/jpeg", "image/png", "image/gif", "image/webp"]:
        raise HTTPException(400, "Formato real no permitido. Usa JPG, PNG, WEBP o GIF.")
        
    mime_to_ext = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp"
    }
    safe_ext = mime_to_ext.get(real_mime, "png")
    
    # Para evitar vulnerabilidades de path traversal y sobrescritura, usamos un UUID aleatorio
    path = f"uploads/{uid()}.{safe_ext}"
    ctype = real_mime
    try:
        result = storage.put_object(path, data, ctype)
    except Exception as e:
        logger.error("Upload imagen falló: %s", str(e)[:160])
        raise HTTPException(502, "No se pudo subir la imagen al almacenamiento local.")
    stored = result.get("path", path)
    await db.files.insert_one({
        "id": uid(), "storage_path": stored, "original_filename": file.filename,
        "content_type": ctype, "size": result.get("size", len(data)),
        "is_deleted": False, "created_at": iso_now(),
    })
    return {"path": stored, "url": f"/api/files/{stored}"}

@api.get("/files/{path:path}")
async def serve_file(path: str):
    # Defensa en profundidad: rechazo temprano de path traversal antes de tocar
    # el storage (storage.get_safe_local_path ya lo bloquea también).
    if not path or path.startswith("/") or "\\" in path or path.split("/")[0] in ("..", "."):
        raise HTTPException(404, "Archivo no encontrado")
    if ".." in path:
        raise HTTPException(404, "Archivo no encontrado")
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(404, "Archivo no encontrado")
    try:
        data, ctype = storage.get_object(path)
    except Exception as e:
        logger.error("Error al obtener archivo local %s: %s", path, str(e)[:120])
        raise HTTPException(404, "Archivo no disponible")
    return Response(content=data, media_type=record.get("content_type", ctype))

@api.get("/sales/{sale_id}/qr")
async def sale_qr_png(sale_id: str, size: int = 240, destino: Optional[str] = None):
    """Genera un PNG del QR de verificación del ticket."""
    import qrcode
    from io import BytesIO
    from fastapi.responses import Response as FastResponse
    sale = await db.sales.find_one({"id": sale_id}, {"_id": 0})
    if not sale:
        raise HTTPException(404, "Ticket no encontrado")
    if destino:
        url = destino
    else:
        base_url = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
        url = f"{base_url}/verificar/{sale_id}" if base_url else f"/api/sales/{sale_id}/public"
    qr = qrcode.QRCode(err_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    bio = BytesIO()
    img.save(bio, format="PNG")
    return FastResponse(content=bio.getvalue(), media_type="image/png",
                        headers={"Cache-Control": "no-store"})

@api.post("/sales/{sale_id}/ticket-pdf")
async def sale_ticket_pdf(sale_id: str, user: dict = Depends(get_current_user)):
    sale = await db.sales.find_one({"id": sale_id}, {"_id": 0})
    if not sale:
        raise HTTPException(404, "Venta no encontrada")
    settings = await db.settings.find_one({"_id": "app"}, {"_id": 0}) or {}
    try:
        pdf_bytes = storage.build_ticket_pdf(sale, settings)
        # Nombre de archivo basado en folio seguro + UUID
        folio_clean = "".join(c for c in sale.get('folio', 'sale') if c.isalnum())
        path = f"tickets/{folio_clean}-{uid()[:8]}.pdf"
        result = storage.put_object(path, pdf_bytes, "application/pdf")
    except Exception as e:
        logger.error("Ticket PDF falló: %s", str(e)[:160])
        raise HTTPException(502, "No se pudo generar el PDF del ticket.")
    stored = result.get("path", path)
    await db.files.insert_one({
        "id": uid(), "storage_path": stored, "original_filename": f"ticket-{sale.get('folio')}.pdf",
        "content_type": "application/pdf", "size": result.get("size", len(pdf_bytes)),
        "sale_id": sale_id, "is_deleted": False, "created_at": iso_now(),
    })
    return {"path": stored, "url": f"/api/files/{stored}"}


@api.get("/vendedores")
async def vendedores(user: dict = Depends(get_current_user)):
    return await db.users.find({"active": {"$ne": False}}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200)

@api.get("/sales/{sale_id}/public")
async def sale_public_verify(sale_id: str):
    """Verificación pública del ticket (para el QR). No requiere autenticación."""
    sale = await db.sales.find_one({"id": sale_id}, {"_id": 0})
    if not sale or sale.get("estado") != "confirmada":
        raise HTTPException(404, "Ticket no encontrado")
    settings = await db.settings.find_one({"_id": "app"}, {"_id": 0}) or {}
    return {
        "ok": True,
        "folio": sale.get("folio"),
        "fecha": sale.get("fecha"),
        "empresa": settings.get("empresa_nombre", "Grupo RYSA"),
        "rfc": settings.get("rfc", ""),
        "cliente": sale.get("cliente_nombre", "Público General"),
        "total": sale.get("total"),
        "moneda": settings.get("moneda", "MXN"),
        "condicion": sale.get("condicion"),
        "items": [{"descripcion": i.get("descripcion"), "cantidad": i.get("cantidad"),
                   "precio": i.get("precio"), "importe": i.get("importe", i.get("cantidad", 0) * i.get("precio", 0))}
                  for i in sale.get("items", [])],
    }

@api.get("/sales-next-folio")
async def sales_next_folio(user: dict = Depends(get_current_user)):
    v = await db.counters.find_one({"_id": "venta"})
    c = await db.counters.find_one({"_id": "cotizacion"})
    vn = (v["seq"] if v else 0) + 1
    cn = (c["seq"] if c else 0) + 1
    return {"venta": f"V{str(vn).zfill(6)}", "cotizacion": f"COT{str(cn).zfill(6)}"}

# =========================================================================
# FACTURACIÓN CFDI 4.0 (PAC: Facty.mx)
# =========================================================================
class PacConfigInput(BaseModel):
    provider: str = "facty"
    environment: str = "sandbox"        # sandbox | produccion
    api_key: Optional[str] = ""          # API Key / Token de Facty.mx (Bearer)
    api_user: Optional[str] = ""         # reservado por compatibilidad (no usado por Facty.mx)
    api_password: Optional[str] = ""     # reservado por compatibilidad (no usado por Facty.mx)
    rfc: Optional[str] = ""
    razon_social: Optional[str] = ""
    regimen_fiscal: Optional[str] = "601"
    serie: Optional[str] = "A"
    folio: Optional[int] = 1
    lugar_expedicion: Optional[str] = ""  # CP
    timbres_alerta: Optional[int] = 20    # avisar cuando queden menos

class ComplementoPagoInput(BaseModel):
    factura_id: str
    monto: float
    metodo: str = "efectivo"      # efectivo | tarjeta | transferencia | spei | deposito | otros
    fecha: Optional[str] = None   # fecha del pago (YYYY-MM-DD)

# -------------------------------------------------------------------------
# Toda la comunicación con el PAC (Facty.mx) vive en pac_provider.py.
# La lógica de negocio del resto de la app (órdenes, POS, cobros, CxC) NO cambia:
# estos endpoints conservan su contrato. Si se cambia de PAC solo se toca pac_provider.py.
# -------------------------------------------------------------------------

async def get_pac_config():
    return await pac_provider.get_config()

def pac_configurado(cfg):
    return bool(cfg and pac_provider.api_key(cfg) and cfg.get("rfc"))

# -------------------------------------------------------------------------
# REFERENCIA (INACTIVA): implementación previa que construía el payload en el
# formato de Facturama (POST /3/cfdis). Se conserva comentada por si se necesita.
# La implementación activa está en pac_provider._payload_factura().
# -------------------------------------------------------------------------
# def facty_request(cfg, method, path, **kwargs):
#     base = FACTY_URLS.get(cfg.get("environment", "sandbox"), FACTY_URLS["sandbox"])
#     headers = {"Authorization": f"Bearer {cfg.get('api_key', '')}", **kwargs.pop("headers", {})}
#     with httpx.Client(base_url=base, headers=headers, timeout=30.0) as c:
#         r = c.request(method, path, **kwargs)
#         if r.status_code >= 400:
#             raise HTTPException(r.status_code, f"PAC (Facty.mx): {r.text[:500]}")
#         return r.json()
#
# def _money(x):
#     return f"{round(float(x) + 1e-9, 2):.2f}"
#
# def sale_to_cfdi_payload(sale, cliente, cfg):
#     forma_map = {"efectivo": "01", "tarjeta": "04", "transferencia": "03",
#                  "spei": "03", "deposito": "03", "otros": "99"}
#     pago = (sale.get("pagos") or [{}])
#     forma = forma_map.get((pago[0].get("metodo") if pago else "efectivo"), "01")
#     rfc = (cliente.get("rfc") if cliente else "") or "XAXX010101000"
#     generico = rfc == "XAXX010101000"
#     receiver = {
#         "Rfc": rfc.upper(),
#         "Name": ((cliente.get("nombre") if cliente else "") or "PUBLICO EN GENERAL").upper(),
#         "CfdiUse": (cliente.get("uso_cfdi") if cliente else "") or ("S01" if generico else "G03"),
#         "FiscalRegime": (cliente.get("reg_fiscal") if cliente else "") or ("616" if generico else "601"),
#         "TaxZipCode": (cliente.get("cp") if cliente else "") or cfg.get("lugar_expedicion") or "00000",
#     }
#     items = []
#     for it in sale.get("items", []):
#         tasa = float(it.get("iva_tasa", 16)) / 100
#         bruto_unit = float(it["precio"])
#         base_unit = round(bruto_unit / (1 + tasa), 2)
#         base = round(base_unit * it["cantidad"], 2)
#         tax = round(base * tasa, 2)
#         items.append({
#             "Quantity": _money(it["cantidad"]), "ProductCode": it.get("clave_sat") or "01010101",
#             "UnitCode": it.get("clave_unidad") or "H87", "Unit": it.get("unidad") or "Pieza",
#             "Description": it["descripcion"], "IdentificationNumber": it.get("codigo", ""),
#             "UnitPrice": _money(base_unit), "Subtotal": _money(base), "TaxObject": "02",
#             "Taxes": [{"Name": "IVA", "Rate": f"{tasa}", "Total": _money(tax), "Base": _money(base),
#                        "IsRetention": False, "IsFederalTax": True}],
#             "Total": _money(base + tax),
#         })
#     return {
#         "CfdiType": "I", "NameId": "1", "ExpeditionPlace": cfg.get("lugar_expedicion") or "00000",
#         "Serie": cfg.get("serie") or "A", "PaymentForm": forma, "PaymentMethod": "PUE",
#         "Exportation": "01", "Currency": "MXN", "Receiver": receiver, "Items": items,
#     }

@api.get("/facturacion/config")
async def get_pac_config_ep(user: dict = Depends(require_permission("config"))):
    cfg = await get_pac_config() or {}
    cfg = dict(cfg)
    cfg["api_key_set"] = bool(cfg.get("api_key"))
    cfg["api_password_set"] = bool(cfg.get("api_password"))
    cfg.pop("api_password", None)
    cfg.pop("api_key", None)
    cfg["configurado"] = pac_configurado(await get_pac_config())
    return cfg

@api.put("/facturacion/config")
async def put_pac_config(data: PacConfigInput, user: dict = Depends(require_permission("config"))):
    doc = data.model_dump()
    existing = await get_pac_config() or {}
    if not doc.get("api_key"):  # conservar API Key si no se reenvía
        doc["api_key"] = existing.get("api_key", "")
    if not doc.get("api_password"):  # conservar contraseña si no se reenvía
        doc["api_password"] = existing.get("api_password", "")
    await db.pac_config.update_one({"_id": "pac"}, {"$set": doc}, upsert=True)
    await log_audit(user, "editar", "facturacion", "config", f"PAC {doc.get('provider')} ({doc.get('environment')})")
    return {"ok": True, "configurado": pac_configurado(doc)}

@api.get("/facturacion/timbres")
async def timbres(user: dict = Depends(get_current_user)):
    cfg = await get_pac_config()
    if not pac_configurado(cfg):
        return {"configurado": False, "disponibles": None, "plan": None}
    try:
        data = await pac_provider.listar_timbres(cfg)
        disp = int(data.get("disponibles") or 0)
        res = {"configurado": True, "disponibles": disp, "plan": data.get("plan"),
               "expira": None, "actualizado": iso_now(),
               "alerta": disp <= int(cfg.get("timbres_alerta", 20))}
        await db.pac_config.update_one({"_id": "pac"}, {"$set": {"timbres_cache": res}})
        return res
    except HTTPException as e:
        cached = (cfg.get("timbres_cache") or {})
        cached["configurado"] = True
        cached["error"] = str(e.detail)[:200]
        return cached


@api.get("/facturacion")
async def list_cfdi(user: dict = Depends(get_current_user)):
    docs = await db.cfdi_documents.find({}, {"_id": 0, "response": 0}).sort("fecha", -1).to_list(2000)
    return docs

@api.get("/facturacion/facturables")
async def ventas_facturables(user: dict = Depends(get_current_user)):
    sales = await db.sales.find({"tipo_venta": {"$ne": "cotizacion"}, "estado": "confirmada",
                                 "facturado": {"$ne": True}}, {"_id": 0}).sort("fecha", -1).to_list(500)
    return sales

@api.post("/facturacion/sale/{sale_id}")
async def emitir_cfdi(sale_id: str, user: dict = Depends(require_permission("venta.crear"))):
    cfg = await get_pac_config()
    if not pac_configurado(cfg):
        raise HTTPException(400, "El PAC no está configurado. Ve a Configuración → Facturación y captura tu API Key de Facty.")
    sale = await db.sales.find_one({"id": sale_id}, {"_id": 0})
    if not sale:
        raise HTTPException(404, "Venta no encontrada")
    if sale.get("facturado"):
        raise HTTPException(400, "Esta venta ya fue facturada")
    cliente = await db.clients.find_one({"id": sale.get("cliente_id")}, {"_id": 0}) if sale.get("cliente_id") else None
    result = await pac_provider.crear_factura(sale, cliente, cfg)
    fid = result.get("id")
    uuid_ = result.get("uuid")
    doc = {"id": uid(), "sale_id": sale_id, "folio_venta": sale.get("folio"),
           "pac_id": fid, "uuid": uuid_, "serie": result.get("serie"),
           "folio": result.get("folio"),
           "status": "vigente", "total": result.get("total", sale.get("total")),
           "cliente_nombre": (cliente.get("nombre") if cliente else "PUBLICO EN GENERAL"),
           "rfc": (cliente.get("rfc") if cliente else "") or "XAXX010101000",
           "fecha": iso_now(), "provider": cfg.get("provider") or "facty",
           "response": result.get("raw") or result}
    await db.cfdi_documents.insert_one(doc)
    await db.sales.update_one({"id": sale_id}, {"$set": {"facturado": True, "cfdi_uuid": uuid_, "cfdi_id": fid}})
    await log_audit(user, "facturar", "venta", sale_id, f"CFDI {uuid_}")
    return {"ok": True, "pac_id": fid, "uuid": uuid_, "folio": doc["folio"]}

class MultiFacturaInput(BaseModel):
    sale_ids: List[str] = Field(...)

@api.post("/facturacion/multi")
async def emitir_cfdi_multi(data: MultiFacturaInput, user: dict = Depends(require_permission("venta.facturar"))):
    """Factura varias ventas en UNA sola factura (CFDI).

    Reglas validadas en backend (evitar doble timbrado):
    - cada venta debe existir, estar `confirmada` y NO facturada;
    - todas deben pertenecer al MISMO cliente (RFC único);
    - ninguna puede ser cotización.
    Los conceptos de todas las ventas se agregan en un solo CFDI.
    """
    if not data.sale_ids:
        raise HTTPException(400, "Selecciona al menos una venta")
    cfg = await get_pac_config()
    if not pac_configurado(cfg):
        raise HTTPException(400, "El PAC no está configurado. Ve a Configuración → Facturación y captura tu API Key de Facty.")
    sales = []
    cliente_id = None
    for sid in data.sale_ids:
        s = await db.sales.find_one({"id": sid}, {"_id": 0})
        if not s:
            raise HTTPException(404, f"Venta {sid} no encontrada")
        if s.get("tipo_venta") == "cotizacion":
            raise HTTPException(400, f"La venta {s.get('folio')} es una cotización, no se puede facturar")
        if s.get("estado") != "confirmada":
            raise HTTPException(400, f"La venta {s.get('folio')} no está confirmada")
        if s.get("facturado"):
            raise HTTPException(400, f"La venta {s.get('folio')} ya fue facturada")  # evita doble timbre
        cid = s.get("cliente_id")
        if cid and cliente_id and cid != cliente_id:
            raise HTTPException(400, "Todas las ventas deben pertenecer al mismo cliente para una sola factura")
        if cid:
            cliente_id = cid
        sales.append(s)
    cliente = await db.clients.find_one({"id": cliente_id}, {"_id": 0}) if cliente_id else None

    # Doc agregado: una sola factura con los conceptos de todas las ventas.
    items = []
    for s in sales:
        items.extend(s.get("items", []))
    total = round(sum(float(s.get("total", 0)) for s in sales), 2)
    subtotal = round(sum(float(s.get("subtotal", 0)) for s in sales), 2)
    iva = round(sum(float(s.get("iva_total", 0)) for s in sales), 2)
    ag = {"id": uid(), "folio": "MULTI", "items": items, "total": total,
          "subtotal": subtotal, "iva_total": iva, "descuento_total": round(sum(float(s.get("descuento_total", 0)) for s in sales), 2),
          "condicion": "contado", "cliente_id": cliente_id, "cliente_nombre": cliente.get("nombre") if cliente else "PUBLICO EN GENERAL",
          "facturado": False}
    result = await pac_provider.crear_factura(ag, cliente, cfg)
    fid = result.get("id"); uuid_ = result.get("uuid")
    doc = {"id": uid(), "sale_ids": data.sale_ids, "sale_id": sales[0]["id"],
           "folio_venta": f"{sales[0].get('folio')}+{len(sales)}",
           "pac_id": fid, "uuid": uuid_, "serie": result.get("serie"), "folio": result.get("folio"),
           "status": "vigente", "total": result.get("total", total),
           "cliente_nombre": (cliente.get("nombre") if cliente else "PUBLICO EN GENERAL"),
           "rfc": (cliente.get("rfc") if cliente else "") or "XAXX010101000",
           "fecha": iso_now(), "provider": cfg.get("provider") or "facty",
           "response": result.get("raw") or result}
    await db.cfdi_documents.insert_one(doc)
    for s in sales:
        await db.sales.update_one({"id": s["id"]}, {"$set": {"facturado": True, "cfdi_uuid": uuid_, "cfdi_id": fid}})
    await log_audit(user, "facturar", "venta", ",".join(s["id"] for s in sales), f"CFDI multi {uuid_} ({len(sales)} ventas)")
    return {"ok": True, "pac_id": fid, "uuid": uuid_, "folio": doc["folio"], "ventas": len(sales)}


@api.get("/facturacion/{cfdi_id}/{fmt}")
async def descargar_cfdi(cfdi_id: str, fmt: str, user: dict = Depends(get_current_user)):
    if fmt not in ("xml", "pdf"):
        raise HTTPException(400, "Formato inválido")
    cfg = await get_pac_config()
    doc = await db.cfdi_documents.find_one({"id": cfdi_id}, {"_id": 0})
    if not doc or not pac_configurado(cfg):
        raise HTTPException(404, "CFDI o PAC no disponible")
    if fmt == "xml":
        raw, media = await pac_provider.descargar_xml(doc, cfg)
    else:
        raw, media = await pac_provider.descargar_pdf(doc, cfg)
    return StreamingResponse(io.BytesIO(raw), media_type=media,
        headers={"Content-Disposition": f"attachment; filename={doc.get('folio_venta','cfdi')}.{fmt}"})

@api.post("/facturacion/{cfdi_id}/cancel")
async def cancelar_cfdi(cfdi_id: str, motivo: str = "02", uuid_reemplazo: Optional[str] = None,
                        user: dict = Depends(require_permission("venta.cancelar"))):
    cfg = await get_pac_config()
    doc = await db.cfdi_documents.find_one({"id": cfdi_id})
    if not doc or not pac_configurado(cfg):
        raise HTTPException(404, "CFDI o PAC no disponible")
    if motivo not in ("01", "02", "03", "04"):
        raise HTTPException(422, "Motivo de cancelación inválido")
    if motivo == "01" and not uuid_reemplazo:
        raise HTTPException(422, "El motivo 01 requiere UUID de reemplazo")
    result = await pac_provider.cancelar_factura(doc, motivo, uuid_reemplazo, cfg)
    await db.cfdi_documents.update_one({"id": cfdi_id}, {"$set": {"status": "cancelado", "cancelacion": result}})
    if doc.get("sale_id"):
        await db.sales.update_one({"id": doc["sale_id"]}, {"$set": {"facturado": False}})
    await log_audit(user, "cancelar", "facturacion", cfdi_id, f"motivo {motivo}")
    return {"ok": True, "result": result}


@api.post("/facturacion/complemento-pago")
async def emitir_rep(data: ComplementoPagoInput, user: dict = Depends(require_permission("venta.cancelar"))):
    """Emite el Complemento de Recepción de Pagos (REP) contra una factura PPD.
    Uso manual (preparado, no conectado automáticamente a CxC)."""
    cfg = await get_pac_config()
    if not pac_configurado(cfg):
        raise HTTPException(400, "El PAC no está configurado. Configura tu API Key de Facty.")
    padre = await db.cfdi_documents.find_one({"id": data.factura_id}, {"_id": 0})
    if not padre:
        raise HTTPException(404, "Factura padre no encontrada")
    result = await pac_provider.emitir_complemento_pago(cfg, padre, data.model_dump())
    await log_audit(user, "facturar", "facturacion", padre.get("id"), f"Complemento de pago sobre {padre.get('uuid')}")
    return {"ok": True, "result": result}


# =========================================================================
# REPORTES DE VENTAS Y UTILIDAD
# =========================================================================
def _hi(x):
    return str(x or "").strip().lower()

async def _build_reporte(desde, hasta, group, vendedor_id=None, q=None,
                         categoria=None, tipo=None, user=None, query_extra=None) -> dict:
    """Construye el reporte de ventas/utilidad con filtros opcionales.
    Filtros: vendedor_id, q (producto/código), categoria (clasificación), tipo (contado|credito).
    user: si no tiene reportes.global, se limita a sus propias ventas."""
    from deps import ver_reportes_globales
    now = now_utc()
    d = (desde[:10] if desde else now.strftime("%Y-%m-01"))
    h = (hasta[:10] if hasta else now.date().isoformat())
    query = {"estado": "confirmada"}
    if vendedor_id:
        query["vendedor_id"] = vendedor_id
    if tipo in ("contado", "credito"):
        query["condicion"] = tipo
    if user is not None and not ver_reportes_globales(user):
        # Usuario sin alcance global: solo reporta sus propias ventas.
        query["vendedor_id"] = user["id"]
    if query_extra:
        query.update(query_extra)
    sales = await db.sales.find(query, {"_id": 0}).to_list(50000)
    sales = [s for s in sales if d <= s.get("fecha", "")[:10] <= h]

    # mapa de productos: id -> {costo, clasificacion, linea}
    prods = await db.products.find({}, {"_id": 0, "id": 1, "costo": 1, "clasificacion": 1, "linea": 1}).to_list(50000)
    pmeta = {}
    for p in prods:
        pmeta[p["id"]] = {
            "costo": float(p.get("costo") or 0),
            "clasificacion": _hi(p.get("clasificacion")),
            "linea": _hi(p.get("linea")),
        }

    def linea_cumple(it):
        if not q and not categoria:
            return True
        meta = pmeta.get(it.get("product_id")) or {}
        if q:
            ql = _hi(q)
            hay = (ql in _hi(it.get("codigo")) or ql in _hi(it.get("descripcion")))
            if not hay:
                return False
        if categoria:
            cl = _hi(categoria)
            if cl not in (meta.get("clasificacion") or "") and cl not in (meta.get("linea") or ""):
                return False
        return True

    por_producto = {}
    por_vendedor = {}
    por_categoria = {}
    serie = {}
    tickets_contados = set()
    total_ingreso = total_costo = total_ventas = 0.0
    unidades = 0.0
    for s in sales:
        matching_lines = [it for it in s.get("items", []) if linea_cumple(it)]
        if not matching_lines:
            continue
        sale_total = 0.0
        for it in matching_lines:
            tasa = float(it.get("iva_tasa", 16)) / 100
            bruto = it["cantidad"] * it["precio"] - (it.get("descuento", 0) or 0)
            neto = bruto / (1 + tasa)
            costo_uni = pmeta.get(it.get("product_id"), {}).get("costo", 0.0)
            costo = costo_uni * it["cantidad"]
            pid = it.get("product_id") or it.get("codigo")
            p = por_producto.get(pid)
            if not p:
                meta = pmeta.get(it.get("product_id")) or {}
                p = {"codigo": it.get("codigo"), "descripcion": it.get("descripcion"),
                     "cantidad": 0, "ingreso": 0.0, "costo": 0.0,
                     "clasificacion": it.get("clasificacion") or ""}
                por_producto[pid] = p
            p["cantidad"] += it["cantidad"]
            p["ingreso"] += neto
            p["costo"] += costo
            total_ingreso += neto
            total_costo += costo
            unidades += it["cantidad"]
            sale_total += neto
            # categoria
            meta = pmeta.get(it.get("product_id")) or {}
            cat = meta.get("clasificacion") or meta.get("linea") or "Sin categoría"
            c = por_categoria.get(cat)
            if not c:
                c = {"categoria": cat, "cantidad": 0, "ingreso": 0.0, "costo": 0.0}
                por_categoria[cat] = c
            c["cantidad"] += it["cantidad"]
            c["ingreso"] += neto
            c["costo"] += costo
        # vendedor
        vid = s.get("vendedor_id") or "?"
        v = por_vendedor.get(vid)
        if not v:
            v = {"id": vid, "nombre": s.get("vendedor_nombre") or "Sin vendedor",
                 "tickets": 0, "ventas": 0.0, "utilidad": 0.0}
            por_vendedor[vid] = v
        if s["id"] not in tickets_contados:
            tickets_contados.add(s["id"])
            v["tickets"] += 1
        v["ventas"] += float(s.get("total", 0))
        v["utilidad"] += sale_total
        key = s.get("fecha", "")[:7] if group == "mes" else s.get("fecha", "")[:10]
        serie[key] = serie.get(key, 0) + float(s.get("total", 0))
        total_ventas += float(s.get("total", 0))

    productos = []
    for p in por_producto.values():
        util = p["ingreso"] - p["costo"]
        productos.append({**p, "ingreso": round(p["ingreso"], 2), "costo": round(p["costo"], 2),
                          "utilidad": round(util, 2),
                          "margen": round(util / p["ingreso"] * 100, 2) if p["ingreso"] else 0})
    top_vendidos = sorted(productos, key=lambda x: x["cantidad"], reverse=True)[:15]
    top_utilidad = sorted(productos, key=lambda x: x["utilidad"], reverse=True)[:15]
    series = [{"periodo": k, "total": round(v, 2)} for k, v in sorted(serie.items())]
    util_total = round(total_ingreso - total_costo, 2)
    vendedores = []
    for v in por_vendedor.values():
        v["ventas"] = round(v["ventas"], 2)
        v["utilidad"] = round(v["utilidad"], 2)
        v["ticket_promedio"] = round(v["ventas"] / v["tickets"], 2) if v["tickets"] else 0
        vendedores.append(v)
    vendedores.sort(key=lambda x: x["ventas"], reverse=True)
    ql = _hi(q)
    if ql:
        productos = [p for p in productos if ql in _hi(p["codigo"]) or ql in _hi(p["descripcion"])]
    categorias = []
    for c in por_categoria.values():
        util = c["ingreso"] - c["costo"]
        categorias.append({**c, "ingreso": round(c["ingreso"], 2), "costo": round(c["costo"], 2),
                           "utilidad": round(util, 2),
                           "margen": round(util / c["ingreso"] * 100, 2) if c["ingreso"] else 0})
    categorias.sort(key=lambda x: x["utilidad"], reverse=True)
    return {
        "desde": d, "hasta": h, "group": group, "filtros": {"vendedor": vendedor_id, "q": q, "categoria": categoria, "tipo": tipo},
        "totales": {"ventas": round(total_ventas, 2), "ingreso_neto": round(total_ingreso, 2),
                    "costo": round(total_costo, 2), "utilidad": util_total,
                    "margen": round(util_total / total_ingreso * 100, 2) if total_ingreso else 0,
                    "tickets": len(tickets_contados), "unidades": round(unidades, 2)},
        "series": series, "top_vendidos": top_vendidos, "top_utilidad": top_utilidad,
        "productos": sorted(productos, key=lambda x: x["utilidad"], reverse=True),
        "vendedores": vendedores,
        "categorias": categorias,
    }

@api.get("/reports/ventas")
async def reporte_ventas(desde: Optional[str] = None, hasta: Optional[str] = None,
                         group: str = "dia", vendedor_id: Optional[str] = None,
                         q: Optional[str] = None, categoria: Optional[str] = None,
                         tipo: Optional[str] = None, cliente_id: Optional[str] = None,
                         sucursal_id: Optional[str] = None, condicion: Optional[str] = None,
                         user: dict = Depends(require_permission("reportes.ver"))):
    query_extra = {}
    if cliente_id:
        query_extra["cliente_id"] = cliente_id
    if sucursal_id:
        query_extra["sucursal_id"] = sucursal_id
    if condicion in ("contado", "credito"):
        query_extra["condicion"] = condicion
    return await _build_reporte(desde, hasta, group, vendedor_id, q, categoria, tipo, user, query_extra=query_extra)

# --- Exportación de reportes: Excel y PDF ---
def _reporte_excel_bytes(rep: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    hf = Font(bold=True, color="FFFFFF"); fill = PatternFill("solid", fgColor="B95A3A")
    def estilar(ws):
        for c in ws[1]:
            c.font = hf; c.fill = fill
        for col in ws.columns:
            width = max(len(str(c.value)) for c in col if c.value is not None)
            ws.column_dimensions[col[0].column_letter].width = min(width + 2, 30)
    ws = wb.active; ws.title = "Resumen"
    t = rep["totales"]
    ws.append(["Métrica", "Valor"])
    for k in ["ventas", "ingreso_neto", "costo", "utilidad", "margen", "tickets", "unidades"]:
        ws.append([k, t.get(k)])
    estilar(ws)
    ws_c = wb.create_sheet("Categorías")
    ws_c.append(["Categoría", "Cantidad", "Ingreso", "Costo", "Utilidad", "Margen %"])
    for c in rep.get("categorias", []):
        ws_c.append([c["categoria"], c["cantidad"], c["ingreso"], c["costo"], c["utilidad"], c["margen"]])
    estilar(ws_c)
    ws2 = wb.create_sheet("Productos")
    ws2.append(["Código", "Producto", "Cantidad", "Ingreso", "Costo", "Utilidad", "Margen %"])
    for p in rep["productos"]:
        ws2.append([p["codigo"], p["descripcion"], p["cantidad"], p["ingreso"], p["costo"], p["utilidad"], p["margen"]])
    estilar(ws2)
    ws3 = wb.create_sheet("Vendedores")
    ws3.append(["Vendedor", "Tickets", "Ventas", "Ticket promedio", "Utilidad"])
    for v in rep.get("vendedores", []):
        ws3.append([v["nombre"], v["tickets"], v["ventas"], v["ticket_promedio"], v["utilidad"]])
    estilar(ws3)
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return buf.read()

def _reporte_pdf_bytes(rep: dict) -> bytes:
    from reportlab.lib.pagesizes import letter, landscape
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch, mm
    from reportlab.lib.enums import TA_RIGHT, TA_LEFT, TA_CENTER
    buf = io.BytesIO()
    margins = 18 * mm
    doc = SimpleDocTemplate(buf, pagesize=landscape(letter), leftMargin=margins,
                            rightMargin=margins, topMargin=margins, bottomMargin=margins,
                            title="Reporte de Ventas y Utilidad - Grupo RYSA",
                            author="Grupo RYSA")
    st = getSampleStyleSheet()
    st["Title"].fontName = "Helvetica-Bold"; st["Title"].fontSize = 16; st["Title"].textColor = colors.HexColor("#8B3A2A")
    st["Title"].alignment = TA_LEFT; st["Title"].spaceAfter = 2
    subt = ParagraphStyle("subt", parent=st["Normal"], fontSize=9, textColor=colors.HexColor("#666666"), spaceAfter=3)
    tiny = ParagraphStyle("tiny", parent=st["Normal"], fontSize=8, textColor=colors.HexColor("#888888"))
    h2 = ParagraphStyle("h2b", parent=st["Normal"], fontName="Helvetica-Bold", fontSize=11,
                        textColor=colors.HexColor("#8B3A2A"), spaceBefore=6, spaceAfter=4)

    logo_path = None
    for cand in (os.path.join(os.path.dirname(__file__), "brand", "logotipo.png"),
                 os.getenv("UPLOAD_DIR", "")):
        if cand and os.path.exists(cand):
            logo_path = cand
            break

    # --- Encabezado con logotipo ---
    enc_data = [[None, None]]
    if logo_path:
        try:
            enc_data = [[Image(logo_path, width=120, height=120 * (545 / 1157)), ""]]
        except Exception:
            enc_data = [[None, None]]
    enc = Table(enc_data, colWidths=[170, None])
    enc.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    elems = [enc]

    # Título y datos
    f = rep["filtros"] or {}
    titulo = Paragraph("Reporte de Ventas y Utilidad", st["Title"])
    meta = Paragraph(
        f"Periodo: {rep['desde']} a {rep['hasta']} &nbsp;&nbsp;|&nbsp;&nbsp; Generado: "
        f"{now_utc().strftime('%d/%m/%Y %H:%M')} &nbsp;&nbsp;|&nbsp;&nbsp; Agrupado por {rep['group']}",
        subt)
    filtros_txt = []
    if f.get("vendedor"):
        filtros_txt.append("vendedor seleccionado")
    if f.get("q"):
        filtros_txt.append(f"producto: {f['q']}")
    if f.get("categoria"):
        filtros_txt.append(f"categoría: {f['categoria']}")
    if f.get("tipo"):
        filtros_txt.append(f"tipo: {f['tipo']}")
    meta2 = Paragraph(("Filtros: " + ", ".join(filtros_txt)) if filtros_txt else "Sin filtros adicionales", tiny)
    head_block = Table([[Paragraph("<b>Grupo RYSA</b>", ParagraphStyle("emp", parent=st["Normal"], fontName="Helvetica-Bold", fontSize=13, textColor=colors.HexColor("#1f2937")))],
                        [titulo], [meta], [meta2]],
                       colWidths=[None])
    head_block.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    header = Table([[enc, head_block]], colWidths=[170, None])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("RIGHTPADDING", (1, 0), (1, 0), 4),
    ]))
    elems.append(header)
    # línea divisoria
    rule = Table([[""]], colWidths=[None])
    rule.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 1.2, colors.HexColor("#B95A3A")),
                              ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))
    elems.append(rule)

    # Resumen de totales
    t = rep["totales"]
    tot_style = ParagraphStyle("tot", parent=st["Normal"], fontName="Helvetica-Bold", fontSize=9, alignment=TA_CENTER)
    tot_rows = [["VENTAS", "INGRESO NETO", "COSTO", "UTILIDAD", "MARGEN", "TICKETS"],
                [f"$ {t['ventas']:,.2f}", f"$ {t['ingreso_neto']:,.2f}", f"$ {t['costo']:,.2f}",
                 f"$ {t['utilidad']:,.2f}", f"{t['margen']}%", str(t['tickets'])]]
    tot = Table(tot_rows, colWidths=[None] * 6)
    tot.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2b2b2b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("FONTSIZE", (0, 1), (-1, 1), 10),
        ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#f4ece6")),
        ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#2b2b2b")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#c9c9c9")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d9d9d9")),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elems.append(Spacer(1, 8))
    elems.append(tot)

    def seccion_tabla(title, data, colwidths, numero_cols):
        tab = Table(data, colWidths=colwidths, repeatRows=1)
        tab.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#B95A3A")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 8),
            ("ALIGN", (0, 1), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 1), (0, -1), "LEFT"),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e0d8d2")),
            ("FONTSIZE", (0, 1), (-1, -1), 7.5),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#faf5f1")]),
            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        return tab

    # Categorías
    elems.append(Paragraph("Reporte por categoría", h2))
    cat_data = [["Categoría", "Cantidad", "Ingreso", "Costo", "Utilidad", "Margen %"]]
    for c in rep["categorias"]:
        cat_data.append([c["categoria"], c["cantidad"], f"$ {c['ingreso']:,.2f}", f"$ {c['costo']:,.2f}",
                         f"$ {c['utilidad']:,.2f}", f"{c['margen']}%"])
    if len(cat_data) == 1:
        cat_data.append(["Sin ventas", "-", "-", "-", "-", "-"])
    elems.append(seccion_tabla("Categorías", cat_data, [None] * 6, 6))
    elems.append(Spacer(1, 6))

    # Productos
    elems.append(Paragraph("Utilidad por producto", h2))
    data = [["Código", "Producto", "Cantidad", "Ingreso", "Costo", "Utilidad", "Margen %"]]
    for p in rep["productos"][:120]:
        data.append([p["codigo"], p["descripcion"], p["cantidad"], f"$ {p['ingreso']:,.2f}",
                     f"$ {p['costo']:,.2f}", f"$ {p['utilidad']:,.2f}", f"{p['margen']}%"])
    if len(data) == 1:
        data.append(["-", "Sin ventas", "-", "-", "-", "-", "-"])
    elems.append(seccion_tabla("Productos", data, [72, None, 60, 78, 78, 78, 60], 7))

    def _pie(canvas, docu):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#777777"))
        canvas.drawString(margins, 10 * mm, "Grupo RYSA - Reporte generado automáticamente")
        canvas.drawRightString(docu.pagesize[0] - margins, 10 * mm, f"Página {docu.page}")
        canvas.restoreState()
    doc.build(elems, onFirstPage=_pie, onLaterPages=_pie)
    buf.seek(0)
    return buf.read()

@api.get("/reports/ventas/export")
async def reporte_ventas_export(desde: Optional[str] = None, hasta: Optional[str] = None,
                                group: str = "dia", vendedor_id: Optional[str] = None,
                                q: Optional[str] = None, categoria: Optional[str] = None,
                                tipo: Optional[str] = None, fmt: str = "excel",
                                cliente_id: Optional[str] = None, sucursal_id: Optional[str] = None,
                                condicion: Optional[str] = None,
                                user: dict = Depends(require_permission("exportar"))):
    query_extra = {}
    if cliente_id:
        query_extra["cliente_id"] = cliente_id
    if sucursal_id:
        query_extra["sucursal_id"] = sucursal_id
    if condicion in ("contado", "credito"):
        query_extra["condicion"] = condicion
    rep = await _build_reporte(desde, hasta, group, vendedor_id, q, categoria, tipo, user, query_extra=query_extra)
    suffix = "xlsx" if fmt == "excel" else "pdf"
    media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if fmt == "excel" else "application/pdf"
    if fmt == "excel":
        raw = _reporte_excel_bytes(rep)
    else:
        raw = _reporte_pdf_bytes(rep)
    fname = f"reporte_ventas_{rep['desde']}_{rep['hasta']}.{suffix}"
    return StreamingResponse(io.BytesIO(raw), media_type=media,
        headers={"Content-Disposition": f"attachment; filename={fname}"})

# =========================================================================
# STARTUP
# =========================================================================
@app.on_event("startup")
async def startup():
    try:
        storage.init_storage()
        logger.info("Almacenamiento local inicializado en: %s", storage.UPLOAD_DIR)
    except Exception as e:
        logger.error("Storage init falló: %s", str(e)[:160])
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.products.create_index("codigo")
    try:
        idx = await db.clients.index_information()
        if "codigo_1" in idx and not idx["codigo_1"].get("unique"):
            await db.clients.drop_index("codigo_1")
        await db.clients.create_index("codigo", unique=True)
    except Exception as e:
        logger.warning("Índice único clients.codigo: %s", str(e)[:120])
        
    # Seed admin SOLO en desarrollo y SOLO con credenciales de variables de
    # entorno (jamás hardcodeadas). Sin ADMIN_EMAIL/ADMIN_PASSWORD o con una
    # contraseña < 12 caracteres simplemente se omite el seed.
    env = os.environ.get("ENVIRONMENT", "development").lower()
    admin_email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    admin_pw = os.environ.get("ADMIN_PASSWORD", "")

    if env == "production":
        # En producción el seed del administrador NO se ejecuta automáticamente:
        # el primer usuario admin debe crearse manualmente.
        if not await db.users.find_one({"role": "admin"}):
            logger.warning(
                "Seed de admin desactivado en producción. Crea el usuario administrador "
                "manualmente antes de abrir el sistema."
            )
    else:
        if not admin_email or not admin_pw:
            logger.warning(
                "Seed de admin omitido: define ADMIN_EMAIL y ADMIN_PASSWORD "
                "(≥ 12 caracteres, nunca hardcodeados) para desarrollo."
            )
        elif not _password_ok(admin_pw):
            logger.warning("Seed de admin omitido: ADMIN_PASSWORD debe tener al menos 12 caracteres.")
        else:
            existing = await db.users.find_one({"email": admin_email})
            if not existing:
                await db.users.insert_one({
                    "id": uid(), "email": admin_email, "name": os.environ.get("ADMIN_NAME", "Admin"),
                    "role": "admin", "password_hash": hash_password(admin_pw),
                    "active": True, "token_version": 0, "created_at": iso_now()})
                logger.info("Admin seed creado: %s", admin_email)
            elif not verify_password(admin_pw, existing["password_hash"]):
                await db.users.update_one({"email": admin_email},
                                          {"$set": {"password_hash": hash_password(admin_pw)}})
                logger.info("Admin password actualizado (solo desarrollo).")
        
    # Cliente Público General por defecto
    if not await db.clients.find_one({"codigo": "PUBLICO"}):
        await db.clients.insert_one({
            "id": uid(), "codigo": "PUBLICO", "nombre": "Público General",
            "razon_social": "", "rfc": "XAXX010101000", "telefono": "", "whatsapp": "",
            "correo": "", "direccion": "", "ciudad": "", "estado_geo": "", "cp": "",
            "tipo": "publico", "lista_precios": 1, "condicion_pago": "contado",
            "limite_credito": 0, "saldo": 0, "estado": "activo", "created_at": iso_now()})
            
    # Configuración por defecto
    if not await db.settings.find_one({"_id": "app"}):
        await db.settings.insert_one({
            "_id": "app", "empresa_nombre": "Grupo RYSA", "rfc": "", "telefono": "",
            "correo": "contacto@gruporysa.com", "direccion": "", "ciudad": "", "estado": "",
            "cp": "", "iva_tasa": 16.0, "moneda": "MXN",
            "listas_precios_nombres": ["Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5"],
            "sucursales": [{"nombre": "Matriz", "direccion": "", "ciudad": "", "estado": "",
                            "cp": "", "telefono": "", "activa": True}]})

@app.on_event("shutdown")
async def shutdown():
    client.close()

# Middleware para inyección de Headers de Seguridad Básicos
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

app.include_router(api)

# Configuración dinámica de CORS
env = os.environ.get("ENVIRONMENT", "development").lower()
cors_origins_env = os.environ.get("CORS_ORIGINS", "")
if cors_origins_env:
    origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
else:
    if env == "production":
        origins = ["https://gruporysa.com"]
    else:
        # En desarrollo permitimos localhost comunes
        origins = ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000", "http://127.0.0.1:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"],
)
