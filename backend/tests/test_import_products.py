"""Tests for the product import fix (.xls/.xlsx/.csv robust reader)."""
import io
import os
import asyncio
from pathlib import Path
import pytest
import requests
import xlwt
from openpyxl import Workbook
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env", override=False)

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
ADMIN = {"email": os.environ.get("TEST_ADMIN_EMAIL", "testadmin@rysa-dev.com"),
         "password": os.environ.get("TEST_ADMIN_PASSWORD", "TestAdmin_Rysa_2026_Dev")}

HEADERS = ["CODIGO", "DESCRIP", "COSTO", "EXISTENCIA", "IMPUESTO", "STATUS", "UTILPRECI1", "LINEA"]
ROWS = [
    ["TESTXLS001", "Producto XLS test", "10", "5", "16", "A", "50", "Plasticos"],
    ["TESTXLS002", "Otro producto XLS", "2.5", "30", "16", "A", "40", "Desechables"],
]
ROWS_XLSX = [
    ["TESTXLSX001", "Producto XLSX", "12", "7", "16", "A", "45", "Plasticos"],
]
ROWS_CSV = [
    ["TESTCSV001", "Producto CSV", "8", "4", "16", "A", "35", "Plasticos"],
]

CREATED_CODES = [r[0] for r in ROWS + ROWS_XLSX + ROWS_CSV]


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}"}


def _xls_bytes(rows):
    wb = xlwt.Workbook()
    ws = wb.add_sheet("Datos")
    for c, h in enumerate(HEADERS):
        ws.write(0, c, h)
    for r_i, row in enumerate(rows, start=1):
        for c, v in enumerate(row):
            ws.write(r_i, c, v)
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def _xlsx_bytes(rows):
    wb = Workbook()
    ws = wb.active
    ws.append(HEADERS)
    for row in rows:
        ws.append(row)
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def _csv_bytes(rows):
    lines = [",".join(HEADERS)]
    for r in rows:
        lines.append(",".join(str(x) for x in r))
    return "\n".join(lines).encode("utf-8")


def test_import_preview_xls(H):
    """MAIN BUG FIX: legacy BIFF .xls must be readable."""
    r = requests.post(
        f"{BASE}/products/import/preview",
        headers=H,
        files={"file": ("catalogo.xls", _xls_bytes(ROWS), "application/vnd.ms-excel")},
        timeout=30,
    )
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:500]}"
    d = r.json()
    assert d["total"] == 2
    assert d["con_errores"] == 0
    assert "preview" in d and len(d["preview"]) == 2
    codes = [row.get("codigo") for row in d["preview"]]
    assert "TESTXLS001" in codes and "TESTXLS002" in codes


def test_import_confirm_xls(H):
    """Confirm with mode='ambos' persists products with stock and computed price."""
    prev = requests.post(
        f"{BASE}/products/import/preview",
        headers=H,
        files={"file": ("catalogo.xls", _xls_bytes(ROWS))},
        timeout=30,
    ).json()
    r = requests.post(
        f"{BASE}/products/import/confirm",
        headers=H,
        json={"rows": prev["preview"], "mode": "ambos", "actualizar_existencia": True},
        timeout=60,
    )
    assert r.status_code == 200, r.text[:500]
    cf = r.json()
    assert cf.get("creados", 0) >= 2, f"expected 2 created, got {cf}"

    # Verify persistence
    q = requests.get(f"{BASE}/products", headers=H, params={"q": "TESTXLS001"}, timeout=15).json()
    assert q and any(p["codigo"] == "TESTXLS001" for p in q)
    p = [x for x in q if x["codigo"] == "TESTXLS001"][0]
    assert float(p.get("existencia", 0)) == 5.0
    assert p.get("precios") and float(p["precios"][0]["precio_con_iva"]) > 0


def test_import_xls_no_duplicate_on_reimport(H):
    """Re-importing same .xls with mode='nuevos' must NOT duplicate (CODIGO unique)."""
    prev = requests.post(
        f"{BASE}/products/import/preview",
        headers=H,
        files={"file": ("catalogo.xls", _xls_bytes(ROWS))},
        timeout=30,
    ).json()
    assert prev["existentes"] >= 2, f"expected 2 existentes on re-preview, got {prev}"

    r = requests.post(
        f"{BASE}/products/import/confirm",
        headers=H,
        json={"rows": prev["preview"], "mode": "nuevos", "actualizar_existencia": False},
        timeout=30,
    )
    assert r.status_code == 200
    cf = r.json()
    assert cf.get("creados", 0) == 0
    assert cf.get("omitidos", 0) >= 2, f"expected omitidos>=2, got {cf}"


def test_import_preview_xlsx(H):
    """Regression: .xlsx still works."""
    r = requests.post(
        f"{BASE}/products/import/preview",
        headers=H,
        files={"file": ("catalogo.xlsx", _xlsx_bytes(ROWS_XLSX),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        timeout=30,
    )
    assert r.status_code == 200, r.text[:500]
    d = r.json()
    assert d["total"] == 1
    codes = [row.get("codigo") for row in d["preview"]]
    assert "TESTXLSX001" in codes
    # Confirm it also creates
    cf = requests.post(
        f"{BASE}/products/import/confirm",
        headers=H,
        json={"rows": d["preview"], "mode": "ambos", "actualizar_existencia": True},
        timeout=30,
    ).json()
    assert cf.get("creados", 0) >= 1


def test_import_preview_csv(H):
    r = requests.post(
        f"{BASE}/products/import/preview",
        headers=H,
        files={"file": ("catalogo.csv", _csv_bytes(ROWS_CSV), "text/csv")},
        timeout=30,
    )
    assert r.status_code == 200, r.text[:500]
    d = r.json()
    assert d["total"] == 1
    codes = [row.get("codigo") for row in d["preview"]]
    assert "TESTCSV001" in codes


def test_import_unsupported_returns_400(H):
    """Corrupt/unsupported file must not 500. Ideally returns 400 with clear message."""
    bad = b"this is not an excel file at all just garbage bytes \x00\x01\x02"
    r = requests.post(
        f"{BASE}/products/import/preview",
        headers=H,
        files={"file": ("archivo.xls", bad, "application/vnd.ms-excel")},
        timeout=30,
    )
    # Must NOT be 500
    assert r.status_code != 500, f"got 500: {r.text[:300]}"
    if r.status_code == 400:
        assert r.json().get("detail"), "expected 'detail' error message"
    else:
        # Fallback: 200 with empty preview is acceptable (though 400 preferred)
        assert r.status_code == 200
        d = r.json()
        assert d.get("total", 0) == 0, f"garbage file yielded rows: {d}"


def test_cleanup(H):
    """Remove test products, inventory movements. Keep admin + PUBLICO client."""
    import asyncio
    async def _clean():
        from pgstore.adapter import PGDatabase
        db = PGDatabase()
        prod_res = await db.products.delete_many({"codigo": {"$in": CREATED_CODES}})
        inv_res = await db.inventory_movements.delete_many({"codigo": {"$in": CREATED_CODES}})
        remaining = await db.products.find({"codigo": {"$in": CREATED_CODES}}).to_list(1000)
        import pgstore
        await pgstore.dispose()
        return prod_res, inv_res, len(remaining)
    prod_res, inv_res, found = asyncio.run(_clean())
    print(f"Cleanup: deleted {prod_res} products, {inv_res} inv movements, found after: {found}")
    assert found == 0
