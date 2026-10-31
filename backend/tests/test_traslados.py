"""Tiempos de traslado a partir del rastro GPS (traslados.py, sin base de datos).

Ejecutar desde `backend/`:
    python -m pytest tests/test_traslados.py -n 0
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

import traslados  # noqa: E402

M_LAT = 1 / 111320            # grados de latitud por metro
INICIO = datetime(2026, 10, 30, 15, 0, tzinfo=timezone.utc)   # 9:00 en México
BASE_LAT, BASE_LNG = 17.5100, -91.9800                        # Palenque


def _p(t_min, norte_m, precision=8, **extra):
    return {"latitud": BASE_LAT + norte_m * M_LAT, "longitud": BASE_LNG, "precision": precision,
            "fecha": (INICIO + timedelta(minutes=t_min)).isoformat(), **extra}


def _jornada():
    pts = []
    # 0-10 min: maneja 2 km al norte (un punto cada 30 s).
    for k in range(21):
        pts.append(_p(k * 0.5, k * 100))
    # 10-30 min: detenido con el cliente A (Android casi no manda puntos quieto).
    pts.append(_p(20, 2005, visita_id="v1"))
    pts.append(_p(30, 2010))
    # 30-38 min: 1.5 km más al norte.
    for k in range(1, 17):
        pts.append(_p(30 + k * 0.5, 2010 + k * 94))
    # 38-48 min: detenido con el cliente B (sin visita: se reconoce por su ubicación).
    pts.append(_p(48, 3510))
    # Ruido: un salto imposible y un punto impreciso, que se ignoran.
    pts.append(_p(49, 60000))
    pts.append(_p(49.5, 3600, precision=500))
    # 48-52 min: sigue en camino 800 m.
    for k in range(1, 9):
        pts.append(_p(48 + k * 0.5, 3510 + k * 100))
    return pts


CLIENTES = [
    {"id": "c-b", "nombre": "Abarrotes La Esperanza", "latitud": BASE_LAT + 3530 * M_LAT, "longitud": BASE_LNG},
    {"id": "c-lejos", "nombre": "Cliente lejano", "latitud": BASE_LAT + 9000 * M_LAT, "longitud": BASE_LNG},
]
VISITAS = {"v1": {"id": "v1", "cliente_id": "c-a", "cliente_nombre": "Tienda Don Pepe"}}


def test_paradas_y_traslados_del_dia():
    r = traslados.analizar(_jornada(), CLIENTES, VISITAS)
    lugares = [p["lugar"] for p in r["paradas"]]
    assert lugares == ["Tienda Don Pepe", "Abarrotes La Esperanza"]
    assert [p["duracion_min"] for p in r["paradas"]] == [20, 10]

    t = r["traslados"]
    assert [(x["desde"], x["hasta"]) for x in t] == [
        ("Inicio de jornada", "Tienda Don Pepe"),
        ("Tienda Don Pepe", "Abarrotes La Esperanza"),
        ("Abarrotes La Esperanza", "En camino"),
    ]
    assert [x["duracion_min"] for x in t] == [10, 8, 4]
    assert abs(t[0]["distancia_km"] - 2.0) < 0.05
    assert abs(t[1]["distancia_km"] - 1.5) < 0.05

    res = r["resumen"]
    assert res["paradas"] == 2 and res["tiempo_total_min"] == 52
    assert res["tiempo_detenido_min"] == 30 and res["tiempo_movimiento_min"] == 22
    assert res["traslado_promedio_min"] == 9          # (10 + 8) / 2
    assert abs(res["distancia_km"] - 4.3) < 0.1        # el salto de 60 km no cuenta


def test_sin_puntos_suficientes():
    r = traslados.analizar([_p(0, 0)], CLIENTES)
    assert r["paradas"] == [] and r["traslados"] == [] and r["resumen"]["distancia_km"] == 0


def test_detenido_todo_el_tiempo():
    r = traslados.analizar([_p(0, 0), _p(30, 10), _p(60, 5)], [])
    assert len(r["paradas"]) == 1 and r["paradas"][0]["duracion_min"] == 60
    assert r["traslados"] == [] and r["resumen"]["tiempo_movimiento_min"] == 0
