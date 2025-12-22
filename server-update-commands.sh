#!/bin/bash
# Скрипт для обновления файлов на сервере

# Найти директорию проекта
PROJECT_DIR=$(find /root /home /var/www -name "sense-of-dance" -type d 2>/dev/null | head -1)

if [ -z "$PROJECT_DIR" ]; then
    echo "Проект не найден. Клонируем..."
    cd /root
    git clone https://github.com/poirtyc/senseofdance.git sense-of-dance
    PROJECT_DIR="/root/sense-of-dance"
fi

echo "Найден проект в: $PROJECT_DIR"
cd "$PROJECT_DIR"

# Обновить из git
echo "Обновляю из git..."
git pull origin main

# Обновить nginx конфигурацию
echo "Обновляю nginx конфигурацию..."
if [ -f "nginx-optimized.conf" ]; then
    sudo cp nginx-optimized.conf /etc/nginx/sites-available/default
    sudo nginx -t && sudo systemctl reload nginx
    echo "Nginx перезагружен"
fi

echo "Готово!"
