# 🗄️ НАСТРОЙКА MONGODB ATLAS

## 🎯 ЧТО ЭТО?

MongoDB Atlas - это **бесплатная** облачная база данных.

**Преимущества:**
- ✅ Бесплатный план (512MB)
- ✅ Не нужно устанавливать MongoDB локально
- ✅ Доступ из любого места
- ✅ Автоматические бэкапы
- ✅ Легко масштабируется

---

## 🚀 ПОШАГОВАЯ НАСТРОЙКА

### Шаг 1: Регистрация

1. Откройте https://www.mongodb.com/cloud/atlas
2. Нажмите **"Try Free"** или **"Sign Up"**
3. Зарегистрируйтесь через:
   - Google аккаунт (быстрее всего)
   - Email
   - GitHub

---

### Шаг 2: Создание кластера

После входа вы попадете на страницу создания кластера:

1. **Выберите план:**
   - Нажмите **"Create"** на плане **M0 FREE**
   - ✅ 512MB хранилища
   - ✅ Бесплатно навсегда

2. **Выберите регион:**
   - Provider: **AWS** (рекомендуется)
   - Region: **Frankfurt (eu-central-1)** (ближайший к Казахстану)
   - Или: **Mumbai (ap-south-1)** (ближе, но не всегда доступен)

3. **Название кластера:**
   - Cluster Name: `senseofdance` (или любое)

4. Нажмите **"Create"**
5. Подождите 1-3 минуты пока кластер создается

---

### Шаг 3: Настройка доступа

После создания кластера:

#### 3.1 Database Access (Пользователь БД)

1. В левом меню: **Security** → **Database Access**
2. Нажмите **"Add New Database User"**
3. Выберите **"Password"** аутентификацию
4. Заполните:
   - Username: `senseofdance_admin`
   - Password: **Создайте сложный пароль** (сохраните его!)
   - Пример: `SoD2025!SecurePass`
5. Built-in Role: **"Read and write to any database"**
6. Нажмите **"Add User"**

**📝 СОХРАНИТЕ:**
```
Username: senseofdance_admin
Password: SoD2025!SecurePass
```

#### 3.2 Network Access (IP Whitelist)

1. В левом меню: **Security** → **Network Access**
2. Нажмите **"Add IP Address"**
3. Выберите:
   - Для разработки: **"Allow Access from Anywhere"** (0.0.0.0/0)
   - Или: **"Add Current IP Address"** (только ваш IP)
4. Нажмите **"Confirm"**

⚠️ **Внимание:** "Allow Access from Anywhere" удобно для разработки, но для production лучше указать конкретные IP.

---

### Шаг 4: Получение Connection String

1. В левом меню: **Deployment** → **Database**
2. Нажмите **"Connect"** на вашем кластере
3. Выберите **"Connect your application"**
4. Driver: **Node.js**
5. Version: **5.5 or later**
6. Скопируйте **Connection String**

Он будет выглядеть так:
```
mongodb+srv://senseofdance_admin:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

7. **Замените `<password>`** на ваш реальный пароль!
8. **Добавьте имя базы данных** после `.net/`:

```
mongodb+srv://senseofdance_admin:SoD2025!SecurePass@cluster0.xxxxx.mongodb.net/senseofdance?retryWrites=true&w=majority
```

---

### Шаг 5: Обновление .env файла

1. Откройте файл `backend/.env`
2. Найдите строку `MONGODB_URI=`
3. Замените на ваш connection string:

```env
MONGODB_URI=mongodb+srv://senseofdance_admin:SoD2025!SecurePass@cluster0.xxxxx.mongodb.net/senseofdance?retryWrites=true&w=majority
```

4. Сохраните файл

---

## ✅ ПРОВЕРКА ПОДКЛЮЧЕНИЯ

### Запустите backend сервер:

```bash
cd backend
npm start
```

Вы должны увидеть:
```
🚀 ========================================
💃 Sense of Dance API Server
📡 Running on: http://localhost:5000
🌍 Environment: development
🗄️  Database: Connected
========================================

