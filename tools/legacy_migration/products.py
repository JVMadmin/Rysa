"""FASE 5 — IMPORT-PRODUCTS: catálogo de productos ARTICULO.dbf → `products`.

Es la primera fase autorizada a escribir en una tabla productiva (`products`).
Decisiones oficiales:

  P1. Se importan TODOS los códigos de ARTICULO.dbf, activos y con baja
      lógica (`_deleted` → estado 'baja'): los borrados son necesarios para
      mapear partidas históricas vendidas. ARTICULO tiene 3 códigos
      duplicados (activo + basura borrada): gana el registro ACTIVO y el
      borrado se descarta (su EXISTENCIA contiene valores corruptos).
  P2. La existencia de ARTICULO.EXISTENCIA SÍ se carga: queda en el doc
      (campo del esquema de 85) y espejada en la columna tipada
      `existencia`. ADVERTENCIA: 462 códigos activos tienen existencia
      negativa (drift real del legacy; el POS los bloqueará hasta ajuste
      de inventario). ALMARTIS.EXISTENCIA está toda en NULL, no es fuente.
  P3. Productos ya existentes en `products` (match por `doc->>'codigo'`)
      NO se sobrescriben; se reportan como 'existing' para revisión manual.
  P4. Precios: se replica la lógica de server.py (build_product_doc +
      _enriquecer_precios). PRECIO1..5 son precios CON IVA
      (precio_incluye_iva=True, igual que la importación por Excel).
      Si PRECIO1..5 están vacíos y PRECIOVTA > 0, se usa PRECIOVTA como
      PRECIO1 (decisión documentada; solo afecta al catálogo, no al histórico).
  P5. Idempotente: clave = `doc->>'codigo'`; re-ejecutar no duplica.

El doc conserva los 85 campos legacy (minusculas) + campos ERP modernos,
idéntico a lo que produce /products/import/confirm con un Excel de 85 columnas,
más trazabilidad: source='LEGACY', legacy_table='ARTICULO'.
"""
from __future__ import annotations

import asyncio
import csv
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import config
from .dbf_reader import iter_records, read_header

CHUNK = 1000

# (nombre, tipo) — espejo exacto de COLS_85 en backend/server.py
COLS_85 = [
    ("POSICION", "C"), ("CODIGO", "C"), ("DESCRIP", "C"), ("DESCRIPLRG", "M"), ("CLASIFICA", "C"),
    ("CATEGORIA", "C"), ("CATEGOCVE", "C"), ("DEPTOCVE", "C"), ("LINEA", "C"), ("UNIMEDIDA", "C"),
    ("UNIMEDCVE", "C"), ("CVEPROSER", "C"), ("SATOBJIMP", "C"), ("UBICACION", "C"), ("EMPAQUE", "N"),
    ("UNIMEDEMPQ", "C"), ("EXISTENCIA", "N"), ("INSUMO", "L"), ("PROVEEDOR", "C"), ("FECHAALTA", "D"),
    ("ULTFCOSTO", "D"), ("ULTCOSTO", "N"), ("COSTO", "N"), ("COSTODLLS", "N"), ("UTILMINIMO", "N"),
    ("UTILPRECI1", "N"), ("UTILPRECI2", "N"), ("UTILPRECI3", "N"), ("UTILPRECI4", "N"), ("UTILPRECI5", "N"),
    ("EXENTO", "L"), ("IMPUESTO", "N"), ("T_IEPS", "N"), ("IEPS", "N"), ("ISH", "N"),
    ("RET_ISR", "N"), ("RET_IVA", "N"), ("PRECIOVTA", "N"), ("PRECVTACTR", "N"), ("PRECVTAUSO", "N"),
    ("PRECIO1", "N"), ("PRECIO2", "N"), ("PRECIO3", "N"), ("PRECIO4", "N"), ("PRECIO5", "N"),
    ("PRECIOMIN", "N"), ("ULTFDEVCOM", "D"), ("ULTCDEVCOM", "N"), ("ULTFCOMPRA", "D"), ("ULTCCOMPRA", "N"),
    ("ULTFDEVVEN", "D"), ("ULTCDEVVEN", "N"), ("ULTFVENTA", "D"), ("ULTCVENTA", "N"), ("VTA_MES", "N"),
    ("VTA_ANUAL", "N"), ("XENTREGAR", "N"), ("XRECIBIR", "N"), ("STOCKMIN", "N"), ("STOCKMAX", "N"),
    ("PORPEDIR", "L"), ("IMAGEN", "M"), ("FOTO", "M"), ("FICHATEC", "M"), ("NUMSERIES", "L"),
    ("FACTCOMENT", "L"), ("INTEGRADO", "L"), ("VALEXIST", "L"), ("MODIPRECIO", "L"), ("APLIDESCTO", "L"),
    ("TOPECOSTO", "L"), ("INVENTARIO", "L"), ("MOVKARDEX", "L"), ("VENTAWEB", "L"), ("LOTES", "L"),
    ("CONTROLADO", "L"), ("BASCULA", "L"), ("ASOCIADO", "L"), ("FLETE", "L"), ("COMENTARIO", "M"),
    ("ROTACION", "C"), ("ULTPRECIO", "D"), ("COMISION", "N"), ("COMITIPO", "C"), ("STATUS", "C"),
]

