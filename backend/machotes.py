"""Motor unificado de Compilación y Renderizado de Machotes Documentales RYSA.

Permite:
1. Gestionar plantillas y versiones versionadas en PostgreSQL (document_templates / document_template_versions).
2. Sustituir variables dinámicas {{entidad.campo}} de forma segura (sin eval ni Jinja no aislado).
3. Evaluar condiciones declarativas de visibilidad de bloques (ej. 'doc.saldo > 0', 'doc.iva > 0').
4. Renderizar a PDF fiel tanto en formato térmico (58mm, 80mm) con ReportLab Canvas como
   en formato página (Carta, Oficio) con ReportLab Platypus.
5. Generar datos sintéticos y cargar datos reales para el Simulador Dual WYSIWYG.
"""
import io
import json
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import text

from reportlab.lib.pagesizes import letter, legal
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfgen import canvas
import qrcode

from deps import iso_now, now_utc
from pgstore.database import transaction


# Medidas térmicas estándar
PAGE_SIZES = {
    "58mm": (58 * 2.83465, 200 * 2.83465),  # 58mm ancho
    "80mm": (80 * 2.83465, 297 * 2.83465),  # 80mm ancho
    "carta": letter,
    "oficio": legal,
}


def _uid() -> str:
    return uuid.uuid4().hex


def resolver_variable(path: str, context: dict) -> str:
    """Resuelve rutas tipo 'doc.folio', 'cliente.nombre', 'empresa.rfc' de forma segura."""
    parts = path.strip().split(".")
    curr = context
    for p in parts:
        if isinstance(curr, dict):
            curr = curr.get(p)
        else:
            return ""
        if curr is None:
            return ""
    if isinstance(curr, float):
        return f"{curr:,.2f}"
    return str(curr)


def sustituir_variables(texto: str, context: dict) -> str:
    """Reemplaza todas las apariciones de {{entidad.campo}} en una cadena."""
    if not texto:
        return ""
    pattern = re.compile(r"\{\{([^}]+)\}\}")
    return pattern.sub(lambda m: resolver_variable(m.group(1), context), texto)


def evaluar_condicion(condicion: str | None, context: dict) -> bool:
    """Evalúa condiciones simples de visibilidad como 'doc.saldo > 0' sin eval arbitrario."""
    if not condicion or not condicion.strip():
        return True
    c = condicion.strip()
    m = re.match(r"^([\w\.]+)\s*(==|!=|>|<|>=|<=)\s*([0-9\.]+|'[^']*'|\"[^\"]*\"|true|false)$", c, re.I)
    if not m:
        return True
    var_path, op, target_val = m.groups()
    resolved = resolver_variable(var_path, context)
    target = target_val.strip("'\"")
    try:
        r_num = float(resolved.replace(",", ""))
        t_num = float(target)
        if op == "==": return r_num == t_num
        if op == "!=": return r_num != t_num
        if op == ">":  return r_num > t_num
        if op == "<":  return r_num < t_num
        if op == ">=": return r_num >= t_num
        if op == "<=": return r_num <= t_num
    except ValueError:
        if op == "==": return resolved.lower() == target.lower()
        if op == "!=": return resolved.lower() != target.lower()
    return True


