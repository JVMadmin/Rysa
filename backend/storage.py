"""Almacenamiento de archivos local y generación de PDF de ticket."""
import os
import io
import mimetypes
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
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


def _elem_visible(el, default=True):
    try:
        return bool(el.get("visible", default))
    except Exception:
        return default


def _build_default_elements(tc, settings, sale):
    """Bloques por defecto (compatibilidad con el diseño previo)."""
    els = [{"tipo": "empresa", "align": "center", "bold": True, "font_size": 11}]
    if tc.get("mostrar_rfc", True) and settings.get("rfc"):
        els.append({"tipo": "campo", "contenido": f"RFC: {settings.get('rfc')}", "align": "center"})
    if tc.get("mostrar_direccion", True) and settings.get("direccion"):
        els.append({"tipo": "campo", "contenido": settings.get("direccion", ""), "align": "center"})
    if tc.get("mostrar_telefono", True) and settings.get("telefono"):
        els.append({"tipo": "campo", "contenido": f"Tel: {settings.get('telefono')}", "align": "center"})
    if tc.get("encabezado"):
        els.append({"tipo": "texto", "contenido": tc.get("encabezado"), "align": "center"})
    els.append({"tipo": "separador"})
    els.append({"tipo": "folio"})
    els.append({"tipo": "fecha"})
    els.append({"tipo": "cliente"})
    if sale.get("vendedor_nombre"):
        els.append({"tipo": "atendio"})
    els.append({"tipo": "separador"})
    els.append({"tipo": "items"})
    els.append({"tipo": "separador"})
    incluye_iva = (settings or {}).get("precios_incluyen_iva", True)
    if not incluye_iva:
        els.append({"tipo": "subtotal"})
        els.append({"tipo": "iva"})
    els.append({"tipo": "total"})
    if sale.get("condicion") == "credito":
        els.append({"tipo": "credito"})
    els.append({"tipo": "separador"})
    if tc.get("pie"):
        els.append({"tipo": "pie", "contenido": tc.get("pie")})
        els.append({"tipo": "pie2"})
    qr = tc.get("qr_contenido") or tc.get("qr_texto") or "{verificar}"
    if tc.get("mostrar_qr", True) is not False:
        els.append({"tipo": "qr", "contenido": qr, "qr_size": tc.get("qr_size", 18)})
    return els


def _apply_align(c, x, w, text, align, size, bold):
    c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
    if align == "center":
        c.drawCentredString(w / 2, x, text)
    elif align == "right":
        c.drawRightString(w - 4 * mm, x, text)
    else:
        c.drawString(4 * mm, x, text)


