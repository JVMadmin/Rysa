"""Análisis estructural best-effort de archivos CDX (compound index FoxPro).

Estructura CDX (documentación pública):
  - Archivo paginado (tamaño de página típico 512..4096 bytes, potencia de 2).
  - Página 0 = header: bytes 0-3 apuntador a la página raíz del árbol de TAGs
    (uint32 LE), bytes 4-7 free-list, bytes 8-9 tamaño de página (uint16 LE).
  - Cada nodo/página: prev(4) next(4) atributos(2) nkeys(2) free(2)
    + entradas. En el nodo raíz de tags, las claves SON los nombres de tags
    (uppercase) y tras cada clave hay un puntero (uint32 LE) a la raíz del tag.

Este lector NO reconstruye expresiones de índice completas (riesgo de
inventar). Extrae: nombres de tags, páginas raíz, atributos y longitud de
clave; lo demás se reporta como UNKNOWN. Todo se usa solo como EVIDENCIA
de discovery, nunca como FK definitiva (regla 2).
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path

_IDENT_OK = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")


@dataclass
class CdxTag:
    name: str
    root_page: int
    key_length: int


@dataclass
class CdxFile:
    path: Path
    size_bytes: int
    page_size: int
    root_page: int
    tags: list[CdxTag] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def parsed(self) -> bool:
        return bool(self.tags)


def read_cdx(path: Path) -> CdxFile:
    size = path.stat().st_size
    out = CdxFile(path=path, size_bytes=size, page_size=0, root_page=0)
    if size < 512:
        out.warnings.append(f"archivo demasiado pequeño ({size} bytes)")
        return out

    with path.open("rb") as fh:
        head = fh.read(8)
        root_page, _free = struct.unpack("<II", head)
        fh.seek(0)
        ps_raw = fh.read(10)[8:10]
        page_size = struct.unpack("<H", ps_raw)[0]
        if page_size < 512 or page_size > 65536 or (page_size & (page_size - 1)) != 0:
            out.warnings.append(f"page_size inválido ({page_size}); se asume 512")
            page_size = 512
        out.page_size = page_size
        out.root_page = root_page

        if root_page == 0 or root_page * page_size >= size:
            out.warnings.append(f"root_page inválido ({root_page})")
            return out

        fh.seek(root_page * page_size)
        page = fh.read(page_size)
        if len(page) < 12:
            out.warnings.append("página raíz truncada")
            return out
        prev_p, next_p, attrs, nkeys, free = struct.unpack_from("<IIHHH", page, 0)
        # attrs bit 0x04 = nodo interior; el árbol de tags debe ser interior.
        if not (attrs & 0x04):
            out.warnings.append(
                "página raíz no es interior (attrs=0x%04X); estructura no reconocida"
                % attrs)
            return out
        if nkeys == 0 or nkeys > 500:
            out.warnings.append(f"nkeys fuera de rango ({nkeys}); no se extraen tags")
            return out

        # Entradas: [key_len(1)][key bytes][page(4)] a partir del offset 12+2
        # (header de 12 bytes + puntero de espacio libre de 2 bytes).
        i = 14
        for _ in range(nkeys):
            if i >= len(page):
                break
            klen = page[i]
            i += 1
            if klen == 0 or i + klen + 4 > len(page):
                out.warnings.append("entrada de tag truncada; extracción parcial")
                break
            raw_name = page[i:i + klen]
            i += klen
            root = struct.unpack_from("<I", page, i)[0]
            i += 4
            try:
                name = raw_name.decode("ascii", errors="strict")
            except UnicodeDecodeError:
                continue  # no es un nombre de tag → ignorar silenciosamente
            if not name or set(name.upper()) - _IDENT_OK:
                continue
            out.tags.append(CdxTag(name=name.upper(), root_page=root,
                                   key_length=klen))
    if not out.tags:
        out.warnings.append("no se pudieron extraer tags con confianza")
    return out
