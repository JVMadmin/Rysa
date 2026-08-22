"""OCR de facturas / comprobantes (CFDI) para Compras y Gastos.

Extrae texto de PDF (capa de texto digital o imagen escaneada) o de imágenes
(foto de la factura) y parsea la información: RFC / proveedor, número de
factura, fecha, subtotal, IVA, total y los conceptos de la tabla.

Los conceptos se cruzan contra el catálogo de productos (por código o por
descripción) para poder ajustar el inventario automáticamente al confirmar
la compra. El resultado es "best-effort": el usuario puede corregirlo en el
formulario antes de guardar.
"""
import io
import re
import logging

logger = logging.getLogger("rysa.ocr")

_RE_RFC = re.compile(r"\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3}\b")
_RE_FECHA = re.compile(r"\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})\b")
_RE_NUM = re.compile(r"[+-]?\d{1,3}(?:,\d{3})+(?:\.\d{1,4})?|\d+(?:\.\d{1,4})?")

# Palabras que marcan líneas de encabezado/totales y no son conceptos.
_SKIP_ITEM = (
    "subtotal", " total", "total:", "iva", "descuento", "traslado", "retencion",
    "importe", "cantidad", "descripcion", "concepto", "clave", "unidad", "precio",
    "rfc", "fecha", "factura", "folio", "lugar", "metodo", "forma", "uso", "cfdi",
    "moneda", "certificado", "uuid", "sello", "cadena", "http", "www", "pago",
    "comprobante", "codigo", "numero", "telefono", "correo", "domicilio",
    "regimen", "pais", "municipio", "colonia", "estado", "serie", "aplicacion",
    "saldo", "abono", "tasa", "exento", "cuenta", "banco", "email", "clabe",
    "total a pagar", "emitio", "recibio", "despacho", "metodo de pago",
)


def parse_number(tok):
    """Convierte '1,234.50' o '1234.50' a float."""
    t = tok.replace("$", "").strip().replace(",", "")
    try:
        return float(t)
    except Exception:
        return None


def detect_is_pdf(data: bytes) -> bool:
    return data[:5] == b"%PDF-"


def extract_text(data: bytes, filename: str = "") -> str:
    """Devuelve el texto de un PDF o imagen.

    - PDF digital: usa la capa de texto (PyMuPDF).
    - PDF escaneado / imagen: usa OCR (Tesseract, idioma español).
    """
    if detect_is_pdf(data):
        try:
            import fitz  # PyMuPDF
        except ImportError:
            raise RuntimeError(
                "Falta PyMuPDF para leer PDFs. Reinstala las dependencias del backend.")
        doc = None
        try:
            doc = fitz.open(stream=data, filetype="pdf")
            txt = "\n".join(page.get_text("text") for page in doc)
            if txt.strip() and len(txt.strip()) > 30:
                return txt
        except Exception as e:
            logger.warning("Fallo al leer capa de texto del PDF: %s", str(e)[:120])
        # PDF escaneado -> OCR por página
        if doc is None:
            raise RuntimeError("No se pudo abrir el PDF.")
        chunks = []
        for page in doc:
            try:
                pix = page.get_pixmap(dpi=200)
                img_bytes = pix.tobytes("png")
                chunks.append(_ocr_image_bytes(img_bytes))
            except Exception as e:
                logger.warning("Fallo OCR página PDF: %s", str(e)[:120])
        return "\n".join(chunks)
    return _ocr_image_bytes(data)


def _ocr_image_bytes(img_bytes: bytes) -> str:
    try:
        from PIL import Image
        import pytesseract
    except ImportError:
        raise RuntimeError(
            "Falta pytesseract/Pillow para OCR. Reinstala las dependencias del backend.")
    try:
        img = Image.open(io.BytesIO(img_bytes))
    except Exception:
        raise RuntimeError("La imagen no es válida. Usa JPG, PNG o WEBP de la factura.")
    w, h = img.size
    if w < 1400:
        img = img.resize((int(w * 2), int(h * 2)), Image.LANCZOS)
    try:
        return pytesseract.image_to_string(img, lang="spa+eng")
    except pytesseract.TesseractNotFoundError:
        raise RuntimeError(
            "Tesseract OCR no está instalado en el servidor. Para leer imágenes "
            "instala tesseract-ocr y tesseract-ocr-spa.")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _find_amount(lines, keyword, exclude=()):
    """Último número en una línea que contiene `keyword` (sin las `exclude`).
    Usar el último evita capturar porcentajes como 'IVA 16%: 430.40'."""
    for ln in lines:
        ll = ln.lower()
        if keyword not in ll:
            continue
        if any(x in ll for x in exclude):
            continue
        found = [_RE_NUM.findall(ln)]
        for group in found:
            for tok in reversed(group):
                v = parse_number(tok)
                if v is not None:
                    return v
    return None


