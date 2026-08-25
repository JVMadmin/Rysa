"""Tests de seguridad de la Fase de Remediación (Grupo RYSA ERP).

Requieren:
- un servidor corriendo el código actualizado (uvicorn), apuntado por
  REACT_APP_BACKEND_URL (por defecto http://localhost:8030);
- acceso de solo-tests a PostgreSQL (lee DATABASE_URL de backend/.env para
  limpiar el estado del rate limiter y los usuarios de prueba).

NUNCA deben usarse aquí credenciales de producción.
"""
import io
import os
import time
import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

load_dotenv(BACKEND_DIR / ".env", override=False)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8030").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "testadmin@rysa-dev.com")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "TestAdmin_Rysa_2026_Dev")

SEC_PW = "SecUser_Rysa_2026_Dev"
SEC_EMAIL = "secuser@rysa-dev.com"
LOCK_PW = "LockUser_Rysa_2026_Dev"
LOCK_EMAIL = "lockuser@rysa-dev.com"
PAS_EMAIL = "pasuser@rysa-dev.com"
D_EMAIL = "disabled@rysa-dev.com"

TEST_USERS = [SEC_EMAIL, LOCK_EMAIL, PAS_EMAIL, D_EMAIL]


def _pgdb():
    from pgstore.adapter import PGDatabase
    return PGDatabase()


def _pg_run(coro_builder):
    """Ejecuta una o más operaciones async de limpieza en un loop aislado y
    cierra el engine al terminar (evita reutilizar conexiones entre loops)."""
    async def _main():
        await coro_builder()
        import pgstore
        await pgstore.dispose()
    asyncio.run(_main())


def _clear_login_and_test_users():
    async def _work():
        db = _pgdb()
        await db.login_attempts.delete_many({})
        for e in TEST_USERS:
            await db.users.delete_many({"email": e})
    _pg_run(_work)


def _clear_login_attempts():
    async def _work():
        db = _pgdb()
        await db.login_attempts.delete_many({})
    _pg_run(_work)


def _delete_login(key):
    async def _work():
        db = _pgdb()
        await db.login_attempts.delete_one({"_id": key})
    _pg_run(_work)


def _jwt_secret():
    vals = {k: v for k, v in [l.split("=", 1) for l in (BACKEND_DIR / ".env").read_text(encoding="utf-8").splitlines() if "=" in l and not l.strip().startswith("#")]}
    return vals.get("JWT_SECRET")


def _admin_login():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=25)
    assert r.status_code == 200, f"login admin: {r.status_code} {r.text}"
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _login(email, password):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=25)


def _login_session(email, password):
    """Login con sesión y reintento puntual (los fallos espurios de Atlas/CI son raros)."""
    s = requests.Session()
    last = None
    for _ in range(2):
        last = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=25)
        if last.status_code == 200:
            return s, last
        time.sleep(0.3)
    return s, last


def _ensure_user(headers, email, password):
    r = requests.post(f"{API}/users",
                      json={"email": email, "name": "Seguridad Test", "password": password,
                            "role": "vendedor"},
                      headers=headers, timeout=25)
    if r.status_code == 400:
        return None
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def admin_headers():
    _clear_login_and_test_users()
    yield _admin_login()
    _clear_login_and_test_users()


