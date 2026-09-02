# Despliegue de RYSA en VPS desde cero

Esta guía cubre el despliegue reproducible de Grupo RYSA ERP en un VPS
nuevo. Asume Ubuntu/Debian reciente y acceso root.

**Arquitectura objetivo:**

```
Internet (HTTPS 443)
    ↓
nginx nativo del VPS  ←  scripts/setup_nginx_host.sh (Let's Encrypt)
    ↓ proxy_pass 127.0.0.1:8080
Docker (contenedor rysa_nginx)
    ↓ proxy_pass interno a backend:8000 + frontend:80
Docker (backend + frontend + postgres)
```

**No se requiere ningún paso manual fuera de:**
1. `git clone`
2. `cp .env.docker.example .env.docker && nano .env.docker` (secretos)
3. `./scripts/deploy.sh` (stack)
4. `sudo ./scripts/setup_nginx_host.sh` (HTTPS)

Tras eso, `git pull && ./scripts/deploy.sh` actualiza todo.

---

## 0. Requisitos del VPS

- **SO**: Ubuntu 22.04+ o Debian 12+
- **Recursos mínimos**: 2 vCPU, 4 GB RAM, 20 GB disco
- **Puertos**: 80, 443 abiertos
- **Dominio apuntando al VPS** (ej. `gruporysa.com`)

---

## 1. Instalar Docker Engine + nginx + certbot

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx

# Repositorio oficial de Docker
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
docker --version
docker compose version
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

## 3. Crear el `.env.docker` (fuera del repo)

```bash
cp .env.docker.example .env.docker
nano .env.docker
```

Variables a rellenar (genera con `openssl rand -hex N`):

| Variable | Requisito |
|---|---|
| `POSTGRES_PASSWORD` | 24 bytes hex (48 chars) |
| `JWT_SECRET` | 32 bytes hex (64 chars) |
| `ADMIN_EMAIL` | Email del primer administrador |
| `ADMIN_PASSWORD` | ≥ 12 chars (será el password inicial) |
| `ENVIRONMENT` | `production` |
| `DEVELOPER_MODE` | `false` |
| `LEGACY_MIGRATION_ENABLED` | `false` (se activa para migrar) |
| `DOMAIN` | `gruporysa.com` |
| `PUBLIC_BASE_URL` | `https://${DOMAIN}` |
| `CORS_ORIGINS` | `https://${DOMAIN}` |
| `NGINX_HTTP_PORT` | `8080` (puerto interno del contenedor `rysa_nginx`) |
| `LETSENCRYPT_EMAIL` | `ops@${DOMAIN}` (para el script de nginx) |
| `LEGACY_ZIP_MAX_MB` | `500` |

`./scripts/deploy.sh` y `scripts/check_installation.py` validan que los
secretos no sean placeholders ni demasiado cortos.

---

## 4. Levantar el stack Docker

```bash
# Build + up + healthchecks + diagnóstico
./scripts/deploy.sh

# Rebuild desde cero
./scripts/deploy.sh --no-cache

# Solo diagnóstico
./scripts/deploy.sh --check
```

El script:

1. `git pull --ff-only`
2. Valida secretos (no placeholders, longitudes)
3. `docker compose build` (o `--no-cache`)
4. `docker compose up -d`
5. Espera healthcheck de postgres → backend → frontend → nginx
6. Ejecuta `check_installation.py` (12 checks)
7. Si `DOMAIN` está definido, verifica respuesta HTTP/HTTPS

Si `bootstrap_admin` se ejecuta al arrancar el backend, el admin ya
queda creado en el primer arranque (ver `backend/scripts/bootstrap_admin.py`).

---

## 5. Configurar HTTPS en el nginx nativo del VPS

Una vez el stack está saludable y el DNS de `gruporysa.com` apunta al VPS:

```bash
sudo DOMAIN=gruporysa.com \
     EMAIL=ops@gruporysa.com \
     ./scripts/setup_nginx_host.sh
```

