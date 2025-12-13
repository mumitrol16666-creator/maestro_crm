# 🚀 ДЕПЛОЙ ИСПРАВЛЕНИЙ ДЛЯ ОШИБОК 401

## Текущая ситуация
- ✅ Сервер работает (проверено удаленно)
- ✅ Middleware аутентификации работает
- ⚠️ Новые изменения еще не задеплоены на сервер

## Что было исправлено

### 1. Backend (`backend/src/middleware/auth.js`)
- ✅ Добавлена проверка наличия `JWT_SECRET` перед использованием
- ✅ Улучшено логирование ошибок аутентификации
- ✅ Детальные сообщения об ошибках (JWT, истекший токен, пользователь не найден)

### 2. Backend (`backend/src/server.js`)
- ✅ Добавлен диагностический endpoint `/api/health/diagnostic`
- ✅ Проверка конфигурации без аутентификации

### 3. Frontend (`frontend/js/modules/core/api.js`)
- ✅ Улучшена обработка ошибок 401
- ✅ Детальные сообщения об ошибках в консоли
- ✅ Специальная обработка ошибок конфигурации сервера

### 4. Frontend (`frontend/js/modules/dashboard/dashboard.js`)
- ✅ Улучшена диагностика ошибок загрузки статистики

## 📦 ДЕПЛОЙ НА СЕРВЕР

### Вариант 1: Через SSH (рекомендуется)

```bash
# 1. Подключиться к серверу
ssh root@149.33.0.114
# Пароль: D7V7vcfK2i

# 2. Перейти в директорию проекта
cd /root/sense-of-dance

# 3. Получить последние изменения (если используете git)
git pull origin main

# 4. Перейти в backend
cd backend

# 5. Установить зависимости (если нужно)
npm install --production

# 6. Проверить .env файл
cat .env | grep JWT_SECRET
# Должно показать: JWT_SECRET=super-secret-production-key-sense-of-dance-2025

# 7. Если JWT_SECRET отсутствует, создать/обновить .env
cat > .env << 'EOF'
MONGODB_URI=mongodb+srv://Dmitriy:Coolpopitd12@cluster0.ecwubgs.mongodb.net/SenseOfDance?retryWrites=true&w=majority
JWT_SECRET=super-secret-production-key-sense-of-dance-2025
PORT=5000
NODE_ENV=production
EOF

# 8. Перезапустить сервер через PM2
pm2 restart sense-of-dance-backend

# 9. Проверить логи
pm2 logs sense-of-dance-backend --lines 30

# 10. Проверить диагностику
curl http://localhost:5000/api/health/diagnostic
```

### Вариант 2: Через существующий скрипт деплоя

Если у вас есть скрипты деплоя (например, `deploy-backend.exp`), используйте их.

## ✅ ПРОВЕРКА ПОСЛЕ ДЕПЛОЯ

### 1. Проверить диагностический endpoint
```bash
curl http://149.33.0.114:5000/api/health/diagnostic
```

Ожидаемый результат:
```json
{
  "status": "ok",
  "environment": {
    "JWT_SECRET": "SET (45 chars)",
    "MONGODB_URI": "SET"
  }
}
```

### 2. Проверить логи PM2
```bash
pm2 logs sense-of-dance-backend --lines 50
```

Ищите:
- ✅ Нет ошибок `JWT_SECRET не установлен`
- ✅ Нет ошибок `MongoDB connection error`
- ✅ Сервер запустился успешно

### 3. Проверить в браузере
1. Откройте `http://149.33.0.114`
2. Откройте консоль браузера (F12)
3. Войдите в систему
4. Проверьте, что нет ошибок 401

## 🔧 ЕСЛИ ПРОБЛЕМА СОХРАНЯЕТСЯ

### Шаг 1: Проверить .env файл
```bash
cd /root/sense-of-dance/backend
cat .env
```

Убедитесь, что есть строка:
```
JWT_SECRET=super-secret-production-key-sense-of-dance-2025
```

### Шаг 2: Проверить, что PM2 видит переменные
```bash
pm2 env sense-of-dance-backend | grep JWT_SECRET
```

Если пусто, используйте ecosystem.config.js:
```bash
cd /root/sense-of-dance/backend
pm2 delete sense-of-dance-backend
pm2 start ecosystem.config.js
pm2 save
```

### Шаг 3: Проверить MongoDB
```bash
cd /root/sense-of-dance/backend
node -e "require('dotenv').config(); const mongoose = require('mongoose'); mongoose.connect(process.env.MONGODB_URI).then(() => { console.log('✅ MongoDB OK'); process.exit(0); }).catch(e => { console.error('❌ ERROR:', e.message); process.exit(1); })"
```

### Шаг 4: Полная перезагрузка
```bash
pm2 delete sense-of-dance-backend
cd /root/sense-of-dance/backend
pm2 start ecosystem.config.js
pm2 save
pm2 logs sense-of-dance-backend
```

## 📝 ФАЙЛЫ, КОТОРЫЕ БЫЛИ ИЗМЕНЕНЫ

1. `backend/src/middleware/auth.js` - улучшено логирование и проверка JWT_SECRET
2. `backend/src/server.js` - добавлен диагностический endpoint
3. `frontend/js/modules/core/api.js` - улучшена обработка ошибок
4. `frontend/js/modules/dashboard/dashboard.js` - улучшена диагностика
5. `backend/check-api-status.js` - новый скрипт для диагностики
6. `check-server-remote.js` - новый скрипт для удаленной проверки

## 🎯 ОЖИДАЕМЫЙ РЕЗУЛЬТАТ

После деплоя:
- ✅ Все API запросы работают (нет 401 ошибок)
- ✅ Диагностический endpoint доступен
- ✅ Детальные логи ошибок в консоли браузера
- ✅ Детальные логи ошибок в PM2

## 💡 ВАЖНО

**После изменения .env файла ОБЯЗАТЕЛЬНО перезапустите сервер!**

Простое изменение файла не обновит переменные окружения в запущенном процессе Node.js.

