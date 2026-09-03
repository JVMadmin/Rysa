#!/usr/bin/env bash
# Bootstrap de un VPS Ubuntu 24.04 NUEVO para RYSA ERP.
#
# Pre-requisito: ejecutar como root (`sudo ./scripts/setup_vps.sh`).
#
# Instala y deja configurado:
#   - Paquetes base: git, curl, jq, ufw, fail2ban, unattended-upgrades
#   - Docker Engine + Compose v2
#   - nginx + certbot + python3-certbot-nginx (TLS vía Let's Encrypt)
#   - UFW (firewall: 22, 80, 443 abiertos; resto cerrado)
#   - Estructura /opt/rysa/{repo,backups,logs}
#   - Usuario rysa (sudo sin password para docker) — opcional via RYSA_USER
#   - Rotación de logs (logrotate) para backups y nginx
#   - Banner informativo al iniciar sesión
#
# IDEMPOTENTE: re-ejecutar es seguro (apt install -y + `command -v` checks).
# NO destructivo: no toca /opt/rysa/Rysa si ya existe (clónalo a mano antes).
# NO almacena secretos en el repo.

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

RYSA_USER="${RYSA_USER:-rysa}"
RYSA_HOME="/opt/rysa"
RYSA_LOG="/var/log/rysa_setup.log"
APT_UPDATED_FLAG="/var/lib/rysa_apt_updated"

log()  { printf "\033[1;34m[setup_vps]\033[0m %s\n" "$*"; echo "[$(date -Iseconds)] $*" >> "$RYSA_LOG"; }
ok()   { printf "\033[1;32m[setup_vps]\033[0m %s\n" "$*"; echo "[$(date -Iseconds)] OK $*" >> "$RYSA_LOG"; }
err()  { printf "\033[1;31m[setup_vps]\033[0m %s\n" "$*" >&2; echo "[$(date -Iseconds)] ERR $*" >> "$RYSA_LOG"; }

if [[ $EUID -ne 0 ]]; then
  err "ejecuta como root: sudo $0"
  exit 1
fi

mkdir -p "$(dirname "$RYSA_LOG")"
: > "$RYSA_LOG"

# === 1) Actualización del sistema (solo una vez por día) ============
log "1) Actualizando índice de paquetes..."
if [[ ! -f "$APT_UPDATED_FLAG" ]] || [[ $(find "$APT_UPDATED_FLAG" -mmin +720 2>/dev/null) ]]; then
  apt-get update -qq >> "$RYSA_LOG" 2>&1
  apt-get upgrade -y -qq >> "$RYSA_LOG" 2>&1
  touch "$APT_UPDATED_FLAG"
  ok "Sistema actualizado"
else
  log "Sistema ya actualizado hace <12h; saltando"
fi

# === 2) Paquetes base ==============================================
log "2) Instalando paquetes base..."
NEEDED=(git curl jq ufw fail2ban unattended-upgrades apt-listchanges \
        ca-certificates gnupg rsync logrotate nginx certbot python3-certbot-nginx)
TO_INSTALL=()
for p in "${NEEDED[@]}"; do
  if ! dpkg -s "$p" >/dev/null 2>&1; then
    TO_INSTALL+=("$p")
  fi
