"""WhatsApp del ERP y Agente RYSA.

Conexión: WAHA (WhatsApp HTTP API, motor GOWS) corre como servicio interno en
la red Docker `rysa_net` (docker-compose.whatsapp.yml). El número se vincula
escaneando el QR desde el ERP, como en WhatsApp Web. No es la API oficial de
Meta: hay riesgo de bloqueo del número si WhatsApp detecta automatización, por
eso el agente solo responde a quien escribe, con pausas, "escribiendo…",
límite por hora y paso a un asesor.

Variables del backend (.env.docker): WAHA_URL, WAHA_API_KEY, WAHA_HMAC_KEY,
WAHA_WEBHOOK_URL (opcional), WAHA_SESSION (opcional, "default").

Datos: colecciones wa_conversaciones (una por chat) y wa_mensajes. La
configuración del agente vive en settings `_id: "whatsapp_agente"`; la API key
de la IA se guarda cifrada.

Permisos: whatsapp.ver (bandeja), whatsapp.responder (contestar y tomar la
conversación), config (conexión y configuración del agente).
"""
import asyncio
import hashlib
import hmac
import os
import random
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

import agente_ia
from correo import _cifrar, _descifrar
from deps import db, iso_now, log_audit, now_utc, require_permission

router = APIRouter(prefix="/api/whatsapp")
_TAREAS: set = set()     # referencia a las tareas del agente (asyncio no las retiene)

_TZ_MX = timezone(timedelta(hours=-6))
SESION = os.environ.get("WAHA_SESSION", "default")

CONFIG_DEFAULT = {
    "activo": False,
    "nombre_agente": "Agente RYSA",
    "instrucciones": ("Eres el asistente de ventas por WhatsApp de Grupo RYSA. Ayudas a los clientes a encontrar "
                      "productos, das precios del inventario y orientas sobre pedidos, entregas y formas de pago. "
                      "Nunca inventes precios, existencias ni promociones."),
    "tono": "amable, cercano y profesional",
    "conocimiento": ("Horario: lunes a sábado de 9:00 a 19:00.\n"
                     "Ventas por mayoreo y menudeo. Precios con IVA incluido.\n"
                     "Facturación en línea: https://gruporysa.com/facturacion"),
    "reglas_extra": "",
    "link_catalogo": "https://gruporysa.com/productos",
    "permitir_precios": True,
    "mostrar_existencias": False,
    "productos_contexto": 8,
    "historial_mensajes": 12,
    "max_caracteres": 600,
    "temperatura": 0.4,
    "top_p": "",
    "max_tokens": 400,
    "retraso_min": 4,
    "retraso_max": 12,
    "simular_escribiendo": True,
    "limite_por_hora": 20,
    "horario_dias": [0, 1, 2, 3, 4, 5],          # 0 = lunes
    "horario_inicio": "09:00",
    "horario_fin": "19:00",
    "responder_fuera_horario": True,
    "mensaje_fuera_horario": "Nuestro horario de atención es de lunes a sábado de 9:00 a 19:00; un asesor te confirmará en cuanto abramos.",
    "palabras_humano": "asesor, humano, persona, ejecutivo, queja, reclamo, gerente",
    "mensaje_humano": "Te comunico con un asesor de Grupo RYSA, en breve te atiende. 🙌",
    "mensaje_error": "Gracias por escribir a Grupo RYSA. En un momento te atiende un asesor.",
    "horas_regreso_bot": 12,
    "bloqueados": "",
    "proveedor_preset": "groq",
    "proveedor": "openai",
    "base_url": agente_ia.PRESETS["groq"]["base_url"],
    "modelo": agente_ia.PRESETS["groq"]["modelo"],
    "api_key_enc": "",
}


# ───────────────────────────── utilidades ─────────────────────────────
async def _config() -> dict:
    doc = await db.settings.find_one({"_id": "whatsapp_agente"}) or {}
    return {**CONFIG_DEFAULT, **{k: v for k, v in doc.items() if k != "_id"}}


