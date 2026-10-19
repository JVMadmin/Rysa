"""Plantillas PREDETERMINADAS del Editor de formatos (esquema 2).

Cada una replica, con bloques editables, el documento que hoy genera
storage.py para ese tipo. Son el punto de partida cuando el usuario pulsa
"Personalizar": el predeterminado del sistema (storage.py) nunca se modifica
y siempre se puede restaurar.

Colores institucionales: terracota #C1401E, tinta #1F1F1F, gris #6B7280,
crema #F4ECE7, línea #E5E0DA.
"""
import copy
import uuid

TERRA, INK, GRIS, CREMA, LINEA = "#C1401E", "#1F1F1F", "#6B7280", "#F4ECE7", "#E5E0DA"

SI = lambda var: {"variable": var, "op": "no_vacio"}          # noqa: E731
CONTADO = {"variable": "doc.condicion", "op": "!=", "valor": "credito"}
CREDITO = {"variable": "doc.condicion", "op": "==", "valor": "credito"}


def _t(contenido, cond=None, **estilo):
    b = {"tipo": "texto", "contenido": contenido, "estilo": estilo}
    if cond:
        b["condicion"] = cond
    return b


def _sep(linea="solida", grosor=0.6, color=LINEA, antes=1.5, despues=2.5):
    return {"tipo": "separador", "linea": linea, "grosor": grosor, "color": color,
            "espacio_antes": antes, "espacio_despues": despues}


def _encabezado_carta(logo_derecha=True, logo_ancho=44, logo_alto=22, nombre_tam=14, nombre_color=INK):
    empresa = [
        _t("<b>{{empresa.nombre}}</b>", tamano=nombre_tam, color=nombre_color, interlineado=1.25),
        _t("{{empresa.razon_social}}", SI("empresa.razon_social"), tamano=8.5, color=GRIS),
        _t("RFC: {{empresa.rfc}}", SI("empresa.rfc"), tamano=8.5, color=GRIS),
        _t("{{empresa.direccion}}", SI("empresa.direccion"), tamano=8.5, color=GRIS),
        _t("{{empresa.ciudad}}, {{empresa.estado}}, {{empresa.cp}}", SI("empresa.ciudad"), tamano=8.5, color=GRIS),
        _t("Tel: {{empresa.telefono}}", SI("empresa.telefono"), tamano=8.5, color=GRIS),
        _t("{{empresa.correo}}", SI("empresa.correo"), tamano=8.5, color=GRIS),
    ]
    logo = [{"tipo": "logo", "fuente": "oficial", "ancho_mm": logo_ancho, "alto_mm": logo_alto,
             "estilo": {"align": "right" if logo_derecha else "left"}}]
    cols = [{"ancho": 72, "bloques": empresa}, {"ancho": 28, "bloques": logo}]
    if not logo_derecha:
        cols = [{"ancho": 28, "bloques": logo}, {"ancho": 72, "bloques": empresa}]
    return [{"tipo": "columnas", "columnas": cols, "alinear_vertical": "arriba" if logo_derecha else "centro"},
            _sep(grosor=2, color=TERRA, antes=2, despues=3.5)]


def _caja_titulo(titulo, campos, fondo=CREMA, columnas=1, tamano=9):
    return {"tipo": "campos", "titulo": titulo, "titulo_fondo": fondo, "titulo_color": TERRA,
            "columnas": columnas, "campos": campos,
            "estilo": {"tamano": tamano, "borde": {"ancho": 0.6, "color": LINEA}}}


def _tabla(columnas, tamano=8):
    return {"tipo": "tabla_items", "modo": "tabla", "columnas": columnas, "bordes": "cuadricula",
            "color_borde": LINEA, "grosor_borde": 0.4, "padding_celda": 1.2,
            "encabezado": {"visible": True, "fondo": TERRA, "color": "#FFFFFF", "negrita": True, "tamano": 8.5},
            "mostrar_descuento": True, "mostrar_comentario": True,
            "estilo": {"tamano": tamano, "margen_abajo": 2}}


def _pagina_carta(**extra):
    p = {"formato": "carta", "orientacion": "vertical",
         "margenes": {"arriba": 18, "abajo": 16, "izquierda": 16, "derecha": 16},
         "fuente": "Helvetica", "tamano_base": 9, "color_texto": INK, "color_primario": TERRA,
         "color_secundario": GRIS, "interlineado": 1.4, "copias": 1,
         "marca_agua": {"texto": "", "color": TERRA, "opacidad": 0.07, "tamano": 64, "angulo": 35},
         "pie_pagina": {"texto": "", "numerar": False, "tamano": 7.5, "color": GRIS}}
    p.update(extra)
    return p


