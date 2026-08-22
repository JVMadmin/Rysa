"""Utilidades compartidas: base de datos, autenticación JWT, RBAC, auditoría."""
import os
import sys
import uuid
import hashlib
import jwt
import bcrypt
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, Request, Depends

# --- PostgreSQL (única base de datos soportada) ---
_here_backend = os.path.dirname(os.path.abspath(__file__))
if _here_backend not in sys.path:
    sys.path.insert(0, _here_backend)
import pgstore
db = pgstore.PGDatabase()


class _PgClient:
    def close(self):
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(pgstore.dispose())
            else:
                asyncio.run(pgstore.dispose())
        except Exception:
            pass


client = _PgClient()

# --- Helpers de tiempo ---
def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def iso_now() -> str:
    return now_utc().isoformat()

# --- Password hashing ---
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

# --- JWT ---
# TTLs configurables por entorno (segundos). Access: 2 horas · Refresh: 14 días.
ACCESS_TOKEN_TTL_SECONDS = int(os.environ.get("ACCESS_TOKEN_TTL_SECONDS", "7200"))
REFRESH_TOKEN_TTL_SECONDS = int(os.environ.get("REFRESH_TOKEN_TTL_SECONDS", "1209600"))

JWT_ALGORITHM = "HS256"

def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]

def _jwt_claims(user_id: str, email: str, token_type: str, token_version: int) -> dict:
    now = now_utc()
    ttl = ACCESS_TOKEN_TTL_SECONDS if token_type == "access" else REFRESH_TOKEN_TTL_SECONDS
    return {
        "sub": user_id,
        "email": email,
        "jti": uuid.uuid4().hex,
        "iat": now,
        "exp": now + timedelta(seconds=ttl),
        "type": token_type,
        "token_version": int(token_version or 0),
    }

def create_access_token(user_id: str, email: str, token_version: int = 0) -> str:
    return jwt.encode(_jwt_claims(user_id, email, "access", token_version),
                      get_jwt_secret(), algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str, token_version: int = 0) -> str:
    return jwt.encode(_jwt_claims(user_id, "", "refresh", token_version),
                      get_jwt_secret(), algorithm=JWT_ALGORITHM)

def decode_token(token: str) -> dict:
    return jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])

def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

# --- RBAC ---
# Permisos exclusivos de desarrollador / mantenimiento.
# NO se otorgan con el comodín "*": deben estar explícitos en el rol.
DEV_PERMISSIONS = {
    "dev.errores",           # ver bitácora de errores
    "dev.info",              # información técnica del sistema
    "dev.mantenimiento",     # acciones de mantenimiento
}

# Roles base.
#  - admin               : gestión completa de la operación.
#  - admin_propietario   : todo lo de admin, SIN permisos de desarrollador.
#  - admin_desarrollador : admin + depuración/errores/mantenimiento.
#  - encargado/vendedor/cajero: operación; SIN CxC, Caja, Usuarios ni Auditoría.
_ADMIN = {"*"}
ROLE_PERMISSIONS = {
    "admin": _ADMIN,
    "admin_propietario": _ADMIN,
    "admin_desarrollador": _ADMIN | DEV_PERMISSIONS,
    "encargado": {
        "producto.crear", "producto.editar", "producto.baja", "producto.costo",
        "producto.precio", "inventario.ajuste", "venta.crear", "venta.cancelar",
        "venta.descuento", "venta.ver_todas", "venta.facturar",
        "venta.cambiar_operador", "recargas.ver_todas",
        "cliente.crear", "cliente.editar", "reportes.ver", "reportes.global",
        "importar", "exportar", "config", "credito.autorizar",
        "inventario.autorizar_negativo",
        "proveedor.ver", "proveedor.crear", "proveedor.editar",
        "compra.ver", "compra.crear", "compra.cancelar",
        "abono.ver", "abono.comprobante", "cuentas.ver",
    },
    "vendedor": {
        "venta.crear", "venta.descuento", "cliente.crear", "cliente.editar",
        "exportar", "visita.crear", "visita.editar", "visita.ver",
    },
    "cajero": {
        "venta.crear", "exportar",
    },
    # Supervisor/Gerente comercial: monitoreo de vendedores de campo,
    # cartera, CxC, actividad, mapa y autorizaciones comerciales.
    "supervisor": {
        "venta.crear", "venta.cancelar", "venta.descuento", "venta.ver_todas",
        "venta.facturar", "venta.cambiar_operador",
        "cliente.crear", "cliente.editar", "cliente.baja",
        "reportes.ver", "reportes.global", "exportar", "importar",
        "cxc.ver", "caja.entrada", "credito.autorizar",
        "compra.ver", "compra.crear", "compra.cancelar", "abono.ver",
        "abono.comprobante", "proveedor.ver", "cuentas.ver",
        "visita.crear", "visita.editar", "visita.ver", "visita.cancelar",
        "supervision.ver", "supervision.mapa", "supervision.cartera",
        "supervision.cxc", "supervision.actividad",
    },
}

