# RYSA DATA MODEL AUDIT

**Fecha:** 2026-08-30 · Auditoría del modelo actual de RYSA (solo lectura de código y BD).

## 1. Fuentes de saldo en RYSA hoy

| Módulo | Fuente | Mecánica |
|---|---|---|
| `clients.saldo` | **Maestro** | POS crédito suma (`pgstore/pos.py:188`); abono FIFO resta (`pgstore/cxc.py:103`); importador de clientes puede fijarlo |
| Módulo CxC (`/api/cxc`) | **Derivado de documentos** | Agrega `sales` con `condicion=credito, estado=confirmada, saldo>0`; aging por buckets; lista solo clientes con `saldo>0` |
| Abonos (FIFO) | `sales.saldo` + `clients.saldo` | `FOR UPDATE`, atómico, `ON CONFLICT` — integridad correcta |
| Histórico Legacy | `legacy_*` (staging) | Aislado; se muestra como banner informativo en CxC (`/legacy/public-summary`) |

## 2. Hallazgos

### H1 — Dos fuentes de verdad (diseño, no bug)
`clients.saldo` (maestro) y `SUM(sales.saldo)` (documentos) **deben coincidir** para que abonos FIFO y reportes cuadren. Hoy cuadran trivialmente porque no hay ventas legacy importadas (producción `sales` = 0 y `clients.saldo` = 2,547,694.50 **sin documentos que lo respalden**).

**Consecuencia**: si un abono se aplica hoy a un cliente con saldo legacy, el FIFO no encontrará documentos (`aplicaciones=[]`) y el saldo bajará sin trazabilidad documental.

### H2 — El importador actual duplicaría deuda (CRÍTICO)
`legacyadmin.py` ("SOLO toca: sales LEGACY + clients.saldo (delta CxC READY)"): al importar sumaría +$789,708.45 a un saldo que **ya incluye** el maestro legacy → doble deuda.

### H3 — NOTAVTA.SALDO nunca debe usarse como saldo documental
Es snapshot de la cuenta del cliente al momento de venta (evidencia en `RYSA_LEGACY_FORENSIC_REPORT.md` §3). Verificar que ningún path del importador/staging lo use (el staging usa CXCDOCS.SALDO ✓).

### H4 — Exclusiones activas en reportes operativos ✓
`server.py` excluye `source=LEGACY` de estadísticas operativas (dashboard, comisiones, cortes) — correcto según el diseño original.

### H5 — Fogonazos menores
- `/api/cxc` filtra por `saldo > 0` en clients y sales: consistente.
- Aging usa `dias_credito` del cliente; los clientes legacy ya lo trajeron.
- `legacy_import_backup` / `legacy_import_audit` existen para rollback ✓.

## 3. Modelo actual vs modelo necesario

El modelo actual (CLIENTS + SALES-doc + ABONOS FIFO) **es adecuado** para operación, pero le falta una capa para el legado:

```
[HOY]  clients.saldo (2.55M)  ← SIN documentos que lo respalden
[V2]   clients.saldo (2.55M)  ← respaldado por sales LEGACY (docs abiertos) + ajustes trazables
```

Detalle de la propuesta: `RYSA_MIGRATION_V2_PROPOSAL.md`.