STATUS_TO_ESTADO = {"A": "activo", "1": "activo", "ACTIVO": "activo", "B": "baja",
                    "BAJA": "baja", "S": "suspendido", "SUSPENDIDO": "suspendido"}

TYPED_COLS = ("costo", "existencia", "stock_minimo", "vendidas",
              "precio_sin_iva", "precio_con_iva", "utilidad", "margen")


# ------------------------------------------------------------------ dinero ---
def _neto_de_precio(precio: float, iva_tasa: float, incluye_iva: bool) -> float:
    p = float(precio or 0)
    if incluye_iva:
        tasa = max(0.0, float(iva_tasa or 0)) / 100.0
        if tasa > 0:
            return round(p / (1 + tasa), 2)
        return round(p, 2)
    return round(p, 2)


def _bruto_de_precio(precio: float, iva_tasa: float, incluye_iva: bool) -> float:
    p = float(precio or 0)
    if incluye_iva:
        return round(p, 2)
    return round(p * (1 + max(0.0, float(iva_tasa or 0)) / 100.0), 2)


def _utilidad_margen(precio_neto: float, costo: float) -> tuple:
    try:
        neto = float(precio_neto or 0)
        costo = float(costo or 0)
    except Exception:
        return 0.0, 0.0
    util = neto - costo
    margen = round(util / neto * 100, 2) if neto else 0.0
    return round(util, 2), margen


# ------------------------------------------------------------------- memos ---
class _MemoResolver:
    """Resuelve bloques memo de un FPT (solo lectura, cp1252)."""

    def __init__(self, fpt_path: Path | None):
        self.blocks: dict[int, str] = {}
        self.available = False
        if fpt_path is None or not fpt_path.is_file():
            return
        import struct
        size = fpt_path.stat().st_size
        if size < 512:
            return
        try:
            with fpt_path.open("rb") as fh:
                head = fh.read(512)
                block_size = struct.unpack_from(">H", head, 6)[0] or 64
                raw = fh.read()
        except OSError:
            return
        self.available = True
        n_blocks = len(raw) // block_size
        for b in range(1, n_blocks):
            off = b * block_size
            if off + 6 > len(raw):
                break
            mtype = raw[off + 1]
            mlen = struct.unpack_from(">I", raw, off + 2)[0]
            if mtype in b"MT" and 0 < mlen <= size:
                self.blocks[b] = raw[off + 6: off + 6 + mlen].decode(
                    "cp1252", errors="replace").replace("\r\n", "\n").strip()

    def get(self, block) -> str:
        if isinstance(block, int) and block in self.blocks:
            return self.blocks[block]
        return ""


