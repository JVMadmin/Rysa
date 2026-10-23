"""Códigos de autorización y autorizaciones de movimientos.

Quien tiene el permiso `autorizacion.otorgar` (administradores y dueño por el
comodín, o un usuario con el módulo «Autorizar movimientos con código»
asignado en Usuarios) define en Mi cuenta un código de 6 dígitos.

Cuando un usuario que no es administrador ni dueño hace un movimiento que
requiere autorización (por ahora: precio manual en el POS, F6), quien autoriza
teclea su código. El servidor lo verifica y emite una autorización de un solo
uso, ligada al solicitante, al producto y al precio; la venta la consume al
registrarse y deja en la línea quién autorizó.

El código se guarda con bcrypt en la colección `codigos_autorizacion`, nunca
en el documento del usuario (ese documento se devuelve en muchas respuestas).
"""
import asyncio
import re
import uuid
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deps import (db, get_current_user, iso_now, log_audit, now_utc,
                  require_permission, user_has_permission, verify_password)

router = APIRouter(prefix="/api")

# Puede autorizar movimientos de otros con su código.
PERM_OTORGAR = "autorizacion.otorgar"
# Aplica precio manual sin autorización. Ningún rol ni módulo lo trae: solo el
# comodín "*" (administradores y dueño).
PERM_PRECIO_MANUAL = "venta.precio_manual"

ACCIONES = {"precio_manual": "Precio manual"}

VIGENCIA_HORAS = 12        # una autorización sin usar vence en el turno
MAX_FALLOS = 5             # códigos incorrectos seguidos antes del bloqueo
BLOQUEO_MINUTOS = 10
_BCRYPT_ROUNDS = 10        # se compara contra todos los códigos: costo moderado

_CODIGO_RE = re.compile(r"^\d{6}$")
_SECUENCIA = "0123456789"


def codigo_trivial(codigo: str) -> bool:
    """111111, 123456, 987654… son lo primero que alguien intentaría."""
    return len(set(codigo)) == 1 or codigo in _SECUENCIA or codigo in _SECUENCIA[::-1]


