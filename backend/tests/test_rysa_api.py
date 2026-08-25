"""End-to-end backend tests for Grupo RYSA ERP.
Covers: auth, users/RBAC, productos+inventario(kardex), clientes, caja,
POS (contado, credito, cancelacion, suspender), dashboard, excel, auditoria.
"""
import io
import os
import time
import pytest
import requests
import pandas as pd

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "http://localhost:8000"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "testadmin@rysa-dev.com")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "TestAdmin_Rysa_2026_Dev")


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and "user" in data
    assert data["user"]["email"] == ADMIN_EMAIL
    assert data["user"]["role"] == "admin"
    return data["token"]


@pytest.fixture(scope="session")
def admin_client(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    return s


# ---------- AUTH ----------
class TestAuth:
    def test_login_ok_and_me(self, admin_client):
        r = admin_client.get(f"{API}/auth/me")
        assert r.status_code == 200
        d = r.json()
        assert d["user"]["email"] == ADMIN_EMAIL
        assert "*" in d["permissions"] or len(d["permissions"]) > 0

    def test_login_bad_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me_requires_auth(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401


# ---------- RBAC / USERS ----------
class TestRBAC:
    def test_admin_can_list_users(self, admin_client):
        r = admin_client.get(f"{API}/users")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_users_requires_permission_without_token(self):
        r = requests.get(f"{API}/users", timeout=15)
        assert r.status_code == 401


# ---------- PRODUCTS + INVENTORY ----------
@pytest.fixture(scope="session")
def created_product(admin_client):
    payload = {
        "descripcion": "TEST_Vaso Plastico 12oz",
        "linea": "Vasos", "clasificacion": "Desechables",
        "unidad_medida": "PZA", "costo": 2.5, "existencia": 50,
        "stock_minimo": 10, "iva_tasa": 16,
        "precios": [{"nombre": "Precio 1", "utilidad_pct": 30}],
        "controles": {"controlar_inventario": True, "permitir_venta": True,
                      "permitir_inventario_negativo": False, "mostrar_pos": True},
    }
    r = admin_client.post(f"{API}/products", json=payload)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["existencia"] == 50, f"existencia inicial no aplicada: {p}"
    assert p["codigo"]
    assert p["precios"][0]["precio_sin_iva"] > 0
    return p


class TestProducts:
    def test_create_generates_inventory_entry(self, admin_client, created_product):
        # kardex must contain entry with entrada=50
        r = admin_client.get(f"{API}/products/{created_product['id']}/movimientos")
        assert r.status_code == 200
        movs = r.json()
        assert len(movs) >= 1
        assert any(m["tipo"] == "entrada" and m["entrada"] == 50 for m in movs)

    def test_list_and_search(self, admin_client, created_product):
        r = admin_client.get(f"{API}/products", params={"q": "TEST_Vaso"})
        assert r.status_code == 200
        assert any(p["id"] == created_product["id"] for p in r.json())

    def test_filter_bajo_stock_sin_existencia(self, admin_client):
        r = admin_client.get(f"{API}/products", params={"filtro": "sin_existencia"})
        assert r.status_code == 200
        for p in r.json():
            assert float(p.get("existencia", 0)) <= 0

    def test_adjust_inventory(self, admin_client, created_product):
        r = admin_client.post(f"{API}/products/{created_product['id']}/ajuste",
                              json={"tipo": "entrada", "cantidad": 5, "concepto": "compra"})
        assert r.status_code == 200
        assert r.json()["existencia"] == 55
        # verify GET
        p = admin_client.get(f"{API}/products/{created_product['id']}").json()
        assert p["existencia"] == 55


# ---------- CLIENTS ----------
class TestClients:
    def test_publico_general_exists(self, admin_client):
        r = admin_client.get(f"{API}/clients", params={"q": "PUBLICO"})
        assert r.status_code == 200
        assert any(c["codigo"] == "PUBLICO" for c in r.json())

    def test_create_client_auto_codigo(self, admin_client):
        r = admin_client.post(f"{API}/clients", json={
            "nombre": "TEST_Cliente Credito", "tipo": "menudeo",
            "condicion_pago": "credito", "credito_autorizado": True, "limite_credito": 5000,
        })
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["codigo"].startswith("C")
        assert c["saldo"] == 0
        pytest.cliente_credito_id = c["id"]


# ---------- CAJA ----------
class TestCaja:
    def test_abrir_caja(self, admin_client):
        # cerrar si ya hay abierta
        actual = admin_client.get(f"{API}/caja/actual").json()
        if actual.get("caja"):
            admin_client.post(f"{API}/caja/cerrar", json={"efectivo_contado": 0})
        r = admin_client.post(f"{API}/caja/abrir", json={"fondo_inicial": 500, "caja_nombre": "TEST Caja"})
        assert r.status_code == 200, r.text
        assert r.json()["fondo_inicial"] == 500

    def test_caja_actual_resumen(self, admin_client):
        r = admin_client.get(f"{API}/caja/actual")
        assert r.status_code == 200
        d = r.json()
        assert d["caja"] is not None
        assert d["resumen"]["efectivo_esperado"] == 500


# ---------- SALES / POS ----------
class TestSales:
    def test_sale_contado_efectivo_updates_inventory_and_caja(self, admin_client, created_product):
        prod = admin_client.get(f"{API}/products/{created_product['id']}").json()
        existencia_prev = prod["existencia"]
        # El POS envía precio CON IVA (precio_con_iva): el backend extrae el IVA
        # de cada línea, por lo que el total es el precio_con_iva por cantidad.
        precio_con = prod["precios"][0]["precio_con_iva"]
        item = {"product_id": prod["id"], "codigo": prod["codigo"], "descripcion": prod["descripcion"],
                "cantidad": 3, "unidad": "PZA", "precio": precio_con, "iva_tasa": 16, "descuento": 0}
        total_exp = round(3 * precio_con, 2)
        pago = round(total_exp + 5, 2)  # extra for cambio
        r = admin_client.post(f"{API}/sales", json={
            "items": [item], "condicion": "contado",
            "pagos": [{"metodo": "efectivo", "monto": pago}]})
        assert r.status_code == 200, r.text
        sale = r.json()
        assert sale["estado"] == "confirmada"
        assert abs(sale["total"] - total_exp) < 0.05, f"total: {sale['total']} vs {total_exp}"
        assert sale["cambio"] == round(pago - sale["total"], 2)
        pytest.sale_contado_id = sale["id"]
        pytest.sale_contado_total = sale["total"]
        pytest.sale_contado_efectivo = min(pago, sale["total"])

        # inventory decreased
        prod2 = admin_client.get(f"{API}/products/{prod['id']}").json()
        assert prod2["existencia"] == existencia_prev - 3

        # kardex has 'venta' entry
        movs = admin_client.get(f"{API}/products/{prod['id']}/movimientos").json()
        assert any(m["tipo"] == "venta" and m["salida"] == 3 for m in movs)

        # caja efectivo_esperado subio
        caja = admin_client.get(f"{API}/caja/actual").json()
        assert caja["resumen"]["ventas_efectivo"] >= sale["total"] - 0.01

    def test_sale_credito_no_toca_caja_aumenta_saldo(self, admin_client, created_product):
        cliente_id = pytest.cliente_credito_id
        prod = admin_client.get(f"{API}/products/{created_product['id']}").json()
        precio_sin = prod["precios"][0]["precio_sin_iva"]
        item = {"product_id": prod["id"], "codigo": prod["codigo"], "descripcion": prod["descripcion"],
                "cantidad": 2, "unidad": "PZA", "precio": precio_sin, "iva_tasa": 16, "descuento": 0}
        caja_prev = admin_client.get(f"{API}/caja/actual").json()["resumen"]["efectivo_esperado"]

        r = admin_client.post(f"{API}/sales", json={
            "cliente_id": cliente_id, "items": [item], "condicion": "credito", "pagos": []})
        assert r.status_code == 200, r.text
        sale = r.json()
        assert sale["saldo"] == sale["total"]

        # caja unchanged
        caja_after = admin_client.get(f"{API}/caja/actual").json()["resumen"]["efectivo_esperado"]
        assert caja_after == caja_prev

        # cliente saldo aumento
        cli = [c for c in admin_client.get(f"{API}/clients").json() if c["id"] == cliente_id][0]
        assert cli["saldo"] == sale["total"]

    def test_sale_existencia_insuficiente(self, admin_client, created_product):
        prod = admin_client.get(f"{API}/products/{created_product['id']}").json()
        item = {"product_id": prod["id"], "codigo": prod["codigo"], "descripcion": prod["descripcion"],
                "cantidad": 99999, "unidad": "PZA", "precio": 10, "iva_tasa": 16, "descuento": 0}
        r = admin_client.post(f"{API}/sales", json={
            "items": [item], "condicion": "contado",
            "pagos": [{"metodo": "efectivo", "monto": 9999999}]})
        assert r.status_code == 400
        assert "Existencia" in r.text or "insuficiente" in r.text.lower()

    def test_sale_pago_insuficiente(self, admin_client, created_product):
        prod = admin_client.get(f"{API}/products/{created_product['id']}").json()
        precio_sin = prod["precios"][0]["precio_sin_iva"]
        item = {"product_id": prod["id"], "codigo": prod["codigo"], "descripcion": prod["descripcion"],
                "cantidad": 1, "unidad": "PZA", "precio": precio_sin, "iva_tasa": 16, "descuento": 0}
        r = admin_client.post(f"{API}/sales", json={
            "items": [item], "condicion": "contado",
            "pagos": [{"metodo": "efectivo", "monto": 0.01}]})
        assert r.status_code == 400

    def test_cancelar_venta_revierte_todo(self, admin_client, created_product):
        sale_id = pytest.sale_contado_id
        prod_prev = admin_client.get(f"{API}/products/{created_product['id']}").json()
        caja_prev = admin_client.get(f"{API}/caja/actual").json()["resumen"]["efectivo_esperado"]

        r = admin_client.post(f"{API}/sales/{sale_id}/cancelar", json={"motivo": "TEST cancel"})
        assert r.status_code == 200, r.text
        assert r.json()["estado"] == "cancelada"

        # inventario devuelto
        prod_after = admin_client.get(f"{API}/products/{created_product['id']}").json()
        assert prod_after["existencia"] == prod_prev["existencia"] + 3

        # caja devolucion registrada
        caja_after = admin_client.get(f"{API}/caja/actual").json()["resumen"]
        assert caja_after["devoluciones"] >= pytest.sale_contado_efectivo - 0.01

    def test_suspender_y_listar(self, admin_client, created_product):
        prod = admin_client.get(f"{API}/products/{created_product['id']}").json()
        item = {"product_id": prod["id"], "codigo": prod["codigo"], "descripcion": prod["descripcion"],
                "cantidad": 1, "unidad": "PZA", "precio": 10, "iva_tasa": 16, "descuento": 0}
        r = admin_client.post(f"{API}/sales/suspend", json={
            "items": [item], "condicion": "contado", "pagos": []})
        assert r.status_code == 200
        sid = r.json()["id"]
        lst = admin_client.get(f"{API}/sales-suspended").json()
        assert any(s["id"] == sid for s in lst)
        admin_client.delete(f"{API}/sales-suspended/{sid}")


# ---------- CAJA CIERRE ----------
class TestCajaClose:
    def test_cerrar_caja_calcula_diferencia(self, admin_client):
        actual = admin_client.get(f"{API}/caja/actual").json()
        esperado = actual["resumen"]["efectivo_esperado"]
        contado = esperado + 10  # sobrante
        r = admin_client.post(f"{API}/caja/cerrar", json={"efectivo_contado": contado})
        assert r.status_code == 200, r.text
        cierre = r.json()["cierre"]
        assert cierre["diferencia"] == round(contado - esperado, 2)


# ---------- DASHBOARD ----------
class TestDashboard:
    def test_dashboard_returns_metrics(self, admin_client):
        r = admin_client.get(f"{API}/dashboard")
        assert r.status_code == 200
        d = r.json()
        for k in ["ventas_hoy", "ventas_mes", "total_caja", "bajo_stock",
                  "sin_existencia", "clientes", "productos", "serie_ventas"]:
            assert k in d, f"falta {k}"
        assert isinstance(d["serie_ventas"], list) and len(d["serie_ventas"]) == 7


# ---------- EXCEL ----------
class TestExcel:
    def test_export_products_excel(self, admin_client):
        r = admin_client.get(f"{API}/products/export/excel")
        assert r.status_code == 200
        assert "spreadsheet" in r.headers.get("content-type", "")
        # can be read
        df = pd.read_excel(io.BytesIO(r.content))
        assert "codigo" in df.columns

    def test_import_preview_and_confirm(self, admin_client):
        rows = [{"codigo": "TESTIMP01", "descripcion": "TEST_ImportProducto",
                 "linea": "TEST", "clasificacion": "TEST", "costo": 1.0,
                 "existencia": 7, "unidad_medida": "PZA", "stock_minimo": 1, "estado": "activo"}]
        df = pd.DataFrame(rows)
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as w:
            df.to_excel(w, index=False, sheet_name="Datos")
        buf.seek(0)
        # preview: multipart -- remove content-type header
        s = requests.Session()
        s.headers.update({"Authorization": admin_client.headers["Authorization"]})
        r = s.post(f"{API}/products/import/preview",
                   files={"file": ("prod.xlsx", buf.getvalue(),
                                   "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
        assert r.status_code == 200, r.text
        prev = r.json()
        assert prev["total"] == 1
        rows_confirm = prev["preview"]
        r2 = admin_client.post(f"{API}/products/import/confirm", json={"rows": rows_confirm})
        assert r2.status_code == 200, r2.text
        assert r2.json()["creados"] + r2.json()["actualizados"] >= 1


# ---------- REPORTES / EXPORT PDF ----------
class TestReportPdf:
    def test_export_reporte_pdf(self, admin_client):
        r = admin_client.get(f"{API}/reports/ventas/export?fmt=pdf")
        assert r.status_code == 200, r.text
        assert "application/pdf" in r.headers.get("content-type", "")
        assert r.content[:4] == b"%PDF"

    def test_export_reporte_pdf_con_ventas(self, admin_client):
        r = admin_client.get(f"{API}/reports/ventas/export?fmt=pdf&desde=2020-01-01&hasta=2030-12-31")
        assert r.status_code == 200, r.text
        assert r.content[:4] == b"%PDF"


# ---------- AUDITORIA ----------
class TestAudit:
    def test_audit_records_actions(self, admin_client):
        r = admin_client.get(f"{API}/audit")
        assert r.status_code == 200
        logs = r.json()
        acciones = {l["accion"] for l in logs}
        # should have several types after preceding tests
        assert "crear" in acciones
        assert any(a in acciones for a in ("abrir_caja", "cerrar_caja"))
        assert "cancelar" in acciones