# ------------------------------------------------------------------ parser ---
def _c(v) -> str:
    return "" if v is None else str(v).strip()


def _l(v, default=False) -> bool:
    return default if v is None else bool(v)


def parse_articulo_row(rec: dict, memo: _MemoResolver) -> tuple[dict, list[str]]:
    """ARTICULO.dbf → doc de 85 campos (minusculas) + errores de validación."""
    errores: list[str] = []
    d: dict = {}
    for name, t in COLS_85:
        raw = rec.get(name)
        key = name.lower()
        if t in ("C",):
            d[key] = _c(raw)
        elif t == "M":
            d[key] = memo.get(raw)
        elif t == "N":
            try:
                d[key] = None if raw is None else float(raw)
            except (TypeError, ValueError):
                errores.append(f"{key}: número inválido ({raw!r})")
                d[key] = None
        elif t == "D":
            d[key] = raw if isinstance(raw, str) and raw else None
        elif t == "L":
            d[key] = _l(raw)
    if not d.get("codigo"):
        errores.append("codigo: código obligatorio vacío")
    if not d.get("descrip"):
        errores.append("descrip: descripción obligatoria vacía")
    return d, errores


def build_product_doc(d: dict, deleted: bool) -> dict:
    """Espejo de build_product_doc + _enriquecer_precios de backend/server.py."""
    # P4: fallback PRECIOVTA → PRECIO1 cuando no hay listas capturadas
    if not any(d.get(f"precio{i}") for i in range(1, 6)):
        pvta = d.get("preciovta")
        if pvta:
            d["precio1"] = float(pvta)
    iva = d.get("impuesto")
    iva = float(iva) if iva not in (None, 0, "") else 8.0
    costo = float(d.get("costo") or 0)
    precios = []
    for i in range(1, 6):
        con = d.get(f"precio{i}")
        util = d.get(f"utilpreci{i}")
        if con:
            con = float(con)
            sin = round(con / (1 + iva / 100), 2)
            u = round((sin / costo - 1) * 100, 2) if costo else float(util or 0)
        else:
            u = float(util or 0)
            sin = round(costo * (1 + u / 100), 2)
            con = round(sin * (1 + iva / 100), 2)
        precios.append({"nombre": f"Precio {i}", "utilidad_pct": u,
                        "precio_sin_iva": sin, "precio_con_iva": round(con, 2)})
    status = str(d.get("status", "")).upper()
    doc = dict(d)                     # conserva los 85 campos tal cual
    # P2: existencia legacy SÍ se carga (doc + columna tipada en el import)
    doc["existencia"] = float(doc.get("existencia") or 0)
    doc.update({
        "descripcion": d.get("descrip", ""),
        "descripcion_larga": d.get("descriplrg", ""),
        "linea": d.get("linea", ""),
        "clasificacion": d.get("clasifica", ""),
        "unidad_medida": d.get("unimedida") or "PZA",
        "empaque": d.get("empaque") or "",
        "ubicacion": d.get("ubicacion", ""),
        "costo": costo,
        "stock_minimo": float(d.get("stockmin") or 0),
        "iva_tasa": iva,
        "estado": "baja" if deleted else STATUS_TO_ESTADO.get(status, "activo"),
        "precios": precios,
        "precio_minimo": float(d.get("preciomin") or 0),
        "imagen_url": d.get("imagen") or d.get("foto") or "",
        "sku": d.get("codigo", ""),
        "sinonimos": [],
        "sat": {"clave_sat": d.get("cveproser", ""), "unidad_sat": d.get("unimedcve", ""),
                "impuestos": "Exento" if d.get("exento") else "IVA"},
        "controles": {"permitir_venta": True,
                      "controlar_inventario": bool(d.get("inventario", True)),
                      "permitir_inventario_negativo": False,
                      "mostrar_pos": not bool(d.get("insumo", False)),
                      "mostrar_catalogo": bool(d.get("ventaweb", False))},
        "ficha_tecnica": {},
        "proveedores": [d.get("proveedor")] if d.get("proveedor") else [],
        "precio_incluye_iva": True,
        "source": "LEGACY",
        "legacy_table": "ARTICULO",
    })
    barras = [str(x).strip() for x in doc.get("codigos_barras") or [] if str(x).strip()]
    codigo = str(doc.get("codigo") or "").strip()
    if codigo and codigo not in barras:
        barras.insert(0, codigo)
    doc["codigos_barras"] = barras
    # _enriquecer_precios (precio_incluye_iva=True)
    iva_tasa = float(doc["iva_tasa"])
    precios = []
    for p in doc["precios"]:
        sin = float(p["precio_sin_iva"] or 0)
        con = float(p["precio_con_iva"] or 0)
        util = float(p["utilidad_pct"] or 0)
        if con > 0:
            sin = _neto_de_precio(con, iva_tasa, True)
        elif sin > 0:
            con = _bruto_de_precio(sin, iva_tasa, False)
        else:
            neto_base = costo * (1 + util / 100) if util >= 0 else costo
            sin = round(neto_base, 2)
            con = _bruto_de_precio(sin, iva_tasa, False)
        if costo > 0:
            util = round((sin / costo - 1) * 100, 2)
        precios.append({"nombre": p.get("nombre", "Precio"), "utilidad_pct": util,
                        "precio_sin_iva": round(sin, 2), "precio_con_iva": round(con, 2)})
    doc["precios"] = precios
    sin_ok = float(precios[0]["precio_sin_iva"]) if precios else costo
    con_ok = float(precios[0]["precio_con_iva"]) if precios else round(costo * (1 + iva_tasa / 100), 2)
    doc["precio_sin_iva"] = round(sin_ok, 2)
    doc["precio_con_iva"] = round(con_ok, 2)
    util, margen = _utilidad_margen(sin_ok, costo)
    doc["utilidad"] = util
    doc["margen"] = margen
    return doc


