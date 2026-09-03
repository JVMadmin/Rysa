# RYSA — Backup, Restore y Rollback

Estrategia de recuperabilidad: cada deploy deja un **snapshot completo
del estado desplegado** (código + commit + BD) y un **dump de la BD**,
ambos almacenados fuera del contenedor PostgreSQL.

---

## 1. Qué se respalda

`./scripts/backup.sh` produce dos artefactos por ejecución:

```
/opt/rysa/backups/
├── db/                                     # dumps PostgreSQL
│   ├── rysa_dev_20260115_030000.dump       # cron diario
│   └── pre_rollback_20260116_120000.dump    # auto antes de rollback
└── releases/                               # código + commit
    ├── release_a1b2c3d_20260115_030000.tar.gz
    └── release_a1b2c3d_20260116_120000.tar.gz
```

Cada `tar.gz` de release contiene:
- Código fuente completo del repo (sin `node_modules`, `.git`, logs, `.env.docker`, `legacy_data/`, `uploads/`)
- El `.env.docker` se preserva por separado en `/opt/rysa/repo/.env.docker`

Retención por defecto:
- DB dumps: 30 días (`BACKUP_RETAIN_DAYS`)
- Releases: 10 snapshots (`BACKUP_RETAIN_RELEASES`)

---

## 2. Backup manual

```bash
sudo -u rysa /opt/rysa/repo/scripts/backup.sh
```

Salida ejemplo:
```
[backup 03:00:01] DB -> /opt/rysa/backups/db/rysa_dev_20260115_030000.dump
[backup 03:00:01] DB OK (24M)
[backup 03:00:01] DB integridad verificada (pg_restore --list)
[backup 03:00:01] Release -> /opt/rysa/backups/releases/release_a1b2c3d_20260115_030000.tar.gz
[backup 03:00:01] Release OK (18M)
[backup 03:00:02] Rotación DB: 0 archivos >30d eliminados
[backup 03:00:02] Total: 15 DB dumps, 10 releases
```

Verificación de integridad: cada dump se valida con `pg_restore --list`
(lee el TOC del dump sin restaurar; si está corrupto, falla).

---

## 3. Backup automático (cron)

Como usuario `rysa` (NO root):

```bash
sudo -u rysa crontab -e
# Backup diario a las 03:00:
0 3 * * * /opt/rysa/repo/scripts/backup.sh >> /opt/rysa/logs/backup.log 2>&1
# Verificación semanal (domingo 04:00): si el último dump es >7 días, alerta
0 4 * * 0 [ $(find /opt/rysa/backups/db -name '*.dump' -mtime -7 | wc -l) -eq 0 ] && /opt/rysa/repo/scripts/backup.sh
```

---

## 4. Restaurar un dump (sin rollback de código)

```bash
# 1) Listar dumps disponibles
sudo /opt/rysa/repo/scripts/restore.sh

# 2) Restaurar
sudo /opt/rysa/repo/scripts/restore.sh /opt/rysa/backups/db/rysa_dev_20260115_030000.dump
# El script pide confirmación: escribe 'RESTAURAR'

# 3) Re-ejecutar migraciones (por si la BD restaurada es más vieja que el código)
cd /opt/rysa/repo
./scripts/deploy.sh
```

El script automáticamente:
1. Hace backup de la BD actual (a `pre_restore_<stamp>.dump`).
2. Borra y recrea la BD destino.
3. Restaura con `pg_restore`.
4. Te recuerda ejecutar `deploy.sh` para reaplicar migraciones si es necesario.

---

## 5. Rollback completo (código + BD)

Para revertir a una release anterior (commit específico) tras un deploy
defectuoso:

```bash
# 1) Listar releases disponibles
sudo /opt/rysa/repo/scripts/rollback.sh

# 2) Hacer rollback
sudo /opt/rysa/repo/scripts/rollback.sh /opt/rysa/backups/releases/release_a1b2c3d_20260115_030000.tar.gz
# El script pide confirmación: escribe 'ROLLBACK'
```

`rollback.sh`:
1. Backup de la BD actual → `pre_rollback_<stamp>.dump`.
2. Extrae el código de la release en `/opt/rysa/repo/` (preserva `.env.docker`).
3. Ofrece restaurar el dump de BD más reciente (opcional, recomendado).
4. Re-ejecuta `deploy.sh` (rebuild + up + healthcheck + smoke).

---

## 6. Probar restore en aislamiento

Para verificar que los backups funcionan sin tocar producción:

```bash
# Crear BD temporal con el dump
sudo /opt/rysa/repo/scripts/restore.sh /opt/rysa/backups/db/rysa_dev_20260115_030000.dump rysa_test
# Esto crea una BD llamada rysa_test (no toca rysa_dev).
# Verificar:
docker exec -it rysa_postgres psql -U rysa -d rysa_test -c "SELECT count(*) FROM users"
# Limpiar:
docker exec rysa_postgres dropdb -U rysa rysa_test
```

---

## 7. Política de retención y limpieza

`backup.sh` borra automáticamente lo que exceda la retención. Si quieres
cambiar:

```bash
# Editar crontab y exportar variables:
0 3 * * * BACKUP_RETAIN_DAYS=60 BACKUP_RETAIN_RELEASES=20 /opt/rysa/repo/scripts/backup.sh
```

Los backups nunca se eliminan dentro de su período de retención. El
script **nunca borra el último backup** sin haber creado uno nuevo
anteriormente.

---

## 8. Política de fallos

| Escenario | Comportamiento |
|---|---|
| `backup.sh` falla al hacer pg_dump | sale con código != 0, **no** crea release, **no** borra nada |
| `pg_restore --list` falla (dump corrupto) | log WARNING, pero el dump queda en disco para inspección |
| `restore.sh` falla durante pg_restore | log ERROR, sale con código != 0, BD queda en estado inconsistente (revisar logs y reintentar) |
| `rollback.sh` falla después de extraer código | re-deploy desde el código extraído, si falla también → restaurar manualmente el último dump bueno con `restore.sh` |
| Disco lleno durante backup | pg_dump falla, log ERROR, rotaciones no se ejecutan |
