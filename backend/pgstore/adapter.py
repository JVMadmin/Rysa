"""Adaptador de base de datos documental sobre PostgreSQL.

Cada entidad se representa como una tabla PostgreSQL real:
    _id  TEXT PRIMARY KEY      (clave lógica: doc['_id'] o doc['id'])
    id   TEXT                   (doc['id'] cuando existe, indexado)
    doc  JSONB NOT NULL         (documento completo)
    <columnas tipadas NUMERIC>  (espejo NUMERIC de campos de dinero/cantidad)

Expone la misma API asíncrona que usa server.py (find_one, find, insert_one,
update_one, delete_one, count_documents, aggregate, next_counter) para que el
monolito funcione sobre PostgreSQL.
"""
import os
import re
import json
import uuid
from typing import Optional
from sqlalchemy import text
from .database import get_engine

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

KNOWN_COLLECTIONS = [
    "users", "products", "clients", "sales", "cajas", "caja_movimientos",
    "inventory_movements", "audit_logs", "refresh_tokens", "login_attempts",
    "files", "settings", "categories", "suspended_sales", "cfdi_documents",
    "pac_config",     "abonos", "counters", "sucursales", "price_lists",
    "mensajes", "plantillas", "favorites", "visits", "seller_locations",
    "sales_routes", "route_stops",
    "proveedores", "compras", "cuentas_bancarias", "costos_historial",
    "compras_ordenes", "compras_recepciones", "presupuestos",
    "centros_costo", "recurrentes",
    "pedidos",
    # Comprobantes de pago por QR (cotizaciones)
    "cot_pago_tokens", "payment_evidence",
]

# Campos de dinero/cantidad espejados a columnas NUMERIC reales.
TYPED_COLUMNS = {
    "sales": ["subtotal", "iva_total", "descuento_total", "total", "cambio", "saldo"],
    "clients": ["saldo", "limite_credito", "latitud", "longitud"],
    "products": ["costo", "existencia", "stock_minimo", "vendidas",
                 "precio_sin_iva", "precio_con_iva", "utilidad", "margen"],
    "cajas": ["fondo_inicial"],
    "caja_movimientos": ["monto"],
    "inventory_movements": ["entrada", "salida", "existencia_anterior", "existencia_resultante", "costo"],
    "abonos": ["monto"],
    "proveedores": ["limite_credito"],
    "compras": ["subtotal", "descuento", "iva", "otros_impuestos", "total",
                "abonado", "saldo_pendiente"],
    "costos_historial": ["cantidad", "costo"],
    "compras_ordenes": ["subtotal", "iva", "total"],
    "compras_recepciones": ["subtotal", "iva", "total"],
    "presupuestos": ["monto"],
    "recurrentes": ["importe"],
    "pedidos": ["subtotal", "iva", "total"],
}

DDL_CACHE = set()


def _quote(name: str) -> str:
    return f'"{name}"'


def _typed_cols(collection: str) -> list:
    return TYPED_COLUMNS.get(collection, [])


def build_create_table(collection: str) -> str:
    cols = _typed_cols(collection)
    defs = "".join(f', "{c}" numeric' for c in cols)
    return (
        f'CREATE TABLE IF NOT EXISTS {_quote(collection)} ('
        f'  "_id" TEXT PRIMARY KEY, "id" TEXT, "doc" JSONB NOT NULL,'
        f'  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(){defs})'
    )


def build_index_ddl(collection: str) -> str:
    return f'CREATE INDEX IF NOT EXISTS idx_{collection}_id ON {_quote(collection)} ("id")'


# DDL automático en runtime. En producción el esquema debe aplicarse con
# Alembic (alembic upgrade head); aquí solo se permite como red de seguridad:
#   ENVIRONMENT=production  ->  DESHABILITADO por defecto
#                               (forzar con RYSA_RUNTIME_DDL=1 si se quiere)
#   desarrollo              ->  habilitado (comodidad de dev)
_RUNTIME_DDL = (
    os.environ.get("RYSA_RUNTIME_DDL", "").strip()
    or ("0" if os.environ.get("ENVIRONMENT", "").lower() == "production" else "1")
) == "1"

# Si un DDL falla (p. ej. usuario sin privilegios), NO reintentar en cada
# petición: cooldown de 60 s antes de volver a intentar.
_DDL_FAILED = {}
_DDL_COOLDOWN_S = 60

import time as _time


