# 🔧 Исправление ошибок 401 в API

## Проблема
Все API запросы возвращают 401 (Unauthorized):
- `/api/permissions` → 401
- `/api/admin/stats` → 401
- `/api/bookings` → 401
- `/api/classes/pending-attendance/count` → 401

## Причины
1. **JWT_SECRET отсутствует или изменился** - самая вероятная причина
2. **MongoDB недоступен** - не может найти пользователей
3. **Переменные окружения не загружены** - сервер перезапустился без .env

## Решение

### Шаг 1: Подключиться к серверу
```bash
ssh root@149.33.0.114
# Пароль: D7V7vcfK2i
```

### Шаг 2: Проверить диагностику через API
```bash
curl http://149.33.0.114:5000/api/health/diagnostic
```

Или откройте в браузере: `http://149.33.0.114:5000/api/health/diagnostic`

### Шаг 3: Запустить диагностический скрипт
```bash
cd /root/sense-of-dance/backend
node check-api-status.js
```

### Шаг 4: Проверить .env файл
```bash
cd /root/sense-of-dance/backend
cat .env
```

Убедитесь, что файл содержит:
```
JWT_SECRET=super-secret-production-key-sense-of-dance-2025
MONGODB_URI=mongodb+srv://Dmitriy:Coolpopitd12@cluster0.ecwubgs.mongodb.net/SenseOfDance?retryWrites=true&w=majority
PORT=5000
NODE_ENV=production
```

### Шаг 5: Если .env файл отсутствует или поврежден
```bash
cd /root/sense-of-dance/backend
nano .env
```

Вставьте:
```
MONGODB_URI=mongodb+srv://Dmitriy:Coolpopitd12@cluster0.ecwubgs.mongodb.net/SenseOfDance?retryWrites=true&w=majority
JWT_SECRET=super-secret-production-key-sense-of-dance-2025
PORT=5000
NODE_ENV=production
```

Сохраните: `Ctrl+O`, `Enter`, `Ctrl+X`

### Шаг 6: Проверить логи PM2
```bash
pm2 logs sense-of-dance-backend --lines 50
```

Ищите ошибки:
- `JWT_SECRET не установлен`
- `MongoDB connection error`
- `Auth error`

### Шаг 7: Перезапустить сервер
```bash
pm2 restart sense-of-dance-backend
pm2 logs sense-of-dance-backend --lines 20
```

### Шаг 8: Проверить статус
```bash
pm2 status
pm2 info sense-of-dance-backend
```

## Быстрое исправление (если JWT_SECRET отсутствует)

```bash
# 1. Проверить наличие .env
cd /root/sense-of-dance/backend
ls -la .env

# 2. Если файла нет, создать
cat > .env << EOF
MONGODB_URI=mongodb+srv://Dmitriy:Coolpopitd12@cluster0.ecwubgs.mongodb.net/SenseOfDance?retryWrites=true&w=majority
JWT_SECRET=super-secret-production-key-sense-of-dance-2025
PORT=5000
NODE_ENV=production
EOF

# 3. Перезапустить
pm2 restart sense-of-dance-backend

# 4. Проверить логи
pm2 logs sense-of-dance-backend --lines 30
```

## Проверка после исправления

1. Откройте браузер: `http://149.33.0.114`
2. Войдите в систему
3. Проверьте консоль браузера (F12) - не должно быть 401 ошибок
4. Проверьте Network tab - все запросы должны возвращать 200

## Дополнительная информация

### Улучшения в коде
- ✅ Добавлено детальное логирование ошибок аутентификации
- ✅ Проверка наличия JWT_SECRET перед использованием
- ✅ Диагностический endpoint `/api/health/diagnostic`
- ✅ Скрипт `check-api-status.js` для диагностики

### Если проблема сохраняется

1. **Проверьте MongoDB подключение:**
   ```bash
   node -e "require('dotenv').config(); const mongoose = require('mongoose'); mongoose.connect(process.env.MONGODB_URI).then(() => console.log('OK')).catch(e => console.error('ERROR:', e.message))"
   ```

2. **Проверьте, что PM2 загружает .env:**
   ```bash
   pm2 env sense-of-dance-backend | grep JWT_SECRET
   ```

3. **Если PM2 не видит переменные, используйте ecosystem.config.js:**
   ```bash
   cd /root/sense-of-dance/backend
   pm2 delete sense-of-dance-backend
   pm2 start ecosystem.config.js
   ```

