#!/bin/bash
# Проверка здоровья Maestro CRM backend (PM2)
set -e

APP_NAME="maestro-crm-backend"
BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"

check_api() {
  curl -sf "http://localhost:${PORT:-5000}/api/health" > /dev/null 2>&1
}

restart_app() {
  echo "↻ Перезапуск $APP_NAME..."
  cd "$BACKEND_DIR"
  pm2 restart "$APP_NAME" || pm2 start ecosystem.config.js
}

if ! check_api; then
  echo "⚠️  API не отвечает"
  restart_app
  sleep 3
  if check_api; then
    echo "✅ API восстановлен"
  else
    echo "❌ API всё ещё недоступен — проверьте логи: pm2 logs $APP_NAME"
    exit 1
  fi
else
  echo "✅ API OK"
fi

PM2_STATUS=$(pm2 jlist 2>/dev/null | grep -A 5 "$APP_NAME" | grep '"status":' | head -1 | awk '{print $2}' | tr -d ',"' || echo "unknown")
if [ "$PM2_STATUS" != "online" ]; then
  echo "⚠️  PM2 статус: $PM2_STATUS"
  restart_app
fi
