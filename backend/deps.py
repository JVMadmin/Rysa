"""Utilidades compartidas: base de datos, autenticación JWT, RBAC, auditoría."""
import os
import jwt
import bcrypt
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, Request, Depends
from motor.motor_asyncio import AsyncIOMotorClient

# --- MongoDB ---
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

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
JWT_ALGORITHM = "HS256"

def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]

def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email,
               "exp": now_utc() + timedelta(days=7), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

# --- RBAC ---
ROLE_PERMISSIONS = {
    "admin": {"*"},
    "encargado": {
        "producto.crear", "producto.editar", "producto.baja", "producto.costo",
        "producto.precio", "inventario.ajuste", "venta.crear", "venta.cancelar",
        "venta.descuento", "caja.abrir", "caja.cerrar", "caja.retiro",
        "caja.entrada", "cliente.crear", "cliente.editar", "reportes.ver",
        "importar", "exportar", "usuarios.ver",
    },
    "vendedor": {
        "venta.crear", "venta.descuento", "cliente.crear", "cliente.editar",
        "exportar",
    },
    "cajero": {
        "caja.abrir", "caja.cerrar", "caja.retiro", "caja.entrada",
        "venta.crear", "exportar",
    },
}

def has_permission(role: str, perm: str) -> bool:
    perms = ROLE_PERMISSIONS.get(role, set())
    return "*" in perms or perm in perms

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="No autenticado")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Token inválido")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="Usuario no encontrado")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sesión expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")

def require_permission(perm: str):
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if not has_permission(user.get("role", ""), perm):
            raise HTTPException(status_code=403, detail="No tienes permiso para esta acción")
        return user
    return checker

# --- Contadores (folios / códigos) ---
async def next_counter(name: str, prefix: str = "", padding: int = 5) -> str:
    doc = await db.counters.find_one_and_update(
        {"_id": name}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    seq = doc["seq"]
    return f"{prefix}{str(seq).zfill(padding)}"

# --- Auditoría ---
async def log_audit(usuario: dict, accion: str, entidad: str, registro_id: str = "", detalle: str = ""):
    await db.audit_logs.insert_one({
        "id": __import__("uuid").uuid4().hex,
        "usuario_id": usuario.get("id"),
        "usuario_nombre": usuario.get("name"),
        "accion": accion,
        "entidad": entidad,
        "registro_id": registro_id,
        "detalle": detalle,
        "fecha": iso_now(),
    })