El script:
1. Verifica/instala certbot.
2. Emite el certificado Let's Encrypt (HTTP-01 challenge por el puerto 80).
3. Escribe `/etc/nginx/sites-available/rysa` con:
   - Redirección 80 → 443
   - HTTPS (TLS 1.2/1.3)
   - HSTS (1 año, `includeSubDomains`)
   - Cabeceras de seguridad (X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
   - `client_max_body_size 350m` (para el ZIP legacy)
   - `proxy_pass http://127.0.0.1:${NGINX_HTTP_PORT:-8080}` (al contenedor `rysa_nginx`)
4. Habilita el sitio y recarga nginx.
5. Programa la renovación automática en el crontab (`certbot renew --quiet --deploy-hook 'systemctl reload nginx'`).
6. Verifica que `https://${DOMAIN}/health` responda.

**Idempotente.** Re-ejecutar es seguro: actualiza la configuración y renueva el cert.

**`SKIP_CERTBOT=1`** si el DNS aún no apunta al VPS; deja la config lista y ejecuta después sin ese flag.

---

## 6. Crear el primer administrador (ya es automático)

El backend ejecuta `python -m scripts.bootstrap_admin` en cada arranque
(entrypoint en `backend/Dockerfile`). El script:

- Crea el admin si `ADMIN_EMAIL`/`ADMIN_PASSWORD` están definidos.
- Actualiza password y rol `admin_propietario` si ya existe (idempotente).
- Es seguro correrlo múltiples veces; no duplica usuarios.

**No se requiere creación manual de admin.** Solo define `ADMIN_EMAIL` y
`ADMIN_PASSWORD` (≥ 12 chars) en `.env.docker` antes del primer
`./scripts/deploy.sh`.

Tras el primer login, **cambia la contraseña** desde la UI.

---

## 7. Verificar la instalación

```bash
./scripts/deploy.sh --check
```

Salida esperada:

```
[OK] Environment
[OK] Secrets no son placeholders
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
   ```
2. Re-deploy:
   ```bash
   ./scripts/deploy.sh
   ```
3. Promover un usuario a `admin_desarrollador`:
   ```sql
   docker compose exec -T postgres psql -U rysa -d rysa_dev -c \
     "UPDATE users SET role='admin_desarrollador',
      token_version = token_version + 1
      WHERE email='admin@gruporysa.com';"
   ```
4. **Re-login** en la UI (token nuevo con el rol).
5. **Herramientas → Legacy → Datos** → subir el ZIP.
6. Secuencia: Discovery → Staging → Review → Dry-run → Import.

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

Las rutas de import devuelven 404/403; los datos en `legacy_*` se conservan
para auditoría.

---

## 10. Backups

```bash
0 3 * * * cd /opt/rysa/Rysa && ./scripts/pg_backup.sh >> /var/log/rysa_backup.log 2>&1
```

Restaurar (en una BD nueva para validar):
```bash
docker compose exec -T postgres createdb -U rysa rysa_test
docker exec -i rysa_postgres pg_restore -U rysa -d rysa_test --clean --if-exists \
  < /var/backups/rysa/rysa_prod_YYYYMMDD.dump
```

---

## 11. Troubleshooting

### El dominio no responde tras `setup_nginx_host.sh`

- DNS: `dig +short gruporysa.com` debe apuntar a la IP del VPS
- Firewall: `sudo ufw status` (debe permitir 80 y 443)
- nginx: `systemctl status nginx && journalctl -u nginx --tail=30`
- Cert: `sudo certbot certificates`

### ZIP legacy devuelve 413

- nginx nativo del host: `client_max_body_size 350m;` en `/etc/nginx/sites-available/rysa` (lo escribe el script).
- nginx interno del contenedor (`docker/nginx/default.conf`): `client_max_body_size 350m;` también.
- Si el ZIP excede 350 MB: editar ambos archivos y `NGINX_HTTP_PORT` no aplica, solo cambiar el límite.
- `LEGACY_ZIP_MAX_MB` en `.env.docker` (default 500) y `client_max_body_size` deben coincidir.

### El frontend queda en blanco

```bash
docker compose logs frontend --tail=50
```

Build de CRA falló por memoria. Re-deploy con:
```bash
NODE_OPTIONS=--max-old-space-size=4096 ./scripts/deploy.sh --no-cache
```

### Diagnóstico reporta tablas legacy_* faltantes

```bash
docker compose exec backend alembic upgrade head
./scripts/deploy.sh --check
```

### Reinicio limpio (sin perder datos)

Los volúmenes `pgdata`, `uploads`, `legacy_data`, `legacy_reports` son
persistentes. `docker compose down` los conserva. `docker compose down
-v` los borra (NO recomendado).
