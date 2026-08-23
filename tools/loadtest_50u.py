#!/usr/bin/env python3
"""Prueba de carga RYSA — objetivo: ~50 usuarios concurrentes.

SOLO ejecutar contra un entorno de PRUEBA (nunca producción).

Sin dependencias externas (stdlib asyncio + urllib vía run_in_executor no:
usamos httpx si está instalado en el venv del backend, que ya es dependencia
del ERP). Escenarios:
  1. login (obtiene token/cookie)
  2. GET /api/products      (catálogo)
  3. GET /api/clients       (cartera)
  4. GET /api/dashboard     (indicadores)
  5. GET /api/cxc           (cuentas por cobrar)
  6. Consultor de precios:  GET /api/public-price/products/search?q=vaso

Uso (desde backend/, con el venv del proyecto):
  set TEST_BASE_URL=http://127.0.0.1:8030
  set TEST_EMAIL=admin@gruporysa.com
  set TEST_PASSWORD=********
  python ../tools/loadtest_50u.py --users 50 --minutes 3

Métricas: latencia promedio/p95/máx por endpoint, errores y timeouts.
"""
import argparse
import asyncio
import os
import random
import statistics
import time

import httpx

TERMS = ["vaso", "bolsa", "plato", "cubiertos", "servilleta", "12", "oz", "P"]


async def worker(client: httpx.AsyncClient, base: str, token: str,
                 stop_at: float, results: list, consultor_token: str = ""):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    c_headers = {"X-Price-Token": consultor_token} if consultor_token else {}
    loop = asyncio.get_event_loop()
    while time.monotonic() < stop_at:
        # Mezcla de tráfico: 15% login-adjacentes no; 85% consultas autenticadas.
        pick = random.random()
        if pick < 0.25:
            path = "/api/products?limit=50"
            hdrs = headers
        elif pick < 0.45:
            path = "/api/clients"
            hdrs = headers
        elif pick < 0.60:
            path = "/api/dashboard"
            hdrs = headers
        elif pick < 0.75:
            path = "/api/cxc"
            hdrs = headers
        else:
            q = random.choice(TERMS)
            path = f"/api/public-price/products/search?q={q}"
            hdrs = c_headers
        t0 = time.perf_counter()
        err = ""
        try:
            r = await client.get(base + path, headers=hdrs, timeout=20)
            if r.status_code >= 400:
                err = f"HTTP {r.status_code}"
        except Exception as e:  # noqa: BLE001
            err = type(e).__name__
        dt = time.perf_counter() - t0
        results.append((path.split("?")[0], dt, err))
        await asyncio.sleep(random.uniform(0.2, 1.2))  # pacing humano


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8030"))
    ap.add_argument("--users", type=int, default=50)
    ap.add_argument("--minutes", type=float, default=2)
    ap.add_argument("--email", default=os.environ.get("TEST_EMAIL", ""))
    ap.add_argument("--password", default=os.environ.get("TEST_PASSWORD", ""))
    ap.add_argument("--consultor-token", default=os.environ.get("PRICE_API_TOKEN", ""))
    args = ap.parse_args()

    results: list = []
    async with httpx.AsyncClient() as client:
        # Login compartido (el ERP usa cookie httpOnly; httpx la guarda).
        r = await client.post(args.base + "/api/auth/login",
                              json={"email": args.email, "password": args.password},
                              timeout=20)
        if r.status_code != 200:
            print(f"LOGIN FALLÓ: {r.status_code} {r.text[:200]}")
            return
        token = (r.json() or {}).get("token") or ""

        stop_at = time.monotonic() + args.minutes * 60
        print(f"Iniciando {args.users} usuarios virtuales por {args.minutes} min contra {args.base}")
        t0 = time.perf_counter()
        await asyncio.gather(*[
            worker(client, args.base, token, stop_at, results, args.consultor_token)
            for _ in range(args.users)])
        dur = time.perf_counter() - t0

    # Resumen
    by_ep: dict = {}
    for ep, dt, err in results:
        by_ep.setdefault(ep, []).append((dt, err))
    print(f"\n{'ENDPOINT':45s} {'N':>6s} {'PROM':>7s} {'P95':>7s} {'MAX':>7s}  ERRORES")
    total_err = 0
    for ep, vals in sorted(by_ep.items()):
        dts = [d for d, _ in vals]
        errs = [e for _, e in vals if e]
        total_err += len(errs)
        p95 = statistics.quantiles(dts, n=20)[-1] if len(dts) > 4 else max(dts)
        print(f"{ep:45s} {len(dts):6d} {statistics.mean(dts):6.2f}s {p95:6.2f}s "
              f"{max(dts):6.2f}s  {len(errs)}")
    rps = len(results) / dur if dur else 0
    print(f"\nTotal requests: {len(results)} · RPS: {rps:.1f} · Errores: {total_err}")


if __name__ == "__main__":
    asyncio.run(main())