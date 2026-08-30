"""Sonda completa: cancelacion de un ticket + staging + inspeccion."""
import asyncio, os, shutil, subprocess, sys
from pathlib import Path
from tools.legacy_migration.config import project_root, resolve_legacy_data_path
from tools.legacy_migration.dbf_reader import read_header, iter_records

REPO = project_root()
SYN = REPO / "legacy_data_v7_probe"
REAL = resolve_legacy_data_path()

def field(hdr, name):
    return next(x for x in hdr.fields if x.name == name)

def patch_c(path, rec_off, f, value):
    data = bytearray(path.read_bytes())
    raw = value.encode("cp1252")[: f.length].ljust(f.length)
    data[rec_off + 1 + f.offset: rec_off + 1 + f.offset + f.length] = raw
    path.write_bytes(bytes(data))

async def main():
    import asyncpg
    con = await asyncpg.connect(os.environ["DATABASE_URL"].replace("+asyncpg", ""))
    # restaurar hash real del ticket de prueba
    await con.execute("UPDATE legacy_tickets SET change_status='UNCHANGED' "
                      "WHERE legacy_folio='000051' AND legacy_serie='NV'")
    SYN.mkdir(parents=True, exist_ok=True)
    for name in ["NOTAVTA.dbf", "NVTAPAR.dbf", "CLIENTES.dbf", "ARTICULO.dbf",
                 "CUENXCOB.dbf", "CXCDOCS.dbf"]:
        shutil.copy2(REAL / name, SYN / name)
    nv = SYN / "NOTAVTA.dbf"
    hdr = read_header(nv)
    fcx = field(hdr, "FCANCELADA")
    target = None
    for i, r in enumerate(iter_records(nv)):
        if (r["CONDICION"].strip() == "R" and not r["_deleted"]
                and not (r["FCANCELADA"] or "").strip()):
            target = (hdr.header_size + i * hdr.record_size, r["FOLIO"].strip())
            break
    folio = target[1]
    print("cancelando:", folio)
    # hash ANTES (lo que el staging calcularia con el archivo real)
    import hashlib, json
    for r in iter_records(nv):
        if r["FOLIO"].strip() == folio:
            h_real = hashlib.sha256(json.dumps({
                "c": r["CLIENTE"].strip(), "f": r.get("FECHA"),
                "t": round(float(r.get("TOTAL") or 0), 2),
                "co": r.get("CONDICION"), "v": r.get("VENDEDOR"),
                "x": bool(r.get("FCANCELADA")), "nc": round(float(r.get("NCRED_TOT") or 0), 2),
                "s": r.get("STATUS")}, sort_keys=True, default=str).encode()).hexdigest()[:16]
            break
    patch_c(nv, target[0], fcx, "20260830")
    for r in iter_records(nv):
        if r["FOLIO"].strip() == folio:
            h_syn = hashlib.sha256(json.dumps({
                "c": r["CLIENTE"].strip(), "f": r.get("FECHA"),
                "t": round(float(r.get("TOTAL") or 0), 2),
                "co": r.get("CONDICION"), "v": r.get("VENDEDOR"),
                "x": bool(r.get("FCANCELADA")), "nc": round(float(r.get("NCRED_TOT") or 0), 2),
                "s": r.get("STATUS")}, sort_keys=True, default=str).encode()).hexdigest()[:16]
            print("bool FCANCELADA sintetico:", bool(r.get("FCANCELADA")))
            break
    row = await con.fetchrow("SELECT document_hash FROM legacy_tickets "
                             "WHERE legacy_folio=$1 AND legacy_serie='NV'", folio)
    print("hash BD:", row["document_hash"], " hash real:", h_real, " hash sint:", h_syn)
    await con.close()

    # staging sintetico
    env = dict(os.environ)
    env["LEGACY_DATA_PATH"] = str(SYN)
    r = subprocess.run([sys.executable, "-m", "tools.legacy_migration", "stage"],
                       cwd=REPO, env=env, capture_output=True, text=True, timeout=1800)
    print("staging rc:", r.returncode)

    con = await asyncpg.connect(os.environ["DATABASE_URL"].replace("+asyncpg", ""))
    row = await con.fetchrow("SELECT change_status, legacy_cancelado, document_hash "
                             "FROM legacy_tickets WHERE legacy_folio=$1 AND legacy_serie='NV'", folio)
    print("BD despues:", dict(row))
    print("hash coincide con sintetico:", row["document_hash"] == h_syn)
    await con.execute("UPDATE legacy_tickets SET change_status='UNCHANGED' "
                      "WHERE legacy_folio=$1 AND legacy_serie='NV'", folio)
    # restaurar con staging real para dejar el hash original
    env2 = dict(os.environ)
    env2.pop("LEGACY_DATA_PATH", None)
    env2["LEGACY_DATA_PATH"] = str(REAL)
    r = subprocess.run([sys.executable, "-m", "tools.legacy_migration", "stage"],
                       cwd=REPO, env=env2, capture_output=True, text=True, timeout=1800)
    print("restauracion rc:", r.returncode)
    await con.close()

asyncio.run(main())