async def _ensure_table(collection: str):
    if collection in DDL_CACHE:
        return
    failed_at = _DDL_FAILED.get(collection)
    if failed_at and (_time.monotonic() - failed_at) < _DDL_COOLDOWN_S:
        return  # asumir que la tabla existe; la query real dirá la verdad
    if not _RUNTIME_DDL:
        # Producción: el esquema lo aplica Alembic; no tocar DDL por request.
        DDL_CACHE.add(collection)
        return
    eng = get_engine()
    # Advisory lock de transacción: serializa la migración de esquema de cada
    # colección entre todas las conexiones/procesos. Sin esto, dos peticiones
    # concurrentes bloquean la misma tabla en modo SHARE (CREATE INDEX) y luego
    # ambas intentan subir a AccessExclusiveLock (ALTER TABLE), causando
    # deadlock (share->exclusive upgrade).
    try:
        async with eng.begin() as conn:
            await conn.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
                {"k": f"rysa_ddl:{collection}"})
            await conn.execute(text(build_create_table(collection)))
            await conn.execute(text(build_index_ddl(collection)))
            # Migración idempotente: agregar columnas NUMERIC faltantes a tablas
            # existentes (p. ej. 'vendidas' agregado posteriormente en products).
            for c in _typed_cols(collection):
                await conn.execute(text(
                    f'ALTER TABLE {_quote(collection)} ADD COLUMN IF NOT EXISTS "{c}" numeric'))
    except Exception:
        _DDL_FAILED[collection] = _time.monotonic()
        raise
    _DDL_FAILED.pop(collection, None)
    DDL_CACHE.add(collection)


# --------------------------------------------------------------------------- #
# Compilador de filtros (traduce operadores de consulta a SQL sobre JSONB)     #
# --------------------------------------------------------------------------- #

def _field_expr(field: str) -> str:
    """Expresión SQL: usa columna tipada o extracción JSONB de texto."""
    if field in ("_id", "id"):
        return f't."{field}"'
    return _json_text_expr(field)


def _json_text_expr(field: str) -> str:
    """Extracción JSONB->texto. Soporta rutas anidadas con punto
    (p. ej. 'controles.permitir_venta' -> doc#>>'{controles,permitir_venta}').
    Antes estos filtros se descartaban SILENCIOSAMENTE."""
    parts = str(field).split(".")
    if len(parts) == 1 or not all(_IDENT_RE.match(p) for p in parts):
        return f"t.doc->>'{field}'"
    path = ",".join(parts)
    return f"t.doc#>>'{{{path}}}'"

# Un texto representa un número válido (evita que CAST(text AS numeric)
# lance 22P02 y rompa la consulta completa cuando el doc traja basura).
_NUM_RE_SQL = "'^-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$'"
_BOOL_RE_SQL = "'^(true|false)$'"


def _typed_col(col, field) -> Optional[str]:
    return col if field in _typed_cols(col) else None


def _expr_for(field, col) -> str:
    if field in ("_id", "id"):
        return f't."{field}"'
    if field in _typed_cols(col):
        return f't."{field}"'
    return _json_text_expr(field)


