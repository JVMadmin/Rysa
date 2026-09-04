"""Servicio de Reemplazo Total de Datos Operativos (Master Data vs Historial).

Permite importar y reemplazar totalmente la información operativa (clientes, productos,
existencias y saldos) desde los archivos DBF en staging/legacy_data, preservando de
forma inmutable el historial comercial (ventas, abonos, movimientos de caja, CFDI y auditoría).

Pipeline:
  1. Preview cuantitativo y cualitativo (nuevos, actualizados, ausentes/inactivos, saldos).
  2. Snapshot de seguridad previo en `import_snapshots`.
  3. Reemplazo atómico en PostgreSQL con actualización de presentaciones e inventario base.
  4. Recálculo automático de saldos CxC basándose en ventas y abonos confirmados.
  5. Rollback determinístico a partir del snapshot.
"""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import text

from tools.legacy_migration.dbf_reader import iter_records
import tools.legacy_migration.config as leg_cfg
from pgstore.cxc import recalcular_saldos_cxc


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid() -> str:
    return uuid.uuid4().hex


def _norm(val) -> str:
    return str(val or "").strip()


async def generar_preview_reemplazo(conn, legacy_path: Path | None = None) -> dict:
    """Genera la matriz previa de reemplazo total leyendo los archivos DBF fuente
    y comparándolos contra la base de datos de producción."""
    d = legacy_path or leg_cfg.resolve_legacy_data_path()
    if not d.is_dir():
        return {"error": f"No se encontró el directorio de datos: {d}", "ok": False}

    # 1. Leer CLIENTES.dbf
    clientes_dbf = {}
    cli_path = d / "CLIENTES.dbf"
    if cli_path.is_file():
        for r in iter_records(cli_path):
            clave = _norm(r.get("CLAVE"))
            if clave:
                clientes_dbf[clave] = {
                    "codigo": clave,
                    "nombre": _norm(r.get("NOMBRE")),
                    "rfc": _norm(r.get("RFC")),
                    "direccion": _norm(r.get("DIRECCION")),
                    "colonia": _norm(r.get("COLONIA")),
                    "ciudad": _norm(r.get("CIUDAD")),
                    "telefono": _norm(r.get("TELEFONO")),
                    "saldo": round(float(r.get("SALDO") or 0.0), 2),
                    "limite_credito": round(float(r.get("LIMCRED") or 0.0), 2),
                    "dias_credito": int(r.get("DIASCRED") or 0),
                    "_deleted": r.get("_deleted", False)
                }

    # 2. Leer ARTICULO.dbf
    articulos_dbf = {}
    art_path = d / "ARTICULO.dbf"
    if art_path.is_file():
        for r in iter_records(art_path):
            cod = _norm(r.get("CODIGO"))
            if cod:
                costo = round(float(r.get("COSTO") or 0.0), 4)
                precio = round(float(r.get("PRECIO1") or 0.0), 2)
                exist = round(float(r.get("EXISTENCIA") or 0.0), 3)
                min_stock = round(float(r.get("MINIMO") or 0.0), 3)
                articulos_dbf[cod] = {
                    "codigo": cod,
                    "descripcion": _norm(r.get("DESCRIP")),
                    "linea": _norm(r.get("LINEA")),
                    "unidad_medida": _norm(r.get("UNIDAD") or "PZA"),
                    "costo": costo,
                    "precio_con_iva": precio,
                    "existencia": exist,
                    "stock_minimo": min_stock,
                    "_deleted": r.get("_deleted", False)
                }

    # 3. Comparar con BD producción
    prod_rows = await conn.execute(
        text("SELECT id, doc->>'codigo' AS codigo, doc, existencia, precio_con_iva, costo FROM products")
    )
    prod_db = {r.codigo: dict(r._mapping) for r in prod_rows.fetchall() if r.codigo}

    cli_rows = await conn.execute(
        text("SELECT id, doc->>'codigo' AS codigo, doc, saldo FROM clients")
    )
    cli_db = {r.codigo: dict(r._mapping) for r in cli_rows.fetchall() if r.codigo}

    # Clientes
    cli_nuevos = [c for cod, c in clientes_dbf.items() if cod not in cli_db and not c["_deleted"]]
    cli_actualizados = [c for cod, c in clientes_dbf.items() if cod in cli_db]
    cli_ausentes = [cod for cod in cli_db if cod not in clientes_dbf]
    saldo_total_fuente = sum(c["saldo"] for c in clientes_dbf.values() if not c["_deleted"])

    # Productos
    prod_nuevos = [p for cod, p in articulos_dbf.items() if cod not in prod_db and not p["_deleted"]]
    prod_actualizados = [p for cod, p in articulos_dbf.items() if cod in prod_db]
    prod_ausentes = [cod for cod in prod_db if cod not in articulos_dbf]
    prod_exist_cero = sum(1 for p in articulos_dbf.values() if p["existencia"] <= 0 and not p["_deleted"])
    exist_total_fuente = sum(p["existencia"] for p in articulos_dbf.values() if not p["_deleted"])

    return {
        "ok": True,
        "timestamp": now_iso(),
        "clientes": {
            "total_fuente": len(clientes_dbf),
            "nuevos": len(cli_nuevos),
            "actualizados": len(cli_actualizados),
            "ausentes_a_inactivar": len(cli_ausentes),
            "saldo_total_fuente": round(saldo_total_fuente, 2),
            "ejemplos_nuevos": [c["codigo"] + " - " + c["nombre"] for c in cli_nuevos[:5]],
            "ejemplos_actualizados": [c["codigo"] + " - " + c["nombre"] for c in cli_actualizados[:5]],
        },
        "productos": {
            "total_fuente": len(articulos_dbf),
            "nuevos": len(prod_nuevos),
            "actualizados": len(prod_actualizados),
            "ausentes_a_inactivar": len(prod_ausentes),
            "existencia_total_fuente": round(exist_total_fuente, 2),
            "con_existencia_cero": prod_exist_cero,
            "ejemplos_nuevos": [p["codigo"] + " - " + p["descripcion"] for p in prod_nuevos[:5]],
            "ejemplos_actualizados": [p["codigo"] + " - " + p["descripcion"] for p in prod_actualizados[:5]],
        }
    }