class TestAuthBasics:
    def test_login_ok_sets_http_cookies(self):
        s, r = _login_session(ADMIN_EMAIL, ADMIN_PASSWORD)
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and "user" in data
        assert "password_hash" not in str(data)
        jar = r.cookies.get_dict()
        assert "access_token" in jar and "refresh_token" in jar
        r2 = s.get(f"{API}/auth/me", timeout=25)
        assert r2.status_code == 200
        assert r2.json()["user"]["email"] == ADMIN_EMAIL

    def test_login_bad_password_401(self):
        r = _login(ADMIN_EMAIL, "Definitivamente_incorrecta_1")
        assert r.status_code == 401

    def test_me_requires_auth(self):
        assert requests.get(f"{API}/auth/me", timeout=25).status_code == 401

    def test_expired_access_token_401(self):
        secret = _jwt_secret()
        assert secret, "no se pudo leer JWT_SECRET de backend/.env"
        import jwt as pyjwt
        me = requests.get(f"{API}/auth/me", headers=_admin_login(), timeout=25).json()
        uid = me["user"]["id"]
        now = datetime.now(timezone.utc)
        tok = pyjwt.encode({
            "sub": uid, "email": ADMIN_EMAIL, "jti": "expired-test",
            "iat": now - timedelta(hours=3), "exp": now - timedelta(minutes=1),
            "type": "access", "token_version": 0,
        }, secret, algorithm="HS256")
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=25)
        assert r.status_code == 401

    def test_logout_revokes_refresh(self, admin_headers):
        s = requests.Session()
        r = s.post(f"{API}/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=25)
        assert r.status_code == 200
        assert s.post(f"{API}/auth/logout", timeout=25).status_code == 200
        r2 = s.post(f"{API}/auth/refresh", timeout=25)
        assert r2.status_code == 401, "el refresh token debería estar revocado tras logout"


class TestAuthorization:
    def test_no_permission_403(self, admin_headers):
        _ensure_user(admin_headers, SEC_EMAIL, SEC_PW)
        s, r = _login_session(SEC_EMAIL, SEC_PW)
        assert r.status_code == 200, r.text
        tok = r.json()["token"]
        rh = {"Authorization": f"Bearer {tok}"}
        assert s.get(f"{API}/users", headers=rh).status_code == 403
        assert s.get(f"{API}/dev/info", headers=rh).status_code == 403
        assert s.get(f"{API}/products", headers=rh).status_code == 200


class TestMassAssignment:
    def test_product_rejects_admin_fields(self, admin_headers):
        payload = {
            "descripcion": "TEST_SEC_Mass",
            "costo": 1.5,
            "id": "attacker-id",
            "created_at": "2000-01-01",
            "updated_at": "hack",
            "role": "admin",
            "password_hash": "x",
        }
        r = requests.post(f"{API}/products", json=payload, headers=admin_headers, timeout=25)
        assert r.status_code == 422, "campos arbitrarios deben rechazarse (mass assignment)"

    def test_product_legacy_fields_roundtrip(self, admin_headers):
        payload = {
            "descripcion": "TEST_SEC_Legacy",
            "codigo": "SECLEG001",
            "descrip": "Desc legacy",
            "utilpreci1": "30",
            "precio1": "12.5",
            "status": "A",
            "inventario": True,
            "costo": 1.0,
            "precios": [],
        }
        r = requests.post(f"{API}/products", json=payload, headers=admin_headers, timeout=25)
        assert r.status_code in (200, 400), r.text


class TestSessionInvalidation:
    def test_short_password_rejected(self, admin_headers):
        r = requests.post(f"{API}/users",
                          json={"email": "short@rysa-dev.com", "name": "x",
                                "password": "short", "role": "vendedor"},
                          headers=admin_headers, timeout=25)
        assert r.status_code == 400

    def test_password_change_invalidates_old_token(self, admin_headers):
        _ensure_user(admin_headers, PAS_EMAIL, SEC_PW)
        s, r = _login_session(PAS_EMAIL, SEC_PW)
        assert r.status_code == 200, r.text
        old_me = s.get(f"{API}/auth/me", timeout=25)
        assert old_me.status_code == 200, old_me.text
        target = requests.get(f"{API}/users", headers=admin_headers, timeout=25).json()
        target_id = next(u["id"] for u in target if u["email"] == PAS_EMAIL)
        r2 = requests.put(f"{API}/users/{target_id}",
                          json={"password": "OtraClave_Segura_2026_Dev"}, headers=admin_headers, timeout=25)
        assert r2.status_code == 200, r2.text
        r3 = s.get(f"{API}/auth/me", timeout=25)
        assert r3.status_code in (401, 403), "el token previo debió quedar inválido"

    def test_disabled_user_blocked(self, admin_headers):
        _ensure_user(admin_headers, D_EMAIL, SEC_PW)
        s, r = _login_session(D_EMAIL, SEC_PW)
        assert r.status_code == 200, r.text
        users = requests.get(f"{API}/users", headers=admin_headers, timeout=25).json()
        tid = next(u["id"] for u in users if u["email"] == D_EMAIL)
        assert requests.put(f"{API}/users/{tid}", json={"active": False},
                            headers=admin_headers, timeout=25).status_code == 200
        r3 = s.get(f"{API}/auth/me", timeout=25)
        assert r3.status_code in (401, 403), "usuario desactivado no debe poder usar su sesión"


class TestFiles:
    def test_path_traversal_rejected(self):
        for path in ("uploads/../../server.py", "../../etc/passwd", "..%2F..%2Fetc%2Fpasswd"):
            r = requests.get(f"{API}/files/{path}", timeout=25, allow_redirects=False)
            assert r.status_code in (400, 403, 404), f"path {path} -> {r.status_code}"

    def test_absolute_path_rejected(self):
        r = requests.get(f"{API}/files//etc/passwd", timeout=25, allow_redirects=False)
        assert r.status_code in (400, 403, 404)

    def test_unknown_file_404(self):
        r = requests.get(f"{API}/files/uploads/00000000000000000000000000000000.jpg", timeout=25)
        assert r.status_code == 404

    def test_upload_invalid_mime_rejected(self, admin_headers):
        r = requests.post(f"{API}/uploads/image", headers=admin_headers,
                          files={"file": ("notanimage.txt", io.BytesIO(b"hola texto plano"), "text/plain")},
                          timeout=25)
        assert r.status_code == 400


class TestSearchAndRegex:
    def test_regex_metacharacters_literal(self, admin_headers):
        for q in ("TEST_*()[{}?^$|\\", "x" * 500, "vaso.{}()*+?^$+"):
            r = requests.get(f"{API}/products", params={"q": q}, headers=admin_headers, timeout=25)
            assert r.status_code == 200, q


class TestRateLimit:
    def test_ip_window_and_user_lockout(self, admin_headers):
        _ensure_user(admin_headers, LOCK_EMAIL, LOCK_PW)
        _clear_login_attempts()
        s = requests.Session()
        got_429 = False
        for _ in range(20):
            r = s.post(f"{API}/auth/login",
                       json={"email": LOCK_EMAIL, "password": "clave_incorrecta_X"}, timeout=25)
            if r.status_code == 429:
                got_429 = True
                break
            time.sleep(0.05)
        assert got_429, "el rate limit nunca devolvió 429 (ventana por IP)"

        # Lockout independiente del IP: quitar solo el contador IP, el usuario sigue bloqueado.
        _delete_login("ip:127.0.0.1")
        r = s.post(f"{API}/auth/login", json={"email": LOCK_EMAIL, "password": LOCK_PW}, timeout=25)
        assert r.status_code == 429, "debió quedar bloqueado temporalmente el usuario"

        # Al limpiar los contadores se restaura el acceso (verificación del
        # mecanismo de liberación de bloqueo).
        _clear_login_attempts()
        _ensure_user(admin_headers, LOCK_EMAIL, LOCK_PW)
        r = s.post(f"{API}/auth/login", json={"email": LOCK_EMAIL, "password": LOCK_PW}, timeout=25)
        assert r.status_code == 200, f"login tras desbloqueo: {r.status_code} {r.text[:120]}"


class TestSecretExposure:
    def test_password_hash_never_returned(self, admin_headers):
        me = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=25).json()
        assert "password_hash" not in str(me)
        users = requests.get(f"{API}/users", headers=admin_headers, timeout=25)
        assert users.status_code == 200
        assert "password_hash" not in users.text


class TestFrontendSessionStorage:
    def test_no_token_in_localstorage(self):
        ctx = (REPO_ROOT / "frontend" / "src" / "context" / "AuthContext.jsx").read_text(encoding="utf-8")
        apijs = (REPO_ROOT / "frontend" / "src" / "lib" / "api.js").read_text(encoding="utf-8")
        for blob in (ctx, apijs):
            assert "localStorage" not in blob
            assert "rysa_token" not in blob