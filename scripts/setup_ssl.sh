#!/usr/bin/env bash
# Configuración HTTPS + Let's Encrypt para RYSA.
#
# Pre-requisito: ./scripts/setup_vps.sh ejecutado (nginx + certbot instalados,
# UFW abierto en 80/443). El repositorio RYSA debe estar en /opt/rysa/repo
# y el stack debe estar levantado por ./scripts/deploy.sh.
#
# Uso (como root):
#   sudo DOMAIN=gruporysa.com EMAIL=ops@gruporysa.com \
#        /opt/rysa/repo/scripts/setup_ssl.sh
#
# Variables:
#   DOMAIN      (obligatorio) FQDN apuntando al VPS
#   EMAIL       (obligatorio) email para registro Let's Encrypt
#   NGINX_PORT  (opcional)    puerto del contenedor rysa_nginx (default 8080)
#   SKIP_DNS=1                salta verificación de DNS (útil en CI)
#
# Idempotente: re-ejecutar es seguro (renueva cert y reescribe config).
# No toca secretos (cert en /etc/letsencrypt, fuera del repo).

set -euo pipefail

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
NGINX_PORT="${NGINX_PORT:-${NGINX_HTTP_PORT:-8080}}"
SKIP_DNS="${SKIP_DNS:-}"
RYSA_HOME="${RYSA_HOME:-/opt/rysa}"
RYSA_REPO="${RYSA_HOME}/repo"
RYSA_LOG="/var/log/rysa_setup.log"

log()  { printf "\033[1;34m[setup_ssl]\033[0m %s\n" "$*"; echo "[$(date -Iseconds)] $*" >> "$RYSA_LOG"; }
ok()   { printf "\033[1;32m[setup_ssl]\033[0m %s\n" "$*"; echo "[$(date -Iseconds)] OK $*" >> "$RYSA_LOG"; }
err()  { printf "\033[1;31m[setup_ssl]\033[0m %s\n" "$*" >&2; echo "[$(date -Iseconds)] ERR $*" >> "$RYSA_LOG"; }

if [[ $EUID -ne 0 ]]; then
  err "ejecuta como root: sudo $0"
  exit 1
fi
if [[ -z "$DOMAIN" ]]; then
  err "define DOMAIN (ej. DOMAIN=gruporysa.com)"
  exit 1
fi
if [[ -z "$EMAIL" ]]; then
  err "define EMAIL (ej. EMAIL=ops@gruporysa.com)"
  exit 1
fi
for cmd in nginx certbot; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "$cmd no instalado. Ejecuta primero ./scripts/setup_vps.sh"
    exit 1
  fi
done
if [[ ! -d "$RYSA_REPO" ]]; then
  err "no se encuentra $RYSA_REPO. Clona el repositorio en $RYSA_HOME/repo"
  exit 1
fi

# === 1) Verificar DNS ============================================
log "1) Verificando que $DOMAIN apunta a este VPS..."
PUBLIC_IP=$(curl -fsSL --max-time 10 https://api.ipify.org 2>/dev/null || \
            curl -fsSL --max-time 10 https://ifconfig.me 2>/dev/null || \
            hostname -I | awk '{print $1}')
log "  IP pública del VPS: $PUBLIC_IP"
if [[ -z "$SKIP_DNS" ]]; then
  RESOLVED=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | head -1 | awk '{print $1}')
  if [[ -z "$RESOLVED" ]]; then
    RESOLVED=$(dig +short "$DOMAIN" A 2>/dev/null | head -1)
  fi
  if [[ -z "$RESOLVED" ]]; then
    err "DNS no resuelve $DOMAIN. Configura el registro A antes de continuar."
    exit 1
  fi
  log "  DNS resuelve a: $RESOLVED"
  if [[ "$RESOLVED" != "$PUBLIC_IP" ]]; then
    err "DNS ($RESOLVED) NO coincide con la IP del VPS ($PUBLIC_IP)."
    err "Configura el registro A de $DOMAIN -> $PUBLIC_IP y vuelve a correr."
    exit 1
  fi
  ok "DNS OK: $DOMAIN -> $PUBLIC_IP"
else
  log "  SKIP_DNS=1, saltando verificación"
fi

# === 2) Verificar/emitir certificado Let's Encrypt =================
log "2) Verificando certificado Let's Encrypt para $DOMAIN..."
if [[ -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
  log "  Certificado existente. Renovando si caduca en <30 días..."
  certbot renew --cert-name "$DOMAIN" --quiet || {
    err "certbot renew falló"; exit 1;
  }
else
  log "  Emitiendo certificado nuevo (HTTP-01 challenge)..."
  certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" || {
    err "certbot falló. Comprueba: DNS, puerto 80 abierto, certbot logs"
    exit 1
  }
fi
[[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]] || {
  err "certificado no encontrado en /etc/letsencrypt/live/$DOMAIN/"; exit 1;
}
ok "Certificado listo"

# === 3) Escribir /etc/nginx/sites-available/rysa ==================
log "3) Configurando nginx reverse proxy..."
SITE=/etc/nginx/sites-available/rysa
cat > "$SITE" <<EOF
# Generado por scripts/setup_ssl.sh — no editar a mano.
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # ACME challenge (renovación de Let's Encrypt)
    location ^~ /.well-known/acme-challenge/ {
        allow all;
        root /var/www/certbot;
    }

    # Redirección HTTP -> HTTPS
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
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_stapling        on;
    ssl_stapling_verify on;

    # HSTS: 1 año, incluye subdominios
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # ZIP legacy: hasta 350m
    client_max_body_size 350m;
    client_body_timeout 300s;

    access_log /var/log/nginx/rysa_access.log;
    error_log  /var/log/nginx/rysa_error.log;

    # Proxy al contenedor rysa_nginx (puerto del host)
    location / {
        proxy_pass http://127.0.0.1:$NGINX_PORT;
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
ln -sf "$SITE" /etc/nginx/sites-enabled/rysa
rm -f /etc/nginx/sites-enabled/default
ok "Nginx configurado"

# === 4) Validar y recargar nginx =================================
log "4) Validando y recargando nginx..."
nginx -t >> "$RYSA_LOG" 2>&1 || { err "nginx -t falló. Log: $RYSA_LOG"; exit 1; }
systemctl reload nginx
ok "Nginx recargado"

# === 5) Renovación automática ====================================
log "5) Programando renovación automática..."
if ! crontab -l 2>/dev/null | grep -q "certbot renew.*--deploy-hook"; then
  (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --deploy-hook 'systemctl reload nginx'") | crontab -
  ok "Renovación automática añadida al crontab (03:00 diario)"
fi

# === 6) Validación final ==========================================
log "6) Verificación final..."
sleep 2
HEALTH=$(curl -fsS --max-time 10 "https://$DOMAIN/health" 2>&1) || {
  err "https://$DOMAIN/health no responde. Comprueba docker compose logs nginx"
  exit 1
}
ok "https://$DOMAIN/health responde: $HEALTH"

HSTS=$(curl -sI --max-time 5 "https://$DOMAIN/" | grep -i strict-transport-security | head -1 | tr -d '\r')
[[ -n "$HSTS" ]] && ok "HSTS: $HSTS" || log "HSTS no presente (raro)"

ok "HTTPS configurado para $DOMAIN -> http://127.0.0.1:$NGINX_PORT"
