"""Cerebro del Agente RYSA de WhatsApp: arma el contexto y llama a la IA.

Proveedores (configurables en el ERP):
  - "openai": cualquier API compatible con /chat/completions (Groq, Gemini en
    su endpoint compatible, OpenRouter, Ollama, OpenAI…).
  - "anthropic": API de Mensajes de Anthropic (Claude).

No depende de que el modelo sepa usar "herramientas": antes de cada respuesta
se buscan en el inventario los productos que menciona el cliente y se le dan
al modelo con su precio real (Precio 1 con IVA, la misma regla del POS y del
sitio). Así funciona igual con modelos gratuitos.
"""
import re
import unicodedata

import httpx

import moneycalc

PRESETS = {
    "groq": {"proveedor": "openai", "base_url": "https://api.groq.com/openai/v1", "modelo": "llama-3.3-70b-versatile"},
    "gemini": {"proveedor": "openai", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "modelo": "gemini-2.0-flash"},
    "openrouter": {"proveedor": "openai", "base_url": "https://openrouter.ai/api/v1", "modelo": "meta-llama/llama-3.3-70b-instruct:free"},
    "ollama": {"proveedor": "openai", "base_url": "http://localhost:11434/v1", "modelo": "llama3.2"},
    "anthropic": {"proveedor": "anthropic", "base_url": "https://api.anthropic.com/v1", "modelo": "claude-haiku-5-5"},
}

# Marca que el modelo escribe cuando hay que pasar la conversación a una persona.
MARCA_HUMANO = "[[HUMANO]]"

_STOP = {"de", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "o", "para", "por", "con", "sin", "que", "me",
         "mi", "tu", "su", "es", "en", "al", "del", "lo", "le", "se", "hola", "buenas", "buenos", "dias", "tardes", "noches",
         "gracias", "favor", "quiero", "quisiera", "necesito", "tienen", "tiene", "hay", "cuanto", "cuesta", "precio",
         "precios", "cuantos", "cual", "como", "donde", "cuando", "pieza", "piezas", "caja", "cajas", "paquete", "si", "no",
         "busco", "venden", "manejan", "costo", "vale", "mas", "muy", "bien", "ok", "este", "esta", "esto", "ese", "esa"}


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFD", (t or "").lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def palabras_clave(texto: str) -> list:
    return [w for w in re.findall(r"[a-z0-9]+(?:\.[0-9]+)?", _norm(texto)) if len(w) > 1 and w not in _STOP][:8]


async def buscar_productos(db, texto: str, limite: int, cfg_precios: tuple) -> list:
    """Productos activos cuya descripción contiene las palabras del mensaje,
    ordenados por cuántas coinciden."""
    claves = palabras_clave(texto)
    if not claves:
        return []
    pct, modo = cfg_precios
    prods = await db.products.find({"estado": "activo"}, {
        "_id": 0, "codigo": 1, "descripcion": 1, "unidad_medida": 1, "existencia": 1, "costo": 1,
        "iva_tasa": 1, "precios": 1, "linea": 1}).to_list(5000)
    puntuados = []
    for p in prods:
        d = _norm(f"{p.get('descripcion') or ''} {p.get('codigo') or ''} {p.get('linea') or ''}")
        n = sum(1 for c in claves if c in d)
        if n:
            puntuados.append((n, p))
    puntuados.sort(key=lambda x: (-x[0], x[1].get("descripcion") or ""))
    out = []
    for _, p in puntuados[:limite]:
        listas = moneycalc.precios_lista(p, pct, modo)
        precio = listas[0]["precio_con_iva"] if listas else 0
        if precio > 0:
            out.append({"codigo": p.get("codigo"), "descripcion": p.get("descripcion"), "unidad": p.get("unidad_medida") or "PZA",
                        "precio": precio, "existencia": float(p.get("existencia") or 0)})
    return out


