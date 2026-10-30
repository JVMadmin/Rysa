"""Motor de formatos v2 (editor de machotes) de Grupo RYSA.

Convierte una PLANTILLA (JSON editable desde el Editor de formatos) y un
CONTEXTO de datos (venta, abono, compra, movimiento de caja) en un PDF.

Plantilla (esquema 2):
    {
      "esquema": 2,
      "pagina": {formato, orientacion, margenes{arriba,abajo,izquierda,derecha} (mm),
                 fuente, tamano_base, color_texto, color_primario, color_secundario,
                 interlineado, copias, marca_agua{texto,color,opacidad,tamano,angulo},
                 pie_pagina{texto, numerar, tamano, color}},
      "bloques": [ {id, tipo, visible, condicion, estilo{...}, ...propiedades} ]
    }

Tipos de bloque: logo, imagen, texto, campos, tabla_items, totales, qr, firmas,
cuentas_bancarias, pagos, separador, espacio, salto_pagina, columnas.

Estilo de bloque (todo opcional; hereda de `pagina`): fuente, tamano, negrita,
cursiva, subrayado, mayusculas, color, fondo, align, interlineado,
padding[arriba,derecha,abajo,izquierda] (mm), margen_arriba, margen_abajo (mm),
borde{ancho,color,radio}.

Texto con variables {{doc.folio}}, {{cliente.nombre}}, {{empresa.rfc}}... y
marcas seguras <b> <i> <u> <br>. Nada se evalúa como código.

El PREDETERMINADO DEL SISTEMA de cada documento sigue siendo el generador de
storage.py; este motor solo se usa cuando el usuario activa una plantilla
personalizada (ver formatos_api.py).
"""
from __future__ import annotations

import copy
import html
import io
import os
import re
from datetime import datetime

import qrcode
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import landscape, legal, letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (Flowable, HRFlowable, Image, PageBreak, Paragraph,
                                SimpleDocTemplate, Spacer, Table, TableStyle)

import storage

ESQUEMA = 2

# --------------------------------------------------------------------------- #
# Catálogos                                                                    #
# --------------------------------------------------------------------------- #
TIPOS_DOCUMENTO = {
    "ticket": {"nombre": "Ticket de venta", "descripcion": "Ticket térmico del punto de venta (80 o 58 mm).",
               "formato": "80mm"},
    "carta_venta": {"nombre": "Nota de venta (carta)", "descripcion": "Comprobante de venta en hoja carta.",
                    "formato": "carta"},
    "cotizacion": {"nombre": "Cotización", "descripcion": "Cotización en hoja carta, con cuentas bancarias y QR de pago.",
                   "formato": "carta"},
    "abono": {"nombre": "Comprobante de abono", "descripcion": "Recibo de abono a cuenta por cobrar.",
              "formato": "carta"},
    "compra": {"nombre": "Comprobante de compra", "descripcion": "Comprobante de compra o gasto a proveedor.",
               "formato": "carta"},
    "entrega": {"nombre": "Movimiento de caja", "descripcion": "Ticket de entrega/entrada de efectivo o gasto de caja.",
                "formato": "80mm"},
}

TAMANOS = {
    "80mm": (80 * mm, None),
    "58mm": (58 * mm, None),
    "carta": letter,
    "oficio": legal,
    "media_carta": (letter[0], letter[1] / 2),
}

FAMILIAS = {
    "Helvetica": ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"),
    "Times": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
    "Courier": ("Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"),
}

ALIGN = {"left": TA_LEFT, "center": TA_CENTER, "right": TA_RIGHT, "justify": TA_JUSTIFY}
H_ALIGN = {"left": "LEFT", "center": "CENTER", "right": "RIGHT", "justify": "LEFT"}

CAMPOS_ITEM = {
    "numero": ("#", "center"), "cantidad": ("Cant.", "right"), "unidad": ("Und.", "center"),
    "presentacion": ("Presentación", "center"), "codigo": ("Código", "left"),
    "descripcion": ("Descripción", "left"), "precio": ("Precio", "right"),
    "descuento": ("Desc.", "right"), "descuento_pct": ("% Desc.", "center"),
    "iva": ("IVA", "right"), "importe": ("Importe", "right"), "comentario": ("Comentario", "left"),
}

CAMPOS_TOTAL = {
    "subtotal": "Subtotal", "descuento": "Descuento", "iva": "IVA", "total": "TOTAL",
    "recibido": "Recibido", "cambio": "Cambio", "saldo": "Saldo pendiente",
    "articulos": "Artículos", "monto": "Monto", "saldo_anterior": "Saldo anterior",
    "saldo_restante": "Saldo restante", "otros_impuestos": "Otros impuestos",
    "costos_adicionales": "Costos adicionales", "efectivo_en_caja": "Efectivo en caja",
}

_VAR_RE = re.compile(r"\{\{\s*([\w\.]+)\s*\}\}")
_TAG_RE = re.compile(r"&lt;(/?)(b|i|u|br\s*/?)&gt;", re.I)


# --------------------------------------------------------------------------- #
# Utilidades                                                                   #
# --------------------------------------------------------------------------- #
def _money(v) -> str:
    try:
        return f"${float(v or 0):,.2f}"
    except Exception:
        return "$0.00"


def _num(v) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace("$", "").replace(",", "").strip() or 0)
    except Exception:
        return 0.0


def _color(v, defecto=None):
    if not v:
        return defecto
    try:
        return colors.HexColor(v) if str(v).startswith("#") else colors.toColor(v)
    except Exception:
        return defecto


def _mm(v, defecto=0.0) -> float:
    try:
        return float(v) * mm
    except Exception:
        return float(defecto) * mm


def resolver(path: str, ctx: dict):
    cur = ctx
    for p in str(path).strip().split("."):
        if isinstance(cur, dict):
            cur = cur.get(p)
        else:
            return ""
        if cur is None:
            return ""
    return cur


def sustituir(texto: str, ctx: dict, escapar: bool = True) -> str:
    """{{variables}} -> valores. Con `escapar`, el resultado es seguro para
    Paragraph de ReportLab y solo se permiten <b> <i> <u> <br>."""
    if texto is None:
        return ""
    s = str(texto)
    if escapar:
        s = html.escape(s, quote=False)

    def _val(m):
        v = resolver(m.group(1), ctx)
        if isinstance(v, float):
            v = f"{v:,.2f}"
        v = "" if v is None else str(v)
        return html.escape(v, quote=False) if escapar else v

    s = _VAR_RE.sub(_val, s)
    if escapar:
        s = _TAG_RE.sub(lambda m: "<br/>" if m.group(2).lower().startswith("br")
                        else f"<{m.group(1)}{m.group(2).lower()}>", s)
        # Saltos de línea y espacios dobles tal como los escribió el usuario.
        s = s.replace("\r\n", "\n").replace("\n", "<br/>").replace("  ", " &nbsp;")
    return s


