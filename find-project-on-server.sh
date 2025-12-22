#!/bin/bash
# Скрипт для поиска проекта на сервере

echo "=== Проверка nginx конфигурации ==="
grep -r "root" /etc/nginx/sites-enabled/ 2>/dev/null | grep -E "(root|frontend)"

echo ""
echo "=== Поиск frontend директории ==="
find /root /home /var/www -type d -name "frontend" 2>/dev/null | head -5

echo ""
echo "=== Поиск cashbox.js ==="
find /root /home /var/www -name "cashbox.js" -type f 2>/dev/null | head -3

echo ""
echo "=== Проверка процессов PM2 ==="
pm2 list

echo ""
echo "=== Проверка активных процессов Node ==="
ps aux | grep node | grep -v grep

echo ""
echo "=== Проверка директорий в /root ==="
ls -la /root/ | grep -E "(sense|dance|frontend)"
