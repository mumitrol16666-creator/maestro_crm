#!/bin/bash
# Отключение кэширования HTML файлов в nginx

NGINX_CONFIG="/etc/nginx/sites-enabled/lgardens-ip"

if [ ! -f "$NGINX_CONFIG" ]; then
    echo "❌ Конфигурация не найдена: $NGINX_CONFIG"
    exit 1
fi

echo "=== Создаю бэкап ==="
cp "$NGINX_CONFIG" "${NGINX_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
echo "✅ Бэкап создан"

echo "=== Обновляю конфигурацию для HTML файлов ==="

# Проверяем, есть ли уже блок для HTML
if grep -q "location.*\.html" "$NGINX_CONFIG"; then
    echo "=== Обновляю существующий блок для HTML ==="
    # Заменяем блок для HTML файлов
    sed -i '/location.*\.html/,/}/c\
    location ~* \\.html$ {\
        add_header Cache-Control "no-cache, no-store, must-revalidate";\
        add_header Pragma "no-cache";\
        add_header Expires "0";\
        expires -1;\
        try_files $uri $uri/ /index.html;\
    }' "$NGINX_CONFIG"
else
    echo "=== Добавляю блок для HTML файлов ==="
    # Добавляем блок для HTML перед блоком статических файлов
    sed -i '/# Статические файлы с кешированием/i\
    # HTML файлы - НЕ кэшируем\
    location ~* \\.html$ {\
        add_header Cache-Control "no-cache, no-store, must-revalidate";\
        add_header Pragma "no-cache";\
        add_header Expires "0";\
        expires -1;\
        try_files $uri $uri/ /index.html;\
    }\
\
' "$NGINX_CONFIG"
fi

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