def _waha_cfg() -> tuple:
    url, key = os.environ.get("WAHA_URL", "").rstrip("/"), os.environ.get("WAHA_API_KEY", "")
    if not url or not key:
        raise HTTPException(503, "El servicio de WhatsApp no está instalado en el servidor (faltan WAHA_URL y WAHA_API_KEY).")
    return url, key


async def _waha(method: str, path: str, **kw):
    url, key = _waha_cfg()
    try:
        async with httpx.AsyncClient(timeout=25) as cli:
            r = await cli.request(method, url + path, headers={"X-Api-Key": key, **kw.pop("headers", {})}, **kw)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"No se pudo hablar con el servicio de WhatsApp: {str(e)[:120]}")
    return r


def _telefono(chat_id: str) -> str:
    return re.sub(r"\D", "", chat_id.split("@")[0])


def _digitos10(t: str) -> str:
    d = re.sub(r"\D", "", t or "")
    return d[-10:] if len(d) >= 10 else d


async def _cliente_por_telefono(tel: str) -> Optional[dict]:
    t10 = _digitos10(tel)
    if len(t10) < 10:
        return None
    for c in await db.clients.find({}, {"_id": 0, "id": 1, "nombre": 1, "telefono": 1, "celular": 1, "whatsapp": 1,
                                        "tel_oficina": 1, "tel_residencia": 1}).to_list(20000):
        for k in ("whatsapp", "celular", "telefono", "tel_oficina", "tel_residencia"):
            if _digitos10(c.get(k) or "") == t10:
                return {"id": c["id"], "nombre": c.get("nombre") or ""}
    return None


def _en_horario(cfg: dict) -> bool:
    ahora = now_utc().astimezone(_TZ_MX)
    if ahora.weekday() not in (cfg.get("horario_dias") or []):
        return False
    hm = ahora.strftime("%H:%M")
    return (cfg.get("horario_inicio") or "00:00") <= hm < (cfg.get("horario_fin") or "23:59")


def _lista(texto: str) -> list:
    return [x.strip().lower() for x in re.split(r"[,\n;]", texto or "") if x.strip()]


async def _guardar_mensaje(chat_id: str, texto: str, origen: str, wa_id: str = "", usuario: str = "") -> dict:
    m = {"id": uuid.uuid4().hex, "chat_id": chat_id, "texto": texto, "origen": origen, "wa_id": wa_id,
         "usuario": usuario, "fecha": iso_now()}
    await db.wa_mensajes.insert_one(m)
    return m


# ───────────────────────────── conexión ─────────────────────────────
@router.get("/estado")
async def estado(user: dict = Depends(require_permission("whatsapp.ver"))):
    try:
        _waha_cfg()
    except HTTPException as e:
        return {"instalado": False, "status": "NO_INSTALADO", "detalle": e.detail}
    r = await _waha("GET", f"/api/sessions/{SESION}")
    if r.status_code == 404:
        return {"instalado": True, "status": "SIN_SESION"}
    if r.status_code >= 400:
        return {"instalado": True, "status": "ERROR", "detalle": r.text[:200]}
    d = r.json()
    me = d.get("me") or {}
    return {"instalado": True, "status": d.get("status"), "engine": d.get("engine"),
            "numero": _telefono(me.get("id", "")) if me.get("id") else "", "nombre": me.get("pushName") or ""}


@router.post("/conectar")
async def conectar(user: dict = Depends(require_permission("config"))):
    hook = os.environ.get("WAHA_WEBHOOK_URL", "http://rysa_backend:8000/api/whatsapp/webhook")
    cfg = {"webhooks": [{"url": hook, "events": ["message", "session.status"],
                         "hmac": {"key": os.environ.get("WAHA_HMAC_KEY", "")},
                         "retries": {"policy": "constant", "delaySeconds": 3, "attempts": 5}}]}
    r = await _waha("GET", f"/api/sessions/{SESION}")
    if r.status_code == 404:
        r = await _waha("POST", "/api/sessions", json={"name": SESION, "start": True, "config": cfg})
    else:
        await _waha("PUT", f"/api/sessions/{SESION}", json={"config": cfg})
        r = await _waha("POST", f"/api/sessions/{SESION}/start")
    if r.status_code >= 400:
        raise HTTPException(502, f"El servicio de WhatsApp respondió {r.status_code}: {r.text[:200]}")
    await log_audit(user, "conectar", "whatsapp", SESION, "Inicio de sesión de WhatsApp")
    return {"ok": True}


