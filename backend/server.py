"""Grupo RYSA ERP - API principal (FastAPI + MongoDB)."""
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / '.env')

import os
import io
import uuid
import logging
from typing import List, Optional
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Response, UploadFile, File
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr, ConfigDict
import pandas as pd
from datetime import datetime

from deps import (
    db, client, now_utc, iso_now, hash_password, verify_password, create_access_token,
    get_current_user, require_permission, has_permission, next_counter, log_audit,
    ROLE_PERMISSIONS,
)

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

class InventoryAdjust(BaseModel):
    tipo: str  # entrada | ajuste | devolucion | correccion
    cantidad: float
    concepto: Optional[str] = ""
    documento: Optional[str] = ""

class ClientInput(BaseModel):
    codigo: Optional[str] = None
    nombre: str
    razon_social: Optional[str] = ""
    rfc: Optional[str] = ""
    telefono: Optional[str] = ""
    whatsapp: Optional[str] = ""
    correo: Optional[str] = ""
    calle: Optional[str] = ""
    numero_exterior: Optional[str] = ""
    numero_interior: Optional[str] = ""
    colonia: Optional[str] = ""
    localidad: Optional[str] = ""
    municipio: Optional[str] = ""
    ciudad: Optional[str] = ""
    estado_geo: Optional[str] = ""
    pais: Optional[str] = "México"
    cp: Optional[str] = ""
    referencias: Optional[str] = ""
    direccion: Optional[str] = ""
    tipo: str = "publico"  # publico | menudeo | mayoreo | especial
    lista_precios: int = 1
    condicion_pago: str = "contado"
    credito_autorizado: bool = False
    limite_credito: float = 0.0
    estado: str = "activo"

class CreditInput(BaseModel):
    credito_autorizado: bool
    limite_credito: float = 0.0

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
    listas_precios_nombres: List[str] = Field(default_factory=lambda: ["Precio 1", "Precio 2", "Precio 3", "Precio 4", "Precio 5"])
    sucursales: List[SucursalItem] = Field(default_factory=list)