def evaluar_condicion(cond, ctx: dict) -> bool:
    """Condición de visibilidad. Acepta dict {variable, op, valor} o texto
    'doc.saldo_num > 0'. Operadores: == != > < >= <= vacio no_vacio contiene."""
    if not cond:
        return True
    if isinstance(cond, str):
        m = re.match(r"^\s*([\w\.]+)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$", cond)
        if not m:
            return True
        cond = {"variable": m.group(1), "op": m.group(2), "valor": m.group(3).strip("'\"")}
    var = cond.get("variable")
    if not var:
        return True
    op = (cond.get("op") or "no_vacio").strip()
    actual = resolver(var, ctx)
    objetivo = cond.get("valor", "")
    if op == "vacio":
        return actual in ("", None, 0, 0.0, [], "0", "$0.00")
    if op == "no_vacio":
        return actual not in ("", None, 0, 0.0, [], "0", "$0.00")
    if op == "contiene":
        return str(objetivo).lower() in str(actual).lower()
    try:
        a, b = _num(actual), float(str(objetivo).replace(",", ""))
        es_num = True
    except Exception:
        es_num = False
    if es_num and op in (">", "<", ">=", "<=", "==", "!="):
        return {">": a > b, "<": a < b, ">=": a >= b, "<=": a <= b,
                "==": a == b, "!=": a != b}[op]
    if op == "==":
        return str(actual).lower() == str(objetivo).lower()
    if op == "!=":
        return str(actual).lower() != str(objetivo).lower()
    return True


# --------------------------------------------------------------------------- #
# Contextos de datos                                                           #
# --------------------------------------------------------------------------- #
def _empresa(settings: dict) -> dict:
    s = settings or {}
    dir_completa = ", ".join(filter(None, [s.get("direccion"), s.get("colonia"), s.get("ciudad"),
                                           s.get("estado"), ("C.P. %s" % s["cp"]) if s.get("cp") else ""]))
    return {
        "nombre": s.get("empresa_nombre") or "Grupo RYSA", "razon_social": s.get("razon_social") or "",
        "rfc": s.get("rfc") or "", "direccion": s.get("direccion") or "", "colonia": s.get("colonia") or "",
        "ciudad": s.get("ciudad") or "", "estado": s.get("estado") or "", "cp": s.get("cp") or "",
        "pais": s.get("pais") or "México", "telefono": s.get("telefono") or "",
        "correo": s.get("correo") or "", "web": s.get("web") or s.get("sitio_web") or "",
        "whatsapp": s.get("whatsapp_empresa") or "", "direccion_completa": dir_completa,
    }


def _cliente(c: dict, sale: dict | None = None) -> dict:
    c = c or {}
    sale = sale or {}
    tel = c.get("telefono") or c.get("celular") or c.get("whatsapp") or ""
    correo = c.get("correo") or c.get("correos") or ""
    dir_completa = ", ".join(filter(None, [c.get("direccion"), c.get("colonia"), c.get("ciudad"),
                                           c.get("estado_geo"), ("C.P. %s" % c["cp"]) if c.get("cp") else ""]))
    return {
        "nombre": c.get("nombre") or sale.get("cliente_nombre") or "Público General",
        "codigo": c.get("codigo") or sale.get("cliente_codigo") or "", "rfc": c.get("rfc") or "",
        "direccion": c.get("direccion") or sale.get("cliente_direccion") or "", "colonia": c.get("colonia") or "",
        "cp": c.get("cp") or "", "ciudad": c.get("ciudad") or "", "municipio": c.get("municipio") or "",
        "estado": c.get("estado_geo") or "", "telefono": tel, "correo": correo,
        "direccion_completa": dir_completa, "saldo": _money(c.get("saldo")), "saldo_num": _num(c.get("saldo")),
    }


def _metodo(m: str, card: str | None = None) -> str:
    nombres = {"efectivo": "Efectivo", "tarjeta": "Tarjeta", "transferencia": "Transferencia",
               "spei": "SPEI", "deposito": "Depósito", "otros": "Otro"}
    base = nombres.get(m or "otros", str(m or "").capitalize())
    if m == "tarjeta" and card in ("debito", "credito"):
        base += " Débito" if card == "debito" else " Crédito"
    return base


def _verificar_url(sale_id: str) -> str:
    base = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    if not sale_id:
        return base or ""
    return f"{base}/verificar/{sale_id}" if base else f"/api/sales/{sale_id}/public"


def _items_venta(items: list) -> list:
    out = []
    for n, it in enumerate(items or [], 1):
        cant = _num(it.get("cantidad"))
        precio = it.get("precio_bruto") if it.get("precio_bruto") is not None else it.get("precio", it.get("precio_neto"))
        precio = _num(precio)
        desc = _num(it.get("descuento"))
        importe = it.get("importe_bruto", it.get("importe"))
        importe = _num(importe) if importe is not None else cant * precio - desc
        base = cant * precio
        out.append({
            "numero": str(n), "codigo": str(it.get("codigo") or ""),
            "descripcion": str(it.get("descripcion") or ""),
            "cantidad": ("%g" % cant) if cant else "0", "cantidad_num": cant,
            "unidad": str(it.get("unidad") or ""), "presentacion": str(it.get("presentacion") or it.get("unidad") or ""),
            "precio": _money(precio), "precio_num": precio,
            "descuento": _money(desc) if desc else "", "descuento_num": desc,
            "descuento_pct": ("%.1f%%" % (desc / base * 100)) if base > 0 and desc > 0 else "",
            "iva": _money(it.get("iva_linea")) if it.get("iva_linea") else "",
            "iva_tasa": ("%g%%" % _num(it.get("iva_tasa"))) if it.get("iva_tasa") else "",
            "importe": _money(importe), "importe_num": importe,
            "comentario": str(it.get("comentario") or ""),
        })
    return out


def contexto_venta(sale: dict, settings: dict, cliente: dict | None = None,
                   cuentas: list | None = None, pago_url: str = "") -> dict:
    sale = sale or {}
    pagos = sale.get("pagos") or []
    recibido = sum(_num(p.get("monto")) for p in pagos)
    items = sale.get("items") or []
    articulos = sum(_num(i.get("cantidad")) for i in items)
    tasas = sorted({_num(i.get("iva_tasa")) for i in items if _num(i.get("iva_tasa")) > 0})
    es_cot = sale.get("tipo_venta") == "cotizacion" or sale.get("estado") == "cotizacion"
    # Fecha y hora del negocio (la venta guarda UTC; antes la carta decía 19:18
    # por una venta de las 13:18).
    dia, hora = storage._fecha_hora_local(sale)
    try:
        letra = storage._num_a_letras(sale.get("total"))
    except Exception:
        letra = ""
    doc = {
        "id": sale.get("id") or "", "folio": sale.get("folio") or "", "serie": sale.get("serie") or "",
        "titulo": "COTIZACIÓN" if es_cot else "NOTA DE VENTA",
        "fecha": dia, "hora": hora,
        "fecha_hora": f"{dia} {hora}".strip(),
        "fecha_vencimiento": str(sale.get("fecha_vencimiento") or "")[:10],
        "condicion": sale.get("condicion") or "contado",
        "condicion_txt": "Crédito" if sale.get("condicion") == "credito" else "Contado",
        "forma_pago": " + ".join(_metodo(p.get("metodo"), p.get("card_type")) for p in pagos)
                      or ("Crédito" if sale.get("condicion") == "credito" else "Contado"),
        "subtotal": _money(sale.get("subtotal")), "subtotal_num": _num(sale.get("subtotal")),
        "descuento": _money(sale.get("descuento_total", sale.get("descuento"))),
        "descuento_num": _num(sale.get("descuento_total", sale.get("descuento"))),
        "iva": _money(sale.get("iva_total")), "iva_num": _num(sale.get("iva_total")),
        "iva_tasas": "%".join("%g" % t for t in tasas) + ("%" if tasas else ""),
        "total": _money(sale.get("total")), "total_num": _num(sale.get("total")),
        "total_letra": letra,
        "saldo": _money(sale.get("saldo")), "saldo_num": _num(sale.get("saldo")),
        "recibido": _money(recibido), "recibido_num": recibido,
        "cambio": _money(sale.get("cambio")), "cambio_num": _num(sale.get("cambio")),
        "articulos": ("%g" % articulos), "articulos_num": articulos,
        "vendedor": sale.get("vendedor_nombre") or sale.get("usuario_nombre") or "",
        "cajero": sale.get("usuario_nombre") or "", "sucursal": sale.get("sucursal_nombre") or "",
        "notas": sale.get("observaciones") or sale.get("notas") or "",
        "estado": sale.get("estado") or "", "tipo_venta": sale.get("tipo_venta") or "",
        "qr_verificar": _verificar_url(sale.get("id")), "qr_pago": pago_url or "",
    }
    return {"empresa": _empresa(settings), "cliente": _cliente(cliente, sale), "doc": doc,
            "items": _items_venta(items), "cuentas": cuentas or [],
            "pagos": [{"metodo": _metodo(p.get("metodo"), p.get("card_type")), "monto": _money(p.get("monto"))}
                      for p in pagos]}


