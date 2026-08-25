"""Módulo de operación en campo: vendedores, visitas, ubicaciones y supervisión.

Agrupa los endpoints del APP de vendedores (/api/seller/*), el módulo de
visitas (/api/visits/*), ubicaciones (/api/locations/*) y el Centro de
Supervisión Comercial (/api/supervision/*).

Toda la información vive en las mismas tablas del ERP (clients, sales, abonos,
products) + las nuevas colecciones de campo (visits, seller_locations,
sales_routes). No se duplica inventario ni clientes.
"""
import uuid
from datetime import datetime, date, timedelta, timezone
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, File, UploadFile
from pydantic import BaseModel, Field

import storage

from deps import (
    db, iso_now, now_utc, get_current_user, require_permission,
    user_has_permission, log_audit,
)

router = APIRouter(prefix="/api")

# --------------------------------------------------------------------------- #
# Constantes de actividad / estados de vendedor (reglas configurables)         #
# --------------------------------------------------------------------------- #
ACTIVO_MINUTOS = 30           # con actividad en ≤30 min → Activo
EN_RUTA_MINUTOS = 30          # ubicación reciente + actividad → En ruta
SIN_ACTIVIDAD_MINUTOS = 120   # sin actividad en >120 min → Sin actividad
ROLES_CAMPO = ("vendedor", "encargado", "supervisor")
ROLES_ADMIN = ("admin", "admin_propietario", "admin_desarrollador")

ESTADOS_VISITA = ("programada", "en_camino", "realizada", "cancelada", "no_localizado")
TIPOS_VISITA = ("visita", "cobro", "nueva", "seguimiento")


def _uid() -> str:
    return uuid.uuid4().hex


