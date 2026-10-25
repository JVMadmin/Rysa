#!/usr/bin/env python3
"""Carga inicial desde el sistema anterior (arranque real de producción).

Deja la operación del ERP exactamente como está en los DBF de legacy_data:
borra ventas, abonos, caja, movimientos de inventario y demás datos de
operación; actualiza clientes y productos (con saldos y existencias) con el
reemplazo total; vuelve a generar el staging y carga TODO el historial de
tickets y la cartera; al final recalcula saldos.

Conserva: usuarios, roles, configuración (settings), sucursales, formatos de
impresión, códigos de autorización, metas, rutas, favoritos, fotos y archivos,
correo, WhatsApp y la auditoría. De clientes y productos conserva el id y los
campos que el legacy no trae (fotos, categoría del sitio, códigos de barras,
correo y datos fiscales…).

Uso (dentro del contenedor backend, con respaldo previo):
    python -m scripts.carga_inicial_legacy                      # simulación
    python -m scripts.carga_inicial_legacy --aplicar --confirmar "CARGA INICIAL LEGACY" [--folio-venta N]

--folio-venta: último folio de venta ya usado; el siguiente ticket del ERP
será N+1 (por defecto 0 → V000001).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

_ROOT = str(Path(__file__).resolve().parent.parent)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

CONFIRMACION = "CARGA INICIAL LEGACY"

# Datos de operación que se vacían. Todo lo demás se conserva.
TABLAS_OPERACION = (
    "sales", "abonos", "caja_movimientos", "cajas", "inventory_movements",
    "product_stock", "cfdi_documents", "cot_pago_tokens", "suspended_sales",
    "sale_idempotency", "cxc_cargos", "payment_evidence", "autorizaciones",
    "pedidos", "presupuestos", "compras", "compras_ordenes", "compras_recepciones",
    "costos_historial", "visits", "seller_locations", "route_stops", "jornadas",
    # Lotes de importación legacy anteriores: la carga empieza de cero.
    "legacy_import_batch", "legacy_import_backup", "legacy_import_audit",
)
SECUENCIAS = ("venta", "cotizacion", "sol_abono")

USUARIO = {"id": "carga-inicial", "name": "Carga inicial legacy"}


async def _existe(conn, tabla: str) -> bool:
    from sqlalchemy import text
    return bool((await conn.execute(text(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='public' "
        "AND table_name=:t"), {"t": tabla})).first())


async def _conteos(conn) -> dict:
    from sqlalchemy import text
    out = {}
    for t in TABLAS_OPERACION:
        if await _existe(conn, t):
            out[t] = int((await conn.execute(text(f'SELECT count(*) FROM "{t}"'))).scalar() or 0)
    return out


async def _conservado(conn) -> dict:
    from sqlalchemy import text
    q = lambda s: conn.execute(text(s))
    return {
        "usuarios": (await q("SELECT count(*) FROM users")).scalar(),
        "settings": (await q("SELECT count(*) FROM settings")).scalar(),
        "formatos": (await q("SELECT count(*) FROM document_template_versions")).scalar(),
        "sucursales": (await q("SELECT count(*) FROM sucursales")).scalar(),
    }


def _codigos_clientes(carpeta: Path) -> set:
    from tools.legacy_migration.dbf_reader import iter_records
    p = carpeta / "CLIENTES.dbf"
    return {str(r.get("CLAVE") or "").strip() for r in iter_records(p)} - {""} if p.is_file() else set()


async def simular(carpeta: Path):
    import reemplazo_total as R
    from pgstore.database import transaction
    async with transaction() as conn:
        print("Se vacían:", json.dumps(await _conteos(conn), ensure_ascii=False))
        print("Se conservan:", json.dumps(await _conservado(conn), ensure_ascii=False))
        p = await R.generar_preview_reemplazo(conn, carpeta)
        print("Clientes:", {k: p["clientes"][k] for k in ("total_fuente", "nuevos", "actualizados", "ausentes_a_inactivar", "saldo_total_fuente")})
        print("Productos:", {k: p["productos"][k] for k in ("total_fuente", "nuevos", "actualizados", "ausentes_a_inactivar", "existencia_total_fuente")})
    print("Simulación: no se cambió nada.")


async def aplicar(carpeta: Path, folio_venta: int):
    from sqlalchemy import text
    import legacyadmin as L
    import reemplazo_total as R
    from pgstore.cxc import recalcular_saldos_cxc
    from pgstore.database import transaction

    fuente = _codigos_clientes(carpeta)
    if not fuente:
        sys.exit(f"No hay CLIENTES.dbf en {carpeta}")

    # 1) Vaciar operación + reemplazo de maestros, en una sola transacción.
    async with transaction() as conn:
        antes = await _conteos(conn)
        for t in antes:
            await conn.execute(text(f'DELETE FROM "{t}"'))
        for s in SECUENCIAS:
            await conn.execute(text("DELETE FROM sequences WHERE name=:n"), {"n": s})
        if folio_venta > 0:
            await conn.execute(text("INSERT INTO sequences (name, seq) VALUES ('venta', :v)"),
                               {"v": folio_venta})
        rep = await R.ejecutar_reemplazo_total(conn, USUARIO, carpeta)
        # Primera carga: los clientes que ya no existen en el legacy se borran (no solo se inactivan).
        rows = (await conn.execute(text("SELECT id, doc->>'codigo' FROM clients"))).fetchall()
        sobrantes = [r[0] for r in rows if (r[1] or "").strip() not in fuente]
        if sobrantes:
            await conn.execute(text("DELETE FROM clients WHERE id = ANY(:ids)"), {"ids": sobrantes})
        await conn.execute(text(
            'INSERT INTO audit_logs ("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
            {"k": uuid.uuid4().hex, "d": json.dumps({
                "fecha": datetime.now(timezone.utc).isoformat(), "usuario_nombre": USUARIO["name"],
                "accion": "carga_inicial_legacy", "entidad": "operacion",
                "detalle": f"vaciado {antes}; reemplazo {rep.get('batch_id')}; clientes borrados {len(sobrantes)}; folio venta {folio_venta}",
            }, ensure_ascii=False, default=str)})
    print("1) Vaciado:", json.dumps(antes, ensure_ascii=False))
    print("   Reemplazo:", json.dumps(rep, ensure_ascii=False, default=str)[:600])
    print("   Clientes borrados (no existen en el legacy):", len(sobrantes))

    # 2) Staging de nuevo: rehace el mapeo legacy → ids del ERP (clientes nuevos incluidos).
    r = subprocess.run([sys.executable, "-m", "tools.legacy_migration", "stage"],
                       cwd=_ROOT, capture_output=True, text=True)
    print("2) Staging:", "ok" if r.returncode == 0 else "FALLÓ")
    if r.returncode != 0:
        print(r.stdout[-3000:], r.stderr[-3000:])
        sys.exit("Staging falló: la operación ya quedó vacía y los maestros actualizados; "
                 "corrige y vuelve a correr el script o restaura el respaldo.")

    # 3) Historial completo de tickets y cartera.
    await L._ensure_tables()
    async with transaction() as conn:
        ok, bloqueos, resumen = await L._validate_import(conn)
    if not ok:
        sys.exit(f"Importación bloqueada: {bloqueos}")
    batch_id = f"IMP-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    async with transaction() as conn:
        await conn.execute(text(
            "INSERT INTO legacy_import_batch (batch_id, staging_batch_id, status, phase, created_by) "
            "VALUES (:b, :s, 'PENDING', 'inicio', :u)"),
            {"b": batch_id, "s": resumen.get("staging_batch"), "u": USUARIO["name"]})
    await L._run_import(batch_id, resumen.get("staging_batch"), USUARIO)
    async with transaction() as conn:
        b = (await conn.execute(text(
            "SELECT status, tickets_imported, details_imported, cxc_imported, cxc_saldo_total, error_detail "
            "FROM legacy_import_batch WHERE batch_id=:b"), {"b": batch_id})).first()
    print("3) Historial:", batch_id, tuple(b) if b else None)
    if not b or b[0] != "COMPLETED":
        sys.exit("La importación del historial no terminó; revisa error_detail.")

    # 4) Saldos finales con las ventas ya cargadas.
    async with transaction() as conn:
        cxc = await recalcular_saldos_cxc(conn)
        tot = (await conn.execute(text(
            "SELECT count(*) FILTER (WHERE saldo > 0.01), round(sum(COALESCE(saldo,0))::numeric, 2) FROM clients"))).first()
        ventas = (await conn.execute(text(
            "SELECT count(*), count(*) FILTER (WHERE COALESCE(saldo,0) > 0.01) FROM sales"))).first()
        cons = await _conservado(conn)
    print("4) Saldos:", json.dumps(cxc, ensure_ascii=False, default=str)[:400])
    print(f"   Clientes con saldo: {tot[0]} · total {tot[1]}")
    print(f"   Ventas: {ventas[0]} · con saldo: {ventas[1]}")
    print("   Conservado:", json.dumps(cons, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--confirmar", default="")
    ap.add_argument("--folio-venta", type=int, default=0)
    ap.add_argument("--dir", default="")
    a = ap.parse_args()
    import tools.legacy_migration.config as leg_cfg
    carpeta = Path(a.dir) if a.dir else leg_cfg.resolve_legacy_data_path()
    if not a.aplicar:
        return asyncio.run(simular(carpeta))
    if a.confirmar != CONFIRMACION:
        sys.exit(f'Para aplicar escribe: --confirmar "{CONFIRMACION}"')
    asyncio.run(aplicar(carpeta, a.folio_venta))


if __name__ == "__main__":
    main()