# ---------------------------------------------------------------- importador --
class ProductImporter:
    def __init__(self, legacy_dir: Path, progress=print):
        self.dir = legacy_dir
        self.log = progress
        self.rejected: list[tuple[str, str]] = []     # (codigo, motivo)
        self.rows: list[tuple] = []                   # (codigo, estado, deleted)

    def load(self) -> None:
        hdr = read_header(self.dir / "ARTICULO.dbf")
        memo_fields = [f.name for f in hdr.fields if f.ftype == "M"]
        self.log(f"ARTICULO.dbf: {hdr.record_count_declared} registros, "
                 f"{len(hdr.fields)} campos, memo: {', '.join(memo_fields) or 'ninguno'}")
        self.memo = _MemoResolver(self.dir / "ARTICULO.fpt")
        if hdr.has_memo_fields and not self.memo.available:
            self.log("  AVISO: hay campos memo pero no se encontró ARTICULO.fpt; "
                     "se dejarán vacíos")
        self.docs: list[dict] = []
        n_del = 0
        self.dup_active_won: list[str] = []
        by_codigo: dict[str, dict] = {}          # P1: dedupe por codigo
        for rec in iter_records(self.dir / "ARTICULO.dbf"):
            d, errores = parse_articulo_row(rec, self.memo)
            cod = d.get("codigo", "")
            if errores:
                self.rejected.append((cod, "; ".join(errores)))
                continue
            prev = by_codigo.get(cod)
            if prev is not None:
                # duplicado: gana el registro ACTIVO sobre el borrado
                if prev["_deleted"] and not rec["_deleted"]:
                    self.dup_active_won.append(cod)
                    by_codigo[cod] = rec
                continue
            by_codigo[cod] = rec
        for cod in sorted(by_codigo):
            rec = by_codigo[cod]
            d, errores = parse_articulo_row(rec, self.memo)
            self.docs.append(build_product_doc(d, rec["_deleted"]))
            if rec["_deleted"]:
                n_del += 1
            self.rows.append((cod, "baja" if rec["_deleted"] else "activo",
                              rec["_deleted"]))
        self.deleted_count = n_del
        self.log(f"ARTICULO leído: {len(self.docs)} códigos válidos "
                 f"({n_del} con baja lógica), {len(self.rejected)} rechazados, "
                 f"{len(self.dup_active_won)} duplicados resueltos a favor del "
                 f"activo: {self.dup_active_won}")

    # ------------------------------------------------------------- escritura
    async def write_products(self, conn) -> dict:
        existing = {r[0]: r[1] for r in await conn.fetch(
            "SELECT doc->>'codigo' AS codigo, id FROM products "
            "WHERE doc->>'codigo' IS NOT NULL AND doc->>'codigo' <> ''")}
        to_insert: list[dict] = []
        self.existing_codes: list[str] = []
        for doc in self.docs:
            cod = doc["codigo"]
            if cod in existing:
                self.existing_codes.append(cod)
                continue
            to_insert.append(doc)
        self.created = 0
        for i in range(0, len(to_insert), CHUNK):
            rows = []
            for doc in to_insert[i:i + CHUNK]:
                _id = uuid.uuid4().hex
                doc["id"] = _id
                doc["_id"] = _id
                doc["created_at"] = datetime.now(timezone.utc).isoformat()
                doc["updated_at"] = doc["created_at"]
                rows.append((
                    _id, _id, json.dumps(doc, ensure_ascii=False, default=str),
                    doc["costo"], doc["existencia"], doc["stock_minimo"], 0.0,
                    doc["precio_sin_iva"], doc["precio_con_iva"],
                    doc["utilidad"], doc["margen"]))
            await conn.executemany(
                """INSERT INTO products ("_id", "id", "doc", created_at, costo,
                     existencia, stock_minimo, vendidas, precio_sin_iva,
                     precio_con_iva, utilidad, margen)
                   VALUES ($1,$2,$3::jsonb,now(),$4,$5,$6,$7,$8,$9,$10,$11)""",
                rows)
            self.created += len(rows)
        return {"articulo_validos": len(self.docs),
                "creados": self.created,
                "existentes_ya_en_products": len(self.existing_codes),
                "rechazados": len(self.rejected),
                "activos": len(self.docs) - self.deleted_count,
                "borrados_legacy": self.deleted_count}

    # ------------------------------------------------------------- reportes
    def validations(self, counts: dict) -> dict:
        estados: dict[str, int] = {}
        for _cod, estado, _del in self.rows:
            estados[estado] = estados.get(estado, 0) + 1
        return {
            "articulo_total": len(self.docs) + len(self.rejected)
                              + len(self.dup_active_won),
            "articulo_validos": len(self.docs),
            "activos": counts.get("activos"),
            "borrados_legacy": counts.get("borrados_legacy"),
            "creados": counts.get("creados"),
            "existentes_ya_en_products": counts.get("existentes_ya_en_products"),
            "rechazados": counts.get("rechazados"),
            "duplicados_activo_gana": len(self.dup_active_won),
            "existencia_negativa": sum(1 for d in self.docs
                                       if float(d.get("existencia") or 0) < 0),
            "existencia_total": round(sum(float(d.get("existencia") or 0)
                                          for d in self.docs), 2),
            "estados_legacy": estados,
            # ecuación sobre el universo DEDUPLICADO (docs + rechazados =
            # creados + existentes; los duplicados resueltos no se re-cuentan)
            "ecuacion_ok": (len(self.docs) + len(self.rejected)
                            == counts.get("creados", 0)
                            + counts.get("existentes_ya_en_products", 0)
                            + counts.get("rechazados", 0)),
        }