# ---------------------------------------------------------------------------
# Compilador a ReportLab Platypus / Canvas
# ---------------------------------------------------------------------------
class MachoteCompiler:
    def __init__(self, configuracion: dict):
        self.config = configuracion or {}
        self.formato = self.config.get("formato_fisico", "80mm")
        self.elementos = self.config.get("elementos", [])
        self.fuente = self.config.get("fuente", "Helvetica")
        self.margenes = self.config.get("margenes", {"arriba": 5, "abajo": 5, "izquierda": 5, "derecha": 5})

    def render_pdf(self, context: dict) -> bytes:
        if self.formato in ("58mm", "80mm"):
            return self._render_termico(context)
        return self._render_pagina(context)

    def _render_termico(self, context: dict) -> bytes:
        """Renderiza ticket térmico con auto-cálculo de altura exacta en 2 pasadas."""
        ancho_mm = 58 if self.formato == "58mm" else 80
        w_pts = ancho_mm * 2.83465
        margen = float(self.margenes.get("izquierda", 3)) * 2.83465
        w_util = w_pts - (2 * margen)

        # Primera pasada: medir altura requerida
        h_estimada = 800  # suficiente para medir
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(w_pts, h_estimada))
        
        def _dibujar(c, y_start):
            y = y_start
            for el in self.elementos:
                if not el.get("visible", True):
                    continue
                if not evaluar_condicion(el.get("condicion"), context):
                    continue

                tipo = el.get("tipo")
                fsize = el.get("font_size", 9)
                is_bold = el.get("bold", False)
                fn = f"{self.fuente}-Bold" if is_bold else self.fuente

                if tipo in ("texto", "campo"):
                    txt = sustituir_variables(el.get("contenido", ""), context)
                    c.setFont(fn, fsize)
                    align = el.get("align", "left")
                    if align == "center":
                        c.drawCentredString(w_pts / 2, y, txt)
                    elif align == "right":
                        c.drawRightString(w_pts - margen, y, txt)
                    else:
                        c.drawString(margen, y, txt)
                    y -= (fsize + 3)

                elif tipo == "separador":
                    y -= 2
                    c.setLineWidth(0.5)
                    c.setStrokeColor(colors.gray)
                    c.line(margen, y, w_pts - margen, y)
                    y -= 5

                elif tipo == "espaciador":
                    y -= float(el.get("altura", 6))

                elif tipo == "empresa":
                    emp = context.get("empresa", {})
                    c.setFont(f"{self.fuente}-Bold", fsize or 10)
                    c.drawCentredString(w_pts / 2, y, emp.get("nombre", "GRUPO RYSA"))
                    y -= (fsize + 4)

                elif tipo == "tabla_productos":
                    items = (context.get("doc") or {}).get("items", [])
                    c.setFont(f"{self.fuente}-Bold", 7.5)
                    c.drawString(margen, y, "CANT")
                    c.drawString(margen + 28, y, "DESCRIPCIÓN")
                    c.drawRightString(w_pts - margen, y, "TOTAL")
                    y -= 9
                    c.setLineWidth(0.5)
                    c.line(margen, y + 2, w_pts - margen, y + 2)
                    y -= 2
                    c.setFont(self.fuente, 7.5)
                    for it in items:
                        cant = f"{it.get('cantidad', 1)} {it.get('presentacion','')}".strip()
                        desc = str(it.get("descripcion", ""))[:28]
                        imp = f"${float(it.get('importe', 0)):,.2f}"
                        c.drawString(margen, y, cant)
                        c.drawString(margen + 28, y, desc)
                        c.drawRightString(w_pts - margen, y, imp)
                        y -= 9
                    y -= 3

                elif tipo == "totales_linea":
                    lbl = el.get("etiqueta", "")
                    val = sustituir_variables(el.get("valor", ""), context)
                    c.setFont(fn, fsize or 8.5)
                    c.drawString(margen + 20, y, lbl)
                    c.drawRightString(w_pts - margen, y, val)
                    y -= (fsize + 3)

                elif tipo == "qr":
                    qr_url = sustituir_variables(el.get("contenido", ""), context)
                    if qr_url:
                        from reportlab.lib.utils import ImageReader
                        qr = qrcode.QRCode(box_size=2, border=1)
                        qr.add_data(qr_url)
                        qr.make(fit=True)
                        img = qr.make_image(fill_color="black", back_color="white")
                        img_buf = io.BytesIO()
                        img.save(img_buf, format="PNG")
                        img_buf.seek(0)
                        qr_size = 65
                        qr_x = (w_pts - qr_size) / 2
                        y -= qr_size
                        c.drawImage(ImageReader(img_buf), qr_x, y, width=qr_size, height=qr_size)
                        y -= 5

            return y

        # Medir:
        y_final = _dibujar(c, h_estimada - margen)
        h_requerida = max(100, (h_estimada - y_final) + margen + 10)

        # Segunda pasada: lienzo exacto
        out_buf = io.BytesIO()
        c2 = canvas.Canvas(out_buf, pagesize=(w_pts, h_requerida))
        _dibujar(c2, h_requerida - margen)
        c2.showPage()
        c2.save()
        return out_buf.getvalue()

    def _render_pagina(self, context: dict) -> bytes:
        """Renderiza documento tamaño Carta / Oficio con ReportLab Platypus."""
        pagesize = letter if self.formato == "carta" else legal
        top = float(self.margenes.get("arriba", 15)) * 2.83465
        bottom = float(self.margenes.get("abajo", 15)) * 2.83465
        left = float(self.margenes.get("izquierda", 15)) * 2.83465
        right = float(self.margenes.get("derecha", 15)) * 2.83465

        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=pagesize,
                                leftMargin=left, rightMargin=right,
                                topMargin=top, bottomMargin=bottom)
        styles = getSampleStyleSheet()
        normal = styles["Normal"]
        story = []

        doc_info = context.get("doc", {})
        empresa = context.get("empresa", {})
        cliente = context.get("cliente", {})

        for el in self.elementos:
            if not el.get("visible", True):
                continue
            if not evaluar_condicion(el.get("condicion"), context):
                continue

            tipo = el.get("tipo")
            if tipo == "encabezado_empresa":
                data = [
                    [
                        Paragraph(f"<b>{empresa.get('nombre', 'GRUPO RYSA')}</b><br/>"
                                  f"RFC: {empresa.get('rfc','')}<br/>"
                                  f"{empresa.get('direccion','')}<br/>"
                                  f"Tel: {empresa.get('telefono','')}", normal),
                        Paragraph(f"<font size=14 color='#1e3a8a'><b>{doc_info.get('tipo','VENTA').upper()}</b></font><br/>"
                                  f"<b>Folio:</b> {doc_info.get('folio','')}<br/>"
                                  f"<b>Fecha:</b> {doc_info.get('fecha','')} {doc_info.get('hora','')}<br/>"
                                  f"<b>Condición:</b> {doc_info.get('condicion','').upper()}", normal)
                    ]
                ]
                t = Table(data, colWidths=[doc.width * 0.6, doc.width * 0.4])
                t.setStyle(TableStyle([
                    ('VALIGN', (0,0), (-1,-1), 'TOP'),
                    ('ALIGN', (1,0), (1,-1), 'RIGHT'),
                ]))
                story.append(t)
                story.append(Spacer(1, 10))

            elif tipo == "datos_cliente":
                data = [
                    [
                        Paragraph(f"<b>Cliente:</b> {cliente.get('nombre','PÚBLICO EN GENERAL')}<br/>"
                                  f"<b>RFC:</b> {cliente.get('rfc','XAXX010101000')} | <b>Tel:</b> {cliente.get('telefono','')}<br/>"
                                  f"<b>Dirección:</b> {cliente.get('direccion','')}", normal)
                    ]
                ]
                t = Table(data, colWidths=[doc.width])
                t.setStyle(TableStyle([
                    ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f8fafc')),
                    ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
                    ('PADDING', (0,0), (-1,-1), 6),
                ]))
                story.append(t)
                story.append(Spacer(1, 10))

            elif tipo == "tabla_productos":
                cols = el.get("columnas", [
                    {"campo": "codigo", "titulo": "CÓDIGO", "ancho_pct": 15},
                    {"campo": "descripcion", "titulo": "DESCRIPCIÓN", "ancho_pct": 40},
                    {"campo": "presentacion", "titulo": "PRESENTACIÓN", "ancho_pct": 15},
                    {"campo": "cantidad", "titulo": "CANTIDAD", "ancho_pct": 10},
                    {"campo": "precio", "titulo": "PRECIO", "ancho_pct": 10},
                    {"campo": "importe", "titulo": "TOTAL", "ancho_pct": 10},
                ])
                header = [c["titulo"] for c in cols]
                table_rows = [header]
                for it in doc_info.get("items", []):
                    row = []
                    for c in cols:
                        f = c["campo"]
                        val = it.get(f, "")
                        if f in ("precio", "importe"):
                            val = f"${float(val or 0):,.2f}"
                        row.append(str(val))
                    table_rows.append(row)
                
                col_widths = [doc.width * (float(c.get("ancho_pct", 10)) / 100.0) for c in cols]
                t = Table(table_rows, colWidths=col_widths, repeatRows=1)
                t.setStyle(TableStyle([
                    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1e3a8a')),
                    ('TEXTCOLOR', (0,0), (-1,0), colors.white),
                    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                    ('FONTSIZE', (0,0), (-1,-1), 8.5),
                    ('BOTTOMPADDING', (0,0), (-1,-1), 4),
                    ('TOPPADDING', (0,0), (-1,-1), 4),
                    ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
                    ('ALIGN', (3,0), (-1,-1), 'RIGHT'),
                ]))
                story.append(t)
                story.append(Spacer(1, 10))

            elif tipo == "bloque_totales":
                tot_data = [
                    ["SUBTOTAL:", f"${float(doc_info.get('subtotal',0)):,.2f}"],
                    ["IVA (16%):", f"${float(doc_info.get('iva',0)):,.2f}"],
                    ["TOTAL:", f"${float(doc_info.get('total',0)):,.2f}"],
                ]
                if float(doc_info.get("saldo", 0)) > 0:
                    tot_data.append(["SALDO PENDIENTE:", f"${float(doc_info.get('saldo',0)):,.2f}"])
                t = Table(tot_data, colWidths=[120, 100], hAlign='RIGHT')
                t.setStyle(TableStyle([
                    ('FONTNAME', (0,0), (-1,-1), 'Helvetica-Bold'),
                    ('FONTSIZE', (0,0), (-1,-1), 9),
                    ('ALIGN', (0,0), (-1,-1), 'RIGHT'),
                    ('TEXTCOLOR', (0,-1), (-1,-1), colors.HexColor('#1e3a8a')),
                ]))
                story.append(t)
                story.append(Spacer(1, 15))

            elif tipo == "bloque_firmas":
                leyenda = el.get("leyenda", "Recibí de conformidad")
                f_data = [
                    ["_________________________________________", "_________________________________________"],
                    [f"FIRMA CLIENTE\n{leyenda}", "FIRMA VENDEDOR / ENTREGADO"]
                ]
                t = Table(f_data, colWidths=[doc.width * 0.45, doc.width * 0.45], hAlign='CENTER')
                t.setStyle(TableStyle([
                    ('ALIGN', (0,0), (-1,-1), 'CENTER'),
                    ('FONTSIZE', (0,0), (-1,-1), 8),
                ]))
                story.append(KeepTogether([t]))

            elif tipo in ("texto", "campo"):
                txt = sustituir_variables(el.get("contenido", ""), context)
                story.append(Paragraph(txt, normal))
                story.append(Spacer(1, 4))

        doc.build(story)
        return buf.getvalue()


