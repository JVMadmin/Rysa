# Plan de migración MongoDB → PostgreSQL (Grupo RYSA ERP)

> Estado: DOCUMENTO DE PLANIFICACIÓN — no se aplicó nada.
> Fecha: 2026-08-10 · Alcance: solo análisis y recomendaciones.
> Importante: este plan NO se ha ejecutado. Antes de aplicarlo debe decidirse el enfoque (ver sección final "Recomendación").

---

## 1. Resumen ejecutivo

La app actual (backend FastAPI + `deps.py`/`server.py`/`storage.py`) está construida 100% sobre **MongoDB**.
Migrar a **PostgreSQL** implica reescribir toda la capa de acceso a datos, NO solo cambiar una dependencia.
El costo es alto (semanas de un desarrollador) y el riesgo de romper lo que ya funciona es real.

**Conclusión preliminar:** para el objetivo declarado (crecer en volumen de datos), **cambiar el motor de base de datos no es lo que resuelve el problema**. MongoDB escala bien con volumen. El cuello de botella real es otro (ver sección 2). Si aun así se quiere PostgreSQL (por relacional estricto, integridad referencial, o preferencia del equipo), aquí está qué implicaría.

---

## 2. El problema real de rendimiento (independiente de la base)

Hay **27 llamadas que traen colecciones completas a memoria** sin paginar en serio:

- `list_clients` → `.to_list(5000)` (todo cliente, y luego recorre todas las ventas `.to_list(20000)`).
- `reporte_ventas` → `.to_list(50000)` ventas + `.to_list(50000)` productos en memoria.
- `cxc_list` → hasta 100,000 ventas en memoria.
- `list_products` con filtros → `.to_list(20000)`.
- `list_sales` → `.to_list(3000)`.

Esto hace lenta a la app y consume mucha RAM **con cualquier motor de base de datos**.
Antes de decidir migrar conviene paginar estos endpoints (límites + `skip`/`limit` con índices) y verificar índices en Mongo.
Eso suele ser suficiente para el crecimiento esperado y se hace en días, no semanas.

---

## 3. Modelo de datos actual (colecciones MongoDB)

| Colección | Uso | Estructura destacada |
|-----------|-----|----------------------|
| `users` | login/RBAC | email unique, password_hash, role |
| `products` | catálogo | **85 columnas DBF** + arrays anidados: `precios[]`, `sat{}`, `controles{}`, `ficha_tecnica{}`, `proveedores[]`, `sinonimos[]`, `codigos_barras[]` |
| `clients` | clientes | muchísimos campos (dirección, fiscales, crédito, estadísticas) |
| `categories` | categorías | nombre, imagen |
| `sales` | ventas/POS | items[] anidados (productos), pagos[], totales, estado |
| `suspended_sales` | ventas suspendidas | guarda el `payload` completo de la venta |
| `inventory_movements` | kardex | producto + movimiento + usuario |
| `cajas` / `caja_movimientos` | caja | apertura/cierre/movimientos |
| `abonos` | cuentas por cobrar | aplicaciones[] |
| `cfdi_documents` | facturación | guarda `response` completo del PAC |
| `audit_logs` | auditoría | log de acciones |
| `counters` | folios/códigos | secuencias (venta, cotización, cliente, producto, etc.) |
| `settings` | configuración | `ticket_config{}` + `sucursales[]` anidados |
| `pac_config` | configuración PAC | api_key, etc. |
| `files` | archivos subidos | ruta + metadata |

**Característica clave:** Mongo guarda *documentos anidados y de esquema flexible* (85 campos de producto, `response` completo del PAC, payload completo de venta). En PostgreSQL esto **no se traduce 1:1**; requiere normalizar en varias tablas o guardar piezas como JSONB.

---

## 4. Dependencias que cambiarían (`backend/requirements.txt`)

**Quitar** (solo Mongo):
```
motor        # cliente asíncrono de MongoDB
pymongo      # cliente de MongoDB (depende de motor)
dnspython    # resolución DNS de mongodb+srv (depende de pymongo)
```

**Agregar** (para PostgreSQL con FastAPI asíncrono):
```
sqlalchemy[asyncio]>=2.0     # ORM / core (abstracción de tablas)
asyncpg                       # driver PostgreSQL asíncrono rápido
alembic                       # migraciones de esquema (versionar tablas)
```