def _iso_to_dt(value) -> Optional[datetime]:
    """Convierte ISO a datetime SIEMPRE timezone-aware (UTC).
    Las fechas pueden llegar con o sin offset (GPS real vs. datos generados/
    legados); compararlas directamente lanza TypeError naive-vs-aware."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        try:
            dt = datetime.fromisoformat(str(value)[:19])
        except Exception:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _parse_date(s) -> Optional[date]:
    try:
        return date.fromisoformat(str(s)[:10])
    except Exception:
        return None


def _dias_vencido(fecha_iso, dias_credito, hoy):
    d = _parse_date(fecha_iso)
    if not d:
        return 0, None
    vence = d + timedelta(days=int(dias_credito or 0))
    return (hoy - vence).days, vence.isoformat()


def _vende_todo(user: dict) -> bool:
    return user_has_permission(user, "venta.ver_todas") or user_has_permission(user, "supervision.ver")


def _puede_gestionar_visitas(user: dict) -> bool:
    return _vende_todo(user) or user.get("role") in ROLES_CAMPO


def _es_admin(user: dict) -> bool:
    return user.get("role") in ROLES_ADMIN


def _roles_de_campo() -> List[str]:
    return list(ROLES_CAMPO)


async def _usuarios_campo(sucursal_id: Optional[str] = None) -> list:
    """Usuarios activos que operan en campo (vendedores/encargados/supervisores)."""
    flt = {"active": {"$ne": False}, "role": {"$in": list(ROLES_CAMPO)}}
    if sucursal_id:
        flt["sucursal_id"] = sucursal_id
    return await db.users.find(flt, {"_id": 0, "id": 1, "name": 1, "email": 1,
                                     "role": 1, "sucursal_id": 1}).to_list(500)


def _cartera_filtro(user: dict) -> dict:
    """Clientes de la cartera de un vendedor: asignados + sin asignar."""
    return {"$or": [
        {"vendedor_id": user["id"]},
        {"vendedor": user.get("name", "")},
        {"vendedor_id": {"$exists": False}},
    ]}


async def _cartera_clients(user: dict) -> list:
    return await db.clients.find(_cartera_filtro(user), {"_id": 0}).to_list(50000)


async def _clientes_por_seller(por_vendedor: Optional[str] = None) -> list:
    flt = {}
    if por_vendedor:
        flt["$or"] = [{"vendedor_id": por_vendedor}, {"vendedor": {"$exists": False}}]
    else:
        flt["vendedor_id"] = {"$exists": True}
    return await db.clients.find(flt, {"_id": 0}).to_list(50000)


# --------------------------------------------------------------------------- #
# Modelos                                                                      #
# --------------------------------------------------------------------------- #
class LocationInput(BaseModel):
    latitud: float
    longitud: float
    precision: Optional[float] = None
    fuente: Optional[str] = "gps"


class VisitInput(BaseModel):
    cliente_id: str
    cliente_nombre: Optional[str] = ""
    cliente_codigo: Optional[str] = ""
    fecha_programada: Optional[str] = ""
    hora: Optional[str] = ""
    tipo_visita: str = "visita"
    estado: str = "programada"
    comentarios: Optional[str] = ""
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    vendedor_id: Optional[str] = None


class VisitUpdate(BaseModel):
    estado: Optional[str] = None
    comentarios: Optional[str] = None
    resultado: Optional[str] = None
    fecha_programada: Optional[str] = None
    hora: Optional[str] = None
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    tipo_visita: Optional[str] = None


class CheckInInput(BaseModel):
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    comentarios: Optional[str] = ""
    resultado: Optional[str] = ""


class RouteInput(BaseModel):
    nombre: str
    descripcion: Optional[str] = ""
    sucursal_id: Optional[str] = None
    activa: bool = True
    clientes: List[str] = Field(default_factory=list)
    fecha_programada: Optional[str] = ""


class CarteraAsignacion(BaseModel):
    vendedor_id: str
    cliente_ids: List[str] = Field(default_factory=list)
    reemplazar: bool = True   # True: quita la asignación a clientes que estaban y no vienen en la lista


# ==========================================================================
# VENDEDOR — dashboard, mapa, ubicación, cartera
# ==========================================================================
async def _resumen_cxc_cliente(cliente_id: str, saldo_cliente: float, dias_credito: int) -> dict:
    """Saldo y vencido de un cliente a partir de sus ventas a crédito activas."""
    hoy = now_utc().date()
    vencido = 0.0
    corriente = 0.0
    sales = await db.sales.find(
        {"cliente_id": cliente_id, "condicion": "credito",
         "estado": "confirmada", "saldo": {"$gt": 0}},
        {"_id": 0, "fecha": 1, "saldo": 1}).to_list(100000)
    for s in sales:
        dv, _ = _dias_vencido(s["fecha"], dias_credito, hoy)
        if dv > 0:
            vencido += float(s.get("saldo", 0))
        else:
            corriente += float(s.get("saldo", 0))
    return {
        "saldo": round(float(saldo_cliente or 0), 2),
        "vencido": round(vencido, 2),
        "corriente": round(corriente, 2),
        "por_vencer": round(max(0.0, float(saldo_cliente or 0) - vencido), 2),
    }


async def _cxc_de_cartera(vendedor_id: str) -> dict:
    """CxC consolidada de la cartera de un vendedor (saldo, vencido, cobrado)."""
    hoy = now_utc().date()
    clientes = await db.clients.find(
        {"$or": [{"vendedor_id": vendedor_id}, {"vendedor_id": {"$exists": False}}]},
        {"_id": 0, "id": 1, "saldo": 1, "dias_credito": 1}).to_list(50000)
    cmap = {c["id"]: c for c in clientes}
    sales = await db.sales.find(
        {"vendedor_id": vendedor_id, "condicion": "credito",
         "estado": "confirmada", "saldo": {"$gt": 0}},
        {"_id": 0, "cliente_id": 1, "fecha": 1, "saldo": 1}).to_list(200000)
    vencido = 0.0
    for s in sales:
        cid = s.get("cliente_id")
        cli = cmap.get(cid, {})
        dv, _ = _dias_vencido(s["fecha"], cli.get("dias_credito", 0), hoy)
        if dv > 0:
            vencido += float(s.get("saldo", 0))
    saldo_total = round(sum(float(c.get("saldo", 0) or 0) for c in clientes), 2)
    hoy_iso = hoy.isoformat()
    abonos = await db.abonos.find(
        {"fecha": {"$regex": "^" + hoy_iso}},
        {"_id": 0, "monto": 1, "usuario_id": 1}).to_list(100000)
    cobrado_hoy = round(sum(float(a.get("monto", 0) or 0)
                            for a in abonos if a.get("usuario_id") == vendedor_id), 2)
    return {
        "saldo_total": round(saldo_total, 2),
        "vencido": round(vencido, 2),
        "por_vencer": round(max(0.0, saldo_total - vencido), 2),
        "cobrado_hoy": cobrado_hoy,
    }


@router.get("/seller/dashboard")
async def seller_dashboard(user: dict = Depends(get_current_user)):
    """Dashboard del vendedor autenticado (ventas, cobros, CxC, visitas)."""
    vid = user["id"]
    now = now_utc()
    hoy = now.date().isoformat()
    mes = now.strftime("%Y-%m")
    base = {"vendedor_id": vid, "estado": "confirmada"}

    ventas_hoy = await db.sales.find(
        {**base, "fecha": {"$regex": "^" + hoy}},
        {"_id": 0, "total": 1, "cliente_id": 1, "cliente_nombre": 1,
         "folio": 1, "fecha": 1}).to_list(100000)
    ventas_mes = await db.sales.find(
        {**base, "fecha": {"$regex": "^" + mes}},
        {"_id": 0, "total": 1}).to_list(200000)

    clientes_hoy = {v.get("cliente_id") for v in ventas_hoy if v.get("cliente_id")}

    cxc = await _cxc_de_cartera(vid)

    abonos_hoy = await db.abonos.find(
        {"usuario_id": vid, "fecha": {"$regex": "^" + hoy}},
        {"_id": 0, "monto": 1, "cliente_nombre": 1, "folio": 1, "fecha": 1}).to_list(100000)

    visitas = await db.visits.find({"vendedor_id": vid}, {"_id": 0}).to_list(100000)
    programadas = [v for v in visitas if v.get("estado") == "programada"]
    realizadas_hoy = [v for v in visitas
                      if v.get("estado") == "realizada" and str(v.get("fecha", ""))[:10] == hoy]
    proximas = sorted(
        [v for v in programadas if str(v.get("fecha_programada", ""))[:10] >= hoy],
        key=lambda v: v.get("fecha_programada", ""))[:5]

    ultimas_ventas = sorted(ventas_hoy, key=lambda v: v.get("fecha", ""), reverse=True)[:5]
    ultimos_clientes = []
    seen = set()
    for v in sorted(ventas_hoy, key=lambda x: x.get("fecha", ""), reverse=True):
        cid = v.get("cliente_id")
        if cid and cid not in seen:
            seen.add(cid)
            ultimos_clientes.append({"cliente_id": cid, "cliente_nombre": v.get("cliente_nombre"),
                                     "fecha": v.get("fecha"), "total": v.get("total")})
        if len(ultimos_clientes) >= 5:
            break

    return {
        "ventas_dia": {"monto": round(sum(float(v.get("total", 0) or 0) for v in ventas_hoy), 2),
                       "numero": len(ventas_hoy)},
        "ventas_mes": {"monto": round(sum(float(v.get("total", 0) or 0) for v in ventas_mes), 2),
                       "numero": len(ventas_mes)},
        "clientes_atendidos_hoy": len(clientes_hoy),
        "cxc": cxc,
        "cobros_hoy": {"monto": round(sum(float(a.get("monto", 0) or 0) for a in abonos_hoy), 2),
                       "numero": len(abonos_hoy)},
        "visitas": {
            "programadas": len(programadas),
            "realizadas_hoy": len(realizadas_hoy),
            "total_hoy": sum(1 for v in visitas if str(v.get("fecha", ""))[:10] == hoy),
            "proximas": proximas,
        },
        "actividad": {
            "ultimas_ventas": ultimas_ventas,
            "ultimos_clientes": ultimos_clientes,
            "ultimos_cobros": sorted(abonos_hoy, key=lambda a: a.get("fecha", ""), reverse=True)[:5],
            "proximas_visitas": proximas,
        },
    }


@router.get("/seller/map")
async def seller_map(user: dict = Depends(get_current_user)):
    """Datos del mapa del vendedor: clientes con coordenadas, visitas y ubicación."""
    vid = user["id"]
    hoy = now_utc().date().isoformat()
    clientes = await _cartera_clients(user)
    cmap = {c["id"]: c for c in clientes}

    # Visitas programadas / de hoy con datos de cliente.
    visits = await db.visits.find(
        {"vendedor_id": vid},
        {"_id": 0}).to_list(100000)
    visitas_hoy = [v for v in visits if str(v.get("fecha", ""))[:10] == hoy]
    programadas = [v for v in visits if v.get("estado") in ("programada", "en_camino")]
    visitas_futuras = sorted(
        [v for v in programadas if str(v.get("fecha_programada", ""))[:10] >= hoy or v.get("fecha_programada") == ""],
        key=lambda v: v.get("fecha_programada", "9999"))

    # Clientes con coordenadas + contexto comercial.
    pts_clientes = []
    for c in clientes:
        lat = c.get("latitud")
        lng = c.get("longitud")
        if lat is None or lng is None:
            continue
        pts_clientes.append({
            "id": c["id"], "codigo": c.get("codigo"), "nombre": c.get("nombre"),
            "telefono": c.get("telefono") or c.get("celular"), "direccion": c.get("direccion"),
            "ciudad": c.get("ciudad"), "estado": c.get("estado_geo"), "cp": c.get("cp"),
            "latitud": lat, "longitud": lng,
            "foto_fachada": c.get("foto_fachada") or "",
            "saldo": round(float(c.get("saldo", 0) or 0), 2),
            "credito": bool(c.get("credito_autorizado")),
            "vendedor_id": c.get("vendedor_id"),
            "ultima_compra": c.get("ult_fecha_compra") or "",
            "proxima_visita": c.get("proxima_visita") or "",
        })
    # Enriquecer con última visita por cliente.
    ult_visita = {}
    for v in sorted(visits, key=lambda x: x.get("fecha", ""), reverse=True):
        cid = v.get("cliente_id")
        if cid and cid not in ult_visita:
            ult_visita[cid] = {"fecha": v.get("fecha"), "estado": v.get("estado")}
    for p in pts_clientes:
        p["ultima_visita"] = ult_visita.get(p["id"], {}).get("fecha", "")

    # Última ubicación conocida del vendedor.
    ubicaciones = await db.seller_locations.find(
        {"vendedor_id": vid}, {"_id": 0}).sort("fecha", -1).to_list(1)
    ult_ubic = ubicaciones[0] if ubicaciones else None

    return {
        "cliente": "cliente",
        "clientes": pts_clientes,
        "visitas_hoy": visitas_hoy,
        "visitas_programadas": visitas_futuras,
        "ubicacion_actual": ult_ubic,
        "resumen": {
            "clientes_con_ubicacion": len(pts_clientes),
            "clientes_con_saldo": sum(1 for p in pts_clientes if p["saldo"] > 0),
            "visitas_hoy": len(visitas_hoy),
            "visitas_programadas": len(visitas_futuras),
        },
    }


@router.get("/seller/clients")
async def seller_clients(q: Optional[str] = None, user: dict = Depends(get_current_user)):
    """Clientes de la cartera del vendedor autenticado (búsqueda por nombre,
    teléfono, código o RFC)."""
    flt = _cartera_filtro(user)
    if q:
        rx = {"$regex": _escape_re(q), "$options": "i"}
        flt["$and"] = [{"$or": [
            {"nombre": rx}, {"codigo": rx}, {"rfc": rx},
            {"telefono": rx}, {"celular": rx}, {"whatsapp": rx}]}]
    clientes = await db.clients.find(flt, {"_id": 0}).sort("nombre", 1).to_list(50000)
    out = []
    for c in clientes:
        out.append({
            "id": c["id"], "codigo": c.get("codigo"), "nombre": c.get("nombre"),
            "telefono": c.get("telefono") or c.get("celular"), "whatsapp": c.get("whatsapp"),
            "correo": c.get("correo"), "direccion": c.get("direccion"),
            "ciudad": c.get("ciudad"), "estado_geo": c.get("estado_geo"),
            "rfc": c.get("rfc"), "saldo": round(float(c.get("saldo", 0) or 0), 2),
            "limite_credito": round(float(c.get("limite_credito", 0) or 0), 2),
            "credito_autorizado": bool(c.get("credito_autorizado")),
            "dias_credito": c.get("dias_credito", 0),
            "latitud": c.get("latitud"), "longitud": c.get("longitud"),
            "proxima_visita": c.get("proxima_visita") or "",
            "ult_fecha_compra": c.get("ult_fecha_compra") or "",
            "vendedor_id": c.get("vendedor_id"),
            "condicion_pago": c.get("condicion_pago", "contado"),
            "foto_fachada": c.get("foto_fachada") or "",
        })
    return out


# ==========================================================================
# FOTO DE FACHADA DEL CLIENTE (para ubicar el negocio más fácilmente)
# La sube su vendedor asignado (o admin/supervisión); se ve en
# Supervisión Comercial → Clientes y en las fichas/mapa.
# ==========================================================================
_MIME_EXT = {"image/jpeg": ".jpg", "image/png": ".png",
             "image/webp": ".webp", "image/gif": ".gif"}


def _puede_gestionar_fachada(user: dict, cliente: dict) -> bool:
    if _es_admin(user) or _vende_todo(user):
        return True
    # El vendedor solo sobre SU cartera (o clientes sin asignar).
    return cliente.get("vendedor_id") in (None, "", user["id"])


async def _soft_delete_archivo(url: str):
    """Marca is_deleted el registro del archivo previo (best-effort)."""
    if not url or not url.startswith("/api/files/"):
        return
    old_path = url[len("/api/files/"):]
    try:
        await db.files.update_one({"storage_path": old_path},
                                  {"$set": {"is_deleted": True}})
    except Exception:
        pass


@router.post("/clients/{cliente_id}/fachada")
async def subir_fachada_cliente(cliente_id: str, file: UploadFile = File(...),
                                user: dict = Depends(get_current_user)):
    """Sube/actualiza la foto de la fachada de un cliente (máx 8 MB,
    JPG/PNG/WEBP/GIF). Queda disponible para supervisión y mapa."""
    cli = await db.clients.find_one({"id": cliente_id})
    if not cli:
        raise HTTPException(404, "Cliente no encontrado")
    if not _puede_gestionar_fachada(user, cli):
        raise HTTPException(403, "Solo puedes subir fotos de tus propios clientes")

    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(400, "La imagen no debe superar 8 MB.")
    mime = storage.detect_mime_type(data)
    if mime not in _MIME_EXT:
        raise HTTPException(400, "Formato no permitido. Usa JPG, PNG, WEBP o GIF.")

    path = f"uploads/fachadas/{_uid()}{_MIME_EXT[mime]}"
    try:
        result = storage.put_object(path, data, mime)
    except Exception:
        raise HTTPException(502, "No se pudo guardar la imagen.")
    stored = result.get("path", path)
    await db.files.insert_one({
        "id": _uid(), "storage_path": stored,
        "original_filename": file.filename or "fachada",
        "content_type": mime, "size": result.get("size", len(data)),
        "original_size": len(data), "original_type": mime,
        "is_deleted": False, "created_at": iso_now(),
    })

    await _soft_delete_archivo(cli.get("foto_fachada") or "")
    url = f"/api/files/{stored}"
    await db.clients.update_one(
        {"id": cliente_id},
        {"$set": {"foto_fachada": url, "fachada_actualizada": iso_now()}})
    await log_audit(user, "subir_fachada", "cliente", cliente_id,
                    cli.get("nombre", ""), url)
    return {"ok": True, "foto_fachada": url}


@router.delete("/clients/{cliente_id}/fachada")
async def eliminar_fachada_cliente(cliente_id: str, user: dict = Depends(get_current_user)):
    cli = await db.clients.find_one({"id": cliente_id})
    if not cli:
        raise HTTPException(404, "Cliente no encontrado")
    if not _puede_gestionar_fachada(user, cli):
        raise HTTPException(403, "Solo puedes gestionar fotos de tus propios clientes")
    await _soft_delete_archivo(cli.get("foto_fachada") or "")
    # El adaptador no soporta $unset: se usa $set vacío ("sin foto").
    await db.clients.update_one(
        {"id": cliente_id},
        {"$set": {"foto_fachada": "", "fachada_actualizada": ""}})
    await log_audit(user, "eliminar_fachada", "cliente", cliente_id, cli.get("nombre", ""))
    return {"ok": True}


@router.get("/seller/cxc")
async def seller_cxc(user: dict = Depends(get_current_user)):
    """CxC del vendedor: totales + listado de clientes con saldo."""
    vid = user["id"]
    hoy = now_utc().date()
    resumen = await _cxc_de_cartera(vid)
    clientes = await _cartera_clients(user)
    cmap = {c["id"]: c for c in clientes if float(c.get("saldo", 0) or 0) > 0}

    sales = await db.sales.find(
        {"vendedor_id": vid, "condicion": "credito", "estado": "confirmada",
         "saldo": {"$gt": 0}},
        {"_id": 0, "cliente_id": 1, "fecha": 1, "saldo": 1, "folio": 1,
         "total": 1, "vendedor_id": 1}).to_list(200000)
    agg = {}
    for s in sales:
        cid = s.get("cliente_id")
        if not cid or cid not in cmap:
            continue
        cli = cmap[cid]
        dv, _ = _dias_vencido(s["fecha"], cli.get("dias_credito", 0), hoy)
        a = agg.setdefault(cid, {"vencido": 0.0, "corriente": 0.0, "max_dias": 0, "ventas": 0})
        a["ventas"] += 1
        a["max_dias"] = max(a["max_dias"], dv)
        if dv > 0:
            a["vencido"] += float(s.get("saldo", 0))
        else:
            a["corriente"] += float(s.get("saldo", 0))
    # Último pago por cliente.
    abonos = await db.abonos.find(
        {"cliente_id": {"$in": list(cmap.keys())}},
        {"_id": 0, "cliente_id": 1, "fecha": 1, "monto": 1}).to_list(200000)
    ultimo_pago = {}
    for a in sorted(abonos, key=lambda x: x.get("fecha", ""), reverse=True):
        cid = a.get("cliente_id")
        if cid and cid not in ultimo_pago:
            ultimo_pago[cid] = {"fecha": a.get("fecha"), "monto": a.get("monto")}

    rows = []
    for cid, cli in cmap.items():
        a = agg.get(cid, {"vencido": 0.0, "corriente": 0.0, "max_dias": 0, "ventas": 0})
        rows.append({
            "cliente_id": cid, "codigo": cli.get("codigo"), "nombre": cli.get("nombre"),
            "telefono": cli.get("telefono") or cli.get("celular"),
            "saldo": round(float(cli.get("saldo", 0) or 0), 2),
            "vencido": round(a["vencido"], 2),
            "max_dias": a["max_dias"],
            "dias_credito": cli.get("dias_credito", 0),
            "ventas_pendientes": a["ventas"],
            "ultimo_pago": ultimo_pago.get(cid, {}).get("fecha", ""),
            "ultimo_pago_monto": ultimo_pago.get(cid, {}).get("monto", 0),
        })
    rows.sort(key=lambda r: r["vencido"], reverse=True)
    return {"resumen": resumen, "listado": rows}


@router.get("/seller/location")
async def seller_last_location(user: dict = Depends(get_current_user)):
    ubicaciones = await db.seller_locations.find(
        {"vendedor_id": user["id"]}, {"_id": 0}).sort("fecha", -1).to_list(1)
    return ubicaciones[0] if ubicaciones else None


@router.post("/seller/location")
async def seller_register_location(data: LocationInput, user: dict = Depends(get_current_user)):
    """Registra la ubicación del vendedor (check-in manual o GPS on-demand)."""
    if not (-90 <= data.latitud <= 90) or not (-180 <= data.longitud <= 180):
        raise HTTPException(400, "Coordenadas fuera de rango")
    doc = {
        "id": _uid(), "vendedor_id": user["id"], "vendedor_nombre": user.get("name", ""),
        "latitud": float(data.latitud), "longitud": float(data.longitud),
        "precision": float(data.precision) if data.precision is not None else None,
        "fuente": data.fuente or "gps", "fecha": iso_now(),
    }
    await db.seller_locations.insert_one(doc)
    return doc


# ==========================================================================
# VISITAS (campo)
# ==========================================================================
def _escape_re(q: str) -> str:
    import re
    return re.escape(str(q)[:100])


async def _get_visita(visita_id: str) -> dict:
    v = await db.visits.find_one({"id": visita_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Visita no encontrada")
    return v


@router.get("/visits")
async def list_visits(estado: Optional[str] = None, vendedor_id: Optional[str] = None,
                      cliente_id: Optional[str] = None, tipo_visita: Optional[str] = None,
                      desde: Optional[str] = None, hasta: Optional[str] = None,
                      user: dict = Depends(require_permission("visita.ver"))):
    """Lista de visitas. Un vendedor solo ve las propias; supervisores/admins todas."""
    flt = {}
    if not _vende_todo(user):
        flt["vendedor_id"] = user["id"]
    if estado:
        flt["estado"] = estado
    if tipo_visita:
        flt["tipo_visita"] = tipo_visita
    if vendedor_id and _vende_todo(user):
        flt["vendedor_id"] = vendedor_id
    if cliente_id:
        flt["cliente_id"] = cliente_id
    if desde:
        flt["fecha"] = {"$gte": desde[:10]}
    if hasta:
        if "fecha" in flt and isinstance(flt["fecha"], dict):
            flt["fecha"]["$lte"] = f"{hasta[:10]} 23:59:59"
        else:
            flt["fecha"] = {"$lte": f"{hasta[:10]} 23:59:59"}
    visits = await db.visits.find(flt, {"_id": 0}).sort("fecha", -1).to_list(100000)
    return visits


@router.post("/visits")
async def create_visit(data: VisitInput, user: dict = Depends(require_permission("visita.crear"))):
    cliente = await db.clients.find_one({"id": data.cliente_id}, {"_id": 0})
    if not cliente:
        raise HTTPException(404, "Cliente no encontrado")
    if data.estado not in ESTADOS_VISITA:
        raise HTTPException(400, f"Estado inválido. Usa: {', '.join(ESTADOS_VISITA)}")
    vendedor_id = user["id"]
    if data.vendedor_id and (user_has_permission(user, "venta.cambiar_operador") or _es_admin(user)):
        vendedor_id = data.vendedor_id
    vendedor = await db.users.find_one({"id": vendedor_id}, {"_id": 0, "name": 1})
    now = iso_now()
    doc = {
        "id": _uid(),
        "cliente_id": cliente["id"],
        "cliente_nombre": data.cliente_nombre or cliente.get("nombre", ""),
        "cliente_codigo": data.cliente_codigo or cliente.get("codigo", ""),
        "vendedor_id": vendedor_id,
        "vendedor_nombre": (vendedor or {}).get("name", user.get("name", "")),
        "fecha_programada": data.fecha_programada or now[:10],
        "hora": data.hora or now[11:16],
        "fecha": now,
        "tipo_visita": data.tipo_visita if data.tipo_visita in TIPOS_VISITA else "visita",
        "estado": data.estado,
        "comentarios": data.comentarios or "",
        "latitud": data.latitud, "longitud": data.longitud,
        "usuario_id": user["id"], "created_at": now, "updated_at": now,
    }
    await db.visits.insert_one(doc)
    await log_audit(user, "crear", "visita", doc["id"], f"Cliente {cliente.get('nombre')} · {doc['estado']}")
    return await db.visits.find_one({"id": doc["id"]}, {"_id": 0})


@router.get("/visits/{visita_id}")
async def get_visit(visita_id: str, user: dict = Depends(require_permission("visita.ver"))):
    v = await _get_visita(visita_id)
    if not _vende_todo(user) and v.get("vendedor_id") != user["id"]:
        raise HTTPException(403, "No tienes acceso a esta visita")
    return v


@router.put("/visits/{visita_id}")
async def update_visit(visita_id: str, data: VisitUpdate,
                       user: dict = Depends(require_permission("visita.editar"))):
    v = await _get_visita(visita_id)
    if not _vende_todo(user) and v.get("vendedor_id") != user["id"]:
        raise HTTPException(403, "No puedes editar visitas de otro vendedor")
    upd = {k: val for k, val in data.model_dump().items() if val is not None}
    if "estado" in upd and upd["estado"] not in ESTADOS_VISITA:
        raise HTTPException(400, f"Estado inválido. Usa: {', '.join(ESTADOS_VISITA)}")
    if upd.get("estado") == "realizada" and not v.get("fecha_realizada"):
        upd["fecha_realizada"] = iso_now()
    if upd.get("estado") == "cancelada":
        upd["fecha_cancelada"] = iso_now()
    upd["updated_at"] = iso_now()
    await db.visits.update_one({"id": visita_id}, {"$set": upd})
    await log_audit(user, "editar", "visita", visita_id, f"campos: {', '.join(sorted(upd))}")
    return await db.visits.find_one({"id": visita_id}, {"_id": 0})


@router.post("/visits/{visita_id}/checkin")
async def visit_checkin(visita_id: str, data: CheckInInput,
                        user: dict = Depends(require_permission("visita.editar"))):
    """Check-in del vendedor: marca la visita como realizada con ubicación."""
    v = await _get_visita(visita_id)
    if not _vende_todo(user) and v.get("vendedor_id") != user["id"]:
        raise HTTPException(403, "No puedes registrar esta visita")
    now = iso_now()
    upd = {"estado": "realizada", "fecha": now, "fecha_realizada": now,
           "comentarios": data.comentarios or v.get("comentarios", ""),
           "resultado": data.resultado or v.get("resultado", ""),
           "updated_at": now}
    if data.latitud is not None and data.longitud is not None:
        upd["latitud"] = float(data.latitud)
        upd["longitud"] = float(data.longitud)
    # Registra la ubicación del check-in en el historial del vendedor.
    if data.latitud is not None and data.longitud is not None:
        await db.seller_locations.insert_one({
            "id": _uid(), "vendedor_id": user["id"], "vendedor_nombre": user.get("name", ""),
            "latitud": float(data.latitud), "longitud": float(data.longitud),
            "precision": None, "fuente": "checkin", "fecha": now, "visita_id": visita_id})
    await db.visits.update_one({"id": visita_id}, {"$set": upd})
    await log_audit(user, "checkin", "visita", visita_id, "Visita realizada con ubicación")
    return await db.visits.find_one({"id": visita_id}, {"_id": 0})


# ==========================================================================
# RUTAS (preparación para optimización)
# ==========================================================================
@router.get("/routes")
async def list_routes(activa: Optional[bool] = None, vendedor_id: Optional[str] = None,
                      user: dict = Depends(require_permission("visita.ver"))):
    flt = {}
    if activa is not None:
        flt["activa"] = activa
    if vendedor_id:
        flt["vendedor_id"] = vendedor_id
    elif not _vende_todo(user):
        flt["vendedor_id"] = user["id"]
    return await db.sales_routes.find(flt, {"_id": 0}).sort("nombre", 1).to_list(1000)


@router.post("/routes")
async def create_route(data: RouteInput, user: dict = Depends(require_permission("visita.crear"))):
    doc = {"id": _uid(), "nombre": data.nombre, "descripcion": data.descripcion or "",
           "sucursal_id": data.sucursal_id or user.get("sucursal_id"),
           "vendedor_id": user["id"], "vendedor_nombre": user.get("name", ""),
           "activa": data.activa, "clientes": list(dict.fromkeys(data.clientes)),
           "fecha_programada": data.fecha_programada or "",
           "created_at": iso_now(), "updated_at": iso_now()}
    await db.sales_routes.insert_one(doc)
    await log_audit(user, "crear", "ruta", doc["id"], data.nombre)
    return await db.sales_routes.find_one({"id": doc["id"]}, {"_id": 0})


@router.delete("/routes/{route_id}")
async def delete_route(route_id: str, user: dict = Depends(require_permission("visita.editar"))):
    r = await db.sales_routes.find_one({"id": route_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Ruta no encontrada")
    if not _vende_todo(user) and r.get("vendedor_id") != user["id"]:
        raise HTTPException(403, "No puedes eliminar rutas de otro vendedor")
    await db.sales_routes.delete_one({"id": route_id})
    await log_audit(user, "eliminar", "ruta", route_id)
    return {"ok": True}


# ==========================================================================
# UBICACIONES (historial por vendedor) — respeta permisos
# ==========================================================================
@router.get("/locations/{vendedor_id}")
async def location_history(vendedor_id: str, desde: Optional[str] = None,
                           hasta: Optional[str] = None, limit: int = 500,
                           user: dict = Depends(get_current_user)):
    """Historial de ubicaciones de un vendedor. Solo supervisión/admin (o el propio vendedor)."""
    if not (_vende_todo(user) or user["id"] == vendedor_id):
        raise HTTPException(403, "No tienes permiso para ver estas ubicaciones")
    flt = {"vendedor_id": vendedor_id}
    if desde:
        flt["fecha"] = {"$gte": desde[:10]}
    if hasta:
        if "fecha" in flt and isinstance(flt["fecha"], dict):
            flt["fecha"]["$lte"] = f"{hasta[:10]} 23:59:59"
        else:
            flt["fecha"] = {"$lte": f"{hasta[:10]} 23:59:59"}
    return await db.seller_locations.find(
        flt, {"_id": 0}).sort("fecha", -1).limit(min(limit, 2000)).to_list()


# ==========================================================================
# CENTRO DE SUPERVISIÓN COMERCIAL
# ==========================================================================
async def _vendedores_con_datos(sucursal_id: Optional[str] = None) -> list:
    return await _usuarios_campo(sucursal_id)


async def _ultima_actividad(vendedor_id: str, hoy: str, mes: str) -> datetime:
    """Última fecha de actividad del vendedor (venta, abono, visita o ubicación)."""
    candidatos = []
    for col, flt in (
        (db.sales, {"vendedor_id": vendedor_id, "estado": "confirmada"}),
        (db.abonos, {"usuario_id": vendedor_id}),
        (db.visits, {"vendedor_id": vendedor_id}),
        (db.seller_locations, {"vendedor_id": vendedor_id}),
    ):
        try:
            docs = await col.find(flt, {"_id": 0, "fecha": 1}).sort("fecha", -1).to_list(1)
            if docs:
                candidatos.append(docs[0].get("fecha"))
        except Exception:
            continue
    mejor = None
    for c in candidatos:
        dt = _iso_to_dt(c)
        if dt and (mejor is None or dt > mejor):
            mejor = dt
    return mejor


def _estado_de(ult_actividad: Optional[datetime], ult_ubicacion: Optional[datetime],
               now: datetime) -> str:
    if ult_actividad is None:
        return "sin_datos"
    mins = (now - ult_actividad).total_seconds() / 60
    if ult_ubicacion is not None and (now - ult_ubicacion).total_seconds() / 60 <= EN_RUTA_MINUTOS:
        return "en_ruta"
    if mins <= ACTIVO_MINUTOS:
        return "activo"
    return "sin_actividad"


async def _metricas_vendedores(vendedores: list, fecha: Optional[str] = None) -> tuple:
    """Calcula métricas consolidadas de ventas/cobranza/visitas por vendedor."""
    now = now_utc()
    hoy = fecha or now.date().isoformat()
    mes = now.strftime("%Y-%m")
    ids = [v["id"] for v in vendedores]
    ids_set = set(ids)

    ventas_hoy = await db.sales.find(
        {"vendedor_id": {"$in": ids}, "estado": "confirmada", "fecha": {"$regex": "^" + hoy}},
        {"_id": 0, "vendedor_id": 1, "total": 1}).to_list(200000)
    ventas_mes = await db.sales.find(
        {"vendedor_id": {"$in": ids}, "estado": "confirmada", "fecha": {"$regex": "^" + mes}},
        {"_id": 0, "vendedor_id": 1, "total": 1}).to_list(200000)
    cred = await db.sales.find(
        {"vendedor_id": {"$in": ids}, "condicion": "credito", "estado": "confirmada",
         "saldo": {"$gt": 0}},
        {"_id": 0, "vendedor_id": 1, "cliente_id": 1, "fecha": 1, "saldo": 1}).to_list(200000)
    abonos_hoy = await db.abonos.find(
        {"fecha": {"$regex": "^" + hoy}},
        {"_id": 0, "usuario_id": 1, "monto": 1}).to_list(100000)
    visitas = await db.visits.find(
        {"vendedor_id": {"$in": ids}}, {"_id": 0}).to_list(100000)
    ubicaciones = await db.seller_locations.find(
        {"vendedor_id": {"$in": ids}}, {"_id": 0}).to_list(100000)

    def _sum(lst, key):
        return round(sum(float(d.get(key, 0) or 0) for d in lst), 2)

    venta_hoy = {}
    for s in ventas_hoy:
        d = venta_hoy.setdefault(s["vendedor_id"], {"monto": 0.0, "numero": 0})
        d["monto"] += float(s.get("total", 0) or 0)
        d["numero"] += 1
    venta_mes = {}
    for s in ventas_mes:
        d = venta_mes.setdefault(s["vendedor_id"], {"monto": 0.0, "numero": 0})
        d["monto"] += float(s.get("total", 0) or 0)
        d["numero"] += 1
    cxc_v = {}
    hoy_date = now.date()
    for s in cred:
        d = cxc_v.setdefault(s["vendedor_id"], {"vencido": 0.0, "corriente": 0.0, "n": 0})
        dv, _ = _dias_vencido(s["fecha"], 0, hoy_date)
        if dv > 0:
            d["vencido"] += float(s.get("saldo", 0) or 0)
        else:
            d["corriente"] += float(s.get("saldo", 0) or 0)
        d["n"] += 1
    ab_hoy = {}
    for a in abonos_hoy:
        d = ab_hoy.setdefault(a.get("usuario_id"), 0.0)
        ab_hoy[a["usuario_id"]] = d + float(a.get("monto", 0) or 0)
    vis = {}
    for v in visitas:
        d = vis.setdefault(v["vendedor_id"], {"realizadas": 0, "programadas": 0, "hoy": 0})
        if v.get("estado") == "realizada":
            d["realizadas"] += 1
        if v.get("estado") == "programada":
            d["programadas"] += 1
        if str(v.get("fecha", ""))[:10] == hoy:
            d["hoy"] += 1
    ult_ubic = {}
    for u in ubicaciones:
        vid = u["vendedor_id"]
        if vid not in ult_ubic:
            ult_ubic[vid] = u
        else:
            fu = _iso_to_dt(u.get("fecha"))
            cu = _iso_to_dt(ult_ubic[vid].get("fecha"))
            if fu and cu and fu > cu:
                ult_ubic[vid] = u

    # Cartera por vendedor (saldo de clientes asignados).
    clientes = await db.clients.find(
        {"$or": [{"vendedor_id": {"$in": ids}}, {"vendedor_id": {"$exists": False}}]},
        {"_id": 0, "vendedor_id": 1, "saldo": 1}).to_list(50000)
    cartera = {}
    sin_asignar = 0.0
    for c in clientes:
        vv = c.get("vendedor_id")
        if vv and vv in ids_set:
            cartera[vv] = cartera.get(vv, 0.0) + float(c.get("saldo", 0) or 0)
        elif not vv:
            sin_asignar += float(c.get("saldo", 0) or 0)

    out = []
    for v in vendedores:
        vid = v["id"]
        vh = venta_hoy.get(vid, {"monto": 0.0, "numero": 0})
        vm = venta_mes.get(vid, {"monto": 0.0, "numero": 0})
        cv = cxc_v.get(vid, {"vencido": 0.0, "corriente": 0.0, "n": 0})
        ub = ult_ubic.get(vid)
        ua = await _ultima_actividad(vid, hoy, mes)
        out.append({
            "id": vid, "name": v.get("name"), "email": v.get("email"),
            "role": v.get("role"), "sucursal_id": v.get("sucursal_id"),
            "estado": _estado_de(ua, _iso_to_dt((ub or {}).get("fecha")), now),
            "ultima_ubicacion": ub,
            "ultima_actividad": ua.isoformat() if ua else None,
            "ventas_hoy": {"monto": round(vh["monto"], 2), "numero": vh["numero"]},
            "ventas_mes": {"monto": round(vm["monto"], 2), "numero": vm["numero"]},
            "cobros_hoy": round(ab_hoy.get(vid, 0.0), 2),
            "cxc": {"vencido": round(cv["vencido"], 2), "saldo_total": round(cartera.get(vid, 0.0), 2),
                    "ventas_pendientes": cv["n"]},
            "visitas": vis.get(vid, {"realizadas": 0, "programadas": 0, "hoy": 0}),
        })
    return out, {"clientes_sin_vendedor": sin_asignar}


@router.get("/supervision/dashboard")
async def supervision_dashboard(fecha: Optional[str] = None, vendedor_id: Optional[str] = None,
                                sucursal_id: Optional[str] = None,
                                user: dict = Depends(require_permission("supervision.ver"))):
    """KPIs del Centro de Supervisión Comercial."""
    now = now_utc()
    hoy = fecha or now.date().isoformat()
    vendedores = await _vendedores_con_datos(sucursal_id)
    if vendedor_id:
        vendedores = [v for v in vendedores if v["id"] == vendedor_id]
    metricas, extra = await _metricas_vendedores(vendedores, hoy)

    clientes = await db.clients.find({}, {"_id": 0, "saldo": 1, "id": 1}).to_list(50000)
    cxc_total = round(sum(float(c.get("saldo", 0) or 0) for c in clientes), 2)

    clientes_visitados_hoy = set()
    visitas_hoy = await db.visits.find(
        {"fecha": {"$regex": "^" + hoy}}, {"_id": 0, "cliente_id": 1, "estado": 1}).to_list(100000)
    for v in visitas_hoy:
        if v.get("estado") == "realizada" and v.get("cliente_id"):
            clientes_visitados_hoy.add(v["cliente_id"])

    ventas_dia = {"monto": round(sum(m["ventas_hoy"]["monto"] for m in metricas), 2),
                  "numero": sum(m["ventas_hoy"]["numero"] for m in metricas)}
    cobranza_dia = round(sum(m["cobros_hoy"] for m in metricas), 2)

    clientes_mayor_adeudo = sorted(clientes, key=lambda c: float(c.get("saldo", 0) or 0),
                                   reverse=True)[:5]
    top_deudores = [{"cliente_id": c["id"], "saldo": round(float(c.get("saldo", 0) or 0), 2)}
                    for c in clientes_mayor_adeudo if float(c.get("saldo", 0) or 0) > 0]
    # Con nombre del cliente.
    cdet = {c["id"]: c for c in clientes}
    top_deudores = [{"cliente_id": d["cliente_id"],
                     "nombre": (cdet.get(d["cliente_id"]) or {}).get("nombre", ""),
                     "saldo": d["saldo"]} for d in top_deudores]

    cxc_vencida = round(sum(m["cxc"]["vencido"] for m in metricas), 2)

    return {
        "fecha": hoy,
        "vendedores": {
            "total": len(vendedores),
            "activos": sum(1 for m in metricas if m["estado"] in ("activo", "en_ruta")),
            "en_ruta": sum(1 for m in metricas if m["estado"] == "en_ruta"),
            "sin_actividad": sum(1 for m in metricas if m["estado"] == "sin_actividad"),
            "sin_datos": sum(1 for m in metricas if m["estado"] == "sin_datos"),
        },
        "clientes": {
            "totales": len(clientes),
            "visitados_hoy": len(clientes_visitados_hoy),
        },
        "visitas": {
            "programadas": sum(m["visitas"]["programadas"] for m in metricas),
            "realizadas": sum(m["visitas"]["realizadas"] for m in metricas),
            "hoy": sum(m["visitas"]["hoy"] for m in metricas),
        },
        "ventas_dia": ventas_dia,
        "cobranza_dia": cobranza_dia,
        "cxc": {"total": cxc_total, "vencida": cxc_vencida},
        "clientes_mayor_adeudo": top_deudores,
        "por_vendedor": [
            {"id": m["id"], "name": m["name"], "estado": m["estado"],
             "ventas_hoy": m["ventas_hoy"], "ventas_mes": m["ventas_mes"],
             "cobros_hoy": m["cobros_hoy"], "cxc": m["cxc"], "visitas": m["visitas"],
             "ultima_actividad": m["ultima_actividad"]}
            for m in metricas
        ],
    }


@router.get("/supervision/map")
async def supervision_map(vendedor_id: Optional[str] = None, sucursal_id: Optional[str] = None,
                          solo_vencidos: Optional[bool] = False,
                          user: dict = Depends(require_permission("supervision.mapa"))):
    """Mapa general de supervisión: vendedores con ubicación + clientes con coordenadas."""
    vendedores = await _vendedores_con_datos(sucursal_id)
    if vendedor_id:
        vendedores = [v for v in vendedores if v["id"] == vendedor_id]
    metricas, _ = await _metricas_vendedores(vendedores)
    now = now_utc()
    hoy_date = now.date()

    vendedores_out = []
    for v in vendedores:
        m = next((x for x in metricas if x["id"] == v["id"]), None) or {}
        vendedores_out.append({
            "id": v["id"], "name": v.get("name"), "email": v.get("email"),
            "role": v.get("role"), "sucursal_id": v.get("sucursal_id"),
            "estado": (m or {}).get("estado", "sin_datos"),
            "ultima_ubicacion": (m or {}).get("ultima_ubicacion"),
            "ultima_actividad": (m or {}).get("ultima_actividad"),
            "ventas_hoy": (m or {}).get("ventas_hoy", {"monto": 0, "numero": 0}),
            "cobros_hoy": (m or {}).get("cobros_hoy", 0),
            "cxc": (m or {}).get("cxc", {"vencido": 0, "saldo_total": 0}),
            "visitas": (m or {}).get("visitas", {"realizadas": 0, "programadas": 0, "hoy": 0}),
        })

    flt_cli = {"latitud": {"$ne": None}, "longitud": {"$ne": None}}
    if vendedor_id:
        flt_cli["$or"] = [{"vendedor_id": vendedor_id}, {"vendedor_id": {"$exists": False}}]
    clientes = await db.clients.find(flt_cli, {"_id": 0}).to_list(50000)
    cmap = {c["id"]: c for c in clientes}

    cred = await db.sales.find(
        {"cliente_id": {"$in": list(cmap.keys())}, "condicion": "credito",
         "estado": "confirmada", "saldo": {"$gt": 0}},
        {"_id": 0, "cliente_id": 1, "fecha": 1, "saldo": 1}).to_list(200000)
    vencido_por_cli = {}
    for s in cred:
        cid = s["cliente_id"]
        cli = cmap.get(cid, {})
        dv, _ = _dias_vencido(s["fecha"], cli.get("dias_credito", 0), hoy_date)
        d = vencido_por_cli.setdefault(cid, 0.0)
        if dv > 0:
            vencido_por_cli[cid] = d + float(s.get("saldo", 0) or 0)

    visits = await db.visits.find(
        {"cliente_id": {"$in": list(cmap.keys())}}, {"_id": 0}).to_list(100000)
    ult_visita = {}
    prox_visita = {}
    for v in visits:
        cid = v.get("cliente_id")
        if not cid:
            continue
        if v.get("estado") == "realizada":
            if cid not in ult_visita or str(v.get("fecha", "")) > str(ult_visita[cid]):
                ult_visita[cid] = v.get("fecha", "")
        if v.get("estado") == "programada":
            if cid not in prox_visita or str(v.get("fecha_programada", "")) < str(prox_visita[cid]):
                prox_visita[cid] = v.get("fecha_programada", "")

    vendedor_nombres = {v["id"]: v.get("name") for v in vendedores}
    clientes_out = []
    for c in clientes:
        cid = c["id"]
        venc = vencido_por_cli.get(cid, 0.0)
        if solo_vencidos and venc <= 0:
            continue
        clientes_out.append({
            "id": cid, "codigo": c.get("codigo"), "nombre": c.get("nombre"),
            "telefono": c.get("telefono") or c.get("celular"),
            "direccion": c.get("direccion"), "ciudad": c.get("ciudad"),
            "latitud": c.get("latitud"), "longitud": c.get("longitud"),
            "foto_fachada": c.get("foto_fachada") or "",
            "vendedor_id": c.get("vendedor_id"),
            "vendedor_nombre": vendedor_nombres.get(c.get("vendedor_id"), ""),
            "saldo": round(float(c.get("saldo", 0) or 0), 2),
            "vencido": round(venc, 2),
            "ultima_visita": ult_visita.get(cid, ""),
            "proxima_visita": prox_visita.get(cid, "") or c.get("proxima_visita", ""),
            "ultima_compra": c.get("ult_fecha_compra") or "",
        })

    return {"vendedores": vendedores_out, "clientes": clientes_out}


@router.get("/supervision/sellers")
async def supervision_sellers(order_by: str = "ventas", order_dir: str = "desc",
                              sucursal_id: Optional[str] = None,
                              user: dict = Depends(require_permission("supervision.cartera"))):
    """Cartera por vendedor: clientes asignados, cartera, CxC, ventas, visitas."""
    vendedores = await _vendedores_con_datos(sucursal_id)
    metricas, extra = await _metricas_vendedores(vendedores)

    # Clientes por vendedor (asignados explícitamente).
    clientes = await db.clients.find(
        {"vendedor_id": {"$in": [v["id"] for v in vendedores]}},
        {"_id": 0, "vendedor_id": 1, "saldo": 1, "estado": 1}).to_list(50000)
    por_v = {}
    for c in clientes:
        d = por_v.setdefault(c["vendedor_id"], {"asignados": 0, "activos": 0, "con_adeudo": 0})
        d["asignados"] += 1
        if c.get("estado", "activo") == "activo":
            d["activos"] += 1
        if float(c.get("saldo", 0) or 0) > 0:
            d["con_adeudo"] += 1

    rows = []
    for m in metricas:
        pv = por_v.get(m["id"], {"asignados": 0, "activos": 0, "con_adeudo": 0})
        cartera_total = m["cxc"]["saldo_total"]
        recuperacion = 0.0
        if m["ventas_mes"]["monto"] > 0:
            recuperacion = round(m["cobros_hoy"] * 100.0 / m["ventas_mes"]["monto"], 1)
        rows.append({
            "id": m["id"], "name": m["name"], "role": m["role"],
            "sucursal_id": m["sucursal_id"], "estado": m["estado"],
            "clientes_asignados": pv["asignados"],
            "clientes_activos": pv["activos"],
            "clientes_con_adeudo": pv["con_adeudo"],
            "cartera_total": m["cxc"]["saldo_total"],
            "cxc_vencida": m["cxc"]["vencido"],
            "ventas_mes": m["ventas_mes"]["monto"],
            "ventas_hoy": m["ventas_hoy"]["monto"],
            "cobros_hoy": m["cobros_hoy"],
            "recuperacion": recuperacion,
            "visitas_realizadas": m["visitas"]["realizadas"],
            "visitas_programadas": m["visitas"]["programadas"],
            "ultima_actividad": m["ultima_actividad"],
        })
    key_map = {
        "ventas": "ventas_mes", "ventas_hoy": "ventas_hoy", "cartera": "cartera_total",
        "vencido": "cxc_vencida", "cobranza": "cobros_hoy", "recuperacion": "recuperacion",
        "clientes": "clientes_asignados", "visitas": "visitas_realizadas",
    }
    k = key_map.get(order_by, "ventas_mes")
    rows.sort(key=lambda r: r.get(k, 0) if isinstance(r.get(k), (int, float)) else 0,
              reverse=(order_dir != "asc"))
    return {"vendedores": rows, "clientes_sin_vendedor": extra.get("clientes_sin_vendedor", 0.0)}


@router.get("/supervision/sellers/{seller_id}")
async def supervision_seller_detail(seller_id: str,
                                    user: dict = Depends(require_permission("supervision.cartera"))):
    """Detalle de un vendedor: ficha, cartera, ventas, visitas, ubicaciones."""
    seller = await db.users.find_one({"id": seller_id}, {"_id": 0})
    if not seller:
        raise HTTPException(404, "Vendedor no encontrado")
    vendedores = [{"id": seller["id"], "name": seller.get("name"), "role": seller.get("role"),
                   "sucursal_id": seller.get("sucursal_id")}]
    metricas, _ = await _metricas_vendedores(vendedores)
    m = metricas[0] if metricas else {}

    clientes = await db.clients.find(
        {"vendedor_id": seller_id}, {"_id": 0}).sort("nombre", 1).to_list(50000)
    hoy = now_utc().date()
    clientes_out = []
    for c in clientes:
        vencido = 0.0
        credit = await db.sales.find(
            {"cliente_id": c["id"], "condicion": "credito", "estado": "confirmada",
             "saldo": {"$gt": 0}},
            {"_id": 0, "fecha": 1, "saldo": 1}).to_list(50000)
        for s in credit:
            dv, _ = _dias_vencido(s["fecha"], c.get("dias_credito", 0), hoy)
            if dv > 0:
                vencido += float(s.get("saldo", 0))
        clientes_out.append({
            "id": c["id"], "codigo": c.get("codigo"), "nombre": c.get("nombre"),
            "telefono": c.get("telefono") or c.get("celular"),
            "direccion": c.get("direccion"),
            "latitud": c.get("latitud"), "longitud": c.get("longitud"),
            "saldo": round(float(c.get("saldo", 0) or 0), 2),
            "vencido": round(vencido, 2),
            "estado": c.get("estado", "activo"),
            "proxima_visita": c.get("proxima_visita") or "",
            "ultima_compra": c.get("ult_fecha_compra") or "",
        })

    ventas_recientes = await db.sales.find(
        {"vendedor_id": seller_id, "estado": "confirmada"}, {"_id": 0}
    ).sort("fecha", -1).limit(20).to_list()
    visitas_recientes = await db.visits.find(
        {"vendedor_id": seller_id}, {"_id": 0}).sort("fecha", -1).limit(20).to_list()

    return {
        "vendedor": {
            "id": seller["id"], "name": seller.get("name"), "email": seller.get("email"),
            "role": seller.get("role"), "sucursal_id": seller.get("sucursal_id"),
            "estado": m.get("estado", "sin_datos"),
            "ultima_ubicacion": (m or {}).get("ultima_ubicacion"),
            "ultima_actividad": (m or {}).get("ultima_actividad"),
            "ventas_hoy": (m or {}).get("ventas_hoy", {"monto": 0, "numero": 0}),
            "ventas_mes": (m or {}).get("ventas_mes", {"monto": 0, "numero": 0}),
            "cobros_hoy": (m or {}).get("cobros_hoy", 0),
            "cxc": (m or {}).get("cxc", {"vencido": 0, "saldo_total": 0}),
            "visitas": (m or {}).get("visitas", {"realizadas": 0, "programadas": 0, "hoy": 0}),
        },
        "clientes": clientes_out,
        "ventas_recientes": [
            {"id": s["id"], "folio": s.get("folio"), "fecha": s.get("fecha"),
             "cliente_nombre": s.get("cliente_nombre"), "total": s.get("total"),
             "condicion": s.get("condicion")} for s in ventas_recientes],
        "visitas_recientes": visitas_recientes,
    }


@router.get("/supervision/activity")
async def supervision_activity(sucursal_id: Optional[str] = None,
                               user: dict = Depends(require_permission("supervision.actividad"))):
    """Seguimiento de actividad de vendedores (para detectar inactividad)."""
    vendedores = await _vendedores_con_datos(sucursal_id)
    metricas, _ = await _metricas_vendedores(vendedores)
    rows = []
    for m in sorted(metricas, key=lambda x: x.get("ultima_actividad") or "", reverse=True):
        rows.append({
            "id": m["id"], "name": m["name"], "estado": m["estado"],
            "ultima_actividad": m["ultima_actividad"],
            "ultima_ubicacion": (m.get("ultima_ubicacion") or {}).get("fecha"),
            "clientes_visitados": m["visitas"]["realizadas"],
            "visitas_hoy": m["visitas"]["hoy"],
            "ventas_hoy": m["ventas_hoy"],
            "cobros_hoy": m["cobros_hoy"],
        })
    return rows


# ==========================================================================
# CARTERA — asignación masiva de clientes a vendedores
# ==========================================================================
@router.post("/supervision/cartera")
async def supervisar_cartera(data: CarteraAsignacion,
                             user: dict = Depends(require_permission("supervision.cartera"))):
    """Asigna clientes a un vendedor (cartera) y opcionalmente reemplaza la
    asignación anterior: los clientes que ya pertenecían al vendedor y ya no
    vienen en la lista quedan sin asignar."""
    vendedor = await db.users.find_one({"id": data.vendedor_id}, {"_id": 0, "name": 1})
    if not vendedor:
        raise HTTPException(404, "Vendedor no encontrado")
    ids = list(dict.fromkeys(data.cliente_ids or []))
    nombre = vendedor.get("name", "")

    # Asignar los clientes elegidos a este vendedor.
    if ids:
        await db.clients.update_many(
            {"id": {"$in": ids}},
            {"$set": {"vendedor_id": data.vendedor_id, "vendedor": nombre}})
    # Reemplazo: quitar la asignación a clientes que ya estaban y no se incluyen.
    if data.reemplazar:
        await db.clients.update_many(
            {"vendedor_id": data.vendedor_id, "id": {"$nin": ids}},
            {"$set": {"vendedor_id": None, "vendedor": None}})

    await log_audit(user, "cartera", "cliente", data.vendedor_id,
                    f"{len(ids)} clientes asignados a {nombre}")
    return {"ok": True, "asignados": len(ids), "vendedor": nombre, "total_vendedor": len(ids)}
