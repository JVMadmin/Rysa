"""Cálculos canónicos de dinero/IVA para el ERP (Grupo RYSA).

Convención única del sistema:

  * `precio` de un producto en el catálogo  -> NETO (sin IVA), campo `precio_sin_iva`.
  * `precio_con_iva` (bruto)                -> NETO * (1 + tasa).
  * Venta POS: el backend recibe el precio por línea y el indicador
    `precios_incluyen_iva`:
        True  -> los precios enviados ya INCLUYEN IVA (bruto): se extrae el neto.
        False -> los precios enviados son NETOS: se suma el IVA.
    En ambos casos el TOTAL que paga el cliente es el BRUTO.

Ejemplos (testimonio):
  116.00 con "incluye IVA Sí" 16% -> neto 100, iva 16, bruto 116
  100.00 con "incluye IVA No"  16% -> neto 100, iva 16, bruto 116
"""


def tasa_decimal(iva_tasa: float) -> float:
    """Convierte el porcentaje de IVA (16.0) a factor (0.16)."""
    try:
        return max(0.0, float(iva_tasa or 0)) / 100.0
    except Exception:
        return 0.0


def neto_de_precio(precio: float, iva_tasa: float, incluye_iva: bool) -> float:
    """Devuelve el precio unitario NETO dado un precio y si éste incluye IVA."""
    p = float(precio or 0)
    if incluye_iva:
        tasa = tasa_decimal(iva_tasa)
        if tasa > 0:
            return round(p / (1 + tasa), 2)
        return round(p, 2)
    return round(p, 2)


def bruto_de_precio(precio: float, iva_tasa: float, incluye_iva: bool) -> float:
    """Devuelve el precio unitario BRUTO dado un precio y si éste incluye IVA."""
    p = float(precio or 0)
    if incluye_iva:
        return round(p, 2)
    return round(p * (1 + tasa_decimal(iva_tasa)), 2)


def calcular_venta(items: list, descuento_global: float = 0.0,
                   precios_incluyen_iva: bool = True) -> dict:
    """Calcula los totales de una venta (subtotal neto, IVA, descuento, total).

    `items`: lista de líneas con {cantidad, precio, iva_tasa, descuento}.
    - `precios_incluyen_iva=True`:  `precio` es BRUTO  -> se extrae el neto.
    - `precios_incluyen_iva=False`: `precio` es NETO   -> se suma el IVA.

    El descuento por línea es un MONTO sobre el precio mostrado (bruto si los
    precios incluyen IVA). Devuelve además las líneas enriquecidas con
    `importe_neto`, `importe_bruto`, `iva_linea` y precios unitarios neto/bruto.
    """
    subtotal = 0.0      # neto (sin IVA)
    iva_total = 0.0
    desc_lineas = 0.0
    detalle = []
    for it in items:
        qty = float(it["cantidad"] or 0)
        pbruto = float(it["precio"] or 0)
        tasa = tasa_decimal(it.get("iva_tasa", 8.0))
        desc = max(0.0, float(it.get("descuento", 0.0) or 0))

        if precios_incluyen_iva:
            # Precio unitario bruto; IVA ya viene incluido en el precio.
            factor = 1.0 + tasa
            bruto_linea = max(0.0, qty * pbruto - desc)
            neto_linea = round(bruto_linea / factor, 2) if factor > 0 else bruto_linea
            iva_linea = round(bruto_linea - neto_linea, 2)
            precio_neto_uni = round(pbruto / factor, 2) if factor > 0 else pbruto
            precio_bruto_uni = round(pbruto, 2)
            importe_bruto = round(bruto_linea, 2)
        else:
            # Precio unitario neto; el IVA se suma sobre el neto.
            neto_linea = max(0.0, qty * pbruto - desc)
            iva_linea = round(neto_linea * tasa, 2)
            precio_neto_uni = round(pbruto, 2)
            precio_bruto_uni = round(pbruto * (1 + tasa), 2)
            importe_bruto = round(neto_linea + iva_linea, 2)

        subtotal += neto_linea
        iva_total += iva_linea
        desc_lineas += desc

        detalle.append({
            **it,
            "precio_neto": precio_neto_uni,
            "precio_bruto": precio_bruto_uni,
            "importe_neto": round(neto_linea, 2),
            "importe_bruto": importe_bruto,
            "iva_linea": round(iva_linea, 2),
        })

    dg = min(max(float(descuento_global or 0), 0.0), subtotal)
    subtotal_final = round(subtotal - dg, 2)
    total = round(subtotal_final + iva_total, 2)

    return {
        "subtotal": subtotal_final,
        "iva_total": round(iva_total, 2),
        "descuento_total": round(desc_lineas + dg, 2),
        "total": total,
        "detalle": detalle,
    }


def utilidad_margen(precio_neto: float, costo: float) -> tuple:
    """Devuelve (utilidad, margen %) de un precio NETO contra su costo."""
    try:
        neto = float(precio_neto or 0)
        costo = float(costo or 0)
    except Exception:
        return 0.0, 0.0
    util = neto - costo
    margen = round(util / neto * 100, 2) if neto else 0.0
    return round(util, 2), margen