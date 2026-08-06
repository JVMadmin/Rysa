"""Iteration 6 backend tests:
- POST /api/uploads/image + GET /api/files/{path} (no token)
- Product with codigos_barras, search by barcode, update persists
- Create sale + ticket-pdf + serve pdf
- Settings logo_url + ticket_config round trip
"""
import io
import os
import struct
import zlib
import pytest
import requests

def _load_base_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    except Exception:
        pass
    return "http://localhost:8001"

BASE_URL = _load_base_url()
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "REDACTED")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "REDACTED")


def _make_png_bytes(w=2, h=2):
    """Build a valid 2x2 PNG in-memory (no external libs)."""
    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # RGB
    raw = b""
    for _ in range(h):
        raw += b"\x00" + b"\xff\x00\x00" * w  # filter=0, red pixels
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text[:200]}"
    token = r.json()["token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def created():
    return {}


# --- 1. Upload image + public serve ---
def test_upload_image_and_public_serve(api, created):
    files = {"file": ("test.png", _make_png_bytes(), "image/png")}
    r = api.post(f"{BASE_URL}/api/uploads/image", files=files, timeout=60)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert "path" in data and "url" in data
    assert data["url"].startswith("/api/files/")
    created["image_url"] = data["url"]

    # Fetch without auth
    plain = requests.get(f"{BASE_URL}{data['url']}", timeout=30)
    assert plain.status_code == 200, plain.text[:200]
    assert plain.headers.get("content-type", "").startswith("image/"), plain.headers.get("content-type")
    assert len(plain.content) > 20


# --- 2. Product with codigos_barras: create, search, update ---
BARCODE = "7501234567890"
BARCODE_ALT = "7509999999999"


def test_product_with_barcodes_crud_search(api, created):
    payload = {
        "codigo": f"TEST-BC-{os.urandom(3).hex().upper()}",
        "descripcion": "TEST barcode product iter6",
        "unidad_medida": "PZA",
        "costo": 10.0,
        "existencia": 100.0,
        "iva_tasa": 16.0,
        "precios": [{"lista": 1, "precio_sin_iva": 20.0, "precio_con_iva": 23.2}],
        "codigos_barras": [BARCODE],
    }
    r = api.post(f"{BASE_URL}/api/products", json=payload, timeout=30)
    assert r.status_code == 200, r.text[:300]
    prod = r.json()
    assert BARCODE in prod.get("codigos_barras", [])
    created["product_id"] = prod["id"]
    created["product_codigo"] = prod["codigo"]

    # Search by barcode
    r2 = api.get(f"{BASE_URL}/api/products", params={"q": BARCODE}, timeout=30)
    assert r2.status_code == 200
    body = r2.json()
    items = body.get("items", body) if isinstance(body, dict) else body
    found_ids = [p["id"] for p in items]
    assert prod["id"] in found_ids, f"Product not found by barcode search. Got {found_ids}"

    # Update barcodes and persist
    payload["codigos_barras"] = [BARCODE, BARCODE_ALT]
    r3 = api.put(f"{BASE_URL}/api/products/{prod['id']}", json=payload, timeout=30)
    assert r3.status_code == 200, r3.text[:300]
    updated = r3.json()
    assert set(updated["codigos_barras"]) == {BARCODE, BARCODE_ALT}

    # GET again to verify persistence
    r4 = api.get(f"{BASE_URL}/api/products/{prod['id']}", timeout=30)
    assert r4.status_code == 200
    assert set(r4.json()["codigos_barras"]) == {BARCODE, BARCODE_ALT}


# --- 3. Settings logo_url + ticket_config round-trip ---
def test_settings_ticket_config_roundtrip(api, created):
    r_prev = api.get(f"{BASE_URL}/api/settings", timeout=30)
    assert r_prev.status_code == 200
    prev = r_prev.json()

    new_cfg = {
        **{k: v for k, v in prev.items() if k not in ("_id",)},
        "logo_url": created.get("image_url", "/api/files/dummy.png"),
        "ticket_config": {
            "tamano": "carta",
            "mostrar_rfc": False,
            "encabezado": "ENCABEZADO_TEST_ITER6",
            "pie": "PIE_TEST_ITER6",
        },
    }
    # SettingsInput doesn't accept _id or sucursales-as-dicts issue; only send fields it expects
    payload = {
        "empresa_nombre": prev.get("empresa_nombre", "Grupo RYSA"),
        "rfc": prev.get("rfc", ""),
        "telefono": prev.get("telefono", ""),
        "correo": prev.get("correo", ""),
        "direccion": prev.get("direccion", ""),
        "ciudad": prev.get("ciudad", ""),
        "estado": prev.get("estado", ""),
        "cp": prev.get("cp", ""),
        "iva_tasa": prev.get("iva_tasa", 16.0),
        "moneda": prev.get("moneda", "MXN"),
        "precios_incluyen_iva": prev.get("precios_incluyen_iva", True),
        "listas_precios_nombres": prev.get("listas_precios_nombres", ["Precio 1","Precio 2","Precio 3","Precio 4","Precio 5"]),
        "listas_precios_pct": prev.get("listas_precios_pct", [40,30,20,15,10]),
        "logo_url": new_cfg["logo_url"],
        "ticket_config": new_cfg["ticket_config"],
        "sucursales": prev.get("sucursales", []),
    }
    r = api.put(f"{BASE_URL}/api/settings", json=payload, timeout=30)
    assert r.status_code == 200, r.text[:300]

    r2 = api.get(f"{BASE_URL}/api/settings", timeout=30)
    assert r2.status_code == 200
    got = r2.json()
    assert got.get("logo_url") == payload["logo_url"]
    tc = got.get("ticket_config") or {}
    assert tc.get("tamano") == "carta"
    assert tc.get("mostrar_rfc") is False
    assert tc.get("encabezado") == "ENCABEZADO_TEST_ITER6"
    assert tc.get("pie") == "PIE_TEST_ITER6"


# --- 4. Create sale with Público General + ticket PDF ---
def test_create_sale_and_ticket_pdf(api, created):
    pid = created.get("product_id")
    assert pid, "no product created earlier"
    # get product to obtain precio con iva
    r = api.get(f"{BASE_URL}/api/products/{pid}", timeout=30)
    p = r.json()
    precio = 23.2
    for pr in p.get("precios", []):
        if pr.get("lista") == 1:
            precio = pr.get("precio_con_iva") or precio
            break
    sale_payload = {
        "cliente_id": None,
        "items": [{
            "product_id": pid,
            "codigo": p["codigo"],
            "descripcion": p["descripcion"],
            "cantidad": 1,
            "unidad": "PZA",
            "precio": precio,
            "iva_tasa": 16.0,
            "descuento": 0.0,
        }],
        "descuento_global": 0.0,
        "condicion": "contado",
        "pagos": [{"metodo": "efectivo", "monto": precio}],
        "lista_precios": 1,
        "tipo_venta": "directa",
    }
    r_sale = api.post(f"{BASE_URL}/api/sales", json=sale_payload, timeout=60)
    assert r_sale.status_code == 200, r_sale.text[:400]
    sale = r_sale.json()
    assert sale.get("id")
    created["sale_id"] = sale["id"]

    # Ticket PDF
    r_pdf = api.post(f"{BASE_URL}/api/sales/{sale['id']}/ticket-pdf", timeout=60)
    assert r_pdf.status_code == 200, r_pdf.text[:300]
    body = r_pdf.json()
    assert body.get("url", "").startswith("/api/files/")

    # Fetch pdf (no token required per spec, but include anyway)
    plain = requests.get(f"{BASE_URL}{body['url']}", timeout=30)
    assert plain.status_code == 200
    assert plain.headers.get("content-type", "").startswith("application/pdf")
    assert plain.content[:4] == b"%PDF"
