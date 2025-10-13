#!/bin/bash

# 🚀 Автоматическая настройка сервера Sense of Dance
# Запускай от root!

set -e  # Останавливаемся при любой ошибке

echo ""
echo "🎭 =========================================="
echo "   Настройка сервера Sense of Dance"
echo "=========================================="
echo ""

# Проверка что запущено от root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Запусти от root: sudo bash server-setup.sh"
    exit 1
fi

# 1. Обновление системы
echo "📦 Обновляем систему..."
apt-get update -y
apt-get upgrade -y

# 2. Установка Node.js 18
echo "📦 Устанавливаем Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

echo "✅ Node.js версия: $(node --version)"
echo "✅ NPM версия: $(npm --version)"

# 3. Установка PM2
echo "📦 Устанавливаем PM2..."
npm install -g pm2

# 4. Установка Git (если нет)
if ! command -v git &> /dev/null; then
    echo "📦 Устанавливаем Git..."
    apt-get install -y git
fi

# 5. Клонирование репозитория
echo "📦 Клонируем репозиторий..."
cd /root
if [ -d "sense-of-dance" ]; then
    echo "⚠️  Папка sense-of-dance уже существует. Удаляем..."
    rm -rf sense-of-dance
fi

git clone https://github.com/poirtyc/senseofdance.git sense-of-dance
cd sense-of-dance

# 6. Создание .env файла
echo "📝 Создаём .env файл..."
cat > /root/sense-of-dance/backend/.env << 'EOF'
MONGODB_URI=mongodb+srv://Dmitriy:Coolpopitd12@cluster0.ecwubgs.mongodb.net/SenseOfDance?retryWrites=true&w=majority
JWT_SECRET=super-secret-production-key-sense-of-dance-2025
PORT=5000
NODE_ENV=production
EOF

echo "✅ .env файл создан"

# 7. Установка зависимостей backend
echo "📦 Устанавливаем зависимости backend..."
cd /root/sense-of-dance/backend
npm install --production

# 8. Остановка старых процессов PM2 (если есть)
echo "🛑 Останавливаем старые процессы..."
pm2 delete sense-of-dance-backend 2>/dev/null || true
pm2 delete sense-of-dance-frontend 2>/dev/null || true

# 9. Запуск backend через PM2
echo "🚀 Запускаем backend через PM2..."
pm2 start /root/sense-of-dance/backend/src/server.js --name sense-of-dance-backend

# 10. Установка Python3 (для frontend)
if ! command -v python3 &> /dev/null; then
    echo "📦 Устанавливаем Python3..."
    apt-get install -y python3
fi

# 11. Запуск frontend через PM2
echo "🚀 Запускаем frontend через PM2..."
cd /root/sense-of-dance/frontend
pm2 start python3 --name sense-of-dance-frontend -- -m http.server 3000

# 12. Настройка автозапуска PM2
echo "⚙️  Настраиваем автозапуск PM2..."
pm2 startup systemd -u root --hp /root
pm2 save

# 13. Установка и настройка Nginx (опционально)
if ! command -v nginx &> /dev/null; then
    echo "📦 Устанавливаем Nginx..."
    apt-get install -y nginx
    
    # Создаём конфигурацию Nginx
    cat > /etc/nginx/sites-available/sense-of-dance << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    
    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Backend API
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF
    
    # Удаляем дефолтную конфигурацию
    rm -f /etc/nginx/sites-enabled/default
    
    # Активируем нашу конфигурацию
    ln -sf /etc/nginx/sites-available/sense-of-dance /etc/nginx/sites-enabled/
    
    # Проверяем конфигурацию
    nginx -t
    
    # Перезапускаем Nginx
    systemctl restart nginx
    systemctl enable nginx
    
    echo "✅ Nginx настроен и запущен"
else
    echo "ℹ️  Nginx уже установлен, пропускаем настройку"
fi

# 14. Проверка статуса
echo ""
echo "✅ =========================================="
echo "   Установка завершена!"
echo "=========================================="
echo ""
echo "📊 Статус процессов:"
pm2 status

echo ""
echo "🌐 Доступ к приложению:"
echo "   Frontend: http://149.33.0.114"
echo "   Backend:  http://149.33.0.114/api"
echo ""
echo "📋 Полезные команды:"
echo "   pm2 status                    - Статус процессов"
echo "   pm2 logs sense-of-dance-backend - Логи backend"
echo "   pm2 restart sense-of-dance-backend - Перезапуск backend"
echo "   pm2 monit                     - Мониторинг в реальном времени"
echo ""
echo "🔄 Автодеплой настроен в GitHub Actions!"
echo "   При каждом git push → автоматическое обновление"
echo ""

