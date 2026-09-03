# RYSA — Operación en Producción

Esta guía cubre la operación del día a día de un despliegue RYSA en
producción (VPS Ubuntu 24.04). Asume que la instalación inicial está
hecha (ver `DEPLOY_VPS.md`).

---

## Estructura de scripts

```
/opt/rysa/
├── repo/                 # código fuente (git clone)
│   ├── scripts/
│   │   ├── setup_vps.sh    # bootstrap inicial del VPS
│   │   ├── setup_ssl.sh    # HTTPS + Let's Encrypt
│   │   ├── deploy.sh       # deploy completo (cadena)
│   │   ├── backup.sh       # backup DB + release
│   │   ├── restore.sh      # restaurar dump
│   │   ├── rollback.sh     # revertir a release anterior
│   │   ├── healthcheck.sh  # verificación centralizada
│   │   ├── test_all.sh     # smoke tests post-deploy
│   │   ├── status.sh       # estado rápido del stack
│   │   └── pg_backup.sh    # alias de backup.sh (compatibilidad)
│   └── DEPLOY_VPS.md
└── backups/
    ├── db/                 # *.dump de PostgreSQL
    └── releases/           # *.tar.gz de código (para rollback)
```

---

## 1. Instalación inicial (un VPS nuevo)

```bash
# 1) Bootstrap del VPS (paquetes, Docker, UFW, fail2ban, logrotate, usuario rysa)
sudo ./scripts/setup_vps.sh

# 2) Configurar HTTPS (Let's Encrypt para el dominio público)
sudo DOMAIN=gruporysa.com EMAIL=ops@gruporysa.com ./scripts/setup_ssl.sh

# 3) Configurar .env.docker con los secretos definitivos
sudo -u rysa cp .env.docker.example .env.docker
sudo -u rysa nano .env.docker
# Generar:
#   POSTGRES_PASSWORD=$(openssl rand -hex 24)
#   JWT_SECRET=$(openssl rand -hex 32)
#   ADMIN_PASSWORD=$(openssl rand -hex 8)MiEmpresa2026!
# Ajustar:
#   ADMIN_EMAIL=admin@gruporysa.com
#   ENVIRONMENT=production
#   DOMAIN=gruporysa.com
#   CORS_ORIGINS=https://gruporysa.com

# 4) Primer deploy (crea BD, ejecuta migraciones, bootstrap admin, healthcheck)
sudo -u rysa ./scripts/deploy.sh
```

A partir de aquí, **no se requieren más pasos manuales**.

---

## 2. Operación normal

### Despliegue de código nuevo

```bash
cd /opt/rysa/repo
git pull
./scripts/deploy.sh
```

`deploy.sh` ejecuta, en orden:
1. Pre-chequeos (git limpio, disco, secretos válidos)
2. Backup pre-deploy (BD + snapshot de release)
3. `git pull` + `docker compose build`
4. `docker compose up -d`
5. Healthcheck de postgres → backend → frontend → nginx
6. `check_installation.py` (12 checks)
7. Smoke tests (login, API, HTTPS)
8. Verificación pública (si hay DOMAIN)

Si algo falla, el script aborta con `DEPLOY FAILED` y deja el stack en
el último estado conocido.

### Ver estado

```bash
./scripts/status.sh
```

Muestra: commit/branch actual, containers (con healthcheck y uptime),
BD (conteos por tabla), HTTPS, último backup, espacio en disco.

### Healthcheck

```bash
./scripts/healthcheck.sh
```

Comprueba: Docker, PostgreSQL, backend (`/health`, `/api/health/db`),
frontend, nginx interno, HTTPS público, API smoke (login + endpoints
críticos), espacio en disco, memoria.

Salida: `HEALTHCHECK PASS` / `HEALTHCHECK WARN` / `HEALTHCHECK FAIL`.

### Smoke tests

```bash
./scripts/test_all.sh
```

Login + GET a endpoints críticos (`/api/products`, `/api/clients`,
`/api/sales`, `/api/cxc`, `/api/users`, `/api/health/db`).

---

## 3. Backups

### Automático (cron)

```bash
# Crontab del usuario rysa (NO root, NO necesita sudo):
crontab -e
# Diario a las 03:00:
0 3 * * * cd /opt/rysa/repo && /opt/rysa/repo/scripts/backup.sh >> /opt/rysa/logs/backup.log 2>&1
```

### Manual

```bash
./scripts/backup.sh
# -> /opt/rysa/backups/db/rysa_dev_YYYYMMDD_HHMMSS.dump
# -> /opt/rysa/backups/releases/release_<commit>_YYYYMMDD_HHMMSS.tar.gz
```

