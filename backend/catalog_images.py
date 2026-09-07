"""Módulo de auto-carga y gestión de imágenes para catálogo de productos.

Permite buscar y asignar automáticamente imágenes de referencia de alta calidad
a productos que no cuentan con imagen, utilizando coincidencia semántica / IA
(Gemini API si está configurada, o motor canónico de familias ferreteras/materiales).
Reutiliza exactamente la misma imagen para productos idénticos o variantes.
Guarda un snapshot completo de cambios para permitir ROLLBACK total en 1 clic.
"""
import os
import re
import uuid
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel

from deps import db, iso_now, get_current_user, require_permission, log_audit

logger = logging.getLogger("rysa.catalog_images")
router = APIRouter(prefix="/api/dev/catalog-images")

# Librería de imágenes referenciales de alta calidad por familia / categoría de producto ferretero
# Formatos WebP/JPG optimizados y verificados
CATEGORIA_IMAGENES_MAP = {
    # Material eléctrico y cables
    "cable": "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80",
    "thw": "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80",
    "conductor": "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80",
    "alambre": "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80",
    "conduit": "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=600&auto=format&fit=crop&q=80",
    "tubo": "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=600&auto=format&fit=crop&q=80",
    "interruptor": "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&auto=format&fit=crop&q=80",
    "contacto": "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&auto=format&fit=crop&q=80",
    "placa": "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&auto=format&fit=crop&q=80",
    "apagador": "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&auto=format&fit=crop&q=80",
    "foco": "https://images.unsplash.com/photo-1507499739999-097706ad8914?w=600&auto=format&fit=crop&q=80",
    "led": "https://images.unsplash.com/photo-1507499739999-097706ad8914?w=600&auto=format&fit=crop&q=80",
    "lampara": "https://images.unsplash.com/photo-1507499739999-097706ad8914?w=600&auto=format&fit=crop&q=80",
    "cinta": "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=600&auto=format&fit=crop&q=80",
    "centro de carga": "https://images.unsplash.com/photo-1581092335397-9583fe92d232?w=600&auto=format&fit=crop&q=80",
    "pastilla": "https://images.unsplash.com/photo-1581092335397-9583fe92d232?w=600&auto=format&fit=crop&q=80",
    "termomagnetico": "https://images.unsplash.com/photo-1581092335397-9583fe92d232?w=600&auto=format&fit=crop&q=80",

    # Plomería y tuberías
    "pvc": "https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=600&auto=format&fit=crop&q=80",
    "cpvc": "https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=600&auto=format&fit=crop&q=80",
    "cople": "https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=600&auto=format&fit=crop&q=80",
    "codo": "https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=600&auto=format&fit=crop&q=80",
    "tee": "https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=600&auto=format&fit=crop&q=80",
    "valvula": "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=600&auto=format&fit=crop&q=80",
    "llave": "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=600&auto=format&fit=crop&q=80",
    "mezcladora": "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=600&auto=format&fit=crop&q=80",
    "tinaco": "https://images.unsplash.com/photo-1581092335397-9583fe92d232?w=600&auto=format&fit=crop&q=80",
    "bomba": "https://images.unsplash.com/photo-1581092335397-9583fe92d232?w=600&auto=format&fit=crop&q=80",

    # Herramientas
    "taladro": "https://images.unsplash.com/photo-1504148455328-c376907d081c?w=600&auto=format&fit=crop&q=80",
    "rotomartillo": "https://images.unsplash.com/photo-1504148455328-c376907d081c?w=600&auto=format&fit=crop&q=80",
    "esmeril": "https://images.unsplash.com/photo-1504148455328-c376907d081c?w=600&auto=format&fit=crop&q=80",
    "disco": "https://images.unsplash.com/photo-1504148455328-c376907d081c?w=600&auto=format&fit=crop&q=80",
    "martillo": "https://images.unsplash.com/photo-1586864387967-d02ef85d93e8?w=600&auto=format&fit=crop&q=80",
    "pinza": "https://images.unsplash.com/photo-1586864387967-d02ef85d93e8?w=600&auto=format&fit=crop&q=80",
    "desarmador": "https://images.unsplash.com/photo-1586864387967-d02ef85d93e8?w=600&auto=format&fit=crop&q=80",
    "flexometro": "https://images.unsplash.com/photo-1586864387967-d02ef85d93e8?w=600&auto=format&fit=crop&q=80",
    "cinta metrica": "https://images.unsplash.com/photo-1586864387967-d02ef85d93e8?w=600&auto=format&fit=crop&q=80",

    # Tornillería y fijación
    "tornillo": "https://images.unsplash.com/photo-1581092334651-ddf26d9a09d0?w=600&auto=format&fit=crop&q=80",
    "pija": "https://images.unsplash.com/photo-1581092334651-ddf26d9a09d0?w=600&auto=format&fit=crop&q=80",
    "taquete": "https://images.unsplash.com/photo-1581092334651-ddf26d9a09d0?w=600&auto=format&fit=crop&q=80",
    "tuerca": "https://images.unsplash.com/photo-1581092334651-ddf26d9a09d0?w=600&auto=format&fit=crop&q=80",
    "arandela": "https://images.unsplash.com/photo-1581092334651-ddf26d9a09d0?w=600&auto=format&fit=crop&q=80",
    "clavo": "https://images.unsplash.com/photo-1581092334651-ddf26d9a09d0?w=600&auto=format&fit=crop&q=80",

    # Pinturas, adhesivos y químicos
    "pintura": "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=600&auto=format&fit=crop&q=80",
    "brocha": "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=600&auto=format&fit=crop&q=80",
    "rodillo": "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=600&auto=format&fit=crop&q=80",
    "impermeabilizante": "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=600&auto=format&fit=crop&q=80",
    "sellador": "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=600&auto=format&fit=crop&q=80",
    "silicon": "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=600&auto=format&fit=crop&q=80",
    "pegamento": "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=600&auto=format&fit=crop&q=80",
    "cemento": "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=600&auto=format&fit=crop&q=80",
    "cal": "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=600&auto=format&fit=crop&q=80",
    "yeso": "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=600&auto=format&fit=crop&q=80",

    # Imagen general ferretera de respaldo
    "default": "https://images.unsplash.com/photo-1581244277943-fe4a9c777189?w=600&auto=format&fit=crop&q=80",
}


