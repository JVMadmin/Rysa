"""Grupo RYSA ERP - API principal (FastAPI + MongoDB)."""
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / '.env')

import os
import io
import uuid
import re
import logging
from typing import List, Optional
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Response, UploadFile, File
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr, ConfigDict
import pandas as pd
from datetime import datetime, date, timedelta
import httpx
import base64

from deps import (
    db, client, now_utc, iso_now, hash_password, verify_password, create_access_token,
    get_current_user, require_permission, has_permission, next_counter, log_audit,
    ROLE_PERMISSIONS,
)
import storage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rysa")

app = FastAPI(title="Grupo RYSA ERP")
api = APIRouter(prefix="/api")

def uid() -> str:
    return uuid.uuid4().hex

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

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = None

class PrecioItem(BaseModel):
    nombre: str = "Precio 1"
    utilidad_pct: float = 0.0
    precio_sin_iva: float = 0.0
    precio_con_iva: float = 0.0

class ProductInput(BaseModel):
    model_config = ConfigDict(extra="allow")
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
    caja_nombre: Optional[str] = "Caja 1"

class CajaMovimiento(BaseModel):
    tipo: str  # entrada | retiro | gasto | ajuste
    concepto: str
    monto: float
    referencia: Optional[str] = ""

class CajaClose(BaseModel):
    efectivo_contado: float

class SaleItem(BaseModel):
    product_id: str
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

class CancelInput(BaseModel):
    motivo: str

class SucursalItem(BaseModel):
    nombre: str = ""
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

@api.post("/auth/login")
async def login(data: LoginInput, response: Response):
    email = data.email.strip().lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Usuario desactivado")
    token = create_access_token(user["id"], user["email"])
    response.set_cookie("access_token", token, httponly=True, secure=True,
                        samesite="none", max_age=604800, path="/")
    return {"token": token, "user": public_user(user)}

@api.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": user, "permissions": sorted(list(ROLE_PERMISSIONS.get(user.get("role", ""), set())))}

# =========================================================================
# USUARIOS
# =========================================================================
@api.get("/users")
async def list_users(user: dict = Depends(require_permission("usuarios.ver"))):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(500)
    return users

@api.post("/users")
async def create_user(data: UserCreate, user: dict = Depends(require_permission("usuarios.ver"))):
    email = data.email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="El correo ya está registrado")
    doc = {"id": uid(), "email": email, "name": data.name, "role": data.role,
           "password_hash": hash_password(data.password), "active": True, "created_at": iso_now()}
    await db.users.insert_one(doc)
    await log_audit(user, "crear", "usuario", doc["id"], f"Usuario {email}")
    return public_user(doc)

@api.put("/users/{user_id}")
async def update_user(user_id: str, data: UserUpdate, user: dict = Depends(require_permission("usuarios.ver"))):
    upd = {k: v for k, v in data.model_dump().items() if v is not None}
    if "password" in upd:
        upd["password_hash"] = hash_password(upd.pop("password"))
    await db.users.update_one({"id": user_id}, {"$set": upd})
    await log_audit(user, "editar", "usuario", user_id)
    doc = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return doc

@api.get("/roles")
async def list_roles(user: dict = Depends(get_current_user)):
    return {r: sorted(list(p)) for r, p in ROLE_PERMISSIONS.items()}

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
        rx = {"$regex": q, "$options": "i"}
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
        rx = {"$regex": q, "$options": "i"}
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
        rx = {"$regex": q, "$options": "i"}
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
async def client_estado(client_id: str, estado: str, user: dict = Depends(require_permission("cliente.editar"))):
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
async def caja_abierta_de(user_id: str):
    return await db.cajas.find_one({"usuario_id": user_id, "estado": "abierta"}, {"_id": 0})

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
    doc = {"id": uid(), "usuario_id": user["id"], "usuario_nombre": user["name"],
           "caja_nombre": data.caja_nombre, "fondo_inicial": data.fondo_inicial,
           "estado": "abierta", "fecha_apertura": iso_now(), "fecha_cierre": None}
    await db.cajas.insert_one(doc)
    await log_audit(user, "abrir_caja", "caja", doc["id"], f"fondo {data.fondo_inicial}")
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