def _extract_factura_numero(lines):
    for ln in lines:
        ll = ln.lower()
        if not any(k in ll for k in ("factura", "folio", "serie", "no. de factura", "n. de factura")):
            continue
        for part in re.split(r"[:;|]\s*|\s+", ln):
            p = part.strip().strip(".-: ")
            if not p or p.lower() in ("factura", "folio", "serie", "no", "no.", "n",
                                      "num", "numero", "n.", "de", "documento", "electronica",
                                      "electronic", "cfdi"):
                continue
            # El número de factura debe incluir al menos un dígito.
            if re.fullmatch(r"[A-Z0-9Ñ][A-Z0-9Ñ\-_]{2,29}", p.upper()) and re.search(r"\d", p):
                return p
    return ""


def _extract_fecha(lines):
    for ln in lines:
        m = _RE_FECHA.search(ln)
        if m:
            try:
                from datetime import date
                d = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
                return d.isoformat()
            except Exception:
                return f"{int(m.group(3)):04d}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return ""


def _match_product(desc_txt, products):
    dt = _norm(desc_txt).lower()
    if not dt:
        return None
    # 1) Código exacto
    for p in products:
        cod = str(p.get("codigo") or "").strip().lower()
        if cod and cod == dt:
            return p
    # 2) Descripción contenida
    for p in products:
        desc = _norm(str(p.get("descripcion") or "")).lower()
        if len(desc) >= 5 and desc in dt:
            return p
    # 3) Tokens significativos
    toks = [t for t in re.split(r"[^a-z0-9áéíóúüñÑ]+", dt) if len(t) >= 4]
    best, best_score = None, 0
    for p in products:
        d2 = _norm(str(p.get("descripcion") or "")).lower()
        if len(d2) < 5:
            continue
        score = sum(1 for t in toks if t in d2)
        if score > best_score:
            best, best_score = p, score
    if best and best_score >= 2:
        return best
    if best and best_score == 1 and any(len(t) >= 8 for t in toks):
        return best
    return None


