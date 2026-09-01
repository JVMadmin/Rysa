# RYSA LEGACY PRODUCTS IMPORT (FASE 5)

Batch: `B20260831232036` · Generado: 2026-08-31T23:20:36.591617+00:00 · Duración: 2.8 s · Fuente: `/app/legacy_data`

## 1. Resumen

- ARTICULO.dbf registros: **2,238** → válidos **2,234** · rechazados 4 (ecuación OK)
- Activos: 2,220 · Baja lógica (estado 'baja'): 14
- **Creados en `products`: 2,234** · ya existentes (no sobrescritos): 0

## 2. Decisiones aplicadas

- P1: se importan activos y borrados lógicos (`_deleted` → estado 'baja').
- P2: existencia legacy conservada como `existencia_legacy` en el doc; columna tipada `existencia` = 0 (solo cambia por movimientos).
- P3: códigos ya presentes en `products` NO se sobrescriben.
- P4: precios con IVA (`precio_incluye_iva=True`); si no hay PRECIO1..5 se usa PRECIOVTA como Precio 1.
- P5: idempotente por `doc->>'codigo'`; doc conserva los 85 campos legacy + campos ERP, idéntico a la importación Excel.

## 3. Siguiente paso

Re-ejecutar `stage` para que `legacy_product_mapping` resuelva `rysa_product_id` (MATCHED) y luego `dry-run` para verificar.
