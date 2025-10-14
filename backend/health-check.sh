#!/bin/bash

# Health check script для мониторинга сервера
# Запускается через cron каждые 5 минут

LOG_FILE="/root/.pm2/health-check.log"
MAX_RESPONSE_TIME=10

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting health check..." >> "$LOG_FILE"

# Проверка HTTP ответа
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time $MAX_RESPONSE_TIME http://localhost:5000/api/health || echo "000")

if [ "$HTTP_CODE" != "200" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Server returned HTTP $HTTP_CODE. Restarting..." >> "$LOG_FILE"
    cd /root/sense-of-dance/backend
    pm2 restart sense-of-dance-backend
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Server restarted" >> "$LOG_FILE"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] OK: Server is healthy (HTTP $HTTP_CODE)" >> "$LOG_FILE"
fi

# Проверка использования памяти
MEMORY_USAGE=$(pm2 jlist | grep -A 20 sense-of-dance-backend | grep '"memory":' | awk '{print $2}' | tr -d ',' || echo "0")
MEMORY_LIMIT=419430400  # 400MB в байтах

if [ "$MEMORY_USAGE" -gt "$MEMORY_LIMIT" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: High memory usage: $MEMORY_USAGE bytes. Restarting..." >> "$LOG_FILE"
    cd /root/sense-of-dance/backend
    pm2 restart sense-of-dance-backend
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Server restarted due to high memory" >> "$LOG_FILE"
fi

# Проверка статуса PM2
PM2_STATUS=$(pm2 jlist | grep -A 5 sense-of-dance-backend | grep '"status":' | awk '{print $2}' | tr -d ',"')

if [ "$PM2_STATUS" != "online" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: PM2 status is $PM2_STATUS. Restarting..." >> "$LOG_FILE"
    cd /root/sense-of-dance/backend
    pm2 restart sense-of-dance-backend
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Server restarted" >> "$LOG_FILE"
fi

# Очистка логов старше 7 дней
find /root/.pm2/logs -name "*.log" -mtime +7 -delete 2>/dev/null

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Health check completed" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"