def contexto_abono(abono: dict, settings: dict, cliente: dict | None = None) -> dict:
    abono = abono or {}
    fec = str(abono.get("fecha") or "")
    apps = abono.get("aplicaciones") or []
    try:
        letra = storage._num_a_letras(abono.get("monto"))
    except Exception:
        letra = ""
    suc = (settings or {}).get("sucursales") or [{}]
    doc = {
        "folio": abono.get("folio") or "", "titulo": "COMPROBANTE DE ABONO",
        "fecha": fec[:10], "hora": fec[11:16], "fecha_hora": (fec[:10] + " " + fec[11:16]).strip(),
        "usuario": abono.get("usuario_nombre") or "", "sucursal": (suc[0] or {}).get("nombre", "") if suc else "",
        "documento": apps[0].get("folio", "CxC") if apps else "CxC",
        "documentos": ", ".join(a.get("folio", "") for a in apps if a.get("folio")),
        "metodo": _metodo(abono.get("metodo")), "referencia": abono.get("referencia") or "",
        "monto": _money(abono.get("monto")), "monto_num": _num(abono.get("monto")),
        "total": _money(abono.get("monto")), "total_num": _num(abono.get("monto")), "total_letra": letra,
        "saldo_anterior": _money(abono.get("saldo_anterior")), "saldo_anterior_num": _num(abono.get("saldo_anterior")),
        "saldo_restante": _money(abono.get("saldo_restante")), "saldo_restante_num": _num(abono.get("saldo_restante")),
        "notas": abono.get("notas") or abono.get("comentarios") or "",
    }
    cli = dict(cliente or {})
    cli.setdefault("nombre", abono.get("cliente_nombre") or "")
    return {"empresa": _empresa(settings), "cliente": _cliente(cli), "doc": doc, "items": [], "cuentas": [],
            "pagos": []}


def contexto_compra(compra: dict, settings: dict, proveedor: dict | None = None) -> dict:
    compra = compra or {}
    p = proveedor or {}
    ca = compra.get("costos_adicionales") or {}
    items = []
    for n, it in enumerate(compra.get("items") or [], 1):
        cant, costo = _num(it.get("cantidad")), _num(it.get("costo"))
        imp = _num(it.get("importe")) if it.get("importe") is not None else cant * costo
        items.append({"numero": str(n), "codigo": str(it.get("codigo") or ""),
                      "descripcion": str(it.get("descripcion") or ""), "unidad": str(it.get("unidad") or ""),
                      "presentacion": str(it.get("unidad") or ""), "cantidad": "%g" % cant, "cantidad_num": cant,
                      "precio": _money(costo), "precio_num": costo, "descuento": _money(it.get("descuento")) if _num(it.get("descuento")) else "",
                      "descuento_num": _num(it.get("descuento")), "descuento_pct": "", "iva": "",
                      "importe": _money(imp), "importe_num": imp, "comentario": ""})
    try:
        letra = storage._num_a_letras(compra.get("total"))
    except Exception:
        letra = ""
    tipo_txt = {"compra": "Compra", "gasto": "Gasto", "mixto": "Compra y gasto"}.get(compra.get("tipo"), compra.get("tipo") or "")
    doc = {
        "folio": compra.get("folio") or "", "titulo": "COMPROBANTE DE COMPRA", "tipo": tipo_txt,
        "fecha": str(compra.get("fecha_recepcion") or compra.get("fecha") or "")[:10],
        "factura": compra.get("factura_numero") or "",
        "subtotal": _money(compra.get("subtotal")), "subtotal_num": _num(compra.get("subtotal")),
        "descuento": _money(compra.get("descuento")), "descuento_num": _num(compra.get("descuento")),
        "iva": _money(compra.get("iva")), "iva_num": _num(compra.get("iva")),
        "otros_impuestos": _money(compra.get("otros_impuestos")), "otros_impuestos_num": _num(compra.get("otros_impuestos")),
        "costos_adicionales": _money(ca.get("total")), "costos_adicionales_num": _num(ca.get("total")),
        "total": _money(compra.get("total")), "total_num": _num(compra.get("total")), "total_letra": letra,
        "saldo": _money(compra.get("saldo_pendiente")), "saldo_num": _num(compra.get("saldo_pendiente")),
        "usuario": compra.get("usuario_nombre") or "", "notas": compra.get("observaciones") or "",
        "documentos": str(len(compra.get("documentos") or [])),
    }
    prov = {"nombre": compra.get("proveedor_nombre") or p.get("nombre") or "", "rfc": p.get("rfc") or "",
            "telefono": p.get("telefono") or "", "correo": p.get("email") or p.get("correo") or "",
            "direccion": p.get("direccion") or ""}
    return {"empresa": _empresa(settings), "cliente": {}, "proveedor": prov, "doc": doc,
            "items": items, "cuentas": [], "pagos": []}


