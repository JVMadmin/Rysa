"""Iteration 7 backend tests: Recargas de celular (POST /api/recargas, ticket-pdf, sales list)."""
import os
import re
import pytest
import requests
from pathlib import Path


def _load_base_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        env = Path("/app/frontend/.env").read_text()
        m = re.search(r"REACT_APP_BACKEND_URL=(\S+)", env)
        return (m.group(1) if m else "http://localhost:8000").rstrip("/")
    except Exception:
        return "http://localhost:8000"


BASE_URL = _load_base_url()
ADMIN = {"email": os.environ.get("TEST_ADMIN_EMAIL", "testadmin@rysa-dev.com"),
         "password": os.environ.get("TEST_ADMIN_PASSWORD", "TestAdmin_Rysa_2026_Dev")}


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def recarga(client):
    """Crea una recarga y la devuelve (autocontenida por worker de xdist)."""
    payload = {"compania": "Telcel", "telefono": "5544332211", "monto": 20,
               "metodo": "efectivo", "referencia_tae": "QA-REF-FIX", "comision": 2}
    r = client.post(f"{BASE_URL}/api/recargas", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------- POST /api/recargas ----------------
class TestRecargaCreate:
    def test_crear_recarga_ok(self, client):
        payload = {"compania": "Telcel", "telefono": "5544332211", "monto": 20,
                   "metodo": "efectivo", "referencia_tae": "QA-REF-001", "comision": 2}
        r = client.post(f"{BASE_URL}/api/recargas", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["tipo_venta"] == "recarga"
        assert data["total"] == 20
        assert data["estado"] == "confirmada"
        assert data["compania"] == "Telcel"
        assert data["telefono"] == "5544332211"
        assert data["referencia_tae"] == "QA-REF-001"
        assert data["comision"] == 2
        assert data["folio"].startswith("R")
        assert len(data["folio"]) == 7  # R + 6 dígitos
        pytest.recarga_id = data["id"]
        pytest.recarga_folio = data["folio"]

    def test_monto_cero_400(self, client):
        r = client.post(f"{BASE_URL}/api/recargas",
                        json={"compania": "Telcel", "telefono": "5544332211", "monto": 0,
                              "metodo": "efectivo", "referencia_tae": "QA-BAD-1"})
        assert r.status_code == 400

    def test_monto_negativo_400(self, client):
        r = client.post(f"{BASE_URL}/api/recargas",
                        json={"compania": "Telcel", "telefono": "5544332211", "monto": -5,
                              "metodo": "efectivo", "referencia_tae": "QA-BAD-2"})
        assert r.status_code == 400

    def test_telefono_vacio_400(self, client):
        r = client.post(f"{BASE_URL}/api/recargas",
                        json={"compania": "Telcel", "telefono": "   ", "monto": 20,
                              "metodo": "efectivo", "referencia_tae": "QA-BAD-3"})
        assert r.status_code == 400


# ---------------- GET /api/sales?rango=hoy ----------------
class TestRecargaInSales:
    def test_recarga_aparece_en_hoy(self, client, recarga):
        r = client.get(f"{BASE_URL}/api/sales", params={"rango": "hoy"})
        assert r.status_code == 200
        sales = r.json()
        recargas = [s for s in sales if s.get("tipo_venta") == "recarga"]
        assert any(s["id"] == recarga["id"] for s in recargas), \
            f"Recarga {recarga['folio']} no aparece en rango=hoy"


# ---------------- POST /api/sales/{id}/ticket-pdf ----------------
class TestTicketPdf:
    def test_ticket_pdf_devuelve_url(self, client, recarga):
        r = client.post(f"{BASE_URL}/api/sales/{recarga['id']}/ticket-pdf")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "url" in data and data["url"], data
        pytest.ticket_url = data["url"]

    def test_ticket_pdf_get_application_pdf(self, client):
        # url puede ser absoluta o path relativo
        url = pytest.ticket_url
        if not url.startswith("http"):
            url = f"{BASE_URL}{url}"
        r = requests.get(url, timeout=20)
        assert r.status_code == 200, r.text[:300]
        ctype = r.headers.get("content-type", "")
        assert "application/pdf" in ctype, f"content-type={ctype}"
        assert r.content[:4] == b"%PDF", r.content[:20]