def _hash(codigo: str) -> str:
    return bcrypt.hashpw(codigo.encode("utf-8"), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode("utf-8")


def _coincide(codigo: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(codigo.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


async def _dueno_del_codigo(codigo: str, excluir_id: Optional[str] = None) -> Optional[str]:
    """id del usuario cuyo código es `codigo` (los códigos son únicos)."""
    docs = await db.codigos_autorizacion.find({}, {"_id": 0}).to_list(1000)
    for d in docs:
        if d.get("id") == excluir_id:
            continue
        if await asyncio.to_thread(_coincide, codigo, d.get("hash") or ""):
            return d.get("id")
    return None


async def _autorizador_por_codigo(codigo: str) -> Optional[dict]:
    """Usuario activo y con permiso de autorizar al que pertenece el código."""
    if not _CODIGO_RE.match(codigo or ""):
        return None
    uid = await _dueno_del_codigo(codigo)
    if not uid:
        return None
    u = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    if not u or not u.get("active", True) or not user_has_permission(u, PERM_OTORGAR):
        return None
    return u


# --- Bloqueo por intentos fallidos (misma tabla que el login) ---------------
def _dt(value) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except Exception:
        return None


async def _verificar_bloqueo(clave: str):
    doc = await db.login_attempts.find_one({"_id": clave})
    hasta = _dt((doc or {}).get("locked_until"))
    if hasta and hasta > now_utc():
        raise HTTPException(429, "Demasiados intentos con código incorrecto. Espera unos minutos.")


async def _registrar_fallo(clave: str):
    doc = await db.login_attempts.find_one({"_id": clave})
    fallos = int((doc or {}).get("fails", 0)) + 1
    hasta = None
    if fallos >= MAX_FALLOS:
        hasta = (now_utc() + timedelta(minutes=BLOQUEO_MINUTOS)).isoformat()
        fallos = 0
    await db.login_attempts.update_one(
        {"_id": clave},
        {"$set": {"kind": "authcode", "fails": fallos, "locked_until": hasta, "last_at": iso_now()}},
        upsert=True)


async def _limpiar_fallos(clave: str):
    await db.login_attempts.delete_one({"_id": clave})


# --- Mi cuenta: código propio -----------------------------------------------
class CodigoInput(BaseModel):
    codigo: str = Field(min_length=6, max_length=6)
    password: str = Field(min_length=1, max_length=200)


@router.get("/mi-cuenta/codigo-autorizacion")
async def estado_codigo(user: dict = Depends(get_current_user)):
    doc = await db.codigos_autorizacion.find_one({"id": user["id"]}, {"_id": 0, "hash": 0})
    return {
        "puede_autorizar": user_has_permission(user, PERM_OTORGAR),
        "precio_manual_directo": user_has_permission(user, PERM_PRECIO_MANUAL),
        "configurado": bool(doc),
        "actualizado": (doc or {}).get("actualizado"),
    }


@router.put("/mi-cuenta/codigo-autorizacion")
async def guardar_codigo(data: CodigoInput, user: dict = Depends(require_permission(PERM_OTORGAR))):
    clave = f"authcode-set:{user['id']}"
    await _verificar_bloqueo(clave)
    if not _CODIGO_RE.match(data.codigo):
        raise HTTPException(400, "El código debe tener exactamente 6 dígitos")
    if codigo_trivial(data.codigo):
        raise HTTPException(400, "Ese código es muy fácil de adivinar: no repitas un dígito ni uses una secuencia")
    completo = await db.users.find_one({"id": user["id"]})
    if not completo or not verify_password(data.password, completo.get("password_hash") or ""):
        await _registrar_fallo(clave)
        raise HTTPException(400, "La contraseña no es correcta")
    # Cada código identifica a una sola persona en la bitácora.
    if await _dueno_del_codigo(data.codigo, excluir_id=user["id"]):
        raise HTTPException(400, "Ese código no está disponible. Elige otro.")
    previo = await db.codigos_autorizacion.find_one({"id": user["id"]})
    doc = {"id": user["id"], "hash": await asyncio.to_thread(_hash, data.codigo),
           "actualizado": iso_now()}
    if previo:
        await db.codigos_autorizacion.update_one({"id": user["id"]}, {"$set": doc})
    else:
        await db.codigos_autorizacion.insert_one(doc)
    await _limpiar_fallos(clave)
    await log_audit(user, "CODIGO_AUTORIZACION", "usuario", user["id"],
                    "Cambió su código de autorización" if previo else "Creó su código de autorización")
    return {"configurado": True, "actualizado": doc["actualizado"]}


@router.delete("/mi-cuenta/codigo-autorizacion")
async def borrar_codigo(user: dict = Depends(get_current_user)):
    if await db.codigos_autorizacion.find_one({"id": user["id"]}):
        await db.codigos_autorizacion.delete_one({"id": user["id"]})
        await log_audit(user, "CODIGO_AUTORIZACION", "usuario", user["id"],
                        "Eliminó su código de autorización")
    return {"configurado": False}


async def usuarios_con_codigo() -> set:
    docs = await db.codigos_autorizacion.find({}, {"_id": 0, "id": 1}).to_list(1000)
    return {d.get("id") for d in docs}


# --- Autorizar un movimiento -------------------------------------------------
class AutorizacionInput(BaseModel):
    codigo: str = Field(min_length=1, max_length=6)
    accion: str = "precio_manual"
    product_id: str = Field(min_length=1, max_length=100)
    precio: float = Field(gt=0)              # neto, tal como lo enviará la venta
    precio_anterior: Optional[float] = Field(default=None, ge=0)


@router.post("/autorizaciones")
async def autorizar(data: AutorizacionInput, user: dict = Depends(require_permission("venta.crear"))):
    if data.accion not in ACCIONES:
        raise HTTPException(400, "Movimiento no reconocido")
    clave = f"authcode:{user['id']}"
    await _verificar_bloqueo(clave)
    prod = await db.products.find_one({"id": data.product_id}, {"_id": 0})
    if not prod:
        raise HTTPException(404, "Producto no encontrado")
    accion = ACCIONES[data.accion]
    autorizador = await _autorizador_por_codigo(data.codigo)
    if not autorizador:
        await _registrar_fallo(clave)
        await log_audit(user, "AUTORIZACION_RECHAZADA", "autorizacion", "",
                        f"{accion} · {prod.get('codigo')} · código incorrecto")
        raise HTTPException(403, "Código de autorización incorrecto")
    await _limpiar_fallos(clave)
    doc = {
        "id": uuid.uuid4().hex, "accion": data.accion,
        "solicitante_id": user["id"], "solicitante_nombre": user.get("name"),
        "autorizador_id": autorizador["id"], "autorizador_nombre": autorizador.get("name"),
        "product_id": data.product_id, "codigo": prod.get("codigo"),
        "descripcion": prod.get("descripcion"),
        "precio": round(float(data.precio), 4), "precio_anterior": data.precio_anterior,
        "fecha": iso_now(),
        "expira": (now_utc() + timedelta(hours=VIGENCIA_HORAS)).isoformat(),
        "usado": False, "venta_id": None,
    }
    await db.autorizaciones.insert_one(doc)
    antes = f" (antes {data.precio_anterior:.2f})" if data.precio_anterior is not None else ""
    await log_audit(autorizador, "AUTORIZACION_OTORGADA", "autorizacion", doc["id"],
                    f"{accion} · {doc['codigo']} a {doc['precio']:.2f} sin IVA{antes} · "
                    f"solicitó {user.get('name')}")
    return {"id": doc["id"], "autorizador_nombre": doc["autorizador_nombre"], "expira": doc["expira"]}


# --- Uso desde la venta ------------------------------------------------------
async def validar_precios_manuales(user: dict, items: list) -> list:
    """Revisa las líneas marcadas con precio manual antes de guardar la venta.

    Administradores y dueño no necesitan autorización. Para los demás, cada
    línea debe traer una autorización vigente, sin usar, emitida para este
    usuario, este producto y este precio. Anota en la línea quién autorizó y
    devuelve los ids de autorización que la venta debe consumir."""
    directo = user_has_permission(user, PERM_PRECIO_MANUAL)
    usadas = []
    for it in items:
        aid = it.pop("autorizacion_id", None)
        if not it.pop("precio_manual", False):
            continue
        it["precio_manual"] = True
        codigo = it.get("codigo") or ""
        if directo:
            it["autorizado_por_id"], it["autorizado_por_nombre"] = user["id"], user.get("name")
            continue
        if not aid:
            raise HTTPException(403, f"El precio manual de {codigo} requiere autorización")
        a = await db.autorizaciones.find_one({"id": aid}, {"_id": 0})
        if (not a or a.get("accion") != "precio_manual" or a.get("solicitante_id") != user["id"]
                or a.get("product_id") != it.get("product_id")):
            raise HTTPException(403, f"La autorización del precio manual de {codigo} no es válida")
        if a.get("usado") or aid in usadas:
            raise HTTPException(409, f"La autorización del precio manual de {codigo} ya se usó. Vuelve a autorizarlo con F6.")
        vence = _dt(a.get("expira"))
        if not vence or vence < now_utc():
            raise HTTPException(409, f"La autorización del precio manual de {codigo} venció. Vuelve a autorizarlo con F6.")
        if abs(float(a.get("precio") or 0) - float(it.get("precio") or 0)) > 0.005:
            raise HTTPException(403, f"El precio de {codigo} no coincide con el autorizado")
        it["autorizacion_id"] = aid
        it["autorizado_por_id"], it["autorizado_por_nombre"] = a.get("autorizador_id"), a.get("autorizador_nombre")
        usadas.append(aid)
    return usadas


async def registrar_precios_manuales(user: dict, venta: dict, items: list, autorizaciones: list):
    """Marca como usadas las autorizaciones y deja cada precio manual en la bitácora."""
    for aid in autorizaciones:
        await db.autorizaciones.update_one({"id": aid}, {"$set": {
            "usado": True, "usado_at": iso_now(),
            "venta_id": venta.get("id"), "venta_folio": venta.get("folio")}})
    for it in items:
        if it.get("precio_manual"):
            await log_audit(user, "PRECIO_MANUAL", "venta", venta.get("id") or "",
                            f"{venta.get('folio')} · {it.get('codigo')} a {float(it.get('precio') or 0):.2f} sin IVA"
                            f" · autorizó {it.get('autorizado_por_nombre')}")
