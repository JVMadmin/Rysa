"""Capa de abstracción de Proveedor Autorizado de Certificación (PAC).

El resto del sistema (server.py y el frontend) llama SOLO a estas funciones
genéricas (crear_factura, cancelar_factura, descargar_xml, descargar_pdf,
emitir_complemento_pago, listar_timbres). Por detrás hay un cliente específico
de Facty (facty.mx).

Si en el futuro se cambia de PAC, solo se toca este archivo (y el mapeo de
payload), sin tocar la lógica de negocio del resto de la app (órdenes, POS,
cobros, Cuentas por Cobrar, etc.).

NOTA sobre la API de Facty: la documentación pública (facty.mx/guias y
facty.mx/docs/mcp) describe el modelo de una factura CFDI 4.0 y el servidor MCP,
pero NO expone un esquema JSON exacto de la API REST. Este cliente se implementa
contra ese contrato CFDI 4.0 / MCP. Todas las rutas y llaves JSON están
centralizadas en este archivo para ajustarlas en un solo lugar cuando se tengan
las credenciales reales y el ejemplo de curl del dashboard.
"""
import os
import httpx
from fastapi import HTTPException

from deps import db

# Variable de entorno del API Key de Facty (autoritativa: si está definida gana
# sobre la guardada en Configuración → Facturación).
ENV_API_KEY = os.environ.get("FACTY_API_KEY", "")

# Escopes que debe tener la llave en Configuración → API Keys de Facty.
REQUIRED_SCOPES = "invoices.read, invoices.create, invoices.cancel, invoices.send, billing.read"

# URLs base por entorno. AJUSTAR al host real de Facty cuando se confirme.
FACTY_BASE = {
    "sandbox": "https://sandbox.facty.mx/api",
    "produccion": "https://facty.mx/api",
}

# Rutas de la API (centralizadas para ajustarlas en un solo lugar).
PATH_CREAR = "/invoices"              # POST  crear/timbrar factura (ingreso/egreso)
PATH_DETALLE = "/invoices/{id}"       # GET   detalle + URLs firmadas PDF/XML
PATH_XML = "/invoices/{id}/xml"       # GET   XML
PATH_CANCEL = "/invoices/{id}/cancel" # POST  cancelar (motivo 01-04)
PATH_PAGOS = "/invoices/{id}/payments"  # POST complemento de pagos (REP)
PATH_BALANCE = "/billing/balance"     # GET   saldo de timbres


# ─────────────────────────────── Helpers ───────────────────────────────
async def get_config():
    return await db.pac_config.find_one({"_id": "pac"}, {"_id": 0})


def api_key(cfg):
    """Devuelve el API Key de Facty: prioridad a la variable de entorno
    FACTY_API_KEY; si no está definida usa el guardado en pac_config."""
    return ENV_API_KEY or (cfg or {}).get("api_key") or ""


def base_url(cfg):
    env = (cfg or {}).get("environment", "sandbox")
    return FACTY_BASE.get(env, FACTY_BASE["sandbox"])


async def configurado():
    """True si hay API Key y RFC de emisor para poder timbrar."""
    cfg = await get_config()
    return bool(cfg and api_key(cfg) and cfg.get("rfc"))


def _money(x):
    return f"{round(float(x) + 1e-9, 2):.2f}"


def _friendly_message(status, body):
    """Traduce errores/status de Facty a mensajes claros para el usuario."""
    text = str(body)[:400]
    low = text.lower()
    if status == 401:
        return ("La API Key de Facty es inválida o venció. Revisa "
                "Configuración → Facturación o la variable FACTY_API_KEY.")
    if status == 403:
        if "permiso" in low or "scope" in low or "insuficiente" in low:
            return (f"La API Key de Facty no tiene el permiso necesario "
                    f"({REQUIRED_SCOPES}). Edita la llave en Configuración → API Keys de Facty.")
        return "Permiso insuficiente en la API de Facty (HTTP 403)."
    if ("timbre" in low and any(w in low for w in ("no hay", "insuf", "agot", "sin"))) or ("saldo" in low and "insuf" in low) or "sin timbres" in low:
        return "No hay timbres disponibles. Compra timbres en tu cuenta de Facty (facty.mx)."
    if "csd" in low:
        return "El CSD del emisor es inválido o está vencido. Sube el certificado vigente en Facty."
    if "rfc" in low and "receptor" in low:
        return "El RFC del receptor no es válido o no está dado de alta en el SAT."
    if "rechaz" in low or "sat" in low:
        return f"El SAT rechazó el CFDI: {text}"
    if status >= 500:
        return f"Error del servidor de Facty (HTTP {status}). Intenta de nuevo en unos segundos."
    return f"Facty rechazó la operación (HTTP {status}): {text}"


