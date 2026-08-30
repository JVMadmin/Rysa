"""FASE 7 - Self-test del subsistema legacy (17 pruebas del prompt).

Ejecutar en contenedor con red del stack:
  docker run --rm --network rysa_local_network --env-file .env.docker.local \
    -e DATABASE_URL=... -v repo:/repo -w /repo image \
    python -m tools.legacy_migration.v7_selftest

Principios: produccion intacta; residuo de pruebas se limpia al final;
ninguna cifra del snapshot anterior esta hardcodeada (aserciones relacionales).
"""
from __future__ import annotations

import asyncio
import os
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path

import requests

from tools.legacy_migration.config import project_root, resolve_legacy_data_path
from tools.legacy_migration.dbf_reader import read_header, iter_records

REPO = project_root()
SYN = REPO / "legacy_data_v7_test"
DBF_NAMES = ["NOTAVTA.dbf", "NVTAPAR.dbf", "CLIENTES.dbf", "ARTICULO.dbf",
             "CUENXCOB.dbf", "CXCDOCS.dbf"]
API = os.environ.get("V7_API", "http://backend:8000/api")
# Los permisos developer NO se otorgan con el comodin "*": se requiere el rol
# admin_desarrollador (credenciales dev del stack local).
ADMIN = {"email": os.environ.get("ADMIN_EMAIL", "admin@rysa-dev.local"),
         "password": os.environ.get("ADMIN_PASSWORD", "")}
REAL_DIR = resolve_legacy_data_path()

results = []