TICKET = {
    "esquema": 2,
    "pagina": {"formato": "80mm", "margenes": {"arriba": 6, "abajo": 6, "izquierda": 4, "derecha": 4},
               "fuente": "Helvetica", "tamano_base": 7, "color_texto": "#000000", "color_primario": "#000000",
               "interlineado": 1.45, "copias": 1},
    "bloques": [
        {"tipo": "logo", "fuente": "oficial", "ancho_mm": 54, "alto_mm": 26,
         "estilo": {"align": "center", "margen_abajo": 2}},
        _t("{{empresa.razon_social}}", SI("empresa.razon_social"), align="center", tamano=8),
        _t("<b>{{empresa.nombre}}</b>", align="center", tamano=11),
        _t("RFC: {{empresa.rfc}}", SI("empresa.rfc"), align="center"),
        _t("{{empresa.direccion}} {{empresa.ciudad}} {{empresa.estado}} {{empresa.cp}}",
           SI("empresa.direccion"), align="center"),
        _t("Tel: {{empresa.telefono}}", SI("empresa.telefono"), align="center"),
        _t("Email: {{empresa.correo}}", SI("empresa.correo"), align="center"),
        _sep("guiones", 0.5, "#000000"),
        _t("Serie: {{doc.serie}}", SI("doc.serie"), align="center"),
        _t("<b>FOLIO: {{doc.folio}}</b>", align="center"),
        _t("Fecha: {{doc.fecha}} {{doc.hora}}", align="center"),
        _t("Cliente: {{cliente.nombre}}", align="center"),
        _sep("guiones", 0.5, "#000000"),
        {"tipo": "tabla_items", "modo": "lista", "titulo": "DESCRIPCIÓN",
         "plantilla_linea": "  {{cantidad}} {{unidad}}   {{precio}}   {{importe}}",
         "mostrar_descuento": True, "mostrar_comentario": True, "estilo": {"tamano": 7}},
        _sep("guiones", 0.5, "#000000"),
        _t("Subtotal: {{doc.subtotal}}", align="center"),
        _t("IVA: {{doc.iva}}", SI("doc.iva_num"), align="center"),
        _t("Descuento: -{{doc.descuento}}", SI("doc.descuento_num"), align="center"),
        _t("<b>TOTAL: {{doc.total}}</b>", align="center", tamano=9),
        _t("<b>({{doc.total_letra}})</b>", align="center", tamano=7.5),
        _t("** VENTA A CRÉDITO ** Saldo: {{doc.saldo}}", CREDITO, align="center"),
        _t("Recibido: {{doc.recibido}}", CONTADO, align="center"),
        _t("Cambio: {{doc.cambio}}", CONTADO, align="center"),
        _t("Artículos vendidos: {{doc.articulos}}", align="center"),
        _t("Atendido por: {{doc.vendedor}}", SI("doc.vendedor"), align="center"),
        _sep("guiones", 0.5, "#000000"),
        _t("VERIFIQUE SU COMPRA Y SU CAMBIO", align="center", tamano=7.5),
        _t("¡Gracias por su compra!", align="center", tamano=7.5),
        {"tipo": "qr", "contenido": "{{doc.qr_verificar}}", "tamano_mm": 18,
         "estilo": {"align": "center", "margen_arriba": 2}},
    ],
}

