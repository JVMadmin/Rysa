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

from fastapi import APIRouter, HTTPException, Depends, File, UploadFile, Form
from pydantic import BaseModel, Field

import storage

from deps import (
    db, iso_now, now_utc, get_current_user, require_permission,
    user_has_permission, log_audit, next_counter,
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
    """Clientes estrictamente de la cartera asignada al vendedor (por ID o nombre)."""
    vid = str(user.get("id") or "")
    vname = str(user.get("name") or "").strip()
    conds = []
    if vid:
        conds.append({"vendedor_id": vid})
    if vname:
        conds.append({"vendedor": vname})
    if not conds:
        return {"id": "__sin_cartera__"}
    return {"$or": conds}


async def _cartera_clients(user: dict) -> list:
    return await db.clients.find(_cartera_filtro(user), {"_id": 0}).to_list(50000)


async def _clientes_por_seller(por_vendedor: Optional[str] = None) -> list:
    flt = {}
    if por_vendedor:
        flt["vendedor_id"] = por_vendedor
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
    foto_evidencia: Optional[str] = ""


class VisitUpdate(BaseModel):
    estado: Optional[str] = None
    comentarios: Optional[str] = None
    resultado: Optional[str] = None
    fecha_programada: Optional[str] = None
    hora: Optional[str] = None
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    tipo_visita: Optional[str] = None
    foto_evidencia: Optional[str] = None


class CheckInInput(BaseModel):
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    comentarios: Optional[str] = ""
    resultado: Optional[str] = ""
    foto_evidencia: Optional[str] = ""


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
def _calcular_semaforo(saldo: float, vencido: float, dias_mora_max: int = 0) -> dict:
    saldo = round(float(saldo or 0), 2)
    vencido = round(float(vencido or 0), 2)
    if vencido <= 0.01:
        return {
            "color": "verde",
            "nivel": "Excelente",
            "badge": "Puntual",
            "resumen": "Al corriente · Sin saldos vencidos",
            "dias_mora": 0
        }
    elif dias_mora_max <= 15 and (saldo <= 0 or vencido < (saldo * 0.5)):
        return {
            "color": "amarillo",
            "nivel": "En Observación",
            "badge": "Observación",
            "resumen": f"Atraso leve ({dias_mora_max}d · ${vencido:,.2f} vencido)",
            "dias_mora": dias_mora_max
        }
    else:
        return {
            "color": "rojo",
            "nivel": "Alto Riesgo",
            "badge": "Alto Riesgo",
            "resumen": f"Mora crítica ({dias_mora_max}d · ${vencido:,.2f} en riesgo)",
            "dias_mora": dias_mora_max
        }


async def _resumen_cxc_cliente(cliente_id: str, saldo_cliente: float, dias_credito: int) -> dict:
    """Saldo, vencido y semáforo de un cliente a partir de sus ventas a crédito activas."""
    hoy = now_utc().date()
    vencido = 0.0
    corriente = 0.0
    dias_mora_max = 0
    sales = await db.sales.find(
        {"cliente_id": cliente_id, "condicion": "credito",
         "estado": "confirmada", "saldo": {"$gt": 0}},
        {"_id": 0, "fecha": 1, "saldo": 1}).to_list(100000)
    for s in sales:
        dv, _ = _dias_vencido(s["fecha"], dias_credito, hoy)
        if dv > 0:
            vencido += float(s.get("saldo", 0))
            if dv > dias_mora_max:
                dias_mora_max = dv
        else:
            corriente += float(s.get("saldo", 0))
    return {
        "saldo": round(float(saldo_cliente or 0), 2),
        "vencido": round(vencido, 2),
        "corriente": round(corriente, 2),
        "por_vencer": round(max(0.0, float(saldo_cliente or 0) - vencido), 2),
        "dias_mora_max": dias_mora_max,
        "semaforo": _calcular_semaforo(saldo_cliente, vencido, dias_mora_max),
    }


async def _cxc_de_cartera(vendedor_id: str, vendedor_nombre: str = "") -> dict:
    """CxC consolidada estrictamente de la cartera asignada al vendedor (saldo, vencido, cobrado)."""
    hoy = now_utc().date()
    conds = []
    if vendedor_id:
        conds.append({"vendedor_id": vendedor_id})
    if vendedor_nombre:
        conds.append({"vendedor": vendedor_nombre})
    if not conds:
        return {"saldo_total": 0.0, "vencido": 0.0, "por_vencer": 0.0, "cobrado_hoy": 0.0}

    clientes = await db.clients.find(
        {"$or": conds},
        {"_id": 0, "id": 1, "saldo": 1, "dias_credito": 1}).to_list(50000)
    cmap = {c["id"]: c for c in clientes}
    cids = list(cmap.keys())
    sales = await db.sales.find(
        {"cliente_id": {"$in": cids}, "condicion": "credito",
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
    vname = user.get("name", "")
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

    cxc = await _cxc_de_cartera(vid, vname)

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

    meta_mes = float(user.get("meta_mensual") or 150000.0)
    monto_mes = round(sum(float(v.get("total", 0) or 0) for v in ventas_mes), 2)
    avance_pct = round((monto_mes / meta_mes) * 100, 1) if meta_mes > 0 else 0.0

    return {
        "ventas_dia": {"monto": round(sum(float(v.get("total", 0) or 0) for v in ventas_hoy), 2),
                       "numero": len(ventas_hoy)},
        "ventas_mes": {"monto": monto_mes,
                       "numero": len(ventas_mes),
                       "meta": meta_mes,
                       "avance_pct": avance_pct},
        "cartera_credito_total": {
            "saldo_total": cxc.get("saldo_total", 0.0),
            "vencido": cxc.get("vencido", 0.0),
            "por_vencer": cxc.get("por_vencer", 0.0),
        },
        "sucursal": user.get("sucursal") or "Sucursal Matriz",
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
async def seller_clients(q: Optional[str] = None, scope: Optional[str] = "cartera", user: dict = Depends(get_current_user)):
    """Clientes de la cartera del vendedor autenticado o de toda la empresa (scope=all).
    Para clientes ajenos se protegen saldos y líneas de crédito."""
    es_global = scope == "all" or _vende_todo(user)
    if es_global:
        flt = {}
        if q:
            rx = {"$regex": _escape_re(q), "$options": "i"}
            flt["$or"] = [
                {"nombre": rx}, {"codigo": rx}, {"rfc": rx},
                {"telefono": rx}, {"celular": rx}, {"whatsapp": rx}
            ]
    else:
        flt = _cartera_filtro(user)
        if q:
            rx = {"$regex": _escape_re(q), "$options": "i"}
            flt["$and"] = [{"$or": [
                {"nombre": rx}, {"codigo": rx}, {"rfc": rx},
                {"telefono": rx}, {"celular": rx}, {"whatsapp": rx}]}]
    clientes = await db.clients.find(flt, {"_id": 0}).sort("nombre", 1).to_list(50000)
    hoy = now_utc().date()
    cids = [c["id"] for c in clientes]
    unpaid = await db.sales.find(
        {"cliente_id": {"$in": cids}, "condicion": "credito", "estado": "confirmada", "saldo": {"$gt": 0}},
        {"_id": 0, "cliente_id": 1, "fecha": 1, "saldo": 1}).to_list(100000)
    vencido_map = {}
    dias_mora_map = {}
    cmap = {c["id"]: c for c in clientes}
    for s in unpaid:
        cid = s.get("cliente_id")
        dc = (cmap.get(cid) or {}).get("dias_credito", 0)
        dv, _ = _dias_vencido(s["fecha"], dc, hoy)
        if dv > 0:
            vencido_map[cid] = vencido_map.get(cid, 0.0) + float(s.get("saldo", 0))
            if dv > dias_mora_map.get(cid, 0):
                dias_mora_map[cid] = dv

    u_id = str(user.get("id") or "")
    u_name = str(user.get("name") or "").strip().lower()

    out = []
    for c in clientes:
        cid = c["id"]
        c_vid = str(c.get("vendedor_id") or "")
        c_vname = str(c.get("vendedor") or "").strip().lower()
        
        # Asignación directa de cartera: solo coincide por id o nombre exacto del vendedor
        es_asignado = bool((c_vid and c_vid == u_id) or (c_vname and c_vname == u_name))
        # Para administradores generales en módulo web se respeta _vende_todo solo si no es scope móvil
        es_mio = es_asignado or (_vende_todo(user) and scope != "all")

        if es_mio:
            sal = round(float(c.get("saldo", 0) or 0), 2)
            venc = round(vencido_map.get(cid, 0.0), 2)
            dm = dias_mora_map.get(cid, 0)
            semaforo = _calcular_semaforo(sal, venc, dm)
            limite = round(float(c.get("limite_credito", 0) or 0), 2)
            autorizado = bool(c.get("credito_autorizado"))
        else:
            # Clientes de otra cartera / cartera general:
            # Protección estricta de privacidad comercial: saldos y moras en 0.00
            sal = 0.0
            venc = 0.0
            semaforo = {"color": "gris", "resumen": "Cliente general (otra cartera)"}
            limite = 0.0
            autorizado = False

        out.append({
            "id": cid, "codigo": c.get("codigo"), "nombre": c.get("nombre"),
            "telefono": c.get("telefono") or c.get("celular"), "whatsapp": c.get("whatsapp"),
            "correo": c.get("correo"), "direccion": c.get("direccion"),
            "ciudad": c.get("ciudad"), "estado_geo": c.get("estado_geo"),
            "rfc": c.get("rfc"), "saldo": sal,
            "vencido": venc,
            "semaforo": semaforo,
            "en_cartera": es_asignado,
            "documentos": c.get("documentos") or {},
            "limite_credito": limite,
            "credito_autorizado": autorizado,
            "dias_credito": c.get("dias_credito", 0) if es_mio else 0,
            "latitud": c.get("latitud"), "longitud": c.get("longitud"),
            "proxima_visita": c.get("proxima_visita") or "",
            "ult_fecha_compra": c.get("ult_fecha_compra") or "",
            "vendedor_id": c.get("vendedor_id"),
            "vendedor_nombre": c.get("vendedor") or "",
            "condicion_pago": c.get("condicion_pago", "contado"),
            "foto_fachada": c.get("foto_fachada") or "",
        })
    return out


class VentaDirectaItem(BaseModel):
    product_id: str
    codigo: Optional[str] = ""
    descripcion: Optional[str] = ""
    unidad: Optional[str] = "PZA"
    cantidad: float
    precio: float
    iva_tasa: Optional[float] = 0.0


class VentaDirectaInput(BaseModel):
    cliente_id: Optional[str] = ""
    cliente_nombre: Optional[str] = "Público General"
    cliente_codigo: Optional[str] = ""
    items: List[VentaDirectaItem]
    condicion: Optional[str] = "contado"
    forma_pago: Optional[str] = "efectivo"
    notas: Optional[str] = ""
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    idempotency_key: str
    fecha: Optional[str] = None


class FacturarSolicitudInput(BaseModel):
    sale_id: Optional[str] = ""
    venta_id: Optional[str] = ""
    folio: str
    rfc: Optional[str] = ""
    cliente_id: Optional[str] = ""
    cliente_nombre: Optional[str] = ""
    cliente_rfc: Optional[str] = ""
    razon_social: Optional[str] = ""
    uso_cfdi: Optional[str] = "G03"
    regimen_fiscal: Optional[str] = ""
    correo: Optional[str] = ""
    email: Optional[str] = ""
    confirmado_no_propio: Optional[bool] = False


@router.get("/seller/clients/{client_id}/history")
async def client_order_history(client_id: str, user: dict = Depends(get_current_user)):
    """Historial completo de compras y pedidos del cliente, unificando pedidos en línea,
    ventas registradas en el ERP y tickets históricos del sistema comercial legacy."""
    from pgstore.database import get_engine
    from sqlalchemy import text
    import json

    cli = await db.clients.find_one({"id": client_id}) or {}
    cod = cli.get("codigo")
    nom = cli.get("nombre")

    u_id = str(user.get("id") or "")
    u_name = str(user.get("name") or "").strip().lower()

    combined = []

    # 1. Consultar pedidos recientes del ERP
    p_flt = [{"cliente_id": client_id}]
    if cod:
        p_flt.append({"cliente_codigo": cod})
    pedidos = await db.pedidos.find({"$or": p_flt} if len(p_flt) > 1 else p_flt[0], {"_id": 0}).sort("fecha_pedido", -1).to_list(30)
    for p in pedidos:
        v_id = str(p.get("vendedor_id") or "")
        v_name = p.get("vendedor_nombre") or "Asesor"
        es_mio = (v_id == u_id) or (v_name.strip().lower() == u_name)
        combined.append({
            "id": p.get("id"),
            "folio": p.get("folio") or "PEDIDO",
            "tipo": "pedido",
            "fecha": p.get("fecha_pedido") or p.get("creado_en") or "",
            "total": float(p.get("total") or 0),
            "condicion": "pedido",
            "estado": p.get("estado") or "pendiente",
            "vendedor_id": v_id,
            "vendedor_nombre": v_name,
            "vendido_por_mi": es_mio,
            "items_count": len(p.get("items") or []),
            "resumen_items": ", ".join(f"{it.get('solicitado', 1)}x {it.get('descripcion', '')[:20]}" for it in (p.get("items") or [])[:3]),
            "facturable": False,
        })

    # 2. Consultar ventas registradas en db.sales
    s_flt = [{"cliente_id": client_id}]
    if cod:
        s_flt.append({"cliente_codigo": cod})
    if nom:
        s_flt.append({"cliente_nombre": nom})
    ventas = await db.sales.find({"$or": s_flt} if len(s_flt) > 1 else s_flt[0], {"_id": 0}).sort("fecha", -1).to_list(30)
    for v in ventas:
        v_id = str(v.get("vendedor_id") or "")
        v_name = v.get("vendedor_nombre") or "Asesor"
        es_mio = (v_id == u_id) or (v_name.strip().lower() == u_name)
        combined.append({
            "id": v.get("id"),
            "folio": v.get("folio") or "VENTA",
            "tipo": "venta",
            "fecha": v.get("fecha") or "",
            "total": float(v.get("total") or 0),
            "condicion": v.get("condicion") or "contado",
            "estado": v.get("estado") or "confirmada",
            "vendedor_id": v_id,
            "vendedor_nombre": v_name,
            "vendido_por_mi": es_mio,
            "items_count": len(v.get("items") or []),
            "resumen_items": ", ".join(f"{it.get('cantidad', 1)}x {it.get('descripcion', '')[:20]}" for it in (v.get("items") or [])[:3]),
            "facturable": True,
        })

    # 3. Consultar tickets históricos en legacy_tickets
    eng = get_engine()
    mapped_cod = None
    try:
        async with eng.connect() as conn:
            # Buscar mapeo en legacy_customer_mapping
            m_res = await conn.execute(
                text("SELECT legacy_customer_key FROM legacy_customer_mapping WHERE rysa_customer_id = :cid LIMIT 1"),
                {"cid": client_id}
            )
            m_row = m_res.fetchone()
            if m_row and m_row[0]:
                mapped_cod = str(m_row[0]).strip()

            c_buscar = set()
            if cod:
                c_buscar.add(str(cod).strip())
            if mapped_cod:
                c_buscar.add(mapped_cod)

            if c_buscar:
                q_tickets = text("""
                    SELECT t.legacy_key, t.legacy_serie, t.legacy_folio, t.legacy_fecha, t.legacy_total,
                           t.legacy_condicion, t.legacy_vendedor, t.legacy_cancelado,
                           count(d.partida) as items_count,
                           substr(string_agg(concat(round(d.legacy_cantidad, 0), 'x ', coalesce(d.legacy_codigo, 'Art')), ', '), 1, 80) as resumen_items
                    FROM legacy_tickets t
                    LEFT JOIN legacy_ticket_details d ON d.doc_key = t.legacy_key
                    WHERE t.legacy_cliente = ANY(:cods)
                    GROUP BY t.legacy_key, t.legacy_serie, t.legacy_folio, t.legacy_fecha, t.legacy_total,
                             t.legacy_condicion, t.legacy_vendedor, t.legacy_cancelado
                    ORDER BY t.legacy_fecha DESC, t.legacy_folio DESC
                    LIMIT 30
                """)
                t_res = await conn.execute(q_tickets, {"cods": list(c_buscar)})
                for row in t_res.mappings().all():
                    v_cod = str(row["legacy_vendedor"] or "").strip()
                    # Si coincide con el asesor logueado (código legacy o nombre)
                    es_mio = (v_cod and v_cod in u_name) or (u_id and v_cod == u_id)
                    combined.append({
                        "id": row["legacy_key"],
                        "folio": f"{row['legacy_serie']}-{row['legacy_folio']}",
                        "tipo": "venta",
                        "fecha": str(row["legacy_fecha"] or ""),
                        "total": float(row["legacy_total"] or 0),
                        "condicion": "contado" if row["legacy_condicion"] == "C" else "credito",
                        "estado": "cancelada" if row["legacy_cancelado"] else "confirmada",
                        "vendedor_id": v_cod,
                        "vendedor_nombre": f"Asesor {v_cod}" if v_cod else "Asesor RYSA",
                        "vendido_por_mi": es_mio,
                        "items_count": int(row["items_count"] or 0),
                        "resumen_items": row["resumen_items"] or "",
                        "facturable": True,
                    })
    except Exception as e:
        logger.warning("Error consultando tickets legacy para cliente %s: %s", client_id, e)

    combined.sort(key=lambda x: str(x.get("fecha") or ""), reverse=True)
    return combined[:35]


@router.post("/seller/venta-directa")
async def seller_venta_directa(data: VentaDirectaInput, user: dict = Depends(get_current_user)):
    """Registra una Venta Directa desde la app móvil con control de idempotencia estricto
    y asignación atómica de folios oficiales, evitando colisiones entre asesores en campo."""
    import json
    from pgstore.database import get_engine
    from sqlalchemy import text

    if not data.items:
        raise HTTPException(400, "La venta no tiene productos")

    if not data.idempotency_key or len(data.idempotency_key.strip()) < 8:
        raise HTTPException(400, "Se requiere idempotency_key único para registrar la venta")

    key = data.idempotency_key.strip()
    eng = get_engine()

    # 1. Verificación de Idempotencia: Si ya existe una venta con este idempotency_key,
    # se retorna exactamente la venta previa con su folio oficial (sin duplicar).
    async with eng.connect() as conn:
        res = await conn.execute(
            text('SELECT "id", "doc" FROM "sales" WHERE "doc"->>\'idempotency_key\' = :k LIMIT 1'),
            {"k": key}
        )
        row = res.fetchone()
        if row:
            doc = json.loads(row[1]) if isinstance(row[1], str) else row[1]
            return {
                "ok": True,
                "status": "success",
                "duplicado": True,
                "venta": doc,
                "id": doc.get("id"),
                "folio": doc.get("folio"),
                "total": float(doc.get("total") or 0),
                "mensaje": "Venta previamente registrada (confirmada)",
            }

    # 2. Obtener cliente
    cliente = None
    if data.cliente_id:
        cliente = await db.clients.find_one({"id": data.cliente_id}, {"_id": 0})
    cliente_nombre = (cliente.get("nombre") if cliente else "") or data.cliente_nombre or "Público General"

    # 3. Calcular importes e impuestos
    subtotal = 0.0
    iva_total = 0.0
    items_out = []
    for it in data.items:
        if it.cantidad <= 0:
            continue
        imp = round(it.cantidad * it.precio, 2)
        iva_lin = round(imp * (it.iva_tasa / 100.0), 2) if it.iva_tasa else 0.0
        subtotal += imp
        iva_total += iva_lin
        items_out.append({
            "product_id": it.product_id,
            "codigo": it.codigo,
            "descripcion": it.descripcion,
            "unidad": it.unidad or "PZA",
            "cantidad": it.cantidad,
            "precio": it.precio,
            "iva_tasa": it.iva_tasa or 0.0,
            "subtotal": imp,
            "iva": iva_lin,
            "total": imp + iva_lin,
        })

    if not items_out:
        raise HTTPException(400, "No hay partidas con cantidad válida")

    total = round(subtotal + iva_total, 2)

    # 4. Asignación ATÓMICA del folio único de venta (V-XXXXXX)
    folio = await next_counter("venta", "V", 6)

    # 5. Estructurar documento de venta
    now_dt = now_utc()
    sale_id = _uid()
    saldo = total if data.condicion == "credito" else 0.0
    doc = {
        "id": sale_id,
        "folio": folio,
        "fecha": data.fecha or iso_now()[:10],
        "hora": now_dt.strftime("%H:%M"),
        "origen": "movil_campo",
        "tipo_venta": "venta_directa",
        "condicion": data.condicion or "contado",
        "forma_pago": data.forma_pago or "efectivo",
        "cliente_id": data.cliente_id or "",
        "cliente_nombre": cliente_nombre,
        "cliente_codigo": (cliente.get("codigo") if cliente else "") or data.cliente_codigo or "",
        "vendedor_id": user["id"],
        "vendedor_nombre": user.get("name", "Asesor Móvil"),
        "items": items_out,
        "items_count": len(items_out),
        "subtotal": round(subtotal, 2),
        "iva_total": round(iva_total, 2),
        "total": total,
        "saldo": saldo,
        "estado": "confirmada",
        "factura": False,
        "facturado": False,
        "notas": data.notas or "",
        "latitud": data.latitud,
        "longitud": data.longitud,
        "idempotency_key": key,
        "created_at": iso_now(),
    }

    # 6. Insertar en db.sales
    await db.sales.insert_one(doc)

    # 7. Actualizar saldo del cliente si es venta a crédito
    if data.condicion == "credito" and data.cliente_id:
        await db.clients.update_one(
            {"id": data.cliente_id},
            {"$inc": {"saldo": total}}
        )

    # 8. Auditoría
    await log_audit(
        usuario=user,
        accion="VENTA_DIRECTA_MOVIL",
        entidad="VENTA",
        registro_id=sale_id,
        detalle=f"Venta directa móvil {folio} ({cliente_nombre}) por ${total:,.2f} MXN"
    )

    return {
        "ok": True,
        "status": "success",
        "duplicado": False,
        "venta": doc,
        "id": sale_id,
        "folio": folio,
        "total": total,
        "mensaje": f"Venta directa {folio} registrada exitosamente.",
    }


@router.post("/seller/facturar-solicitud")
async def seller_facturar_solicitud(data: FacturarSolicitudInput, user: dict = Depends(get_current_user)):
    """Registra la solicitud de facturación para una venta del histórico."""
    solicitud_id = _uid()
    sid = data.sale_id or data.venta_id or ""
    rfc = data.rfc or data.cliente_rfc or ""
    razon = data.razon_social or data.cliente_nombre or ""
    email = data.correo or data.email or ""

    doc = {
        "id": solicitud_id,
        "sale_id": sid,
        "folio": data.folio,
        "solicitado_por_id": user["id"],
        "solicitado_por_nombre": user.get("name", "Asesor"),
        "cliente_id": data.cliente_id,
        "cliente_nombre": razon,
        "rfc": rfc,
        "razon_social": razon,
        "uso_cfdi": data.uso_cfdi,
        "regimen_fiscal": data.regimen_fiscal,
        "correo": email,
        "confirmado_no_propio": bool(data.confirmado_no_propio),
        "estado": "pendiente_emision",
        "fecha": iso_now(),
    }
    await db.cfdi_documents.insert_one(doc)
    await log_audit(
        usuario=user,
        accion="SOLICITUD_FACTURACION_MOVIL",
        entidad="FACTURA",
        registro_id=sid or data.folio,
        detalle=f"Solicitud de factura para folio {data.folio} ({rfc})"
    )
    return {
        "ok": True,
        "status": "success",
        "solicitud_id": solicitud_id,
        "mensaje": f"Solicitud de facturación para folio {data.folio} registrada correctamente."
    }


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


# ==========================================================================
# DOCUMENTOS DE EXPEDIENTE DEL CLIENTE (INE, CSF) - SOLO CONTADO EN CAMPO
# ==========================================================================
_DOC_MIME_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}


@router.post("/clients/{cliente_id}/documentos")
async def subir_documento_cliente(
    cliente_id: str,
    tipo: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user)
):
    """Sube un documento de expediente de cliente (ine_frontal, ine_reverso, csf).
    Permitido para JPG, PNG, WEBP y PDF (máx 15 MB)."""
    cli = await db.clients.find_one({"id": cliente_id})
    if not cli:
        raise HTTPException(404, "Cliente no encontrado")
    if not _puede_gestionar_fachada(user, cli):
        raise HTTPException(403, "Solo puedes subir documentos de tus clientes asignados")

    if tipo not in ("ine_frontal", "ine_reverso", "csf"):
        raise HTTPException(400, "Tipo de documento no válido. Usa ine_frontal, ine_reverso o csf.")

    data = await file.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(400, "El documento no debe superar 15 MB.")

    mime = storage.detect_mime_type(data)
    if mime not in _DOC_MIME_EXT:
        raise HTTPException(400, f"Formato no permitido ({mime}). Usa JPG, PNG, WEBP o PDF.")

    ext = _DOC_MIME_EXT[mime]
    path = f"uploads/documentos_cliente/{cliente_id}_{tipo}_{_uid()[:8]}{ext}"
    try:
        result = storage.put_object(path, data, mime)
    except Exception:
        raise HTTPException(502, "No se pudo guardar el documento en el servidor.")

    stored = result.get("path", path)
    await db.files.insert_one({
        "id": _uid(),
        "storage_path": stored,
        "original_filename": file.filename or f"{tipo}{ext}",
        "content_type": mime,
        "size": result.get("size", len(data)),
        "cliente_id": cliente_id,
        "tipo_doc": tipo,
        "is_deleted": False,
        "created_at": iso_now(),
    })

    url = f"/api/files/{stored}"
    docs = cli.get("documentos") or {}
    # Reemplazar documento previo si existía
    if isinstance(docs, dict) and docs.get(tipo) and isinstance(docs[tipo], dict):
        await _soft_delete_archivo(docs[tipo].get("url", ""))

    docs[tipo] = {
        "url": url,
        "filename": file.filename or f"{tipo}{ext}",
        "mime": mime,
        "size": len(data),
        "fecha": iso_now()
    }

    await db.clients.update_one(
        {"id": cliente_id},
        {"$set": {"documentos": docs}}
    )

    await log_audit(user, "subir_documento", "cliente", cliente_id, cli.get("nombre", ""), f"{tipo}: {url}")
    return {"ok": True, "tipo": tipo, "url": url, "documentos": docs}


@router.get("/clients/{cliente_id}/frecuentes")
async def productos_frecuentes_cliente(
    cliente_id: str,
    user: dict = Depends(get_current_user)
):
    """Retorna los productos más frecuentes comprados por el cliente."""
    sales = await db.sales.find(
        {"cliente_id": cliente_id, "estado": {"$ne": "cancelada"}},
        {"_id": 0, "productos": 1, "items": 1}
    ).sort("fecha", -1).to_list(200)

    contador = {}
    for s in sales:
        items = s.get("items") or s.get("productos") or []
        for it in items:
            pid = str(it.get("producto_id") or it.get("id") or it.get("codigo") or "")
            if not pid:
                continue
            if pid not in contador:
                contador[pid] = {
                    "producto_id": pid,
                    "codigo": it.get("codigo") or pid,
                    "nombre": it.get("nombre") or it.get("descripcion") or "Producto",
                    "veces_comprado": 0,
                    "total_unidades": 0,
                    "ultimo_precio": float(it.get("precio") or it.get("precio_unitario") or 0),
                    "linea": it.get("linea") or "",
                }
            contador[pid]["veces_comprado"] += 1
            contador[pid]["total_unidades"] += float(it.get("cantidad") or 1)

    top = sorted(contador.values(), key=lambda x: (x["veces_comprado"], x["total_unidades"]), reverse=True)[:8]
    return {"ok": True, "cliente_id": cliente_id, "frecuentes": top}


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


@router.post("/clients/{cliente_id}/ubicacion")
async def set_client_ubicacion(cliente_id: str, data: LocationInput,
                               user: dict = Depends(get_current_user)):
    """El vendedor captura la ubicación GPS de un cliente de SU cartera
    (o admin/supervisión sobre cualquiera). Usado por 'Mi Ruta' en campo."""
    cli = await db.clients.find_one({"id": cliente_id}, {"_id": 0})
    if not cli:
        raise HTTPException(404, "Cliente no encontrado")
    if not (_es_admin(user) or _vende_todo(user)
            or cli.get("vendedor_id") in (None, "", user["id"])):
        raise HTTPException(403, "Solo puedes ubicar clientes de tu propia cartera")
    upd = {
        "latitud": round(float(data.latitud), 6),
        "longitud": round(float(data.longitud), 6),
        "estado_geo": f"capturada_{data.fuente or 'gps'}",
        "geo_actualizada": iso_now(),
    }
    if data.precision is not None:
        upd["geo_precision_m"] = round(float(data.precision), 1)
    await db.clients.update_one({"id": cliente_id}, {"$set": upd})
    await log_audit(user, "capturar_ubicacion", "cliente", cliente_id,
                    f"{upd['latitud']},{upd['longitud']} · {cli.get('nombre','')}")
    return {"ok": True, **{k: upd[k] for k in ("latitud", "longitud")}}


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
        "foto_evidencia": data.foto_evidencia or "",
        "usuario_id": user["id"], "created_at": now, "updated_at": now,
    }
    await db.visits.insert_one(doc)
    if data.foto_evidencia and not cliente.get("foto_fachada"):
        await db.clients.update_one({"id": cliente["id"]}, {"$set": {"foto_fachada": data.foto_evidencia, "fachada_actualizada": now}})
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
    if data.foto_evidencia:
        upd["foto_evidencia"] = data.foto_evidencia
        cid = v.get("cliente_id")
        if cid:
            cli = await db.clients.find_one({"id": cid}, {"_id": 0, "foto_fachada": 1})
            if cli and not cli.get("foto_fachada"):
                await db.clients.update_one({"id": cid}, {"$set": {"foto_fachada": data.foto_evidencia, "fachada_actualizada": now}})
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
                           hasta: Optional[str] = None, fecha: Optional[str] = None,
                           limit: int = 1000,
                           user: dict = Depends(get_current_user)):
    """Historial de ubicaciones de un vendedor. Solo supervisión/admin (o el propio vendedor)."""
    if not (_vende_todo(user) or user["id"] == vendedor_id):
        raise HTTPException(403, "No tienes permiso para ver estas ubicaciones")
    flt = {"vendedor_id": vendedor_id}
    if fecha:
        flt["fecha"] = {"$regex": "^" + fecha[:10]}
    else:
        if desde:
            flt["fecha"] = {"$gte": desde[:10]}
        if hasta:
            if "fecha" in flt and isinstance(flt["fecha"], dict):
                flt["fecha"]["$lte"] = f"{hasta[:10]} 23:59:59"
            else:
                flt["fecha"] = {"$lte": f"{hasta[:10]} 23:59:59"}
    # Orden cronológico ascendente (inicio del día a fin del día) para trazado de ruta
    return await db.seller_locations.find(
        flt, {"_id": 0}).sort("fecha", 1).limit(min(limit, 2000)).to_list()


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
            "foto_url": v.get("foto_url") or v.get("foto") or "",
            "telefono": v.get("telefono") or "",
            "expediente": v.get("expediente") or {},
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
            "foto_url": m.get("foto_url") or "",
            "telefono": m.get("telefono") or "",
            "expediente": m.get("expediente") or {},
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
            "foto_url": seller.get("foto_url") or seller.get("foto") or "",
            "telefono": seller.get("telefono") or "",
            "expediente": seller.get("expediente") or {},
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