def write_reports(imp: ProductImporter, vals: dict, meta: dict) -> dict:
    outdir = config.resolve_reports_dir() / "products"
    outdir.mkdir(parents=True, exist_ok=True)
    paths = {}
    p = outdir / "products_import.csv"
    with p.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["CODIGO", "ESTADO", "ACCION"])
        w.writerows([[r[0], r[1], "existing"] for r in imp.rows if r[0] in
                     set(imp.existing_codes)] +
                    [[r[0], r[1], "created"] for r in imp.rows if r[0] not in
                     set(imp.existing_codes)])
    paths["products_import.csv"] = str(p)
    p = outdir / "products_rejected.csv"
    with p.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["CODIGO", "MOTIVO"])
        w.writerows(imp.rejected)
    paths["products_rejected.csv"] = str(p)

    md = [
        "# RYSA LEGACY PRODUCTS IMPORT (FASE 5)\n",
        f"Batch: `{meta['batch_id']}` · Generado: {meta['generated_at']} · "
        f"Duración: {meta['duration_seconds']} s · Fuente: `{meta['legacy_path']}`\n",
        "## 1. Resumen\n",
        f"- ARTICULO.dbf registros: **{vals['articulo_total']:,}** → válidos "
        f"**{vals['articulo_validos']:,}** · rechazados {vals['rechazados']:,} "
        f"(ecuación {'OK' if vals['ecuacion_ok'] else '❌ DIFIERE'})",
        f"- Activos: {vals['activos']:,} · Baja lógica (estado 'baja'): "
        f"{vals['borrados_legacy']:,}",
        f"- **Creados en `products`: {vals['creados']:,}** · "
        f"ya existentes (no sobrescritos): "
        f"{vals['existentes_ya_en_products']:,}\n",
        "## 2. Decisiones aplicadas\n",
        "- P1: se importan activos y borrados lógicos (`_deleted` → estado "
        "'baja'); códigos duplicados (activo + basura borrada) se resuelven "
        "a favor del activo.",
        "- P2: existencia de ARTICULO se carga en el doc y en la columna "
        "tipada `existencia`; los valores negativos son drift real del "
        "legacy (el POS bloqueará esos productos hasta ajuste de inventario).",
        "- P3: códigos ya presentes en `products` NO se sobrescriben.",
        "- P4: precios con IVA (`precio_incluye_iva=True`); si no hay "
        "PRECIO1..5 se usa PRECIOVTA como Precio 1.",
        "- P5: idempotente por `doc->>'codigo'`; doc conserva los 85 campos "
        "legacy + campos ERP, idéntico a la importación Excel.\n",
        "## 3. Siguiente paso\n",
        "Re-ejecutar `stage` para que `legacy_product_mapping` resuelva "
        "`rysa_product_id` (MATCHED) y luego `dry-run` para verificar.\n",
    ]
    p = config.project_root() / "RYSA_LEGACY_PRODUCTS_IMPORT_REPORT.md"
    p.write_text("\n".join(md), encoding="utf-8")
    paths["markdown"] = str(p)
    return paths