def compile_filter(collection, flt, p) -> str:
    """Convierte un filtro de consulta a una cadena SQL con parámetros p (dict)."""
    if not flt:
        return ""
    conds = []

    def val(v):
        return v

    for field, spec in flt.items():
        if field in ("$and", "$or"):
            sub = []
            for subf in spec:
                s = compile_filter(collection, subf, p)
                sub.append(f"({s})")
            key = f"f{len(p)}"
            p[key] = field
            conds.append("(" + (" AND " if field == "$and" else " OR ").join(sub) + ")")
            continue
        # Acepta campos simples y rutas anidadas 'a.b.c' (todas ident válidas).
        parts = str(field).split(".")
        if not all(_IDENT_RE.match(pt) for pt in parts):
            continue
        expr = _expr_for(field, collection)

        if isinstance(spec, dict) and set(spec) & {"$regex", "$options", "$gt", "$lt", "$gte", "$lte", "$ne", "$exists", "$in", "$nin"}:
            if "$regex" in spec:
                k = f"f{len(p)}"; p[k] = spec["$regex"]
                opts = spec.get("$options", "")
                op = "~*" if "i" in opts else "~"
                conds.append(f"{expr} {op} :{k} AND {expr} IS NOT NULL")
                continue
            if "$exists" in spec:
                conds.append(f"{expr} IS {'NOT NULL' if spec['$exists'] else 'NULL'}")
                continue
            if "$in" in spec or "$nin" in spec:
                items = spec.get("$in") or spec.get("$nin") or []
                txt = [i for i in items if i is not None]
                k = f"f{len(p)}"; p[k] = txt
                if "$in" in spec:
                    conds.append(f"{expr} = ANY(:{k})")
                else:
                    conds.append(f"({expr} IS NOT NULL AND {expr} <> ALL(:{k}))")
                continue
            for op in ("$gt", "$gte", "$lt", "$lte"):
                if op in spec:
                    k = f"f{len(p)}"; p[k] = spec[op]
                    sqlop = {"$gt": ">", "$gte": ">=", "$lt": "<", "$lte": "<="}[op]
                    _v = spec[op]
                    if field in _typed_cols(collection):
                        # Columna tipada NUMERIC real: comparación directa.
                        # (El guard regex `expr ~ '...'` solo aplica a texto
                        # JSONB; sobre NUMERIC lanza UndefinedFunctionError.)
                        conds.append(f'({expr}) {sqlop} CAST(:{k} AS numeric)')
                    elif isinstance(_v, str):
                        # Texto (fechas ISO, códigos): comparación lexicográfica
                        # directa. Antes se forzaba CAST numérico y rompía con
                        # DataError para valores no numéricos.
                        conds.append(f"(({expr}) IS NOT NULL AND ({expr}) {sqlop} :{k})")
                    else:
                        # Guard de formato: si el texto no es numérico no participa
                        # (antes un CAST sobre basura rompía la consulta completa).
                        conds.append(
                            f"(({expr}) ~ {_NUM_RE_SQL} AND CAST(({expr}) AS numeric) {sqlop} :{k})")
                    continue
            if "$ne" in spec:
                v = spec["$ne"]
                if isinstance(v, bool):
                    k = f"f{len(p)}"; p[k] = v
                    # $ne bool: también coinciden los docs SIN el campo o con
                    # valor no booleano (misma semántica que el original).
                    conds.append(
                        f"(({expr}) IS NULL OR NOT (({expr}) ~ {_BOOL_RE_SQL} "
                        f"AND CAST(({expr}) AS boolean) IS NOT DISTINCT FROM :{k}))")
                else:
                    k = f"f{len(p)}"; p[k] = v
                    conds.append(f"({expr} IS DISTINCT FROM :{k})")
                continue
            continue

        # Comparación de igualdad con tipado según el valor.
        if isinstance(spec, bool):
            k = f"f{len(p)}"; p[k] = spec
            conds.append(f"(({expr}) ~ {_BOOL_RE_SQL} AND CAST(({expr}) AS boolean) = :{k})")
        elif isinstance(spec, (int, float)):
            k = f"f{len(p)}"; p[k] = spec
            conds.append(f"((({expr}) ~ {_NUM_RE_SQL} AND CAST(({expr}) AS numeric) = :{k})"
                         f" OR {expr} = CAST(:{k} AS text))")
        else:
            k = f"f{len(p)}"; p[k] = spec
            conds.append(f"{expr} = :{k}")
    return " AND ".join(conds)


def _apply_projection(doc: dict, projection) -> dict:
    if not projection:
        return doc
    include = {k: (0 if int(v) == 0 else 1) for k, v in projection.items()}
    if any(v == 1 for v in include.values()):
        return {k: doc.get(k) for k, v in include.items() if v == 1}
    # Modo exclusión: se quitan SOLO las claves explícitas, se conserva el resto.
    return {k: v for k, v in doc.items() if include.get(k) != 0}


def _extract_key(doc: dict) -> str:
    if "_id" in doc:
        return str(doc["_id"])
    if "id" in doc:
        return str(doc["id"])
    return uuid.uuid4().hex


