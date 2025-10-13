# 🔐 Настройка GitHub Secrets для CI/CD

## Шаг 1: Зайти в настройки репозитория

1. Открой свой репозиторий на GitHub
2. Нажми на **Settings** (вверху справа)
3. В левом меню выбери **Secrets and variables** → **Actions**
4. Нажми **New repository secret**

---

## Шаг 2: Добавить 3 секрета

### Secret 1: SERVER_HOST
```
Name: SERVER_HOST
Secret: 149.33.0.114
```

### Secret 2: SERVER_USER
```
Name: SERVER_USER
Secret: root
```

### Secret 3: SERVER_PASSWORD
```
Name: SERVER_PASSWORD
Secret: D7V7vcfK2i
```

---

## Шаг 3: Проверить настройки

После добавления у тебя должно быть 3 секрета:
- ✅ SERVER_HOST
- ✅ SERVER_USER
- ✅ SERVER_PASSWORD

---

## 🚀 Как это работает

### При каждом push в `main`:

1. **Запускаются тесты** (96 тестов, ~40 сек)
2. **Если тесты проходят** ✅ → деплой на сервер
3. **Если тесты НЕ проходят** ❌ → деплой НЕ происходит

### Деплой делает:
1. Останавливает приложение (PM2)
2. Скачивает последний код (git pull)
3. Устанавливает зависимости (npm install)
4. Запускает backend и frontend
5. Сохраняет конфигурацию PM2

---

## 📝 Что нужно на сервере

### 1. Git репозиторий
```bash
ssh root@149.33.0.114
cd /root
git clone https://github.com/your-username/sense-of-dance.git
cd sense-of-dance
```

### 2. Node.js и PM2
```bash
# Если ещё не установлены
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs
npm install -g pm2
```

### 3. .env файл на сервере
```bash
cd /root/sense-of-dance/backend
nano .env
```

Добавь:
```
MONGODB_URI=твой_connection_string
JWT_SECRET=твой_секретный_ключ
PORT=5000
```

### 4. Первый запуск
```bash
cd /root/sense-of-dance/backend
npm install
pm2 start src/server.js --name sense-of-dance-backend
pm2 startup
pm2 save
```

---

## 🎯 Готово!

Теперь при каждом `git push` в main:
1. ✅ Автоматически запустятся тесты
2. ✅ Если тесты проходят → код задеплоится на сервер
3. ✅ Приложение перезапустится автоматически

---

## 🔍 Просмотр логов деплоя

На GitHub:
- Заходи в **Actions**
- Выбирай последний workflow
- Смотри логи каждого шага

На сервере:
```bash
pm2 logs sense-of-dance-backend
pm2 status
```

