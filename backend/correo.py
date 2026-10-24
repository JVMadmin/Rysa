"""Bandeja de correo del ERP (ventas@ y contacto@gruporysa.com).

Los buzones viven en Hostinger; el ERP los lee por IMAP y envía por SMTP, sin
copiar los correos a la base de datos: cada consulta va al servidor de correo.
La configuración de las cuentas se guarda en settings `_id: "correo"`; la
contraseña de cada buzón va cifrada (Fernet) con CORREO_SECRET o, si no está
definida, con JWT_SECRET. Si se cambia esa llave hay que volver a capturar las
contraseñas.

Permisos: `correo.ver` (leer), `correo.enviar` (responder/redactar) y
`config` (configurar las cuentas).
"""
import base64
import hashlib
import html
import imaplib
import os
import re
import smtplib
import ssl
import time
from email import policy
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import formataddr, getaddresses, make_msgid, parsedate_to_datetime
from typing import List, Optional

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from deps import db, iso_now, log_audit, require_permission

router = APIRouter(prefix="/api/correo")

TIMEOUT = 25
POR_PAGINA = 30
MAX_ADJUNTOS_MB = 20
CUENTAS_DEFAULT = [
    {"id": "ventas", "nombre": "Ventas", "email": "ventas@gruporysa.com"},
    {"id": "contacto", "nombre": "Contacto", "email": "contacto@gruporysa.com"},
]
HOST_DEFAULT = {"imap_host": "imap.hostinger.com", "imap_port": 993,
                "smtp_host": "smtp.hostinger.com", "smtp_port": 465}

# Nombre en español de las carpetas especiales (por bandera SPECIAL-USE o por nombre).
_ESPECIALES = [("\\Sent", "Enviados", ("sent", "enviados")), ("\\Drafts", "Borradores", ("drafts", "borradores")),
               ("\\Junk", "Spam", ("junk", "spam")), ("\\Trash", "Papelera", ("trash", "papelera", "deleted")),
               ("\\Archive", "Archivo", ("archive", "archivo"))]


# ───────────────────────────── cifrado de contraseñas ─────────────────────────────
def _fernet() -> Fernet:
    secreto = os.environ.get("CORREO_SECRET") or os.environ["JWT_SECRET"]
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("correo:" + secreto).encode()).digest()))


def _cifrar(texto: str) -> str:
    return _fernet().encrypt(texto.encode()).decode()


