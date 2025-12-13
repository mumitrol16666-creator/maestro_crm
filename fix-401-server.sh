#!/bin/bash

# Скрипт для исправления ошибок 401 на сервере

set -e

echo "=== Исправление ошибок 401 ==="
echo ""

cd /root/sense-of-dance/backend

echo "=== Проверка .env файла ==="
if [ ! -f .env ]; then
    echo "Файл .env не существует, создаю..."
    cat > .env << 'EOF'
MONGODB_URI=mongodb+srv://Dmitriy:Coolpopitd12@cluster0.ecwubgs.mongodb.net/SenseOfDance?retryWrites=true&w=majority
JWT_SECRET=super-secret-production-key-sense-of-dance-2025
PORT=5000
NODE_ENV=production
EOF
    chmod 600 .env
    echo "Файл .env создан"
else
    echo "Файл .env существует"
    
    # Проверяем наличие JWT_SECRET
    if ! grep -q "^JWT_SECRET=" .env; then
        echo "JWT_SECRET отсутствует, добавляю..."
        echo "JWT_SECRET=super-secret-production-key-sense-of-dance-2025" >> .env
        echo "JWT_SECRET добавлен"
    else
        echo "JWT_SECRET уже присутствует"
        # Обновляем JWT_SECRET на правильное значение
        sed -i 's/^JWT_SECRET=.*/JWT_SECRET=super-secret-production-key-sense-of-dance-2025/' .env
        echo "JWT_SECRET обновлен"
    fi
fi

echo ""
echo "=== Проверка JWT_SECRET ==="
grep JWT_SECRET .env || echo "ОШИБКА: JWT_SECRET не найден!"

echo ""
echo "=== Содержимое .env (первые 4 строки) ==="
head -4 .env

echo ""
echo "=== Git pull ==="
cd /root/sense-of-dance
git pull origin main 2>&1 | tail -5 || echo "Git pull завершился с ошибкой или не используется git"

echo ""
echo "=== npm install ==="
cd backend
npm install --production 2>&1 | tail -3

echo ""
echo "=== Перезапуск PM2 ==="
pm2 restart sense-of-dance-backend

echo ""
echo "=== Ожидание запуска сервера (5 секунд) ==="
sleep 5

echo ""
echo "=== Статус PM2 ==="
pm2 status

echo ""
echo "=== Логи сервера (последние 30 строк) ==="
pm2 logs sense-of-dance-backend --lines 30 --nostream

echo ""
echo "=== Проверка health endpoint ==="
curl -s http://localhost:5000/api/health | head -5 || echo "Health endpoint не отвечает"

echo ""
echo "=== Проверка diagnostic endpoint ==="
curl -s http://localhost:5000/api/health/diagnostic 2>&1 | head -20 || echo "Diagnostic endpoint не отвечает (возможно еще не задеплоен)"

echo ""
echo "=== Проверка завершена ==="