class Cursor:
    def __init__(self, collection, flt, projection=None):
        self.collection = collection
        self.flt = flt or {}
        self.projection = projection
        self.order_by = []
        self._skip = 0
        self._limit = None

    def sort(self, field, direction=1):
        self.order_by.append((field, direction))
        return self

    def skip(self, n):
        self._skip = n
        return self

    def limit(self, n):
        self._limit = n
        return self

    async def _run(self, limit_override=None):
        await _ensure_table(self.collection)
        p = {}
        where = compile_filter(self.collection, self.flt, p)
        sql = f"SELECT t.doc AS doc FROM {_quote(self.collection)} t"
        if where:
            sql += " WHERE " + where
        for field, direction in self.order_by:
            fexpr = _field_expr(field)
            sql += f" ORDER BY {fexpr} {'ASC' if direction >= 0 else 'DESC'}"
        lim = self._limit if self._limit is not None else limit_override
        if lim is not None:
            sql += f" LIMIT {int(lim)}"
        if self._skip:
            sql += f" OFFSET {int(self._skip)}"
        eng = get_engine()
        async with eng.connect() as conn:
            res = await conn.execute(text(sql), p)
            rows = res.fetchall()
        return [_apply_projection(dict(r[0]), self.projection) for r in rows]

    def to_list(self, n=None):
        async def _to_list():
            return await self._run(n)
        return _to_list()

    def __aiter__(self):
        return self._agen()

    async def _agen(self):
        rows = await self._run(self._limit)
        for r in rows:
            yield r