def _request(cfg, method, path, **kwargs):
    """Cliente HTTP hacia la API de Facty con autenticación Bearer (API Key)."""
    key = api_key(cfg)
    if not key:
        raise HTTPException(400, "No hay API Key de Facty configurada. "
                            "Guarda la llave en Configuración → Facturación o define FACTY_API_KEY.")
    headers = {"Authorization": f"Bearer {key}", **kwargs.pop("headers", {})}
    url = base_url(cfg).rstrip("/") + path
    try:
        with httpx.Client(headers=headers, timeout=40.0) as c:
            r = c.request(method, url, **kwargs)
    except httpx.TimeoutException:
        raise HTTPException(504, "Facty no respondió a tiempo. Verifica tu conexión e inténtalo de nuevo.")
    except httpx.RequestError as e:
        raise HTTPException(502, f"No se pudo conectar con Facty: {e}")
    if r.status_code >= 400:
        try:
            body = r.json()
        except Exception:
            body = r.text
        raise HTTPException(r.status_code, _friendly_message(r.status_code, body))
    if not r.content:
        return {}
    try:
        return r.json()
    except Exception:
        return {"__raw__": r.text}


def _download(cfg, path, media, signed_url=None, params=None):
    """Descarga binario (XML/PDF) desde Facty. Si `signed_url` se pasa, la usa
    directamente (URLs firmadas de 5 min que devuelve el detalle de la factura)."""
    if signed_url:
        try:
            r = httpx.get(signed_url, timeout=40.0)
        except httpx.RequestError as e:
            raise HTTPException(502, f"No se pudo descargar el archivo: {e}")
    else:
        key = api_key(cfg)
        url = base_url(cfg).rstrip("/") + path
        try:
            r = httpx.get(url, headers={"Authorization": f"Bearer {key}"}, params=params, timeout=40.0)
        except httpx.RequestError as e:
            raise HTTPException(502, f"No se pudo descargar de Facty: {e}")
    if r.status_code >= 400:
        raise HTTPException(r.status_code, _friendly_message(r.status_code, r.text))
    return r.content, media


# ───────────────────── Mapeo de campos RYSA → Facty ─────────────────────
def _receptor(cliente):
    rfc = (cliente.get("rfc") if cliente else "") or "XAXX010101000"
    generico = rfc == "XAXX010101000"
    return {
        "rfc": rfc.upper(),
        "razonSocial": ((cliente.get("nombre") if cliente else "") or "PUBLICO EN GENERAL").upper(),
        "usoCfdi": (cliente.get("uso_cfdi") if cliente else "") or ("S01" if generico else "G03"),
        "regimenFiscal": (cliente.get("reg_fiscal") if cliente else "") or ("616" if generico else "601"),
        "cp": (cliente.get("cp") if cliente else "") or "",
    }


def _conceptos(sale):
    conceptos = []
    for it in sale.get("items", []):
        tasa = float(it.get("iva_tasa", 16)) / 100
        bruto_unit = float(it["precio"]) - float(it.get("descuento", 0) or 0)
        base_unit = round(bruto_unit / (1 + tasa), 2)
        conceptos.append({
            "cantidad": _money(it["cantidad"]),
            "claveProdServ": it.get("clave_sat") or "01010101",
            "claveUnidad": it.get("clave_unidad") or "H87",
            "unidad": it.get("unidad") or "Pieza",
            "descripcion": it["descripcion"],
            "valorUnitario": _money(base_unit),
            "impuestos": [{"tipo": "IVA", "tasa": tasa}],
        })
    return conceptos


_FORMA_PAGO = {"efectivo": "01", "tarjeta": "04", "transferencia": "03",
               "spei": "03", "deposito": "03", "otros": "99"}


