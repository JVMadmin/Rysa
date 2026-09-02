#!/usr/bin/env bash
# Configuración automática del reverse proxy nativo del VPS.
#
# Este script:
#   1. Instala certbot si no está.
#   2. Obtiene el certificado Let's Encrypt para el dominio configurado.
#   3. Escribe el archivo /etc/nginx/sites-available/rysa con:
#      - Redirección 80 -> 443
#      - HTTPS con TLS 1.2/1.3
#      - HSTS (1 año)
#      - proxy_pass al contenedor rysa_nginx (NGINX_HTTP_PORT, default 8080)
#      - client_max_body_size 350m (para el ZIP legacy)
#   4. Habilita el sitio y recarga nginx.
#   5. Programa la renovación automática vía cron/systemd.
#
# Uso (ejecutar UNA VEZ como root desde /opt/rysa/Rysa):
#   sudo DOMAIN=gruporysa.com EMAIL=ops@gruporysa.com ./scripts/setup_nginx_host.sh
#
# Variables:
#   DOMAIN    (obligatorio) -> FQDN apuntando al VPS
#   EMAIL     (obligatorio) -> email para Let's Encrypt
#   BACKEND_PORT (opcional) -> puerto del contenedor rysa_nginx (default 8080)
#   SKIP_CERTBOT=1         -> no ejecutar certbot (ej. en CI/sin DNS aún)
#
# Idempotente: re-ejecutar es seguro; actualiza la configuración y renueva cert.

set -euo pipefail

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
BACKEND_PORT="${BACKEND_PORT:-${NGINX_HTTP_PORT:-8080}}"
SKIP_CERTBOT="${SKIP_CERTBOT:-}"

if [[ $EUID -ne 0 ]]; then
  echo "[setup_nginx] ERROR: ejecuta como root (sudo ./scripts/setup_nginx_host.sh)" >&2
  exit 1
fi
if [[ -z "$DOMAIN" ]]; then
  echo "[setup_nginx] ERROR: define DOMAIN (ej. DOMAIN=gruporysa.com)" >&2
  exit 1
fi
if [[ -z "$EMAIL" && -z "$SKIP_CERTBOT" ]]; then
  echo "[setup_nginx] ERROR: define EMAIL (ej. EMAIL=ops@$DOMAIN)" >&2
  exit 1
fi

log()  { printf "\033[1;34m[setup_nginx]\033[0m %s\n" "$*"; }
ok()   { printf "\033[1;32m[setup_nginx]\033[0m %s\n" "$*"; }
err()  { printf "\033[1;31m[setup_nginx]\033[0m %s\n" "$*" >&2; }

# 1) Instalar certbot si no está
if ! command -v certbot >/dev/null 2>&1; then
  log "Instalando certbot..."
  apt-get update -qq
  apt-get install -y -qq certbot python3-certbot-nginx
fi

# 2) Obtener/renovar certificado
if [[ -z "$SKIP_CERTBOT" ]]; then
  log "Obteniendo certificado Let's Encrypt para $DOMAIN..."
  certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" || \
  certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL"
fi

if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  err "Certificado no encontrado en /etc/letsencrypt/live/$DOMAIN/"
  err "Si el DNS aún no apunta al VPS, ejecuta con SKIP_CERTBOT=1 y vuelve luego."
  exit 1
fi

# 3) Escribir configuración del sitio
SITE=/etc/nginx/sites-available/rysa
log "Escribiendo $SITE..."
cat > "$SITE" <<EOF
# Generado por scripts/setup_nginx_host.sh — no editar a mano.
# Reverse proxy HTTPS para Grupo RYSA ERP.

# Redirección HTTP -> HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # Certbot: dejar este bloque si se usa certbot --nginx (renewal hooks).
    location ^~ /.well-known/acme-challenge/ {
        allow all;
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    # HSTS: 1 año, incluye subdominios.
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # ZIP legacy: hasta 350m.
    client_max_body_size 350m;
    client_body_timeout 300s;

    # Logs
    access_log /var/log/nginx/rysa_access.log;
    error_log  /var/log/nginx/rysa_error.log;

    # Proxy al contenedor rysa_nginx (puerto del host donde escucha).
    location / {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host  \$host;
        proxy_set_header X-Forwarded-Port  \$server_port;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF

# 4) Habilitar sitio y validar
ln -sf "$SITE" /etc/nginx/sites-enabled/rysa
# Quitar el default si existe y no apunta a nada útil
if [[ -f /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl reload nginx
ok "Nginx recargado con la nueva configuración"

# 5) Renovación automática
if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
  log "Programando renovación automática de Let's Encrypt..."
  (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --deploy-hook 'systemctl reload nginx'") | crontab -
  ok "Renovación automática añadida al crontab (03:00 diario)"
fi

# 6) Verificación final
log "Verificando HTTPS..."
sleep 2
if curl -fsSL --max-time 10 "https://$DOMAIN/health" >/dev/null 2>&1; then
  ok "https://$DOMAIN/health responde OK"
else
  err "https://$DOMAIN no responde todavía."
  err "Comprueba: systemctl status nginx && journalctl -u nginx --tail=20"
  exit 1
fi

ok "Reverse proxy configurado para $DOMAIN -> http://127.0.0.1:$BACKEND_PORT"