class PGCollection:
    def __init__(self, name):
        self.name = name

    def __repr__(self):
        return f"<PGCollection {self.name}>"

    async def _find_doc(self, flt, conn) -> Optional[dict]:
        p = {}
        where = compile_filter(self.name, flt, p)
        sql = f"SELECT t.doc AS doc FROM {_quote(self.name)} t"
        if where:
            sql += " WHERE " + where
        sql += " LIMIT 1"
        res = await conn.execute(text(sql), p)
        row = res.first()
        return dict(row[0]) if row else None

    def find_one(self, flt=None, projection=None):
        async def _f():
            await _ensure_table(self.name)
            eng = get_engine()
            async with eng.connect() as conn:
                doc = await self._find_doc(flt or {}, conn)
                await conn.commit()
            if doc is None:
                return None
            return _apply_projection(doc, projection)
        return _f()

    def find(self, flt=None, projection=None):
        return Cursor(self.name, flt or {}, projection)

    async def insert_one(self, doc):
        await _ensure_table(self.name)
        doc = dict(doc)
        key = _extract_key(doc)
        doc.pop("_id", None)
        doc_id = doc.get("id")
        eng = get_engine()
        typed = {}
        for c in _typed_cols(self.name):
            v = doc.get(c)
            if v is not None:
                typed[c] = v
        async with eng.connect() as conn:
            cols = '"_id", "id", "doc"' + (", " + ", ".join(f'"{c}"' for c in typed) if typed else "")
            params = {"_id": key, "id": doc_id, "doc": json.dumps(doc, ensure_ascii=False, default=str)}
            params.update(typed)
            placeholder = ":_id, :id, :doc" + (", " + ", ".join(f":{c}" for c in typed) if typed else "")
            await conn.execute(text(
                f'INSERT INTO {_quote(self.name)} ({cols}) VALUES ({placeholder})'
            ), params)
            await conn.commit()
        return None

    def update_one(self, flt, update, upsert=False):
        return self._update(flt, update, upsert, many=False)

    def update_many(self, flt, update):
        return self._update(flt, update, False, many=True)

    async def _update(self, flt, update, upsert, many):
        await _ensure_table(self.name)
        flt = flt or {}
        p = {}
        col_sets = []
        doc_types = _typed_cols(self.name)
        expr = "doc"
        for field, val in (update or {}).items():
            if field == "$set":
                for f, v in val.items():
                    if not _IDENT_RE.match(str(f)): continue
                    k = f"u{len(p)}"; p[k] = json.dumps(v, ensure_ascii=False, default=str)
                    expr = f"jsonb_set({expr}, '{{{f}}}', CAST(:{k} AS jsonb), true)"
                    if f in doc_types:
                        tval = 1 if (v is True) else (0 if v is False else v)
                        nk = f"tn{len(p)}"; p[nk] = tval
                        col_sets.append(f'"{f}" = :{nk}')
            elif field == "$inc":
                for f, v in val.items():
                    if not _IDENT_RE.match(str(f)): continue
                    k = f"u{len(p)}"; p[k] = v
                    expr = (f"jsonb_set({expr}, '{{{f}}}', "
                            f"CAST(CAST(COALESCE(({expr}->>'{f}')::numeric, 0) + CAST(:{k} AS numeric) AS text) AS jsonb), true)")
                    if f in doc_types:
                        nk = f"n{len(p)}"; p[nk] = v
                        col_sets.append(f'"{f}" = COALESCE("{f}", 0) + :{nk}')
            elif field == "$setOnInsert":
                pass
        if expr == "doc":
            return 0
        sets = [f"doc = {expr}"] + col_sets
        where = compile_filter(self.name, flt, p)
        sql = f"UPDATE {_quote(self.name)} AS t SET " + ", ".join(sets)
        if where:
            sql += " WHERE " + where
        eng = get_engine()
        async with eng.connect() as conn:
            res = await conn.execute(text(sql), p)
            if upsert and res.rowcount == 0:
                # Upsert: construir el doc a partir de $set + claves del filtro e
                # insertarlo en la MISMA conexión (evita abrir una conexión
                # anidada del pool, que puede quedarse esperando indefinidamente).
                newdoc = {}
                for f, v in (update or {}).get("$set", {}).items():
                    newdoc[f] = v
                for f, v in (flt or {}).items():
                    if isinstance(v, (str, int, float, bool)) and f not in ("$and", "$or"):
                        if isinstance(v, dict):
                            if "id" in v and f == "id":
                                newdoc.setdefault("id", v["id"]); newdoc.setdefault("_id", v["id"])
                            continue
                        newdoc.setdefault(f, v)
                key = _extract_key(newdoc)
                newdoc.pop("_id", None)
                doc_id = newdoc.get("id")
                typed = {c: newdoc.get(c) for c in _typed_cols(self.name) if newdoc.get(c) is not None}
                cols = '"_id", "id", "doc"' + (", " + ", ".join(f'"{c}"' for c in typed) if typed else "")
                params = {"_id": key, "id": doc_id, "doc": json.dumps(newdoc, ensure_ascii=False, default=str)}
                params.update(typed)
                placeholder = ":_id, :id, :doc" + (", " + ", ".join(f":{c}" for c in typed) if typed else "")
                await conn.execute(text(
                    f'INSERT INTO {_quote(self.name)} ({cols}) VALUES ({placeholder})'), params)
            await conn.commit()
        return res.rowcount if not upsert else (0 if res.rowcount == 0 else res.rowcount)

    async def delete_one(self, flt):
        await _ensure_table(self.name)
        return await self._delete(flt, one=True)

    async def delete_many(self, flt):
        await _ensure_table(self.name)
        return await self._delete(flt, one=False)

    async def _delete(self, flt, one):
        flt = flt or {}
        p = {}
        where = compile_filter(self.name, flt, p)
        sql = f"DELETE FROM {_quote(self.name)} t"
        if where:
            sql += " WHERE " + where
        eng = get_engine()
        async with eng.connect() as conn:
            res = await conn.execute(text(sql), p)
            await conn.commit()
        return res.rowcount

    async def count_documents(self, flt=None):
        await _ensure_table(self.name)
        p = {}
        where = compile_filter(self.name, flt or {}, p)
        sql = f"SELECT COUNT(*) AS n FROM {_quote(self.name)} t"
        if where:
            sql += " WHERE " + where
        eng = get_engine()
        async with eng.connect() as conn:
            res = await conn.execute(text(sql), p)
            row = res.first()
            await conn.commit()
        return row[0]

    def aggregate(self, pipeline):
        async def _gen():
            for r in await self._aggregate(pipeline):
                yield r
        return _gen()

    def create_index(self, *args, **kwargs):
        async def _nop():
            return None
        return _nop()

    def drop_index(self, *args, **kwargs):
        async def _nop():
            return None
        return _nop()

    def index_information(self, *args, **kwargs):
        async def _nop():
            return {}
        return _nop()

    async def _aggregate(self, pipeline):
        await _ensure_table(self.name)
        p = {}
        match = next((st for st in pipeline if "$match" in st), {})["$match"]
        group = next((st for st in pipeline if "$group" in st), {}).get("$group", {})
        pid = group.get("_id", "_id")
        if isinstance(pid, str) and pid.startswith("$"):
            pid = pid[1:]
        where = compile_filter(self.name, match, p)
        sql = f"SELECT t.doc->>'{pid}' AS _id, COUNT(*) AS count FROM {_quote(self.name)} t"
        if where:
            sql += " WHERE " + where
        sql += " GROUP BY 1"
        eng = get_engine()
        async with eng.connect() as conn:
            res = await conn.execute(text(sql), p)
            rows = res.fetchall()
            await conn.commit()
        out = []
        for r in rows:
            out.append({"_id": r[0], "count": r[1]})
        return out