CARTA_VENTA = {
    "esquema": 2,
    "pagina": _pagina_carta(),
    "bloques": _encabezado_carta() + [
        _t("<b>DOCUMENTO DE VENTA</b>", tamano=13, color=TERRA, margen_abajo=1),
        {"tipo": "campos", "columnas": 1, "campos": [
            {"etiqueta": "Folio", "valor": "{{doc.folio}}"},
            {"etiqueta": "Fecha", "valor": "{{doc.fecha}}"},
            {"etiqueta": "Hora", "valor": "{{doc.hora}}"},
            {"etiqueta": "Vendedor", "valor": "{{doc.vendedor}}"},
            {"etiqueta": "Método de pago", "valor": "{{doc.forma_pago}}"},
            {"etiqueta": "Sucursal", "valor": "{{doc.sucursal}}"},
        ], "estilo": {"tamano": 9}},
        _sep(antes=2, despues=3),
        _caja_titulo("CLIENTE", [
            {"etiqueta": "Nombre / Razón social", "valor": "{{cliente.nombre}}"},
            {"etiqueta": "RFC", "valor": "{{cliente.rfc}}"},
            {"etiqueta": "Teléfono", "valor": "{{cliente.telefono}}"},
            {"etiqueta": "Email", "valor": "{{cliente.correo}}"},
            {"etiqueta": "Dirección", "valor": "{{cliente.direccion_completa}}"},
        ]),
        {"tipo": "espacio", "alto_mm": 3},
        _tabla([{"campo": "codigo", "titulo": "Código", "ancho": 20},
                {"campo": "descripcion", "titulo": "Descripción", "ancho": 74},
                {"campo": "unidad", "titulo": "Und.", "ancho": 12},
                {"campo": "cantidad", "titulo": "Cant.", "ancho": 16, "align": "right"},
                {"campo": "precio", "titulo": "Precio", "ancho": 28, "align": "right"},
                {"campo": "importe", "titulo": "Importe", "ancho": 32, "align": "right"}]),
        {"tipo": "espacio", "alto_mm": 2},
        {"tipo": "totales", "posicion": "derecha", "ancho_pct": 82, "estilo": {"tamano": 9.5},
         "destacado": {"tamano": 12, "color": TERRA, "linea_superior": True},
         "filas": [{"campo": "subtotal"}, {"campo": "descuento", "color": TERRA},
                   {"campo": "iva", "mostrar_tasa": False}, {"campo": "total", "destacar": True},
                   {"campo": "saldo", "etiqueta": "Saldo pendiente", "color": "#DC2626"}]},
        {"tipo": "espacio", "alto_mm": 7},
        _sep(antes=2, despues=3.5),
        _t("<b>OBSERVACIONES</b><br/>{{doc.notas}}", SI("doc.notas"), margen_abajo=3),
        _t("<b>¡GRACIAS POR SU PREFERENCIA!</b>", align="center", tamano=11, color=TERRA),
        _t("{{empresa.nombre}} · RFC: {{empresa.rfc}}", align="center", tamano=8, color=GRIS),
        _t("Verifica tu comprobante en: {{doc.qr_verificar}}", SI("doc.id"), align="center", tamano=8, color=GRIS),
    ],
}