def contexto_entrega(mov: dict, caja: dict, settings: dict, efectivo_en_caja=None) -> dict:
    mov = mov or {}
    tipo = (mov.get("tipo") or "").lower()
    titulos = {"retiro": "ENTREGA DE EFECTIVO", "entrada": "ENTRADA DE EFECTIVO",
               "gasto": "COMPROBANTE DE GASTO", "devolucion": "DEVOLUCIÓN"}
    fec = str(mov.get("fecha") or "")
    doc = {
        "folio": mov.get("folio") or "", "titulo": titulos.get(tipo, "COMPROBANTE DE CAJA"), "tipo": tipo,
        "fecha": fec[:10], "hora": fec[11:16], "fecha_hora": (fec[:10] + " " + fec[11:16]).strip(),
        "caja": (caja or {}).get("caja_nombre") or "", "usuario": mov.get("usuario_nombre") or "",
        "concepto": mov.get("concepto") or "", "referencia": mov.get("referencia") or "",
        "monto": _money(mov.get("monto")), "monto_num": _num(mov.get("monto")),
        "total": _money(mov.get("monto")), "total_num": _num(mov.get("monto")),
        "efectivo_en_caja": _money(efectivo_en_caja) if efectivo_en_caja is not None else "",
        "efectivo_en_caja_num": _num(efectivo_en_caja),
    }
    return {"empresa": _empresa(settings), "cliente": {}, "doc": doc, "items": [], "cuentas": [], "pagos": []}


def datos_ejemplo(tipo: str, settings: dict | None = None) -> dict:
    """Contexto sintético para la vista previa del editor."""
    settings = settings or {}
    hoy = datetime.now().strftime("%Y-%m-%d")
    items = [
        {"codigo": "BOL-0102", "descripcion": "Bolsa camiseta jumbo 50x70 negra (paquete 1 kg)", "cantidad": 4,
         "unidad": "PAQ", "precio": 58.0, "descuento": 0, "iva_tasa": 8, "iva_linea": 18.56},
        {"codigo": "VAS-016", "descripcion": "Vaso térmico 16 oz con tapa (caja 25 pzas)", "cantidad": 2,
         "unidad": "CAJA", "precio": 135.5, "descuento": 13.55, "iva_tasa": 8, "iva_linea": 20.6,
         "comentario": "Entregar en bodega"},
        {"codigo": "PEL-1830", "descripcion": "Película estirable 18\" calibre 80", "cantidad": 1,
         "unidad": "ROL", "precio": 289.0, "descuento": 0, "iva_tasa": 8, "iva_linea": 23.12},
    ]
    sub = sum(i["cantidad"] * i["precio"] - i["descuento"] for i in items)
    iva = round(sub * 0.08, 2)
    total = round(sub + iva, 2)
    if tipo == "abono":
        return contexto_abono({"folio": "AB-000123", "fecha": hoy + "T11:42:00", "usuario_nombre": "Ana López",
                               "metodo": "transferencia", "referencia": "SPEI 99812", "monto": 1500,
                               "saldo_anterior": 4250.75, "saldo_restante": 2750.75,
                               "aplicaciones": [{"folio": "V000845"}]}, settings,
                              {"nombre": "Abarrotes La Esperanza", "rfc": "AES010203AB1"})
    if tipo == "compra":
        return contexto_compra({"folio": "CMP000057", "tipo": "compra", "fecha_recepcion": hoy,
                                "factura_numero": "F-5521", "proveedor_nombre": "Distribuidora Plásticos del Norte",
                                "items": [{"codigo": i["codigo"], "descripcion": i["descripcion"], "unidad": i["unidad"],
                                           "cantidad": i["cantidad"] * 10, "costo": round(i["precio"] * 0.62, 2)} for i in items],
                                "subtotal": round(sub * 6.2, 2), "iva": round(sub * 6.2 * 0.08, 2),
                                "total": round(sub * 6.2 * 1.08, 2), "saldo_pendiente": 0,
                                "usuario_nombre": "Compras RYSA", "observaciones": "Mercancía completa."},
                               settings, {"rfc": "DPN990101XX1", "telefono": "656 000 0000"})
    if tipo == "entrega":
        return contexto_entrega({"folio": "RET-000042", "tipo": "retiro", "fecha": hoy + "T18:05:00",
                                 "usuario_nombre": "Caja 1 - María", "concepto": "Entrega de efectivo a gerencia (corte parcial)",
                                 "referencia": "Sobre #12", "monto": 5000}, {"caja_nombre": "Caja 1"}, settings,
                                efectivo_en_caja=1235.5)
    sale = {
        "id": "ejemplo", "folio": "COT000231" if tipo == "cotizacion" else "V000845",
        "tipo_venta": "cotizacion" if tipo == "cotizacion" else "directa",
        "fecha": hoy + "T12:30:00", "hora": "12:30", "fecha_vencimiento": hoy,
        "condicion": "contado", "vendedor_nombre": "Juan Pérez", "usuario_nombre": "Juan Pérez",
        "items": items, "subtotal": round(sub, 2), "descuento_total": 13.55, "iva_total": iva, "total": total,
        "pagos": [{"metodo": "efectivo", "monto": 1000}], "cambio": round(1000 - total, 2) if total < 1000 else 0,
        "cliente_nombre": "Abarrotes La Esperanza", "observaciones": "",
    }
    cuentas = [{"banco": "BBVA", "titular": "Grupo RYSA", "numero_cuenta": "0123456789",
                "clabe": "012180001234567891", "moneda": "MXN"}] if tipo == "cotizacion" else []
    return contexto_venta(sale, settings, {"nombre": "Abarrotes La Esperanza", "rfc": "AES010203AB1",
                                           "direccion": "Av. Juárez 1520", "colonia": "Centro", "cp": "32000",
                                           "ciudad": "Ciudad Juárez", "estado_geo": "Chihuahua",
                                           "telefono": "656 123 4567"},
                          cuentas, pago_url="https://gruporysa.com/pago/comprobante/ejemplo")


# --------------------------------------------------------------------------- #
# Render                                                                       #
# --------------------------------------------------------------------------- #
class _Linea(Flowable):
    """Separador horizontal: sólida, punteada, guiones o doble."""

    def __init__(self, ancho, grosor=0.6, color=colors.black, estilo="solida", antes=2, despues=2):
        super().__init__()
        self.ancho, self.grosor, self.color, self.estilo = ancho, grosor, color, estilo
        self.antes, self.despues = antes, despues

    def wrap(self, aw, ah):
        self.w = min(self.ancho, aw)
        extra = self.grosor * 3 if self.estilo == "doble" else self.grosor
        return self.w, self.antes + extra + self.despues

    def draw(self):
        c = self.canv
        c.setStrokeColor(self.color)
        c.setLineWidth(self.grosor)
        y = self.despues + self.grosor / 2
        if self.estilo == "punteada":
            c.setDash(0.8, 2)
        elif self.estilo == "guiones":
            c.setDash(4, 2.5)
        c.line(0, y, self.w, y)
        if self.estilo == "doble":
            c.line(0, y + self.grosor * 2.5, self.w, y + self.grosor * 2.5)
        c.setDash()


