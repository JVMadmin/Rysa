"""CLI del sistema de migración legacy.

Uso (desde la raíz del proyecto o con PYTHONPATH apuntando a ella):
  python -m tools.legacy_migration inventory   # solo inventario de archivos
  python -m tools.legacy_migration inspect     # DISCOVERY completo (fase 1)

Comandos futuros (analyze/validate/simulate/import-history/import-cxc/
reconcile) se activan en fases posteriores, después de validar el Discovery.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import config
from .discovery import inventory_files, run_discovery


def _cmd_analyze(_args) -> int:
    from .analyze import run as run_analysis
    print("Ejecutando ANALYZE (solo lectura, no modifica producción)...", flush=True)
    result = run_analysis(progress=lambda m: print(f"  · {m}", flush=True))
    if result.get("status") == "NOT_FOUND":
        print(f"LEGACY DATA NO ENCONTRADO: {result['expected_path']}")
        return 2
    print(f"Veredicto: {result['verdict']}")
    print(f"Reconciliación CxC: {result['match_pct']}%")
    print(f"CxC stats: {result['cxc_stats']}")
    if result["blockers"]:
        print("Bloqueos:")
        for b in result["blockers"]:
            print(f"  - {b}")
    print(f"Reporte: {result['report']}")
    for f in result["outputs"].values():
        print(f"Salida: {f}")
    return 0


def _cmd_inventory(_args) -> int:
    legacy_dir = config.resolve_legacy_data_path()
    if not legacy_dir.is_dir():
        print(f"LEGACY DATA NO ENCONTRADO")
        print(f"Ruta esperada: {legacy_dir}")
        print("Coloca ahí los archivos DBF/BDF/CDX/FPT y vuelve a ejecutar.")
        return 2
    inv = inventory_files(legacy_dir)
    print(f"LEGACY DATA: {legacy_dir}")
    print(f"  DBF : {len(inv['dbf'])}")
    print(f"  BDF : {len(inv['bdf'])}")
    print(f"  CDX : {len(inv['cdx'])}")
    print(f"  FPT : {len(inv['fpt'])}")
    print(f"  TMP : {len(inv['tmp'])}")
    print(f"  Otros: {len(inv['other'])}")
    print(f"  TOTAL: {inv['total']}")
    return 0


def _cmd_inspect(args) -> int:
    print("Ejecutando DISCOVERY (solo lectura, no modifica nada)...", flush=True)

    def progress(msg: str) -> None:
        print(f"  [{progress_step[0]:>3}] {msg}", flush=True)
        progress_step[0] += 1

    progress_step = [1]
    result = run_discovery(progress=progress)
    if result.get("status") == "NOT_FOUND":
        print("LEGACY DATA NO ENCONTRADO")
        print(f"Ruta esperada: {result['expected_path']}")
        print("Coloca ahí los archivos DBF/BDF/CDX/FPT y vuelve a ejecutar.")
        return 2
    c = result["counts"]
    t = result["totals"]
    print(f"Archivos: {c['total_files']} "
          f"(DBF {c['dbf']}, BDF {c['bdf']}, CDX {c['cdx']}, FPT {c['fpt']}, "
          f"TMP {c['tmp']}, otros {c['other']}, ilegibles {c['unreadable']})")
    print(f"Tablas analizadas: {t['tables_analyzed']} · "
          f"Registros: {t['records_scanned']:,}")
    print(f"Rango de fechas: {t['date_min']} → {t['date_max']}")
    rels = [r for r in result.get("relationships", []) if "error" not in r]
    print(f"Relaciones con evidencia: {len(rels)}")
    top = rels[:5]
    for r in top:
        print(f"  {r['source']} → {r['target']} "
              f"({r['match_percentage']}%, {r['confidence']})")
    for f in result.get("report_files", {}).values():
        print(f"Reporte: {f}")
    if args.json_output:
        print(json.dumps(result, ensure_ascii=False, default=str)[:args.json_output])
    return 0


def _cmd_stage(_args) -> int:
    import asyncio
    from .staging import run as run_staging
    print("Ejecutando STAGING (solo tablas legacy_*; producción intacta)...",
          flush=True)
    result = asyncio.run(
        run_staging(progress=lambda m: print(f"  · {m}", flush=True)))
    if result.get("status") != "OK":
        print(f"ERROR: {result}")
        return 2
    v = result["validations"]
    print(f"Batch: {result['batch_id']}")
    print(f"Tickets staged: {v['tickets']['staged']:,} "
          f"(ecuación {'OK' if v['tickets']['ecuacion_ok'] else 'FALLA'})")
    print(f"Detalles staged: {v['detalles']['staged']:,} "
          f"(ecuación {'OK' if v['detalles']['ecuacion_ok'] else 'FALLA'})")
    c = v["cxc"]
    print(f"CxC: READY {c['READY']:,} · REVIEW {c['REVIEW_REQUIRED']:,} · "
          f"NEGATIVE {c['NEGATIVE']:,} · EXCLUDED {c['EXCLUDED']:,} "
          f"(ecuación {'OK' if c['ecuacion_ok'] else 'FALLA'})")
    print(f"Clientes: {v['clientes']}")
    print(f"Productos: {v['productos']}")
    for f in result["outputs"].values():
        print(f"Salida: {f}")
    return 0


def _cmd_dry_run(_args) -> int:
    """FASE 4: simulación completa de la futura importación.
    SOLO LECTURA: staging + verificación de producción. Nunca escribe."""
    import asyncio
    from .dryrun import run as run_dry
    print("Ejecutando DRY-RUN (solo lectura; producción intacta)...", flush=True)
    result = asyncio.run(
        run_dry(progress=lambda m: print(f"  · {m}", flush=True)))
    if result.get("status") != "OK":
        print(f"ERROR: {result}")
        return 2
    m = result["metrics"]
    r = result["reconciliation"]
    print(f"Idempotente (2 pasadas): {'OK' if result['idempotente'] else 'FALLA'}")
    print(f"Tickets: staged {m['tickets_total_staged']:,} → would import "
          f"{m['tickets_would_insert']:,} (ecuación "
          f"{'OK' if r['tickets']['ecuacion'] else 'FALLA'})")
    print(f"Detalles: {m['details_total']:,} (sin producto: "
          f"{m['details_product_unmapped']:,})")
    c = r["cxc"]
    print(f"CxC: would import {c['would_import']:,} "
          f"(${m['cxc_would_import_saldo']:,.2f}) · review {c['review']:,} · "
          f"negative {c['negative']:,} · excluded {c['excluded']:,} "
          f"(ecuación {'OK' if c['ecuacion'] else 'FALLA'})")
    print(f"Producción: {m['production']}")
    for f in result["outputs"].values():
        print(f"Salida: {f}")
    return 0


def _cmd_import_products(_args) -> int:
    """FASE 5: catálogo de productos ARTICULO.dbf → products (única fase que
    escribe en producción; decisiones P1-P5 en products.py)."""
    import asyncio
    from .products import run as run_products
    print("Ejecutando IMPORT-PRODUCTS (escribe en `products`; idempotente)...",
          flush=True)
    result = asyncio.run(
        run_products(progress=lambda m: print(f"  · {m}", flush=True)))
    if result.get("status") != "OK":
        print(f"ERROR: {result}")
        return 2
    c = result["counts"]
    print(f"Batch: {result['batch_id']}")
    print(f"ARTICULO válidos: {c['articulo_validos']:,} "
          f"(activos {c['activos']:,} · baja lógica {c['borrados_legacy']:,})")
    print(f"Creados en products: {c['creados']:,} · ya existentes "
          f"(no sobrescritos): {c['existentes_ya_en_products']:,} · "
          f"rechazados: {c['rechazados']:,}")
    print(f"Ecuación: {'OK' if result['validations']['ecuacion_ok'] else 'FALLA'}")
    for f in result["outputs"].values():
        print(f"Salida: {f}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m tools.legacy_migration",
        description="Migración Histórica Legacy RYSA — fase DISCOVERY")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("inventory", help="inventario de legacy_data (sin análisis)")
    p_ins = sub.add_parser("inspect", help="DISCOVERY completo y reportes")
    p_ins.add_argument("--json-output", type=int, default=0, metavar="N",
                       help="imprime los primeros N caracteres del JSON")
    sub.add_parser("analyze", help="FASE 2: validación matemática del Legacy")
    sub.add_parser("stage", help="FASE 3: staging en tablas legacy_* (idempotente)")
    sub.add_parser("dry-run", help="FASE 4: previsualiza la importación desde staging")
    sub.add_parser("import-products",
                   help="FASE 5: importa catálogo ARTICULO.dbf a products")
    args = ap.parse_args(argv)
    if args.cmd == "inventory":
        return _cmd_inventory(args)
    if args.cmd == "inspect":
        return _cmd_inspect(args)
    if args.cmd == "analyze":
        return _cmd_analyze(args)
    if args.cmd == "stage":
        return _cmd_stage(args)
    if args.cmd == "dry-run":
        return _cmd_dry_run(args)
    if args.cmd == "import-products":
        return _cmd_import_products(args)
    return 1


if __name__ == "__main__":
    sys.exit(main())