COTIZACION = {
    "esquema": 2,
    "pagina": _pagina_carta(margenes={"arriba": 16, "abajo": 14, "izquierda": 15, "derecha": 15}),
    "bloques": [
        {"tipo": "columnas", "alinear_vertical": "arriba", "columnas": [
            {"ancho": 54, "bloques": [
                {"tipo": "logo", "fuente": "oficial", "ancho_mm": 58, "alto_mm": 27,
                 "estilo": {"align": "left", "margen_abajo": 1.5}},
                _t("<b>{{empresa.nombre}}</b>", tamano=13.5, color=TERRA, interlineado=1.25),
                _t("{{empresa.direccion}}", SI("empresa.direccion")),
                _t("{{empresa.ciudad}}, {{empresa.estado}}", SI("empresa.ciudad")),
                _t("{{empresa.pais}}"),
                _t("{{empresa.colonia}} C.P. {{empresa.cp}}", SI("empresa.cp")),
                _t("RFC: {{empresa.rfc}}", SI("empresa.rfc")),
                _t("Tel: {{empresa.telefono}}", SI("empresa.telefono")),
            ]},
            {"ancho": 46, "bloques": [
                _t("<b>FOLIO:</b> <b>{{doc.folio}}</b>", align="right", tamano=9.5),
                _t("<b>Fecha de emisión:</b> {{doc.fecha}}", align="right", tamano=9.5),
                _t("<b>Fecha de vencimiento:</b> {{doc.fecha_vencimiento}}", align="right", tamano=9.5),
                _t("<b>Condición:</b> {{doc.condicion_txt}}", align="right", tamano=9.5),
            ]},
        ]},
        _sep(grosor=2.2, color=TERRA, antes=2, despues=3),
        _t("<b>COTIZACIÓN</b>", tamano=17, color=TERRA),
        _sep(antes=1, despues=3),
        _caja_titulo("CLIENTE", [
            {"etiqueta": "Nombre / Razón social", "valor": "{{cliente.nombre}}", "ocultar_si_vacio": False},
            {"etiqueta": "Calle", "valor": "{{cliente.direccion}}"},
            {"etiqueta": "Colonia", "valor": "{{cliente.colonia}}"},
            {"etiqueta": "C.P.", "valor": "{{cliente.cp}}"},
            {"etiqueta": "Localidad", "valor": "{{cliente.ciudad}}"},
            {"etiqueta": "Estado", "valor": "{{cliente.estado}}"},
            {"etiqueta": "RFC", "valor": "{{cliente.rfc}}"},
            {"etiqueta": "Teléfono", "valor": "{{cliente.telefono}}"},
        ], columnas=2),
        {"tipo": "espacio", "alto_mm": 3},
        _tabla([{"campo": "cantidad", "titulo": "Cant.", "ancho": 15, "align": "right"},
                {"campo": "unidad", "titulo": "Unidad", "ancho": 15, "align": "center"},
                {"campo": "codigo", "titulo": "Código", "ancho": 22},
                {"campo": "descripcion", "titulo": "Descripción", "ancho": 63},
                {"campo": "descuento_pct", "titulo": "% Desc.", "ancho": 14, "align": "center"},
                {"campo": "precio", "titulo": "P. Unitario", "ancho": 24, "align": "right"},
                {"campo": "importe", "titulo": "Importe", "ancho": 25, "align": "right"}]),
        {"tipo": "espacio", "alto_mm": 2},
        {"tipo": "totales", "posicion": "derecha", "ancho_pct": 83, "estilo": {"tamano": 9.5},
         "destacado": {"tamano": 13, "color": TERRA, "linea_superior": True},
         "filas": [{"campo": "subtotal"}, {"campo": "descuento", "color": TERRA},
                   {"campo": "iva"}, {"campo": "total", "destacar": True}]},
        _t("Son: <b>({{doc.total_letra}})</b>", tamano=8.5, color=GRIS, cursiva=True, margen_arriba=1.5),
        {"tipo": "firmas", "firmas": ["Atentamente<br/><b>{{doc.vendedor}}</b>"], "espacio_mm": 7,
         "ancho_linea_pct": 45, "estilo": {"tamano": 9.5, "margen_arriba": 1}},
        _sep(antes=2.5, despues=2),
        _t("Esta cotización es válida hasta el {{doc.fecha_vencimiento}}. Precios sujetos a cambio sin previo aviso.",
           align="center", tamano=7.5, color=GRIS),
        _t("{{empresa.nombre}} · RFC: {{empresa.rfc}} · Tel: {{empresa.telefono}}", align="center", tamano=7.5, color=GRIS),
        {"tipo": "qr", "contenido": "{{doc.qr_pago}}", "tamano_mm": 23, "disposicion": "derecha",
         "leyenda": "<b>¿Ya realizaste tu pago?</b><br/>Escanea este código para enviar tu comprobante.",
         "condicion": SI("doc.qr_pago"),
         "estilo": {"tamano": 9, "margen_arriba": 3, "padding": [1.5, 2, 1.5, 2], "borde": {"ancho": 0.9, "color": LINEA}}},
        {"tipo": "salto_pagina", "condicion": SI("cuentas")},
        {"tipo": "columnas", "condicion": SI("cuentas"), "alinear_vertical": "centro", "columnas": [
            {"ancho": 30, "bloques": [{"tipo": "logo", "fuente": "oficial", "ancho_mm": 50, "alto_mm": 24,
                                       "estilo": {"align": "left"}}]},
            {"ancho": 70, "bloques": [_t("<b>FORMAS DE PAGO</b>", tamano=17, color=TERRA),
                                      _t("Cuentas bancarias de {{empresa.nombre}}", tamano=8.5, color=GRIS, cursiva=True)]},
        ]},
        dict(_sep(grosor=2.2, color=TERRA, antes=2, despues=4), condicion=SI("cuentas")),
        {"tipo": "cuentas_bancarias", "mostrar_logo": True, "estilo": {"tamano": 9}},
        _t("Realizado su pago, envíe su comprobante a su asesor de ventas. Gracias por su preferencia.",
           SI("cuentas"), align="center", tamano=7.5, color=GRIS, margen_arriba=2),
    ],
}