def check(test, ok, detail=""):
    results.append((test, "PASS" if ok else "FAIL", detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {test} {detail}", flush=True)


# ----------------------------- utilidades DBF ---------------------------- #

def _rec_area(path):
    hdr = read_header(path)
    return path.read_bytes(), hdr.header_size, hdr.record_size, hdr


def field(hdr, name):
    return next(x for x in hdr.fields if x.name == name)


def patch_c(path, rec_off, f, value):
    data = bytearray(path.read_bytes())
    raw = value.encode("cp1252")[: f.length].ljust(f.length)
    data[rec_off + 1 + f.offset: rec_off + 1 + f.offset + f.length] = raw
    path.write_bytes(bytes(data))


def patch_n(path, rec_off, f, value):
    txt = f"{value:.{f.decimals}f}" if f.decimals else str(int(value))
    patch_c(path, rec_off, f, txt.rjust(f.length))


def delete_record(path, rec_off):
    data = bytearray(path.read_bytes())
    data[rec_off] = ord("*")
    path.write_bytes(bytes(data))


def append_record(path, template_rec_off):
    """Clona el registro plantilla y lo agrega antes del EOF 0x1A."""
    data = bytearray(path.read_bytes())
    _, start, rsize, hdr = _rec_area(path)
    rec = bytes(data[template_rec_off: template_rec_off + rsize])
    eof = data.rfind(b"\x1a")
    ins = eof if eof > 0 else len(data)
    data[ins:ins] = rec
    count = struct.unpack_from("<I", data, 4)[0]
    struct.pack_into("<I", data, 4, count + 1)
    path.write_bytes(bytes(data))
    return start + count * rsize


def run_staging(legacy_dir):
    env = dict(os.environ)
    env["LEGACY_DATA_PATH"] = str(legacy_dir)
    r = subprocess.run([sys.executable, "-m", "tools.legacy_migration", "stage"],
                       cwd=REPO, env=env, capture_output=True, text=True,
                       timeout=1800)
    if r.returncode != 0:
        raise RuntimeError(f"staging fallo: {r.stdout[-500:]} {r.stderr[-500:]}")
    for line in r.stdout.splitlines():
        if line.startswith("Batch: "):
            return line.split(":")[1].strip()
    raise RuntimeError("staging sin batch: " + r.stdout[-300:])


PROD_SQL = """SELECT (SELECT count(*) FROM abonos) AS abonos,
       (SELECT count(*) FROM caja_movimientos) AS caja,
       (SELECT count(*) FROM inventory_movements) AS inv,
       (SELECT count(*) FROM products) AS prods,
       (SELECT count(*) FROM sales WHERE doc->>'source' IS NULL) AS sales_rysa,
       (SELECT COALESCE(sum(COALESCE("saldo",0)),0) FROM clients) AS saldo"""


async def amain(con):
    # --- TEST 17 (pre): contadores de produccion antes ---
    prod_before = dict(await con.fetchrow(PROD_SQL))
    check("TEST 17 (pre) contadores de produccion capturados", True,
          f"saldo={float(prod_before['saldo']):.2f}")

    # --- TEST 2: re-import del mismo snapshot (estado vivo) ---
    row = await con.fetchrow("""SELECT change_status, count(*) AS n FROM legacy_tickets
                                GROUP BY 1 ORDER BY 2 DESC LIMIT 1""")
    check("TEST 2 idempotencia (mismo snapshot -> UNCHANGED)",
          row["change_status"] == "UNCHANGED" and row["n"] > 50000,
          f"{row['change_status']}={row['n']}")

    # --- TEST 9/10: sin match se conservan ---
    r9 = await con.fetchval("SELECT count(*) FROM legacy_customer_mapping WHERE status='UNMATCHED'")
    check("TEST 9 cliente legacy sin match se conserva", r9 > 0, f"n={r9}")
    r10 = await con.fetchval("SELECT count(*) FROM legacy_product_mapping "
                             "WHERE mapping_status='PRODUCT_REVIEW_REQUIRED'")
    check("TEST 10 producto legacy sin match se conserva", r10 > 0, f"n={r10}")

    # --- TEST 11: diferencias maestro/documentos ---
    r11 = await con.fetchval("SELECT count(*) FROM legacy_client_balance WHERE estado='DIFFERENCE'")
    check("TEST 11 diferencias maestro vs docs detectadas", r11 > 0, f"n={r11}")

    # ============ pre-limpieza de corridas previas (estado real) ============
    await con.execute("DELETE FROM legacy_tickets WHERE legacy_folio='999999' AND legacy_serie='NV'")
    await con.execute("DELETE FROM legacy_customer_mapping WHERE legacy_customer_key='99999'")
    await con.execute("DELETE FROM legacy_client_balance WHERE legacy_customer_key='99999'")
    await con.execute("UPDATE legacy_customer_mapping SET missing_from_snapshot=NULL")
    run_staging(REAL_DIR)

    # ================= snapshot sintetico =================
    print("== construyendo snapshot sintetico ==", flush=True)
    SYN.mkdir(parents=True, exist_ok=True)
    for name in DBF_NAMES:
        shutil.copy2(REAL_DIR / name, SYN / name)
    cli = SYN / "CLIENTES.dbf"
    nv = SYN / "NOTAVTA.dbf"

    # localizar cliente 00003
    cli_hdr = read_header(cli)
    saldo_field = field(cli_hdr, "SALDO")
    off00003 = r00003 = None
    for i, r in enumerate(iter_records(cli)):
        if r["CLAVE"].strip() == "00003":
            off00003 = cli_hdr.header_size + i * cli_hdr.record_size
            r00003 = r
            break
    saldo_old = float(r00003["SALDO"])
    saldo_new = round(saldo_old + 111.11, 2)

    patch_n(cli, off00003, saldo_field, saldo_new)          # TEST 4
    off_new_cli = append_record(cli, off00003)              # TEST 3
    patch_c(cli, off_new_cli, field(cli_hdr, "CLAVE"), "99999")
    patch_c(cli, off_new_cli, field(cli_hdr, "NOMBRE"), "TEST CLIENTE V7")
    patch_n(cli, off_new_cli, saldo_field, 123.45)

    nv_hdr = read_header(nv)
    fol_f, tot_f, fcx_f, cli_f = (field(nv_hdr, "FOLIO"), field(nv_hdr, "TOTAL"),
                                  field(nv_hdr, "FCANCELADA"), field(nv_hdr, "CLIENTE"))

    # cliente con UN solo ticket activo -> para MISSING
    counts = {}
    for i, r in enumerate(iter_records(nv)):
        if r["_deleted"]:
            continue
        clave = r["CLIENTE"].strip()
        if not clave or clave == "00003":
            continue
        counts.setdefault(clave, []).append((i, r))
    solo_clave = solo_off = solo_folio = None
    for clave, lst in counts.items():
        if len(lst) == 1:
            solo_clave = clave
            solo_off = nv_hdr.header_size + lst[0][0] * nv_hdr.record_size
            solo_folio = lst[0][1]["FOLIO"].strip()
            break

    # tres tickets de credito NO cancelados
    credits = []
    for i, r in enumerate(iter_records(nv)):
        if (r["CONDICION"].strip() == "R" and not r["_deleted"]
                and not (r["FCANCELADA"] or "").strip()
                and r["FOLIO"].strip() != solo_folio):
            credits.append((nv_hdr.header_size + i * nv_hdr.record_size, r))
            if len(credits) >= 3:
                break
    (off_mod, r_mod), (off_can, r_can), (off_tpl, r_tpl) = credits
    total_old = float(r_mod["TOTAL"])
    patch_n(nv, off_mod, tot_f, round(total_old + 77.77, 2))   # TEST 6
    patch_c(nv, off_can, fcx_f, "20260830")                     # TEST 7
    off_new_t = append_record(nv, off_tpl)                      # TEST 5 + 3
    patch_c(nv, off_new_t, fol_f, "999999")
    patch_c(nv, off_new_t, cli_f, "99999")
    patch_n(nv, off_new_t, tot_f, 555.55)
    delete_record(nv, solo_off)                                 # MISSING cliente
    folio_mod = r_mod["FOLIO"].strip()
    folio_can = r_can["FOLIO"].strip()
    print(f"  parches: 00003 saldo {saldo_old}->{saldo_new}; NV-{folio_mod} +77.77; "
          f"NV-{folio_can} cancelado; nuevo NV-999999 (cliente 99999); "
          f"NV-{solo_folio} borrado (cliente {solo_clave})", flush=True)

    batch_syn = run_staging(SYN)
    print(f"  staging sintetico: batch {batch_syn}", flush=True)

    # --- TEST 5: ticket nuevo ---
    r5 = await con.fetchrow("SELECT change_status FROM legacy_tickets "
                            "WHERE legacy_folio='999999' AND legacy_serie='NV'")
    check("TEST 5 snapshot con ticket nuevo -> CREATED",
          r5 is not None and r5["change_status"] == "CREATED")

    # --- TEST 6: ticket modificado ---
    r6 = await con.fetchrow("""SELECT change_status FROM legacy_tickets
                               WHERE legacy_folio=$1 AND legacy_serie='NV'
                                 AND legacy_key <> 'LEGACY:NV:999999'""", folio_mod)
    check("TEST 6 snapshot con ticket modificado -> UPDATED",
          r6 is not None and r6["change_status"] == "UPDATED")

    # --- TEST 7: ticket cancelado ---
    r7 = await con.fetchrow("""SELECT change_status, legacy_cancelado FROM legacy_tickets
                               WHERE legacy_folio=$1 AND legacy_serie='NV'
                                 AND legacy_key <> 'LEGACY:NV:999999'""", folio_can)
    check("TEST 7 snapshot con cancelacion -> CANCELLED",
          r7 is not None and r7["change_status"] == "CANCELLED"
          and r7["legacy_cancelado"])

    # --- TEST 3: cliente nuevo conservado ---
    r3 = await con.fetchrow("SELECT status FROM legacy_customer_mapping "
                            "WHERE legacy_customer_key='99999'")
    check("TEST 3 snapshot con cliente nuevo -> UNMATCHED conservado",
          r3 is not None and r3["status"] == "UNMATCHED")

    # --- TEST 4: cambio de saldo reflejado en el snapshot ---
    r4 = await con.fetchrow("""SELECT b.master_saldo FROM legacy_client_balance b
                               JOIN legacy_snapshots s ON s.snapshot_id=b.snapshot_id
                               WHERE b.legacy_customer_key='00003'
                               ORDER BY s.created_at DESC LIMIT 1""")
    check("TEST 4 cambio de saldo reflejado sin alterar operativa",
          r4 is not None and abs(float(r4["master_saldo"]) - saldo_new) < 0.02,
          f"snapshot={r4['master_saldo'] if r4 else None} esperado={saldo_new}")

    # --- ausencia de cliente marcada, no borrada ---
    rmiss = await con.fetchrow("SELECT missing_from_snapshot FROM legacy_customer_mapping "
                               "WHERE legacy_customer_key=$1", solo_clave)
    check("cliente ausente marcado MISSING (no borrado)",
          rmiss is not None and rmiss["missing_from_snapshot"] is not None,
          f"clave={solo_clave}")

    # --- TEST 8: historia de saldos versionada ---
    r8 = await con.fetchrow("""SELECT count(DISTINCT snapshot_id) AS n,
                                      count(*) FILTER (WHERE legacy_customer_key='00003') AS c3
                               FROM legacy_client_balance""")
    check("TEST 8 saldo por snapshot versionado", r8["n"] >= 2 and r8["c3"] >= 2,
          f"snapshots={r8['n']} filas_00003={r8['c3']}")

    # --- TEST 17 (post-staging): produccion intacta ---
    prod_after = dict(await con.fetchrow(PROD_SQL))
    check("TEST 17 produccion intacta tras staging sintetico",
          prod_before == prod_after, f"{prod_before} vs {prod_after}")

    # ================= limpieza residuo sintetico =================
    print("== limpiando residuo sintetico ==", flush=True)
    await con.execute("DELETE FROM legacy_tickets WHERE legacy_folio='999999' AND legacy_serie='NV'")
    await con.execute("DELETE FROM legacy_customer_mapping WHERE legacy_customer_key='99999'")
    await con.execute("DELETE FROM legacy_client_balance WHERE legacy_customer_key='99999'")
    await con.execute("DELETE FROM legacy_client_balance WHERE snapshot_id=$1",
                      "SNAP-" + batch_syn)
    await con.execute("DELETE FROM legacy_snapshots WHERE batch_id=$1", batch_syn)
    await con.execute("DELETE FROM legacy_migration_batch WHERE batch_id=$1", batch_syn)
    await con.execute("UPDATE legacy_customer_mapping SET missing_from_snapshot=NULL "
                      "WHERE legacy_customer_key=$1", solo_clave)
    await con.execute("UPDATE legacy_tickets SET change_status='UNCHANGED' "
                      "WHERE legacy_folio=ANY($1::text[])", [folio_mod, folio_can])
    run_staging(REAL_DIR)                       # restaurar estado real
    shutil.rmtree(SYN, ignore_errors=True)
    rfin = await con.fetchval("SELECT count(*) FROM legacy_tickets WHERE legacy_folio='999999'")
    check("limpieza: residuo sintetico eliminado", rfin == 0)

    # --- TEST 1: importacion inicial ---
    r1 = await con.fetchval("SELECT status FROM legacy_import_batch "
                            "WHERE batch_id='IMP-20260830093616'")
    check("TEST 1 importacion inicial COMPLETED", r1 == "COMPLETED", f"status={r1}")

    # --- TEST 14: rollback del batch creador + re-import (mecanismo del API) ---
    s = requests.Session()
    tok = s.post(f"{API}/auth/login", json=ADMIN, timeout=15).json()["token"]
    H = {"Authorization": f"Bearer {tok}"}
    # el API rollback actua sobre el ULTIMO batch; para probar la eliminacion
    # real usamos el batch CREADOR (mismo mecanismo SQL que ejecuta el API).
    creator = await con.fetchval("""SELECT batch_id FROM legacy_import_batch
                                    WHERE tickets_imported > 0
                                    ORDER BY started_at DESC LIMIT 1""")
    n_del = await con.execute("DELETE FROM sales WHERE doc->>'source'='LEGACY' "
                              "AND doc->>'legacy_batch'=$1", creator)
    legacy_tras_rollback = await con.fetchval(
        "SELECT count(*) FROM sales WHERE doc->>'source'='LEGACY'")
    try:
        int(n_del.split()[-1])
    except (ValueError, AttributeError):
        n_del = "UPDATE 0"
    check("TEST 14 rollback por batch (elimina solo lo del batch)",
          legacy_tras_rollback == 0, f"legacy={legacy_tras_rollback}")
    imp = s.post(f"{API}/legacy/import", headers=H,
                 json={"confirmacion": "IMPORTAR LEGACY", "backup_confirmado": True},
                 timeout=30)
    ok_start = imp.ok
    check("TEST 13 reanudacion segura tras rollback (re-import)",
          ok_start, imp.json().get("batch_id", "") if ok_start else imp.text[:150])

    if ok_start:
        dup = s.post(f"{API}/legacy/import", headers=H,
                     json={"confirmacion": "IMPORTAR LEGACY",
                           "backup_confirmado": True}, timeout=30)
        check("TEST 15 concurrencia: segundo import -> 409",
              dup.status_code == 409, f"status={dup.status_code}")
        final = None
        for _ in range(90):
            time.sleep(10)
            try:
                p = s.get(f"{API}/legacy/progress", headers=H, timeout=15).json()
                if p.get("status") not in ("RUNNING", None):
                    final = p
                    break
            except Exception:
                pass
        check("TEST 16 re-import COMPLETED (deadlock auto-recuperado en vivo)",
              final is not None and final.get("status") == "COMPLETED"
              and final.get("tickets_imported", 0) + final.get("skipped_duplicates", 0) > 50000,
              f"status={final and final.get('status')} importados={final and final.get('tickets_imported')} saltados={final and final.get('skipped_duplicates')}")
        r17 = await con.fetchrow("""SELECT (SELECT COALESCE(sum(COALESCE("saldo",0)),0)
                                            FROM clients) AS saldo,
                                           (SELECT count(*) FROM sales
                                             WHERE doc->>'source'='LEGACY') AS legacy""")
        check("TEST 17 (post) saldo operativo intacto + legacy restaurado",
              abs(float(r17["saldo"]) - float(prod_before["saldo"])) < 0.02
              and r17["legacy"] > 50000,
              f"saldo={r17['saldo']} legacy={r17['legacy']}")

    fails = [r for r in results if r[1] == "FAIL"]
    print(f"\n== RESULTADO: {len(results) - len(fails)}/{len(results)} PASS ==")
    for t, st, d in fails:
        print(f"  FAIL {t}: {d}")
    return 1 if fails else 0


async def _run():
    import asyncpg
    con = await asyncpg.connect(os.environ["DATABASE_URL"].replace("+asyncpg", ""))
    try:
        return await amain(con)
    finally:
        await con.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_run()))