class SequencesCollection:
    """`counters` -> tabla `sequences` (folios/códigos).

    Mantiene consistencia con pg_next_counter (misma fuente de verdad)."""

    def find_one(self, flt=None, projection=None):
        async def _f():
            await ensure_sequences_table()
            name = (flt or {}).get("_id")
            eng = get_engine()
            async with eng.connect() as conn:
                res = await conn.execute(
                    text('SELECT seq FROM "sequences" WHERE name = :n'), {"n": name})
                row = res.first()
                await conn.commit()
            return {"_id": name, "seq": int(row[0])} if row else None
        return _f()

    def count_documents(self, flt=None):
        async def _f():
            await ensure_sequences_table()
            eng = get_engine()
            async with eng.connect() as conn:
                res = await conn.execute(text('SELECT COUNT(*) FROM "sequences"'))
                row = res.first()
                await conn.commit()
            return row[0]
        return _f()

    def find(self, flt=None, projection=None):
        class _Cursor:
            def sort(self, *a, **k): return self
            def skip(self, n): return self
            def limit(self, n): return self
            def to_list(self, n=None):
                async def _tl():
                    await ensure_sequences_table()
                    eng = get_engine()
                    async with eng.connect() as conn:
                        res = await conn.execute(text('SELECT name, seq FROM "sequences"'))
                        rows = res.fetchall()
                        await conn.commit()
                    return [{"_id": r[0], "seq": int(r[1])} for r in rows]
                return _tl()
            def __aiter__(self):
                return self._agen()
            async def _agen(self):
                for d in await self.to_list():
                    yield d
        return _Cursor()

    def insert_one(self, doc):
        async def _f():
            await ensure_sequences_table()
            name = doc.get("_id") or doc.get("name")
            seq = int(doc.get("seq", 0))
            eng = get_engine()
            async with eng.begin() as conn:
                await conn.execute(text(
                    'INSERT INTO "sequences" (name, seq) VALUES (:n, :s) '
                    'ON CONFLICT (name) DO UPDATE SET seq = EXCLUDED.seq'),
                    {"n": name, "s": seq})
            return None
        return _f()

    def update_one(self, flt, update, upsert=False):
        return self.insert_one({"_id": (flt or {}).get("_id"), "seq": ((update or {}).get("$set") or {}).get("seq", 0)})


class PGDatabase:
    """db.<coleccion> -> PGCollection"""

    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name not in KNOWN_COLLECTIONS:
            raise AttributeError(name)
        if name == "counters":
            if "counters" not in self._cols:
                self._cols["counters"] = SequencesCollection()
            return self._cols["counters"]
        if name not in self._cols:
            self._cols[name] = PGCollection(name)
        return self._cols[name]

    def list_collection_names(self):
        return list(KNOWN_COLLECTIONS)


# --------------------------------------------------------------------------- #
# Secuencias / folios (concurrencia segura con row-locking)                    #
# --------------------------------------------------------------------------- #
_SEQUENCES_READY = False


async def ensure_sequences_table():
    """Crea la tabla de secuencias UNA sola vez por proceso (antes ejecutaba
    CREATE TABLE IF NOT EXISTS en CADA asignación de folio: lock innecesario
    por venta/abono)."""
    global _SEQUENCES_READY
    if _SEQUENCES_READY:
        return
    eng = get_engine()
    async with eng.connect() as conn:
        await conn.execute(text(
            'CREATE TABLE IF NOT EXISTS "sequences" ('
            '  "name" TEXT PRIMARY KEY, "seq" BIGINT NOT NULL DEFAULT 0)'
        ))
        await conn.commit()
    _SEQUENCES_READY = True


async def pg_next_counter(name: str, prefix: str = "", padding: int = 5) -> str:
    """Genera el siguiente folio de forma atómica.

    Usa una transacción con SELECT ... FOR UPDATE sobre la fila `sequences`
    para serializar la asignación; así dos cajas nunca obtienen el mismo folio.
    """
    await ensure_sequences_table()
    eng = get_engine()
    async with eng.begin() as conn:
        res = await conn.execute(
            text('INSERT INTO "sequences" (name, seq) VALUES (:n, 0) '
                 'ON CONFLICT (name) DO NOTHING'), {"n": name})
        res = await conn.execute(
            text('SELECT seq FROM "sequences" WHERE name = :n FOR UPDATE'),
            {"n": name})
        row = res.first()
        seq = int(row[0]) + 1
        await conn.execute(
            text('UPDATE "sequences" SET seq = :s WHERE name = :n'),
            {"s": seq, "n": name})
    return f"{prefix}{str(seq).zfill(padding)}"
