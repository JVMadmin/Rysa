"""Emergent object storage helpers + generación de PDF de ticket."""
import os
import io
import requests
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "grupo-rysa"

MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp", "pdf": "application/pdf",
}

_storage_key = None


def init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key}, timeout=60,
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


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
