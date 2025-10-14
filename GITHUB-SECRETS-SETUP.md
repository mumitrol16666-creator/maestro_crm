# 🔐 Настройка GitHub Secrets (5 штук)

## 📋 Быстрая ссылка:
**https://github.com/poirtyc/senseofdance/settings/secrets/actions**

---

## ✅ Список секретов для добавления:

### 1️⃣ SERVER_HOST
```
Name:   SERVER_HOST
Secret: 149.33.0.114
```

### 2️⃣ SERVER_USER
```
Name:   SERVER_USER
Secret: root
```

### 3️⃣ SERVER_PASSWORD
```
Name:   SERVER_PASSWORD
Secret: D7V7vcfK2i
```

### 4️⃣ TEST_MONGODB_URI
```
Name:   TEST_MONGODB_URI
Secret: mongodb+srv://Dmitriy:Coolpopitd12@cluster0.ecwubgs.mongodb.net/SenseOfDanceTest?retryWrites=true&w=majority
```

### 5️⃣ JWT_SECRET
```
Name:   JWT_SECRET
Secret: test-secret-key-for-testing
```

---

## 🔧 Пошаговая инструкция:

### Шаг 1: Открыть настройки
1. Открой: https://github.com/poirtyc/senseofdance
2. Нажми **Settings** (вверху)
3. В левом меню: **Secrets and variables** → **Actions**

### Шаг 2: Добавить каждый секрет
Для каждого из 5 секретов выше:

1. Нажми **New repository secret** (зеленая кнопка справа)
2. В поле **Name** введи имя секрета (например, `SERVER_HOST`)
3. В поле **Secret** введи значение (например, `149.33.0.114`)
4. Нажми **Add secret**
5. Повтори для остальных 4 секретов

### Шаг 3: Проверить
После добавления должно быть 5 секретов:
- ✅ JWT_SECRET
- ✅ SERVER_HOST
- ✅ SERVER_PASSWORD
- ✅ SERVER_USER
- ✅ TEST_MONGODB_URI

---

## 🚀 После добавления:

1. Открой: https://github.com/poirtyc/senseofdance/actions
2. Выбери последний запуск (красный ❌)
3. Нажми **Re-run all jobs** (вверху справа)
4. Дождись зеленого чекмарка ✅

---

## 🔍 Если всё равно ошибка:

Проверь что имена секретов ТОЧНО такие:
- `SERVER_HOST` (не `server_host`, не `Server_Host`)
- `SERVER_USER` (не `USERNAME`, не `USER`)
- `SERVER_PASSWORD` (не `PASSWORD`)
- `TEST_MONGODB_URI` (не `MONGODB_URI`)
- `JWT_SECRET` (не `JWT_TOKEN`)

**Имена должны быть ТОЧНО как указано!**

---

## ✅ Готово!

После добавления секретов автодеплой заработает! 🎉

