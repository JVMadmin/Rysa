"""Configuración del sistema de migración legacy.

Resolución de rutas sin depender de rutas absolutas de una PC (regla 4/49):
1. variable de entorno LEGACY_DATA_PATH
2. ./legacy_data desde el directorio de trabajo actual
3. ./legacy_data desde la raíz del proyecto (subiendo desde tools/)
"""
import os
from pathlib import Path


def project_root() -> Path:
    """Raíz del proyecto deducida desde la ubicación de este paquete."""
    return Path(__file__).resolve().parents[2]


def resolve_legacy_data_path() -> Path:
    env = os.environ.get("LEGACY_DATA_PATH", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    cwd_candidate = Path.cwd() / "legacy_data"
    if cwd_candidate.is_dir():
        return cwd_candidate.resolve()
    return (project_root() / "legacy_data").resolve()


def resolve_reports_dir() -> Path:
    env = os.environ.get("LEGACY_REPORTS_PATH", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    return (project_root() / "legacy_reports").resolve()


# Codificación histórica típica de sistemas FoxPro en español (Windows ANSI).
DEFAULT_ENCODING = os.environ.get("LEGACY_DBF_ENCODING", "cp1252")

# Tope de valores distintos colectados por campo durante el discovery
# (protección de memoria; se marca truncated si se alcanza).
MAX_DISTINCT_VALUES = 200_000

# Tope de registros muestreados para estadísticas por campo en tablas grandes.
SAMPLE_RECORDS_LARGE_TABLE = 150_000

# Umbral de tamaño de archivo (bytes) a partir del cual se considera "grande"
# una tabla y se muestrea en lugar de escanear 100 % para stats costosas.
LARGE_TABLE_BYTES = 8 * 1024 * 1024
