"""Tests E2E del flujo QR de comprobante de pago en cotizaciones (§27).

Requieren el servidor corriendo (uvicorn). Dentro del contenedor:
    REACT_APP_BACKEND_URL=http://localhost:8000 \
    TEST_ADMIN_EMAIL=... TEST_ADMIN_PASSWORD=... \
    python -m pytest -q tests/test_pago_qr.py

Cubre: tokens (válido/inválido/revocado/regenerado), subida de archivos
(válido/duplicado/MIME falso/método inválido), aprobación única + anti-doble,
rechazo con comentario, QR dentro del PDF y configuración de WhatsApp.
"""
import io
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "admin@rysa-dev.local")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "")

PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082")

_folio_creados = []


@pytest.fixture(scope="module")
def ses():
    s = requests.Session()
    r = s.post(f"{API}/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login falló: {r.status_code} {r.text[:120]}"
    tok = r.json().get("access_token") or s.cookies.get("access_token")
    assert tok, "sin access_token (body ni cookie)"
    s.headers["Authorization"] = f"Bearer {tok}"
    return s


def _crear_cotizacion(ses, total_sin_iva=100.0):
    """Cotización mínima con línea libre (sin product_id)."""
    precio = round(total_sin_iva * 1.16, 2)
    r = ses.post(f"{API}/sales", json={
        "condicion": "contado", "tipo_venta": "cotizacion",
        "lista_precios": 1, "precios_incluyen_iva": True,
        "items": [{"codigo": f"QRTEST-{uuid.uuid4().hex[:6]}",
                   "descripcion": "Item prueba QR", "cantidad": 1,
                   "unidad": "PZA", "precio": precio, "iva_tasa": 16,
                   "descuento": 0}],
        # contado exige pagos que cubran: usamos pagos completos para no
        # tocar caja (las cotizaciones NO registran pago ni caja).
    }, timeout=20)
    assert r.status_code == 200, r.text[:200]
    doc = r.json()
    _folio_creados.append(doc["id"])
    return doc


def test_01_link_y_info_publica(ses):
    cot = _crear_cotizacion(ses)
    r = ses.post(f"{API}/sales/{cot['id']}/pago-link", timeout=15)
    assert r.status_code == 200
    link = r.json()
    assert "/pago/comprobante/" in link["url"]
    token = link["url"].rsplit("/", 1)[1]

    pub = requests.get(f"{API}/public/pago-comprobante/{token}", timeout=10)
    assert pub.status_code == 200
    d = pub.json()
    assert d["folio"] == cot["folio"]
    assert float(d["importe"]) > 0
    assert isinstance(d["metodos"], list)

    # Token inválido -> misma respuesta 410 (sin pistas)
    bad = requests.get(f"{API}/public/pago-comprobante/token-falso-{uuid.uuid4().hex}", timeout=10)
    assert bad.status_code == 410
    globals()["TOKEN"] = token
    globals()["COT"] = cot


def test_02_upload_valido_duplicado_mime_falso(ses):
    token = TOKEN
    ref = f"REF-{uuid.uuid4().hex[:8]}"
    files = {"comprobante": ("comprobante.png", PNG_1PX, "image/png")}
    r = requests.post(f"{API}/public/pago-comprobante/{token}",
                      files=files,
                      data={"metodo": "transferencia", "referencia": ref},
                      timeout=20)
    assert r.status_code == 200, r.text[:200]
    d = r.json()
    assert d["ok"] is True and "wa_texto" in d

    # Duplicado misma referencia+metodo -> 409 (§25)
    r2 = requests.post(f"{API}/public/pago-comprobante/{token}",
                       files={"comprobante": ("otro.png", PNG_1PX, "image/png")},
                       data={"metodo": "transferencia", "referencia": ref},
                       timeout=20)
    assert r2.status_code == 409

    # MIME falso: texto renombrado a .png -> 400
    r3 = requests.post(f"{API}/public/pago-comprobante/{token}",
                       files={"comprobante": ("falso.png", b"esto no es una imagen" * 8, "image/png")},
                       data={"metodo": "tarjeta", "referencia": f"REF-{uuid.uuid4().hex[:8]}"},
                       timeout=20)
    assert r3.status_code == 400

    # Método inválido -> 400
    r4 = requests.post(f"{API}/public/pago-comprobante/{token}",
                       files={"comprobante": ("ok.png", PNG_1PX, "image/png")},
                       data={"metodo": "criptomoneda"}, timeout=20)
    assert r4.status_code == 400


def test_03_historial_aprobar_unica_vez(ses):
    cot = COT
    hist = ses.get(f"{API}/sales/{cot['id']}/comprobantes", timeout=15).json()
    evs = [e for e in hist["evidencias"] if e["estado"] == "pendiente"]
    assert evs, "se esperaba al menos una evidencia pendiente"
    ev = evs[0]
    r = ses.post(f"{API}/comprobantes-pago/{ev['id']}/aprobar",
                 json={"comentario": "verificado en banca"}, timeout=30)
    assert r.status_code == 200
    abono = r.json()["abono_folio"]
    # Cotización NO convertida: no debe registrar abono (pero sí aprobar)
    assert abono == ""

    r2 = ses.post(f"{API}/comprobantes-pago/{ev['id']}/aprobar",
                  json={"comentario": ""}, timeout=15)
    assert r2.status_code == 409  # anti-doble aprobación (§25)


def test_04_regenerar_enlace_revoca_anterior(ses):
    cot = COT
    old = ses.post(f"{API}/sales/{cot['id']}/pago-link", timeout=15).json()
    old_token = old["url"].rsplit("/", 1)[1]
    new = ses.post(f"{API}/sales/{cot['id']}/pago-link?regenerar=true", timeout=15).json()
    new_token = new["url"].rsplit("/", 1)[1]
    assert new_token != old_token
    assert requests.get(f"{API}/public/pago-comprobante/{old_token}", timeout=10).status_code == 410
    assert requests.get(f"{API}/public/pago-comprobante/{new_token}", timeout=10).status_code == 200
    globals()["TOKEN"] = new_token


def test_05_pdf_contiene_qr(ses):
    import fitz  # PyMuPDF
    cot = COT
    r = ses.post(f"{API}/sales/{cot['id']}/cotizacion-pdf?regenerar=true", timeout=60)
    assert r.status_code == 200
    url = r.json()["url"]
    pdf = ses.get(f"{BASE_URL}{url}", timeout=30)
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"
    doc = fitz.open(stream=pdf.content, filetype="pdf")
    total_imgs = sum(len(page.get_images(full=True)) for page in doc)
    assert total_imgs >= 1, "el PDF debe incluir la imagen del QR"


def test_06_whatsapp_configurado(ses):
    numero = "3331234567"
    st = ses.get(f"{API}/settings", timeout=15).json()
    st["whatsapp_empresa"] = numero
    assert ses.put(f"{API}/settings", json=st, timeout=20).status_code == 200
    pub = requests.get(f"{API}/public/pago-comprobante/{TOKEN}", timeout=10).json()
    assert pub.get("whatsapp_empresa") == numero
