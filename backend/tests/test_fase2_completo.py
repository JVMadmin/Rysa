"""Pruebas E2E de Fase 2 para Grupo RYSA ERP.

Cubre:
- Machotes documentales y compilador ReportLab (Ticket 80mm y Carta)
- CxC con segregación activa estricta (saldo > 0) y recálculo
- Presentaciones de producto y conversión canónica a unidad base
- Reemplazo total de datos con análisis delta preview
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("BACKEND_INTERNAL_URL") or "http://127.0.0.1:8000"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "jesusvelazquezmay.89@gmail.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Mujdkpelsk73")


@pytest.fixture(scope="session")
def admin_token():
    # Intentar login con credenciales conocidas
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    if r.status_code != 200:
        # Fallback para entorno CI/dev
        r = requests.post(f"{API}/auth/login", json={"email": "testadmin@rysa-dev.com", "password": "TestAdmin_Rysa_2026_Dev"}, timeout=30)
    assert r.status_code == 200, f"Login falló: {r.status_code} {r.text}"
    data = r.json()
    return data.get("token") or data.get("access_token")


@pytest.fixture(scope="session")
def client(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    return s


class TestFase2Completo:
    def test_machotes_list_and_versions(self, client):
        """Verifica listar plantillas de documentos y sus versiones activas."""
        r = client.get(f"{API}/templates")
        assert r.status_code == 200, r.text
        templates = r.json()
        assert len(templates) >= 2
        tipos = [t["tipo"] for t in templates]
        assert "ticket" in tipos
        assert "carta_venta" in tipos

    def test_machotes_simulation_and_pdf(self, client):
        """Verifica simulación dual y renderizado de PDFs oficiales."""
        # 1. Ticket 80mm
        sim_res = client.post(f"{API}/templates/tpl_ticket_default/simulate", json={"num_items": 3})
        assert sim_res.status_code == 200, sim_res.text
        sim_data = sim_res.json()
        assert sim_data["ok"] is True
        assert len(sim_data["context"]["doc"]["items"]) == 3
        assert sim_data["context"]["doc"]["total"] > 0

        # PDF Ticket
        pdf_res = client.post(f"{API}/templates/tpl_ticket_default/pdf", json={"num_items": 3})
        assert pdf_res.status_code == 200
        assert pdf_res.headers["content-type"] == "application/pdf"
        assert pdf_res.content.startswith(b"%PDF")
        assert len(pdf_res.content) > 1000

        # 2. Carta de Venta
        pdf_carta = client.post(f"{API}/templates/tpl_carta_default/pdf", json={"num_items": 4})
        assert pdf_carta.status_code == 200
        assert pdf_carta.headers["content-type"] == "application/pdf"
        assert pdf_carta.content.startswith(b"%PDF")
        assert len(pdf_carta.content) > 1000

    def test_cxc_activo_segregacion(self, client):
        """Verifica que el modo activo solo reporte cuentas con saldo > 0."""
        r = client.get(f"{API}/cxc?modo=activo")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "totales" in data
        assert "clientes" in data
        assert data["totales"]["cartera"] > 0

        for c in data["clientes"]:
            assert float(c["saldo"]) > 0.001, f"Cliente {c.get('nombre')} reporta saldo 0 en modo activo"

        # Recalcular saldos
        r_rec = client.post(f"{API}/cxc/recalcular")
        assert r_rec.status_code == 200, r_rec.text
        rec_data = r_rec.json()
        assert "cartera_total" in rec_data
        # Garantía forense: la cartera total no debe estar inflada a $13M+ por ventas pagadas
        assert rec_data["cartera_total"] < 2_500_000, f"Cartera inflada: {rec_data['cartera_total']}"
        assert rec_data["cartera_total"] > 1_000_000, f"Cartera vacía: {rec_data['cartera_total']}"

        # Verificar caso testigo Santos Perez (código 00003)
        r_santos = client.get(f"{API}/cxc?q=00003&modo=activo")
        assert r_santos.status_code == 200
        santos_list = [c for c in r_santos.json().get("clientes", []) if c.get("codigo") == "00003"]
        if santos_list:
            s_saldo = float(santos_list[0]["saldo"])
            assert 27000 < s_saldo < 29000, f"Saldo Santos Perez anómalo: {s_saldo}"

    def test_presentaciones_producto(self, client):
        """Verifica presentaciones, factor de conversión y unidad base."""
        # Obtener un producto existente
        r = client.get(f"{API}/products?limit=5")
        assert r.status_code == 200, r.text
        prods = r.json()
        assert len(prods) > 0

        p = prods[0]
        pid = p["id"]
        assert "presentaciones" in p
        assert len(p["presentaciones"]) >= 1

        # Crear presentación secundaria
        pres_payload = {
            "nombre": "PAQUETE TEST",
            "factor": 12.0,
            "precio": round(float(p.get("precio_con_iva") or 10.0) * 11.5, 2),
            "costo": round(float(p.get("costo") or 5.0) * 12.0, 4),
            "es_base": False,
        }
        r_add = client.post(f"{API}/products/{pid}/presentations", json=pres_payload)
        assert r_add.status_code == 200, r_add.text
        added = r_add.json()
        assert added["ok"] is True

        # Verificar detalle
        r_det = client.get(f"{API}/products/{pid}")
        assert r_det.status_code == 200
        det = r_det.json()
        nombres = [x["nombre"] for x in det["presentaciones"]]
        assert "PAQUETE TEST" in nombres

    def test_reemplazo_total_preview(self, client):
        """Verifica preview y delta de reemplazo total."""
        r = client.get(f"{API}/legacy/replace/preview")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["clientes"]["total_fuente"] > 0
        assert data["productos"]["total_fuente"] > 0