class Renderizador:
    def __init__(self, config: dict, ctx: dict, settings: dict | None = None):
        self.cfg = normalizar(config)
        self.ctx = ctx or {}
        self.settings = settings or {}
        self.pg = self.cfg["pagina"]
        self.formato = self.pg.get("formato") or "carta"
        self.termico = self.formato in ("80mm", "58mm")

    # ---------------- estilos ----------------
    def _est(self, b: dict) -> dict:
        e = dict(b.get("estilo") or {}) if isinstance(b.get("estilo"), dict) else {}
        pg = self.pg
        e.setdefault("fuente", pg.get("fuente") or "Helvetica")
        e.setdefault("tamano", pg.get("tamano_base") or (7.5 if self.termico else 9))
        e.setdefault("color", pg.get("color_texto") or "#1F1F1F")
        e.setdefault("interlineado", pg.get("interlineado") or 1.3)
        e.setdefault("align", "left")
        return e

    def _fuente(self, e: dict) -> str:
        fam = FAMILIAS.get(e.get("fuente"), FAMILIAS["Helvetica"])
        idx = (1 if e.get("negrita") else 0) + (2 if e.get("cursiva") else 0)
        return fam[idx]

    def _pstyle(self, e: dict, **over) -> ParagraphStyle:
        tam = float(over.pop("tamano", e.get("tamano") or 9))
        st = ParagraphStyle(
            "b", fontName=over.pop("fontName", self._fuente(e)), fontSize=tam,
            leading=tam * float(e.get("interlineado") or 1.3),
            textColor=_color(over.pop("color", e.get("color")), colors.black),
            alignment=ALIGN.get(over.pop("align", e.get("align")), TA_LEFT),
        )
        if e.get("mayusculas"):
            st.textTransform = "uppercase"
        if e.get("subrayado"):
            st.underlineWidth = 0.5
        for k, v in over.items():
            setattr(st, k, v)
        return st

    def _p(self, texto: str, e: dict, **over) -> Paragraph:
        t = sustituir(texto, self.ctx)
        if e.get("subrayado"):
            t = f"<u>{t}</u>"
        return Paragraph(t or "&nbsp;", self._pstyle(e, **over))

    def _envolver(self, flows: list, e: dict, ancho: float) -> list:
        """Aplica fondo, borde, padding y márgenes del bloque."""
        pad = e.get("padding") or [0, 0, 0, 0]
        if isinstance(pad, (int, float)):
            pad = [pad] * 4
        pad = (list(pad) + [0, 0, 0, 0])[:4]
        borde = e.get("borde") or {}
        fondo = _color(e.get("fondo"))
        out = []
        if e.get("margen_arriba"):
            out.append(Spacer(1, _mm(e["margen_arriba"])))
        if fondo or float(borde.get("ancho") or 0) > 0 or any(float(x or 0) for x in pad):
            t = Table([[flows]], colWidths=[ancho])
            ts = [("LEFTPADDING", (0, 0), (-1, -1), _mm(pad[3])), ("RIGHTPADDING", (0, 0), (-1, -1), _mm(pad[1])),
                  ("TOPPADDING", (0, 0), (-1, -1), _mm(pad[0])), ("BOTTOMPADDING", (0, 0), (-1, -1), _mm(pad[2])),
                  ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]
            if fondo:
                ts.append(("BACKGROUND", (0, 0), (-1, -1), fondo))
            if float(borde.get("ancho") or 0) > 0:
                ts.append(("BOX", (0, 0), (-1, -1), float(borde["ancho"]), _color(borde.get("color"), colors.black)))
                if float(borde.get("radio") or 0) > 0:
                    ts.append(("ROUNDEDCORNERS", [float(borde["radio"])] * 4))
            t.setStyle(TableStyle(ts))
            out.append(t)
        else:
            out.extend(flows)
        if e.get("margen_abajo"):
            out.append(Spacer(1, _mm(e["margen_abajo"])))
        return out

    # ---------------- bloques ----------------
    def bloques(self, bloques: list, ancho: float) -> list:
        story = []
        for b in bloques or []:
            if not isinstance(b, dict) or b.get("visible") is False:
                continue
            if not evaluar_condicion(b.get("condicion"), self.ctx):
                continue
            fn = getattr(self, "_b_" + str(b.get("tipo")), None)
            if not fn:
                continue
            try:
                flows = fn(b, self._est(b), ancho) or []
            except Exception:
                # Un bloque mal configurado no debe tumbar todo el documento.
                flows = []
            story.extend(flows)
        return story

    def _imagen(self, ruta: str, ancho_mm: float, alto_mm: float, align: str):
        iw, ih = ImageReader(ruta).getSize()
        if not iw or not ih:
            return None
        ar = iw / float(ih)
        w = _mm(ancho_mm or 40)
        h = w / ar
        if alto_mm and h > _mm(alto_mm):
            h = _mm(alto_mm)
            w = h * ar
        img = Image(ruta, width=w, height=h)
        img.hAlign = H_ALIGN.get(align, "CENTER")
        return img

    def _b_logo(self, b, e, ancho):
        fuente = b.get("fuente") or "oficial"
        ruta = self._ruta_archivo(b.get("imagen_url")) if fuente == "imagen" else \
            storage.logo_local(self.settings, "" if fuente == "oficial" else fuente)
        if not ruta:
            return []
        defecto = 54 if self.termico else 50
        img = self._imagen(ruta, min(float(b.get("ancho_mm") or defecto), ancho / mm), b.get("alto_mm"),
                           e.get("align") or "center")
        return self._envolver([img], e, ancho) if img else []

    def _ruta_archivo(self, url: str | None):
        if url and "/api/files/" in url:
            try:
                p = storage.get_safe_local_path(url.split("/api/files/", 1)[1])
                return p if os.path.isfile(p) else None
            except Exception:
                return None
        return None

    def _b_imagen(self, b, e, ancho):
        ruta = self._ruta_archivo(b.get("imagen_url"))
        if not ruta:
            return []
        img = self._imagen(ruta, min(float(b.get("ancho_mm") or 40), ancho / mm), b.get("alto_mm"),
                           e.get("align") or "center")
        return self._envolver([img], e, ancho) if img else []

    def _b_texto(self, b, e, ancho):
        return self._envolver([self._p(b.get("contenido") or "", e)], e, ancho)

    def _b_campos(self, b, e, ancho):
        campos = []
        for c in b.get("campos") or []:
            val = sustituir(c.get("valor") or "", self.ctx)
            if c.get("ocultar_si_vacio", True) and not re.sub(r"<[^>]+>|&nbsp;", "", val).strip():
                continue
            etq = sustituir(c.get("etiqueta") or "", self.ctx)
            sep = b.get("separador", ":")
            etq_txt = (f"<b>{etq}{sep}</b> " if b.get("etiqueta_negrita", True) else f"{etq}{sep} ") if etq else ""
            campos.append(etq_txt + val)
        if not campos:
            return []
        ncol = max(1, min(int(b.get("columnas") or 1), 4))
        st = self._pstyle(e)
        celdas = [Paragraph(t, st) for t in campos]
        filas = [celdas[i:i + ncol] + [""] * (ncol - len(celdas[i:i + ncol])) for i in range(0, len(celdas), ncol)]
        inner_w = ancho - _mm((e.get("padding") or [0, 0, 0, 0])[3] if isinstance(e.get("padding"), list) else 0) \
            - _mm((e.get("padding") or [0, 0, 0, 0])[1] if isinstance(e.get("padding"), list) else 0)
        grid = Table(filas, colWidths=[inner_w / ncol] * ncol)
        grid.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                                  ("TOPPADDING", (0, 0), (-1, -1), 0.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 0.5),
                                  ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        flows = [grid]
        titulo = b.get("titulo")
        if titulo:
            te = dict(e)
            te.update({"negrita": True, "color": b.get("titulo_color") or self.pg.get("color_primario")})
            tp = self._p(titulo, te)
            tf = _color(b.get("titulo_fondo"))
            cont = Table([[tp], [grid]], colWidths=[ancho])
            ts = [("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                  ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
            if tf:
                ts.append(("BACKGROUND", (0, 0), (-1, 0), tf))
            borde = e.get("borde") or {}
            if float(borde.get("ancho") or 0) > 0:
                ts.append(("BOX", (0, 0), (-1, -1), float(borde["ancho"]), _color(borde.get("color"), colors.black)))
            cont.setStyle(TableStyle(ts))
            e2 = {k: v for k, v in e.items() if k not in ("borde", "padding", "fondo")}
            return self._envolver([cont], e2, ancho)
        return self._envolver(flows, e, ancho)

    def _b_tabla_items(self, b, e, ancho):
        items = self.ctx.get("items") or []
        if b.get("modo") == "lista":
            return self._items_lista(b, e, ancho, items)
        cols = b.get("columnas") or [{"campo": c} for c in ("cantidad", "descripcion", "precio", "importe")]
        pesos = [float(c.get("ancho") or (40 if c.get("campo") == "descripcion" else 12)) for c in cols]
        tot = sum(pesos) or 1
        anchos = [ancho * p / tot for p in pesos]
        enc = b.get("encabezado") or {}
        he = dict(e)
        he.update({"negrita": enc.get("negrita", True), "color": enc.get("color") or "#FFFFFF",
                   "tamano": enc.get("tamano") or e.get("tamano")})
        filas = []
        if enc.get("visible", True):
            filas.append([Paragraph(html.escape(c.get("titulo") or CAMPOS_ITEM.get(c.get("campo"), ("",))[0]),
                                    self._pstyle(he, align=c.get("align") or CAMPOS_ITEM.get(c.get("campo"), ("", "left"))[1]))
                          for c in cols])
        for it in items:
            fila = []
            for c in cols:
                campo = c.get("campo")
                txt = html.escape(str(it.get(campo, "")))
                if campo == "descripcion":
                    extras = []
                    if b.get("mostrar_descuento", True) and it.get("descuento_num"):
                        extras.append(f"<font color='{self.pg.get('color_primario') or '#C1401E'}' size='{max(5, float(e['tamano']) - 1.5)}'>desc {html.escape(it.get('descuento'))}</font>")
                    if b.get("mostrar_comentario", True) and it.get("comentario"):
                        extras.append(f"<i><font size='{max(5, float(e['tamano']) - 1.5)}'>* {html.escape(it['comentario'])}</font></i>")
                    if b.get("mostrar_codigo_bajo_descripcion") and it.get("codigo"):
                        extras.insert(0, f"<font size='{max(5, float(e['tamano']) - 1.5)}' color='#6B7280'>{html.escape(it['codigo'])}</font>")
                    if extras:
                        txt += "<br/>" + "<br/>".join(extras)
                fila.append(Paragraph(txt or "&nbsp;", self._pstyle(
                    e, align=c.get("align") or CAMPOS_ITEM.get(campo, ("", "left"))[1])))
            filas.append(fila)
        if not filas:
            return []
        t = Table(filas, colWidths=anchos, repeatRows=1 if enc.get("visible", True) else 0)
        pad = float(b.get("padding_celda") or (0.6 if self.termico else 1.2))
        ts = [("VALIGN", (0, 0), (-1, -1), "TOP"),
              ("LEFTPADDING", (0, 0), (-1, -1), _mm(pad)), ("RIGHTPADDING", (0, 0), (-1, -1), _mm(pad)),
              ("TOPPADDING", (0, 0), (-1, -1), _mm(pad * 0.8)), ("BOTTOMPADDING", (0, 0), (-1, -1), _mm(pad * 0.8))]
        inicio = 1 if enc.get("visible", True) else 0
        if enc.get("visible", True) and _color(enc.get("fondo")):
            ts.append(("BACKGROUND", (0, 0), (-1, 0), _color(enc.get("fondo"))))
        zebra = _color(b.get("zebra"))
        if zebra:
            for r in range(inicio, len(filas)):
                if (r - inicio) % 2 == 1:
                    ts.append(("BACKGROUND", (0, r), (-1, r), zebra))
        cb = _color(b.get("color_borde"), colors.HexColor("#E5E0DA"))
        gb = float(b.get("grosor_borde") or 0.4)
        bordes = b.get("bordes") or "cuadricula"
        if bordes == "cuadricula":
            ts.append(("GRID", (0, inicio), (-1, -1), gb, cb))
        elif bordes == "horizontal":
            ts.append(("LINEBELOW", (0, inicio), (-1, -1), gb, cb))
        elif bordes == "exterior":
            ts.append(("BOX", (0, 0), (-1, -1), gb, cb))
        elif bordes == "encabezado" and inicio:
            ts.append(("LINEBELOW", (0, 0), (-1, 0), gb * 2, cb))
        t.setStyle(TableStyle(ts))
        return self._envolver([t], e, ancho)

    def _items_lista(self, b, e, ancho, items):
        """Formato clásico de ticket: descripción y debajo la línea de importes."""
        plantilla = b.get("plantilla_linea") or "  {{cantidad}} {{unidad}}   {{precio}}   {{importe}}"
        st = self._pstyle(e)
        st2 = self._pstyle(e, tamano=max(5, float(e["tamano"]) - 0.5))
        flows = []
        if b.get("titulo", "DESCRIPCIÓN"):
            te = dict(e)
            te.update({"negrita": True, "align": "center"})
            flows.append(self._p(b.get("titulo", "DESCRIPCIÓN"), te))
        for it in items:
            flows.append(Paragraph(html.escape(it.get("descripcion") or "") or "&nbsp;", st))
            linea = sustituir(plantilla, {**self.ctx, **it, "item": it}).replace(" ", "&nbsp;")
            flows.append(Paragraph(linea, st2))
            if b.get("mostrar_descuento", True) and it.get("descuento_num"):
                flows.append(Paragraph("&nbsp;&nbsp;&nbsp;&nbsp;Descuento -" + html.escape(it.get("descuento")), st2))
            if b.get("mostrar_comentario", True) and it.get("comentario"):
                flows.append(Paragraph("&nbsp;&nbsp;&nbsp;&nbsp;* " + html.escape(it["comentario"]), st2))
        return self._envolver(flows, e, ancho)

    def _b_totales(self, b, e, ancho):
        doc = self.ctx.get("doc") or {}
        filas, destacadas = [], []
        for f in b.get("filas") or []:
            campo = f.get("campo") or "custom"
            if campo == "custom":
                valor = sustituir(f.get("valor") or "", self.ctx)
                num = _num(re.sub(r"<[^>]+>", "", valor))
            else:
                valor = html.escape(str(doc.get(campo, "")))
                num = _num(doc.get(campo + "_num", doc.get(campo)))
            if f.get("ocultar_si_cero", campo not in ("total", "subtotal")) and not num and campo != "custom":
                continue
            if campo == "descuento" and valor and not valor.startswith("-"):
                valor = "-" + valor
            etq = sustituir(f.get("etiqueta") or CAMPOS_TOTAL.get(campo, campo), self.ctx)
            if campo == "iva" and "{{" not in (f.get("etiqueta") or "") and doc.get("iva_tasas") and f.get("mostrar_tasa", True):
                etq = f"{etq} ({doc['iva_tasas']})"
            filas.append((etq, valor, bool(f.get("destacar") or campo == "total"), f.get("color")))
        if not filas:
            return []
        posicion = b.get("posicion") or "derecha"
        pct = float(b.get("ancho_pct") or (100 if self.termico or posicion == "completo" else 55))
        w = ancho * min(max(pct, 20), 100) / 100
        rows, ts = [], [("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                        ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]
        dest = b.get("destacado") or {}
        for i, (etq, val, dst, col) in enumerate(filas):
            if dst:
                de = dict(e)
                de.update({"negrita": True, "tamano": dest.get("tamano") or float(e["tamano"]) + 2.5,
                           "color": dest.get("color") or self.pg.get("color_primario") or e["color"]})
                if col:
                    de["color"] = col
                rows.append([self._p_raw(etq + ":" if b.get("dos_puntos", True) else etq, de, "left"),
                             self._p_raw(val, de, "right")])
                if _color(dest.get("fondo")):
                    ts.append(("BACKGROUND", (0, i), (-1, i), _color(dest.get("fondo"))))
                if dest.get("linea_superior", True):
                    ts.append(("LINEABOVE", (0, i), (-1, i), 1.2, _color(dest.get("color_linea") or self.pg.get("color_primario"), colors.black)))
            else:
                ne = dict(e)
                if col:
                    ne["color"] = col
                rows.append([self._p_raw(etq + ":" if b.get("dos_puntos", True) else etq, ne, "left"),
                             self._p_raw(val, ne, "right")])
        t = Table(rows, colWidths=[w * 0.6, w * 0.4])
        t.setStyle(TableStyle(ts))
        t.hAlign = {"derecha": "RIGHT", "izquierda": "LEFT", "centro": "CENTER"}.get(posicion, "CENTER")
        return self._envolver([t], e, ancho)

    def _p_raw(self, texto_seguro: str, e: dict, align: str) -> Paragraph:
        return Paragraph(texto_seguro or "&nbsp;", self._pstyle(e, align=align))

    def _b_qr(self, b, e, ancho):
        contenido = sustituir(b.get("contenido") or "{{doc.qr_verificar}}", self.ctx, escapar=False).strip()
        if not contenido:
            return []
        img = qrcode.make(contenido, box_size=10, border=2)
        bio = io.BytesIO()
        img.save(bio, format="PNG")
        bio.seek(0)
        lado = _mm(b.get("tamano_mm") or (18 if self.termico else 27))
        q = Image(bio, width=lado, height=lado)
        leyenda = b.get("leyenda") or ""
        disp = b.get("disposicion") or ("abajo" if self.termico else "derecha")
        if not leyenda:
            q.hAlign = H_ALIGN.get(e.get("align") or "center", "CENTER")
            return self._envolver([q], e, ancho)
        lp = self._p(leyenda, e)
        if disp == "derecha":
            t = Table([[q, lp]], colWidths=[lado + 4 * mm, None])
            t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
            return self._envolver([t], e, ancho)
        q.hAlign = H_ALIGN.get(e.get("align") or "center", "CENTER")
        return self._envolver([q, Spacer(1, 1.5 * mm), lp], e, ancho)

    def _b_firmas(self, b, e, ancho):
        firmas = b.get("firmas") or ["Firma"]
        n = len(firmas)
        linea_pct = float(b.get("ancho_linea_pct") or 80)
        celdas = []
        for f in firmas:
            lw = (ancho / n) * linea_pct / 100
            celdas.append([Spacer(1, _mm(b.get("espacio_mm") or 12)),
                           _Linea(lw, 0.6, _color(e.get("color"), colors.black), "solida", 0, 1),
                           self._p(f, dict(e, align="center"))])
        t = Table([celdas], colWidths=[ancho / n] * n)
        t.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "BOTTOM")]))
        return self._envolver([t], e, ancho)

    def _b_cuentas_bancarias(self, b, e, ancho):
        import bancos as _bancos
        cuentas = self.ctx.get("cuentas") or []
        if not cuentas:
            return []
        flows = []
        if b.get("titulo"):
            te = dict(e)
            te.update({"negrita": True, "tamano": float(e["tamano"]) + 4, "color": self.pg.get("color_primario")})
            flows += [self._p(b["titulo"], te), Spacer(1, 2 * mm)]
        prim = self.pg.get("color_primario") or "#C1401E"
        for cta in cuentas:
            lineas = [f"<b><font color='{prim}'>{html.escape(cta.get('banco') or 'Banco')}</font></b>"
                      + (f" · {html.escape(cta['alias'])}" if cta.get("alias") else "")]
            for etq, k in (("Titular", "titular"), ("Cuenta", "numero_cuenta"), ("Sucursal", "sucursal"),
                           ("CLABE", "clabe"), ("Tarjeta", "tarjeta")):
                if cta.get(k):
                    lineas.append(f"<b>{etq}:</b> {html.escape(str(cta[k]))}")
            st = self._pstyle(e)
            info = [Paragraph(l, st) for l in lineas]
            logo = None
            if b.get("mostrar_logo", True):
                lp = _bancos.ruta_logo(cta.get("banco"))
                if lp:
                    try:
                        logo = self._imagen(lp, 28, 14, "center")
                    except Exception:
                        logo = None
            celda = logo or Paragraph(f"<b><font size='15' color='{prim}'>{html.escape((cta.get('banco') or 'B')[:2].upper())}</font></b>", st)
            box = Table([[celda, info]], colWidths=[34 * mm, ancho - 34 * mm])
            box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#E5E0DA")),
                                     ("LINEBEFORE", (0, 0), (0, -1), 3, _color(prim)),
                                     ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                                     ("LEFTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 4),
                                     ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
            flows += [box, Spacer(1, 2.5 * mm)]
        return self._envolver(flows, e, ancho)

    def _b_pagos(self, b, e, ancho):
        pagos = self.ctx.get("pagos") or []
        if not pagos:
            return []
        rows = [[self._p_raw(html.escape(p["metodo"]), e, "left"), self._p_raw(html.escape(p["monto"]), e, "right")]
                for p in pagos]
        if b.get("titulo"):
            rows.insert(0, [self._p(b["titulo"], dict(e, negrita=True)), ""])
        t = Table(rows, colWidths=[ancho * 0.6, ancho * 0.4])
        t.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                               ("TOPPADDING", (0, 0), (-1, -1), 0.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 0.5)]))
        return self._envolver([t], e, ancho)

    def _b_separador(self, b, e, ancho):
        return [_Linea(ancho * float(b.get("ancho_pct") or 100) / 100, float(b.get("grosor") or 0.6),
                       _color(b.get("color") or e.get("color"), colors.black), b.get("linea") or "solida",
                       _mm(b.get("espacio_antes") if b.get("espacio_antes") is not None else 1.2),
                       _mm(b.get("espacio_despues") if b.get("espacio_despues") is not None else 1.2))]

    def _b_espacio(self, b, e, ancho):
        return [Spacer(1, _mm(b.get("alto_mm") or 4))]

    def _b_salto_pagina(self, b, e, ancho):
        return [] if self.termico else [PageBreak()]

    def _b_columnas(self, b, e, ancho):
        cols = b.get("columnas") or []
        if not cols:
            return []
        pesos = [float(c.get("ancho") or 1) for c in cols]
        tot = sum(pesos) or 1
        sep = _mm(b.get("separacion_mm") or 4)
        anchos = [(ancho - sep * (len(cols) - 1)) * p / tot for p in pesos]
        celdas = [self.bloques(c.get("bloques") or [], anchos[i]) or [Spacer(1, 1)] for i, c in enumerate(cols)]
        widths = []
        for i, a in enumerate(anchos):
            widths.append(a + (sep if i < len(anchos) - 1 else 0))
        t = Table([celdas], colWidths=widths)
        va = {"arriba": "TOP", "centro": "MIDDLE", "abajo": "BOTTOM"}.get(b.get("alinear_vertical"), "TOP")
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), va), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                               ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        return self._envolver([t], e, ancho)

    # ---------------- documento ----------------
    def pdf(self) -> bytes:
        pg = self.pg
        mg = pg.get("margenes") or {}
        izq, der = _mm(mg.get("izquierda", 4 if self.termico else 15)), _mm(mg.get("derecha", 4 if self.termico else 15))
        arr, aba = _mm(mg.get("arriba", 4 if self.termico else 15)), _mm(mg.get("abajo", 4 if self.termico else 14))
        copias = max(1, min(int(pg.get("copias") or 1), 3))
        titulo = sustituir("{{doc.titulo}} {{doc.folio}}", self.ctx, escapar=False).strip() or "Documento"

        if self.termico:
            W = TAMANOS[self.formato][0]
            ancho = W - izq - der - 12  # Frame de platypus: 6 pt de padding por lado
            una = self.bloques(self.cfg["bloques"], ancho)
            story = []
            for i in range(copias):
                if copias > 1:
                    etq = "— COPIA CLIENTE —" if i == 0 else "— COPIA COMERCIO —" if i == 1 else f"— COPIA {i + 1} —"
                    story.append(Paragraph(etq, self._pstyle(self._est({}), align="center", tamano=6,
                                                             fontName="Helvetica-Bold")))
                story += copy.deepcopy(una) if i else una
                if i < copias - 1:
                    story.append(_Linea(ancho, 0.5, colors.black, "guiones", 3 * mm, 3 * mm))
            alto = 0.0
            for f in story:
                _, h = f.wrap(ancho, 10 ** 6)
                alto += h + f.getSpaceBefore() + f.getSpaceAfter()
            H = max(alto + arr + aba + 12 + 6 * mm, 40 * mm)
            buf = io.BytesIO()
            d = SimpleDocTemplate(buf, pagesize=(W, H), leftMargin=izq, rightMargin=der, topMargin=arr,
                                  bottomMargin=aba, title=titulo, author=self.ctx.get("empresa", {}).get("nombre", ""))
            d.build(story)
            return buf.getvalue()

        size = TAMANOS.get(self.formato, letter)
        if pg.get("orientacion") == "horizontal":
            size = landscape(size)
        ancho = size[0] - izq - der - 12  # Frame de platypus: 6 pt de padding por lado
        una = self.bloques(self.cfg["bloques"], ancho)
        story = []
        for i in range(copias):
            story += copy.deepcopy(una) if i else una
            if i < copias - 1:
                story.append(PageBreak())
        buf = io.BytesIO()
        d = SimpleDocTemplate(buf, pagesize=size, leftMargin=izq, rightMargin=der, topMargin=arr,
                              bottomMargin=aba, title=titulo, author=self.ctx.get("empresa", {}).get("nombre", ""))
        marca = pg.get("marca_agua") or {}
        pie = pg.get("pie_pagina") or {}
        ctx = self.ctx

        def decorar(canv, doc_):
            canv.saveState()
            if marca.get("texto"):
                canv.setFillColor(_color(marca.get("color"), colors.HexColor("#C1401E")))
                try:
                    canv.setFillAlpha(float(marca.get("opacidad") or 0.08))
                except Exception:
                    pass
                canv.setFont("Helvetica-Bold", float(marca.get("tamano") or 60))
                canv.translate(size[0] / 2, size[1] / 2)
                canv.rotate(float(marca.get("angulo") if marca.get("angulo") is not None else 35))
                canv.drawCentredString(0, 0, sustituir(marca["texto"], ctx, escapar=False))
                canv.restoreState()
                canv.saveState()
            texto = sustituir(pie.get("texto") or "", ctx, escapar=False)
            if pie.get("numerar"):
                texto = (texto + "   " if texto else "") + f"Página {doc_.page}"
            if texto:
                canv.setFont("Helvetica", float(pie.get("tamano") or 7.5))
                canv.setFillColor(_color(pie.get("color"), colors.HexColor("#6B7280")))
                canv.drawCentredString(size[0] / 2, max(aba / 2, 5 * mm), texto)
            canv.restoreState()

        d.build(story, onFirstPage=decorar, onLaterPages=decorar)
        return buf.getvalue()


