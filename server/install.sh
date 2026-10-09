#!/usr/bin/env bash
# Установка (и обновление) сервера Arena of Defense на чистый VPS с Ubuntu 22.04/24.04.
# Запуск одной командой от root:
#   curl -fsSL https://raw.githubusercontent.com/tuko474/tri-linii/main/server/install.sh | bash
# Повторный запуск обновляет сервер до свежей версии из GitHub (база игроков сохраняется).
set -euo pipefail

REPO="https://github.com/tuko474/tri-linii.git"
APP=/opt/arena
DATA=/var/lib/arena
PORT=8080

say() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Запусти от root (или через sudo)"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

say "Пакеты системы"
# Caddy уже стоит — его внешний репозиторий не нужен (cloudsmith бывает недоступен: 402/403 из РФ)
if command -v caddy >/dev/null; then rm -f /etc/apt/sources.list.d/caddy-stable.list; fi
apt-get update -y -q || echo "apt update с ошибками — продолжаю"
apt-get install -y -q curl git ca-certificates debian-keyring debian-archive-keyring apt-transport-https gnupg

say "Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  if curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource.sh; then
    bash /tmp/nodesource.sh && apt-get install -y -q nodejs
  else
    # запасной путь — архив с nodejs.org
    V=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ | grep -o 'node-v22[0-9.]*-linux-x64.tar.xz' | head -1)
    curl -fsSL "https://nodejs.org/dist/latest-v22.x/$V" | tar -xJ -C /usr/local --strip-components=1
  fi
fi
node -v

say "Caddy (https-сертификат ставится сам)"
if ! command -v caddy >/dev/null; then
  if curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null \
     && curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list; then
    if ! { apt-get update -y -q && apt-get install -y -q caddy; }; then
      rm -f /etc/apt/sources.list.d/caddy-stable.list
      apt-get update -y -q || true
      apt-get install -y -q caddy
    fi
  else
    apt-get install -y -q caddy
  fi
fi
caddy version

say "Код сервера"
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch -q --depth 1 origin main && git -C "$APP" reset -q --hard origin/main
else
  rm -rf "$APP"
  git clone -q --depth 1 "$REPO" "$APP"
fi
mkdir -p "$DATA"
id arena >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin arena
chown -R arena:arena "$DATA"

say "Служба arena (запускается сама и перезапускается при сбоях)"
cat > /etc/systemd/system/arena.service <<EOF
[Unit]
Description=Arena of Defense server
After=network.target

[Service]
User=arena
Environment=PORT=$PORT
Environment=DB=$DATA/arena.db
ExecStart=$(command -v node) --no-warnings $APP/server/server.mjs
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q arena
systemctl restart arena

say "Резервные копии базы (каждую ночь в 04:10, хранятся 14 дней в $DATA/backups)"
cat > /etc/cron.d/arena-backup <<CRON
10 4 * * * arena DB=$DATA/arena.db $(command -v node) --no-warnings $APP/server/admin.mjs backup $DATA/backups 14 >> $DATA/backup.log 2>&1
CRON
chmod 644 /etc/cron.d/arena-backup
runuser -u arena -- env DB=$DATA/arena.db $(command -v node) --no-warnings $APP/server/admin.mjs backup $DATA/backups 14 || echo "Первая копия не получилась — попробуй: node $APP/server/admin.mjs backup"

say "Адрес сервера"
IP=$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
HOST="${DOMAIN:-$(echo "$IP" | tr . -).sslip.io}"
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
  reverse_proxy 127.0.0.1:$PORT
}
EOF
if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi
systemctl enable -q caddy
systemctl restart caddy

say "Проверка"
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "https://$HOST/health" >/dev/null 2>&1; then break; fi
  sleep 3
done
curl -fsS --max-time 5 "https://$HOST/health" && echo
echo
echo "============================================================"
echo " Готово! Адрес сервера для игры:"
echo
echo "     wss://$HOST"
echo
echo " Адрес уже вписан в игру. Политика конфиденциальности: https://$HOST/privacy"
echo " Проверка в браузере: https://$HOST/health"
echo "============================================================"