# ==========================================================================
# GESTIÓN Y EXPEDIENTE DE VENDEDORES (FOTO, EXPEDIENTE, ACTIVIDAD DÍA, RUTAS)
# ==========================================================================
class VendedorUpdateInput(BaseModel):
    telefono: Optional[str] = None
    foto_url: Optional[str] = None
    expediente: Optional[dict] = None


@router.get("/supervision/vendedores/{seller_id}/actividad-dia")
async def supervision_vendedor_actividad_dia(
    seller_id: str,
    fecha: Optional[str] = None,
    user: dict = Depends(require_permission("supervision.ver"))
):
    """Consulta consolidada de visitas, ventas y pedidos de un vendedor en el día."""
    seller = await db.users.find_one({"id": seller_id}, {"_id": 0, "password": 0})
    if not seller:
        raise HTTPException(404, "Vendedor no encontrado")
    
    hoy = (fecha or now_utc().date().isoformat())[:10]
    
    # 1. Visitas del día
    visitas = await db.visits.find(
        {"vendedor_id": seller_id, "fecha": {"$regex": "^" + hoy}},
        {"_id": 0}
    ).sort("fecha", -1).to_list(1000)
    
    # 2. Ventas del día
    ventas = await db.sales.find(
        {"vendedor_id": seller_id, "fecha": {"$regex": "^" + hoy}},
        {"_id": 0, "id": 1, "folio": 1, "fecha": 1, "cliente_nombre": 1, "total": 1,
         "condicion": 1, "estado": 1, "metodo_pago": 1}
    ).sort("fecha", -1).to_list(1000)
    
    # 3. Pedidos del día
    pedidos = await db.pedidos.find(
        {"vendedor_id": seller_id, "created_at": {"$regex": "^" + hoy}},
        {"_id": 0, "id": 1, "folio": 1, "created_at": 1, "cliente_nombre": 1, "total": 1, "estado": 1}
    ).sort("created_at", -1).to_list(1000)
    
    return {
        "vendedor": {
            "id": seller["id"],
            "name": seller.get("name"),
            "email": seller.get("email"),
            "foto_url": seller.get("foto_url") or seller.get("foto") or "",
            "telefono": seller.get("telefono") or "",
            "expediente": seller.get("expediente") or {},
        },
        "fecha": hoy,
        "visitas": visitas,
        "ventas": ventas,
        "pedidos": pedidos,
        "resumen": {
            "total_visitas": len(visitas),
            "visitas_realizadas": sum(1 for v in visitas if v.get("estado") == "realizada"),
            "total_ventas": len(ventas),
            "monto_ventas": round(sum(float(v.get("total", 0) or 0) for v in ventas), 2),
            "total_pedidos": len(pedidos),
            "monto_pedidos": round(sum(float(p.get("total", 0) or 0) for p in pedidos), 2),
        }
    }


