"""Tests E2E del modulo de Compras y Gastos (Grupo RYSA ERP).

Cubre: proveedores, cuentas bancarias, centros de costo, presupuestos,
recurrentes, ordenes de compra, recepciones, compras/gastos, CxP y reportes.

Todo el flujo vive en UNA clase para no depender del orden de xdist
(loadscope distribuye por clase/modulo).
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "http://localhost:8000"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "testadmin@rysa-dev.com")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "TestAdmin_Rysa_2026_Dev")


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_client(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="class")
def created_product(admin_client):
    payload = {
        "descripcion": "TEST_ModuloCompras Refaccion",
        "linea": "Compras", "clasificacion": "Inventario",
        "unidad_medida": "PZA", "costo": 15.0, "existencia": 20,
        "stock_minimo": 2, "iva_tasa": 16,
        "precios": [{"nombre": "Precio 1", "utilidad_pct": 30}],
        "controles": {"controlar_inventario": True, "permitir_venta": True,
                      "permitir_inventario_negativo": False, "mostrar_pos": True},
    }
    r = admin_client.post(f"{API}/products", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


class TestModuloCompras:
    """Flujo completo del modulo de compras con estado local por test."""

    def test_proveedores_crud(self, admin_client):
        r = admin_client.post(f"{API}/proveedores", json={
            "nombre": "TEST Proveedor Modulo", "rfc": "TES990101AAA",
            "telefono": "5511223344", "email": "prov@test.mx",
            "condiciones_pago": "contado", "dias_credito": 0, "limite_credito": 10000,
        })
        assert r.status_code == 200, r.text
        p = r.json()
        pid = p["id"]
        assert p["nombre"] == "TEST Proveedor Modulo"

        lst = admin_client.get(f"{API}/proveedores", params={"q": "Modulo"}).json()
        assert any(x["id"] == pid for x in lst)

        r = admin_client.put(f"{API}/proveedores/{pid}", json={
            "nombre": "TEST Proveedor Modulo Edit", "rfc": "TES990101AAA",
        })
        assert r.status_code == 200, r.text
        assert r.json()["nombre"] == "TEST Proveedor Modulo Edit"

        r = admin_client.patch(f"{API}/proveedores/{pid}/estado", params={"activo": "false"})
        assert r.status_code == 200, r.text
        ficha = admin_client.get(f"{API}/proveedores/{pid}/ficha")
        assert ficha.status_code == 200, ficha.text
        assert ficha.json()["proveedor"]["activo"] is False

        admin_client.patch(f"{API}/proveedores/{pid}/estado", params={"activo": "true"})

    def test_cuentas_bancarias_crud(self, admin_client):
        r = admin_client.post(f"{API}/cuentas-bancarias", json={
            "banco": "BBVA", "nombre": "TEST Cuenta Modulo",
            "numero_cuenta": "123456789012", "clabe": "012180015123456789",
            "moneda": "MXN", "tipo_cuenta": "debito", "activa": True,
        })
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        lst = admin_client.get(f"{API}/cuentas-bancarias").json()
        assert any(c["id"] == cid for c in lst)

    def test_centros_costo_crud(self, admin_client):
        r = admin_client.post(f"{API}/centros-costo", json={
            "nombre": "TEST Centro Modulo", "codigo": "TCC", "descripcion": "prueba",
        })
        assert r.status_code == 200, r.text
        cc = r.json()
        cid = cc["id"]
        assert cc["codigo"] == "TCC"
        lst = admin_client.get(f"{API}/centros-costo").json()
        assert any(x["id"] == cid for x in lst)

        r = admin_client.put(f"{API}/centros-costo/{cid}", json={
            "nombre": "TEST Centro Modulo 2", "codigo": "TCC2",
        })
        assert r.status_code == 200, r.text
        assert r.json()["nombre"] == "TEST Centro Modulo 2"

        r = admin_client.patch(f"{API}/centros-costo/{cid}/estado", params={"activo": "false"})
        assert r.status_code == 200, r.text

    def test_presupuestos_crud_y_resumen(self, admin_client):
        r = admin_client.post(f"{API}/presupuestos", json={
            "categoria": "Renta", "periodo": "2026-12",
            "centro_costo_nombre": "", "monto": 5000, "notas": "test",
        })
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["monto"] == 5000
        lst = admin_client.get(f"{API}/presupuestos", params={"periodo": "2026-12"}).json()
        assert any(x["id"] == p["id"] for x in lst)

        res = admin_client.get(f"{API}/presupuestos/resumen", params={"periodo": "2026-12"})
        assert res.status_code == 200, res.text
        d = res.json()
        assert d["periodo"] == "2026-12"
        assert isinstance(d["presupuestos"], list)

    def test_recurrentes_crud_y_estado(self, admin_client):
        r = admin_client.post(f"{API}/recurrentes", json={
            "tipo": "gasto", "proveedor_nombre": "Servicios TEST",
            "concepto": "Internet", "categoria": "Servicios",
            "importe": 650, "frecuencia": "mensual", "dia": 5,
            "recordatorio": True, "activo": True,
        })
        assert r.status_code == 200, r.text
        rec = r.json()
        rid = rec["id"]
        assert rec["frecuencia"] == "mensual"

        r = admin_client.put(f"{API}/recurrentes/{rid}", json={
            "tipo": "gasto", "proveedor_nombre": "Servicios TEST",
            "concepto": "Internet fibra", "categoria": "Servicios",
            "importe": 700, "frecuencia": "mensual", "dia": 5,
            "recordatorio": True, "activo": True,
        })
        assert r.status_code == 200, r.text
        assert r.json()["importe"] == 700

        r = admin_client.patch(f"{API}/recurrentes/{rid}/estado", params={"activo": "false"})
        assert r.status_code == 200, r.text

    def test_orden_recepcion_compra_cxp(self, admin_client, created_product):
        prov = admin_client.post(f"{API}/proveedores", json={"nombre": "TEST Orden Proveedor"}).json()
        pid = prov["id"]
        prod = created_product
        ex_prev = prod["existencia"]

        r = admin_client.post(f"{API}/compras/ordenes", json={
            "proveedor_id": pid, "estado": "enviada",
            "fecha_estimada": "2026-09-30", "notas": "TEST orden",
            "items": [{"product_id": prod["id"], "codigo": prod["codigo"],
                       "descripcion": prod["descripcion"], "unidad": "PZA",
                       "solicitado": 4, "costo": 15.0, "iva_tasa": 16}],
        })
        assert r.status_code == 200, r.text
        orden = r.json()
        oid = orden["id"]
        assert orden["folio"].startswith("OC")
        assert orden["total"] == round(4 * 15 * 1.16, 2)

        lst = admin_client.get(f"{API}/compras/ordenes", params={"estado": "enviada"}).json()
        assert any(o["id"] == oid for o in lst)

        r = admin_client.put(f"{API}/compras/ordenes/{oid}", json={
            "proveedor_id": pid, "estado": "enviada", "notas": "TEST orden edit",
            "items": [{"product_id": prod["id"], "codigo": prod["codigo"],
                       "descripcion": prod["descripcion"], "unidad": "PZA",
                       "solicitado": 4, "costo": 15.0, "iva_tasa": 16}],
        })
        assert r.status_code == 200, r.text

        r = admin_client.post(f"{API}/compras/recepciones", json={
            "orden_id": oid, "metodo_pago": "credito", "forma_pago": "credito",
            "items": [{"product_id": prod["id"], "codigo": prod["codigo"],
                       "descripcion": prod["descripcion"], "unidad": "PZA",
                       "cantidad": 3, "costo": 15.0, "iva_tasa": 16}],
        })
        assert r.status_code == 200, r.text
        rcp = r.json()
        assert rcp["recepcion"]["estado"] == "confirmada"
        assert rcp["recepcion"]["saldo_pendiente"] > 0

        prod_after = admin_client.get(f"{API}/products/{prod['id']}").json()
        assert prod_after["existencia"] == ex_prev + 3

        det = admin_client.get(f"{API}/compras/recepciones/{rcp['recepcion']['id']}")
        assert det.status_code == 200, det.text

        cxp = admin_client.get(f"{API}/compras/cxp").json()
        assert cxp["facturas_pendientes"] >= 1
        assert any(f["id"] == rcp["compra"]["id"] for f in cxp["facturas"])

        saldo = rcp["recepcion"]["saldo_pendiente"]
        abono = round(saldo / 2, 2)
        r = admin_client.post(f"{API}/compras/{rcp['compra']['id']}/pagar", json={
            "monto": abono, "metodo_pago": "transferencia", "referencia": "REF-TEST",
        })
        assert r.status_code == 200, r.text
        pag = r.json()
        assert abs(pag["saldo_pendiente"] - round(saldo - abono, 2)) < 0.01

        r = admin_client.post(f"{API}/compras/{rcp['compra']['id']}/pagar", json={
            "monto": pag["saldo_pendiente"], "metodo_pago": "transferencia",
        })
        assert r.status_code == 200, r.text
        assert r.json()["estado"] == "pagada"

        r = admin_client.post(f"{API}/compras/{rcp['compra']['id']}/pagar", json={
            "monto": 1.0, "metodo_pago": "transferencia",
        })
        assert r.status_code == 409

    def test_gasto_registro_y_reporte(self, admin_client):
        r = admin_client.post(f"{API}/compras", json={
            "tipo": "gasto", "proveedor_nombre": "CFE TEST",
            "concepto": "Luz local", "categoria": "Servicios",
            "fecha_recepcion": "2026-08-01",
            "subtotal": 1000, "iva": 160, "total": 1160,
            "metodo_pago": "transferencia", "forma_pago": "contado",
            "items": [{"descripcion": "Luz local", "unidad": "PZA", "cantidad": 1,
                       "costo": 1160, "iva_tasa": 16, "afecta_inventario": False}],
        })
        assert r.status_code == 200, r.text
        g = r.json()
        assert g["tipo"] == "gasto"
        assert g["folio"].startswith("GST")
        assert g["saldo_pendiente"] == 0

        lst = admin_client.get(f"{API}/compras", params={"tipo": "gasto"}).json()
        assert any(x["id"] == g["id"] for x in lst)
        res = admin_client.get(f"{API}/compras/resumen").json()
        assert res["gastos_periodo"] >= g["total"]

        rep = admin_client.get(f"{API}/compras/reportes")
        assert rep.status_code == 200, rep.text
        rdata = rep.json()
        assert rdata["gastos_periodo"] >= g["total"]

    def test_compra_afecta_inventario(self, admin_client, created_product):
        prod = admin_client.get(f"{API}/products/{created_product['id']}").json()
        ex_prev = prod["existencia"]
        r = admin_client.post(f"{API}/compras", json={
            "tipo": "compra", "proveedor_nombre": "TEST Compra Proveedor",
            "factura_numero": "F-9999", "categoria": "Mercancia",
            "subtotal": 150, "iva": 24, "total": 174,
            "metodo_pago": "transferencia", "forma_pago": "contado",
            "items": [{"product_id": prod["id"], "codigo": prod["codigo"],
                       "descripcion": prod["descripcion"], "unidad": "PZA",
                       "cantidad": 5, "costo": 30.0, "iva_tasa": 16,
                       "afecta_inventario": True}],
        })
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["folio"].startswith("CMP")
        assert c["estado"] == "confirmada"

        prod_after = admin_client.get(f"{API}/products/{prod['id']}").json()
        assert prod_after["existencia"] == ex_prev + 5

        r = admin_client.post(f"{API}/compras/{c['id']}/cancelar",
                              params={"motivo": "TEST cancelacion"})
        assert r.status_code == 200, r.text
        assert r.json()["estado"] == "cancelada"
        prod_fin = admin_client.get(f"{API}/products/{prod['id']}").json()
        assert prod_fin["existencia"] == ex_prev

    def test_recepcion_excede_pendiente_es_rechazada(self, admin_client, created_product):
        prov = admin_client.post(f"{API}/proveedores", json={"nombre": "TEST Orden 2"}).json()
        prod = created_product
        r = admin_client.post(f"{API}/compras/ordenes", json={
            "proveedor_id": prov["id"], "estado": "enviada",
            "items": [{"product_id": prod["id"], "codigo": prod["codigo"],
                       "descripcion": prod["descripcion"], "unidad": "PZA",
                       "solicitado": 2, "costo": 15.0, "iva_tasa": 16}],
        })
        assert r.status_code == 200, r.text
        oid = r.json()["id"]

        r = admin_client.post(f"{API}/compras/recepciones", json={
            "orden_id": oid, "metodo_pago": "credito", "forma_pago": "credito",
            "items": [{"product_id": prod["id"], "codigo": prod["codigo"],
                       "descripcion": prod["descripcion"], "unidad": "PZA",
                       "cantidad": 5, "costo": 15.0, "iva_tasa": 16}],
        })
        assert r.status_code == 400

        admin_client.post(f"{API}/compras/ordenes/{oid}/estado", json={"estado": "cancelada"})
        r = admin_client.post(f"{API}/compras/recepciones", json={
            "orden_id": oid, "metodo_pago": "credito", "forma_pago": "credito",
            "items": [{"product_id": prod["id"], "codigo": prod["codigo"],
                       "descripcion": prod["descripcion"], "unidad": "PZA",
                       "cantidad": 1, "costo": 15.0, "iva_tasa": 16}],
        })
        assert r.status_code == 409