def armar_sistema(cfg: dict, contacto: dict, productos: list, fuera_horario: bool) -> str:
    partes = [cfg.get("instrucciones") or "Eres el asistente de ventas por WhatsApp de Grupo RYSA."]
    partes.append(f"Te llamas {cfg.get('nombre_agente') or 'Agente RYSA'} y atiendes a clientes de Grupo RYSA "
                  "(plásticos, empaques, desechables y suministros; mayoreo y menudeo).")
    tono = cfg.get("tono") or "amable y profesional"
    partes.append(f"Tono: {tono}. Responde en español de México, breve y claro, como en un chat de WhatsApp "
                  f"(máximo {int(cfg.get('max_caracteres') or 600)} caracteres). No uses markdown con # ni tablas.")
    if cfg.get("conocimiento"):
        partes.append("INFORMACIÓN DEL NEGOCIO (úsala como fuente de verdad):\n" + cfg["conocimiento"].strip())
    if cfg.get("permitir_precios", True):
        if productos:
            lineas = []
            for p in productos:
                ex = ""
                if cfg.get("mostrar_existencias"):
                    ex = f" · existencia {p['existencia']:g}" if p["existencia"] > 0 else " · sin existencia"
                lineas.append(f"- {p['descripcion']} (código {p['codigo']}, {p['unidad']}): ${p['precio']:,.2f} con IVA{ex}")
            partes.append("PRODUCTOS DEL INVENTARIO RELACIONADOS CON EL MENSAJE (precio al público con IVA; "
                          "no inventes otros precios ni productos):\n" + "\n".join(lineas))
        else:
            partes.append("No se encontraron productos del inventario para este mensaje: si preguntan precios, pide "
                          "más detalle (medida, presentación, marca) o ofrece que un asesor confirme.")
    else:
        partes.append("No des precios: indica que un asesor enviará la cotización.")
    if cfg.get("link_catalogo"):
        partes.append(f"Catálogo en línea con precios: {cfg['link_catalogo']}")
    if contacto.get("nombre"):
        partes.append(f"El cliente se llama {contacto['nombre']}.")
    if contacto.get("cliente_nombre"):
        partes.append(f"Está registrado en el ERP como cliente: {contacto['cliente_nombre']}.")
    if contacto.get("notas"):
        partes.append("NOTAS Y MEMORIA DE ESTE CONTACTO:\n" + contacto["notas"].strip())
    if fuera_horario and cfg.get("mensaje_fuera_horario"):
        partes.append("Ahora estamos FUERA DE HORARIO de atención. Contesta lo que puedas y menciona: "
                      + cfg["mensaje_fuera_horario"].strip())
    partes.append(f"Si el cliente pide hablar con una persona, quiere hacer un pedido formal, tiene una queja o no "
                  f"puedes resolver con la información disponible, escribe al final de tu respuesta exactamente "
                  f"{MARCA_HUMANO} para pasar la conversación a un asesor.")
    if cfg.get("reglas_extra"):
        partes.append("REGLAS ADICIONALES:\n" + cfg["reglas_extra"].strip())
    return "\n\n".join(partes)


class ErrorIA(Exception):
    pass


async def responder(cfg: dict, api_key: str, sistema: str, historial: list) -> str:
    """historial: [{"role": "user"|"assistant", "content": str}], el último es del cliente."""
    proveedor = cfg.get("proveedor") or "openai"
    base = (cfg.get("base_url") or "").rstrip("/")
    modelo = cfg.get("modelo") or ""
    temperatura = float(cfg.get("temperatura") if cfg.get("temperatura") is not None else 0.4)
    max_tokens = int(cfg.get("max_tokens") or 400)
    if not base or not modelo:
        raise ErrorIA("Falta configurar el proveedor de IA (URL y modelo).")
    try:
        async with httpx.AsyncClient(timeout=45) as cli:
            if proveedor == "anthropic":
                r = await cli.post(f"{base}/messages", headers={
                    "x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                    json={"model": modelo, "system": sistema, "messages": historial,
                          "max_tokens": max_tokens, "temperature": temperatura})
                if r.status_code >= 400:
                    raise ErrorIA(f"Anthropic respondió {r.status_code}: {r.text[:200]}")
                return "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text").strip()
            headers = {"content-type": "application/json"}
            if api_key:
                headers["authorization"] = f"Bearer {api_key}"
            cuerpo = {"model": modelo, "messages": [{"role": "system", "content": sistema}] + historial,
                      "max_tokens": max_tokens, "temperature": temperatura}
            if cfg.get("top_p") not in (None, ""):
                cuerpo["top_p"] = float(cfg["top_p"])
            r = await cli.post(f"{base}/chat/completions", headers=headers, json=cuerpo)
            if r.status_code == 429:
                raise ErrorIA("La IA rechazó la petición por límite de uso (429). En planes gratuitos hay topes por minuto y por día.")
            if r.status_code >= 400:
                raise ErrorIA(f"La IA respondió {r.status_code}: {r.text[:200]}")
            return (r.json()["choices"][0]["message"].get("content") or "").strip()
    except httpx.HTTPError as e:
        raise ErrorIA(f"No se pudo conectar con la IA: {str(e)[:150]}")
    except (KeyError, IndexError, ValueError):
        raise ErrorIA("La IA devolvió una respuesta con formato inesperado.")
