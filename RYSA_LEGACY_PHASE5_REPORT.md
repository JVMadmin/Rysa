# RYSA LEGACY — FASE 5: IMPLEMENTACIÓN DE IMPORTACIÓN + FRONTEND

Fecha: 2026-08-29 · **Ningún dato Legacy fue importado a producción.**
Producción verificada: clients=686 · sales=0 · abonos=0 · products=0 ·
inventory_movements=0 · caja_movimientos=0.

## 1. ARCHIVOS MODIFICADOS / CREADOS

### Backend (nuevos)
| Archivo | Contenido |
|---|---|
| `backend/legacyadmin.py` (NUEVO, ~600 líneas) | Router `/api/legacy/*`: status, review, validate, import, progress, rollback, public-summary, estado-cuenta + importador transaccional por chunks con backup, auditoría y rollback |

### Backend (modificados, 2 líneas)
| Archivo | Cambio |
|---|---|
| `backend/server.py` | `import legacyadmin as _legacymod` + `app.include_router(_legacymod.router)` |

### Frontend (nuevos)
| Archivo | Contenido |
|---|---|
| `frontend/src/pages/LegacyMigration.jsx` (NUEVO) | Dashboard completo: etapas, métricas, validar, doble confirmación, progreso en vivo, cola de revisión con filtros, rollback |

### Frontend (modificados)
| Archivo | Cambio |
|---|---|
| `frontend/src/pages/DevTools.jsx` | Import + pestaña "Migración Legacy" (solo rol admin_desarrollador) + TabsContent |
| `frontend/src/pages/Ventas.jsx` | Filtro "Origen: Todos/RYSA/LEGACY" · insignia LEGACY · bloqueo de acciones (facturar/remitir/cancelar/reimprimir) en documentos históricos · banner "DOCUMENTO HISTÓRICO · SOLO LECTURA" en el detalle |
| `frontend/src/pages/Clientes.jsx` | Pestaña "Histórico" en el detalle del cliente: documentos LEGACY con fecha, total, saldo y estado + saldo histórico pendiente |
| `frontend/src/pages/CuentasPorCobrar.jsx` | Banner informativo de cartera con deuda LEGACY incluida (usa endpoint público-agregado) |

## 2. MIGRACIONES CREADAS
No se tocó la cadena Alembic del backend. Las tablas del importador se
auto-instalan con `CREATE TABLE IF NOT EXISTS` (mismo enfoque que staging):
`legacy_import_batch`, `legacy_import_audit`, `legacy_import_backup` +
índice parcial `idx_sales_legacy`.

## 3. ENDPOINTS NUEVOS (verificados en OpenAPI + guardas 401/403/404)
| Método | Ruta | Guarda |
|---|---|---|
| GET | `/api/legacy/status` | dev.info · 404 en producción |
| GET | `/api/legacy/review` | dev.info |
| POST | `/api/legacy/validate` | dev.info |
| POST | `/api/legacy/import` | developer_tools + DEVELOPER_MODE + **LEGACY_MIGRATION_ENABLED=true** + rol admin_desarrollador + texto "IMPORTAR LEGACY" + checkbox backup |
| GET | `/api/legacy/progress` | dev.info |
| POST | `/api/legacy/rollback` | igual que import + texto "REVERTIR LEGACY" |
| GET | `/api/legacy/public-summary` | cxc.ver (agregado sin datos técnicos) |
| GET | `/api/legacy/estado-cuenta` | usuario autenticado (mismo nivel que listado de clientes) |

Smoke test real: 8 rutas registradas en OpenAPI ✓ · sin auth → 401 ✓ ·
lógica status/validate ejecutada contra la BD: **VALIDATE PASS sin bloqueos**.

## 4. COMPONENTES FRONTEND NUEVOS
- Dashboard Migración Legacy (etapas ✓/✗, 6 métricas, validar, importar con
  doble confirmación — incluida escritura exacta de "IMPORTAR LEGACY" y
  checkbox de backup —, progreso con barras por polling cada 3 s, cola de
  revisión filtrable, rollback con confirmación).
