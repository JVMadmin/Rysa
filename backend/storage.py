"""Almacenamiento de archivos local y generación de PDF de ticket."""
import os
import io
import mimetypes
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth

# Directorio base para subidas local (configurable por variable de entorno)
# En producción en el VPS se puede establecer UPLOAD_DIR=/var/www/rysa/uploads
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(os.getcwd(), "uploads"))

# Directorio elegido desde la UI de Configuración (se aplica en tiempo de ejecución).
_OVERRIDE_DIR = None

def set_upload_dir(path: str):
    """Permite seleccionar el directorio de almacenamiento local desde Configuración."""
    global _OVERRIDE_DIR
    path = (path or "").strip()
    _OVERRIDE_DIR = path or None

def base_upload_dir() -> str:
    """Ruta efectiva: la elegida en la UI, o la variable de entorno, o el valor por defecto."""
    return _OVERRIDE_DIR or os.environ.get("UPLOAD_DIR", os.path.join(os.getcwd(), "uploads"))

MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp", "pdf": "application/pdf",
}

def get_safe_local_path(storage_path: str) -> str:
    """Resuelve la ruta y previene vulnerabilidades de Path Traversal."""
    base = os.path.abspath(base_upload_dir())
    # Evitamos que usen rutas absolutas o de retroceso que apunten fuera de UPLOAD_DIR
    target = os.path.abspath(os.path.join(base, storage_path))
    if not target.startswith(base):
        raise ValueError("Acceso no autorizado: Intento de Path Traversal detectado.")
    return target


# Logotipo oficial incluido con el proyecto (fallback cuando no hay logo
# personalizado en Configuración). Se usa en TODOS los documentos generados.
_ASSET_LOGO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "isotipo1.png")


def logo_local(settings: dict) -> str | None:
    """Ruta local del logotipo para documentos (ticket/carta/PDF).
    Prioridad: 1) logo subido en Configuración · 2) asset oficial del repo.
    Devuelve None si no hay ninguno disponible."""
    lu = (settings or {}).get("logo_url") or ""
    if lu and "/api/files/" in lu:
        try:
            p = get_safe_local_path(lu.split("/api/files/", 1)[1])
            if os.path.isfile(p):
                return p
        except Exception:
            pass
    try:
        if os.path.isfile(_ASSET_LOGO):
            return _ASSET_LOGO
    except Exception:
        pass
    return None


def imagen_con_proporcion(ruta: str, ancho_max_mm: float, alto_max_mm: float):
    """Image de reportlab que respeta la proporción real del archivo
    (nunca deforma el logo) y cabe dentro del caja dada."""
    from reportlab.platypus import Image
    iw, ih = ImageReader(ruta).getSize()
    if not iw or not ih:
        return None
    ar = iw / float(ih)
    w, h = ancho_max_mm, ancho_max_mm / ar
    if h > alto_max_mm:
        h = alto_max_mm
        w = h * ar
    return Image(ruta, width=w, height=h)

def init_storage():
    """Garantiza la existencia del directorio de almacenamiento."""
    os.makedirs(base_upload_dir(), exist_ok=True)
    return base_upload_dir()

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