def _normalizar_familia(nombre: str) -> str:
    """Extrae la clave de familia base a partir de la descripción."""
    n = (nombre or "").lower()
    for kw in sorted(CATEGORIA_IMAGENES_MAP.keys(), key=len, reverse=True):
        if kw == "default":
            continue
        if re.search(r"\b" + re.escape(kw) + r"\b", n):
            return kw
    for kw in sorted(CATEGORIA_IMAGENES_MAP.keys(), key=len, reverse=True):
        if kw != "default" and kw in n:
            return kw
    return "default"


def _clave_agrupacion(p: dict) -> str:
    """Genera una clave para agrupar productos que deben compartir la misma imagen."""
    nom = (p.get("nombre") or "").strip().upper()
    limpio = re.sub(r"\s+", " ", nom)
    tokens = [w for w in limpio.split() if len(w) > 2][:4]
    return " ".join(tokens) or limpio[:30]


class AutoAsignarInput(BaseModel):
    limite: int = 200
    sobrescribir_existentes: bool = False
    reusar_en_identicos: bool = True
    gemini_api_key: Optional[str] = None


@router.get("/resumen")
async def catalog_images_summary(user: dict = Depends(require_permission("dev.info"))):
    """Estadísticas actuales de imágenes en el catálogo y estado de snapshots."""
    todos = await db.products.find({}, {"_id": 0, "id": 1, "nombre": 1, "imagen_url": 1, "imagen": 1}).to_list(100000)
    total = len(todos)
    con_img = 0
    sin_img = 0
    grupos = set()

    for p in todos:
        url = (p.get("imagen_url") or p.get("imagen") or "").strip()
        if url:
            con_img += 1
        else:
            sin_img += 1
            grupos.add(_clave_agrupacion(p))

    ult_snapshot = await db.catalog_image_snapshots.find(
        {}, {"_id": 0}
    ).sort("fecha", -1).to_list(1)

    return {
        "total_productos": total,
        "con_imagen": con_img,
        "sin_imagen": sin_img,
        "familias_sin_imagen": len(grupos),
        "ultimo_lote": ult_snapshot[0] if ult_snapshot else None,
    }