def build_ticket_pdf(sale: dict, settings: dict) -> bytes:
    """Genera un PDF del ticket según la configuración.

    Si `ticket_config.elements` es una lista de bloques (editor avanzado), se
    renderiza ese diseño; si no, se usan los bloques por defecto (diseño previo).
    Tipos de elemento: empresa, campo, texto, separador, folio, fecha, cliente,
    atendio, items, subtotal, iva, total, credito, pie, logo, qr.
    """
    tc = (settings or {}).get("ticket_config", {}) or {}
    size = tc.get("tamano", "80mm")
    empresa = settings.get("empresa_nombre", "Grupo RYSA")
    base_url = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    def verificar_url():
        if not base_url:
            return f"/api/sales/{sale.get('id')}/public"
        return f"{base_url}/verificar/{sale.get('id')}"
    elements = tc.get("elements") if isinstance(tc.get("elements"), list) else None
    if not elements:
        elements = _build_default_elements(tc, settings, sale)

    buf = io.BytesIO()
    if size == "carta":
        c = canvas.Canvas(buf, pagesize=letter)
        w, h = letter
        x = 25 * mm
        y = h - 25 * mm
        line_h = 14
    else:
        width = 80 * mm
        items = sale.get("items", [])
        est_h = (40 + len(items) * 2 + 25) * mm
        c = canvas.Canvas(buf, pagesize=(width, est_h))
        w, h = width, est_h
        x = 4 * mm
        y = h - 8 * mm
        line_h = 11

    def L(text, center=False, bold=False, sz=None, align=None):
        nonlocal y
        if align is None:
            align = "center" if center else "left"
        _apply_align(c, y, w, text, align, sz or (9 if size == "carta" else 7), bold)
        y -= line_h

    def sep():
        nonlocal y
        _apply_align(c, y, w, "-" * 42, "left", 7, False)
        y -= line_h

    def campos_items():
        nonlocal y
        for it in sale.get("items", []):
            desc = str(it.get("descripcion", ""))[:34]
            _apply_align(c, y, w, desc, "left", 9 if size == "carta" else 7, False)
            y -= line_h
            cant = it.get("cantidad", 0)
            precio = it.get("precio", 0)
            importe = it.get("importe", cant * precio)
            _apply_align(c, y, w, f"  {cant} x {_money(precio)}          {_money(importe)}", "left", 7, False)
            y -= line_h

    # Resolver variables de plantilla para texto/QR
    def fi(t):
        try:
            return (t or "").replace("{empresa}", empresa) \
                .replace("{verificar}", verificar_url()) \
                .replace("{cip}", "").replace("{folio}", sale.get("folio", "")) \
                .replace("{cliente}", sale.get("cliente_nombre", "")) \
                .replace("{total}", _money(sale.get("total"))) \
                .replace("{fecha}", str(sale.get("fecha", ""))[:16].replace("T", " "))
        except Exception:
            return t or ""

    for el in elements:
        if not _elem_visible(el):
            continue
        tipo = el.get("tipo", "texto")
        cont = fi(el.get("contenido"))
        align = el.get("align") or ("center" if size != "carta" else "left")
        bold = el.get("bold", False)
        fsz = el.get("font_size")
        try:
            if tipo == "logo" and settings.get("logo_url"):
                p = get_safe_local_path(settings["logo_url"]) if not settings["logo_url"].startswith("http") else None
                if p and os.path.exists(p):
                    try:
                        c.drawImage(ImageReader(p), w / 2 - 10 * mm, y, 20 * mm, 20 * mm * 0.6, preserveAspectRatio=True, mask="auto")
                        y -= 14 * mm
                    except Exception:
                        pass
            elif tipo == "qr":
                import qrcode
                from io import BytesIO
                qr = qrcode.QRCode(err_correction=qrcode.constants.ERROR_CORRECT_M)
                qr.add_data(cont or "https://gruporysa.com")
                qr.make(fit=True)
                img = qr.make_image(fill_color="black", back_color="white")
                qbio = BytesIO()
                img.save(qbio, format="PNG")
                qbio.seek(0)
                qs = el.get("qr_size") or 18
                c.drawImage(ImageReader(qbio), w / 2 - (qs * mm) / 2, y - (qs * mm), qs * mm, qs * mm)
                y -= (qs * mm + 4 * mm)
            elif tipo == "empresa":
                L(empresa, bold=True, sz=fsz or 11, align="center")
            elif tipo in ("campo", "texto"):
                L(cont, align=align, bold=bold, sz=fsz)
            elif tipo == "encabezado":
                L(cont, align="center", bold=bold, sz=fsz)
            elif tipo == "separador":
                sep()
            elif tipo == "folio":
                L(f"FOLIO: {sale.get('folio', '')}", bold=True, sz=fsz)
            elif tipo == "fecha":
                L(f"Fecha: {str(sale.get('fecha', ''))[:16].replace('T', ' ')}", sz=fsz)
            elif tipo == "cliente":
                L(f"Cliente: {sale.get('cliente_nombre', 'Público General')}", sz=fsz)
            elif tipo == "atendio":
                L(f"Atendió: {sale.get('vendedor_nombre')}", sz=fsz)
            elif tipo == "items":
                campos_items()
            elif tipo == "subtotal":
                L(f"Subtotal: {_money(sale.get('subtotal'))}", align=align, sz=fsz)
            elif tipo == "iva":
                L(f"IVA: {_money(sale.get('iva_total'))}", align=align, sz=fsz)
            elif tipo == "total":
                L(f"TOTAL: {_money(sale.get('total'))}", bold=True, align=align, sz=fsz or (12 if size == "carta" else 9))
            elif tipo == "credito":
                L(f"** VENTA A CRÉDITO ** Saldo: {_money(sale.get('saldo'))}", align="center", sz=fsz)
            elif tipo == "pie" or tipo == "pie2":
                L(cont if cont else tc.get("pie", "¡Gracias por su compra!"), align="center", sz=fsz)
        except Exception:
            # Nunca romper la generación del ticket por un bloque fallido.
            continue

    c.showPage()
    c.save()
    buf.seek(0)
    return buf.read()
