#!/usr/bin/env bash
# Smoke tests post-deploy de RYSA.
#
# No destructivo: solo hace login + GETs a endpoints principales.
# Falla rápido con código 1 si algo crítico se rompe.
#
# Uso:  /opt/rysa/repo/scripts/test_all.sh

set -uo pipefail

RYSA_HOME="${RYSA_HOME:-/opt/rysa}"
RYSA_REPO="${RYSA_HOME}/repo"
BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
DOMAIN="${DOMAIN:-}"
PUBLIC_URL="${PUBLIC_URL:-${DOMAIN:+https://$DOMAIN}}"

PASS=0; FAIL=0
ok()   { printf "  \033[92m✓\033[0m %s\n" "$*"; PASS=$((PASS+1)); }
fail() { printf "  \033[91m✗\033[0m %s\n" "$*"; FAIL=$((FAIL+1)); }
hdr()  { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }

# === Cargar credenciales del .env.docker =======================
ENV_FILE="$RYSA_REPO/.env.docker"
[[ -f "$ENV_FILE" ]] || { echo "ERROR: $ENV_FILE no existe"; exit 2; }
# shellcheck disable=SC1090
. "$ENV_FILE"
[[ -n "${ADMIN_EMAIL:-}" && -n "${ADMIN_PASSWORD:-}" ]] || {
  echo "ERROR: ADMIN_EMAIL/ADMIN_PASSWORD no definidos en .env.docker"
  exit 2
}

# === HTTPS público (si hay dominio) =============================
hdr "HTTPS público"
if [[ -n "$PUBLIC_URL" ]]; then
  if curl -fsS --max-time 10 "$PUBLIC_URL/health" >/dev/null 2>&1; then
    ok "$PUBLIC_URL/health responde"
  else
    fail "$PUBLIC_URL/health no responde"
  fi
  # Verificar redirección HTTP -> HTTPS
  REDIR=$(curl -sI --max-time 5 "http://${DOMAIN}/" 2>/dev/null | awk '/^[Ll]ocation:/{print $2}' | tr -d '\r' | head -1)
  [[ "$REDIR" == https://* ]] && ok "HTTP→HTTPS redirige" || fail "no redirige a HTTPS"
else
  echo "  (sin DOMAIN, salta)"
fi

# === Login ====================================================
hdr "Login"
LOGIN=$(curl -sS --max-time 10 -H "Content-Type: application/json" \
        -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
        "$BACKEND_URL/api/auth/login" 2>/dev/null)
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.loads(sys.stdin.read() or '{}'); print(d.get('token',''))" 2>/dev/null || echo "")
[[ -n "$TOKEN" ]] && ok "token recibido" || fail "no se pudo hacer login (revisa credenciales)"

if [[ -n "$TOKEN" ]]; then
  AUTH=(-H "Authorization: Bearer $TOKEN")

  # === Endpoints críticos ====================================
  hdr "API principal"
  for ep in products clients sales cxc; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "${AUTH[@]}" "$BACKEND_URL/api/$ep")
    [[ "$code" == "200" ]] && ok "GET /api/$ep -> 200" || fail "GET /api/$ep -> $code"
  done

  # === Permisos / roles ======================================
  hdr "Permisos"
  ME=$(curl -s --max-time 5 "${AUTH[@]}" "$BACKEND_URL/api/auth/me" 2>/dev/null)
  ROLE=$(echo "$ME" | python3 -c "import sys,json; d=json.loads(sys.stdin.read() or '{}'); print(d.get('role',''))" 2>/dev/null || echo "")
  [[ -n "$ROLE" ]] && ok "auth/me devuelve role=$ROLE"

  # === Negación de permisos ==================================
  # Un endpoint admin-only debe rechazar a un usuario sin permiso.
  # Como admin_propietario tiene *, este test es informativo.
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${AUTH[@]}" "$BACKEND_URL/api/users")
  ok "GET /api/users (admin) -> $code"

  # === Health de BD desde el backend =========================
  hdr "BD"
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BACKEND_URL/api/health/db")
  [[ "$code" == "200" ]] && ok "/api/health/db -> 200" || fail "/api/health/db -> $code"
fi

# === Resumen ==================================================
echo
printf "\033[1;36m══════════════════════════════════════════════\033[0m\n"
printf " PASS=%d  FAIL=%d\n" "$PASS" "$FAIL"
printf "\033[1;36m══════════════════════════════════════════════\033[0m\n"
[[ $FAIL -gt 0 ]] && exit 1
exit 0