# Catálogo de módulos asignables por admin/propietario en Usuarios.
# Cada módulo otorga un conjunto de permisos adicional al rol base.
MODULES = {
    "productos": {
        "label": "Productos e Inventario",
        "perms": {"producto.crear", "producto.editar", "producto.baja",
                  "producto.costo", "producto.precio", "inventario.ajuste"},
    },
    "clientes": {
        "label": "Clientes",
        "perms": {"cliente.crear", "cliente.editar", "exportar"},
    },
    "ventas": {
        "label": "Ventas",
        "perms": {"venta.crear", "venta.cancelar", "venta.descuento",
                  "venta.ver_todas", "venta.facturar", "venta.cambiar_operador"},
    },
    "recargas": {
        "label": "Recargas",
        "perms": {"venta.crear", "recargas.ver_todas"},
    },
    "caja": {
        "label": "Caja",
        "perms": {"caja.ver", "caja.abrir", "caja.cerrar", "caja.retiro",
                  "caja.entrada"},
    },
    "cxc": {
        "label": "Cuentas por Cobrar",
        "perms": {"cxc.ver", "caja.entrada", "credito.autorizar"},
    },
    "reportes": {
        "label": "Reportes",
        "perms": {"reportes.ver", "reportes.global", "exportar", "importar"},
    },
    "usuarios": {
        "label": "Usuarios",
        "perms": {"usuarios.ver", "usuarios.crear", "usuarios.editar"},
    },
    "auditoria": {
        "label": "Auditoría",
        "perms": {"auditoria.ver"},
    },
    "configuracion": {
        "label": "Configuración",
        "perms": {"config"},
    },
    "visitas": {
        "label": "Visitas comerciales",
        "perms": {"visita.crear", "visita.editar", "visita.ver", "visita.cancelar"},
    },
    "supervision": {
        "label": "Centro de Supervisión Comercial",
        "perms": {"supervision.ver", "supervision.mapa", "supervision.cartera",
                  "supervision.cxc", "supervision.actividad"},
    },
    "proveedores": {
        "label": "Proveedores",
        "perms": {"proveedor.ver", "proveedor.crear", "proveedor.editar"},
    },
    "compras": {
        "label": "Compras y Gastos",
        "perms": {"compra.ver", "compra.crear", "compra.cancelar", "compra.autorizar",
                  "proveedor.ver"},
    },
    "cuentas_bancarias": {
        "label": "Cuentas bancarias",
        "perms": {"cuentas.ver", "cuentas.editar"},
    },
    "abonos": {
        "label": "Abonos y comprobantes",
        "perms": {"abono.ver", "abono.comprobante"},
    },
}

def role_permissions(role: str) -> set:
    return set(ROLE_PERMISSIONS.get(role, set()))

# Módulos que se otorgan por defecto a usuarios NO privilegiados al crearlos.
# Solo es un DEFAULT: un administrador autorizado puede modificarlo después.
# "productos" agrupa Productos e Inventario.
DEFAULT_MODULES_NON_PRIVILEGED = [
    "productos", "clientes", "recargas", "ventas", "caja", "reportes",
]

# Roles que tienen acceso total (evitar escalamiento al otorgar estos módulos).
def es_rol_privilegiado(role: str) -> bool:
    if not role:
        return False
    perms = ROLE_PERMISSIONS.get(role, set())
    return "*" in perms

def effective_permissions(user: dict) -> set:
    """Permisos efectivos = rol base + módulos asignados al usuario."""
    perms = role_permissions(user.get("role", ""))
    for mod in (user.get("modulos") or []):
        info = MODULES.get(mod)
        if info:
            perms |= info["perms"]
    return perms

def has_permission(role: str, perm: str) -> bool:
    perms = ROLE_PERMISSIONS.get(role, set())
    if perm in DEV_PERMISSIONS:
        return perm in perms
    return "*" in perms or perm in perms

def user_has_permission(user: dict, perm: str) -> bool:
    perms = effective_permissions(user)
    if perm in DEV_PERMISSIONS:
        return perm in perms
    return "*" in perms or perm in perms

def ver_todas_ventas(user: dict) -> bool:
    """¿El usuario puede ver ventas/recargas de otros operadores?"""
    perms = effective_permissions(user)
    return "*" in perms or "venta.ver_todas" in perms

def ver_reportes_globales(user: dict) -> bool:
    """¿El usuario puede consultar reportes con información agregada global?"""
    perms = effective_permissions(user)
    return "*" in perms or "reportes.global" in perms

def ver_recargas_todas(user: dict) -> bool:
    perms = effective_permissions(user)
    return "*" in perms or "recargas.ver_todas" in perms

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="No autenticado")
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sesión expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Token inválido")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Usuario desactivado")
    # Revocación por token_version: al cambiar password/rol o desactivar, los
    # tokens anteriores dejan de ser válidos.
    if int(user.get("token_version", 0)) != int(payload.get("token_version", 0)):
        raise HTTPException(status_code=401, detail="Sesión invalidada")
    return user

def require_permission(perm: str):
    """Valida permiso efectivo del usuario (rol base + módulos asignados)."""
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if not user_has_permission(user, perm):
            raise HTTPException(status_code=403, detail="No tienes permiso para esta acción")
        return user
    return checker

# --- Contadores (folios / códigos) ---
async def next_counter(name: str, prefix: str = "", padding: int = 5) -> str:
    return await pgstore.pg_next_counter(name, prefix, padding)

# --- Auditoría ---
async def log_audit(usuario: dict, accion: str, entidad: str, registro_id: str = "",
                    detalle: str = "", ip: str = "", user_agent: str = ""):
    doc = {
        "id": uuid.uuid4().hex,
        "usuario_id": usuario.get("id"),
        "usuario_nombre": usuario.get("name"),
        "accion": accion,
        "entidad": entidad,
        "registro_id": registro_id,
        "detalle": detalle,
        "fecha": iso_now(),
    }
    if ip:
        doc["ip"] = ip
    if user_agent:
        doc["user_agent"] = user_agent
    await db.audit_logs.insert_one(doc)

async def revoke_user_sessions(user_id: str):
    """Incrementa token_version (invalida todos los tokens de acceso emitidos
    antes) y revoca los refresh tokens activos del usuario."""
    await db.users.update_one({"id": user_id}, {"$inc": {"token_version": 1}})
    await db.refresh_tokens.update_many(
        {"user_id": user_id, "active": True},
        {"$set": {"active": False, "revoked_at": iso_now()}})
