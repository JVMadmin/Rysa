"""Lector DBF/FoxPro de solo lectura, streaming y tolerante a fallos.

Implementación propia (sin dependencias externas) sobre el formato estándar:

  Header (32 bytes):
    byte 0      versión (0x03 dBase III, 0x83 +memo DBT, 0xF5 FoxPro+FPT,
                0x30/0x32 Visual FoxPro, ...)
    bytes 1-3   última actualización YYMMDD
    bytes 4-7   número de registros (uint32 LE)
    bytes 8-9   tamaño del header (uint16 LE)
    bytes 10-11 tamaño del registro (uint16 LE)
    byte  29    code page (0x00 desconocido, 0x03 ANSI/cp1252, 0x01 cp437, ...)
  Descriptores de campo (32 bytes c/u) hasta byte terminador 0x0D:
    11 bytes nombre, 1 byte tipo (C/N/F/D/L/M/T/I/B/Y), 4 bytes reservados,
    1 byte longitud, 1 byte decimales.

  Registros: a partir de header_size; 1 byte de borrado ('*' = borrado) +
  datos de longitud fija. Los archivos con CDX adjunto pueden contener un
  "backlink" extra al final del header; usar SIEMPRE header_size, nunca
  deducirlo desde los descriptores.

Nunca modifica el archivo (apertura 'rb' en todos los accesos).
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Optional

from .config import DEFAULT_ENCODING

_TYPE_CHARS = set("CNFDLMTIBYVGOP@+=")


@dataclass
class DbfField:
    name: str
    ftype: str
    length: int
    decimals: int
    offset: int  # dentro del registro (sin contar el byte de borrado)


@dataclass
class DbfHeader:
    version_byte: int
    version_label: str
    last_update: str            # YYYY-MM-DD (puede ser inválido → crudo)
    record_count_declared: int
    header_size: int
    record_size: int
    code_page_byte: int
    encoding: str
    fields: list[DbfField] = field(default_factory=list)
    has_memo_fields: bool = False
    warnings: list[str] = field(default_factory=list)

    @property
    def field_names(self) -> list[str]:
        return [f.name for f in self.fields]


@dataclass
class DbfFile:
    path: Path
    size_bytes: int
    header: DbfHeader


def _version_label(v: int) -> str:
    base = {
        0x02: "FoxBASE", 0x03: "dBase III (sin memo)", 0x04: "dBase IV",
        0x05: "dBase V", 0x30: "Visual FoxPro", 0x31: "Visual FoxPro (autoinc)",
        0x32: "Visual FoxPro (varfield)", 0x43: "dBase IV (SQL table)",
        0x7B: "dBase IV (memo)", 0x83: "dBase III + memo (DBT)",
        0x8B: "dBase IV + memo", 0xCB: "dBase IV + memo (SQL)",
        0xF5: "FoxPro 2.x + memo (FPT)", 0xFB: "FoxPro 2.x sin memo",
    }
    return base.get(v, f"desconocida (0x{v:02X})")


def _codepage_label(b: int) -> str:
    m = {0x00: "desconocido (default cp1252)", 0x01: "cp437", 0x02: "cp850",
         0x03: "cp1252 (Windows ANSI)", 0x64: "cp852", 0x65: "cp865",
         0x66: "cp437 (alt)", 0xC8: "cp1250", 0xC9: "cp1251",
         0x5A: "cp1254 (alt)"}
    return m.get(b, f"0x{b:02X}")


def _decode_name(raw: bytes, encoding: str) -> str:
    # Nombre de campo: 11 bytes, relleno con NULs/espacios. ASCII típico,
    # pero se decodifica con tolerancia (algunos sistemas guardan acentos).
    return raw.split(b"\x00", 1)[0].decode(encoding, errors="replace").strip()


def read_header(path: Path, encoding: str = DEFAULT_ENCODING) -> DbfHeader:
    """Lee y valida el header. Lanza ValueError con mensaje claro si no es DBF."""
    size = path.stat().st_size
    warnings: list[str] = []
    with path.open("rb") as fh:
        head = fh.read(32)
        if len(head) < 32:
            raise ValueError(f"archivo demasiado pequeño para ser DBF ({len(head)} bytes)")
        version = head[0]
        yy, mm, dd = head[1], head[2], head[3]
        if 1 <= mm <= 12 and 1 <= dd <= 31:
            last_update = f"{1900 + yy if yy > 70 else 2000 + yy:04d}-{mm:02d}-{dd:02d}"
        else:
            last_update = f"{yy:02d}-{mm:02d}-{dd:02d}"
            warnings.append("fecha de cabecera inválida")
        record_count, header_size, record_size = struct.unpack_from("<IHH", head, 4)
        code_page = head[29]

        # Descriptores de campo hasta 0x0D (o tope defensivo).
        fields: list[DbfField] = []
        offset = 0
        raw_desc = fh.read(header_size - 32)
        max_desc = len(raw_desc)
        i = 0
        while i + 32 <= max_desc:
            if raw_desc[i] == 0x0D:
                break
            name = _decode_name(raw_desc[i:i + 11], encoding)
            ftype = chr(raw_desc[i + 11])
            b16 = raw_desc[i + 16]
            b17 = raw_desc[i + 17]
            # Longitud: variante FoxPro/dBase IV almacena longitud de campos C
            # como uint16 LE en bytes 16-17 cuando excede 255. Evidencia local:
            # si b17 != 0 en un campo C (que nunca usa decimales), b17 es el
            # byte alto de la longitud. Para N/F: b16 longitud, b17 decimales.
            if ftype == "C" and b17 != 0:
                flen = b16 | (b17 << 8)
                fdec = 0
            else:
                flen = b16
                fdec = b17
            if name == "" or ftype not in _TYPE_CHARS:
                warnings.append(
                    f"descriptor de campo anómalo en offset {32 + i} "
                    f"(name={name!r}, type={ftype!r}); descartados los restantes")
                break
            fields.append(DbfField(name, ftype, flen, fdec, offset))
            offset += flen
            i += 32
        if not raw_desc or raw_desc[i] != 0x0D:
            warnings.append("terminador 0x0D del header no encontrado donde se esperaba")

    if record_size == 0 and fields:
        warnings.append("record_size del header es 0; recalculado desde campos")
        record_size = 1 + sum(f.length for f in fields)

    computed = 1 + sum(f.length for f in fields)
    if fields and computed != record_size:
        warnings.append(
            f"record_size={record_size} difiere del calculado ({computed}); "
            "se respeta el del header (posible backlink/campos binarios)")

    has_memo = any(f.ftype == "M" for f in fields)
    hdr = DbfHeader(
        version_byte=version,
        version_label=_version_label(version),
        last_update=last_update,
        record_count_declared=record_count,
        header_size=header_size,
        record_size=record_size,
        code_page_byte=code_page,
        encoding=encoding,
        fields=fields,
        has_memo_fields=has_memo,
        warnings=warnings,
    )
    if hdr.has_memo_fields:
        hdr.warnings.append("contiene campos Memo (requiere FPT/DBT asociado)")
    return hdr


def open_dbf(path: Path, encoding: str = DEFAULT_ENCODING) -> DbfFile:
    return DbfFile(path=path, size_bytes=path.stat().st_size,
                   header=read_header(path, encoding))


def iter_records(path: Path, encoding: str = DEFAULT_ENCODING,
                 limit: Optional[int] = None, skip: int = 0,
                 only: Optional[set] = None) -> Iterator[dict]:
    """Iterador de registros (streaming). Devuelve dicts con tipos decodificados
    y metadatos: _deleted (bool) y _recno (número físico 0-based del área de datos).

    `only`: si se indica, decodifica SOLO esos campos (más rápido).
    Campos Memo NO se resuelven aquí (requiere FPT/DBT); se devuelve el número
    de bloque como int para análisis.
    """
    header = read_header(path, encoding)
    fields = [f for f in header.fields if only is None or f.name in only]
    if not fields:
        return
    data_start = header.header_size
    rsize = header.record_size
    encoding_eff = header.encoding

    with path.open("rb") as fh:
        fh.seek(data_start)
        recno = -1
        yielded = 0
        while True:
            raw = fh.read(rsize)
            if len(raw) < rsize:
                return
            recno += 1
            if recno < skip:
                continue
            deleted = raw[0:1] == b"*"
            row: dict = {"_recno": recno, "_deleted": deleted}
            for f in fields:
                chunk = raw[1 + f.offset: 1 + f.offset + f.length]
                row[f.name] = _decode_field(chunk, f, encoding_eff)
            yield row
            yielded += 1
            if limit is not None and yielded >= limit:
                return


def _decode_field(chunk: bytes, f: DbfField, enc: str):
    if f.ftype == "C":
        return chunk.decode(enc, errors="replace").rstrip()
    if f.ftype in ("N", "F"):
        s = chunk.decode("ascii", errors="replace").strip()
        if not s or set(s) <= {"."}:
            return None
        try:
            return float(s) if f.decimals > 0 else int(s)
        except ValueError:
            try:
                return float(s)
            except ValueError:
                return None
    if f.ftype == "D":
        s = chunk.decode("ascii", errors="replace").strip()
        if len(s) == 8 and s.isdigit():
            return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
        return None
    if f.ftype == "L":
        c = chunk[:1]
        if c in b"TtYy":
            return True
        if c in b"FfNn":
            return False
        return None
    if f.ftype == "M":
        s = chunk.decode("ascii", errors="replace").strip()
        if s.isdigit():
            return int(s)
        return None
    if f.ftype == "T":  # datetime VFP: julian LE + ms LE
        if len(chunk) == 8:
            julian, ms = struct.unpack("<ii", chunk)
            if julian > 0:
                return {"julian": julian, "ms": ms}
        return None
    if f.ftype == "I":
        if len(chunk) == 4:
            return struct.unpack("<i", chunk)[0]
        return None
    if f.ftype in ("B", "Y"):
        if len(chunk) == 8:
            v = struct.unpack("<d", chunk)[0]
            return round(v, 4) if f.ftype == "B" else (v / 10000.0 if abs(v) < 1e12 else None)
        return None
    # V/G/O/P/binarios: preservar longitud, sin contenido
    return f"<binary:{f.ftype}:{len(chunk)}b>"


def sample_values(path: Path, field_name: str, max_rows: Optional[int] = None,
                  encoding: str = DEFAULT_ENCODING, distinct_cap: int = 200_000):
    """Colecta valores (hasta distinct_cap únicos) de un campo, streaming."""
    seen: set = set()
    total = 0
    for row in iter_records(path, encoding, limit=max_rows):
        v = row.get(field_name)
        if v is not None and v != "":
            seen.add(v)
            if len(seen) >= distinct_cap:
                break
        total += 1
    return seen, total


def iter_field_values(path: Path, field_name: str, encoding: str = DEFAULT_ENCODING,
                      limit: Optional[int] = None,
                      skip_deleted: bool = True) -> Iterator:
    """Iterador ULTRARRÁPIDO de un solo campo: lee solo el slice de bytes del
    campo por registro, sin construir dicts ni decodificar el resto.
    Ideal para análisis de relaciones sobre tablas grandes."""
    hdr = read_header(path, encoding)
    f = next((x for x in hdr.fields if x.name == field_name), None)
    if f is None:
        return
    data_start = hdr.header_size
    rsize = hdr.record_size
    with path.open("rb") as fh:
        fh.seek(data_start)
        n = 0
        while True:
            raw = fh.read(rsize)
            if len(raw) < rsize:
                return
            if skip_deleted and raw[0:1] == b"*":
                continue
            yield _decode_field(raw[1 + f.offset: 1 + f.offset + f.length], f, hdr.encoding)
            n += 1
            if limit is not None and n >= limit:
                return