def _descifrar(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        raise HTTPException(400, "No se pudo leer la contraseña guardada del buzón; vuelve a capturarla en la configuración de Correo.")


# ───────────────────────────── configuración ─────────────────────────────
async def _config() -> dict:
    doc = await db.settings.find_one({"_id": "correo"}) or {}
    cuentas = doc.get("cuentas") or [{**c, **HOST_DEFAULT, "usuario": c["email"], "activa": True} for c in CUENTAS_DEFAULT]
    return {"cuentas": cuentas}


async def _cuenta(cid: str) -> dict:
    for c in (await _config())["cuentas"]:
        if c.get("id") == cid:
            if not c.get("activa", True):
                raise HTTPException(400, "Esta cuenta de correo está desactivada.")
            if not c.get("password_enc"):
                raise HTTPException(400, f"Falta la contraseña del buzón {c.get('email')}. Captúrala en Correo → Configurar cuentas.")
            return c
    raise HTTPException(404, "Cuenta de correo no encontrada")


def _publica(c: dict) -> dict:
    out = {k: v for k, v in c.items() if k != "password_enc"}
    out["password_guardada"] = bool(c.get("password_enc"))
    return out


class CuentaInput(BaseModel):
    id: str
    nombre: str
    email: str
    usuario: Optional[str] = ""
    password: Optional[str] = ""          # vacía = conservar la guardada
    imap_host: str = HOST_DEFAULT["imap_host"]
    imap_port: int = HOST_DEFAULT["imap_port"]
    smtp_host: str = HOST_DEFAULT["smtp_host"]
    smtp_port: int = HOST_DEFAULT["smtp_port"]
    nombre_remitente: Optional[str] = "Grupo RYSA"
    firma: Optional[str] = ""
    activa: bool = True


class ConfigInput(BaseModel):
    cuentas: List[CuentaInput] = Field(default_factory=list)


# ───────────────────────────── utilidades IMAP ─────────────────────────────
def _imap(c: dict) -> imaplib.IMAP4_SSL:
    try:
        m = imaplib.IMAP4_SSL(c["imap_host"], int(c["imap_port"]), ssl_context=ssl.create_default_context(), timeout=TIMEOUT)
        m.login(c.get("usuario") or c["email"], _descifrar(c["password_enc"]))
        return m
    except imaplib.IMAP4.error as e:
        raise HTTPException(401, f"El servidor de correo rechazó el acceso a {c['email']}: revisa usuario y contraseña. ({str(e)[:80]})")
    except OSError as e:
        raise HTTPException(502, f"No se pudo conectar con {c['imap_host']}: {str(e)[:120]}")


def _cerrar(m):
    try:
        m.logout()
    except Exception:
        pass


def _q(nombre: str) -> str:
    """Nombre de carpeta entre comillas para comandos IMAP."""
    return '"' + nombre.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _texto_header(v) -> str:
    if not v:
        return ""
    try:
        return str(make_header(decode_header(str(v)))).strip()
    except Exception:
        return str(v).strip()


def _direcciones(v) -> list:
    return [{"nombre": _texto_header(n), "email": e.lower()} for n, e in getaddresses([_texto_header(v)]) if e]


def _fecha(v) -> str:
    try:
        return parsedate_to_datetime(str(v)).isoformat()
    except Exception:
        return ""


_LIST_RX = re.compile(r'^\((?P<flags>[^)]*)\) (?P<sep>"[^"]*"|NIL) (?P<nombre>.+)$')


def _carpetas(m) -> list:
    tipo, datos = m.list()
    out = []
    for linea in datos or []:
        if not linea:
            continue
        s = linea.decode("utf-8", "replace") if isinstance(linea, bytes) else str(linea)
        r = _LIST_RX.match(s)
        if not r:
            continue
        flags = r.group("flags")
        if "\\Noselect" in flags:
            continue
        nombre = r.group("nombre").strip().strip('"')
        corto = re.split(r"[./]", nombre)[-1]
        etiqueta, especial = ("Recibidos", "inbox") if nombre.upper() == "INBOX" else (corto, "")
        for bandera, es, alias in _ESPECIALES:
            if bandera in flags or corto.lower() in alias:
                etiqueta, especial = es, bandera.strip("\\").lower()
                break
        out.append({"nombre": nombre, "etiqueta": etiqueta, "especial": especial})
    orden = {"inbox": 0, "sent": 1, "drafts": 2, "archive": 3, "junk": 4, "trash": 5}
    return sorted(out, key=lambda f: (orden.get(f["especial"], 9), f["etiqueta"].lower()))


def _carpeta_especial(m, especial: str) -> Optional[str]:
    for f in _carpetas(m):
        if f["especial"] == especial:
            return f["nombre"]
    return None


def _seleccionar(m, carpeta: str, solo_lectura=True):
    tipo, _ = m.select(_q(carpeta), readonly=solo_lectura)
    if tipo != "OK":
        raise HTTPException(404, f"Carpeta no encontrada: {carpeta}")


def _listar(c: dict, carpeta: str, pagina: int, q: str, solo_no_leidos: bool) -> dict:
    m = _imap(c)
    try:
        _seleccionar(m, carpeta)
        criterios = ["UNSEEN"] if solo_no_leidos else ["ALL"]
        if q:
            # TEXT busca en encabezados y cuerpo. El texto va como literal UTF-8
            # (imaplib solo acepta ASCII en los argumentos: "térmicos" fallaba).
            m.literal = q.encode("utf-8")
            tipo, datos = m.uid("SEARCH", "CHARSET", "UTF-8", *(["UNSEEN"] if solo_no_leidos else []), "TEXT")
        else:
            tipo, datos = m.uid("SEARCH", *criterios)
        uids = [u for u in (datos[0] or b"").split()] if tipo == "OK" else []
        uids.reverse()
        total = len(uids)
        pag = uids[(pagina - 1) * POR_PAGINA: pagina * POR_PAGINA]
        mensajes = []
        if pag:
            tipo, datos = m.uid("FETCH", b",".join(pag).decode(),
                                "(UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE CONTENT-TYPE)])")
            for item in datos or []:
                if not isinstance(item, tuple):
                    continue
                meta = item[0].decode("utf-8", "replace")
                uid = re.search(r"UID (\d+)", meta)
                if not uid:
                    continue
                h = BytesParser(policy=policy.default).parsebytes(item[1], headersonly=True)
                ctype = str(h.get("Content-Type") or "").lower()
                mensajes.append({
                    "uid": uid.group(1),
                    "de": _direcciones(h.get("From")),
                    "para": _direcciones(h.get("To")),
                    "asunto": _texto_header(h.get("Subject")) or "(sin asunto)",
                    "fecha": _fecha(h.get("Date")),
                    "leido": "\\Seen" in meta,
                    "destacado": "\\Flagged" in meta,
                    "respondido": "\\Answered" in meta,
                    "adjuntos": "multipart/mixed" in ctype,
                    "tamano": int((re.search(r"RFC822\.SIZE (\d+)", meta) or [0, 0])[1]),
                })
            mensajes.sort(key=lambda x: int(x["uid"]), reverse=True)
        return {"carpeta": carpeta, "pagina": pagina, "por_pagina": POR_PAGINA, "total": total, "mensajes": mensajes}
    finally:
        _cerrar(m)


def _cid_a_data(html_txt: str, partes: dict) -> str:
    def rep(mt):
        cid = mt.group(2).strip("<>")
        p = partes.get(cid)
        if not p:
            return mt.group(0)
        return f'{mt.group(1)}data:{p[0]};base64,{base64.b64encode(p[1]).decode()}'
    return re.sub(r'(src=["\']?)cid:([^"\'\s>]+)', rep, html_txt, flags=re.I)


def _leer(c: dict, carpeta: str, uid: str, marcar_leido: bool) -> dict:
    m = _imap(c)
    try:
        _seleccionar(m, carpeta, solo_lectura=not marcar_leido)
        tipo, datos = m.uid("FETCH", uid, "(FLAGS BODY.PEEK[])")
        crudo = next((d[1] for d in datos or [] if isinstance(d, tuple)), None)
        if tipo != "OK" or not crudo:
            raise HTTPException(404, "El correo ya no existe en el servidor")
        if marcar_leido:
            m.uid("STORE", uid, "+FLAGS", "(\\Seen)")
        msg = BytesParser(policy=policy.default).parsebytes(crudo)
        cuerpo_html, cuerpo_txt, adjuntos, inline = "", "", [], {}
        for i, parte in enumerate(msg.walk()):
            if parte.is_multipart():
                continue
            ctype = parte.get_content_type()
            disp = (parte.get_content_disposition() or "").lower()
            nombre = parte.get_filename()
            cid = (parte.get("Content-ID") or "").strip("<> ")
            if ctype == "text/html" and disp != "attachment" and not cuerpo_html:
                cuerpo_html = parte.get_content()
            elif ctype == "text/plain" and disp != "attachment" and not cuerpo_txt and not nombre:
                cuerpo_txt = parte.get_content()
            else:
                datos_p = parte.get_payload(decode=True) or b""
                if cid and ctype.startswith("image/") and len(datos_p) < 1_500_000:
                    inline[cid] = (ctype, datos_p)
                    if disp != "attachment":
                        continue
                adjuntos.append({"indice": i, "nombre": _texto_header(nombre) or f"adjunto-{i}", "tipo": ctype, "tamano": len(datos_p)})
        if cuerpo_html and inline:
            cuerpo_html = _cid_a_data(cuerpo_html, inline)
        return {
            "uid": uid, "carpeta": carpeta,
            "de": _direcciones(msg.get("From")), "para": _direcciones(msg.get("To")),
            "cc": _direcciones(msg.get("Cc")), "responder_a": _direcciones(msg.get("Reply-To")),
            "asunto": _texto_header(msg.get("Subject")) or "(sin asunto)",
            "fecha": _fecha(msg.get("Date")),
            "message_id": str(msg.get("Message-ID") or "").strip(),
            "references": str(msg.get("References") or "").strip(),
            "html": cuerpo_html, "texto": cuerpo_txt, "adjuntos": adjuntos,
        }
    finally:
        _cerrar(m)


def _adjunto(c: dict, carpeta: str, uid: str, indice: int):
    m = _imap(c)
    try:
        _seleccionar(m, carpeta)
        tipo, datos = m.uid("FETCH", uid, "(BODY.PEEK[])")
        crudo = next((d[1] for d in datos or [] if isinstance(d, tuple)), None)
        if not crudo:
            raise HTTPException(404, "El correo ya no existe en el servidor")
        msg = BytesParser(policy=policy.default).parsebytes(crudo)
        for i, parte in enumerate(msg.walk()):
            if i == indice and not parte.is_multipart():
                return (_texto_header(parte.get_filename()) or f"adjunto-{i}", parte.get_content_type(),
                        parte.get_payload(decode=True) or b"")
        raise HTTPException(404, "Adjunto no encontrado")
    finally:
        _cerrar(m)


def _banderas(c: dict, carpeta: str, uid: str, accion: str):
    m = _imap(c)
    try:
        _seleccionar(m, carpeta, solo_lectura=False)
        if accion in ("leido", "no_leido"):
            m.uid("STORE", uid, "+FLAGS" if accion == "leido" else "-FLAGS", "(\\Seen)")
        elif accion in ("destacar", "quitar_destacado"):
            m.uid("STORE", uid, "+FLAGS" if accion == "destacar" else "-FLAGS", "(\\Flagged)")
        elif accion in ("papelera", "spam", "archivo"):
            destino = _carpeta_especial(m, {"papelera": "trash", "spam": "junk", "archivo": "archive"}[accion])
            if not destino:
                raise HTTPException(400, "El buzón no tiene esa carpeta")
            if destino == carpeta:
                return
            # Se mueve (no se borra): el correo queda en la carpeta destino.
            tipo, _ = m.uid("COPY", uid, _q(destino))
            if tipo != "OK":
                raise HTTPException(502, "El servidor no pudo mover el correo")
            m.uid("STORE", uid, "+FLAGS", "(\\Deleted)")
            m.expunge()
        else:
            raise HTTPException(400, "Acción inválida")
    finally:
        _cerrar(m)


def _no_leidos(c: dict) -> int:
    m = _imap(c)
    try:
        tipo, datos = m.status("INBOX", "(UNSEEN)")
        r = re.search(rb"UNSEEN (\d+)", datos[0] or b"")
        return int(r.group(1)) if r else 0
    finally:
        _cerrar(m)


def _enviar(c: dict, para: list, cc: list, asunto: str, cuerpo: str, en_respuesta: dict, adjuntos: list) -> str:
    msg = EmailMessage()
    msg["From"] = formataddr((c.get("nombre_remitente") or "Grupo RYSA", c["email"]))
    msg["To"] = ", ".join(para)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = asunto
    msg["Message-ID"] = make_msgid(domain=c["email"].split("@")[-1])
    if en_respuesta.get("message_id"):
        msg["In-Reply-To"] = en_respuesta["message_id"]
        msg["References"] = (en_respuesta.get("references", "") + " " + en_respuesta["message_id"]).strip()
    texto = cuerpo + (("\n\n-- \n" + c["firma"]) if c.get("firma") else "")
    msg.set_content(texto)
    msg.add_alternative('<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">'
                        + html.escape(texto).replace("\n", "<br>") + "</div>", subtype="html")
    for nombre, tipo, datos in adjuntos:
        principal, _, sub = (tipo or "application/octet-stream").partition("/")
        msg.add_attachment(datos, maintype=principal, subtype=sub or "octet-stream", filename=nombre)
    usuario, clave = c.get("usuario") or c["email"], _descifrar(c["password_enc"])
    try:
        port = int(c["smtp_port"])
        if port == 465:
            with smtplib.SMTP_SSL(c["smtp_host"], port, context=ssl.create_default_context(), timeout=TIMEOUT) as s:
                s.login(usuario, clave)
                s.send_message(msg)
        else:
            with smtplib.SMTP(c["smtp_host"], port, timeout=TIMEOUT) as s:
                s.starttls(context=ssl.create_default_context())
                s.login(usuario, clave)
                s.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(401, f"El servidor rechazó el envío desde {c['email']}: revisa la contraseña.")
    except (smtplib.SMTPException, OSError) as e:
        raise HTTPException(502, f"No se pudo enviar el correo: {str(e)[:150]}")
    # Copia en Enviados y marca de respondido (si falla, el correo ya salió).
    try:
        m = _imap(c)
        try:
            enviados = _carpeta_especial(m, "sent")
            if enviados:
                m.append(_q(enviados), "(\\Seen)", imaplib.Time2Internaldate(time.time()), msg.as_bytes())
            if en_respuesta.get("uid") and en_respuesta.get("carpeta"):
                _seleccionar(m, en_respuesta["carpeta"], solo_lectura=False)
                m.uid("STORE", en_respuesta["uid"], "+FLAGS", "(\\Answered)")
        finally:
            _cerrar(m)
    except HTTPException:
        pass
    return msg["Message-ID"]


async def _clientes_por_correo(correos: set) -> dict:
    if not correos:
        return {}
    out = {}
    for cl in await db.clients.find({}, {"_id": 0, "id": 1, "nombre": 1, "correo": 1, "correos": 1}).to_list(20000):
        for e in re.split(r"[;,\s]+", f"{cl.get('correo') or ''} {cl.get('correos') or ''}".lower()):
            if e and e in correos:
                out[e] = {"id": cl["id"], "nombre": cl.get("nombre") or ""}
    return out


# ───────────────────────────── endpoints ─────────────────────────────
@router.get("/cuentas")
async def cuentas(user: dict = Depends(require_permission("correo.ver"))):
    return [_publica(c) for c in (await _config())["cuentas"]]


@router.put("/cuentas")
async def guardar_cuentas(data: ConfigInput, user: dict = Depends(require_permission("config"))):
    previas = {c["id"]: c for c in (await _config())["cuentas"]}
    nuevas = []
    for c in data.cuentas:
        if not re.fullmatch(r"[a-z0-9_-]{1,30}", c.id):
            raise HTTPException(422, "Identificador de cuenta inválido (solo minúsculas, números, - y _).")
        d = c.model_dump()
        clave = d.pop("password") or ""
        d["usuario"] = d.get("usuario") or d["email"]
        d["password_enc"] = _cifrar(clave) if clave else previas.get(c.id, {}).get("password_enc", "")
        nuevas.append(d)
    await db.settings.update_one({"_id": "correo"}, {"$set": {"cuentas": nuevas, "actualizado": iso_now()}}, upsert=True)
    await log_audit(user, "editar", "correo", "cuentas", ", ".join(c["email"] for c in nuevas))
    return [_publica(c) for c in nuevas]


@router.post("/cuentas/{cid}/probar")
async def probar(cid: str, user: dict = Depends(require_permission("config"))):
    c = await _cuenta(cid)
    no_leidos = await run_in_threadpool(_no_leidos, c)
    return {"ok": True, "no_leidos": no_leidos}


@router.get("/resumen")
async def resumen(user: dict = Depends(require_permission("correo.ver"))):
    out = []
    for c in (await _config())["cuentas"]:
        item = {"id": c["id"], "nombre": c.get("nombre"), "email": c["email"], "no_leidos": None, "error": ""}
        if c.get("activa", True) and c.get("password_enc"):
            try:
                item["no_leidos"] = await run_in_threadpool(_no_leidos, c)
            except HTTPException as e:
                item["error"] = str(e.detail)
        else:
            item["error"] = "Sin configurar"
        out.append(item)
    return out


@router.get("/{cid}/carpetas")
async def carpetas(cid: str, user: dict = Depends(require_permission("correo.ver"))):
    c = await _cuenta(cid)

    def _run():
        m = _imap(c)
        try:
            return _carpetas(m)
        finally:
            _cerrar(m)
    return await run_in_threadpool(_run)


@router.get("/{cid}/mensajes")
async def mensajes(cid: str, carpeta: str = "INBOX", pagina: int = 1, q: str = "", no_leidos: bool = False,
                   user: dict = Depends(require_permission("correo.ver"))):
    c = await _cuenta(cid)
    res = await run_in_threadpool(_listar, c, carpeta, max(1, pagina), q.strip()[:120], no_leidos)
    clientes = await _clientes_por_correo({d["email"] for x in res["mensajes"] for d in x["de"] + x["para"]})
    for x in res["mensajes"]:
        x["cliente"] = next((clientes[d["email"]] for d in x["de"] + x["para"] if d["email"] in clientes), None)
    return res


@router.get("/{cid}/mensajes/{uid}")
async def leer(cid: str, uid: str, carpeta: str = "INBOX", user: dict = Depends(require_permission("correo.ver"))):
    if not uid.isdigit():
        raise HTTPException(400, "UID inválido")
    c = await _cuenta(cid)
    res = await run_in_threadpool(_leer, c, carpeta, uid, True)
    clientes = await _clientes_por_correo({d["email"] for d in res["de"] + res["para"] + res["cc"]})
    res["cliente"] = next((clientes[d["email"]] for d in res["de"] + res["para"] if d["email"] in clientes), None)
    return res


@router.get("/{cid}/mensajes/{uid}/adjuntos/{indice}")
async def adjunto(cid: str, uid: str, indice: int, carpeta: str = "INBOX",
                  user: dict = Depends(require_permission("correo.ver"))):
    if not uid.isdigit():
        raise HTTPException(400, "UID inválido")
    c = await _cuenta(cid)
    nombre, tipo, datos = await run_in_threadpool(_adjunto, c, carpeta, uid, indice)
    seguro = re.sub(r'[\r\n"]', "_", nombre)
    return Response(content=datos, media_type=tipo or "application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{seguro}"', "X-Content-Type-Options": "nosniff"})


class AccionInput(BaseModel):
    uids: List[str]
    accion: str
    carpeta: str = "INBOX"


@router.post("/{cid}/acciones")
async def acciones(cid: str, data: AccionInput, user: dict = Depends(require_permission("correo.ver"))):
    c = await _cuenta(cid)
    for uid in data.uids[:100]:
        if uid.isdigit():
            await run_in_threadpool(_banderas, c, data.carpeta, uid, data.accion)
    if data.accion in ("papelera", "spam", "archivo"):
        await log_audit(user, "mover", "correo", c["email"], f"{data.accion}: {len(data.uids)} correo(s)")
    return {"ok": True}


_CORREO_RX = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")


def _lista_correos(v: str) -> list:
    xs = [e.strip() for e in re.split(r"[;,]", v or "") if e.strip()]
    for e in xs:
        if not _CORREO_RX.match(e):
            raise HTTPException(422, f"Correo inválido: {e}")
    return xs


@router.post("/{cid}/enviar")
async def enviar(cid: str, para: str = Form(...), asunto: str = Form(""), cuerpo: str = Form(""), cc: str = Form(""),
                 responde_uid: str = Form(""), responde_carpeta: str = Form(""), message_id: str = Form(""),
                 references: str = Form(""), adjuntos: List[UploadFile] = File(default=[]),
                 user: dict = Depends(require_permission("correo.enviar"))):
    c = await _cuenta(cid)
    destinatarios, copias = _lista_correos(para), _lista_correos(cc)
    if not destinatarios:
        raise HTTPException(422, "Indica al menos un destinatario")
    archivos, total = [], 0
    for a in adjuntos or []:
        datos = await a.read()
        total += len(datos)
        if total > MAX_ADJUNTOS_MB * 1024 * 1024:
            raise HTTPException(413, f"Los adjuntos superan {MAX_ADJUNTOS_MB} MB")
        archivos.append((a.filename or "adjunto", a.content_type or "application/octet-stream", datos))
    en_resp = {"uid": responde_uid if responde_uid.isdigit() else "", "carpeta": responde_carpeta,
               "message_id": message_id.strip()[:300], "references": references.strip()[:2000]}
    mid = await run_in_threadpool(_enviar, c, destinatarios, copias, asunto.strip()[:300] or "(sin asunto)",
                                  cuerpo, en_resp, archivos)
    await log_audit(user, "enviar", "correo", c["email"], f"a {', '.join(destinatarios)}: {asunto[:80]}")
    return {"ok": True, "message_id": mid}