ABONO = {
    "esquema": 2,
    "pagina": _pagina_carta(),
    "bloques": _encabezado_carta(logo_ancho=40, logo_alto=20) + [
        _t("<b>COMPROBANTE DE ABONO</b>", align="center", tamano=15, color="#FFFFFF", fondo=TERRA,
           padding=[2.5, 0, 2.5, 0], margen_abajo=2),
        {"tipo": "campos", "columnas": 3, "campos": [
            {"etiqueta": "Folio", "valor": "{{doc.folio}}"}, {"etiqueta": "Fecha", "valor": "{{doc.fecha}}"},
            {"etiqueta": "Hora", "valor": "{{doc.hora}}"}], "estilo": {"tamano": 9.5}},
        {"tipo": "campos", "columnas": 3, "campos": [
            {"etiqueta": "Usuario", "valor": "{{doc.usuario}}"}, {"etiqueta": "Sucursal", "valor": "{{doc.sucursal}}"}],
         "estilo": {"tamano": 9.5}},
        _sep(antes=2, despues=3.5),
        _caja_titulo("CLIENTE", [{"etiqueta": "Cliente", "valor": "{{cliente.nombre}}"},
                                 {"etiqueta": "Documento", "valor": "{{doc.documento}}"}], tamano=9.5),
        {"tipo": "espacio", "alto_mm": 4},
        {"tipo": "totales", "posicion": "centro", "ancho_pct": 82, "estilo": {"tamano": 10.5},
         "destacado": {"tamano": 13, "color": TERRA, "linea_superior": True},
         "filas": [{"campo": "saldo_anterior", "ocultar_si_cero": False},
                   {"campo": "monto", "etiqueta": "ABONO", "destacar": True},
                   {"campo": "saldo_restante", "etiqueta": "SALDO RESTANTE", "destacar": True, "color": INK,
                    "ocultar_si_cero": False},
                   {"campo": "custom", "etiqueta": "Método", "valor": "{{doc.metodo}}"},
                   {"campo": "custom", "etiqueta": "Referencia", "valor": "{{doc.referencia}}"}]},
        {"tipo": "espacio", "alto_mm": 9},
        _t("<b>¡GRACIAS POR SU PAGO!</b>", align="center", tamano=11, color="#FFFFFF", fondo=TERRA,
           padding=[2, 0, 2, 0]),
        _t("<b>{{empresa.nombre}} · RFC: {{empresa.rfc}}</b>", align="center", tamano=8.5, color="#FFFFFF",
           fondo=INK, padding=[2, 0, 2, 0]),
    ],
}

COMPRA = {
    "esquema": 2,
    "pagina": _pagina_carta(),
    "bloques": _encabezado_carta(logo_derecha=False, logo_ancho=46, logo_alto=22, nombre_tam=12) + [
        _t("<b>COMPROBANTE DE COMPRA</b>", tamano=15, color=TERRA, margen_abajo=1),
        {"tipo": "campos", "columnas": 2, "campos": [
            {"etiqueta": "Folio", "valor": "{{doc.folio}}"}, {"etiqueta": "Tipo", "valor": "{{doc.tipo}}"},
            {"etiqueta": "Fecha recepción", "valor": "{{doc.fecha}}"}, {"etiqueta": "Factura", "valor": "{{doc.factura}}"},
            {"etiqueta": "Proveedor", "valor": "{{proveedor.nombre}}"}], "estilo": {"tamano": 9}},
        _sep(antes=2, despues=3),
        _caja_titulo("PROVEEDOR", [{"etiqueta": "", "valor": "<b>{{proveedor.nombre}}</b>"},
                                   {"etiqueta": "RFC", "valor": "{{proveedor.rfc}}"},
                                   {"etiqueta": "Teléfono", "valor": "{{proveedor.telefono}}"},
                                   {"etiqueta": "Email", "valor": "{{proveedor.correo}}"},
                                   {"etiqueta": "Dirección", "valor": "{{proveedor.direccion}}"}], fondo="#FDF4F0"),
        {"tipo": "espacio", "alto_mm": 3},
        _tabla([{"campo": "codigo", "titulo": "Código", "ancho": 22},
                {"campo": "descripcion", "titulo": "Descripción", "ancho": 78},
                {"campo": "unidad", "titulo": "Und.", "ancho": 14},
                {"campo": "cantidad", "titulo": "Cant.", "ancho": 18, "align": "right"},
                {"campo": "precio", "titulo": "Costo", "ancho": 26, "align": "right"},
                {"campo": "importe", "titulo": "Importe", "ancho": 32, "align": "right"}]),
        {"tipo": "espacio", "alto_mm": 2},
        {"tipo": "totales", "posicion": "derecha", "ancho_pct": 82, "estilo": {"tamano": 9},
         "destacado": {"tamano": 10, "color": INK, "linea_superior": False},
         "filas": [{"campo": "subtotal"}, {"campo": "descuento", "color": TERRA}, {"campo": "iva", "mostrar_tasa": False},
                   {"campo": "otros_impuestos"}, {"campo": "costos_adicionales"},
                   {"campo": "total", "destacar": True},
                   {"campo": "saldo", "etiqueta": "Saldo pendiente", "color": "#DC2626"}]},
        {"tipo": "espacio", "alto_mm": 4},
        _t("<b>OBSERVACIONES</b><br/>{{doc.notas}}", SI("doc.notas"), margen_abajo=3),
        _t("Registró: {{doc.usuario}}", tamano=8, color=GRIS),
        _t("Documentos adjuntos: {{doc.documentos}}", {"variable": "doc.documentos", "op": ">", "valor": "0"},
           tamano=8, color=GRIS),
        _t("<b>¡GRACIAS POR SU PREFERENCIA!</b>", align="center", margen_arriba=6),
    ],
}