- Integración operativa: filtro/badge/bloqueo en Ventas, tab Histórico en
  Clientes, banner LEGACY en CxC.

## 5. PERMISOS
- Ver módulo: permiso `dev.info` (mismo que DevTools).
- Importar/revertir: `developer_tools` + rol `admin_desarrollador` +
  `DEVELOPER_MODE=true` + `LEGACY_MIGRATION_ENABLED=true` + entorno != producción.
- Estado de cuenta histórico: cualquier usuario autenticado.
- El backend valida SIEMPRE; el frontend solo oculta.

## 6. VALIDACIONES PRE-IMPORT (automáticas, bloquean si fallan)
staging no vacío · identidad única de tickets (SERIE,FOLIO) y detalles
(doc,partida) · clientes MATCHED > 0 · sin ventas LEGACY previas
inconsistentes · batch de staging vigente. Resultado actual: **PASS, 0
bloqueos** (57,258 / 134,429 / 232 / $789,708.45 / 619 mapeados / staging
batch B20260829234226).

## 7. PRUEBAS EJECUTADAS
- Sintaxis Python (legacyadmin, server) ✓
- Reinicio de uvicorn limpio con el módulo cargado ✓
- OpenAPI: 8 rutas ✓
- Guardas: 401 sin autenticación ✓
- `LEGACY_MIGRATION_ENABLED=false` actual → `import_habilitado=false` ✓ (la
  importación está bloqueada por diseño hasta que el administrador la encienda)
- `_validate_import` contra BD: PASS ✓
- Desgloses review: 257 CASH + 12 CASH+CANCELLED + 5 NEGATIVE + 63 FACTURA_SERIE_F ✓

## 8. ESTADO DE PRODUCCIÓN (sin cambios)
clients=686 · sales=0 · abonos=0 · products=0 · inventory_movements=0 ·
caja_movimientos=0 · sales_legacy=0.

## 9. INSTRUCCIONES EXACTAS PARA LA IMPORTACIÓN (FASE 6)
1. Backup completo de PostgreSQL (pg_dump) por el administrador.
2. En `backend` del entorno donde se ejecute: `LEGACY_MIGRATION_ENABLED=true`
   (variable de entorno; en Docker, en `.env.docker.local` y reiniciar).
3. Abrir RYSA → DevTools → Migración Legacy.
4. Botón **Validar** → debe decir PASS.
5. Botón **IMPORTAR HISTÓRICO** → modal 1 (cifras) → CONTINUAR.
6. Modal 2: checkbox de backup + escribir `IMPORTAR LEGACY` → CONFIRMAR.
7. Progreso en vivo (tickets/detalles/CxC). Al terminar: estado COMPLETED
   con contadores y validación automática; la cartera CxC mostrará la deuda
   LEGACY y los pagos se registran con el FIFO normal de RYSA.
8. Rollback disponible (botón "Revertir importación") si se detecta error:
   borra ventas LEGACY del batch y revierte deltas de clients.saldo.

## 10. CONFIRMACIÓN
**NO se importó ningún dato.** El importador está implementado, validado y
apagado (double kill-switch: env flag + doble confirmación). Producción
intacta y verificada.

### Semántica clave del importador (documentada)
- Ventas históricas: `_id = "LEGACY:SERIE:FOLIO"` (idempotente), doc con
  `source=LEGACY`, `is_historical=true`, partidas con `codigo_legacy` y
  `product_id=NULL` para no mapeados (visibles como "Producto Legacy (código)").
- Saldo por venta: **0** salvo los 232 documentos CxC READY (saldo = CXCDOCS.SALDO
  autoritativo) → el FIFO existente de `pgstore/cxc.py` los atiende de forma
  natural al cobrar (condición 'credito', saldo > 0), sin crear abonos históricos.
- `clients.saldo` += delta solo para clientes MATCHED; deltas auditados para rollback.
- NUNCA toca: inventario, caja, abonos históricos, productos, reportes operativos.
