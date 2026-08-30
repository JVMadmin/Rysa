"""RYSA — Migración Histórica Legacy (DBF/BDF + CDX + FPT → PostgreSQL/RYSA).

Fuente oficial de datos: <ROOT>/legacy_data/ (SOLO LECTURA).
Fase actual: DISCOVERY. Ningún comando de este paquete escribe en la
base de producción; la importación llegará en fases posteriores bajo
validación explícita del Discovery.
"""

__version__ = "0.1.0-discovery"