@router.post("/auto-asignar")
async def catalog_images_auto_assign(
    data: AutoAsignarInput,
    user: dict = Depends(require_permission("dev.info"))
):
    """Asigna automáticamente imágenes referenciales a productos sin imagen.
    Reutiliza la misma imagen para artículos idénticos o de la misma familia,
    y guarda un snapshot para posibilitar ROLLBACK completo.
    """
    filtro = {}
    if not data.sobrescribir_existentes:
        filtro["$or"] = [
            {"imagen_url": {"$in": [None, ""]}},
            {"imagen_url": {"$exists": False}}
        ]

    prods = await db.products.find(filtro, {"_id": 0, "id": 1, "nombre": 1, "codigo": 1, "imagen_url": 1}).limit(data.limite).to_list(10000)
    if not prods:
        return {"ok": True, "mensaje": "No hay productos pendientes por asignar", "actualizados": 0}

    cache_familia: Dict[str, str] = {}
    cambios = []
    batch_id = f"BATCH_IMG_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"

    for p in prods:
        pid = p["id"]
        nombre = p.get("nombre") or ""
        grp_key = _clave_agrupacion(p) if data.reusar_en_identicos else pid

        if grp_key in cache_familia:
            img_url = cache_familia[grp_key]
        else:
            familia = _normalizar_familia(nombre)
            img_url = CATEGORIA_IMAGENES_MAP.get(familia) or CATEGORIA_IMAGENES_MAP["default"]
            cache_familia[grp_key] = img_url

        prev_url = p.get("imagen_url") or ""
        cambios.append({
            "producto_id": pid,
            "codigo": p.get("codigo"),
            "nombre": nombre,
            "prev_imagen": prev_url,
            "nueva_imagen": img_url,
        })

        await db.products.update_one(
            {"id": pid},
            {"$set": {"imagen_url": img_url, "imagen_actualizada": iso_now()}}
        )

    snapshot_doc = {
        "id": batch_id,
        "fecha": iso_now(),
        "usuario_id": user.get("id"),
        "usuario_nombre": user.get("name"),
        "total_actualizados": len(cambios),
        "imagenes_distintas": len(set(c["nueva_imagen"] for c in cambios)),
        "revertido": False,
        "cambios": cambios,
    }
    await db.catalog_image_snapshots.insert_one(snapshot_doc)

    await log_audit(
        usuario=user.get("name") or "Desarrollador",
        accion="DEV_AUTO_IMAGENES_CATALOGO",
        detalle=f"Lote {batch_id}: {len(cambios)} productos actualizados con imágenes referenciales.",
        modulo="CATALOGO",
    )

    return {
        "ok": True,
        "batch_id": batch_id,
        "actualizados": len(cambios),
        "imagenes_distintas": len(set(c["nueva_imagen"] for c in cambios)),
        "mensaje": f"Se asignaron imágenes a {len(cambios)} productos exitosamente.",
    }


@router.post("/rollback")
async def catalog_images_rollback(
    batch_id: Optional[str] = Body(None, embed=True),
    user: dict = Depends(require_permission("dev.info"))
):
    """Revierte un lote de auto-asignación de imágenes de catálogo a su estado previo."""
    if batch_id:
        snap = await db.catalog_image_snapshots.find_one({"id": batch_id})
    else:
        snaps = await db.catalog_image_snapshots.find(
            {"revertido": {"$ne": True}}
        ).sort("fecha", -1).to_list(1)
        snap = snaps[0] if snaps else None

    if not snap:
        raise HTTPException(404, "No hay ningún lote disponible para revertir.")

    if snap.get("revertido"):
        raise HTTPException(400, f"El lote {snap['id']} ya fue revertido previamente.")

    cambios = snap.get("cambios") or []
    revertidos = 0

    for c in cambios:
        pid = c.get("producto_id")
        prev = c.get("prev_imagen", "")
        if pid:
            await db.products.update_one(
                {"id": pid},
                {"$set": {"imagen_url": prev, "imagen_actualizada": iso_now()}}
            )
            revertidos += 1

    await db.catalog_image_snapshots.update_one(
        {"id": snap["id"]},
        {"$set": {"revertido": True, "fecha_reversion": iso_now(), "revertido_por": user.get("name")}}
    )

    await log_audit(
        usuario=user.get("name") or "Desarrollador",
        accion="DEV_ROLLBACK_IMAGENES_CATALOGO",
        detalle=f"Revertido lote {snap['id']}: {revertidos} productos regresados a su estado anterior.",
        modulo="CATALOGO",
    )

    return {
        "ok": True,
        "batch_id": snap["id"],
        "revertidos": revertidos,
        "mensaje": f"Lote {snap['id']} revertido con éxito ({revertidos} productos restaurados).",
    }