done
if [[ ${#TO_INSTALL[@]} -gt 0 ]]; then
  apt-get install -y -qq "${TO_INSTALL[@]}" >> "$RYSA_LOG" 2>&1
  ok "Paquetes instalados: ${TO_INSTALL[*]}"
else
  log "Todos los paquetes base ya están instalados"
fi

# === 3) Actualizaciones automáticas de seguridad ===================
log "3) Configurando unattended-upgrades..."
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF
ok "Unattended-upgrades activo (sin auto-reboot)"

# === 4) Docker Engine + Compose v2 ================================
log "4) Instalando Docker Engine + Compose v2..."
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq >> "$RYSA_LOG" 2>&1
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin >> "$RYSA_LOG" 2>&1
  ok "Docker instalado: $(docker --version)"
else
  log "Docker ya instalado: $(docker --version)"
fi

# === 5) Crear usuario rysa (no root) ==============================
log "5) Asegurando usuario ${RYSA_USER}..."
if ! id "$RYSA_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$RYSA_USER"
  ok "Usuario ${RYSA_USER} creado"
fi
# Acceso a docker sin sudo (re-login para que el grupo aplique)
if ! groups "$RYSA_USER" | grep -qw docker; then
  usermod -aG docker "$RYSA_USER"
  log "Añadido ${RYSA_USER} al grupo docker (re-login necesario)"
fi
# Sudo sin password SOLO para docker
echo "${RYSA_USER} ALL=(ALL) NOPASSWD: /usr/bin/docker, /usr/bin/docker compose, /usr/bin/systemctl restart nginx, /usr/bin/systemctl reload nginx" \
  > /etc/sudoers.d/90-${RYSA_USER}-docker
chmod 0440 /etc/sudoers.d/90-${RYSA_USER}-docker
ok "Sudoers de ${RYSA_USER} configurado (solo docker + nginx)"

# === 6) Estructura /opt/rysa =======================================
log "6) Creando estructura ${RYSA_HOME}..."
install -d -o "$RYSA_USER" -g "$RYSA_USER" -m 0755 \
  "${RYSA_HOME}/repo" \
  "${RYSA_HOME}/backups" \
  "${RYSA_HOME}/backups/releases" \
  "${RYSA_HOME}/backups/db" \
  "${RYSA_HOME}/logs"
ok "Estructura creada en ${RYSA_HOME}"

# === 7) Firewall UFW ==============================================
log "7) Configurando UFW..."
if ! ufw status | grep -q "Status: active"; then
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow 22/tcp comment "SSH" >/dev/null
  ufw allow 80/tcp comment "HTTP" >/dev/null
  ufw allow 443/tcp comment "HTTPS" >/dev/null
  # NO abrir 5432/8000/8080: solo accesibles vía rysa_nginx/proxy
  ufw --force enable >/dev/null
  ok "UFW activado (22, 80, 443)"
else
  log "UFW ya activo"
fi

# === 8) fail2ban (protección SSH) ==================================
log "8) Configurando fail2ban..."
if [[ -f /etc/fail2ban/jail.conf ]] && ! grep -q "rysa-ssh" /etc/fail2ban/jail.local 2>/dev/null; then
  cat > /etc/fail2ban/jail.local <<'EOF'
[rysa-ssh]
enabled  = true
port     = ssh
filter   = sshd
logpath  = /var/log/auth.log
maxretry = 5
bantime  = 3600
findtime = 600
EOF
  systemctl enable --now fail2ban >/dev/null
  ok "fail2ban activo (5 intentos, 1h bantime)"
fi

# === 9) Logrotate para backups RYSA ================================
log "9) Configurando logrotate..."
cat > /etc/logrotate.d/rysa <<'EOF
/var/log/rysa_setup.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    create 0640 root root
}

/opt/rysa/logs/*.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    create 0640 rysa rysa
    sharedscripts
    postrotate
        # reload nginx para liberar descriptores si el log era de un servicio
        [ -f /var/run/nginx.pid ] && kill -USR1 $(cat /var/run/nginx.pid) 2>/dev/null || true
    endscript
}

/var/log/nginx/rysa_*.log {
    daily
    rotate 30
    compress
    missingok
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 $(cat /var/run/nginx.pid) 2>/dev/null || true
    endscript
}
EOF
ok "logrotate configurado"

# === 10) Banner informativo ========================================
log "10) Banner SSH..."
cat > /etc/motd <<'EOF'
========================================================================
 RYSA ERP server.
 Managed by /opt/rysa/Rysa/scripts/*.sh
  - status:   sudo -u rysa /opt/rysa/Rysa/scripts/status.sh
  - deploy:   sudo -u rysa /opt/rysa/Rysa/scripts/deploy.sh
  - backup:   sudo -u rysa /opt/rysa/Rysa/scripts/backup.sh
  - health:   sudo /opt/rysa/Rysa/scripts/healthcheck.sh
========================================================================
EOF
ok "Banner configurado"

# === 11) Límites de recursos razonables ============================
log "11) Configurando límites del sistema..."
if ! grep -q "rysa soft nofile" /etc/security/limits.conf 2>/dev/null; then
  cat >> /etc/security/limits.conf <<'EOF'
# RYSA: limites para uploads grandes (ZIP legacy 300+ MB) y conexiones
rysa soft nofile 65536
rysa hard nofile 131072
rysa soft nproc 8192
rysa hard nproc 16384
EOF
fi
# sysctl: más espacio para conexiones TIME_WAIT
grep -q "net.ipv4.tcp_max_tw_buckets" /etc/sysctl.d/99-rysa.conf 2>/dev/null || \
  echo 'net.ipv4.tcp_max_tw_buckets = 200000' > /etc/sysctl.d/99-rysa.conf
sysctl -p /etc/sysctl.d/99-rysa.conf >/dev/null 2>&1 || true
ok "Límites configurados"

# === 12) Clonar el repositorio (si RYSA_REPO_URL está definida) =====
if [[ -n "${RYSA_REPO_URL:-}" ]]; then
  log "12) Clonando repositorio RYSA..."
  if [[ ! -d "${RYSA_HOME}/repo/.git" ]]; then
    sudo -u "$RYSA_USER" git clone "$RYSA_REPO_URL" "${RYSA_HOME}/repo"
    ok "Repositorio clonado en ${RYSA_HOME}/repo"
  else
    log "Repositorio ya existe en ${RYSA_HOME}/repo (saltando clone)"
  fi
else
  log "12) RYSA_REPO_URL no definida; salta el clone. Ejecuta: sudo -u rysa git clone <repo> ${RYSA_HOME}/repo"
fi

# === Resumen ========================================================
echo
ok "Bootstrap del VPS completado."
echo
echo "  Siguientes pasos (como root):"
echo "    sudo ${RYSA_HOME}/repo/scripts/setup_ssl.sh   # configura HTTPS con Let's Encrypt"
echo "    sudo -u ${RYSA_USER} ${RYSA_HOME}/repo/scripts/deploy.sh   # levanta el stack"
echo
echo "  Estado actual:"
echo "    docker:    $(docker --version 2>/dev/null || echo 'no instalado')"
echo "    nginx:     $(nginx -v 2>&1 | head -1)"
echo "    certbot:   $(certbot --version 2>/dev/null || echo 'no instalado')"
echo "    ufw:       $(ufw status | head -1)"
echo "    usuario:   ${RYSA_USER} (uid $(id -u $RYSA_USER))"
echo "    home:      ${RYSA_HOME}"
echo
echo "  Log: $RYSA_LOG"
