# 🖥️ Пошаговая настройка сервера для автодеплоя

**Сервер:** 149.33.0.114  
**Логин:** root  
**Пароль:** D7V7vcfK2i

---

## Шаг 1: Подключиться к серверу

```bash
ssh root@149.33.0.114
# Введи пароль: D7V7vcfK2i
```

---

## Шаг 2: Установить Node.js

```bash
# Добавляем репозиторий Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -

# Устанавливаем Node.js
apt-get install -y nodejs

# Проверяем установку
node --version  # должно быть v18.x.x
npm --version   # должно быть 9.x.x или 10.x.x
```

---

## Шаг 3: Установить PM2 (Process Manager)

```bash
npm install -g pm2

# Проверяем
pm2 --version
```

---

## Шаг 4: Клонировать репозиторий

```bash
# Переходим в home директорию
cd /root

# Клонируем репозиторий (замени на свой URL если нужно)
git clone https://github.com/poirtyc/senseofdance.git sense-of-dance

# Переходим в папку
cd sense-of-dance
```

---

## Шаг 5: Создать .env файл для backend

```bash
cd /root/sense-of-dance/backend
nano .env
```

**Вставь в файл:**
```
MONGODB_URI=mongodb+srv://Dmitriy:Coolpopitd12@cluster0.ecwubgs.mongodb.net/SenseOfDance?retryWrites=true&w=majority
JWT_SECRET=super-secret-production-key-sense-of-dance-2025
PORT=5000
NODE_ENV=production
```

**Сохрани:** Ctrl+O, Enter, Ctrl+X

---

## Шаг 6: Установить зависимости

```bash
# В папке backend
cd /root/sense-of-dance/backend
npm install --production
```

---

## Шаг 7: Запустить приложение через PM2

```bash
# Backend
pm2 start /root/sense-of-dance/backend/src/server.js --name sense-of-dance-backend

# Frontend (если нужен статический сервер)
pm2 start "python3 -m http.server 3000" --name sense-of-dance-frontend --cwd /root/sense-of-dance/frontend

# Проверяем статус
pm2 status
```

---

## Шаг 8: Настроить автозапуск PM2 при перезагрузке

```bash
# Генерируем startup скрипт
pm2 startup

# Сохраняем текущий список процессов
pm2 save
```

---

## Шаг 9: Проверить что всё работает

```bash
# Смотрим логи
pm2 logs sense-of-dance-backend --lines 50

# Проверяем что backend отвечает
curl http://localhost:5000/api/students

# Если всё ОК, увидишь JSON ответ
```

---

## Шаг 10: Настроить Nginx (опционально, для домена)

Если хочешь чтобы сайт был доступен по домену (не по IP):

```bash
# Устанавливаем Nginx
apt-get install -y nginx

# Создаём конфигурацию
nano /etc/nginx/sites-available/sense-of-dance
```

**Вставь:**
```nginx
server {
    listen 80;
    server_name your-domain.com;  # замени на свой домен
    
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
```

```bash
# Активируем конфигурацию
ln -s /etc/nginx/sites-available/sense-of-dance /etc/nginx/sites-enabled/

# Проверяем конфигурацию
nginx -t

# Перезапускаем Nginx
systemctl restart nginx
```

---

## ✅ Готово! Теперь автодеплой будет работать!

**При каждом `git push`:**
1. GitHub Actions запустит тесты
2. Если тесты пройдут → подключится по SSH
3. Выполнит `git pull`
4. Установит зависимости
5. Перезапустит PM2
6. Приложение обновится автоматически!

---

## 🔍 Проверка автодеплоя

После настройки:
1. Сделай любое изменение в коде
2. `git push origin main`
3. Открой https://github.com/poirtyc/senseofdance/actions
4. Дождись зелёного чекмарка
5. Проверь что изменения появились на сервере!

---

## 📋 Полезные команды для сервера

```bash
# Статус приложения
pm2 status

# Логи backend
pm2 logs sense-of-dance-backend

# Перезапуск вручную
pm2 restart sense-of-dance-backend

# Остановить
pm2 stop sense-of-dance-backend

# Удалить из PM2
pm2 delete sense-of-dance-backend

# Список всех процессов
pm2 list

# Мониторинг в реальном времени
pm2 monit
```

---

## 🚨 Что делать если деплой не работает

1. **Проверь что сервер доступен:**
   ```bash
   ssh root@149.33.0.114
   ```

2. **Проверь что Node.js установлен:**
   ```bash
   node --version
   ```

3. **Проверь логи PM2:**
   ```bash
   pm2 logs
   ```

4. **Проверь что порты открыты:**
   ```bash
   netstat -tulpn | grep 5000
   netstat -tulpn | grep 3000
   ```

---

**Хочешь чтобы я помог настроить сервер прямо сейчас?** 

Могу дать команды которые нужно выполнить по очереди! 🚀

