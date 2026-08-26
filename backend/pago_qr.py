"""QR de comprobante de pago para cotizaciones — utilidades centrales.

Responsabilidades (usado por server.py y documentos.py):
  - Tokens criptográficamente seguros + hash SHA-256 para lookup público.
  - URL pública del comprobante (PUBLIC_BASE_URL ⤵ fallback base del request).
  - Rate limiting simple EN MEMORIA por clave (IP+token): sin dependencias.
  - Validación de archivos: extensión permitida, MIME REAL (firmas mágicas
    vía storage.detect_mime_type), tamaño máximo y nombre sanitizado.

Seguridad §15: el token crudo jamás se loguea; en DB se guarda también su
hash indexado; la validación de expiración/revocación vive en los endpoints.
"""
import hashlib
import os
import re
import secrets
import time
from collections import defaultdict, deque
from urllib.parse import quote

import storage

# --------------------------------------------------------------------------- #
# Tokens                                                                       #
# --------------------------------------------------------------------------- #
def nuevo_token() -> str:
    """Token aleatorio de 256 bits, URL-safe e impredecible (§3)."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256((token or "").encode()).hexdigest()


def armar_url(base_url: str | None, token: str) -> str:
    """URL pública absoluta del comprobante (§2).
    Prioridad: PUBLIC_BASE_URL (config explícita) ⤵ base del request.
    En desarrollo backend y frontend viven en orígenes distintos, por lo que
    PUBLIC_BASE_URL debe apuntar al ORIGEN DEL FRONTEND (donde vive la ruta
    /pago/comprobante/:token)."""
    base = (os.environ.get("PUBLIC_BASE_URL") or base_url or "").rstrip("/")
    return f"{base}/pago/comprobante/{quote(token, safe='')}" if base else ""


# --------------------------------------------------------------------------- #
# Rate limiting en memoria (proceso único; suficiente para este despliegue)    #
# --------------------------------------------------------------------------- #
_VENTANAS: dict = defaultdict(deque)
_MAX_CLAVES = 20000


def permitir(clave: str, maximo: int, ventana_seg: int = 3600) -> bool:
    """True si `clave` no excede `maximo` eventos en la ventana."""
    ahora = time.time()
    q = _VENTANAS.get(clave)
    if q is None:
        if len(_VENTANAS) > _MAX_CLAVES:  # higiene ante abusos
            _VENTANAS.clear()
        q = _VENTANAS[clave] = deque()
    while q and ahora - q[0] > ventana_seg:
        q.popleft()
    if len(q) >= maximo:
        return False
    q.append(ahora)
    return True


# --------------------------------------------------------------------------- #
# Archivos (§6)                                                                #
# --------------------------------------------------------------------------- #
EXT_MIME = {
    ".pdf": {"application/pdf"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".png": {"image/png"},
    ".webp": {"image/webp"},
}
MIN_BYTES = 64


def sanitizar_nombre(nombre: str) -> str:
    """Solo el basename, sin rutas ni caracteres peligrosos (§15)."""
    nombre = os.path.basename((nombre or "").replace("\\", "/"))
    nombre = re.sub(r"[^A-Za-z0-9._\- ]", "_", nombre).strip(" ._")
    return nombre[:120] or "comprobante"


def validar_archivo(nombre: str, data: bytes, max_mb: int) -> tuple[bool, str]:
    """Extensión + MIME real (firmas) + tamaño. Devuelve (ok, mensaje)."""
    if not data or len(data) < MIN_BYTES:
        return False, "Archivo vacío o corrupto"
    if len(data) > max_mb * 1024 * 1024:
        return False, f"El archivo supera el máximo de {max_mb} MB"
    ext = os.path.splitext(sanitizar_nombre(nombre))[1].lower()
    if ext not in EXT_MIME:
        return False, "Formato no permitido (usa PDF, JPG, PNG o WEBP)"
    mime = storage.detect_mime_type(data)
    if mime not in EXT_MIME[ext]:
        return False, f"El contenido no corresponde a un archivo {ext[1:].upper()} válido"
    return True, ""


def mensaje_wa(folio: str, cliente: str, importe_txt: str) -> str:
    """Plantilla del mensaje que acompaña al comprobante (§10)."""
    return ("COMPROBANTE DE PAGO\n"
            f"Cotización: {folio}\n"
            f"Cliente: {cliente}\n"
            f"Importe: {importe_txt}\n\n"
            "Se adjunta el comprobante de pago.")