ENTREGA = {
    "esquema": 2,
    "pagina": {"formato": "80mm", "margenes": {"arriba": 6, "abajo": 6, "izquierda": 6, "derecha": 6},
               "fuente": "Helvetica", "tamano_base": 8.5, "color_texto": "#000000", "color_primario": "#000000",
               "interlineado": 1.35, "copias": 1},
    "bloques": [
        {"tipo": "logo", "fuente": "oficial", "ancho_mm": 52, "alto_mm": 22,
         "estilo": {"align": "center", "margen_abajo": 2}},
        _t("<b>{{empresa.nombre}}</b>", align="center", tamano=12),
        _t("RFC: {{empresa.rfc}}", SI("empresa.rfc"), align="center", tamano=7),
        _t("{{empresa.direccion}}", SI("empresa.direccion"), align="center", tamano=7),
        _t("Tel: {{empresa.telefono}}", SI("empresa.telefono"), align="center", tamano=7),
        _sep("guiones", 0.5, "#000000"),
        _t("<b>{{doc.titulo}}</b>", align="center", tamano=12.5, margen_abajo=1.5),
        _t("<b>Folio: {{doc.folio}}</b>"),
        _t("Fecha: {{doc.fecha}}  Hora: {{doc.hora}}"),
        _t("Caja: {{doc.caja}}"),
        _t("Entregó: {{doc.usuario}}"),
        _t("Concepto:<br/>{{doc.concepto}}"),
        _t("Referencia: {{doc.referencia}}", SI("doc.referencia")),
        _sep("guiones", 0.5, "#000000"),
        _t("<b>MONTO</b>", align="center", tamano=8),
        _t("<b>{{doc.monto}}</b>", align="center", tamano=17),
        _t("Efectivo en caja después: {{doc.efectivo_en_caja}}", SI("doc.efectivo_en_caja"), align="center", tamano=8),
        _sep("guiones", 0.5, "#000000"),
        {"tipo": "firmas", "firmas": ["Entregó", "Recibí"], "espacio_mm": 10, "ancho_linea_pct": 80,
         "estilo": {"tamano": 8}},
        _t("¡Gracias por su confianza!", align="center", tamano=7.5, margen_arriba=3),
    ],
}

PREDETERMINADOS = {"ticket": TICKET, "carta_venta": CARTA_VENTA, "cotizacion": COTIZACION,
                   "abono": ABONO, "compra": COMPRA, "entrega": ENTREGA}


def _con_ids(bloques):
    for b in bloques:
        b.setdefault("id", "b_" + uuid.uuid4().hex[:10])
        b.setdefault("visible", True)
        cols = b.get("columnas")
        for c in (cols if isinstance(cols, list) else []):
            if isinstance(c, dict) and isinstance(c.get("bloques"), list):
                _con_ids(c["bloques"])
    return bloques


def predeterminado(tipo: str) -> dict:
    """Copia editable (con ids de bloque) de la plantilla predeterminada."""
    base = PREDETERMINADOS.get(tipo)
    if base is None:
        raise KeyError(tipo)
    cfg = copy.deepcopy(base)
    _con_ids(cfg["bloques"])
    return cfg