def _payload_factura(sale, cliente, cfg):
    formas = sale.get("pagos") or [{}]
    forma = _FORMA_PAGO.get((formas[0].get("metodo") if formas else "efectivo"), "01")
    metodo = "PPD" if sale.get("condicion") == "credito" else "PUE"
    return {
        "idempotencyKey": sale.get("id"),
        "type": "ingreso",
        "emisor": {
            "rfc": (cfg.get("rfc") or "").upper(),
            "razonSocial": (cfg.get("razon_social") or "").upper(),
            "regimenFiscal": cfg.get("regimen_fiscal") or "601",
            "cp": cfg.get("lugar_expedicion") or "",
        },
        "receptor": _receptor(cliente),
        "metodoPago": metodo,
        "formaPago": forma,
        "serie": cfg.get("serie") or "A",
        "conceptos": _conceptos(sale),
    }


# ───────────────────── API genérica usada por server.py ─────────────────────
async def listar_timbres(cfg):
    """Saldo de timbres disponibles de la cuenta de Facty (billing.read)."""
    data = _request(cfg, "GET", PATH_BALANCE)
    dato = data.get("available") or data.get("credits") or data.get("balance") \
        or data.get("timbres") or data.get("TotalTimbres") or 0
    return {"disponibles": int(dato or 0), "plan": None, "raw": data}


async def crear_factura(sale, cliente, cfg):
    """Timbra una factura de ingreso (CFDI 4.0). Consume un timbre.
    Devuelve {id, uuid, serie, folio, total}."""
    payload = _payload_factura(sale, cliente, cfg)
    result = _request(cfg, "POST", PATH_CREAR, json=payload)
    if not isinstance(result, dict) or result.get("__raw__"):
        return {"id": None, "uuid": None, "serie": payload.get("serie"),
                "folio": None, "total": sale.get("total"), "raw": result}
    fid = result.get("id") or result.get("Id")
    return {
        "id": fid,
        "uuid": result.get("uuid") or result.get("Uuid"),
        "serie": result.get("serie") or result.get("Serie") or payload.get("serie"),
        "folio": result.get("folio") or result.get("Folio"),
        "total": result.get("total", sale.get("total")),
        "raw": result,
    }


async def cancelar_factura(doc, motivo, uuid_reemplazo, cfg):
    """Cancela un CFDI timbrado con motivo SAT 01-04. Consume un timbre."""
    pac_id = doc.get("pac_id") or doc.get("facturama_id")
    if not pac_id:
        raise HTTPException(404, "El CFDI no tiene identificador de PAC para cancelar.")
    body = {"motivo": motivo}
    if uuid_reemplazo:
        body["folioSustitucion"] = uuid_reemplazo
    return _request(cfg, "POST", PATH_CANCEL.format(id=pac_id), json=body)


async def descargar_xml(doc, cfg):
    pac_id = doc.get("pac_id") or doc.get("facturama_id")
    if not pac_id:
        raise HTTPException(404, "El CFDI no tiene identificador de PAC.")
    return _download(cfg, PATH_XML.format(id=pac_id), "application/xml")


async def descargar_pdf(doc, cfg):
    pac_id = doc.get("pac_id") or doc.get("facturama_id")
    if not pac_id:
        raise HTTPException(404, "El CFDI no tiene identificador de PAC.")
    detalle = _request(cfg, "GET", PATH_DETALLE.format(id=pac_id),
                       params={"includeDownloadUrls": "true"})
    url = (detalle or {}).get("urls", {}).get("pdf") \
        or (detalle or {}).get("pdfUrl") or (detalle or {}).get("PDF")
    if not url:
        raise HTTPException(502, "Facty no devolvió la URL del PDF para este CFDI.")
    return _download(cfg, PATH_DETALLE.format(id=pac_id), "application/pdf", signed_url=url)


async def emitir_complemento_pago(cfg, factura_padre, pago):
    """Emite el Complemento de Recepción de Pagos (REP) contra una factura PPD.
    Consume un timbre. `pago` espera {metodo, monto, fecha}. (requiere payments.create)"""
    pac_id = factura_padre.get("pac_id") or factura_padre.get("facturama_id")
    if not pac_id:
        raise HTTPException(404, "La factura padre no tiene identificador de PAC.")
    forma = _FORMA_PAGO.get(pago.get("metodo"), "01")
    body = {
        "facturaId": pac_id,
        "fechaPago": pago.get("fecha") or None,
        "formaPago": forma,
        "monto": _money(pago.get("monto", 0)),
    }
    return _request(cfg, "POST", PATH_PAGOS.format(id=pac_id), json=body)