@router.get("/qr")
async def qr(user: dict = Depends(require_permission("config"))):
    r = await _waha("GET", f"/api/{SESION}/auth/qr", params={"format": "image"})
    if r.status_code >= 400:
        raise HTTPException(409, "Todavía no hay código QR; espera unos segundos.")
    return Response(content=r.content, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.post("/desconectar")
async def desconectar(user: dict = Depends(require_permission("config"))):
    await _waha("POST", f"/api/sessions/{SESION}/logout")
    await log_audit(user, "desconectar", "whatsapp", SESION, "Cierre de sesión de WhatsApp")
    return {"ok": True}


# ───────────────────────────── webhook ─────────────────────────────
def _nombre_contacto(payload: dict) -> str:
    d = payload.get("_data") or {}
    for k in ("notifyName", "pushName", "PushName", "pushname"):
        v = d.get(k) or (d.get("Info") or {}).get(k) or payload.get(k)
        if v:
            return str(v)[:80]
    return ""


@router.post("/webhook")
async def webhook(request: Request):
    cuerpo = await request.body()
    clave = os.environ.get("WAHA_HMAC_KEY", "")
    firma = request.headers.get("X-Webhook-Hmac", "")
    if not clave or not hmac.compare_digest(hmac.new(clave.encode(), cuerpo, hashlib.sha512).hexdigest(), firma):
        raise HTTPException(401, "Firma inválida")
    ev = await request.json()
    if ev.get("event") == "session.status":
        await db.settings.update_one({"_id": "whatsapp_estado"}, {"$set": {"status": (ev.get("payload") or {}).get("status"),
                                                                          "fecha": iso_now()}}, upsert=True)
        return {"ok": True}
    if ev.get("event") != "message":
        return {"ok": True}
    p = ev.get("payload") or {}
    de_mi = bool(p.get("fromMe"))
    chat_id = (p.get("to") if de_mi else p.get("from")) or ""
    if not chat_id or chat_id.endswith(("@g.us", "@newsletter", "@broadcast")) or "status@" in chat_id:
        return {"ok": True}                       # grupos, estados y canales no se atienden
    if de_mi and p.get("source") == "api":
        return {"ok": True}                       # lo envió el ERP; ya está guardado
    texto = (p.get("body") or "").strip() or ("[archivo adjunto]" if p.get("hasMedia") else "[mensaje sin texto]")
    if await db.wa_mensajes.find_one({"wa_id": p.get("id")}):
        return {"ok": True}                       # reintento del webhook
    conv = await db.wa_conversaciones.find_one({"id": chat_id})
    ahora = iso_now()
    if not conv:
        cliente = await _cliente_por_telefono(_telefono(chat_id))
        conv = {"id": chat_id, "telefono": _telefono(chat_id), "nombre": "" if de_mi else _nombre_contacto(p),
                "cliente_id": (cliente or {}).get("id", ""), "cliente_nombre": (cliente or {}).get("nombre", ""),
                "modo": "bot", "notas": "", "no_leidos": 0, "creado": ahora}
        await db.wa_conversaciones.insert_one(conv)
    if de_mi:
        # Contestaron desde el teléfono: el agente se hace a un lado en ese chat.
        await _guardar_mensaje(chat_id, texto, "humano", p.get("id", ""), "Teléfono")
        await db.wa_conversaciones.update_one({"id": chat_id}, {"$set": {
            "modo": "humano", "modo_desde": ahora, "ultimo": texto[:120], "ultimo_fecha": ahora}})
        return {"ok": True}
    m = await _guardar_mensaje(chat_id, texto, "cliente", p.get("id", ""))
    cambios = {"ultimo": texto[:120], "ultimo_fecha": ahora, "ultimo_cliente": ahora,
               "no_leidos": int(conv.get("no_leidos") or 0) + 1}
    if not conv.get("nombre") and _nombre_contacto(p):
        cambios["nombre"] = _nombre_contacto(p)
    await db.wa_conversaciones.update_one({"id": chat_id}, {"$set": cambios})
    tarea = asyncio.create_task(_atender(chat_id, m["id"], p.get("id", "")))
    _TAREAS.add(tarea)
    tarea.add_done_callback(_TAREAS.discard)
    return {"ok": True}


# ───────────────────────────── agente ─────────────────────────────
async def _escribir(chat_id: str, accion: str):
    try:
        await _waha("POST", f"/api/{accion}", json={"session": SESION, "chatId": chat_id})
    except HTTPException:
        pass


async def _enviar_texto(chat_id: str, texto: str, origen: str, usuario: str = "") -> dict:
    r = await _waha("POST", "/api/sendText", json={"session": SESION, "chatId": chat_id, "text": texto, "linkPreview": True})
    if r.status_code >= 400:
        raise HTTPException(502, f"WhatsApp no aceptó el mensaje ({r.status_code}): {r.text[:150]}")
    wa_id = ""
    try:
        wa_id = (r.json() or {}).get("id") or ""
        wa_id = wa_id if isinstance(wa_id, str) else str(wa_id.get("_serialized") or "")
    except Exception:
        pass
    m = await _guardar_mensaje(chat_id, texto, origen, wa_id, usuario)
    await db.wa_conversaciones.update_one({"id": chat_id}, {"$set": {"ultimo": texto[:120], "ultimo_fecha": m["fecha"]}})
    return m


async def _historial(chat_id: str, n: int) -> list:
    msgs = await db.wa_mensajes.find({"chat_id": chat_id}, {"_id": 0}).sort("fecha", -1).limit(max(2, n)).to_list(n)
    msgs.reverse()
    hist = []
    for m in msgs:
        rol = "user" if m["origen"] == "cliente" else "assistant"
        if hist and hist[-1]["role"] == rol:
            hist[-1]["content"] += "\n" + m["texto"]
        else:
            hist.append({"role": rol, "content": m["texto"]})
    while hist and hist[0]["role"] != "user":
        hist.pop(0)
    return hist


async def _atender(chat_id: str, msg_id: str, wa_id: str):
    """Decide si el agente contesta y, si sí, contesta como persona."""
    try:
        cfg = await _config()
        conv = await db.wa_conversaciones.find_one({"id": chat_id}) or {}
        if not cfg.get("activo"):
            return
        if conv.get("modo") == "humano":
            desde = conv.get("modo_desde") or ""
            horas = float(cfg.get("horas_regreso_bot") or 0)
            if not horas or not desde or datetime.fromisoformat(desde) > now_utc() - timedelta(hours=horas):
                return
            await db.wa_conversaciones.update_one({"id": chat_id}, {"$set": {"modo": "bot"}})
        if conv.get("telefono") and any(_digitos10(b) == _digitos10(conv["telefono"]) for b in _lista(cfg.get("bloqueados"))):
            return
        en_horario = _en_horario(cfg)
        if not en_horario and not cfg.get("responder_fuera_horario"):
            return
        # Pausa humana; si en ese tiempo llegó otro mensaje, contesta la tarea de ese mensaje.
        await asyncio.sleep(random.uniform(float(cfg.get("retraso_min") or 2), max(float(cfg.get("retraso_min") or 2), float(cfg.get("retraso_max") or 8))))
        ultimo = await db.wa_mensajes.find({"chat_id": chat_id, "origen": "cliente"}, {"_id": 0, "id": 1}).sort("fecha", -1).limit(1).to_list(1)
        if ultimo and ultimo[0]["id"] != msg_id:
            return
        hace_hora = (now_utc() - timedelta(hours=1)).isoformat()
        enviados = await db.wa_mensajes.count_documents({"chat_id": chat_id, "origen": "bot", "fecha": {"$gte": hace_hora}})
        if enviados >= int(cfg.get("limite_por_hora") or 20):
            await db.wa_conversaciones.update_one({"id": chat_id}, {"$set": {"modo": "humano", "modo_desde": iso_now(),
                                                                            "ultimo_error": "Límite de respuestas por hora del agente"}})
            return
        await _waha("POST", "/api/sendSeen", json={"session": SESION, "chatId": chat_id, **({"messageIds": [wa_id]} if wa_id else {})})
        hist = await _historial(chat_id, int(cfg.get("historial_mensajes") or 12))
        ultimo_texto = hist[-1]["content"] if hist else ""
        if any(p in ultimo_texto.lower() for p in _lista(cfg.get("palabras_humano"))):
            await _pasar_a_humano(chat_id, cfg, "El cliente pidió un asesor")
            return
        if cfg.get("simular_escribiendo"):
            await _escribir(chat_id, "startTyping")
        recientes = " ".join(h["content"] for h in hist[-3:] if h["role"] == "user")
        from marcas import _config_precios
        productos = await agente_ia.buscar_productos(db, recientes, int(cfg.get("productos_contexto") or 8),
                                                     await _config_precios(db))
        conv = await db.wa_conversaciones.find_one({"id": chat_id}) or conv
        sistema = agente_ia.armar_sistema(cfg, conv, productos, not en_horario)
        clave = _descifrar(cfg["api_key_enc"]) if cfg.get("api_key_enc") else ""
        try:
            respuesta = await agente_ia.responder(cfg, clave, sistema, hist)
        except agente_ia.ErrorIA as e:
            await db.wa_conversaciones.update_one({"id": chat_id}, {"$set": {"ultimo_error": str(e)[:300]}})
            if cfg.get("simular_escribiendo"):
                await _escribir(chat_id, "stopTyping")
            await _pasar_a_humano(chat_id, cfg, f"La IA falló: {str(e)[:120]}", cfg.get("mensaje_error"))
            return
        humano = agente_ia.MARCA_HUMANO in respuesta
        respuesta = respuesta.replace(agente_ia.MARCA_HUMANO, "").strip()[: int(cfg.get("max_caracteres") or 600) + 200]
        if cfg.get("simular_escribiendo"):
            await asyncio.sleep(min(8.0, 1.5 + len(respuesta) / 25))
            await _escribir(chat_id, "stopTyping")
        if respuesta:
            await _enviar_texto(chat_id, respuesta, "bot")
        await db.wa_conversaciones.update_one({"id": chat_id}, {"$set": {"ultimo_error": ""}})
        if humano:
            await _pasar_a_humano(chat_id, cfg, "El agente pidió apoyo de un asesor")
    except Exception as e:  # una falla del agente nunca debe tumbar el webhook
        await db.wa_conversaciones.update_one({"id": chat_id}, {"$set": {"ultimo_error": f"{type(e).__name__}: {str(e)[:200]}"}})


async def _pasar_a_humano(chat_id: str, cfg: dict, motivo: str, mensaje: Optional[str] = None):
    texto = mensaje if mensaje is not None else cfg.get("mensaje_humano")
    if texto:
        try:
            await _enviar_texto(chat_id, texto, "bot")
        except HTTPException:
            pass
    await db.wa_conversaciones.update_one({"id": chat_id}, {"$set": {"modo": "humano", "modo_desde": iso_now(),
                                                                    "atencion": True, "motivo_humano": motivo}})


# ───────────────────────────── bandeja ─────────────────────────────
@router.get("/conversaciones")
async def conversaciones(q: str = "", user: dict = Depends(require_permission("whatsapp.ver"))):
    convs = await db.wa_conversaciones.find({}, {"_id": 0}).sort("ultimo_fecha", -1).to_list(500)
    t = q.strip().lower()
    if t:
        convs = [c for c in convs if t in f"{c.get('nombre', '')} {c.get('telefono', '')} {c.get('cliente_nombre', '')} {c.get('ultimo', '')}".lower()]
    return convs


@router.get("/conversaciones/{chat_id}/mensajes")
async def mensajes(chat_id: str, user: dict = Depends(require_permission("whatsapp.ver"))):
    msgs = await db.wa_mensajes.find({"chat_id": chat_id}, {"_id": 0}).sort("fecha", -1).limit(200).to_list(200)
    msgs.reverse()
    await db.wa_conversaciones.update_one({"id": chat_id}, {"$set": {"no_leidos": 0}})
    return msgs


class EnviarInput(BaseModel):
    texto: str


@router.post("/conversaciones/{chat_id}/enviar")
async def enviar(chat_id: str, data: EnviarInput, user: dict = Depends(require_permission("whatsapp.responder"))):
    if not await db.wa_conversaciones.find_one({"id": chat_id}):
        raise HTTPException(404, "Conversación no encontrada")
    texto = data.texto.strip()
    if not texto:
        raise HTTPException(422, "Escribe un mensaje")
    m = await _enviar_texto(chat_id, texto[:4000], "humano", user.get("name") or user.get("email") or "")
    # Quien contesta desde el ERP toma la conversación: el agente se pausa.
    await db.wa_conversaciones.update_one({"id": chat_id}, {"$set": {"modo": "humano", "modo_desde": iso_now(), "atencion": False}})
    return m


class ConvInput(BaseModel):
    modo: Optional[str] = None
    notas: Optional[str] = None
    nombre: Optional[str] = None


@router.patch("/conversaciones/{chat_id}")
async def editar_conv(chat_id: str, data: ConvInput, user: dict = Depends(require_permission("whatsapp.responder"))):
    cambios = {k: v for k, v in data.model_dump().items() if v is not None}
    if "modo" in cambios:
        if cambios["modo"] not in ("bot", "humano"):
            raise HTTPException(422, "Modo inválido")
        cambios["modo_desde"] = iso_now()
        cambios["atencion"] = False
    await db.wa_conversaciones.update_one({"id": chat_id}, {"$set": cambios})
    return await db.wa_conversaciones.find_one({"id": chat_id}, {"_id": 0})


# ───────────────────────────── configuración del agente ─────────────────────────────
class AgenteInput(BaseModel):
    model_config = {"extra": "allow"}
    api_key: Optional[str] = ""


@router.get("/agente")
async def ver_agente(user: dict = Depends(require_permission("config"))):
    cfg = await _config()
    cfg["api_key_guardada"] = bool(cfg.pop("api_key_enc", ""))
    cfg["presets"] = agente_ia.PRESETS
    return cfg


@router.put("/agente")
async def guardar_agente(data: AgenteInput, user: dict = Depends(require_permission("config"))):
    previo = await _config()
    d = data.model_dump()
    clave = (d.pop("api_key", "") or "").strip()
    nuevo = {k: d[k] for k in CONFIG_DEFAULT if k in d and k != "api_key_enc"}
    nuevo["api_key_enc"] = _cifrar(clave) if clave else previo.get("api_key_enc", "")
    await db.settings.update_one({"_id": "whatsapp_agente"}, {"$set": nuevo}, upsert=True)
    await log_audit(user, "editar", "whatsapp", "agente", "activo" if nuevo.get("activo") else "inactivo")
    return await ver_agente(user)


class PruebaInput(BaseModel):
    mensajes: list


@router.post("/agente/probar")
async def probar_agente(data: PruebaInput, user: dict = Depends(require_permission("config"))):
    """Simulador: responde como lo haría el agente, sin WhatsApp."""
    cfg = await _config()
    hist = [{"role": "user" if m.get("rol") == "cliente" else "assistant", "content": str(m.get("texto") or "")}
            for m in data.mensajes[-20:] if str(m.get("texto") or "").strip()]
    if not hist or hist[-1]["role"] != "user":
        raise HTTPException(422, "El último mensaje debe ser del cliente")
    from marcas import _config_precios
    recientes = " ".join(h["content"] for h in hist[-3:] if h["role"] == "user")
    productos = await agente_ia.buscar_productos(db, recientes, int(cfg.get("productos_contexto") or 8), await _config_precios(db))
    sistema = agente_ia.armar_sistema(cfg, {"nombre": "Cliente de prueba"}, productos, not _en_horario(cfg))
    clave = _descifrar(cfg["api_key_enc"]) if cfg.get("api_key_enc") else ""
    try:
        respuesta = await agente_ia.responder(cfg, clave, sistema, hist)
    except agente_ia.ErrorIA as e:
        raise HTTPException(502, str(e))
    return {"respuesta": respuesta.replace(agente_ia.MARCA_HUMANO, "").strip(),
            "pasa_a_humano": agente_ia.MARCA_HUMANO in respuesta,
            "productos": productos, "en_horario": _en_horario(cfg)}
