"""Almacenamiento de archivos local y generación de PDF de ticket."""
import os
import io
import mimetypes
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

# Directorio base para subidas local (configurable por variable de entorno)
# En producción en el VPS se puede establecer UPLOAD_DIR=/var/www/rysa/uploads
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(os.getcwd(), "uploads"))

MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp", "pdf": "application/pdf",
}

def get_safe_local_path(storage_path: str) -> str:
    """Resuelve la ruta y previene vulnerabilidades de Path Traversal."""
    base = os.path.abspath(UPLOAD_DIR)
    # Evitamos que usen rutas absolutas o de retroceso que apunten fuera de UPLOAD_DIR
    target = os.path.abspath(os.path.join(base, storage_path))
    if not target.startswith(base):
        raise ValueError("Acceso no autorizado: Intento de Path Traversal detectado.")
    return target

def init_storage():
    """Garantiza la existencia del directorio de almacenamiento."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    return UPLOAD_DIR

def detect_mime_type(data: bytes) -> str:
    """Inspecciona los primeros bytes (firmas mágicas) para validar el tipo MIME real."""
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return "image/png"
    elif data.startswith(b'\xff\xd8'):
        return "image/jpeg"
    elif data.startswith(b'GIF87a') or data.startswith(b'GIF89a'):
        return "image/gif"
    elif data.startswith(b'RIFF') and len(data) > 12 and data[8:12] == b'WEBP':
        return "image/webp"
    elif data.startswith(b'%PDF-'):
        return "application/pdf"
    return "application/octet-stream"

def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Guarda un archivo de forma local en el disco del servidor."""
    init_storage()
    target_path = get_safe_local_path(path)
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    
    with open(target_path, "wb") as f:
        f.write(data)
        
    return {
        "path": path,
        "size": len(data)
    }

def get_object(path: str):
    """Obtiene un archivo almacenado localmente."""
    target_path = get_safe_local_path(path)
    if not os.path.exists(target_path) or os.path.isdir(target_path):
        raise FileNotFoundError(f"Archivo no encontrado: {path}")
        
    # Adivinar tipo MIME basado en la extensión o por defecto
    ctype, _ = mimetypes.guess_type(target_path)
    if not ctype:
        ctype = "application/octet-stream"
        
    with open(target_path, "rb") as f:
        data = f.read()
        
    return data, ctype

def _money(v):
    try:
        return f"${float(v or 0):,.2f}"
    except Exception:
        return "$0.00"

def build_ticket_pdf(sale: dict, settings: dict) -> bytes:
    """Genera un PDF del ticket según la configuración (80mm o carta)."""
    tc = (settings or {}).get("ticket_config", {}) or {}
    size = tc.get("tamano", "80mm")
    empresa = settings.get("empresa_nombre", "Grupo RYSA")
    buf = io.BytesIO()

    if size == "carta":
        c = canvas.Canvas(buf, pagesize=letter)
        w, h = letter
        x, y = 25 * mm, h - 25 * mm
        line_h = 14
        c.setFont("Helvetica-Bold", 16)
        c.drawString(x, y, empresa)
        y -= line_h * 1.5
        c.setFont("Helvetica", 9)
    else:
        width = 80 * mm
        items = sale.get("items", [])
        est_h = (40 + len(items) * 2 + 25) * mm
        c = canvas.Canvas(buf, pagesize=(width, est_h))
        w, h = width, est_h
        x = 4 * mm
        y = h - 8 * mm
        line_h = 11
        c.setFont("Helvetica-Bold", 11)
        c.drawCentredString(w / 2, y, empresa)
        y -= line_h
        c.setFont("Helvetica", 7)

    def L(text, center=False, bold=False, sz=None):
        nonlocal y
        c.setFont("Helvetica-Bold" if bold else "Helvetica", sz or (9 if size == "carta" else 7))
        if center and size != "carta":
            c.drawCentredString(w / 2, y, text)
        elif center:
            c.drawCentredString(w / 2, y, text)
        else:
            c.drawString(x, y, text)
        y -= line_h

    if tc.get("mostrar_rfc", True) and settings.get("rfc"):
        L(f"RFC: {settings.get('rfc')}", center=(size != "carta"))
    if tc.get("mostrar_direccion", True) and settings.get("direccion"):
        L(settings.get("direccion", ""), center=(size != "carta"))
    if tc.get("mostrar_telefono", True) and settings.get("telefono"):
        L(f"Tel: {settings.get('telefono')}", center=(size != "carta"))
    if tc.get("encabezado"):
        L(tc.get("encabezado"), center=(size != "carta"))

    L("-" * 42)
    L(f"FOLIO: {sale.get('folio', '')}", bold=True)
    L(f"Fecha: {str(sale.get('fecha', ''))[:16].replace('T', ' ')}")
    L(f"Cliente: {sale.get('cliente_nombre', 'Publico General')}")
    if sale.get("vendedor_nombre"):
        L(f"Atendio: {sale.get('vendedor_nombre')}")
    L("-" * 42)

    for it in sale.get("items", []):
        desc = str(it.get("descripcion", ""))[:34]
        L(desc)
        cant = it.get("cantidad", 0)
        precio = it.get("precio", 0)
        importe = it.get("importe", cant * precio)
        L(f"  {cant} x {_money(precio)}          {_money(importe)}")

    L("-" * 42)
    incluye_iva = (settings or {}).get("precios_incluyen_iva", True)
    if not incluye_iva:
        L(f"Subtotal: {_money(sale.get('subtotal'))}")
        L(f"IVA: {_money(sale.get('iva_total'))}")
    L(f"TOTAL: {_money(sale.get('total'))}", bold=True, sz=(12 if size == "carta" else 9))
    if sale.get("condicion") == "credito":
        L(f"** VENTA A CREDITO ** Saldo: {_money(sale.get('saldo'))}", center=(size != "carta"))
    L("-" * 42)
    L(tc.get("pie", "¡Gracias por su compra!"), center=(size != "carta"))

    c.showPage()
    c.save()
    buf.seek(0)
    return buf.read()
