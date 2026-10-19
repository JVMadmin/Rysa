#!/usr/bin/env bash
# Programa el respaldo diario de RYSA (03:15 hora del servidor) y la
# rotación del log. Idempotente: se puede correr varias veces.
#
# Uso (root, en el VPS):  ./scripts/install_backup_cron.sh
#
# Después configura la copia externa en /etc/rysa/backup.env
# (BACKUP_RSYNC_TARGET o BACKUP_RCLONE_REMOTE; ver scripts/backup.sh).
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "ERROR: ejecuta como root" >&2; exit 1; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
RYSA_HOME="${RYSA_HOME:-/opt/rysa}"
chmod +x "$REPO/scripts/backup.sh"

mkdir -p /etc/rysa "$RYSA_HOME/logs"
if [[ ! -f /etc/rysa/backup.env ]]; then
  cat > /etc/rysa/backup.env <<'EOF'
# Configuración de scripts/backup.sh (se carga en cada ejecución).
BACKUP_RETAIN_DAYS=30
BACKUP_RETAIN_RELEASES=10
# Copia FUERA del VPS (descomenta una):
# BACKUP_RSYNC_TARGET=usuario@servidor-respaldo:/srv/respaldos/rysa
# BACKUP_RCLONE_REMOTE=b2:rysa-respaldos
EOF
  chmod 600 /etc/rysa/backup.env
fi

cat > /etc/cron.d/rysa-backup <<EOF
# Respaldo diario de Grupo RYSA (BD + uploads + código). Ver $REPO/scripts/backup.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RYSA_HOME=$RYSA_HOME
15 3 * * * root $REPO/scripts/backup.sh >/dev/null 2>&1
EOF
chmod 644 /etc/cron.d/rysa-backup

cat > /etc/logrotate.d/rysa-backup <<EOF
$RYSA_HOME/logs/backup.log {
    monthly
    rotate 12
    compress
    missingok
    notifempty
}
EOF

echo "Cron instalado: /etc/cron.d/rysa-backup (03:15 diario)"
echo "Config:         /etc/rysa/backup.env  <- configura aquí la copia externa"
echo "Prueba manual:  $REPO/scripts/backup.sh && tail -5 $RYSA_HOME/logs/backup.log"
