# 🚨 БЫСТРОЕ ИСПРАВЛЕНИЕ ОШИБОК 401

## Проблема
Все API запросы возвращают 401 (Unauthorized).

## ⚡ БЫСТРОЕ РЕШЕНИЕ (5 минут)

### Шаг 1: Подключиться к серверу
```bash
ssh root@149.33.0.114
# Пароль: D7V7vcfK2i
```

### Шаг 2: Проверить .env файл
```bash
cd /root/sense-of-dance/backend
cat .env
```

**Если файл отсутствует или JWT_SECRET пустой:**

```bash
# Создать/обновить .env файл
cat > .env << 'EOF'
MONGODB_URI=mongodb+srv://Dmitriy:Coolpopitd12@cluster0.ecwubgs.mongodb.net/SenseOfDance?retryWrites=true&w=majority
JWT_SECRET=super-secret-production-key-sense-of-dance-2025
PORT=5000
NODE_ENV=production
EOF
```

### Шаг 3: Проверить, что PM2 видит переменные
```bash
pm2 env sense-of-dance-backend | grep JWT_SECRET
```

Если пусто, значит PM2 не загружает .env. Используйте ecosystem.config.js:

```bash
cd /root/sense-of-dance/backend
pm2 delete sense-of-dance-backend
pm2 start ecosystem.config.js
```

### Шаг 4: Перезапустить сервер
```bash
pm2 restart sense-of-dance-backend
```

### Шаг 5: Проверить логи
```bash
pm2 logs sense-of-dance-backend --lines 50
```

Ищите:
- ✅ `JWT_SECRET установлен` - хорошо
- ❌ `JWT_SECRET не установлен` - проблема
- ❌ `MongoDB connection error` - проблема с БД

### Шаг 6: Проверить через API
```bash
curl http://localhost:5000/api/health/diagnostic
```

Должно показать:
```json
{
  "status": "ok",
  "environment": {
    "JWT_SECRET": "SET (45 chars)"
  }
}
```

## 🔍 ДИАГНОСТИКА С ЛОКАЛЬНОГО КОМПЬЮТЕРА

Запустите скрипт проверки:
```bash
node check-server-remote.js http://149.33.0.114:5000
```

## 📋 ЧЕКЛИСТ ПРОВЕРКИ

- [ ] .env файл существует в `/root/sense-of-dance/backend/.env`
- [ ] JWT_SECRET установлен в .env
- [ ] PM2 видит переменные окружения
- [ ] Сервер перезапущен после изменений
- [ ] Логи не показывают ошибок JWT_SECRET
- [ ] `/api/health/diagnostic` показывает JWT_SECRET установлен

## ⚠️ ВАЖНО

После изменения .env файла **ОБЯЗАТЕЛЬНО** перезапустите сервер:
```bash
pm2 restart sense-of-dance-backend
```

Простое изменение файла не обновит переменные окружения в запущенном процессе!

## 🔄 ЕСЛИ ПРОБЛЕМА СОХРАНЯЕТСЯ

1. **Проверьте, что изменения задеплоены:**
   ```bash
   cd /root/sense-of-dance/backend
   git pull  # если используете git
   ```

2. **Убедитесь, что используется правильный .env:**
   ```bash
   pm2 show sense-of-dance-backend | grep env_file
   ```

3. **Проверьте MongoDB подключение:**
   ```bash
   node -e "require('dotenv').config(); const mongoose = require('mongoose'); mongoose.connect(process.env.MONGODB_URI).then(() => { console.log('✅ MongoDB OK'); process.exit(0); }).catch(e => { console.error('❌ MongoDB ERROR:', e.message); process.exit(1); })"
   ```

4. **Полная перезагрузка PM2:**
   ```bash
   pm2 delete sense-of-dance-backend
   cd /root/sense-of-dance/backend
   pm2 start ecosystem.config.js
   pm2 save
   ```

## 💡 ПОЧЕМУ ЭТО ПРОИСХОДИТ?

401 ошибки возникают когда:
1. **JWT_SECRET отсутствует** - токены не могут быть проверены
2. **JWT_SECRET изменился** - старые токены стали недействительными
3. **MongoDB недоступен** - пользователи не могут быть найдены
4. **Сервер перезапустился без .env** - переменные не загружены

## ✅ ПОСЛЕ ИСПРАВЛЕНИЯ

1. Откройте браузер
2. Очистите localStorage (F12 → Application → Local Storage → Clear)
3. Войдите заново
4. Проверьте консоль браузера - не должно быть 401 ошибок

