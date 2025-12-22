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

# Создаем временный файл с новой конфигурацией
cat > /tmp/nginx-new.conf << 'EOFCONF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name 38.180.206.183 _;
    
    root /var/www/lgardens.ru;
    index index.html;
    
    # Отключаем кеширование для HTML
    location ~* \.html$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
        try_files $uri $uri/ /index.html;
    }
    
    # Логи
    access_log /var/log/nginx/lgardens-ip.access.log;
    error_log /var/log/nginx/lgardens-ip.error.log;
    
    # JS файлы с версией - НЕ кэшируем
    location ~* ^/js/.*\.js(\?v=.*)?$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
        expires -1;
        access_log off;
    }
    
    # Основные файлы
    location / {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
        try_files $uri $uri/ /index.html;
    }
    
    # Статические файлы с кешированием (кроме JS с версией)
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }
    
    # Прокси для admin API (proxy-server)
    location /admin/api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        client_max_body_size 20M;
    }
EOFCONF

# Читаем оригинальный файл и заменяем блок location для статических файлов
python3 << 'PYTHON_SCRIPT'
import re
import sys

with open('/etc/nginx/sites-enabled/lgardens-ip', 'r') as f:
    content = f.read()

# Заменяем блок статических файлов
old_pattern = r'location ~\* \\\.\(jpg\|jpeg\|png\|gif\|ico\|css\|js\|svg\|woff\|woff2\|ttf\|eot\)\$ \{.*?access_log off;\s*\}'
new_block = '''    # JS файлы с версией - НЕ кэшируем
    location ~* ^/js/.*\\.js(\\?v=.*)?$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
        expires -1;
        access_log off;
    }
    
    # Статические файлы с кешированием (кроме JS с версией)
    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }'''

# Ищем блок location для статических файлов и заменяем
content = re.sub(
    r'    # Статические файлы с кешированием.*?access_log off;\s*\}',
    new_block,
    content,
    flags=re.DOTALL
)

# Если не нашли, добавляем перед блоком location /
if 'location ~* ^/js/' not in content:
    content = re.sub(
        r'(    # Основные файлы\s+location /)',
        '''    # JS файлы с версией - НЕ кэшируем
    location ~* ^/js/.*\\.js(\\?v=.*)?$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
        expires -1;
        access_log off;
    }
    
\\1''',
        content
    )

with open('/etc/nginx/sites-enabled/lgardens-ip', 'w') as f:
    f.write(content)

print("✅ Конфигурация обновлена")
PYTHON_SCRIPT

if [ $? -eq 0 ]; then
    echo "=== Проверка конфигурации ==="
    if nginx -t; then
        echo "✅ Конфигурация валидна"
        systemctl reload nginx
        echo "✅ Nginx перезагружен"
        echo ""
        echo "✅ Готово! JS файлы с версией (v=...) теперь не кэшируются"
    else
        echo "❌ Ошибка в конфигурации"
        exit 1
    fi
else
    echo "❌ Ошибка при обновлении конфигурации"
    exit 1
fi