Retención: 30 días para DB, 10 releases (configurable con
`BACKUP_RETAIN_DAYS` y `BACKUP_RETAIN_RELEASES`).

### Restaurar un dump

```bash
sudo ./scripts/restore.sh /opt/rysa/backups/db/rysa_dev_20260115_030000.dump
# (te pide confirmación tipeando RESTAURAR)
```

Ver `BACKUP_RESTORE.md` para detalle.

### Rollback a una release anterior

```bash
sudo ./scripts/rollback.sh
# (lista las últimas 5 releases)
sudo ./scripts/rollback.sh /opt/rysa/backups/releases/release_<commit>_<stamp>.tar.gz
# (te pide confirmación tipeando ROLLBACK)
```

`rollback.sh`:
1. Hace backup de la BD actual.
2. Extrae el código de la release.
3. Ofrece restaurar el dump de BD más reciente (opcional).
4. Re-ejecuta `deploy.sh`.

---

## 4. Actualizaciones de seguridad del VPS

`setup_vps.sh` activa `unattended-upgrades`. El VPS se actualiza solo.
Para forzar:

```bash
sudo apt update && sudo apt upgrade -y
```

Tras un cambio de kernel puede requerir reinicio (no automático).

---

## 5. CI/CD (opcional)

Con GitHub Actions configurado (ver `.github/workflows/`), cada push a
`evolucion-comercial` dispara:

```
push
  ↓
ci.yml: tests + build + security gate (bandit)
  ↓ (si todo OK)
deploy-vps.yml: SSH al VPS + ./scripts/deploy.sh + healthcheck
```

Secrets requeridos en GitHub (Settings → Secrets):
- `VPS_SSH_KEY`: clave privada SSH del usuario `rysa` en el VPS
- `VPS_HOST`: hostname/IP del VPS
- `VPS_USER`: `rysa`

Para activar la clave SSH en el VPS (una vez):

```bash
# Local:
ssh-copy-id -i ~/.ssh/rysa_vps.pub rysa@<VPS_HOST>
# o añadir manualmente a /home/rysa/.ssh/authorized_keys
```

---

## 6. Troubleshooting

| Síntoma | Diagnóstico | Solución |
|---|---|---|
| `HEALTHCHECK FAIL` en postgres | `docker logs rysa_postgres` | ver logs, comprobar `docker compose up -d` |
| Backend reinicia en bucle | `docker logs rysa_backend --tail=100` | comprobar `DATABASE_URL`, `JWT_SECRET` |
| 413 al subir ZIP | `client_max_body_size` en nginx | editar `/etc/nginx/sites-available/rysa` (en host) y/o `docker/nginx/default.conf` (en repo) |
| HTTPS caído | `sudo certbot certificates` | re-ejecutar `./scripts/setup_ssl.sh` |
| Disco lleno | `df -h` + `./scripts/backup.sh` (purga automáticos) | `sudo find /opt/rysa/logs -mtime +30 -delete` |
| Login no funciona | `ADMIN_PASSWORD` en `.env.docker` | si es dev: re-deploy (no cambia password de admins existentes); si perdiste el password: `docker exec -T rysa_postgres psql -U rysa -d rysa_dev -c "UPDATE users SET password_hash=crypt('NewPwd', gen_salt('bf',12)) WHERE email='admin@...'"` |

---

## 7. Variables de entorno (referencia)

| Variable | Productivo | Dev |
|---|---|---|
| `ENVIRONMENT` | `production` | `development` |
| `DEVELOPER_MODE` | `false` | `true` |
| `LEGACY_MIGRATION_ENABLED` | `false` (activar solo durante migración) | `false` |
| `DOMAIN` | `gruporysa.com` | vacío |
| `BACKEND_DATABASE_URL` | NO `rysa_dev` | `rysa_dev` |
| `POSTGRES_PASSWORD` | 24 bytes hex (generados) | dev-only |
| `JWT_SECRET` | 32 bytes hex (generados) | dev-only |
| `ADMIN_PASSWORD` | ≥ 12 chars (generados) | dev-only |

`scripts/deploy.sh` valida todas estas en producción y aborta con
`DEPLOY FAILED` si falta algo.

---

## 8. Secretos y .gitignore

El repo **nunca debe contener**:
- `backend/.env`, `backend/.env.*` (reales)
- `.env.docker`, `.env.docker.local`
- claves SSH (`*.pem`, `*.key`)
- tokens, JWT secrets
- credenciales de Facturama

Verificado con `git check-ignore` en CI. El `.env.docker.example` y
`.env.production.example` solo tienen placeholders `<CAMBIAR...>`.