# =========================================================================
# INVENTARIO (KARDEX) - helper
# =========================================================================
async def registrar_movimiento(product: dict, tipo: str, entrada: float, salida: float,
                                usuario: dict, documento: str = "", referencia: str = ""):
    nueva_existencia = round(float(product.get("existencia", 0)) + entrada - salida, 3)
    await db.products.update_one({"id": product["id"]}, {"$set": {"existencia": nueva_existencia, "updated_at": iso_now()}})
    await db.inventory_movements.insert_one({
        "id": uid(), "product_id": product["id"], "codigo": product.get("codigo"),
        "descripcion": product.get("descripcion"), "tipo": tipo,
        "documento": documento, "entrada": entrada, "salida": salida,
        "existencia_resultante": nueva_existencia,
        "usuario_id": usuario.get("id"), "usuario_nombre": usuario.get("name"),
        "referencia": referencia, "fecha": iso_now(),
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
async def list_products(estado: Optional[str] = None, q: Optional[str] = None,
                        filtro: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {}
    if estado:
        query["estado"] = estado
    if q:
        rx = {"$regex": q, "$options": "i"}
        query["$or"] = [{"codigo": rx}, {"descripcion": rx}, {"sku": rx},
                        {"linea": rx}, {"clasificacion": rx}, {"sinonimos": rx}]
    products = await db.products.find(query, {"_id": 0}).sort("descripcion", 1).to_list(2000)
    if filtro == "bajo_stock":
        products = [p for p in products if 0 < float(p.get("existencia", 0)) <= float(p.get("stock_minimo", 0))]
    elif filtro == "sin_existencia":
        products = [p for p in products if float(p.get("existencia", 0)) <= 0]
    return products

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
    if data.tipo in ("entrada", "devolucion", "correccion") and data.cantidad >= 0:
        entrada = abs(data.cantidad)
    elif data.tipo == "ajuste":
        # ajuste puede ser + o -
        if data.cantidad >= 0:
            entrada = data.cantidad
        else:
            salida = abs(data.cantidad)
    else:
        salida = abs(data.cantidad)
    nueva = await registrar_movimiento(p, data.tipo, entrada, salida, user, data.documento, data.concepto)
    await log_audit(user, "ajuste_inventario", "producto", product_id, f"{data.tipo} {data.cantidad}")
    return {"existencia": nueva}

# =========================================================================
# CLIENTES
# =========================================================================
@api.get("/clients")
async def list_clients(q: Optional[str] = None, estado: Optional[str] = None,
                       tipo: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {}
    if estado:
        query["estado"] = estado
    if tipo:
        query["tipo"] = tipo
    if q:
        rx = {"$regex": q, "$options": "i"}
        query["$or"] = [{"codigo": rx}, {"nombre": rx}, {"razon_social": rx},
                        {"rfc": rx}, {"telefono": rx}]
    clients = await db.clients.find(query, {"_id": 0}).sort("nombre", 1).to_list(2000)
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
    doc = data.model_dump()
    doc["codigo"] = codigo
    doc["id"] = uid()
    doc["saldo"] = 0.0
    doc["created_at"] = iso_now()
    await db.clients.insert_one(doc)
    await log_audit(user, "crear", "cliente", doc["id"], doc["nombre"])
    return await db.clients.find_one({"id": doc["id"]}, {"_id": 0})

@api.put("/clients/{client_id}")
async def update_client(client_id: str, data: ClientInput, user: dict = Depends(require_permission("cliente.editar"))):
    existing = await db.clients.find_one({"id": client_id})
    if not existing:
        raise HTTPException(404, "Cliente no encontrado")
    doc = data.model_dump()
    doc["codigo"] = existing["codigo"]
    await db.clients.update_one({"id": client_id}, {"$set": doc})
    await log_audit(user, "editar", "cliente", client_id)
    return await db.clients.find_one({"id": client_id}, {"_id": 0})

@api.patch("/clients/{client_id}/estado")
async def client_estado(client_id: str, estado: str, user: dict = Depends(require_permission("cliente.editar"))):
    await db.clients.update_one({"id": client_id}, {"$set": {"estado": estado}})
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
async def caja_historial(user: dict = Depends(get_current_user)):
    cajas = await db.cajas.find({"estado": "cerrada"}, {"_id": 0}).sort("fecha_cierre", -1).to_list(100)
    return cajas

# =========================================================================
# VENTAS / POS
# =========================================================================
def calcular_venta(items: List[dict], descuento_global: float):
    subtotal = 0.0
    iva_total = 0.0
    desc_lineas = 0.0
    for it in items:
        base = it["cantidad"] * it["precio"]
        desc = it.get("descuento", 0.0)
        neto = base - desc
        subtotal += neto
        iva_total += neto * (it.get("iva_tasa", 16.0) / 100)
        desc_lineas += desc
    descuento_global = min(max(descuento_global, 0.0), subtotal)
    subtotal_final = subtotal - descuento_global
    iva_final = subtotal_final / subtotal * iva_total if subtotal else 0
    total = round(subtotal_final + iva_final, 2)
    return {"subtotal": round(subtotal_final, 2), "iva_total": round(iva_final, 2),
            "descuento_total": round(desc_lineas + descuento_global, 2), "total": total}

@api.get("/sales")
async def list_sales(rango: Optional[str] = None, estado: Optional[str] = None,
                     user: dict = Depends(get_current_user)):
    query = {}
    if estado:
        query["estado"] = estado
    sales = await db.sales.find(query, {"_id": 0}).sort("fecha", -1).to_list(1000)
    if rango:
        now = now_utc()
        def keep(s):
            f = s.get("fecha", "")
            if rango == "hoy":
                return f[:10] == now.date().isoformat()
            if rango == "mes":
                return f[:7] == now.strftime("%Y-%m")
            if rango == "anio":
                return f[:4] == str(now.year)
            return True
        sales = [s for s in sales if keep(s)]
    return sales

@api.get("/sales/{sale_id}")
async def get_sale(sale_id: str, user: dict = Depends(get_current_user)):
    s = await db.sales.find_one({"id": sale_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Venta no encontrada")
    return s

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
            if round(pagado, 2) < round(total, 2):
                raise HTTPException(400, "El pago es menor al total")
            cambio = round(pagado - total, 2)
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
        # Revertir crédito
        if sale["condicion"] == "credito" and sale.get("cliente_id"):
            await db.clients.update_one({"id": sale["cliente_id"]}, {"$inc": {"saldo": -sale["total"]}})
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
    products = await list_products(estado=estado, q=q, filtro=None, user=user)
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
                         user: dict = Depends(require_permission("exportar"))):
    clients = await list_clients(q=q, estado=estado, tipo=tipo, user=user)
    rows = [{c: cl.get(c) for c in CLIENT_COLS} | {"saldo": cl.get("saldo", 0)} for cl in clients]
    data = df_to_excel_bytes(pd.DataFrame(rows or [{c: None for c in CLIENT_COLS}]))
    return StreamingResponse(io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=clientes.xlsx"})

@api.post("/clients/import/confirm")
async def import_clients(file: UploadFile = File(...), user: dict = Depends(require_permission("importar"))):
    content = await file.read()
    df = read_import_table(content, file.filename or "").fillna("")
    creados = 0
    for r in df.to_dict("records"):
        nombre = str(r.get("nombre", "")).strip()
        if not nombre:
            continue
        codigo = str(r.get("codigo", "")).strip() or await next_counter("cliente", "C", 5)
        if await db.clients.find_one({"codigo": codigo}):
            continue
        doc = {"id": uid(), "codigo": codigo, "nombre": nombre,
               "razon_social": str(r.get("razon_social", "")), "rfc": str(r.get("rfc", "")),
               "telefono": str(r.get("telefono", "")), "whatsapp": str(r.get("whatsapp", "")),
               "correo": str(r.get("correo", "")), "direccion": str(r.get("direccion", "")),
               "ciudad": str(r.get("ciudad", "")), "estado_geo": str(r.get("estado_geo", "")),
               "cp": str(r.get("cp", "")), "tipo": str(r.get("tipo", "") or "publico"),
               "lista_precios": 1, "condicion_pago": "contado", "limite_credito": 0,
               "saldo": 0, "estado": "activo", "created_at": iso_now()}
        await db.clients.insert_one(doc)
        creados += 1
    return {"creados": creados}

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
# STARTUP
# =========================================================================
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.products.create_index("codigo")
    await db.clients.create_index("codigo")
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
)
