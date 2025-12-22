#!/bin/bash
# Скрипт для исправления кэширования JS файлов в nginx

echo "=== Поиск nginx конфигурации ==="
NGINX_CONFIG=$(grep -l 'location /js/' /etc/nginx/sites-enabled/* 2>/dev/null | head -1)

if [ -z "$NGINX_CONFIG" ]; then
    echo "⚠️  Конфигурация не найдена, проверяю все файлы..."
    NGINX_CONFIG=$(ls /etc/nginx/sites-enabled/* 2>/dev/null | head -1)
fi

if [ -z "$NGINX_CONFIG" ]; then
    echo "❌ Nginx конфигурация не найдена!"
    exit 1
fi

echo "Найден конфиг: $NGINX_CONFIG"

# Создаем бэкап
cp "$NGINX_CONFIG" "${NGINX_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
echo "✅ Бэкап создан"

# Проверяем, есть ли уже блок для /js/
if grep -q "location /js/" "$NGINX_CONFIG"; then
    echo "=== Обновляю существующий блок location /js/ ==="
    
    # Создаем временный файл с новой конфигурацией
    cat > /tmp/js-location-block.conf << 'EOFCONF'
    location /js/ {
        # Для файлов с версией в query string - НЕ кэшируем
        if ($args ~ "v=") {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Pragma "no-cache";
            add_header Expires "0";
            expires -1;
        }
        # Для остальных JS файлов - кэш на год
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header Vary "Accept-Encoding";
    }
EOFCONF

    # Удаляем старый блок и вставляем новый
    # Находим строки от "location /js/" до следующего "location" или "}"
    awk '
    /location \/js\// { 
        in_block=1
        skip=1
    }
    /^[[:space:]]*location[[:space:]]/ && in_block && !/location \/js\// {
        in_block=0
        skip=0
    }
    /^[[:space:]]*}[[:space:]]*$/ && in_block {
        in_block=0
        skip=0
        # Вставляем новый блок
        while ((getline line < "/tmp/js-location-block.conf") > 0) {
            print line
        }
        close("/tmp/js-location-block.conf")
        next
    }
    !skip { print }
    ' "$NGINX_CONFIG" > "${NGINX_CONFIG}.new"
    
    mv "${NGINX_CONFIG}.new" "$NGINX_CONFIG"
    echo "✅ Блок location /js/ обновлен"
else
    echo "=== Добавляю новый блок location /js/ ==="
    # Добавляем блок перед последней закрывающей скобкой server
    sed -i '/^[[:space:]]*}[[:space:]]*$/i\
    location /js/ {\
        if ($args ~ "v=") {\
            add_header Cache-Control "no-cache, no-store, must-revalidate";\
            add_header Pragma "no-cache";\
            add_header Expires "0";\
            expires -1;\
        }\
        expires 1y;\
        add_header Cache-Control "public, immutable";\
        add_header Vary "Accept-Encoding";\
    }
' "$NGINX_CONFIG"
    echo "✅ Блок location /js/ добавлен"
fi

# Проверяем конфигурацию
echo "=== Проверка конфигурации nginx ==="
if nginx -t; then
    echo "✅ Конфигурация валидна"
    systemctl reload nginx
    echo "✅ Nginx перезагружен"
else
    echo "❌ Ошибка в конфигурации, восстанавливаю бэкап..."
    # Восстанавливаем из последнего бэкапа
    BACKUP=$(ls -t "${NGINX_CONFIG}".backup.* 2>/dev/null | head -1)
    if [ -n "$BACKUP" ]; then
        cp "$BACKUP" "$NGINX_CONFIG"
        echo "✅ Бэкап восстановлен"
    fi
    exit 1
fi

echo ""
echo "✅ Готово! JS файлы с версией (v=...) теперь не кэшируются"
