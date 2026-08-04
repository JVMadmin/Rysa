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
from pydantic import BaseModel, Field, EmailStr
import pandas as pd

from deps import (
    db, now_utc, iso_now, hash_password, verify_password, create_access_token,
    get_current_user, require_permission, has_permission, next_counter, log_audit,
    ROLE_PERMISSIONS,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rysa")

app = FastAPI(title="Grupo RYSA ERP")
api = APIRouter(prefix="/api")

def uid() -> str:
    return uuid.uuid4().hex

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
    direccion: Optional[str] = ""
    ciudad: Optional[str] = ""
    estado_geo: Optional[str] = ""
    cp: Optional[str] = ""
    tipo: str = "publico"  # publico | menudeo | mayoreo | especial
    lista_precios: int = 1
    condicion_pago: str = "contado"
    limite_credito: float = 0.0
    estado: str = "activo"

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

class CancelInput(BaseModel):
    motivo: str

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
        util = float(p.get("utilidad_pct", 0))
        if p.get("precio_sin_iva"):
            sin_iva = float(p["precio_sin_iva"])
        else:
            sin_iva = round(costo * (1 + util / 100), 2)
        con_iva = round(sin_iva * (1 + iva_tasa / 100), 2)
        out.append({"nombre": p.get("nombre", "Precio"), "utilidad_pct": util,
                    "precio_sin_iva": sin_iva, "precio_con_iva": con_iva})
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
    # Cliente
    cliente = None
    if data.cliente_id:
        cliente = await db.clients.find_one({"id": data.cliente_id}, {"_id": 0})
    cliente_nombre = cliente["nombre"] if cliente else "Público General"
    # Validar existencia y permisos de venta
    items = [it.model_dump() for it in data.items]
    for it in items:
        p = await db.products.find_one({"id": it["product_id"]})
        if not p:
            raise HTTPException(400, f"Producto {it['codigo']} no existe")
        if p.get("estado") != "activo":
            raise HTTPException(400, f"Producto {p['codigo']} no está activo")
        controles = p.get("controles", {}) or {}
        controlar = controles.get("controlar_inventario", True)
        permitir_neg = controles.get("permitir_inventario_negativo", False)
        if controlar and not permitir_neg and float(p.get("existencia", 0)) < it["cantidad"]:
            raise HTTPException(400, f"Existencia insuficiente de {p['codigo']} (disp: {p.get('existencia',0)})")
    totales = calcular_venta(items, data.descuento_global)
    # Validar pagos si contado
    total = totales["total"]
    pagos = [p.model_dump() for p in data.pagos]
    pagado = sum(p["monto"] for p in pagos)
    cambio = 0.0
    saldo = 0.0
    if data.condicion == "contado":
        if round(pagado, 2) < round(total, 2):
            raise HTTPException(400, "El pago es menor al total")
        cambio = round(pagado - total, 2)
    else:  # credito
        saldo = total
    folio = await next_counter("venta", "V", 6)
    caja = await caja_abierta_de(user["id"])
    now = now_utc()
    sale = {
        "id": uid(), "folio": folio, "fecha": iso_now(),
        "hora": now.strftime("%H:%M"), "usuario_id": user["id"], "usuario_nombre": user["name"],
        "cliente_id": data.cliente_id, "cliente_nombre": cliente_nombre,
        "items": items, **totales, "condicion": data.condicion,
        "pagos": pagos, "cambio": cambio, "saldo": saldo, "estado": "confirmada",
        "factura": False, "caja_id": caja["id"] if caja else None,
        "lista_precios": data.lista_precios,
    }
    await db.sales.insert_one(sale)
    # Descontar inventario + kardex
    for it in items:
        p = await db.products.find_one({"id": it["product_id"]})
        await registrar_movimiento(p, "venta", 0, it["cantidad"], user, folio, f"Venta {folio}")
    # Caja: efectivo entra
    if caja:
        efectivo = sum(p["monto"] for p in pagos if p["metodo"] == "efectivo")
        if data.condicion == "contado" and efectivo > 0:
            monto_caja = min(efectivo, total)  # sin contar el cambio
            await db.caja_movimientos.insert_one({
                "id": uid(), "caja_id": caja["id"], "tipo": "venta", "concepto": f"Venta {folio}",
                "monto": round(monto_caja, 2), "referencia": folio,
                "usuario_id": user["id"], "usuario_nombre": user["name"], "fecha": iso_now()})
    # Crédito: aumentar saldo cliente
    if data.condicion == "credito" and cliente:
        await db.clients.update_one({"id": cliente["id"]}, {"$inc": {"saldo": total}})
    await log_audit(user, "crear", "venta", sale["id"], f"{folio} total {total}")
    return await db.sales.find_one({"id": sale["id"]}, {"_id": 0})

@api.post("/sales/{sale_id}/cancelar")
async def cancel_sale(sale_id: str, data: CancelInput, user: dict = Depends(require_permission("venta.cancelar"))):
    sale = await db.sales.find_one({"id": sale_id})
    if not sale:
        raise HTTPException(404, "Venta no encontrada")
    if sale["estado"] == "cancelada":
        raise HTTPException(400, "La venta ya está cancelada")
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
    df = pd.DataFrame([{c: "" for c in PROD_COLS} | {"precio_1": ""}])
    data = df_to_excel_bytes(df)
    return StreamingResponse(io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=plantilla_productos.xlsx"})

@api.post("/products/import/preview")
async def import_preview(file: UploadFile = File(...), user: dict = Depends(require_permission("importar"))):
    content = await file.read()
    df = pd.read_excel(io.BytesIO(content)).fillna("")
    rows = df.to_dict("records")
    preview = []
    for i, r in enumerate(rows):
        codigo = str(r.get("codigo", "")).strip()
        errores = []
        if not str(r.get("descripcion", "")).strip():
            errores.append("Descripción requerida")
        existe = await db.products.find_one({"codigo": codigo}) if codigo else None
        accion = "actualizar" if existe else "crear"
        preview.append({"fila": i + 2, "codigo": codigo,
                        "descripcion": str(r.get("descripcion", "")),
                        "accion": accion, "errores": errores, "data": r})
    return {"total": len(preview), "preview": preview,
            "con_errores": sum(1 for p in preview if p["errores"])}

@api.post("/products/import/confirm")
async def import_confirm(payload: dict, user: dict = Depends(require_permission("importar"))):
    rows = payload.get("rows", [])
    creados = actualizados = 0
    for r in rows:
        if r.get("errores"):
            continue
        d = r["data"]
        codigo = str(d.get("codigo", "")).strip() or await next_counter("producto", "P", 5)
        iva = 16.0
        costo = float(d.get("costo") or 0)
        base = {
            "descripcion": str(d.get("descripcion", "")),
            "linea": str(d.get("linea", "")), "clasificacion": str(d.get("clasificacion", "")),
            "costo": costo, "unidad_medida": str(d.get("unidad_medida", "") or "PZA"),
            "stock_minimo": float(d.get("stock_minimo") or 0),
            "estado": str(d.get("estado", "") or "activo"), "iva_tasa": iva,
            "updated_at": iso_now(),
        }
        existing = await db.products.find_one({"codigo": codigo})
        if existing:
            await db.products.update_one({"codigo": codigo}, {"$set": base})
            actualizados += 1
        else:
            doc = {"id": uid(), "codigo": codigo, "sku": "", "descripcion_larga": "",
                   "existencia": 0, "ubicacion": "", "precio_minimo": 0,
                   "precios": calc_precios(costo, [{"nombre": "Precio 1", "utilidad_pct": 30}], iva),
                   "sat": {}, "controles": {"permitir_venta": True, "controlar_inventario": True,
                                            "mostrar_pos": True}, "ficha_tecnica": {},
                   "proveedores": [], "sinonimos": [], "imagen_url": "",
                   "created_at": iso_now(), **base}
            await db.products.insert_one(doc)
            ex_ini = float(d.get("existencia") or 0)
            if ex_ini > 0:
                await registrar_movimiento(doc, "entrada", ex_ini, 0, user, "Importación")
            creados += 1
    await log_audit(user, "importar", "producto", "", f"{creados} creados, {actualizados} actualizados")
    return {"creados": creados, "actualizados": actualizados}

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
    df = pd.read_excel(io.BytesIO(content)).fillna("")
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