@api.get("/caja/historial")
async def caja_historial(desde: Optional[str] = None, hasta: Optional[str] = None,
                         estado: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {}
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
    query = {}
    if estado:
        query["estado"] = estado
    if vendedor_id:
        query["vendedor_id"] = vendedor_id
    if q:
        rx = {"$regex": q, "$options": "i"}
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
    return s

@api.put("/sales/{sale_id}/cliente")
async def set_sale_cliente(sale_id: str, payload: dict, user: dict = Depends(require_permission("venta.crear"))):
    s = await db.sales.find_one({"id": sale_id})
    if not s:
        raise HTTPException(404, "Venta no encontrada")
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
    # Vendedor: automático = usuario logueado, se puede cambiar
    vendedor_id = data.vendedor_id or user["id"]
    vendedor_nombre = user["name"]
    if data.vendedor_id and data.vendedor_id != user["id"]:
        v = await db.users.find_one({"id": data.vendedor_id}, {"_id": 0})
        if v:
            vendedor_nombre = v["name"]
    items = [it.model_dump() for it in data.items]
    es_cotizacion = data.tipo_venta == "cotizacion"
    for it in items:
        p = await db.products.find_one({"id": it["product_id"]})
        if not p:
            raise HTTPException(400, f"Producto {it['codigo']} no existe")
        if p.get("estado") != "activo":
            raise HTTPException(400, f"Producto {p['codigo']} no está activo")
        if not es_cotizacion:
            controles = p.get("controles", {}) or {}
            controlar = controles.get("controlar_inventario", True)
            permitir_neg = controles.get("permitir_inventario_negativo", False)
            if controlar and not permitir_neg and float(p.get("existencia", 0)) < it["cantidad"]:
                raise HTTPException(400, f"Existencia insuficiente de {p['codigo']} (disp: {p.get('existencia',0)})")
    totales = calcular_venta(items, data.descuento_global)
    total = totales["total"]
    pagos = [p.model_dump() for p in data.pagos]
    pagado = sum(p["monto"] for p in pagos)
    cambio = 0.0
    saldo = 0.0
    now = now_utc()
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
    caja = await caja_abierta_de(user["id"])
    sale = {
        "id": uid(), "folio": folio, "fecha": iso_now(),
        "hora": now.strftime("%H:%M"), "usuario_id": user["id"], "usuario_nombre": user["name"],
        "vendedor_id": vendedor_id, "vendedor_nombre": vendedor_nombre,
        "cliente_id": data.cliente_id, "cliente_nombre": cliente_nombre,
        "items": items, **totales, "tipo_venta": data.tipo_venta, "condicion": data.condicion,
        "pagos": pagos, "cambio": cambio, "saldo": saldo, "estado": estado,
        "factura": False, "caja_id": caja["id"] if (caja and not es_cotizacion) else None,
        "lista_precios": data.lista_precios,
    }
    await db.sales.insert_one(sale)
    if not es_cotizacion:
        # Descontar inventario + kardex
        for it in items:
            p = await db.products.find_one({"id": it["product_id"]})
            await registrar_movimiento(p, "venta", 0, it["cantidad"], user, folio, f"Venta {folio}")
        # Caja: efectivo entra
        if caja:
            efectivo = sum(p["monto"] for p in pagos if p["metodo"] == "efectivo")
            if data.condicion == "contado" and efectivo > 0:
                monto_caja = min(efectivo, total)
                await db.caja_movimientos.insert_one({
                    "id": uid(), "caja_id": caja["id"], "tipo": "venta", "concepto": f"Venta {folio}",
                    "monto": round(monto_caja, 2), "referencia": folio,
                    "usuario_id": user["id"], "usuario_nombre": user["name"], "fecha": iso_now()})
        # Crédito: aumentar saldo cliente
        if data.condicion == "credito" and cliente:
            await db.clients.update_one({"id": cliente["id"]}, {"$inc": {"saldo": total}})
    await log_audit(user, "crear", "cotizacion" if es_cotizacion else "venta", sale["id"], f"{folio} total {total}")
    return await db.sales.find_one({"id": sale["id"]}, {"_id": 0})

@api.post("/sales/{sale_id}/cancelar")
async def cancel_sale(sale_id: str, data: CancelInput, user: dict = Depends(require_permission("venta.cancelar"))):
    sale = await db.sales.find_one({"id": sale_id})
    if not sale:
        raise HTTPException(404, "Venta no encontrada")
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
async def delete_suspended(sid: str, user: dict = Depends(get_current_user)):
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
                   user: dict = Depends(get_current_user)):
    hoy = now_utc().date()
    clientes = await db.clients.find({"saldo": {"$gt": 0}}, {"_id": 0}).to_list(20000)
    cmap = {c["id"]: c for c in clientes}
    sales = await db.sales.find({"condicion": "credito", "estado": "confirmada", "saldo": {"$gt": 0}},
                                {"_id": 0, "cliente_id": 1, "fecha": 1, "saldo": 1}).to_list(100000)
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
            a.update({"vencido": 0.0, "max_dias": 0, "n": 0})
            agg[cid] = a
        a[_bucket(dv)] += s["saldo"]
        a["n"] += 1
        if dv > 0:
            a["vencido"] += s["saldo"]
            a["max_dias"] = max(a["max_dias"], dv)
    rows = []
    ql = (q or "").lower().strip()
    for cid, cli in cmap.items():
        a = agg.get(cid)
        item = {
            "cliente_id": cid, "codigo": cli.get("codigo"), "nombre": cli.get("nombre"),
            "telefono": cli.get("telefono"), "celular": cli.get("celular"),
            "limite_credito": round(float(cli.get("limite_credito", 0)), 2),
            "dias_credito": cli.get("dias_credito", 0),
            "saldo": round(float(cli.get("saldo", 0)), 2),
            "vencido": round(a["vencido"], 2) if a else 0.0,
            "max_dias": a["max_dias"] if a else 0,
            "ventas_pendientes": a["n"] if a else 0,
            "aging": {k: round(a[k], 2) for k in AGING_KEYS} if a else {k: 0.0 for k in AGING_KEYS},
        }
        if solo_vencidos and item["vencido"] <= 0:
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
async def cxc_detail(client_id: str, user: dict = Depends(get_current_user)):
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
    sales = await db.sales.find({"estado": "confirmada"}, {"_id": 0}).to_list(5000)
    ventas_hoy = [s for s in sales if s["fecha"][:10] == hoy]
    ventas_mes = [s for s in sales if s["fecha"][:7] == mes]
    total_hoy = round(sum(s["total"] for s in ventas_hoy), 2)
    total_mes = round(sum(s["total"] for s in ventas_mes), 2)
    # Caja
    caja = await caja_abierta_de(user["id"])
    total_caja = 0.0
    if caja:
        movs = await db.caja_movimientos.find({"caja_id": caja["id"]}, {"_id": 0}).to_list(1000)
        total_caja = resumen_caja(caja, movs)["efectivo_esperado"]
    # Productos
    products = await db.products.find({"estado": "activo"}, {"_id": 0}).to_list(5000)
    bajo_stock = [p for p in products if 0 < float(p.get("existencia", 0)) <= float(p.get("stock_minimo", 0))]
    sin_existencia = [p for p in products if float(p.get("existencia", 0)) <= 0]
    clientes = await db.clients.count_documents({})
    # ventas por dia ultimos 7
    serie = []
    for i in range(6, -1, -1):
        d = (now - __import__("datetime").timedelta(days=i)).date().isoformat()
        tot = round(sum(s["total"] for s in sales if s["fecha"][:10] == d), 2)
        serie.append({"dia": d[5:], "total": tot})
    recientes = sorted(sales, key=lambda s: s["fecha"], reverse=True)[:8]
    return {
        "ventas_hoy": total_hoy, "ventas_mes": total_mes,
        "num_ventas_hoy": len(ventas_hoy), "total_caja": total_caja,
        "bajo_stock": len(bajo_stock), "sin_existencia": len(sin_existencia),
        "clientes": clientes, "productos": len(products),
        "serie_ventas": serie,
        "ventas_recientes": [{"folio": s["folio"], "cliente": s["cliente_nombre"],
                              "total": s["total"], "fecha": s["fecha"], "estado": s["estado"]} for s in recientes],
        "alertas_stock": [{"codigo": p["codigo"], "descripcion": p["descripcion"],
                           "existencia": p.get("existencia", 0), "stock_minimo": p.get("stock_minimo", 0)}
                          for p in (bajo_stock + sin_existencia)[:10]],
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
        rx = {"$regex": q, "$options": "i"}
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
# AUDITORÍA
# =========================================================================
@api.get("/audit")
async def audit(user: dict = Depends(require_permission("reportes.ver"))):
    return await db.audit_logs.find({}, {"_id": 0}).sort("fecha", -1).to_list(300)

# =========================================================================
# CONFIGURACIÓN / SETTINGS
# =========================================================================
@api.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    s = await db.settings.find_one({"_id": "app"}, {"_id": 0})
    return s or {}

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
    ext = (file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "png")
    if ext not in storage.MIME_TYPES:
        raise HTTPException(400, "Formato no permitido. Usa JPG, PNG, WEBP o GIF.")
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(400, "La imagen no debe superar 8 MB.")
    path = f"{storage.APP_NAME}/uploads/{uid()}.{ext}"
    ctype = file.content_type or storage.MIME_TYPES.get(ext, "application/octet-stream")
    try:
        result = storage.put_object(path, data, ctype)
    except Exception as e:
        logger.error("Upload imagen falló: %s", str(e)[:160])
        raise HTTPException(502, "No se pudo subir la imagen al almacenamiento.")
    stored = result.get("path", path)
    await db.files.insert_one({
        "id": uid(), "storage_path": stored, "original_filename": file.filename,
        "content_type": ctype, "size": result.get("size", len(data)),
        "is_deleted": False, "created_at": iso_now(),
    })
    return {"path": stored, "url": f"/api/files/{stored}"}

@api.get("/files/{path:path}")
async def serve_file(path: str):
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(404, "Archivo no encontrado")
    try:
        data, ctype = storage.get_object(path)
    except Exception:
        raise HTTPException(404, "Archivo no disponible")
    return Response(content=data, media_type=record.get("content_type", ctype))

@api.post("/sales/{sale_id}/ticket-pdf")
async def sale_ticket_pdf(sale_id: str, user: dict = Depends(get_current_user)):
    sale = await db.sales.find_one({"id": sale_id}, {"_id": 0})
    if not sale:
        raise HTTPException(404, "Venta no encontrada")
    settings = await db.settings.find_one({"_id": "app"}, {"_id": 0}) or {}
    try:
        pdf_bytes = storage.build_ticket_pdf(sale, settings)
        path = f"{storage.APP_NAME}/tickets/{sale.get('folio', sale_id)}-{uid()[:8]}.pdf"
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

@api.get("/sales-next-folio")
async def sales_next_folio(user: dict = Depends(get_current_user)):
    v = await db.counters.find_one({"_id": "venta"})
    c = await db.counters.find_one({"_id": "cotizacion"})
    vn = (v["seq"] if v else 0) + 1
    cn = (c["seq"] if c else 0) + 1
    return {"venta": f"V{str(vn).zfill(6)}", "cotizacion": f"COT{str(cn).zfill(6)}"}

# =========================================================================
# FACTURACIÓN CFDI 4.0 (PAC-agnóstico; Facturama primero)
# =========================================================================
class PacConfigInput(BaseModel):
    provider: str = "facturama"
    environment: str = "sandbox"        # sandbox | produccion
    api_user: Optional[str] = ""
    api_password: Optional[str] = ""     # si viene vacío en PUT, se conserva la existente
    rfc: Optional[str] = ""
    razon_social: Optional[str] = ""
    regimen_fiscal: Optional[str] = "601"
    serie: Optional[str] = "A"
    folio: Optional[int] = 1
    lugar_expedicion: Optional[str] = ""  # CP
    timbres_alerta: Optional[int] = 20    # avisar cuando queden menos

FACTURAMA_URLS = {"sandbox": "https://apisandbox.facturama.mx", "produccion": "https://api.facturama.mx"}

async def get_pac_config():
    return await db.pac_config.find_one({"_id": "pac"}, {"_id": 0})

def pac_configurado(cfg):
    return bool(cfg and cfg.get("api_user") and cfg.get("api_password") and cfg.get("rfc"))

def facturama_request(cfg, method, path, **kwargs):
    base = FACTURAMA_URLS.get(cfg.get("environment", "sandbox"), FACTURAMA_URLS["sandbox"])
    with httpx.Client(base_url=base, auth=(cfg["api_user"], cfg["api_password"]), timeout=30.0) as c:
        r = c.request(method, path, **kwargs)
        if r.status_code >= 400:
            raise HTTPException(r.status_code, f"PAC: {r.text[:500]}")
        return r.json()

def _money(x):
    return f"{round(float(x) + 1e-9, 2):.2f}"

def sale_to_cfdi_payload(sale, cliente, cfg):
    forma_map = {"efectivo": "01", "tarjeta": "04", "transferencia": "03", "spei": "03", "deposito": "03", "otros": "99"}
    pago = (sale.get("pagos") or [{}])
    forma = forma_map.get((pago[0].get("metodo") if pago else "efectivo"), "01")
    rfc = (cliente.get("rfc") if cliente else "") or "XAXX010101000"
    generico = rfc == "XAXX010101000"
    receiver = {
        "Rfc": rfc.upper(),
        "Name": ((cliente.get("nombre") if cliente else "") or "PUBLICO EN GENERAL").upper(),
        "CfdiUse": (cliente.get("uso_cfdi") if cliente else "") or ("S01" if generico else "G03"),
        "FiscalRegime": (cliente.get("reg_fiscal") if cliente else "") or ("616" if generico else "601"),
        "TaxZipCode": (cliente.get("cp") if cliente else "") or cfg.get("lugar_expedicion") or "00000",
    }
    items = []
    for it in sale.get("items", []):
        tasa = float(it.get("iva_tasa", 16)) / 100
        bruto_unit = float(it["precio"])
        base_unit = round(bruto_unit / (1 + tasa), 2)
        base = round(base_unit * it["cantidad"], 2)
        tax = round(base * tasa, 2)
        items.append({
            "Quantity": _money(it["cantidad"]), "ProductCode": it.get("clave_sat") or "01010101",
            "UnitCode": it.get("clave_unidad") or "H87", "Unit": it.get("unidad") or "Pieza",
            "Description": it["descripcion"], "IdentificationNumber": it.get("codigo", ""),
            "UnitPrice": _money(base_unit), "Subtotal": _money(base), "TaxObject": "02",
            "Taxes": [{"Name": "IVA", "Rate": f"{tasa}", "Total": _money(tax), "Base": _money(base),
                       "IsRetention": False, "IsFederalTax": True}],
            "Total": _money(base + tax),
        })
    return {
        "CfdiType": "I", "NameId": "1", "ExpeditionPlace": cfg.get("lugar_expedicion") or "00000",
        "Serie": cfg.get("serie") or "A", "PaymentForm": forma, "PaymentMethod": "PUE",
        "Exportation": "01", "Currency": "MXN", "Receiver": receiver, "Items": items,
    }

@api.get("/facturacion/config")
async def get_pac_config_ep(user: dict = Depends(require_permission("config"))):
    cfg = await get_pac_config() or {}
    cfg = dict(cfg)
    cfg["api_password_set"] = bool(cfg.get("api_password"))
    cfg.pop("api_password", None)
    cfg["configurado"] = pac_configurado(await get_pac_config())
    return cfg

@api.put("/facturacion/config")
async def put_pac_config(data: PacConfigInput, user: dict = Depends(require_permission("config"))):
    doc = data.model_dump()
    existing = await get_pac_config() or {}
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
        data = facturama_request(cfg, "GET", "/SuscriptionPlan")
        disp = int(data.get("CurrentFolios") or 0)
        res = {"configurado": True, "disponibles": disp, "plan": data.get("Plan"),
               "expira": data.get("ExpirationDate"), "actualizado": iso_now(),
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
        raise HTTPException(400, "El PAC no está configurado. Ve a Configuración → Facturación y captura tus credenciales.")
    sale = await db.sales.find_one({"id": sale_id}, {"_id": 0})
    if not sale:
        raise HTTPException(404, "Venta no encontrada")
    if sale.get("facturado"):
        raise HTTPException(400, "Esta venta ya fue facturada")
    cliente = await db.clients.find_one({"id": sale.get("cliente_id")}, {"_id": 0}) if sale.get("cliente_id") else None
    payload = sale_to_cfdi_payload(sale, cliente, cfg)
    result = facturama_request(cfg, "POST", "/3/cfdis", json=payload)
    fid = result.get("Id")
    uuid_ = ((result.get("Complement") or {}).get("TaxStamp") or {}).get("Uuid")
    doc = {"id": uid(), "sale_id": sale_id, "folio_venta": sale.get("folio"),
           "facturama_id": fid, "uuid": uuid_, "serie": result.get("Serie"), "folio": result.get("Folio"),
           "status": "vigente", "total": result.get("Total", sale.get("total")),
           "cliente_nombre": (cliente.get("nombre") if cliente else "PUBLICO EN GENERAL"),
           "rfc": payload["Receiver"]["Rfc"], "fecha": iso_now(), "provider": cfg.get("provider"),
           "response": result}
    await db.cfdi_documents.insert_one(doc)
    await db.sales.update_one({"id": sale_id}, {"$set": {"facturado": True, "cfdi_uuid": uuid_, "cfdi_id": fid}})
    await log_audit(user, "facturar", "venta", sale_id, f"CFDI {uuid_}")
    return {"ok": True, "facturama_id": fid, "uuid": uuid_, "folio": result.get("Folio")}

@api.get("/facturacion/{cfdi_id}/{fmt}")
async def descargar_cfdi(cfdi_id: str, fmt: str, user: dict = Depends(get_current_user)):
    if fmt not in ("xml", "pdf"):
        raise HTTPException(400, "Formato inválido")
    cfg = await get_pac_config()
    doc = await db.cfdi_documents.find_one({"id": cfdi_id}, {"_id": 0})
    if not doc or not pac_configurado(cfg):
        raise HTTPException(404, "CFDI o PAC no disponible")
    data = facturama_request(cfg, "GET", f"/cfdi/{fmt}/issued/{doc['facturama_id']}")
    raw = base64.b64decode(data["Content"])
    media = "application/xml" if fmt == "xml" else "application/pdf"
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
    params = {"type": "issued", "motive": motivo}
    if uuid_reemplazo:
        params["uuidReplacement"] = uuid_reemplazo
    result = facturama_request(cfg, "DELETE", f"/cfdi/{doc['facturama_id']}", params=params)
    await db.cfdi_documents.update_one({"id": cfdi_id}, {"$set": {"status": "cancelado", "cancelacion": result}})
    if doc.get("sale_id"):
        await db.sales.update_one({"id": doc["sale_id"]}, {"$set": {"facturado": False}})
    await log_audit(user, "cancelar", "facturacion", cfdi_id, f"motivo {motivo}")
    return {"ok": True, "result": result}

# =========================================================================
# REPORTES DE VENTAS Y UTILIDAD
# =========================================================================
@api.get("/reports/ventas")
async def reporte_ventas(desde: Optional[str] = None, hasta: Optional[str] = None,
                         group: str = "dia", user: dict = Depends(get_current_user)):
    now = now_utc()
    d = (desde[:10] if desde else now.strftime("%Y-%m-01"))
    h = (hasta[:10] if hasta else now.date().isoformat())
    sales = await db.sales.find({"estado": "confirmada"}, {"_id": 0}).to_list(50000)
    sales = [s for s in sales if d <= s.get("fecha", "")[:10] <= h]
    # costos de productos
    prods = await db.products.find({}, {"_id": 0, "id": 1, "costo": 1}).to_list(50000)
    costo_map = {p["id"]: float(p.get("costo") or 0) for p in prods}
    por_producto = {}
    serie = {}
    total_ingreso = total_costo = total_ventas = 0.0
    for s in sales:
        key = s.get("fecha", "")[:7] if group == "mes" else s.get("fecha", "")[:10]
        serie[key] = serie.get(key, 0) + float(s.get("total", 0))
        total_ventas += float(s.get("total", 0))
        for it in s.get("items", []):
            tasa = float(it.get("iva_tasa", 16)) / 100
            neto = (it["cantidad"] * it["precio"] - (it.get("descuento", 0) or 0)) / (1 + tasa)
            costo = costo_map.get(it.get("product_id"), 0) * it["cantidad"]
            pid = it.get("product_id") or it.get("codigo")
            p = por_producto.get(pid)
            if not p:
                p = {"codigo": it.get("codigo"), "descripcion": it.get("descripcion"),
                     "cantidad": 0, "ingreso": 0.0, "costo": 0.0}
                por_producto[pid] = p
            p["cantidad"] += it["cantidad"]
            p["ingreso"] += neto
            p["costo"] += costo
            total_ingreso += neto
            total_costo += costo
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
    return {
        "desde": d, "hasta": h, "group": group,
        "totales": {"ventas": round(total_ventas, 2), "ingreso_neto": round(total_ingreso, 2),
                    "costo": round(total_costo, 2), "utilidad": util_total,
                    "margen": round(util_total / total_ingreso * 100, 2) if total_ingreso else 0,
                    "tickets": len(sales)},
        "series": series, "top_vendidos": top_vendidos, "top_utilidad": top_utilidad,
        "productos": sorted(productos, key=lambda x: x["utilidad"], reverse=True),
    }

# =========================================================================
# STARTUP
# =========================================================================
@app.on_event("startup")
async def startup():
    try:
        storage.init_storage()
        logger.info("Object storage inicializado")
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
    # Seed admin
    admin_email = os.environ["ADMIN_EMAIL"].strip().lower()
    admin_pw = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": uid(), "email": admin_email, "name": os.environ.get("ADMIN_NAME", "Admin"),
            "role": "admin", "password_hash": hash_password(admin_pw),
            "active": True, "created_at": iso_now()})
        logger.info("Admin seed creado: %s", admin_email)
    elif not verify_password(admin_pw, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_pw)}})
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

app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"],
)
