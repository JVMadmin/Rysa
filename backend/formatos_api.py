"""API del Editor de formatos (machotes) v2.

Modelo:
  * PREDETERMINADO DEL SISTEMA por tipo de documento: el generador de
    storage.py. Nunca se edita ni se borra; "Usar predeterminado" lo restaura.
  * PLANTILLAS PERSONALIZADAS (document_templates) con historial inmutable de
    VERSIONES (document_template_versions). Guardar = nueva versión; restaurar
    una versión = nueva versión con ese contenido (el historial no se pierde).
  * FORMATO ACTIVO (document_template_activos): qué plantilla usan los
    documentos reales de cada tipo. Sin fila = predeterminado del sistema.

Todas las rutas requieren el permiso `config`.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import text

import doc_engine
import doc_formatos_default
from deps import db, log_audit, require_permission
from pgstore.database import get_engine, transaction

logger = logging.getLogger("rysa.formatos")
router = APIRouter(prefix="/api/formatos")

MAX_CONFIG_BYTES = 300_000
MAX_BLOQUES = 400
_PERM = require_permission("config")


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #
def _tipo_valido(tipo: str) -> str:
    if tipo not in doc_engine.TIPOS_DOCUMENTO:
        raise HTTPException(404, "Tipo de documento desconocido")
    return tipo


def _contar_bloques(bloques) -> int:
    n = 0
    for b in bloques or []:
        n += 1
        cols = b.get("columnas") if isinstance(b, dict) else None
        if isinstance(cols, list):
            for c in cols:
                if isinstance(c, dict):
                    n += _contar_bloques(c.get("bloques"))
    return n


def _validar_config(cfg) -> dict:
    if not isinstance(cfg, dict):
        raise HTTPException(400, "La configuración debe ser un objeto")
    raw = json.dumps(cfg, ensure_ascii=False)
    if len(raw.encode("utf-8")) > MAX_CONFIG_BYTES:
        raise HTTPException(400, "El formato es demasiado grande")
    if cfg.get("esquema") != doc_engine.ESQUEMA or not isinstance(cfg.get("bloques"), list):
        raise HTTPException(400, "Formato inválido: se esperaba esquema 2 con lista de bloques")
    if not isinstance(cfg.get("pagina"), dict):
        raise HTTPException(400, "Formato inválido: falta la configuración de página")
    if cfg["pagina"].get("formato") not in doc_engine.TAMANOS:
        raise HTTPException(400, "Tamaño de papel no soportado")
    if _contar_bloques(cfg["bloques"]) > MAX_BLOQUES:
        raise HTTPException(400, f"Máximo {MAX_BLOQUES} bloques por formato")
    return cfg


async def _fetch(sql: str, params: dict | None = None) -> list:
    async with get_engine().connect() as conn:
        res = await conn.execute(text(sql), params or {})
        return [dict(r._mapping) for r in res.fetchall()]


def _cfg_json(v):
    return v if isinstance(v, dict) else json.loads(v or "{}")


async def config_activa(tipo: str) -> dict | None:
    """Configuración de la plantilla activa del tipo, o None (= predeterminado
    del sistema). Nunca lanza: ante cualquier error se usa el predeterminado."""
    try:
        rows = await _fetch(
            "SELECT v.configuracion FROM document_template_activos a "
            "JOIN document_templates t ON t.id = a.template_id "
            "JOIN document_template_versions v ON v.template_id = t.id AND v.version = t.version_actual "
            "WHERE a.tipo = :tipo", {"tipo": tipo})
        return _cfg_json(rows[0]["configuracion"]) if rows else None
    except Exception as e:  # tabla aún no migrada, JSON dañado, etc.
        logger.warning("Formato activo de %s no disponible: %s", tipo, str(e)[:160])
        return None


async def pdf_personalizado(tipo: str, ctx: dict, settings: dict) -> bytes | None:
    """PDF con la plantilla activa del tipo; None si se usa el predeterminado o
    si la plantilla falla (en ese caso el documento sale con el predeterminado,
    nunca se queda el usuario sin ticket)."""
    cfg = await config_activa(tipo)
    if not cfg:
        return None
    try:
        return await asyncio.to_thread(doc_engine.render, cfg, ctx, settings)
    except Exception as e:
        logger.error("Plantilla activa de %s falló; se usa el predeterminado: %s", tipo, str(e)[:200])
        return None


async def _settings() -> dict:
    return await db.settings.find_one({"_id": "app"}, {"_id": 0}) or {}


async def _plantilla(template_id: str) -> dict:
    rows = await _fetch("SELECT id, tipo, nombre, descripcion, version_actual, created_at, updated_at "
                        "FROM document_templates WHERE id = :id", {"id": template_id})
    if not rows:
        raise HTTPException(404, "Plantilla no encontrada")
    return rows[0]


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


# --------------------------------------------------------------------------- #
# Catálogo y estado                                                            #
# --------------------------------------------------------------------------- #
@router.get("")
async def listar_formatos(user: dict = Depends(_PERM)):
    plantillas = await _fetch(
        "SELECT t.id, t.tipo, t.nombre, t.descripcion, t.version_actual, t.updated_at, v.created_at AS version_fecha, "
        "v.creado_por FROM document_templates t LEFT JOIN document_template_versions v "
        "ON v.template_id = t.id AND v.version = t.version_actual ORDER BY t.updated_at DESC")
    activos = {r["tipo"]: r for r in await _fetch(
        "SELECT tipo, template_id, activado_por, updated_at FROM document_template_activos")}
    out = []
    for tipo, info in doc_engine.TIPOS_DOCUMENTO.items():
        act = activos.get(tipo)
        out.append({
            "tipo": tipo, **info,
            "activo": {"template_id": act["template_id"], "activado_por": act["activado_por"],
                       "desde": _iso(act["updated_at"])} if act else None,
            "plantillas": [{"id": p["id"], "nombre": p["nombre"], "descripcion": p["descripcion"],
                            "version_actual": p["version_actual"], "actualizado": _iso(p["updated_at"]),
                            "actualizado_por": p["creado_por"]}
                           for p in plantillas if p["tipo"] == tipo],
        })
    return {"tipos": out, "catalogos": {
        "campos_item": {k: v[0] for k, v in doc_engine.CAMPOS_ITEM.items()},
        "campos_total": doc_engine.CAMPOS_TOTAL,
        "tamanos": list(doc_engine.TAMANOS), "fuentes": list(doc_engine.FAMILIAS),
    }}


@router.get("/{tipo}/predeterminado")
async def ver_predeterminado(tipo: str, user: dict = Depends(_PERM)):
    _tipo_valido(tipo)
    return {"tipo": tipo, "configuracion": doc_formatos_default.predeterminado(tipo)}


@router.post("/{tipo}/activar")
async def activar(tipo: str, data: dict = Body(...), user: dict = Depends(_PERM)):
    _tipo_valido(tipo)
    p = await _plantilla(str(data.get("template_id") or ""))
    if p["tipo"] != tipo:
        raise HTTPException(400, "La plantilla es de otro tipo de documento")
    async with transaction() as conn:
        await conn.execute(text(
            "INSERT INTO document_template_activos (tipo, template_id, activado_por, updated_at) "
            "VALUES (:tipo, :tid, :u, now()) ON CONFLICT (tipo) DO UPDATE "
            "SET template_id = EXCLUDED.template_id, activado_por = EXCLUDED.activado_por, updated_at = now()"),
            {"tipo": tipo, "tid": p["id"], "u": user.get("name")})
    await log_audit(user, "formato_activar", "formato", p["id"],
                    f"{tipo}: '{p['nombre']}' v{p['version_actual']} en uso")
    return {"ok": True}


@router.post("/{tipo}/usar-predeterminado")
async def usar_predeterminado(tipo: str, user: dict = Depends(_PERM)):
    _tipo_valido(tipo)
    async with transaction() as conn:
        await conn.execute(text("DELETE FROM document_template_activos WHERE tipo = :tipo"), {"tipo": tipo})
    await log_audit(user, "formato_predeterminado", "formato", tipo,
                    f"{tipo}: se restauró el formato predeterminado del sistema")
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Plantillas y versiones                                                       #
# --------------------------------------------------------------------------- #
@router.get("/plantillas/{template_id}")
async def ver_plantilla(template_id: str, user: dict = Depends(_PERM)):
    p = await _plantilla(template_id)
    versiones = await _fetch(
        "SELECT version, formato_fisico, creado_por, created_at, nota, configuracion "
        "FROM document_template_versions WHERE template_id = :id ORDER BY version DESC", {"id": template_id})
    actual = next((v for v in versiones if v["version"] == p["version_actual"]), None)
    activo = await _fetch("SELECT 1 FROM document_template_activos WHERE template_id = :id", {"id": template_id})
    return {
        "id": p["id"], "tipo": p["tipo"], "nombre": p["nombre"], "descripcion": p["descripcion"],
        "version_actual": p["version_actual"], "en_uso": bool(activo),
        "configuracion": doc_engine.normalizar(_cfg_json(actual["configuracion"])) if actual else None,
        "versiones": [{"version": v["version"], "formato": v["formato_fisico"], "creado_por": v["creado_por"],
                       "fecha": _iso(v["created_at"]), "nota": v["nota"] or ""} for v in versiones],
    }


@router.get("/plantillas/{template_id}/versiones/{version}")
async def ver_version(template_id: str, version: int, user: dict = Depends(_PERM)):
    rows = await _fetch("SELECT configuracion FROM document_template_versions "
                        "WHERE template_id = :id AND version = :v", {"id": template_id, "v": version})
    if not rows:
        raise HTTPException(404, "Versión no encontrada")
    return {"version": version, "configuracion": doc_engine.normalizar(_cfg_json(rows[0]["configuracion"]))}


async def _insertar_version(conn, template_id: str, version: int, cfg: dict, user: dict, nota: str = ""):
    await conn.execute(text(
        "INSERT INTO document_template_versions (id, template_id, version, formato_fisico, configuracion, "
        "estado, creado_por, created_at, nota) VALUES (:id, :tid, :v, :fmt, CAST(:cfg AS jsonb), 'ACTIVO', "
        ":u, now(), :nota)"),
        {"id": f"ver_{uuid.uuid4().hex[:16]}", "tid": template_id, "v": version,
         "fmt": cfg["pagina"].get("formato", "carta"), "cfg": json.dumps(cfg, ensure_ascii=False),
         "u": user.get("name") or "usuario", "nota": (nota or "")[:300]})


@router.post("/plantillas")
async def crear_plantilla(data: dict = Body(...), user: dict = Depends(_PERM)):
    tipo = _tipo_valido(str(data.get("tipo") or ""))
    nombre = str(data.get("nombre") or "").strip()[:120]
    if not nombre:
        raise HTTPException(400, "El nombre es obligatorio")
    if data.get("configuracion"):
        cfg = _validar_config(data["configuracion"])
        nota = data.get("nota") or "Versión inicial"
    elif data.get("desde_plantilla"):
        rows = await _fetch(
            "SELECT t.tipo, v.configuracion FROM document_templates t JOIN document_template_versions v "
            "ON v.template_id = t.id AND v.version = t.version_actual WHERE t.id = :id",
            {"id": data["desde_plantilla"]})
        if not rows or rows[0]["tipo"] != tipo:
            raise HTTPException(404, "Plantilla de origen no encontrada")
        cfg = doc_engine.normalizar(_cfg_json(rows[0]["configuracion"]))
        nota = "Duplicada"
    else:
        cfg = doc_formatos_default.predeterminado(tipo)
        nota = "Copia del formato predeterminado"
    existe = await _fetch("SELECT 1 FROM document_templates WHERE tipo = :t AND nombre = :n",
                          {"t": tipo, "n": nombre})
    if existe:
        raise HTTPException(409, "Ya existe un formato con ese nombre para este documento")
    tid = f"tpl_{uuid.uuid4().hex[:16]}"
    async with transaction() as conn:
        await conn.execute(text(
            "INSERT INTO document_templates (id, tipo, nombre, descripcion, activo, version_actual, created_at, "
            "updated_at) VALUES (:id, :tipo, :nombre, :desc, TRUE, 1, now(), now())"),
            {"id": tid, "tipo": tipo, "nombre": nombre, "desc": str(data.get("descripcion") or "")[:300]})
        await _insertar_version(conn, tid, 1, cfg, user, nota)
    await log_audit(user, "formato_crear", "formato", tid, f"{tipo}: '{nombre}' ({nota})")
    return {"ok": True, "id": tid, "version": 1}


@router.put("/plantillas/{template_id}")
async def guardar_version(template_id: str, data: dict = Body(...), user: dict = Depends(_PERM)):
    cfg = _validar_config(data.get("configuracion"))
    async with transaction() as conn:
        row = (await conn.execute(text(
            "SELECT version_actual, nombre FROM document_templates WHERE id = :id FOR UPDATE"),
            {"id": template_id})).first()
        if not row:
            raise HTTPException(404, "Plantilla no encontrada")
        nueva = int(row.version_actual) + 1
        await _insertar_version(conn, template_id, nueva, cfg, user, data.get("nota") or "")
        nombre = str(data.get("nombre") or row.nombre).strip()[:120] or row.nombre
        await conn.execute(text(
            "UPDATE document_templates SET version_actual = :v, nombre = :n, "
            "descripcion = COALESCE(:d, descripcion), updated_at = now() WHERE id = :id"),
            {"v": nueva, "n": nombre, "d": data.get("descripcion"), "id": template_id})
    await log_audit(user, "formato_version", "formato", template_id, f"'{nombre}' guardado como v{nueva}")
    return {"ok": True, "version": nueva}


@router.post("/plantillas/{template_id}/restaurar/{version}")
async def restaurar_version(template_id: str, version: int, user: dict = Depends(_PERM)):
    async with transaction() as conn:
        row = (await conn.execute(text(
            "SELECT version_actual, nombre FROM document_templates WHERE id = :id FOR UPDATE"),
            {"id": template_id})).first()
        if not row:
            raise HTTPException(404, "Plantilla no encontrada")
        src = (await conn.execute(text(
            "SELECT configuracion FROM document_template_versions WHERE template_id = :id AND version = :v"),
            {"id": template_id, "v": version})).first()
        if not src:
            raise HTTPException(404, "Versión no encontrada")
        cfg = doc_engine.normalizar(_cfg_json(src.configuracion))
        nueva = int(row.version_actual) + 1
        await _insertar_version(conn, template_id, nueva, cfg, user, f"Restaurada desde la versión {version}")
        await conn.execute(text("UPDATE document_templates SET version_actual = :v, updated_at = now() WHERE id = :id"),
                           {"v": nueva, "id": template_id})
    await log_audit(user, "formato_restaurar", "formato", template_id,
                    f"'{row.nombre}': v{version} restaurada como v{nueva}")
    return {"ok": True, "version": nueva}


@router.delete("/plantillas/{template_id}")
async def eliminar_plantilla(template_id: str, user: dict = Depends(_PERM)):
    p = await _plantilla(template_id)
    if await _fetch("SELECT 1 FROM document_template_activos WHERE template_id = :id", {"id": template_id}):
        raise HTTPException(409, "Este formato está en uso. Activa otro o el predeterminado antes de eliminarlo.")
    async with transaction() as conn:
        await conn.execute(text("DELETE FROM document_templates WHERE id = :id"), {"id": template_id})
    await log_audit(user, "formato_eliminar", "formato", template_id, f"{p['tipo']}: '{p['nombre']}' eliminado")
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Vista previa                                                                 #
# --------------------------------------------------------------------------- #
async def _contexto_real(tipo: str, ref: str, settings: dict) -> dict:
    ref = (ref or "").strip()
    if not ref:
        raise HTTPException(400, "Indica el folio del documento")
    if tipo in ("ticket", "carta_venta", "cotizacion"):
        sale = await db.sales.find_one({"$or": [{"id": ref}, {"folio": ref}]}, {"_id": 0})
        if not sale:
            raise HTTPException(404, "No se encontró la venta/cotización con ese folio")
        cliente = await db.clients.find_one({"id": sale.get("cliente_id")}, {"_id": 0}) if sale.get("cliente_id") else None
        cuentas = []
        if tipo == "cotizacion":
            cuentas = await db.cuentas_bancarias.find({"activa": {"$ne": False}}, {"_id": 0}).to_list(100)
            cuentas.sort(key=lambda d: (0 if d.get("predeterminada") else 1, (d.get("banco") or "").lower()))
        return doc_engine.contexto_venta(sale, settings, cliente, cuentas,
                                         pago_url="https://gruporysa.com/pago/comprobante/vista-previa")
    if tipo == "abono":
        ab = await db.abonos.find_one({"$or": [{"id": ref}, {"folio": ref}]}, {"_id": 0})
        if not ab:
            raise HTTPException(404, "No se encontró el abono con ese folio")
        cli = await db.clients.find_one({"id": ab.get("cliente_id")}, {"_id": 0}) if ab.get("cliente_id") else None
        return doc_engine.contexto_abono(ab, settings, cli)
    if tipo == "compra":
        cp = await db.compras.find_one({"$or": [{"id": ref}, {"folio": ref}]}, {"_id": 0})
        if not cp:
            raise HTTPException(404, "No se encontró la compra con ese folio")
        prov = await db.proveedores.find_one({"id": cp.get("proveedor_id")}, {"_id": 0}) if cp.get("proveedor_id") else None
        return doc_engine.contexto_compra(cp, settings, prov)
    mov = await db.caja_movimientos.find_one({"$or": [{"id": ref}, {"folio": ref}]}, {"_id": 0})
    if not mov:
        raise HTTPException(404, "No se encontró el movimiento de caja con ese folio")
    caja = await db.cajas.find_one({"id": mov.get("caja_id")}, {"_id": 0}) or {}
    return doc_engine.contexto_entrega(mov, caja, settings, None)


@router.post("/vista-previa")
async def vista_previa(data: dict = Body(...), user: dict = Depends(_PERM)):
    """PDF de una configuración (guardada o no) con datos de ejemplo o de un
    documento real. No guarda nada."""
    tipo = _tipo_valido(str(data.get("tipo") or ""))
    settings = await _settings()
    if data.get("predeterminado"):
        cfg = doc_formatos_default.predeterminado(tipo)
    else:
        cfg = _validar_config(data.get("configuracion"))
    if data.get("origen") == "documento":
        ctx = await _contexto_real(tipo, str(data.get("folio") or ""), settings)
    else:
        ctx = doc_engine.datos_ejemplo(tipo, settings)
    try:
        pdf = doc_engine.render(cfg, ctx, settings)
    except Exception as e:
        logger.warning("Vista previa de formato falló: %s", str(e)[:200])
        raise HTTPException(400, "No se pudo generar la vista previa con esta configuración")
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Cache-Control": "no-store",
                                      "Content-Disposition": f'inline; filename="vista-previa-{tipo}.pdf"'})


@router.get("/{tipo}/documentos-recientes")
async def documentos_recientes(tipo: str, user: dict = Depends(_PERM)):
    """Últimos folios del tipo, para elegir uno real en la vista previa."""
    _tipo_valido(tipo)
    if tipo in ("ticket", "carta_venta"):
        docs = await db.sales.find({"estado": "confirmada"}, {"_id": 0, "folio": 1, "cliente_nombre": 1, "total": 1}) \
            .sort("fecha", -1).limit(15).to_list(15)
    elif tipo == "cotizacion":
        docs = await db.sales.find({"tipo_venta": "cotizacion"}, {"_id": 0, "folio": 1, "cliente_nombre": 1, "total": 1}) \
            .sort("fecha", -1).limit(15).to_list(15)
    elif tipo == "abono":
        docs = await db.abonos.find({}, {"_id": 0, "folio": 1, "cliente_nombre": 1, "monto": 1}) \
            .sort("fecha", -1).limit(15).to_list(15)
    elif tipo == "compra":
        docs = await db.compras.find({}, {"_id": 0, "folio": 1, "proveedor_nombre": 1, "total": 1}) \
            .sort("fecha_recepcion", -1).limit(15).to_list(15)
    else:
        docs = await db.caja_movimientos.find({"folio": {"$exists": True}}, {"_id": 0, "folio": 1, "concepto": 1, "monto": 1}) \
            .sort("fecha", -1).limit(15).to_list(15)
    return [{"folio": d.get("folio"),
             "detalle": d.get("cliente_nombre") or d.get("proveedor_nombre") or d.get("concepto") or "",
             "importe": d.get("total", d.get("monto"))} for d in docs if d.get("folio")]