@router.put("/supervision/sellers/{seller_id}")
async def supervision_actualizar_vendedor(
    seller_id: str,
    data: VendedorUpdateInput,
    user: dict = Depends(require_permission("supervision.cartera"))
):
    """Actualiza datos del vendedor: teléfono, foto y expediente laboral."""
    seller = await db.users.find_one({"id": seller_id})
    if not seller:
        raise HTTPException(404, "Vendedor no encontrado")
    
    upd = {}
    if data.telefono is not None:
        upd["telefono"] = str(data.telefono).strip()
    if data.foto_url is not None:
        upd["foto_url"] = str(data.foto_url).strip()
    if data.expediente is not None:
        upd["expediente"] = data.expediente
    
    if upd:
        await db.users.update_one({"id": seller_id}, {"$set": upd})
        await log_audit(user, "update", "vendedor", seller_id, f"Actualización de expediente/datos de {seller.get('name')}")
    
    return {"ok": True, "vendedor_id": seller_id, "actualizado": list(upd.keys())}


@router.post("/supervision/sellers/{seller_id}/foto")
async def supervision_subir_foto_vendedor(
    seller_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_permission("supervision.cartera"))
):
    """Sube/actualiza la foto de perfil del vendedor."""
    seller = await db.users.find_one({"id": seller_id})
    if not seller:
        raise HTTPException(404, "Vendedor no encontrado")
    
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(400, "La imagen no debe superar 8 MB.")
    mime = storage.detect_mime_type(data)
    if mime not in _MIME_EXT:
        raise HTTPException(400, "Formato no permitido. Usa JPG, PNG, WEBP o GIF.")
    
    path = f"uploads/vendedores/{_uid()}{_MIME_EXT[mime]}"
    try:
        result = storage.put_object(path, data, mime)
    except Exception:
        raise HTTPException(502, "No se pudo guardar la imagen.")
    stored = result.get("path", path)
    await db.files.insert_one({
        "id": _uid(), "storage_path": stored,
        "original_filename": file.filename or "foto_vendedor",
        "content_type": mime, "size": result.get("size", len(data)),
        "original_size": len(data), "original_type": mime,
        "is_deleted": False, "created_at": iso_now(),
    })
    
    prev_foto = seller.get("foto_url") or ""
    if prev_foto:
        await _soft_delete_archivo(prev_foto)
    
    url = f"/api/files/{stored}"
    await db.users.update_one({"id": seller_id}, {"$set": {"foto_url": url}})
    return {"ok": True, "foto_url": url}