def normalizar(config: dict) -> dict:
    """Devuelve una plantilla de esquema 2. Convierte plantillas antiguas
    (esquema 1: `elementos`, `formato_fisico`) a lo más parecido posible."""
    cfg = copy.deepcopy(config or {})
    if cfg.get("esquema") == ESQUEMA and isinstance(cfg.get("bloques"), list):
        cfg.setdefault("pagina", {})
        return cfg
    fmt = cfg.get("formato_fisico") or (cfg.get("pagina") or {}).get("formato") or "carta"
    bloques = []
    for el in cfg.get("elementos") or []:
        t = el.get("tipo")
        e = {"align": el.get("align", "left"), "negrita": el.get("bold", False)}
        if el.get("font_size"):
            e["tamano"] = el["font_size"]
        if t == "logo":
            bloques.append({"tipo": "logo", "estilo": e})
        elif t in ("texto", "campo"):
            bloques.append({"tipo": "texto", "contenido": el.get("contenido", ""), "estilo": e})
        elif t == "empresa":
            bloques.append({"tipo": "texto", "contenido": "{{empresa.nombre}}", "estilo": e})
        elif t == "separador":
            bloques.append({"tipo": "separador", "linea": "guiones"})
        elif t == "espaciador":
            bloques.append({"tipo": "espacio", "alto_mm": 4})
        elif t == "tabla_productos":
            bloques.append({"tipo": "tabla_items", "columnas": [
                {"campo": c.get("campo"), "titulo": c.get("titulo"), "ancho": c.get("ancho_pct"), "align": c.get("align")}
                for c in el.get("columnas") or []] or None})
        elif t == "totales_linea":
            bloques.append({"tipo": "texto", "contenido": f"{el.get('etiqueta', '')}: {el.get('valor', '')}",
                            "estilo": dict(e, align="right")})
        elif t == "qr":
            bloques.append({"tipo": "qr"})
    return {"esquema": ESQUEMA, "pagina": {"formato": fmt, "fuente": cfg.get("fuente") or "Helvetica"},
            "bloques": bloques}


def render(config: dict, ctx: dict, settings: dict | None = None) -> bytes:
    return Renderizador(config, ctx, settings).pdf()