# ---------------------------------------------------------------------------
# Simulador de Datos (Sintético y Reales)
# ---------------------------------------------------------------------------
def generar_datos_sinteticos(tipo_documento: str = "ticket", num_items: int = 4) -> dict:
    """Genera datos sintéticos con escenarios realistas para simulación inmediata."""
    items = []
    subtot = 0.0
    for i in range(1, num_items + 1):
        cant = 2 if i % 2 == 0 else 1
        precio = round(25.50 * i, 2)
        imp = round(cant * precio, 2)
        subtot += imp
        items.append({
            "codigo": f"ART-00{i}",
            "descripcion": f"Producto de Prueba Modelo {i} de Alto Rendimiento",
            "presentacion": "PAQUETE" if i % 2 == 0 else "PIEZA",
            "cantidad": cant,
            "precio": precio,
            "importe": imp,
        })
    iva = round(subtot * 0.16, 2)
    tot = round(subtot + iva, 2)

    return {
        "empresa": {
            "nombre": "GRUPO RYSA DEL SURESTE S.A. DE C.V.",
            "rfc": "GRS180514ABC",
            "direccion": "Calle 60 #450 x 49 y 51, Centro, Mérida, Yucatán",
            "telefono": "(999) 923-4567",
            "correo": "ventas@gruporysa.com",
            "sucursal": "Matriz Mérida"
        },
        "cliente": {
            "codigo": "CLI-0012",
            "nombre": "DISTRIBUIDORA COMERCIAL DEL CARIBE S.A. DE C.V.",
            "rfc": "DCC091215XYZ",
            "direccion": "Av. Prolongación Montejo #120, Campestre",
            "telefono": "(999) 456-7890",
            "saldo": 1250.00
        },
        "doc": {
            "tipo": tipo_documento,
            "folio": "V-001248",
            "fecha": "2026-09-03",
            "hora": "14:30",
            "vencimiento": "2026-09-18",
            "condicion": "credito",
            "items": items,
            "subtotal": subtot,
            "iva": iva,
            "descuento": 0.0,
            "total": tot,
            "total_letra": f"{tot:,.2f} PESOS M.N.",
            "saldo": tot if tipo_documento == "credito" else 0.0,
            "qr_url": "https://gruporysa.com/verificar/V-001248"
        },
        "vendedor": {"nombre": "Juan Pérez"},
        "caja": {"numero": "Caja 1"}
    }