class RutaPlanInput(BaseModel):
    nombre: Optional[str] = "Ruta Asignada"
    dias_semana: List[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5])
    paradas: List[dict] = Field(default_factory=list)


@router.post("/supervision/sellers/{seller_id}/rutas")
async def supervision_asignar_ruta_vendedor(
    seller_id: str,
    data: RutaPlanInput,
    user: dict = Depends(require_permission("supervision.cartera"))
):
    """Asigna o actualiza el plan de visitas/ruta para un vendedor.
    REGLA DE NEGOCIO: Solo permite incluir clientes asignados a su propia cartera."""
    seller = await db.users.find_one({"id": seller_id})
    if not seller:
        raise HTTPException(404, "Vendedor no encontrado")
    
    cliente_ids = [p.get("cliente_id") for p in data.paradas if p.get("cliente_id")]
    if cliente_ids:
        ajenos = await db.clients.find(
            {"id": {"$in": cliente_ids}, "vendedor_id": {"$ne": seller_id}},
            {"_id": 0, "id": 1, "nombre": 1}
        ).to_list(100)
        if ajenos:
            nombres = ", ".join(c.get("nombre", "") for c in ajenos[:3])
            raise HTTPException(
                400,
                f"No puedes agregar a la ruta clientes de otra cartera ({nombres}). Solo clientes asignados a este asesor."
            )
    
    ruta_id = f"RUTA_{seller_id}"
    doc = {
        "id": ruta_id,
        "vendedor_id": seller_id,
        "vendedor_nombre": seller.get("name"),
        "nombre": data.nombre,
        "dias_semana": data.dias_semana,
        "paradas": data.paradas,
        "actualizada": iso_now(),
        "actualizada_por": user.get("name"),
    }
    await db.sales_routes.replace_one({"id": ruta_id}, doc, upsert=True)
    return {"ok": True, "ruta": doc}

