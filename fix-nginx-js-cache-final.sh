#!/bin/bash
# Исправление кэширования JS файлов в nginx

NGINX_CONFIG="/etc/nginx/sites-enabled/lgardens-ip"

if [ ! -f "$NGINX_CONFIG" ]; then
    echo "❌ Конфигурация не найдена: $NGINX_CONFIG"
    exit 1
fi

echo "=== Создаю бэкап ==="
cp "$NGINX_CONFIG" "${NGINX_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
echo "✅ Бэкап создан"

echo "=== Обновляю конфигурацию ==="

# Удаляем бэкапы из sites-enabled (они вызывают ошибку duplicate server)
rm -f /etc/nginx/sites-enabled/*.backup.*

# Удаляем js из блока статических файлов
sed -i 's|location ~\* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$|location ~* \\.(jpg|jpeg|png|gif|ico|css|svg|woff|woff2|ttf|eot)$|' "$NGINX_CONFIG"

# Добавляем специальный блок для JS файлов с версией ПЕРЕД блоком статических файлов
sed -i '/# Статические файлы с кешированием/i\
    # JS файлы с версией в query string - НЕ кэшируем (должен быть ПЕРВЫМ)\
    location ~* ^/js/.*\\.js\\?v=.*$ {\
        add_header Cache-Control "no-cache, no-store, must-revalidate";\
        add_header Pragma "no-cache";\
        add_header Expires "0";\
        expires -1;\
        access_log off;\
    }\
\
' "$NGINX_CONFIG"

echo "✅ Конфигурация обновлена"
echo "=== Проверка синтаксиса ==="
nginx -t

if [ $? -eq 0 ]; then
    echo "✅ Синтаксис правильный, перезагружаю nginx..."
    systemctl reload nginx
    echo "✅ Nginx перезагружен"
else
    echo "❌ Ошибка в конфигурации!"
    exit 1
fi