def _num_a_letras(valor):
    """Convierte un monto a letras en español (mxn). Ej: 1200 -> 'MIL DOSCIENTOS PESOS'."""
    try:
        valor = float(valor or 0)
    except Exception:
        return ""
    signo = ""
    if valor < 0:
        valor = abs(valor); signo = "MENOS "
    entero = int(valor)
    deci = int(round((valor - entero) * 100))
    unidades = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
                "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE",
                "DIECIOCHO", "DIECINUEVE", "VEINTE"]
    decenas = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"]
    centenas = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
                "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"]
    def tres(n):
        c = int(n // 100); r = int(n % 100)
        s = ""
        if c == 1 and r == 0: s += "CIEN"
        elif c: s += centenas[c] + (" " if r else "")
        if r:
            if r <= 20: s += unidades[r]
            elif r < 30: s += "VEINTI" + unidades[r - 20]
            else:
                s += decenas[r // 10]
                if r % 10: s += " Y " + unidades[r % 10]
        return s.strip()
    if entero == 0:
        txt = "CERO"
    else:
        partes = []
        milesim = entero // 1000000
        resto = entero % 1000000
        if milesim:
            if milesim == 1: partes.append("UN MILLÓN")
            else: partes.append(tres(milesim) + " MILLONES")
        millar = resto // 1000
        res = resto % 1000
        if millar:
            if millar == 1: partes.append("MIL")
            else: partes.append(tres(millar) + " MIL")
        if res:
            partes.append(tres(res))
        txt = " ".join(partes)
    txt = txt.replace("CIENTO PESOS", "CIEN PESOS")
    deci_str = f"{deci:02d}"
    return f"{signo}{txt} PESOS {deci_str}/100 M.N."


def _elem_visible(el, default=True):
    try:
        return bool(el.get("visible", default))
    except Exception:
        return default


def _build_default_elements(tc, settings, sale):
    """Bloques por defecto: diseño de ticket limpio y completo (logo, datos, items, total, QR)."""
    els = []
    full_addr = " ".join(filter(None, [
        settings.get("direccion", ""),
        settings.get("ciudad", ""),
        settings.get("estado", ""),
        settings.get("cp", ""),
    ]))
    # Logo SIEMPRE: usa el de Configuración o el asset oficial incluido
    # (storage.logo_local resuelve el fallback automáticamente).
    els.append({"tipo": "logo", "align": "center"})
    if settings.get("razon_social"):
        els.append({"tipo": "texto", "contenido": settings.get("razon_social"), "align": "center", "font_size": 8})
    els.append({"tipo": "empresa", "align": "center", "bold": True, "font_size": 11})
    if tc.get("mostrar_rfc", True) and settings.get("rfc"):
        els.append({"tipo": "campo", "contenido": f"RFC: {settings.get('rfc')}", "align": "center"})
    if tc.get("mostrar_direccion", True) and full_addr:
        els.append({"tipo": "campo", "contenido": full_addr, "align": "center"})
    if tc.get("mostrar_telefono", True) and settings.get("telefono"):
        els.append({"tipo": "campo", "contenido": f"Tel: {settings.get('telefono')}", "align": "center"})
    if settings.get("correo"):
        els.append({"tipo": "campo", "contenido": f"Email: {settings.get('correo')}", "align": "center"})
    if tc.get("encabezado"):
        els.append({"tipo": "texto", "contenido": tc.get("encabezado"), "align": "center"})
    els.append({"tipo": "separador"})
    if sale.get("serie"):
        els.append({"tipo": "campo", "contenido": f"Serie: {sale.get('serie')}", "align": "center"})
    if sale.get("folio"):
        els.append({"tipo": "folio"})
    if sale.get("fecha"):
        els.append({"tipo": "fecha"})
        els.append({"tipo": "hora"})
    if sale.get("cliente_nombre"):
        els.append({"tipo": "cliente"})
    els.append({"tipo": "separador"})
    # El bloque "items" ya imprime su propio encabezado DESCRIPCION:
    # NO añadir "deschead" (antes salía duplicado).
    els.append({"tipo": "items"})
    els.append({"tipo": "separador"})
    incluye_iva = (settings or {}).get("precios_incluyen_iva", True)
    if incluye_iva:
        els.append({"tipo": "subtotal"})
        els.append({"tipo": "iva"})
    if sale.get("descuento_total", 0) or sale.get("descuento", 0):
        els.append({"tipo": "descuento"})
    els.append({"tipo": "total", "align": "center"})
    els.append({"tipo": "letras"})
    if sale.get("condicion") == "credito":
        els.append({"tipo": "credito"})
    else:
        els.append({"tipo": "recibido"})
        els.append({"tipo": "cambio"})
    els.append({"tipo": "articulos"})
    if sale.get("vendedor_nombre"):
        els.append({"tipo": "atendio"})
    els.append({"tipo": "separador"})
    els.append({"tipo": "texto", "contenido": "VERIFIQUE SU COMPRA Y SU CAMBIO", "align": "center", "font_size": 8})
    els.append({"tipo": "texto", "contenido": tc.get("pie", "¡Gracias por su compra!"), "align": "center", "font_size": 8})
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


def _wrap_lines(text, max_w, size, font="Helvetica"):
    """Divide `text` en líneas que caben dentro de `max_w` (points), recortando
    palabras largas si es necesario (word-wrap). Evita que las descripciones
    desborden/amontonen la cinta térmica."""
    from reportlab.pdfbase.pdfmetrics import stringWidth as _sw
    words = str(text or "").replace("\n", " ").split(" ")
    lines = []
    cur = ""
    for wd in words:
        trial = wd if not cur else cur + " " + wd
        if _sw(trial, font, size) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = wd
            # Recorta palabras que solas exceden el ancho disponible.
            while _sw(cur, font, size) > max_w and len(cur) > 1:
                cut = len(cur) - 1
                while cut > 1 and _sw(cur[:cut] + "…", font, size) > max_w:
                    cut -= 1
                lines.append(cur[:cut] + "…")
                cur = cur[cut:]
    if cur:
        lines.append(cur)
    return lines


def _item_lines(it, max_w, size):
    """Cantidad real de líneas que ocupará un item en el ticket (para calcular
    la altura del papel sin que el contenido se corte)."""
    font = "Helvetica"
    desc = str(it.get("descripcion", "") or "")
    n = len(_wrap_lines(desc, max_w, size, font))
    precio = _money(it.get("precio", 0))
    importe = it.get("importe", it.get("importe_bruto",
                 float(it.get("cantidad", 0) or 0) * float(it.get("precio", 0) or 0) -
                 float(it.get("descuento", 0) or 0)))
    fe = "  {0} {1}   {2}  {3}".format(int(it.get("cantidad", 0) or 0),
                                      it.get("unidad", "PZA"),
                                      _money(it.get("precio", it.get("importe", 0))),
                                      _money(importe))
    n += max(1, len(_wrap_lines(fe, max_w, size, font)))
    if float(it.get("descuento", 0) or 0) > 0:
        n += 1
    comentario = str(it.get("comentario", "") or "").strip()
    if comentario:
        for linea in comentario.splitlines():
            if linea.strip():
                n += max(1, len(_wrap_lines("    * " + linea, max_w, size, font)))
    return n


def build_entrega_pdf(mov: dict, caja: dict, settings: dict,
                      efectivo_en_caja=None) -> bytes:
    """Ticket térmico (80 mm) de ENTREGA DE EFECTIVO u otro movimiento de caja.

    Incluye: datos de empresa, folio RET-xxxxxx, fecha/hora, cajero, concepto,
    referencia, monto destacado, efectivo restante en caja y líneas de firma
    (Entregó / Recibí). El descuento en caja ocurre al registrar el movimiento;
    este comprobante lo documenta."""
    from reportlab.lib.pagesizes import letter  # noqa: F401
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as _canvas

    tc = (settings or {}).get("ticket_config", {}) or {}
    empresa = settings.get("empresa_nombre", "Grupo RYSA")

    tipo = (mov.get("tipo") or "").lower()
    titulos = {"retiro": "ENTREGA DE EFECTIVO", "entrada": "ENTRADA DE EFECTIVO",
               "gasto": "COMPROBANTE DE GASTO", "devolucion": "DEVOLUCIÓN"}
    titulo = titulos.get(tipo, "COMPROBANTE DE CAJA")

    W = 80 * mm
    margin = 6 * mm
    line = 11.5          # alto por línea de texto normal
    # Estimar altura dinámica del ticket.
    concepto_lines = _wrap_lines(mov.get("concepto") or "", W - 2 * margin - 4, 9)
    h = 26 * mm                     # encabezado empresa
    h += 8 * mm                     # título + línea punteada
    h += len(concepto_lines) * 4.2 * mm + 22 * mm   # cuerpo + montos
    h += 16 * mm                    # firmas
    h += 10 * mm                    # pie
    buf = io.BytesIO()
    c = _canvas.Canvas(buf, pagesize=(W, h))
    x = margin
    w = W - 2 * margin
    y = h - margin

    def txt(t, size=8.5, bold=False, align="left", dy=0):
        nonlocal y
        y -= (line if dy == 0 else dy)
        f = "Helvetica-Bold" if bold else "Helvetica"
        c.setFont(f, size)
        t = str(t)
        if align == "center":
            c.drawCentredString(W / 2, y, t)
        elif align == "right":
            c.drawRightString(x + w, y, t)
        else:
            c.drawString(x, y, t)

    def dashed():
        nonlocal y
        y -= 7
        c.setDash(2, 2)
        c.setLineWidth(0.5)
        c.line(x, y, x + w, y)
        c.setDash()
        y -= 5

    # --- Encabezado empresa ---
    txt(empresa, size=12, bold=True, align="center")
    sub = [settings.get("rfc") and f"RFC: {settings['rfc']}",
           settings.get("direccion"),
           settings.get("telefono") and f"Tel: {settings['telefono']}"]
    for s in filter(None, sub):
        txt(str(s), size=7, align="center", dy=line - 3)
    dashed()

    # --- Título ---
    txt(titulo, size=12.5, bold=True, align="center")
    y -= 4

    # --- Datos ---
    fecha = mov.get("fecha") or ""
    txt(f"Folio: {mov.get('folio') or '—'}", size=8.5, bold=True)
    txt(f"Fecha: {fecha[:10]}  Hora: {fecha[11:16]}", size=8.5)
    txt(f"Caja: {(caja or {}).get('caja_nombre') or '—'}", size=8.5)
    txt(f"Entregó: {mov.get('usuario_nombre') or '—'}", size=8.5)
    txt("Concepto:", size=8.5)
    for ln in concepto_lines:
        txt(ln, size=9, dy=10.5)
    if mov.get("referencia"):
        txt(f"Referencia: {mov.get('referencia')}", size=8.5)
    dashed()

    # --- Monto ---
    txt("MONTO", size=8, bold=True, align="center")
    monto_txt = _money(mov.get("monto"))
    c.setFont("Helvetica-Bold", 17)
    y -= 24
    c.drawCentredString(W / 2, y, monto_txt)
    if efectivo_en_caja is not None:
        txt(f"Efectivo en caja después: {_money(efectivo_en_caja)}",
            size=8, align="center", dy=20)
    dashed()

    # --- Firmas ---
    y -= 14
    c.setFont("Helvetica", 8)
    c.drawString(x + 2 * mm, y, "_______________")
    c.drawRightString(x + w - 2 * mm, y, "_______________")
    y -= 10
    c.drawString(x + 2 * mm, y, "Entregó")
    c.drawRightString(x + w - 2 * mm, y, "Recibí")

    # --- Pie ---
    pie = tc.get("pie") or "¡Gracias por su confianza!"
    txt(pie, size=7.5, align="center", dy=line + 4)

    c.showPage()
    c.save()
    return buf.getvalue()


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

    # ---- Lienzo y cursor se fijan por rama (carta fija · térmico dos pasadas) ----

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
        _apply_align(c, y, w, "DESCRIPCION", "center", 8, True)
        y -= line_h
        sep()
        for it in sale.get("items", []):
            desc_font = 9 if size == "carta" else 7
            max_text_w = w - 8 * mm
            for dl in _wrap_lines(it.get("descripcion", ""), max_text_w, desc_font):
                _apply_align(c, y, w, dl, "left", desc_font, False)
                y -= line_h
            cant = it.get("cantidad", 0)
            precio = it.get("precio", 0)
            unidad = str(it.get("unidad", "PZA"))
            importe = it.get("importe", it.get("importe_bruto", cant * precio - float(it.get("descuento", 0) or 0)))
            desc_un = it.get("descuento", 0)
            fe = f"  {int(cant)} {unidad}   {_money(precio)}  {_money(importe)}"
            for fl in _wrap_lines(fe, max_text_w, 7):
                _apply_align(c, y, w, fl, "left", 7, False)
                y -= line_h
            if float(desc_un or 0) > 0:
                _apply_align(c, y, w, f"    Descuento -{_money(desc_un)}", "left", 7, False)
                y -= line_h
            comentario = str(it.get("comentario", "") or "").strip()
            if comentario:
                for linea in comentario.splitlines():
                    for cl in _wrap_lines(f"    * {linea}", max_text_w, 7):
                        _apply_align(c, y, w, cl, "left", 7, False)
                        y -= line_h

    # Resolver variables de plantilla para texto/QR
    def fi(t):
        try:
            full_addr = " ".join(filter(None, [
                settings.get("direccion", ""),
                settings.get("ciudad", ""),
                settings.get("estado", ""),
                settings.get("cp", ""),
            ]))
            return (t or "").replace("{empresa}", empresa) \
                .replace("{verificar}", verificar_url()) \
                .replace("{direccion_completa}", full_addr) \
                .replace("{cip}", "").replace("{folio}", sale.get("folio", "")) \
                .replace("{cliente}", sale.get("cliente_nombre", "")) \
                .replace("{total}", _money(sale.get("total"))) \
                .replace("{fecha}", str(sale.get("fecha", ""))[:16].replace("T", " "))
        except Exception:
            return t or ""

    def _draw_all():
        """Dibuja todos los elementos sobre el lienzo/cursor actuales.
        Se ejecuta DOS veces en térmico: sondeo (medir alto exacto) y final."""
        nonlocal y
        for el in elements:
            if not _elem_visible(el):
                continue
            tipo = el.get("tipo", "texto")
            cont = fi(el.get("contenido"))
            align = el.get("align") or ("center" if size != "carta" else "left")
            bold = el.get("bold", False)
            fsz = el.get("font_size")
            try:
                if tipo == "logo":
                    # Logo con proporción real; usa el de Configuración o el asset
                    # oficial incluido en el proyecto.
                    p = logo_local(settings)
                    if p:
                        try:
                            iw, ih = ImageReader(p).getSize()
                            ar = (iw / float(ih)) if ih else 1.5
                            box_w, box_h = 22 * mm, 14 * mm
                            dw, dh = box_w, box_w / ar
                            if dh > box_h:
                                dh = box_h
                                dw = dh * ar
                            c.drawImage(ImageReader(p), w / 2 - dw / 2, y - dh, dw, dh,
                                        preserveAspectRatio=True, mask="auto")
                            y -= (dh + 3 * mm)
                        except Exception:
                            pass
                elif tipo == "qr":
                    import qrcode
                    from io import BytesIO
                    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M)
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
                elif tipo == "hora":
                    L(f"Hora: {sale.get('hora') or str(sale.get('fecha', ''))[11:16]}", sz=fsz)
                elif tipo == "cliente":
                    L(f"Cliente: {sale.get('cliente_nombre', 'Público General')}", sz=fsz)
                elif tipo == "articulos":
                    items_data = sale.get("items") or []
                    total_art = sum(float(it.get("cantidad", 0) or 0) for it in items_data)
                    L(f"Artículos vendidos: {int(total_art)}", sz=fsz)
                elif tipo == "atendio":
                    L(f"Atendido por: {sale.get('vendedor_nombre')}", sz=fsz)
                elif tipo == "items":
                    campos_items()
                elif tipo == "deschead":
                    _apply_align(c, y, w, "DESCRIPCION", "center", 8, True)
                    y -= line_h
                elif tipo == "subtotal":
                    L(f"Subtotal: {_money(sale.get('subtotal'))}", align=align, sz=fsz)
                elif tipo == "iva":
                    L(f"IVA: {_money(sale.get('iva_total'))}", align=align, sz=fsz)
                elif tipo == "descuento":
                    L(f"Descuento: -{_money(sale.get('descuento', sale.get('descuento_total'))) }", align=align, sz=fsz)
                elif tipo == "letras":
                    try:
                        L(f"({_num_a_letras(sale.get('total'))})", align="center", bold=True, sz=fsz or 8)
                    except Exception:
                        pass
                elif tipo == "recibido":
                    pagado = sum(float(p.get("monto", 0) or 0) for p in (sale.get("pagos") or []))
                    L(f"Recibido: {_money(pagado)}", align=align, sz=fsz)
                elif tipo == "cambio":
                    L(f"Cambio: {_money(sale.get('cambio'))}", align=align, sz=fsz)
                elif tipo == "total":
                    L(f"TOTAL: {_money(sale.get('total'))}", bold=True, align=align, sz=fsz or (12 if size == "carta" else 9))
                elif tipo == "credito":
                    L(f"** VENTA A CRÉDITO ** Saldo: {_money(sale.get('saldo'))}", align="center", sz=fsz)
                elif tipo == "pie" or tipo == "pie2":
                    L(cont if cont else tc.get("pie", "¡Gracias por su compra!"), align="center", sz=fsz)
            except Exception:
                # Nunca romper la generación del ticket por un bloque fallido.
                continue

    # fin _draw_all

    if size == "carta":
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=letter)
        w, h = letter
        x = 25 * mm
        y = h - 25 * mm
        line_h = 14
        _draw_all()
        c.showPage()
        c.save()
        buf.seek(0)
        return buf.read()

    # ---- TÉRMICO 80mm: DOS PASADAS --------------------------------------
    # Pasada 1 (sondeo): dibuja en un lienzo muy alto para medir el alto
    # EXACTO de UNA copia (logo, QR y wraps incluidos). Pasada 2: PDF final
    # con N copias (cliente y comercio) de ese alto exacto.
    width = 80 * mm
    x = 4 * mm
    line_h = 11
    item_font = 7
    n_items_lines = sum(_item_lines(it, width - 12 * mm, item_font)
                        for it in sale.get("items", []))
    est_h = (40 + n_items_lines + 30) * mm
    probe_h = int(est_h + 120 * mm)

    copias = max(1, int((tc or {}).get("copias", 2)))  # §3.4: cliente+comercio

    c = canvas.Canvas(io.BytesIO(), pagesize=(width, probe_h))
    w, h = width, probe_h
    y = probe_h - 8 * mm
    start_y = y
    _draw_all()
    copy_h = max(int(round((start_y - y) + 10 * mm)), int(40 * mm))
    page_h = copy_h * copias

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, page_h))
    w, h = width, page_h
    for idx in range(copias):
        y = h - 8 * mm - idx * copy_h
        if copias > 1:
            etiqueta = "— COPIA CLIENTE —" if idx == 0 else f"— COPIA COMERCIO —" if idx == 1 else f"— COPIA {idx + 1} —"
            _apply_align(c, y, w, etiqueta, "center", 6, True)
            y -= line_h
        _draw_all()
    c.showPage()
    c.save()
    buf.seek(0)
    return buf.read()