async def ejecutar_reemplazo_total(conn, user: dict, legacy_path: Path | None = None) -> dict:
    """Ejecuta el reemplazo total atómicamente:
    1. Guarda snapshot de los registros existentes que serán tocados.
    2. Actualiza e inserta clientes y productos con existencias y saldos.
    3. Inactiva registros que ya no vienen en la fuente.
    4. Sincroniza presentaciones base en `product_presentations`.
    5. Recalcula saldos de CxC."""
    batch_id = f"REPLACE-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    user_id = user.get("id")
    user_name = user.get("name", "Administrador")

    # Registrar lote
    await conn.execute(
        text("""
            INSERT INTO import_batches (batch_id, tipo, estado, usuario_id, usuario_nombre, created_at)
            VALUES (:b, 'TOTAL_REPLACEMENT', 'APPLYING', :uid, :uname, now())
        """),
        {"b": batch_id, "uid": user_id, "uname": user_name}
    )

    d = legacy_path or leg_cfg.resolve_legacy_data_path()
    preview = await generar_preview_reemplazo(conn, d)
    if not preview.get("ok"):
        raise ValueError(preview.get("error", "Error generando previa"))

    # A) SNAPSHOT DE PRODUCTOS PREVIOS
    await conn.execute(
        text("""
            INSERT INTO import_snapshots (id, batch_id, tabla, registro_id, estado_previo, created_at)
            SELECT 'snap_' || gen_random_uuid(), :b, 'products', id, doc, now()
            FROM products
        """),
        {"b": batch_id}
    )

    # B) SNAPSHOT DE CLIENTES PREVIOS
    await conn.execute(
        text("""
            INSERT INTO import_snapshots (id, batch_id, tabla, registro_id, estado_previo, created_at)
            SELECT 'snap_' || gen_random_uuid(), :b, 'clients', id, doc, now()
            FROM clients
        """),
        {"b": batch_id}
    )

    # C) APLICAR CLIENTES
    cli_path = d / "CLIENTES.dbf"
    codigos_fuente_cli = set()
    creados_cli = 0
    actualizados_cli = 0

    if cli_path.is_file():
        for r in iter_records(cli_path):
            clave = _norm(r.get("CLAVE"))
            if not clave:
                continue
            codigos_fuente_cli.add(clave)
            nombre = _norm(r.get("NOMBRE"))
            rfc = _norm(r.get("RFC"))
            dir_ = _norm(r.get("DIRECCION"))
            tel = _norm(r.get("TELEFONO"))
            saldo = round(float(r.get("SALDO") or 0.0), 2)
            dias_cred = int(r.get("DIASCRED") or 0)
            lim_cred = round(float(r.get("LIMCRED") or 0.0), 2)
            is_del = r.get("_deleted", False)

            existing = (await conn.execute(
                text("SELECT id, doc FROM clients WHERE doc->>'codigo' = :c"),
                {"c": clave}
            )).first()

            if existing:
                cid = existing[0]
                doc = dict(existing[1])
                doc["nombre"] = nombre
                doc["rfc"] = rfc
                doc["direccion"] = dir_
                doc["telefono"] = tel
                doc["saldo"] = saldo
                doc["legacy_master_saldo"] = saldo
                doc["dias_credito"] = dias_cred
                doc["limite_credito"] = lim_cred
                doc["estado"] = "inactivo" if is_del else "activo"
                doc["updated_at"] = now_iso()

                await conn.execute(
                    text("""
                        UPDATE clients
                        SET saldo = :s, limite_credito = :l,
                            doc = CAST(:d AS jsonb)
                        WHERE id = :i
                    """),
                    {"s": saldo, "l": lim_cred, "d": json.dumps(doc, ensure_ascii=False, default=str), "i": cid}
                )
                actualizados_cli += 1
            elif not is_del:
                cid = uid()
                doc = {
                    "id": cid, "_id": cid, "codigo": clave, "nombre": nombre, "rfc": rfc,
                    "direccion": dir_, "telefono": tel, "saldo": saldo, "legacy_master_saldo": saldo,
                    "dias_credito": dias_cred,
                    "limite_credito": lim_cred, "estado": "activo", "tipo": "publico",
                    "created_at": now_iso(), "updated_at": now_iso()
                }
                await conn.execute(
                    text("""
                        INSERT INTO clients ("_id", "id", "doc", "created_at", "saldo", "limite_credito")
                        VALUES (:i, :i, CAST(:d AS jsonb), now(), :s, :l)
                    """),
                    {"i": cid, "d": json.dumps(doc, ensure_ascii=False, default=str), "s": saldo, "l": lim_cred}
                )
                creados_cli += 1

    # Inactivar clientes ausentes
    inactivados_cli = 0
    all_cli_rows = (await conn.execute(text("SELECT id, doc->>'codigo' FROM clients WHERE doc->>'codigo' IS NOT NULL"))).fetchall()
    to_inactivate_cli = [r[0] for r in all_cli_rows if r[1] and r[1] not in codigos_fuente_cli]
    if to_inactivate_cli:
        res = await conn.execute(
            text("""
                UPDATE clients
                SET doc = jsonb_set(doc, '{estado}', '"inactivo"')
                WHERE id = ANY(:ids)
            """),
            {"ids": to_inactivate_cli}
        )
        inactivados_cli = res.rowcount or 0

    # D) APLICAR PRODUCTOS
    art_path = d / "ARTICULO.dbf"
    codigos_fuente_art = set()
    creados_prod = 0
    actualizados_prod = 0

    if art_path.is_file():
        for r in iter_records(art_path):
            cod = _norm(r.get("CODIGO"))
            if not cod:
                continue
            codigos_fuente_art.add(cod)
            desc = _norm(r.get("DESCRIP"))
            linea = _norm(r.get("LINEA"))
            unidad = _norm(r.get("UNIDAD") or "PZA")
            costo = round(float(r.get("COSTO") or 0.0), 4)
            precio = round(float(r.get("PRECIO1") or 0.0), 2)
            exist = round(float(r.get("EXISTENCIA") or 0.0), 3)
            min_stock = round(float(r.get("MINIMO") or 0.0), 3)
            is_del = r.get("_deleted", False)

            existing = (await conn.execute(
                text("SELECT id, doc FROM products WHERE doc->>'codigo' = :c"),
                {"c": cod}
            )).first()

            if existing:
                pid = existing[0]
                doc = dict(existing[1])
                doc["descripcion"] = desc
                doc["linea"] = linea
                doc["unidad_medida"] = unidad
                doc["costo"] = costo
                doc["precio_con_iva"] = precio
                doc["precio_sin_iva"] = round(precio / 1.16, 2)
                doc["existencia"] = exist
                doc["stock_minimo"] = min_stock
                doc["estado"] = "inactivo" if is_del else "activo"
                doc["updated_at"] = now_iso()

                await conn.execute(
                    text("""
                        UPDATE products
                        SET costo = :costo, existencia = :exist, stock_minimo = :min_stock,
                            precio_con_iva = :precio, precio_sin_iva = :psin,
                            doc = CAST(:d AS jsonb)
                        WHERE id = :i
                    """),
                    {
                        "costo": costo, "exist": exist, "min_stock": min_stock,
                        "precio": precio, "psin": doc["precio_sin_iva"],
                        "d": json.dumps(doc, ensure_ascii=False, default=str), "i": pid
                    }
                )

                # Actualizar presentación base
                await conn.execute(
                    text("""
                        UPDATE product_presentations
                        SET precio = :p, costo = :c, nombre = :n, updated_at = now()
                        WHERE product_id = :pid AND es_base = TRUE
                    """),
                    {"p": precio, "c": costo, "n": unidad, "pid": pid}
                )
                actualizados_prod += 1
            elif not is_del:
                pid = uid()
                doc = {
                    "id": pid, "_id": pid, "codigo": cod, "descripcion": desc, "linea": linea,
                    "unidad_medida": unidad, "costo": costo, "precio_con_iva": precio,
                    "precio_sin_iva": round(precio / 1.16, 2), "existencia": exist,
                    "stock_minimo": min_stock, "estado": "activo", "vendidas": 0.0,
                    "created_at": now_iso(), "updated_at": now_iso()
                }
                await conn.execute(
                    text("""
                        INSERT INTO products ("_id", "id", "doc", "created_at", "costo", "existencia",
                                             "stock_minimo", "vendidas", "precio_sin_iva", "precio_con_iva")
                        VALUES (:i, :i, CAST(:d AS jsonb), now(), :costo, :exist, :min_stock, 0.0, :psin, :precio)
                    """),
                    {
                        "i": pid, "d": json.dumps(doc, ensure_ascii=False, default=str),
                        "costo": costo, "exist": exist, "min_stock": min_stock,
                        "psin": doc["precio_sin_iva"], "precio": precio
                    }
                )

                # Insertar presentación base
                pres_id = f"pres_{pid}"
                await conn.execute(
                    text("""
                        INSERT INTO product_presentations (
                            id, product_id, nombre, factor, precio, costo,
                            es_base, es_predeterminada, activo, created_at, updated_at
                        )
                        VALUES (:prid, :pid, :n, 1.0, :p, :c, TRUE, TRUE, TRUE, now(), now())
                        ON CONFLICT (product_id, nombre) DO NOTHING
                    """),
                    {"prid": pres_id, "pid": pid, "n": unidad, "p": precio, "c": costo}
                )
                creados_prod += 1

    # Inactivar productos ausentes
    inactivados_prod = 0
    all_prod_rows = (await conn.execute(text("SELECT id, doc->>'codigo' FROM products WHERE doc->>'codigo' IS NOT NULL"))).fetchall()
    to_inactivate_prod = [r[0] for r in all_prod_rows if r[1] and r[1] not in codigos_fuente_art]
    if to_inactivate_prod:
        res = await conn.execute(
            text("""
                UPDATE products
                SET doc = jsonb_set(doc, '{estado}', '"inactivo"')
                WHERE id = ANY(:ids)
            """),
            {"ids": to_inactivate_prod}
        )
        inactivados_prod = res.rowcount or 0

    # E) RECÁLCULO DE SALDOS CXC
    cxc_res = await recalcular_saldos_cxc(conn)

    # Actualizar estado de batch
    stats = {
        "clientes": {"creados": creados_cli, "actualizados": actualizados_cli, "inactivados": inactivados_cli},
        "productos": {"creados": creados_prod, "actualizados": actualizados_prod, "inactivados": inactivados_prod},
        "cxc": cxc_res
    }

    await conn.execute(
        text("""
            UPDATE import_batches
            SET estado = 'COMPLETED', estadisticas = CAST(:s AS jsonb), applied_at = now()
            WHERE batch_id = :b
        """),
        {"s": json.dumps(stats, ensure_ascii=False, default=str), "b": batch_id}
    )

    # Auditoría
    audit = {
        "id": uid(), "usuario_id": user_id, "usuario_nombre": user_name,
        "accion": "import_reemplazo_total", "entidad": "import_batches",
        "registro_id": batch_id, "detalle": f"Reemplazo total {batch_id}: {stats}",
        "fecha": now_iso()
    }
    await conn.execute(
        text('INSERT INTO audit_logs ("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
        {"k": audit["id"], "d": json.dumps(audit, ensure_ascii=False, default=str)}
    )

    return {
        "ok": True,
        "batch_id": batch_id,
        "estadisticas": stats
    }


async def revertir_reemplazo(conn, batch_id: str, user: dict) -> dict:
    """Revierte un reemplazo total usando los registros guardados en `import_snapshots`."""
    user_id = user.get("id")
    user_name = user.get("name", "Administrador")

    snaps = (await conn.execute(
        text("SELECT tabla, registro_id, estado_previo FROM import_snapshots WHERE batch_id = :b"),
        {"b": batch_id}
    )).fetchall()

    if not snaps:
        raise ValueError(f"No se encontraron snapshots para el lote {batch_id}")

    revertidos = 0
    for tabla, reg_id, prev in snaps:
        prev_doc = dict(prev)
        if tabla == "products":
            await conn.execute(
                text("""
                    UPDATE products
                    SET costo = :costo, existencia = :exist, stock_minimo = :min_stock,
                        precio_con_iva = :piva, precio_sin_iva = :psin,
                        doc = CAST(:d AS jsonb)
                    WHERE id = :i
                """),
                {
                    "costo": float(prev_doc.get("costo") or 0),
                    "exist": float(prev_doc.get("existencia") or 0),
                    "min_stock": float(prev_doc.get("stock_minimo") or 0),
                    "piva": float(prev_doc.get("precio_con_iva") or 0),
                    "psin": float(prev_doc.get("precio_sin_iva") or 0),
                    "d": json.dumps(prev_doc, ensure_ascii=False, default=str),
                    "i": reg_id
                }
            )
            revertidos += 1
        elif tabla == "clients":
            await conn.execute(
                text("""
                    UPDATE clients
                    SET saldo = :s, limite_credito = :l,
                        doc = CAST(:d AS jsonb)
                    WHERE id = :i
                """),
                {
                    "s": float(prev_doc.get("saldo") or 0),
                    "l": float(prev_doc.get("limite_credito") or 0),
                    "d": json.dumps(prev_doc, ensure_ascii=False, default=str),
                    "i": reg_id
                }
            )
            revertidos += 1

    await recalcular_saldos_cxc(conn)

    await conn.execute(
        text("UPDATE import_batches SET estado = 'ROLLED_BACK' WHERE batch_id = :b"),
        {"b": batch_id}
    )

    audit = {
        "id": uid(), "usuario_id": user_id, "usuario_nombre": user_name,
        "accion": "import_rollback", "entidad": "import_batches",
        "registro_id": batch_id, "detalle": f"Rollback de {revertidos} registros para lote {batch_id}",
        "fecha": now_iso()
    }
    await conn.execute(
        text('INSERT INTO audit_logs ("_id","id","doc") VALUES (CAST(:k AS text),CAST(:k AS text),CAST(:d AS jsonb))'),
        {"k": audit["id"], "d": json.dumps(audit, ensure_ascii=False, default=str)}
    )

    return {"ok": True, "batch_id": batch_id, "registros_revertidos": revertidos}