> Alternativa más ligera sin ORM: solo `asyncpg` y SQL manual. Más control, más código.

Todo lo demás (fastapi, pydantic, pandas, openpyxl, reportlab, httpx, PyJWT, bcrypt) **se queda igual**.

El frontend (`package.json`) **NO cambia**: la API mantiene los mismos endpoints y respuestas JSON.

---

## 5. Cambios de código necesarios (el costo real)

### 5.1. `deps.py` — el origen de todo
- Reemplazar `motor`/`AsyncIOMotorClient` por conexión PostgreSQL (`asyncpg` o SQLAlchemy).
- Definir conexión vía `DATABASE_URL` (p. ej. `postgresql+asyncpg://user:pass@host:5432/rysa`), reemplazando `MONGO_URL`/`DB_NAME`.
- `next_counter` (secuencias de folios) → secuencias/tabla de PostgreSQL.

### 5.2. `server.py` — ~144 llamadas a la base
Cada `db.<colección>.find(...)` / `insert_one` / `update_one` / `find_one` / `delete_one` / `count_documents` / `aggregate` / `create_index` / `$set` / `$inc` / `$regex` se tiene que reescribir contra tablas SQL.

Casos de especial cuidado:
- **Búsqueda por texto** (productos, clientes con `$regex`) → `ILIKE`/búsqueda full-text.
- **Incrementos atómicos** (`$inc` en cajas/saldos) → transacciones SQL.
- **`aggregate`** (categorías en `list_categories`, línea 692) → `GROUP BY`.
- **`to_list` masivos** → consultas paginadas con `LIMIT/OFFSET`.
- **Arrays anidados** (productos.precios, sales.items) → tablas hijas (`product_prices`, `sale_items`) o JSONB.
- **`response` del PAC y ventas suspendidas** → JSONB (no vale normalizar).

### 5.3. Esquema de tablas (aproximado, ~20+ tablas principales)
`users, products, product_prices, product_categories, providers, clients, categories,
sales, sale_items, sale_payments, suspended_sales, inventory_movements, cajas,
caja_movimientos, abonos, abono_applications, cfdi_documents, audit_logs, counters,
settings, pac_config, files`

### 5.4. Migración de datos
- Herramienta de **export** desde Mongo (`mongodump`/script) e **import** a PostgreSQL (típicamente en dos passes: tablas maestras → tablas hijas → documentos JSONB).
- Requiere un periodo de corte o doble escritura para no perder ventas en vivo.

---

## 6. Riesgos

1. **Alto esfuerzo**: reescribir toda la capa de datos + esquema + migración de datos.
2. **Meses de retrabajo en lo que ya funciona** (import/export excesivo, kardex, facturación).
3. **No resuelve el objetivo de crecimiento** por sí solo (el problema es la paginación).
4. **Fuga en vivo**: migrar datos con la app en producción es delicado.

---

## 7. Recomendación (orden de prioridad)

1. **Optimizar paginación e índices en MongoDB** (semanas → días). Esto atiende el volumen sin tocar el motor.
2. Si al final se quiere PostgreSQL **de verdad**, hacerlo de forma **paralela y opcional**, no como bloqueador: primero normalizar, luego un POC con una colección (p. ej. `products`) para dimensionar el esfuerzo real.
3. Mientras tanto, **respaldar** datos y código (ver sección siguiente).

---

## 8. Respaldo (imprescindible, ya)

1. **Carpeta local completa** (con `.env`, `.env.development`, `.env.production` dentro) → disco externo/nube. NO es necesario copiar `node_modules`, `venv` ni `build` (se regeneran).
2. **Base de datos** desde MongoDB Atlas: `mongodump --uri="<TU_MONGO_URL>" --db=rysa --out=...`
3. **Commit de seguridad** de todo el código (los `.env` jamás suben a git).

> Respaldos ya hechos hasta ahora:
> - `.env`, `.env.development`, `.env.production` copiados a
>   `C:\Users\emili\OneDrive\Desktop\backup_rysa_dotenv_20260810`
> - Commit de seguridad del código (requiere identidad de git).
