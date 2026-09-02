# Despliegue de RYSA en VPS desde cero

Esta guía cubre el despliegue reproducible de Grupo RYSA ERP en un VPS
nuevo. Asume Ubuntu/Debian reciente y acceso root.

---

## 0. Requisitos del VPS

- **SO**: Ubuntu 22.04+ o Debian 12+
- **Recursos mínimos**: 2 vCPU, 4 GB RAM, 20 GB disco
- **Puertos**: 80, 443 (HTTP/HTTPS) abiertos
- **Dominio apuntando al VPS** (para HTTPS con Let's Encrypt)

---

## 1. Instalar Docker Engine + Compose v2

```bash
sudo apt remove -y docker docker-engine docker.io containerd runc || true
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
   https://download.docker.com/linux/ubuntu \
   $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker $USER
newgrp docker
docker --version          # >= 24
docker compose version    # >= 2.20
```

---

## 2. Clonar el repositorio

```bash
sudo mkdir -p /opt/rysa && sudo chown $USER:$USER /opt/rysa
cd /opt/rysa
git clone https://github.com/JVMadmin/Rysa.git
cd Rysa
```

---

## 3. Crear el `.env` (fuera del repo)

Este archivo **NO se commitea**. Contiene los secretos reales.

```bash
cp .env.docker.example .env.docker
nano .env.docker        # editar valores
```

Variables obligatorias a cambiar:

| Variable | Acción |
|---|---|
| `POSTGRES_PASSWORD` | Generar: `openssl rand -hex 24` |
| `JWT_SECRET` | Generar: `openssl rand -hex 32` |
| `ADMIN_EMAIL` | Email del primer administrador |
| `ADMIN_PASSWORD` | Mínimo 12 caracteres |
| `CORS_ORIGINS` | `https://tu-dominio.com` |
| `ENVIRONMENT` | `production` |
| `DEVELOPER_MODE` | `false` |
| `LEGACY_MIGRATION_ENABLED` | `false` (se activa después para migrar) |
| `PUBLIC_BASE_URL` | `https://tu-dominio.com` |

> `scripts/check_installation.py` valida que los placeholders
> `<CAMBIAR...>` y `<GENERA...>` no estén presentes. Cualquier valor
> que los contenga será rechazado.

### Ejemplo de `.env.docker` para producción

```env
ENVIRONMENT=production
DEVELOPER_MODE=false
LEGACY_MIGRATION_ENABLED=false
POSTGRES_USER=rysa
POSTGRES_PASSWORD=<openssl rand -hex 24>
POSTGRES_DB=rysa
BACKEND_DATABASE_URL=postgresql+asyncpg://rysa:<...>@postgres:5432/rysa_dev
JWT_SECRET=<openssl rand -hex 32>
LOGIN_RATE_LIMIT=on
CORS_ORIGINS=https://gruporysa.com
UPLOAD_DIR=/app/uploads
PUBLIC_BASE_URL=https://gruporysa.com
ADMIN_EMAIL=admin@gruporysa.com
ADMIN_PASSWORD=<12+ chars>
ADMIN_NAME=Admin
NGINX_HTTP_PORT=8080
LEGACY_ZIP_MAX_MB=500
```

---

## 4. Levantar el stack

```bash
# Build + up + diagnóstico (recomendado)
./scripts/deploy.sh

# Rebuild desde cero (sin cache)
./scripts/deploy.sh --no-cache

# Solo diagnóstico, sin redeploy
./scripts/deploy.sh --check
```

El script:

1. `git pull --ff-only`
2. `docker compose build` (o `--no-cache`)
3. `docker compose up -d`
4. Espera a que los healthchecks estén `healthy` (alembic + uvicorn + nginx)
5. Ejecuta `check_installation.py` dentro del backend

---

## 5. Configurar HTTPS (Let's Encrypt)

### 5.1. Certbot en el host + Nginx del VPS

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d tu-dominio.com
# -> /etc/letsencrypt/live/tu-dominio.com/{fullchain.pem,privkey.pem}
```

Mapea los certs al contenedor `rysa_nginx` (en `docker-compose.yml`):

```yaml
volumes:
  - /etc/letsencrypt:/etc/letsencrypt:ro
```

Activa la configuración TLS (renombra `docker/nginx/default.conf.tls` →
`default.conf`) y rebuildea el contenedor nginx:

```bash
cp docker/nginx/default.conf.tls docker/nginx/default.conf
docker compose build nginx
docker compose up -d nginx
```

### 5.2. Solo HTTP (sin dominio, IP del VPS)

El stack ya arranca con HTTP en `${NGINX_HTTP_PORT:-8080}`. Útil para
entornos internos. El firewall debe permitir 8080 (o el puerto elegido).

---

## 6. Crear el primer administrador (bootstrap)

Con `ENVIRONMENT=production` el seed automático de admin está
deshabilitado (decisión de seguridad). Crear manualmente:

```bash
docker compose exec -T postgres psql -U rysa -d rysa_dev <<'SQL'
-- Crea un admin con password temporal (cámbialo en el primer login).
-- El hash se genera con bcrypt; el siguiente es para 'CambiaEstaPassw0rd!' (16 chars).
INSERT INTO users (id, email, name, role, password_hash, active, token_version, created_at)
VALUES (
  'admin-' || extract(epoch from now())::text,
  'admin@gruporysa.com',
  'Admin',
  'admin_propietario',
  '$2b$12$<bcrypt-hash-aqui>',
  true,
  0,
  now()
)
ON CONFLICT (email) DO UPDATE
  SET role = 'admin_propietario',
      token_version = users.token_version + 1;
SQL
```

> Para generar el hash bcrypt de la contraseña:
> `python -c "import bcrypt; print(bcrypt.hashpw(b'TuPassword', bcrypt.gensalt(12)).decode())"`

Tras insertar, **inicia sesión** con ese email/password. La primera
acción debería ser cambiar la contraseña desde la UI.

---

## 7. Verificar la instalación

```bash
./scripts/deploy.sh --check
```

Salida esperada (sin errores):

```
[OK] Environment
[OK] PostgreSQL
[OK] Alembic
[OK] Tablas productivas
[OK] Tablas legacy_*
[OK] Users
[OK] Products
[OK] Sales
[OK] Ventas LEGACY
[OK] legacy_data dir
[OK] Health API
[OK] Sistema instalado correctamente.
```

---

## 8. Habilitar el módulo Legacy para migrar el histórico

1. Editar `.env.docker`:
   ```env
   ENVIRONMENT=development       # el import exige != production
   DEVELOPER_MODE=true
   LEGACY_MIGRATION_ENABLED=true
   LEGACY_ZIP_MAX_MB=500         # 2-3x el tamaño del ZIP
   ```
2. Re-deploy:
   ```bash
   ./scripts/deploy.sh
   ```
3. Promover un usuario a `admin_desarrollador` (re-loguear después):
   ```sql
   docker compose exec -T postgres psql -U rysa -d rysa_dev -c \
     "UPDATE users SET role='admin_desarrollador', \
      token_version = token_version + 1 \
      WHERE email='admin@gruporysa.com';"
   ```
4. **Iniciar sesión otra vez** en la UI (token nuevo con el rol).
5. **Herramientas → Legacy → Datos** → subir el ZIP (~29 MB).
6. Secuencia: **Discovery → Staging → Review → Dry-run → Import**

> El ZIP (~29 MB) está dentro del límite por defecto (300 MB). Si crece,
> sube `LEGACY_ZIP_MAX_MB` en `.env` y, si superas 350 MB, el
> `client_max_body_size` en `docker/nginx/default.conf`.

---

## 9. Desactivar el módulo Legacy tras la migración

```env
ENVIRONMENT=production
DEVELOPER_MODE=false
LEGACY_MIGRATION_ENABLED=false
```

```bash
./scripts/deploy.sh
```

Esto cierra las rutas de import (`/api/legacy/import` → 404,
`/api/legacy/data/deploy` → 403). Los datos en `legacy_*` se conservan
para auditoría.

---

## 10. Backups

Diario (cron en el host):

```bash
0 3 * * * cd /opt/rysa && ./scripts/pg_backup.sh >> /var/log/rysa_backup.log 2>&1
```

Restaurar (probar antes en una BD nueva):

```bash
docker compose exec -T postgres createdb -U rysa rysa_test
docker exec -i rysa_postgres pg_restore -U rysa -d rysa_test --clean --if-exists \
  < /var/backups/rysa/rysa_prod_YYYYMMDD.dump
```

Los volúmenes `pgdata` y `uploads` se conservan al recrear
contenedores (`docker compose up -d`). Para backups de volúmenes
directos:

```bash
docker run --rm -v rysa_pgdata:/from -v $(pwd):/to alpine \
  tar czf /to/pgdata_$(date +%F).tgz -C /from .
```

---

## 11. Troubleshooting

### Backend reinicia en bucle

```bash
docker compose logs backend --tail=100
```

Causas típicas:

- `DATABASE_URL` mal escrito → "could not translate host"
- `JWT_SECRET` con placeholder `<CAMBIAR...>` → check_installation lo detecta
- `POSTGRES_PASSWORD` cambiado sin recrear el volumen pgdata

### Migraciones no aplican

```bash
docker compose exec backend alembic current
docker compose exec backend alembic upgrade head
```

### ZIP legacy devuelve 413

El `client_max_body_size` del nginx de Docker es 350m (configurado en
`docker/nginx/default.conf`). Si hay un nginx externo o Cloudflare
delante, hay que configurarlo también.

### El frontend queda en blanco

```bash
docker compose logs frontend --tail=50
```

Normalmente: build de CRA falló por memoria. Re-deploy con
`NODE_OPTIONS=--max-old-space-size=4096` antes de `./scripts/deploy.sh`.

### Diagnóstico reporta tablas legacy_* faltantes

Significa que `alembic upgrade head` no corrió (backend cayó antes).
Forzar:

```bash
docker compose exec backend alembic upgrade head
```

Y re-correr `./scripts/deploy.sh --check`.
