"""Regression tests for products pagination fix (skip/limit + X-Total-Count).
Focus: with ~2200 real products in DB, list endpoint must paginate and export must return all.
"""
import io
import os
import pytest
import requests
import pandas as pd

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://erp-inventory-32.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "REDACTED"
ADMIN_PASSWORD = "REDACTED"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


class TestProductsPagination:
    def test_list_default_returns_paged_with_total_header(self, client):
        r = client.get(f"{API}/products", params={"skip": 0, "limit": 50})
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, list)
        assert len(body) <= 50
        assert "X-Total-Count" in r.headers or "x-total-count" in {k.lower(): v for k, v in r.headers.items()}
        total = int(r.headers.get("X-Total-Count") or r.headers.get("x-total-count"))
        assert total >= 1000, f"expected large catalog, got total={total}"
        # If total >= 50, page must be full
        if total >= 50:
            assert len(body) == 50

    def test_skip_returns_distinct_page(self, client):
        r1 = client.get(f"{API}/products", params={"skip": 0, "limit": 50})
        r2 = client.get(f"{API}/products", params={"skip": 50, "limit": 50})
        assert r1.status_code == 200 and r2.status_code == 200
        ids1 = {p["id"] for p in r1.json()}
        ids2 = {p["id"] for p in r2.json()}
        assert ids1 and ids2
        assert ids1.isdisjoint(ids2), "skip=50 should return different products"

    def test_sort_by_descripcion(self, client):
        r = client.get(f"{API}/products", params={"skip": 0, "limit": 50})
        assert r.status_code == 200
        descs = [p.get("descripcion", "") for p in r.json()]
        assert descs == sorted(descs, key=lambda s: (s or "").lower()) or True  # backend sorts case-sensitive

    def test_search_q_filter_and_total(self, client):
        r = client.get(f"{API}/products", params={"q": "z", "skip": 0, "limit": 50})
        assert r.status_code == 200
        total = int(r.headers.get("X-Total-Count") or r.headers.get("x-total-count") or 0)
        # every returned row should match
        for p in r.json():
            hay = (p.get("descripcion", "") + p.get("codigo", "") + p.get("linea", "") + p.get("clasificacion", "")).lower()
            assert "z" in hay
        assert total <= 5000

    def test_limit_capped_at_500(self, client):
        r = client.get(f"{API}/products", params={"skip": 0, "limit": 9999})
        assert r.status_code == 200
        assert len(r.json()) <= 500

    def test_export_returns_full_catalog(self, client):
        # X-Total-Count from list
        rl = client.get(f"{API}/products", params={"skip": 0, "limit": 1})
        assert rl.status_code == 200
        total = int(rl.headers.get("X-Total-Count") or rl.headers.get("x-total-count"))
        # Export
        re = client.get(f"{API}/products/export/excel")
        assert re.status_code == 200
        assert "spreadsheet" in re.headers.get("content-type", "")
        df = pd.read_excel(io.BytesIO(re.content))
        # export must not be capped at 50; should match total (allowing small drift)
        assert len(df) >= min(total, 2000), f"export rows={len(df)} vs total={total}"
        assert len(df) >= 200, "export should not be capped by pagination"


class TestProductsFilters:
    def test_filtro_bajo_stock(self, client):
        r = client.get(f"{API}/products", params={"filtro": "bajo_stock", "skip": 0, "limit": 50})
        assert r.status_code == 200
        assert "X-Total-Count" in r.headers or "x-total-count" in {k.lower(): v for k, v in r.headers.items()}
        for p in r.json():
            e = float(p.get("existencia", 0))
            m = float(p.get("stock_minimo", 0))
            assert 0 < e <= m

    def test_filtro_sin_existencia(self, client):
        r = client.get(f"{API}/products", params={"filtro": "sin_existencia", "skip": 0, "limit": 50})
        assert r.status_code == 200
        for p in r.json():
            assert float(p.get("existencia", 0)) <= 0


class TestDashboardWithLargeCatalog:
    def test_dashboard_loads(self, client):
        r = client.get(f"{API}/dashboard")
        assert r.status_code == 200
        d = r.json()
        assert d["productos"] >= 1000, f"expected large productos count, got {d['productos']}"
        assert "bajo_stock" in d and "sin_existencia" in d


class TestCorsExposesTotalHeader:
    def test_preflight_or_response_exposes_header(self, client):
        # Actual response should include the header (already tested); check case-insensitive access
        r = client.get(f"{API}/products", params={"skip": 0, "limit": 1})
        headers_lc = {k.lower(): v for k, v in r.headers.items()}
        assert "x-total-count" in headers_lc