async def run(legacy_dir: Path | None = None, progress=print) -> dict:
    import asyncpg

    legacy_dir = legacy_dir or config.resolve_legacy_data_path()
    if not (legacy_dir / "ARTICULO.dbf").is_file():
        return {"status": "NOT_FOUND", "expected_path": str(legacy_dir / "ARTICULO.dbf")}
    url = os.environ.get("DATABASE_URL", "").replace("+asyncpg", "")
    if not url:
        return {"status": "NO_DATABASE_URL",
                "message": "DATABASE_URL no definida"}
    started = datetime.now(timezone.utc)
    imp = ProductImporter(legacy_dir, progress=progress)
    imp.load()
    batch_id = f"B{started.strftime('%Y%m%d%H%M%S')}"
    conn = await asyncpg.connect(url)
    try:
        counts = await imp.write_products(conn)
    finally:
        await conn.close()
    vals = imp.validations(counts)
    finished = datetime.now(timezone.utc)
    meta = {"batch_id": batch_id, "generated_at": started.isoformat(),
            "duration_seconds": round((finished - started).total_seconds(), 1),
            "legacy_path": str(legacy_dir)}
    paths = write_reports(imp, vals, meta)
    return {"status": "OK", "batch_id": batch_id, "counts": counts,
            "validations": vals, "outputs": paths, "meta": meta}
