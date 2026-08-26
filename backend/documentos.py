"""GENERADOR ÚNICO de documentos de venta (ticket y formato carta).

Flujo oficial:
    VENTA CONFIRMADA → asegurar_documentos() → MISMO ARCHIVO para
    vista previa · descarga · impresión · WhatsApp · correo.

Garantías:
- Un solo lugar construye los PDFs (storage.build_ticket_pdf / build_letter_pdf).
- Nombre de archivo DETERMINÍSTICO por venta+formato: se genera una única vez
  y todas las llamadas posteriores devuelven EL MISMO archivo (antes cada
  compartida creaba un PDF nuevo con UUID → WhatsApp recibía otro documento).
- La venta guarda las URLs (doc_ticket_pdf / doc_carta_pdf) para auditoría.
- Los tres formatos leen los MISMOS datos de la venta; solo cambia presentación.
"""
import hashlib
import uuid
from datetime import timedelta

import storage
from deps import db, iso_now, now_utc


def _uid() -> str:
    return uuid.uuid4().hex


async def _link_activo_de(cotizacion_id: str) -> dict | None:
    return await db.cot_pago_tokens.find_one(
        {"cotizacion_id": cotizacion_id, "estado": "activo"}, {"_id": 0})


def _folio_clean(sale: dict) -> str:
    return "".join(c for c in sale.get("folio", "venta") if c.isalnum()) or "venta"


def _hash8(sale: dict) -> str:
    """Huella estable del contenido de la venta (id+fecha+total+#items)."""
    base = f"{sale.get('id','')}|{sale.get('fecha','')}|{sale.get('total','')}|{len(sale.get('items') or [])}"
    return hashlib.sha1(base.encode()).hexdigest()[:8]


async def _cliente_doc(sale: dict) -> dict | None:
    if not sale.get("cliente_id"):
        return None
    c = await db.clients.find_one({"id": sale["cliente_id"]}, {"_id": 0})
    if not c:
        return None
    return {
        "nombre": c.get("nombre"), "rfc": c.get("rfc"),
        "telefono": c.get("telefono") or c.get("celular") or c.get("whatsapp"),
        "correo": c.get("correo") or c.get("correos"),
        "direccion": c.get("direccion"), "colonia": c.get("colonia"),
        "ciudad": c.get("ciudad"), "estado_geo": c.get("estado_geo"), "cp": c.get("cp"),
        "municipio": c.get("municipio") or c.get("municipio_geo") or "",
    }


async def _registrar_archivo(storage_path: str, filename: str,
                             size: int, sale_id: str):
    """Registro en colección files SIN duplicar por storage_path."""
    existe = await db.files.find_one({"storage_path": storage_path, "is_deleted": False}, {"_id": 0})
    if existe:
        return
    await db.files.insert_one({
        "id": _uid(), "storage_path": storage_path,
        "original_filename": filename, "content_type": "application/pdf",
        "size": size, "sale_id": sale_id, "is_deleted": False,
        "created_at": iso_now(),
    })


async def asegurar_documentos(sale_id: str, formatos=("ticket", "carta"),
                              regenerar: bool = False,
                              base_url: str = "") -> dict:
    """Devuelve {formato: {"url","path","regenerado"}} garantizando que exista
    UN archivo por venta+formato. Si ya está generado lo reutiliza tal cual.
    base_url: raíz pública del sitio para el QR de comprobante de pago."""
    sale = await db.sales.find_one({"id": sale_id}, {"_id": 0})
    if not sale:
        raise ValueError("Venta no encontrada")
    settings = await db.settings.find_one({"_id": "app"}, {"_id": 0}) or {}

    out = {}
    cliente = None
    cuentas = None
    for fmt in formatos:
        campo = f"doc_{fmt}_pdf"
        url_previa = sale.get(campo)
        if url_previa and not regenerar:
            out[fmt] = {"url": url_previa,
                        "path": url_previa.split("/api/files/", 1)[-1],
                        "regenerado": False}
            continue

        if cliente is None and fmt in ("carta", "cotizacion"):
            cliente = await _cliente_doc(sale)
        if cuentas is None and fmt == "cotizacion":
            # Hoja 2: cuentas bancarias ACTIVAS (predeterminada primero).
            cuentas = await db.cuentas_bancarias.find(
                {"activa": {"$ne": False}}, {"_id": 0}).to_list(100)
            cuentas.sort(key=lambda d: (0 if d.get("predeterminada") else 1,
                                        (d.get("banco") or "").lower()))

        if fmt == "ticket":
            pdf_bytes = storage.build_ticket_pdf(sale, settings)
            filename = f"ticket-{sale.get('folio')}.pdf"
        elif fmt == "carta":
            pdf_bytes = storage.build_letter_pdf(sale, settings, cliente)
            filename = f"carta-{sale.get('folio')}.pdf"
        elif fmt == "cotizacion":
            # QR de comprobante de pago (§17-18): enlace/token PERSISTENTE por
            # cotización; regenerar el PDF NO rota el token (solo el endpoint
            # explícito de regeneración lo revoca).
            pago_url = ""
            try:
                import pago_qr as _pq
                cfg = settings.get("qr_comprobante") or {}
                if cfg.get("activo", True):
                    link = await _link_activo_de(sale["id"])
                    if not link:
                        from datetime import timedelta
                        token = _pq.nuevo_token()
                        vdias = max(1, int(cfg.get("vigencia_dias", 30) or 30))
                        link = {
                            "id": _uid(), "cotizacion_id": sale["id"],
                            "folio": sale.get("folio"), "token": token,
                            "token_hash": _pq.hash_token(token),
                            "estado": "activo", "creado_por": "sistema (PDF)",
                            "created_at": iso_now(),
                            "expires_at": (now_utc() + timedelta(days=vdias)).isoformat(),
                        }
                        await db.cot_pago_tokens.insert_one(dict(link))
                    pago_url = _pq.armar_url(base_url, link["token"])
            except Exception:
                pago_url = ""
            pdf_bytes = storage.build_cotizacion_pdf(sale, settings, cliente, cuentas,
                                                     pago_url=pago_url)
            filename = f"cotizacion-{sale.get('folio')}.pdf"
        else:
            continue

        path = f"tickets/{_folio_clean(sale)}-{_hash8(sale)}-{fmt}.pdf"
        result = storage.put_object(path, pdf_bytes, "application/pdf")
        stored = result.get("path", path)
        await _registrar_archivo(stored, filename,
                                 result.get("size", len(pdf_bytes)), sale_id)
        url = f"/api/files/{stored}"
        await db.sales.update_one({"id": sale_id}, {"$set": {campo: url}})
        out[fmt] = {"url": url, "path": stored, "regenerado": True}
    return out