async def cargar_datos_reales(conn, documento_id: str, tipo: str = "sale") -> dict:
    """Carga los datos reales de una venta o documento desde la base de datos para simulación."""
    row = (await conn.execute(
        text("SELECT doc FROM sales WHERE id = :id"),
        {"id": documento_id}
    )).first()
    if not row:
        raise ValueError(f"Documento {documento_id} no encontrado")
    sale = dict(row[0])

    # Empresa
    s_row = (await conn.execute(text("SELECT doc FROM settings WHERE _id = 'app'"))).first()
    settings = dict(s_row[0]) if s_row else {}
    emp = settings.get("empresa", {})

    # Cliente
    cli = {}
    if sale.get("cliente_id"):
        c_row = (await conn.execute(
            text("SELECT doc FROM clients WHERE id = :cid"),
            {"cid": sale["cliente_id"]}
        )).first()
        if c_row:
            cli = dict(c_row[0])

    return {
        "empresa": {
            "nombre": emp.get("nombre", "GRUPO RYSA"),
            "rfc": emp.get("rfc", ""),
            "direccion": emp.get("direccion", ""),
            "telefono": emp.get("telefono", ""),
            "correo": emp.get("correo", ""),
        },
        "cliente": {
            "codigo": cli.get("codigo", ""),
            "nombre": cli.get("nombre", "PÚBLICO EN GENERAL"),
            "rfc": cli.get("rfc", "XAXX010101000"),
            "direccion": cli.get("direccion", ""),
            "telefono": cli.get("telefono", ""),
            "saldo": float(cli.get("saldo", 0) or 0)
        },
        "doc": {
            "tipo": sale.get("condicion", "venta"),
            "folio": sale.get("folio", ""),
            "fecha": sale.get("fecha", "")[:10],
            "hora": sale.get("fecha", "")[11:16],
            "vencimiento": sale.get("fecha_vencimiento", "")[:10],
            "condicion": sale.get("condicion", "contado"),
            "items": sale.get("items", []),
            "subtotal": float(sale.get("subtotal", 0)),
            "iva": float(sale.get("iva", 0)),
            "descuento": float(sale.get("descuento", 0)),
            "total": float(sale.get("total", 0)),
            "total_letra": sale.get("total_letra", ""),
            "saldo": float(sale.get("saldo", 0)),
            "qr_url": f"https://gruporysa.com/verificar/{sale.get('folio','')}"
        },
        "vendedor": {"nombre": sale.get("vendedor_nombre", "")},
        "caja": {"numero": sale.get("caja_id", "1")}
    }
