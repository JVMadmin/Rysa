"""Análisis de archivos FPT (memo FoxPro). Solo lectura.

Header (512 bytes): bytes 0-3 next free block (uint32 BE), bytes 6-7
block size (uint16 BE, típico 64). Cada bloque: byte 0 firma, byte 1 tipo
('M' memo texto, 'F' formato, 'P' imagen, 'O' objeto, 'G' general, 'T' texto),
bytes 2-5 longitud del dato (uint32 BE), luego el contenido.

Discovery: valida header, block size, cuenta bloques usados y muestrea el
primer texto legible (para evidencia), sin cargar todo el archivo.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class FptFile:
    path: Path
    size_bytes: int
    block_size: int
    next_free_block: int
    blocks_total_estimated: int
    sample_text: str = ""
    warnings: list[str] = field(default_factory=list)

    @property
    def parsed(self) -> bool:
        return self.block_size > 0


def read_fpt(path: Path) -> FptFile:
    size = path.stat().st_size
    out = FptFile(path=path, size_bytes=size, block_size=0, next_free_block=0,
                  blocks_total_estimated=0)
    if size < 512:
        out.warnings.append(f"archivo demasiado pequeño ({size} bytes)")
        return out
    with path.open("rb") as fh:
        head = fh.read(512)
        next_free = struct.unpack_from(">I", head, 0)[0]
        block_size = struct.unpack_from(">H", head, 6)[0]
        if block_size == 0:
            block_size = 64
            out.warnings.append("block_size 0 en header; asumido 64")
        out.block_size = block_size
        out.next_free_block = next_free
        if block_size:
            out.blocks_total_estimated = (size + block_size - 1) // block_size

        # Muestra del primer bloque con contenido textual (máx 3 intentos).
        for bnum in range(1, 4):
            off = bnum * block_size
            if off + 6 > size:
                break
            fh.seek(off)
            sig = fh.read(1)[0]
            mtype = fh.read(1)
            mlen = struct.unpack(">I", fh.read(4))[0]
            if mtype in b"MT" and 0 < mlen <= size:
                text = fh.read(min(mlen, 300)).decode("cp1252", errors="replace")
                out.sample_text = text.replace("\r\n", " / ").strip()
                break
            if sig not in (0, 1):
                break
    return out