def _metodo_pago_label(pago: dict) -> str:
    """Etiqueta legible de un pago, incluida la tarjeta débito/crédito."""
    m = (pago or {}).get("metodo", "otros")
    nombres = {
        "efectivo": "Efectivo", "tarjeta": "Tarjeta", "transferencia": "Transferencia",
        "spei": "SPEI", "deposito": "Depósito", "otros": "Otro",
    }
    base = nombres.get(m, str(m).capitalize())
    if m == "tarjeta":
        ct = (pago or {}).get("card_type")
        if ct == "debito":
            base = "Tarjeta Débito"
        elif ct == "credito":
            base = "Tarjeta Crédito"
    return base


def build_letter_pdf(sale: dict, settings: dict, cliente: dict = None) -> bytes:
    """Comprobante comercial RYSA formato carta (Letter 8.5x11) con identidad
    RYSA: logo, datos de la empresa, documento, cliente, productos, totales y pie.
    NO es ticket térmico ampliado ni factura fiscal (el CFDI sigue su proceso)."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter, inch
    from reportlab.lib.units import mm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                    TableStyle, Image, HRFlowable)

    TERRA = colors.HexColor("#C1401E")
    INK = colors.HexColor("#1F1F1F")
    GRIS = colors.HexColor("#6B7280")
    CLARO = colors.HexColor("#F4ECE7")
    LINEA = colors.HexColor("#E5E0DA")

    def es(font="Helvetica", **kw):
        return ParagraphStyle("s", fontName=font, **kw)

    sEmpresa = es(font="Helvetica-Bold", fontSize=14, leading=17, textColor=INK)
    sRazon = es(fontSize=8.5, leading=12, textColor=GRIS)
    sCli = es(fontSize=9, leading=13, textColor=INK)
    sCliB = es(font="Helvetica-Bold", fontSize=9, leading=13, textColor=INK)
    sTitulo = es(font="Helvetica-Bold", fontSize=13, leading=16, textColor=TERRA)
    sAmt = es(fontSize=9.5, leading=14, textColor=INK, alignment=TA_RIGHT)
    sAmtL = es(fontSize=9.5, leading=14, textColor=INK, alignment=TA_LEFT)
    sAmtB = es(font="Helvetica-Bold", fontSize=12, leading=16, textColor=TERRA, alignment=TA_RIGHT)
    sPie = es(font="Helvetica-Bold", fontSize=11, leading=15, textColor=TERRA, alignment=TA_CENTER)
    sFoot = es(fontSize=8, leading=11, textColor=GRIS, alignment=TA_CENTER)
    sCel = es(fontSize=8, leading=11, textColor=INK)
    sCelR = es(fontSize=8, leading=11, textColor=INK, alignment=TA_RIGHT)
    sHead = es(font="Helvetica-Bold", fontSize=8.5, leading=11, textColor=colors.white)

    story = []

    # --- Encabezado: empresa (izq) + logo oficial (der, proporción real) ---
    logos = []
    lp = logo_local(settings)
    if lp:
        try:
            img = imagen_con_proporcion(lp, ancho_max_mm=40, alto_max_mm=26)
            if img is not None:
                logos.append(img)
        except Exception:
            logos = []
    emp_lines = [Paragraph("<b>" + (settings.get("empresa_nombre") or "Grupo RYSA") + "</b>", sEmpresa)]
    for lin in [settings.get("razon_social") or "",
                ("RFC: " + settings.get("rfc")) if settings.get("rfc") else "",
                settings.get("direccion") or "",
                ", ".join(filter(None, [settings.get("ciudad"), settings.get("estado"), settings.get("cp")])),
                ("Tel: " + settings.get("telefono")) if settings.get("telefono") else "",
                settings.get("correo") or ""]:
        if lin.strip():
            emp_lines.append(Paragraph(lin, sRazon))
    head = Table([[emp_lines, logos]], colWidths=[120 * mm, 45 * mm])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(head)
    story.append(HRFlowable(width="100%", thickness=2, color=TERRA, spaceBefore=6, spaceAfter=10))

    # --- Título + metadatos ---
    pagos = sale.get("pagos") or []
    metodo_txt = " + ".join(_metodo_pago_label(p) for p in pagos) if pagos else (
        "Crédito" if sale.get("condicion") == "credito" else "Contado")
    metas = [
        ("Folio", sale.get("folio") or ""),
        ("Fecha", str(sale.get("fecha") or "")[:10]),
        ("Hora", sale.get("hora") or ""),
        ("Vendedor", sale.get("vendedor_nombre") or sale.get("usuario_nombre") or ""),
        ("Método de pago", metodo_txt),
    ]
    if sale.get("sucursal_nombre"):
        metas.append(("Sucursal", sale["sucursal_nombre"]))
    meta_paras = [Paragraph("<b>%s:</b>&nbsp;%s" % (k, v), sCli) for k, v in metas]
    t_meta = Table([[Paragraph("DOCUMENTO DE VENTA", sTitulo)], [meta_paras]], colWidths=[None])
    t_meta.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))
    story.append(t_meta)
    story.append(HRFlowable(width="100%", thickness=0.6, color=LINEA, spaceBefore=4, spaceAfter=8))

    # --- Cliente ---
    cli_cells = [Paragraph("<b>Nombre / Razón social:</b> %s" % (
        (cliente or {}).get("nombre") or sale.get("cliente_nombre") or "Público General"), sCli)]
    if (cliente or {}).get("rfc"):
        cli_cells.append(Paragraph("<b>RFC:</b> %s" % cliente["rfc"], sCli))
    tel = (cliente or {}).get("telefono") or (cliente or {}).get("celular") or (cliente or {}).get("whatsapp")
    if tel:
        cli_cells.append(Paragraph("<b>Teléfono:</b> %s" % tel, sCli))
    email = (cliente or {}).get("correo") or (cliente or {}).get("correos")
    if email:
        cli_cells.append(Paragraph("<b>Email:</b> %s" % email, sCli))
    direc = ", ".join(filter(None, [(cliente or {}).get("direccion"), (cliente or {}).get("colonia"),
                                    (cliente or {}).get("ciudad"), (cliente or {}).get("estado_geo"),
                                    (cliente or {}).get("cp")]))
    if direc:
        cli_cells.append(Paragraph("<b>Dirección:</b> %s" % direc, sCli))
    cliTit = Paragraph("CLIENTE", es(font="Helvetica-Bold", fontSize=9, leading=12, textColor=TERRA))
    t_cli = Table([[cliTit], [cli_cells]], colWidths=[None])
    t_cli.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), CLARO),
        ("BOX", (0, 0), (-1, -1), 0.6, LINEA),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t_cli)
    story.append(Spacer(1, 8))

    # --- Productos ---
    head_row = [Paragraph("<b>%s</b>" % h, sHead) for h in ["Código", "Descripción", "Und.", "Cant.", "Precio", "Importe"]]
    rows = [head_row]
    for it in (sale.get("items") or []):
        cant = it.get("cantidad")
        precio = it.get("precio_bruto") if it.get("precio_bruto") is not None else it.get("precio",
            it.get("precio_neto"))
        importe = it.get("importe_bruto")
        if importe is None:
            importe = float(cant or 0) * float(precio or 0) - float(it.get("descuento", 0) or 0)
        desc = ""
        if float(it.get("descuento", 0) or 0) > 0:
            desc = '<font color="#C1401E"><br/><small>desc %s</small></font>' % _money(it.get("descuento"))
        rows.append([
            Paragraph(str(it.get("codigo") or ""), sCel),
            Paragraph(("%s" % (it.get("descripcion") or "")) + desc, sCel),
            Paragraph(str(it.get("unidad") or ""), sCel),
            Paragraph(str(cant), sCelR),
            Paragraph(_money(precio), sCelR),
            Paragraph(_money(importe), sCelR),
        ])
    colW = [20 * mm, 74 * mm, 12 * mm, 16 * mm, 28 * mm, 32 * mm]
    t_items = Table(rows, colWidths=colW, repeatRows=1)
    t_items.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TERRA),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 1), (-1, -1), 0.4, LINEA),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t_items)
    story.append(Spacer(1, 6))

    # --- Totales (derecha) ---
    tot_rows = []
    if sale.get("subtotal") is not None:
        tot_rows.append([Paragraph("Subtotal:", sAmtL), Paragraph(_money(sale.get("subtotal")), sAmt)])
    if float(sale.get("descuento_total", 0) or 0) > 0:
        tot_rows.append([Paragraph('<font color="#C1401E">Descuento:</font>', sAmtL),
                         Paragraph('<font color="#C1401E">-%s</font>' % _money(sale.get("descuento_total")), sAmt)])
    if float(sale.get("iva_total", 0) or 0) > 0:
        tot_rows.append([Paragraph("IVA:", sAmtL), Paragraph(_money(sale.get("iva_total")), sAmt)])
    tot_rows.append([Paragraph("TOTAL:", sAmtB), Paragraph(_money(sale.get("total")), sAmtB)])
    if sale.get("condicion") == "credito":
        tot_rows.append([Paragraph('<font color="#dc2626">Saldo pendiente:</font>', sAmtL),
                         Paragraph('<font color="#dc2626">%s</font>' % _money(sale.get("saldo")), sAmt)])
    t_tot = Table(tot_rows, colWidths=[110 * mm, 40 * mm])
    t_tot.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, 0), "LEFT"),
        ("LINEABOVE", (0, len(tot_rows) - 1), (1, len(tot_rows) - 1), 1.2, TERRA),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(Table([[t_tot]], colWidths=[None], hAlign="RIGHT"))

    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=0.6, color=LINEA, spaceBefore=6, spaceAfter=10))

    # --- Observaciones + pie ---
    obs = sale.get("observaciones") or ""
    if obs:
        story.append(Paragraph("<b>OBSERVACIONES</b>", es(font="Helvetica-Bold", fontSize=9, textColor=INK)))
        story.append(Paragraph(str(obs)[:120], sCli))
        story.append(Spacer(1, 8))
    story.append(Paragraph("¡GRACIAS POR SU PREFERENCIA!", sPie))
    story.append(Paragraph(("%s · RFC: %s" % ((settings.get("empresa_nombre") or "Grupo RYSA"),
                                              (settings.get("rfc") or ""))).strip(" ·"), sFoot))
    if sale.get("id"):
        base_url = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
        ver = (base_url + "/verificar/" + sale["id"]) if base_url else ("/api/sales/%s/public" % sale["id"])
        story.append(Paragraph("Verifica tu comprobante en: %s" % ver, sFoot))

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=16 * mm, rightMargin=16 * mm,
                            topMargin=18 * mm, bottomMargin=16 * mm, title="Comprobante RYSA",
                            author="Grupo RYSA")
    doc.build(story)
    buf.seek(0)
    return buf.read()

def _metodo_abono_label(abono: dict) -> str:
    m = (abono or {}).get("metodo", "otros")
    nombres = {
        "efectivo": "Efectivo", "tarjeta": "Tarjeta", "transferencia": "Transferencia",
        "spei": "SPEI", "deposito": "Depósito", "otros": "Otro",
    }
    return nombres.get(m, str(m).capitalize())


def build_abono_pdf(abono: dict, settings: dict, cliente: dict = None) -> bytes:
    """Comprobante de ABONO a cuenta por cobrar (formato carta Letter 8.5x11)
    con identidad RYSA. Independiente de una venta: folio AB-xxxxx."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import mm
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                    TableStyle, Image, HRFlowable)

    TERRA = colors.HexColor("#C1401E")
    INK = colors.HexColor("#1F1F1F")
    GRIS = colors.HexColor("#6B7280")
    CLARO = colors.HexColor("#F4ECE7")
    LINEA = colors.HexColor("#E5E0DA")

    def es(font="Helvetica", **kw):
        return ParagraphStyle("s", fontName=font, **kw)

    sEmpresa = es(font="Helvetica-Bold", fontSize=14, leading=17, textColor=INK)
    sRazon = es(fontSize=8.5, leading=12, textColor=GRIS)
    sCli = es(fontSize=9.5, leading=14, textColor=INK)
    sTitulo = es(font="Helvetica-Bold", fontSize=13, leading=16, textColor=TERRA)
    sMeta = es(fontSize=9.5, leading=14, textColor=INK)
    sAmt = es(fontSize=10.5, leading=15, textColor=INK, alignment=TA_RIGHT)
    sAmtL = es(fontSize=10.5, leading=15, textColor=INK, alignment=TA_LEFT)
    sAmtB = es(font="Helvetica-Bold", fontSize=13, leading=18, textColor=TERRA, alignment=TA_RIGHT)
    sPie = es(font="Helvetica-Bold", fontSize=11, leading=15, textColor=TERRA, alignment=TA_CENTER)
    sFoot = es(fontSize=8, leading=11, textColor=GRIS, alignment=TA_CENTER)
    sCel = es(fontSize=9.5, leading=13, textColor=INK)

    story = []

    # --- Encabezado ---
    logos = []
    # Logo oficial: el de Configuración, o el isotipo RYSA empaquetado.
    lu = settings.get("logo_url") or ""
    logo_src = None
    if lu and "/api/files/" in lu:
        try:
            lp = get_safe_local_path(lu.split("/api/files/", 1)[1])
            if os.path.isfile(lp):
                logo_src = lp
        except Exception:
            logo_src = None
    if logo_src is None:
        # Respaldo: logotipo oficial pre-cargado en backend/brand/
        # (__file__ = <backend>/storage.py -> dirname + /brand/logotipo.png)
        for cand in (os.path.join(os.path.dirname(__file__), "brand", "logotipo.png"),
                     os.path.join(os.getcwd(), "brand", "logotipo.png")):
            cand = os.path.abspath(cand)
            if os.path.isfile(cand):
                logo_src = cand
                break
    try:
        if logo_src:
            logos.append(Image(logo_src, width=34 * mm, height=24 * mm))
    except Exception:
        logos = []
    emp_lines = [Paragraph("<b>" + (settings.get("empresa_nombre") or "Grupo RYSA") + "</b>", sEmpresa)]
    for lin in [settings.get("razon_social") or "",
                ("RFC: " + settings.get("rfc")) if settings.get("rfc") else "",
                settings.get("direccion") or "",
                ", ".join(filter(None, [settings.get("ciudad"), settings.get("estado"), settings.get("cp")])),
                ("Tel: " + settings.get("telefono")) if settings.get("telefono") else "",
                settings.get("correo") or ""]:
        if lin.strip():
            emp_lines.append(Paragraph(lin, sRazon))
    head = Table([[emp_lines, logos]], colWidths=[120 * mm, 40 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                              ("LEFTPADDING", (0, 0), (-1, -1), 0),
                              ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                              ("TOPPADDING", (0, 0), (-1, -1), 0),
                              ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.append(head)
    story.append(HRFlowable(width="100%", thickness=2, color=TERRA, spaceBefore=6, spaceAfter=10))

    # --- Título + folio/fecha/hora ---
    fec = str(abono.get("fecha") or "")
    fecha = fec[:10]
    hora = fec[11:16]
    sTituloBand = es(font="Helvetica-Bold", fontSize=15, leading=18, textColor=colors.white, alignment=TA_CENTER)
    title_band = Table([[Paragraph("COMPROBANTE DE ABONO", sTituloBand)]], colWidths=[None])
    title_band.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), TERRA),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(title_band)
    story.append(Spacer(1, 6))
    meta = [
        Paragraph("<b>Folio:</b> %s&nbsp;&nbsp;&nbsp;<b>Fecha:</b> %s&nbsp;&nbsp;&nbsp;<b>Hora:</b> %s" % (
            abono.get("folio", ""), fecha, hora), sMeta),
        Paragraph("<b>Usuario:</b> %s&nbsp;&nbsp;&nbsp;<b>Sucursal:</b> %s" % (
            abono.get("usuario_nombre") or "",
            (settings.get("sucursales") or [{}])[0].get("nombre", "") if settings.get("sucursales") else "")),
    ]
    story.append(Table([[meta[0]], [meta[1]]], colWidths=[None]))
    story.append(HRFlowable(width="100%", thickness=0.6, color=LINEA, spaceBefore=6, spaceAfter=10))

    # --- Cliente ---
    cli_txt = ((cliente or {}).get("nombre")) or (abono.get("cliente_nombre") or "")
    apps = abono.get("aplicaciones") or []
    documento = apps[0].get("folio", "CxC") if apps else "CxC"
    cli_cells = [
        Paragraph("<b>Cliente:</b> %s" % cli_txt, sCel),
        Paragraph("<b>Documento:</b> %s" % documento, sCel),
    ]
    t_cli = Table([[Paragraph("CLIENTE", es(font="Helvetica-Bold", fontSize=9, leading=12, textColor=TERRA))], [cli_cells]], colWidths=[None])
    t_cli.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), CLARO),
                               ("BOX", (0, 0), (-1, -1), 0.6, LINEA),
                               ("LEFTPADDING", (0, 0), (-1, -1), 6),
                               ("TOPPADDING", (0, 0), (-1, -1), 3),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.append(t_cli)
    story.append(Spacer(1, 12))

    # --- Totales del abono ---
    rows = [
        [Paragraph("Saldo anterior:", sAmtL), Paragraph(_money(abono.get("saldo_anterior")), sAmt)],
        [Paragraph("<b>ABONO:</b>", es(font="Helvetica-Bold", fontSize=11, textColor=TERRA, alignment=TA_LEFT)),
         Paragraph("<b>%s</b>" % _money(abono.get("monto")), es(font="Helvetica-Bold", fontSize=13, textColor=TERRA, alignment=TA_RIGHT))],
        [Paragraph("<b>SALDO RESTANTE:</b>", es(font="Helvetica-Bold", fontSize=11, textColor=INK, alignment=TA_LEFT)),
         Paragraph("<b>%s</b>" % _money(abono.get("saldo_restante")), es(font="Helvetica-Bold", fontSize=13, textColor=INK, alignment=TA_RIGHT))],
        [Paragraph("Método:", sAmtL), Paragraph(_metodo_abono_label(abono), sAmt)],
    ]
    if abono.get("referencia"):
        rows.append([Paragraph("Referencia:", sAmtL), Paragraph(str(abono["referencia"]), sAmt)])
    t = Table(rows, colWidths=[110 * mm, 40 * mm])
    t.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, 0), "LEFT"),
        ("LINEABOVE", (0, 2), (1, 2), 1.2, TERRA),
        ("LINEBELOW", (0, 1), (1, 1), 0.6, LINEA),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(Table([[t]], colWidths=[None], hAlign="CENTER"))
    story.append(Spacer(1, 20))

    story.append(Spacer(1, 8))
    sPieFooter = es(font="Helvetica-Bold", fontSize=8.5, leading=12, textColor=colors.white, alignment=TA_CENTER)
    footer_band = Table([[Paragraph("¡GRACIAS POR SU PAGO!", sPie)], [
        Paragraph((settings.get("empresa_nombre") or "Grupo RYSA") + " · RFC: " + (settings.get("rfc") or ""), sPieFooter)]],
        colWidths=[None])
    footer_band.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TERRA),
        ("BACKGROUND", (0, 1), (-1, 1), INK),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(footer_band)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=16 * mm, rightMargin=16 * mm,
                            topMargin=18 * mm, bottomMargin=16 * mm, title="Comprobante de Abono RYSA",
                            author="Grupo RYSA")
    doc.build(story)
    buf.seek(0)
    return buf.read()