✅ MongoDB Connected: cluster0-shard-00-00.xxxxx.mongodb.net
📊 Database: senseofdance
```

Если видите **"✅ MongoDB Connected"** - все работает! 🎉

---

## 🔧 ВОЗМОЖНЫЕ ПРОБЛЕМЫ

### Ошибка: "MongoNetworkError: failed to connect"

**Причина:** IP адрес не в whitelist

**Решение:**
1. Зайдите в Atlas → Network Access
2. Добавьте ваш текущий IP
3. Или выберите "Allow Access from Anywhere"

---

### Ошибка: "Authentication failed"

**Причина:** Неверный username или password

**Решение:**
1. Проверьте username и password в .env
2. Убедитесь что пароль не содержит спецсимволы (или они экранированы)
3. Пересоздайте пользователя в Database Access

---

### Ошибка: "Database not found"

**Причина:** Не указано имя базы данных

**Решение:**
```
НЕПРАВИЛЬНО:
mongodb+srv://user:pass@cluster.net/?retry...

ПРАВИЛЬНО:
mongodb+srv://user:pass@cluster.net/senseofdance?retry...
                                         ↑ добавьте имя БД
```

---

## 📊 ИСПОЛЬЗОВАНИЕ ATLAS UI

### Просмотр данных:

1. Зайдите в Atlas
2. **Deployment** → **Database**
3. Нажмите **"Browse Collections"**
4. Здесь вы увидите все ваши коллекции:
   - students
   - groups
   - memberships
   - bookings
   - practices
   - payments
   - attendances

### Добавление тестовых данных:

1. Выберите коллекцию (например, `groups`)
2. Нажмите **"Insert Document"**
3. Вставьте JSON:
```json
{
  "name": "K-pop Продвинутые",
  "direction": "K-pop",
  "level": "advanced",
  "instructor": "ИМЯ ФАМИЛИЯ",
  "schedule": [
    {
      "dayOfWeek": 2,
      "time": "19:00",
      "duration": 90
    },
    {
      "dayOfWeek": 5,
      "time": "19:00",
      "duration": 90
    }
  ],
  "maxStudents": 15,
  "currentStudents": 0,
  "isActive": true
}
```
4. Нажмите **"Insert"**

---

## 🔐 БЕЗОПАСНОСТЬ

### ✅ ВАЖНО:

1. **Никогда** не коммитьте .env файл в Git
2. Используйте **сложные пароли** для БД
3. Для production: **ограничьте IP whitelist**
4. Регулярно проверяйте **Activity Feed** в Atlas

### Рекомендуемый пароль:
```
Минимум 12 символов
Буквы + цифры + спецсимволы
Пример: SenseOfDance2025!Secure#Pass
```

---

## 💰 ОГРАНИЧЕНИЯ БЕСПЛАТНОГО ПЛАНА

### M0 Free Tier:
- ✅ 512MB хранилища
- ✅ Shared RAM
- ✅ Unlimited connections
- ✅ Backups (7 days)

### Когда хватит:
```
512MB = примерно:
- 50,000 учеников
- 500,000 записей посещений
- 100,000 платежей

Для студии танцев - хватит на ГОДЫ!
```

### Когда нужен Upgrade:
- Более 100,000 учеников
- Нужен dedicated cluster
- Нужны дополнительные фичи (Analytics, Charts)

Тогда → **M10 план** ($0.08/час = ~$57/месяц)

---

## 📝 ЧЕКЛИСТ НАСТРОЙКИ

- [ ] Зарегистрироваться на MongoDB Atlas
- [ ] Создать бесплатный кластер M0
- [ ] Создать Database User
- [ ] Настроить Network Access (IP whitelist)
- [ ] Получить Connection String
- [ ] Заменить `<password>` на реальный
- [ ] Добавить имя БД `/senseofdance`
- [ ] Обновить `backend/.env`
- [ ] Запустить сервер (`npm start`)
- [ ] Увидеть "✅ MongoDB Connected"

---

## 🎯 СЛЕДУЮЩИЙ ШАГ

После успешного подключения:

1. Запустите backend: `npm start`
2. Проверьте работу API: `http://localhost:5000`
3. Протестируйте endpoints через Postman
4. Подключите фронтенд к API

---

**Создано:** 8 октября 2025  
**Обновлено:** 8 октября 2025

