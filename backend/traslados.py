"""Tiempos de traslado de un vendedor a partir de su rastro GPS del día.

La app de vendedores manda su posición cada ~15 s mientras la jornada está
abierta (también con el celular bloqueado). Con esos puntos se arma:

- paradas: se quedó al menos 5 min en un radio de 80 m. Se nombra con la
  visita registrada ahí o con el cliente ubicado a 150 m o menos;
- traslados: de una parada a la siguiente (y del inicio de la jornada a la
  primera), con su duración y kilómetros;
- resumen: distancia recorrida, tiempo en movimiento y tiempo detenido.

Android deja de mandar puntos cuando el celular no se mueve, así que una
parada suele verse como dos puntos cercanos separados por varios minutos.
Se ignoran los puntos con precisión peor que 100 m y los saltos imposibles
(más de 150 km/h, típicos de un GPS que pierde señal).
"""
from datetime import datetime
from math import asin, cos, radians, sin, sqrt

RADIO_PARADA_M = 80
PARADA_MIN_S = 5 * 60
PRECISION_MAX_M = 100
VELOCIDAD_MAX_MS = 150 / 3.6
RUIDO_M = 15                      # movimientos menores son ruido del GPS
RADIO_CLIENTE_M = 150


def metros(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia en metros entre dos coordenadas (haversine)."""
    p1, p2 = radians(lat1), radians(lat2)
    h = sin((p2 - p1) / 2) ** 2 + cos(p1) * cos(p2) * sin(radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * asin(min(1.0, sqrt(h)))


def _hora(valor) -> datetime:
    return datetime.fromisoformat(str(valor).replace("Z", "+00:00"))


def _puntos_validos(puntos: list) -> list:
    out = []
    for p in sorted(puntos, key=lambda d: str(d.get("fecha") or "")):
        try:
            lat, lng, t = float(p["latitud"]), float(p["longitud"]), _hora(p["fecha"])
        except (KeyError, TypeError, ValueError):
            continue
        if p.get("precision") is not None and float(p["precision"]) > PRECISION_MAX_M:
            continue
        if out:
            seg = (t - out[-1]["t"]).total_seconds()
            if seg <= 0:
                continue
            if metros(out[-1]["lat"], out[-1]["lng"], lat, lng) / seg > VELOCIDAD_MAX_MS:
                continue
        out.append({"lat": lat, "lng": lng, "t": t, "visita_id": p.get("visita_id")})
    return out


def _distancia(pts: list) -> float:
    total = 0.0
    for a, b in zip(pts, pts[1:]):
        d = metros(a["lat"], a["lng"], b["lat"], b["lng"])
        if d >= RUIDO_M:
            total += d
    return total


def _paradas(pts: list) -> list:
    paradas, i = [], 0
    while i < len(pts):
        j = i
        while j + 1 < len(pts) and metros(pts[i]["lat"], pts[i]["lng"],
                                          pts[j + 1]["lat"], pts[j + 1]["lng"]) <= RADIO_PARADA_M:
            j += 1
        if (pts[j]["t"] - pts[i]["t"]).total_seconds() >= PARADA_MIN_S:
            grupo = pts[i:j + 1]
            paradas.append({
                "i": i, "j": j,
                "lat": sum(p["lat"] for p in grupo) / len(grupo),
                "lng": sum(p["lng"] for p in grupo) / len(grupo),
                "visita_id": next((p["visita_id"] for p in grupo if p.get("visita_id")), None),
            })
            i = j + 1
        else:
            i += 1
    return paradas


def _cliente_cercano(lat: float, lng: float, clientes: list):
    mejor, dist = None, RADIO_CLIENTE_M
    for c in clientes:
        try:
            d = metros(lat, lng, float(c["latitud"]), float(c["longitud"]))
        except (KeyError, TypeError, ValueError):
            continue
        if d <= dist:
            mejor, dist = c, d
    return mejor


def _min(segundos: float) -> int:
    return int(round(segundos / 60))


def analizar(puntos: list, clientes: list = (), visitas: dict | None = None) -> dict:
    """Paradas, traslados y resumen del día. `visitas`: {id: visita}."""
    visitas = visitas or {}
    pts = _puntos_validos(puntos)
    vacio = {"puntos": len(pts), "paradas": [], "traslados": [],
             "resumen": {"inicio": None, "fin": None, "distancia_km": 0, "tiempo_total_min": 0,
                         "tiempo_movimiento_min": 0, "tiempo_detenido_min": 0, "paradas": 0,
                         "traslado_promedio_min": 0}}
    if len(pts) < 2:
        return vacio

    paradas = []
    for p in _paradas(pts):
        visita = visitas.get(p["visita_id"]) if p["visita_id"] else None
        cliente = None if visita else _cliente_cercano(p["lat"], p["lng"], clientes)
        inicio, fin = pts[p["i"]]["t"], pts[p["j"]]["t"]
        paradas.append({
            "i": p["i"], "j": p["j"],
            "inicio": inicio.isoformat(), "fin": fin.isoformat(),
            "duracion_min": _min((fin - inicio).total_seconds()),
            "latitud": round(p["lat"], 6), "longitud": round(p["lng"], 6),
            "lugar": (visita or {}).get("cliente_nombre") or (cliente or {}).get("nombre") or "",
            "cliente_id": (visita or {}).get("cliente_id") or (cliente or {}).get("id"),
            "visita_id": p["visita_id"],
        })

    # Traslados: del inicio (si no arrancó detenido) a la primera parada y
    # entre paradas consecutivas. Lo que sigue a la última es "en camino".
    traslados = []
    tramos = []
    if not paradas or paradas[0]["i"] > 0:
        tramos.append((None, 0, paradas[0]["i"] if paradas else len(pts) - 1, paradas[0] if paradas else None))
    for a, b in zip(paradas, paradas[1:]):
        tramos.append((a, a["j"], b["i"], b))
    if paradas and paradas[-1]["j"] < len(pts) - 1:
        tramos.append((paradas[-1], paradas[-1]["j"], len(pts) - 1, None))
    for desde, i, j, hasta in tramos:
        if j <= i:
            continue
        seg = (pts[j]["t"] - pts[i]["t"]).total_seconds()
        traslados.append({
            "desde": desde["lugar"] if desde else "Inicio de jornada",
            "hasta": hasta["lugar"] if hasta else "En camino",
            "inicio": pts[i]["t"].isoformat(), "fin": pts[j]["t"].isoformat(),
            "duracion_min": _min(seg),
            "distancia_km": round(_distancia(pts[i:j + 1]) / 1000, 2),
        })

    total = (pts[-1]["t"] - pts[0]["t"]).total_seconds()
    detenido = sum((pts[p["j"]]["t"] - pts[p["i"]]["t"]).total_seconds() for p in paradas)
    entre = [t for t in traslados if t["hasta"] != "En camino"]
    for p in paradas:
        p.pop("i"), p.pop("j")
    return {
        "puntos": len(pts),
        "paradas": paradas,
        "traslados": traslados,
        "resumen": {
            "inicio": pts[0]["t"].isoformat(), "fin": pts[-1]["t"].isoformat(),
            "distancia_km": round(_distancia(pts) / 1000, 2),
            "tiempo_total_min": _min(total),
            "tiempo_movimiento_min": _min(total - detenido),
            "tiempo_detenido_min": _min(detenido),
            "paradas": len(paradas),
            "traslado_promedio_min": _min(sum(t["duracion_min"] * 60 for t in entre) / len(entre)) if entre else 0,
        },
    }
