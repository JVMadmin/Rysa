"""Precios de ARTICULO.dbf (sistema anterior) → modelo del ERP.

Verificado contra Datos del 2026-10-24 (2,299 artículos): PRECIO1..PRECIO5 son
precios SIN IVA. En 2,004 artículos PRECIO1 = COSTO × (1 + UTILPRECI1 %) exacto,
y el precio al público es PRECIO × (1 + IMPUESTO %): B90 → 44.4444 × 1.08 = 48.

Reglas (para que el ERP cobre exactamente lo mismo que el sistema anterior):
  - Se guardan las 5 posiciones; una lista vacía en el legacy (0) queda en 0.
    No se inventan precios con UTILPRECI: el ERP cobra en esa lista el último
    precio anterior capturado (ver moneycalc.precios_lista).
  - El neto se guarda con todos sus decimales (44.4444): redondearlo a 2 cambia
    el total al vender por cantidad.
  - IMPUESTO 0 es exento (0 %); solo sin dato se usa 8 %.
  - PRECIOMIN (sin IVA) → precio_minimo.
"""


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def iva_legacy(rec: dict) -> float:
    v = rec.get("IMPUESTO", rec.get("impuesto"))
    if v in (None, ""):
        return 8.0
    return _num(v)


def precios_legacy(rec: dict) -> dict:
    """Campos de precio del producto a partir de un registro de ARTICULO.dbf
    (acepta nombres en mayúsculas o minúsculas)."""
    g = lambda k: rec.get(k, rec.get(k.lower()))
    iva = iva_legacy(rec)
    f = 1 + iva / 100
    costo = _num(g("COSTO"))
    precios = []
    for i in range(1, 6):
        neto = round(_num(g(f"PRECIO{i}")), 6)
        if neto > 0:
            util = round((neto / costo - 1) * 100, 2) + 0.0 if costo else 0.0   # + 0.0: sin "-0.0"
            precios.append({"nombre": f"Precio {i}", "utilidad_pct": util,
                            "precio_sin_iva": neto, "precio_con_iva": round(neto * f, 2)})
        else:
            precios.append({"nombre": f"Precio {i}", "utilidad_pct": 0.0,
                            "precio_sin_iva": 0.0, "precio_con_iva": 0.0})
    p1 = next((p for p in precios if p["precio_sin_iva"] > 0), None)
    sin1 = p1["precio_sin_iva"] if p1 else 0.0
    return {
        "iva_tasa": iva,
        "precios": precios,
        "precio_sin_iva": sin1,
        "precio_con_iva": p1["precio_con_iva"] if p1 else 0.0,
        "precio_minimo": round(_num(g("PRECIOMIN")), 6),
        "precio_incluye_iva": False,
        "utilidad": round(sin1 - costo, 4) if sin1 else 0.0,
        "margen": round((sin1 - costo) / sin1 * 100, 2) if sin1 else 0.0,
    }
