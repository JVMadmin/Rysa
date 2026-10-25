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

# --- Fechas en la zona del negocio ---
# Las marcas de tiempo se guardan en UTC (ISO). "Hoy", "este mes" y los rangos
# por día se calculan en la hora de la sucursal: México centro, UTC-6 fijo
# desde 2022 (sin horario de verano). Las ventas LEGACY guardan solo la fecha
# local "AAAA-MM-DD".
TZ_NEGOCIO = timezone(timedelta(hours=float(os.environ.get("TZ_OFFSET_HORAS", "-6") or -6)))


def ahora_local() -> datetime:
    return now_utc().astimezone(TZ_NEGOCIO)


def hoy_local() -> str:
    return ahora_local().date().isoformat()


def inicio_dia_utc(fecha_local: str) -> str:
    """ISO UTC del inicio del día local (00:00 en la sucursal)."""
    d = datetime.strptime(fecha_local[:10], "%Y-%m-%d").replace(tzinfo=TZ_NEGOCIO)
    return d.astimezone(timezone.utc).isoformat()


def filtro_dias_local(campo: str, desde: str | None, hasta: str | None) -> dict | None:
    """Filtro de rango por días LOCALES (inclusivo) para un campo de fecha que
    mezcla marcas UTC ISO (ventas del ERP) y fechas "AAAA-MM-DD" (LEGACY).
    Ponerlo dentro de "$and" para no chocar con otros "$or"."""
    if not desde and not hasta:
        return None
    iso, solo_fecha = [{campo: {"$regex": "T"}}], [{campo: {"$regex": r"^\d{4}-\d{2}-\d{2}$"}}]
    if desde:
        iso.append({campo: {"$gte": inicio_dia_utc(desde)}})
        solo_fecha.append({campo: {"$gte": desde[:10]}})
    if hasta:
        sig = (datetime.strptime(hasta[:10], "%Y-%m-%d").date() + timedelta(days=1)).isoformat()
        iso.append({campo: {"$lt": inicio_dia_utc(sig)}})
        solo_fecha.append({campo: {"$lt": sig}})
    return {"$or": [{"$and": iso}, {"$and": solo_fecha}]}


def fecha_local(valor) -> str:
    """Fecha local "AAAA-MM-DD" de una marca guardada (UTC ISO o solo fecha)."""
    s = str(valor or "")
    if len(s) <= 10:
        return s
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(TZ_NEGOCIO).date().isoformat()
    except ValueError:
        return s[:10]

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

def _jwt_claims(user_id: str, email: str, token_type: str, token_version: int,
                ttl_seconds: int | None = None) -> dict:
    now = now_utc()
    ttl = ttl_seconds or (ACCESS_TOKEN_TTL_SECONDS if token_type == "access" else REFRESH_TOKEN_TTL_SECONDS)
    return {
        "sub": user_id,
        "email": email,
        "jti": uuid.uuid4().hex,
        "iat": now,
        "exp": now + timedelta(seconds=ttl),
        "type": token_type,
        "token_version": int(token_version or 0),
    }

