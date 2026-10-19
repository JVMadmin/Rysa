"""Tests for client import saldo behavior (bug fix: SALDO not persisted on import)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback read
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")

ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "testadmin@rysa-dev.com")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "TestAdmin_Rysa_2026_Dev")

# Código único por corrida para no colisionar con artefactos de ejecuciones previas.
TEST_CODE = "QAIMP" + uuid.uuid4().hex[:8].upper()


@pytest.fixture(scope="module")
def auth_client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    token = r.json().get("token")
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    yield s
    # cleanup
    try:
        # find client
        res = s.get(f"{BASE_URL}/api/clients", params={"q": TEST_CODE}, timeout=10)
        for c in res.json() if res.status_code == 200 else []:
            if c.get("codigo") == TEST_CODE:
                s.delete(f"{BASE_URL}/api/clients/{c['id']}", timeout=10)
    except Exception as e:
        print("cleanup err", e)


def _find_client(s, code):
    r = s.get(f"{BASE_URL}/api/clients", params={"q": code}, timeout=10)
    assert r.status_code == 200
    for c in r.json():
        if c.get("codigo") == code:
            return c
    return None


def _payload(code, nombre, saldo, actualizar_saldo=False, mode="ambos"):
    return {
        "mode": mode,
        "actualizar_saldo": actualizar_saldo,
        "rows": [{
            "fila": 2, "clave": code, "nombre": nombre,
            "accion": "crear", "existe": False, "errores": [],
            "data": {"codigo": code, "nombre": nombre, "saldo": saldo}
        }]
    }


def test_1_create_new_client_with_saldo(auth_client):
    # pre-cleanup
    existing = _find_client(auth_client, TEST_CODE)
    if existing:
        auth_client.delete(f"{BASE_URL}/api/clients/{existing['id']}", timeout=10)

    r = auth_client.post(f"{BASE_URL}/api/clients/import/confirm",
                         json=_payload(TEST_CODE, "QA Import Test", 300.0), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["creados"] == 1, data
    c = _find_client(auth_client, TEST_CODE)
    assert c is not None
    assert float(c.get("saldo", 0)) == 300.0, f"saldo esperado 300, got {c.get('saldo')}"


def test_2_update_existing_without_actualizar_saldo_keeps_saldo(auth_client):
    r = auth_client.post(f"{BASE_URL}/api/clients/import/confirm",
                         json=_payload(TEST_CODE, "QA Import Test v2", 555.0, actualizar_saldo=False), timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["actualizados"] == 1
    c = _find_client(auth_client, TEST_CODE)
    assert float(c.get("saldo", 0)) == 300.0, f"saldo debio mantenerse 300, got {c.get('saldo')}"
    assert c.get("nombre") == "QA Import Test v2"  # other fields updated


def test_3_update_existing_with_actualizar_saldo_updates(auth_client):
    r = auth_client.post(f"{BASE_URL}/api/clients/import/confirm",
                         json=_payload(TEST_CODE, "QA Import Test v3", 999.0, actualizar_saldo=True), timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["actualizados"] == 1
    c = _find_client(auth_client, TEST_CODE)
    assert float(c.get("saldo", 0)) == 999.0, f"saldo debio ser 999, got {c.get('saldo')}"