def build_compra_pdf(compra: dict, settings: dict, proveedor: dict = None) -> bytes:
    """Genera un comprobante PDF (formato carta) de una compra/gasto.

    Muestra proveedor, datos de la factura, tabla de conceptos, totales y
    costos adicionales (flete/seguro/maníobras/otros)."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT
    from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle,
                                    Paragraph, Spacer, Image, HRFlowable)

    TERRA = colors.HexColor("#C1401E")
    INK = colors.HexColor("#1F1F1F")
    GRIS = colors.HexColor("#6B7280")
    LINEA = colors.HexColor("#E5E0DA")
    CLARO = colors.HexColor("#FDF4F0")

    st = getSampleStyleSheet()
    def es(font="Helvetica", size=9, leading=12, color=INK, bold=False, align=TA_LEFT):
        return ParagraphStyle("s", fontName=("Helvetica-Bold" if bold else font),
                              fontSize=size, leading=leading, textColor=color, alignment=align)
    sTitulo = es("Helvetica-Bold", 15, 18, TERRA)
    sEmpresa = es("Helvetica-Bold", 12, 15, INK)
    sMeta = es("Helvetica", 9, 13, INK)
    sCli = es("Helvetica", 9, 13, INK)
    sHead = es("Helvetica-Bold", 8, 10, colors.white)
    sCel = es("Helvetica", 8, 10, INK)
    sCelR = es("Helvetica", 8, 10, INK, align=TA_RIGHT)
    sAmt = es("Helvetica-Bold", 9, 12, INK, align=TA_RIGHT)
    sAmtL = es("Helvetica", 9, 12, INK, align=TA_LEFT)
    sPie = es("Helvetica-Bold", 9, 12, INK, align=TA_CENTER)

    story = []

    # Encabezado empresa + logo
    logos_left = []
    lu = settings.get("logo_url") or ""
    if lu and "/api/files/" in lu:
        try:
            lp = get_safe_local_path(lu.split("/api/files/", 1)[1])
            if os.path.isfile(lp):
                logos_left.append(Image(lp, width=34 * mm, height=24 * mm))
        except Exception:
            logos_left = []
    if not logos_left:
        logos_left.append(Paragraph("", sMeta))
    emp_lines = [Paragraph("<b>%s</b>" % (settings.get("empresa_nombre") or "Grupo RYSA"), sEmpresa)]
    if settings.get("razon_social"):
        emp_lines.append(Paragraph(settings["razon_social"], sMeta))
    for f, v in [("RFC", settings.get("rfc")), ("Tel", settings.get("telefono")), ("Correo", settings.get("correo"))]:
        if v:
            emp_lines.append(Paragraph("%s: %s" % (f, v), sMeta))
    dir_txt = ", ".join(filter(None, [settings.get("direccion"), settings.get("ciudad"),
                                      settings.get("estado"), settings.get("cp")]))
    if dir_txt:
        emp_lines.append(Paragraph(dir_txt, sMeta))
    head = Table([[logos_left, emp_lines]], colWidths=[48 * mm, None])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                              ("LEFTPADDING", (0, 0), (-1, -1), 0),
                              ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(head)
    story.append(HRFlowable(width="100%", thickness=2, color=TERRA, spaceBefore=6, spaceAfter=8))

    # Título + metadatos
    story.append(Paragraph("COMPROBANTE DE COMPRA", sTitulo))
    tipo_txt = {"compra": "Compra", "gasto": "Gasto", "mixto": "Compra y gasto"}.get(compra.get("tipo"), compra.get("tipo", ""))
    metas = [
        Paragraph("<b>Folio:</b> %s&nbsp;&nbsp;&nbsp;<b>Tipo:</b> %s" % (compra.get("folio", ""), tipo_txt), sMeta),
        Paragraph("<b>Fecha recepción:</b> %s&nbsp;&nbsp;&nbsp;<b>Factura:</b> %s" % (
            (compra.get("fecha_recepcion") or "")[:10], compra.get("factura_numero") or "—"), sMeta),
        Paragraph("<b>Proveedor:</b> %s" % ((proveedor or compra).get("nombre") or compra.get("proveedor_nombre") or "—"), sMeta),
    ]
    story.append(Table([[m] for m in metas], colWidths=[None]))
    story.append(HRFlowable(width="100%", thickness=0.6, color=LINEA, spaceBefore=6, spaceAfter=8))

    # Proveedor block
    prov_cells = []
    p = proveedor or {}
    prov_cells.append(Paragraph("<b>%s</b>" % (compra.get("proveedor_nombre") or p.get("nombre") or "—"), sCli))
    if p.get("rfc"):
        prov_cells.append(Paragraph("<b>RFC:</b> %s" % p["rfc"], sCli))
    for lbl, key in [("Teléfono", "telefono"), ("Email", "email"), ("Dirección", "direccion")]:
        if p.get(key):
            prov_cells.append(Paragraph("<b>%s:</b> %s" % (lbl, p[key]), sCli))
    t_prov = Table([[Paragraph("PROVEEDOR", es("Helvetica-Bold", 9, 12, TERRA))], [prov_cells]], colWidths=[None])
    t_prov.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), CLARO),
                                ("BOX", (0, 0), (-1, -1), 0.6, LINEA),
                                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                                ("TOPPADDING", (0, 0), (-1, -1), 3),
                                ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.append(t_prov)
    story.append(Spacer(1, 8))

    # Conceptos / items
    head_row = [Paragraph("<b>%s</b>" % h, sHead) for h in ["Código", "Descripción", "Und.", "Cant.", "Costo", "Importe"]]
    rows = [head_row]
    for it in (compra.get("items") or []):
        cant = it.get("cantidad", 0)
        costo = it.get("costo", 0)
        importe = it.get("importe") if it.get("importe") is not None else float(cant or 0) * float(costo or 0)
        rows.append([
            Paragraph(str(it.get("codigo") or ""), sCel),
            Paragraph(str(it.get("descripcion") or ""), sCel),
            Paragraph(str(it.get("unidad") or ""), sCel),
            Paragraph(str(cant), sCelR),
            Paragraph(_money(costo), sCelR),
            Paragraph(_money(importe), sCelR),
        ])
    colW = [22 * mm, 78 * mm, 14 * mm, 18 * mm, 26 * mm, 32 * mm]
    t_items = Table(rows, colWidths=colW, repeatRows=1)
    t_items.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TERRA),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 1), (-1, -1), 0.4, LINEA),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t_items)
    story.append(Spacer(1, 6))

    # Totales
    tot_rows = []
    if compra.get("subtotal") is not None:
        tot_rows.append([Paragraph("Subtotal:", sAmtL), Paragraph(_money(compra.get("subtotal")), sAmt)])
    if float(compra.get("descuento", 0) or 0) > 0:
        tot_rows.append([Paragraph('<font color="#C1401E">Descuento:</font>', sAmtL),
                         Paragraph('<font color="#C1401E">-%s</font>' % _money(compra.get("descuento")), sAmt)])
    if float(compra.get("iva", 0) or 0) > 0:
        tot_rows.append([Paragraph("IVA:", sAmtL), Paragraph(_money(compra.get("iva")), sAmt)])
    if float(compra.get("otros_impuestos", 0) or 0) > 0:
        tot_rows.append([Paragraph("Otros impuestos:", sAmtL), Paragraph(_money(compra.get("otros_impuestos")), sAmt)])
    # Costos adicionales
    ca = (compra.get("costos_adicionales") or {}) or {}
    for k, lbl in [("flete", "Flete"), ("seguro", "Seguro"), ("maniobras", "Maniobras"),
                   ("transporte", "Transporte"), ("otros", "Otros costos")]:
        if float(ca.get(k, 0) or 0) > 0:
            tot_rows.append([Paragraph("%s:" % lbl, sAmtL), Paragraph(_money(ca[k]), sAmt)])
    if float(ca.get("total", 0) or 0) > 0:
        tot_rows.append([Paragraph("Costos adicionales:", sAmtL), Paragraph(_money(ca["total"]), sAmt)])
    tot_rows.append([Paragraph("TOTAL:", es("Helvetica-Bold", 10, 13, INK)),
                     Paragraph(_money(compra.get("total")), es("Helvetica-Bold", 10, 13, INK, align=TA_RIGHT))])
    if float(compra.get("saldo_pendiente", 0) or 0) > 0:
        tot_rows.append([Paragraph('<font color="#dc2626">Saldo pendiente:</font>', sAmtL),
                         Paragraph('<font color="#dc2626">%s</font>' % _money(compra.get("saldo_pendiente")), sAmt)])
    t_tot = Table(tot_rows, colWidths=[110 * mm, 40 * mm])
    t_tot.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(Table([[t_tot]], colWidths=[None], hAlign="RIGHT"))
    story.append(Spacer(1, 12))

    obs = compra.get("observaciones") or ""
    if obs:
        story.append(Paragraph("<b>OBSERVACIONES</b>", es("Helvetica-Bold", 9, 12, INK)))
        story.append(Paragraph(str(obs), sCli))
        story.append(Spacer(1, 8))
    story.append(Paragraph(("Registró: %s" % (compra.get("usuario_nombre") or "")), es("Helvetica", 8, 11, GRIS)))
    if compra.get("documentos"):
        story.append(Paragraph("Documentos adjuntos: %d" % len(compra.get("documentos") or []), es("Helvetica", 8, 11, GRIS)))
    story.append(Spacer(1, 16))
    story.append(Paragraph("¡GRACIAS POR SU PREFERENCIA!", sPie))

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=16 * mm, rightMargin=16 * mm,
                            topMargin=18 * mm, bottomMargin=16 * mm, title="Comprobante de Compra RYSA",
                            author="Grupo RYSA")
    doc.build(story)
    buf.seek(0)
    return buf.read()


def build_cotizacion_pdf(sale: dict, settings: dict, cliente: dict = None,
                         cuentas: list = None, pago_url: str = "") -> bytes:
    """COTIZACIÓN oficial RYSA — PDF tamaño carta con DOS hojas:
    Hoja 1: logotipo grande a la IZQUIERDA + datos de empresa debajo a la
            izquierda, folio/fechas/condición a la derecha, cliente completo,
            partidas con % descuento, totales con IVA y total en letra, pie de
            firma del vendedor y QR para enviar comprobante de pago.
    Hoja 2 (solo si existen): cuentas bancarias ACTIVAS para pago.
    Identidad visual RYSA (terracota #C1401E). NO es ticket térmico."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import mm
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                    TableStyle, Image, HRFlowable, PageBreak)

    TERRA = colors.HexColor("#C1401E")
    INK = colors.HexColor("#1F1F1F")
    GRIS = colors.HexColor("#6B7280")
    CLARO = colors.HexColor("#F4ECE7")
    LINEA = colors.HexColor("#E5E0DA")

    def es(font="Helvetica", **kw):
        return ParagraphStyle("s", fontName=font, **kw)

    sEmpN = es(font="Helvetica-Bold", fontSize=13, leading=16, textColor=TERRA, alignment=TA_RIGHT)
    sEmpL = es(fontSize=8.5, leading=12, textColor=GRIS, alignment=TA_RIGHT)
    sTitulo = es(font="Helvetica-Bold", fontSize=17, leading=20, textColor=TERRA)
    sMetaR = es(fontSize=9.5, leading=14, textColor=INK, alignment=TA_RIGHT)
    sCli = es(fontSize=9, leading=13, textColor=INK)
    sCel = es(fontSize=8, leading=11, textColor=INK)
    sCelR = es(fontSize=8, leading=11, textColor=INK, alignment=TA_RIGHT)
    sCelC = es(fontSize=8, leading=11, textColor=INK, alignment=TA_CENTER)
    sHead = es(font="Helvetica-Bold", fontSize=8.5, leading=11, textColor=colors.white)
    sAmtL = es(fontSize=9.5, leading=14, textColor=INK)
    sAmt = es(fontSize=9.5, leading=14, textColor=INK, alignment=TA_RIGHT)
    sTotB = es(font="Helvetica-Bold", fontSize=13, leading=17, textColor=TERRA, alignment=TA_RIGHT)
    sLetras = es(font="Helvetica-Oblique", fontSize=8.5, leading=12, textColor=GRIS)
    sFoot = es(fontSize=7.5, leading=10, textColor=GRIS, alignment=TA_CENTER)
    sFirma = es(fontSize=9.5, leading=13, textColor=INK, alignment=TA_CENTER)

    story = []

    # --- Encabezado: EMPRESA a la IZQUIERDA (logo grande encima) + folio/fechas derecha ---
    logos = []
    lp = logo_local(settings)
    if lp:
        try:
            img = imagen_con_proporcion(lp, ancho_max_mm=52, alto_max_mm=30)
            if img is not None:
                logos.append(img)
        except Exception:
            logos = []
    sEmpIzq = es(font="Helvetica-Bold", fontSize=13.5, leading=17, textColor=TERRA)
    sEmpLin = es(fontSize=9, leading=12.5, textColor=INK)
    emp_lines = [Paragraph("<b>%s</b>" % (settings.get("empresa_nombre") or "Grupo RYSA"), sEmpIzq)]
    for lin in [
        settings.get("direccion") or "",
        ", ".join(filter(None, [settings.get("ciudad"), settings.get("estado")])),
        settings.get("pais") or "México",
        " ".join(filter(None, [settings.get("colonia"),
                               ("C.P. %s" % settings["cp"]) if settings.get("cp") else ""])),
        ("RFC: %s" % settings.get("rfc")) if settings.get("rfc") else "",
        ("Tel: %s" % settings.get("telefono")) if settings.get("telefono") else "",
    ]:
        if lin.strip():
            emp_lines.append(Paragraph(lin, sEmpLin))
    empresa_block = (logos or []) + [Spacer(1, 4)] + emp_lines
    cond_txt = "Crédito" if sale.get("condicion") == "credito" else "Contado"
    venc = str(sale.get("fecha_vencimiento") or "")[:10]
    meta_right = [
        Paragraph("<b>FOLIO:</b> <font color='#C1401E'><b>%s</b></font>" % sale.get("folio", ""), sMetaR),
        Paragraph("<b>Fecha de emisión:</b> %s" % str(sale.get("fecha") or "")[:10], sMetaR),
        Paragraph("<b>Fecha de vencimiento:</b> %s" % (venc or "—"), sMetaR),
        Paragraph("<b>Condición:</b> %s" % cond_txt, sMetaR),
    ]
    head = Table([[empresa_block, meta_right]], colWidths=[100 * mm, 86 * mm])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(head)
    story.append(HRFlowable(width="100%", thickness=2.2, color=TERRA, spaceBefore=6, spaceAfter=8))
    story.append(Paragraph("COTIZACIÓN", sTitulo))
    story.append(HRFlowable(width="100%", thickness=0.6, color=LINEA, spaceBefore=3, spaceAfter=8))

    # --- Cliente: nombre + dirección fiscal completa ---
    cli = cliente or {}
    dir_linea = "<b>Calle:</b> %s" % (cli.get("direccion") or sale.get("cliente_direccion") or "—")
    cli_cells = [
        Paragraph("<b>Nombre / Razón social:</b> %s" % (
            cli.get("nombre") or sale.get("cliente_nombre") or "Público General"), sCli),
        Paragraph(dir_linea, sCli),
    ]
    fila2 = []
    if cli.get("colonia"):
        fila2.append("<b>Colonia:</b> %s" % cli["colonia"])
    if cli.get("cp"):
        fila2.append("<b>C.P.:</b> %s" % cli["cp"])
    if fila2:
        cli_cells.append(Paragraph("&nbsp;&nbsp;|&nbsp;&nbsp;".join(fila2), sCli))
    fila3 = []
    if cli.get("ciudad"):
        fila3.append("<b>Localidad:</b> %s" % cli["ciudad"])
    if cli.get("municipio"):
        fila3.append("<b>Municipio:</b> %s" % cli["municipio"])
    if cli.get("estado_geo"):
        fila3.append("<b>Estado:</b> %s" % cli["estado_geo"])
    if fila3:
        cli_cells.append(Paragraph("&nbsp;&nbsp;|&nbsp;&nbsp;".join(fila3), sCli))
    if cli.get("rfc"):
        cli_cells.append(Paragraph("<b>RFC:</b> %s" % cli["rfc"], sCli))
    tel = cli.get("telefono")
    if tel:
        cli_cells.append(Paragraph("<b>Teléfono:</b> %s" % tel, sCli))
    t_cli = Table([[
        Paragraph("CLIENTE", es(font="Helvetica-Bold", fontSize=9, leading=12, textColor=TERRA)),
    ], [cli_cells]], colWidths=[None])
    t_cli.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), CLARO),
        ("BOX", (0, 0), (-1, -1), 0.6, LINEA),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t_cli)
    story.append(Spacer(1, 8))

    # --- Partidas: Cant | Unidad | Código | Descripción | %Desc | P.Unit | Importe ---
    head_row = [Paragraph("<b>%s</b>" % h, sHead) for h in
                ["Cant.", "Unidad", "Código", "Descripción", "% Desc.", "P. Unitario", "Importe"]]
    rows = [head_row]
    for it in (sale.get("items") or []):
        cant = float(it.get("cantidad") or 0)
        precio = it.get("precio_bruto") if it.get("precio_bruto") is not None else \
            it.get("precio", it.get("precio_neto"))
        importe = it.get("importe_bruto")
        if importe is None:
            importe = cant * float(precio or 0) - float(it.get("descuento", 0) or 0)
        base = cant * float(precio or 0)
        pct_desc = ""
        if base > 0 and float(it.get("descuento", 0) or 0) > 0:
            pct_desc = "%.1f%%" % round(float(it["descuento"]) / base * 100, 1)
        rows.append([
            Paragraph(str(it.get("cantidad")), sCelR),
            Paragraph(str(it.get("unidad") or ""), sCelC),
            Paragraph(str(it.get("codigo") or ""), sCel),
            Paragraph(str(it.get("descripcion") or ""), sCel),
            Paragraph(pct_desc, sCelC),
            Paragraph(_money(precio), sCelR),
            Paragraph(_money(importe), sCelR),
        ])
    colW = [15 * mm, 15 * mm, 22 * mm, 63 * mm, 14 * mm, 24 * mm, 25 * mm]
    t_items = Table(rows, colWidths=colW, repeatRows=1)
    t_items.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TERRA),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 1), (-1, -1), 0.4, LINEA),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t_items)
    story.append(Spacer(1, 6))

    # --- Totales + total en letra ---
    tasas = sorted({float(i.get("iva_tasa", 0) or 0) for i in (sale.get("items") or [])
                    if float(i.get("iva_tasa", 0) or 0) > 0})
    iva_label = ("IVA (%s):" % ("%".join(("%g" % t) for t in tasas))) if tasas else "IVA:"
    tot_rows = []
    if sale.get("subtotal") is not None:
        tot_rows.append([Paragraph("Subtotal:", sAmtL), Paragraph(_money(sale.get("subtotal")), sAmt)])
    if float(sale.get("descuento_total", 0) or 0) > 0:
        tot_rows.append([Paragraph('<font color="#C1401E">Descuento:</font>', sAmtL),
                         Paragraph('<font color="#C1401E">-%s</font>' % _money(sale.get("descuento_total")), sAmt)])
    if float(sale.get("iva_total", 0) or 0) > 0:
        tot_rows.append([Paragraph(iva_label, sAmtL), Paragraph(_money(sale.get("iva_total")), sAmt)])
    tot_rows.append([Paragraph("TOTAL:", sTotB), Paragraph(_money(sale.get("total")), sTotB)])
    t_tot = Table(tot_rows, colWidths=[112 * mm, 42 * mm])
    t_tot.setStyle(TableStyle([
        ("LINEABOVE", (0, len(tot_rows) - 1), (1, len(tot_rows) - 1), 1.4, TERRA),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(Table([[t_tot]], colWidths=[None], hAlign="RIGHT"))
    story.append(Spacer(1, 4))
    story.append(Paragraph("Son: <b>(%s)</b>" % _num_a_letras(sale.get("total")), sLetras))

    # --- Pie de firma ---
    story.append(Spacer(1, 34))
    vendedor = sale.get("vendedor_nombre") or sale.get("usuario_nombre") or ""
    firma = Table([
        [Paragraph("_" * 38, sFirma)],
        [Paragraph("Atentamente", sFirma)],
        [Paragraph("<b>%s</b>" % vendedor, sFirma)],
    ], colWidths=[None])
    firma.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    story.append(firma)
    story.append(Spacer(1, 14))
    nota = "Esta cotización es válida hasta el %s. Precios sujetos a cambio sin previo aviso." % (venc or "la fecha de vigencia indicada")
    story.append(HRFlowable(width="100%", thickness=0.6, color=LINEA, spaceBefore=6, spaceAfter=6))
    story.append(Paragraph(nota, sFoot))
    story.append(Paragraph("%s · RFC: %s · Tel: %s" % (
        settings.get("empresa_nombre") or "Grupo RYSA", settings.get("rfc") or "-",
        settings.get("telefono") or "-"), sFoot))

    # --- QR "¿Ya realizaste tu pago?" (§17): margen blanco, sin deformar ---
    if pago_url:
        try:
            import qrcode as _qrcode
            qr_img = _qrcode.make(pago_url, box_size=10, border=3)
            bq = io.BytesIO()
            qr_img.save(bq, format="PNG")
            bq.seek(0)
            qr_cell = Image(bq, width=27 * mm, height=27 * mm)  # cuadrado: no se deforma
            caption = [
                Paragraph("<b>¿Ya realizaste tu pago?</b>", es(font="Helvetica-Bold", fontSize=10, leading=13, textColor=INK)),
                Paragraph("Escanea este código para enviar tu comprobante.", es(fontSize=8.5, leading=12, textColor=GRIS)),
            ]
            t_qr = Table([[qr_cell, caption]], colWidths=[36 * mm, None])
            t_qr.setStyle(TableStyle([
                ("BOX", (0, 0), (-1, -1), 0.9, LINEA),
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            story.append(Spacer(1, 10))
            story.append(t_qr)
        except Exception:
            pass

    # --- HOJA 2: cuentas bancarias activas (se omite si no hay) ---
    import bancos as _bancos
    cuentas = cuentas or []
    if cuentas:
        story.append(PageBreak())
        story.append(Table([[logos or [Paragraph("", sCel)],
                             [Paragraph("<b>FORMAS DE PAGO</b>", sTitulo),
                              Paragraph("Cuentas bancarias de %s" % (
                                  settings.get("empresa_nombre") or "Grupo RYSA"), sLetras)]]],
                           colWidths=[55 * mm, 131 * mm]))
        story.append(HRFlowable(width="100%", thickness=2.2, color=TERRA, spaceBefore=6, spaceAfter=12))
        for cta in cuentas:
            # Logo real del banco si coincide con el catálogo; si no, monograma.
            logo_path = _bancos.ruta_logo(cta.get("banco"))
            logo_cell = None
            if logo_path:
                try:
                    from reportlab.lib.utils import ImageReader
                    iw, ih = ImageReader(logo_path).getSize()
                    w = 30 * mm
                    logo_cell = Image(logo_path, width=w, height=max(10 * mm, w * ih / max(iw, 1)))
                except Exception:
                    logo_cell = None
            filas = [
                Paragraph("<b><font color='#C1401E'>%s</font></b>%s" % (
                    cta.get("banco") or "Banco",
                    " · %s" % cta["alias"] if cta.get("alias") else ""), sCli),
            ]
            if cta.get("titular"):
                filas.append(Paragraph("<b>Titular:</b> %s" % cta["titular"], sCli))
            if cta.get("numero_cuenta"):
                filas.append(Paragraph("<b>Cuenta:</b> %s" % cta["numero_cuenta"], sCli))
            if cta.get("sucursal"):
                filas.append(Paragraph("<b>Sucursal:</b> %s" % cta["sucursal"], sCli))
            if cta.get("clabe"):
                filas.append(Paragraph("<b>CLABE:</b> %s" % cta["clabe"], sCli))
            extra = " · ".join(filter(None, [cta.get("tipo_cuenta"), cta.get("moneda")]))
            if extra:
                filas.append(Paragraph(extra, sLetras))
            celda_izq = [logo_cell] if logo_cell else [
                Paragraph("<b><font size='16' color='%s'>%s</font></b>" % (
                    (_bancos.resolver_banco(cta.get("banco")) or {}).get("color", "#C1401E"),
                    (cta.get("banco") or "B")[:2].upper()), sCel)]
            box = Table([[celda_izq, filas]], colWidths=[34 * mm, None])
            box.setStyle(TableStyle([
                ("BOX", (0, 0), (-1, -1), 0.8, LINEA),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LINEBEFORE", (0, 0), (0, -1), 3, TERRA),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]))
            story.append(box)
            story.append(Spacer(1, 8))
        story.append(Spacer(1, 6))
        story.append(Paragraph("Realizado su pago, envíe su comprobante a su asesor de ventas. Gracias por su preferencia.", sFoot))

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=16 * mm, bottomMargin=14 * mm,
                            title="Cotización %s" % sale.get("folio", ""),
                            author=settings.get("empresa_nombre") or "Grupo RYSA")
    doc.build(story)
    buf.seek(0)
    return buf.read()