def create_access_token(user_id: str, email: str, token_version: int = 0,
                        ttl_seconds: int | None = None) -> str:
    """ttl_seconds: vigencia distinta a la normal (jornada de la app de vendedores)."""
    return jwt.encode(_jwt_claims(user_id, email, "access", token_version, ttl_seconds),
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
    "developer_tools",       # herramientas destructivas (limpieza/reset) del módulo desarrollador
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
        "venta.cambiar_operador", "recargas.usar", "recargas.ver_todas",
        "cliente.crear", "cliente.editar", "clientes.gestionar",
        "reportes.ver", "reportes.global",
        "importar", "exportar", "config", "credito.autorizar",
        "inventario.autorizar_negativo", "finanzas.ver", "catalogo.ver",
        "caja.retiro_forzado", "cxc.abono", "cxc.interes",
        "proveedor.ver", "proveedor.crear", "proveedor.editar",
        "compra.ver", "compra.crear", "compra.cancelar",
        "abono.ver", "abono.comprobante", "cuentas.ver",
        "pedido.gestionar", "cxp.pagar", "correo.ver", "correo.enviar",
        "whatsapp.ver", "whatsapp.responder",
    },
    # VENDEDOR (piso): sucursal, caja física, POS, facturación, recargas y apoyo en campo.
    "vendedor": {
        "venta.crear", "venta.cancelar", "venta.descuento", "venta.facturar",
        "recargas.usar", "catalogo.ver", "caja.abrir", "caja.cerrar",
        "caja.ver", "caja.retiro", "caja.entrada", "pedido.gestionar",
        "cliente.crear", "visita.crear", "visita.editar", "visita.ver", "visita.cancelar",
        "cxc.abono", "cxc.ver",
    },
    # CAJERA: opera caja y POS (facturación y recargas) sin cotizaciones
    # complejas de campo; mismo alcance restringido que vendedor de piso.
    "cajero": {
        "venta.crear", "venta.facturar", "recargas.usar", "catalogo.ver",
        "caja.abrir", "caja.cerrar", "caja.ver", "caja.retiro",
        "caja.entrada", "pedido.gestionar",
    },
    # VENDEDOR DE CAMPO: celular/APK — visitas, rutas, GPS, levanta pedidos
    # y cobros de su cartera.
    "vendedor_campo": {
        "venta.crear", "cliente.crear", "visita.crear", "visita.editar",
        "visita.ver", "visita.cancelar", "catalogo.ver", "pedido.gestionar",
        "caja.abrir", "caja.cerrar", "caja.ver", "caja.retiro",
        "cxc.abono", "cxc.ver",
    },
    # Supervisor/Gerente comercial: monitoreo de vendedores de campo,
    # cartera, CxC, actividad, mapa y autorizaciones comerciales.
    "supervisor": {
        "venta.crear", "venta.cancelar", "venta.descuento", "venta.ver_todas",
        "venta.facturar", "venta.cambiar_operador",
        "cliente.crear", "cliente.editar", "cliente.baja",
        "reportes.ver", "reportes.global", "exportar", "importar",
        "cxc.ver", "caja.entrada", "credito.autorizar",
        "cxc.interes",
        "compra.ver", "compra.crear", "compra.cancelar", "abono.ver",
        "abono.comprobante", "proveedor.ver", "cuentas.ver",
        "pedido.gestionar", "cxp.pagar",
        "visita.crear", "visita.editar", "visita.ver", "visita.cancelar",
        "supervision.ver", "supervision.mapa", "supervision.cartera",
        "supervision.cxc", "supervision.actividad",
    },
}

# Catálogo de módulos asignables por admin/propietario en Usuarios.
# Cada módulo otorga un conjunto de permisos adicional al rol base.
MODULES = {
    "catalogo": {
        "label": "Catálogo (consulta por categoría)",
        "perms": {"catalogo.ver"},
    },
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
        # recargas.usar es el que exige la pantalla de Recargas; sin él el
        # módulo asignado no daba acceso.
        "perms": {"venta.crear", "recargas.usar", "recargas.ver_todas"},
    },
    "caja": {
        "label": "Caja",
        "perms": {"caja.ver", "caja.abrir", "caja.cerrar", "caja.retiro",
                  "caja.entrada"},
    },
    "cxc": {
        "label": "Cuentas por Cobrar",
        "perms": {"cxc.ver", "caja.entrada", "credito.autorizar", "cxc.abono"},
    },
    "cxc_interes": {
        "label": "CxC: aplicar interés moratorio",
        "perms": {"cxc.interes"},
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
    "pedidos": {
        "label": "Pedidos",
        "perms": {"pedido.gestionar"},
    },
    # Para usuarios que no son administradores ni dueño: definen un código de
    # 6 dígitos en Mi cuenta y con él autorizan movimientos de otros (p. ej.
    # precio manual en el POS). Ver autorizaciones.py.
    "autorizaciones": {
        "label": "Autorizar movimientos con código",
        "perms": {"autorizacion.otorgar"},
    },
    # Bandeja de ventas@ y contacto@ (correo.py): leer y responder.
    "correo": {
        "label": "Correo (ventas@ y contacto@)",
        "perms": {"correo.ver", "correo.enviar"},
    },
    # Bandeja de WhatsApp y conversaciones del Agente RYSA (whatsapp.py).
    "whatsapp": {
        "label": "WhatsApp (bandeja y Agente RYSA)",
        "perms": {"whatsapp.ver", "whatsapp.responder"},
    },
}

def role_permissions(role: str) -> set:
    return set(ROLE_PERMISSIONS.get(role, set()))

# Módulos que se otorgan por defecto a usuarios NO privilegiados al crearlos.
# Solo es un DEFAULT: un administrador autorizado puede modificarlo después.
# "productos" agrupa Productos e Inventario.
DEFAULT_MODULES_NON_PRIVILEGED = [
    "caja", "catalogo",
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