def _extract_items(lines, products):
    """Reconstruye los conceptos de la tabla de la factura.

    Estrategia: localizar el encabezado de la tabla (fila con palabras como
    'cantidad'/'clave'/'descripcion'/'precio') y el bloque de totales
    ('subtotal'/'total'); los conceptos se leen solo entre ambos. Si no se
    encuentra el encabezado, se recorre todo el texto rechazando líneas de
    datos de la empresa (RFC, domicilio, formas de pago, etc.).
    """
    items = []

    def _is_skip(line):
        ll = line.lower()
        return any(k in ll for k in _SKIP_ITEM)

    def _looks_header(line):
        ll = line.lower()
        words = sum(1 for w in ("cantidad", "clave", "descripcion", "precio", "importe", "unidad", "codigo") if w in ll)
        return words >= 2

    # 1) Delimitar región de la tabla de conceptos.
    start, end = None, None
    for i, ln in enumerate(lines):
        if start is None and _looks_header(ln):
            start = i
            continue
        if start is not None and end is None and _is_skip(ln) and any(k in ln.lower() for k in ("subtotal", " total", "total:", "descuento", "importe total")):
            end = i
            break
    region = lines[start + 1:end] if start is not None else lines

    pend = ""  # descripción acumulada de líneas sin números

    def _accept(ln, desc):
        """¿Esta línea con números puede ser un concepto?"""
        if _match_product(desc, products):
            return True
        if _is_skip(ln):
            return False
        if not desc and not items:
            return False
        return True

    for ln in region:
        nums = []
        for tok in _RE_NUM.findall(ln):
            v = parse_number(tok)
            if v is not None:
                nums.append(v)
        if not nums:
            t = _norm(ln)
            if t and not _is_skip(t):
                pend = (pend + " " + t if pend else t)
            continue

        desc_part = _norm(re.sub(_RE_NUM.pattern, " ", ln).replace("|", " "))
        desc_part = re.sub(r"\s{2,}", " ", desc_part).strip()
        desc = _norm(f"{pend} {desc_part}" if pend else desc_part)
        pend = ""

        if not _accept(ln, desc):
            continue

        if len(nums) >= 3:
            qty, importe = nums[0], nums[-1]
            precio = nums[-2]
        elif len(nums) == 2:
            qty, importe = nums[0], nums[-1]
            precio = 0.0
        else:
            qty, importe, precio = 1.0, nums[0], 0.0

        if qty <= 0 or qty > 100000:
            qty = 1.0
        if importe <= 0 and qty > 0:
            importe = round(qty * (precio or 0), 2)
        if importe > 0 and qty > 0 and (precio == 0 or abs(precio - importe / qty) > 0.01):
            precio = round(importe / qty, 4)
        if importe <= 0 and precio > 0:
            importe = round(qty * precio, 2)

        if not desc and not items:
            continue

        prod = _match_product(desc, products)
        if prod:
            it = {
                "product_id": prod.get("id"),
                "codigo": prod.get("codigo") or "",
                "descripcion": prod.get("descripcion") or desc,
                "unidad": prod.get("unidad_medida") or prod.get("unidad") or "PZA",
                "cantidad": round(qty, 3),
                "costo": round(precio, 4),
                "importe": round(importe, 2),
                "iva_tasa": float(prod.get("iva_tasa") or 8.0),
                "matched": True,
            }
        else:
            it = {
                "product_id": None,
                "codigo": "",
                "descripcion": desc or f"Concepto {len(items) + 1}",
                "unidad": "PZA",
                "cantidad": round(qty, 3),
                "costo": round(precio, 4),
                "importe": round(importe, 2),
                "iva_tasa": 8.0,
                "matched": False,
            }
        # Deduplicar por producto / descripción
        key = it["product_id"] or it["descripcion"].lower()
        prev = next((x for x in items if (x["product_id"] or x["descripcion"].lower()) == key), None)
        if prev:
            prev["cantidad"] = round(prev["cantidad"] + it["cantidad"], 3)
            prev["importe"] = round(prev["importe"] + it["importe"], 2)
            prev["costo"] = round(prev["importe"] / prev["cantidad"], 4) if prev["cantidad"] else prev["costo"]
        else:
            items.append(it)
    return items


def parse_factura(text: str, products=None):
    products = products or []
    lines = [ln.strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]
    joined = "\n".join(lines)
    low = joined.lower()

    rfc = None
    m = _RE_RFC.search(joined)
    if m:
        rfc = m.group(0)

    # Proveedor: nombre en la misma línea del RFC del emisor o en la(s)
    # línea(s) inmediatamente anterior(es) con apariencia de nombre de empresa.
    proveedor_nombre = ""
    for i, ln in enumerate(lines):
        if rfc and rfc in ln:
            mismo = _norm(re.sub(rfc, " ", ln))
            mismo = re.sub(r"\s+", " ", re.sub(r"(RFC|R\.F\.C\.?)\s*:?\s*", " ", mismo)).strip(" :-")
            if mismo and len(mismo) >= 4 and not _RE_NUM.search(mismo):
                proveedor_nombre = mismo
                break
            for j in range(max(0, i - 1), max(0, i - 3) - 1, -1):
                cand = _norm(lines[j])
                if (cand and not _RE_RFC.search(cand)
                        and not _RE_NUM.search(cand)
                        and len(cand) > 3 and len(cand) < 80
                        and cand[0].isalpha() and cand[0].isupper()):
                    proveedor_nombre = cand
                    break
            if proveedor_nombre:
                break

    # Rechazar RFC del receptor (público general / XAXX)
    if rfc and rfc in ("XAXX010101000", "XAXX010101000"):
        rfc = None

    return {
        "rfc": rfc,
        "proveedor_nombre": proveedor_nombre,
        "factura_numero": _extract_factura_numero(lines),
        "fecha": _extract_fecha(lines),
        "subtotal": _find_amount(lines, "subtotal"),
        "iva": _find_amount(lines, "iva", exclude=("descuento",)),
        "total": _find_amount(lines, "total", exclude=("subtotal", "descuento")),
        "items": _extract_items(lines, products),
    }


def process_factura(data: bytes, filename: str = "", products=None) -> dict:
    """End-to-end: extrae texto (PDF/imagen) y parsea la factura."""
    text = extract_text(data, filename)
    return parse_factura(text, products)
