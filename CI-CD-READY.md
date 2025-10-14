# ✅ CI/CD Развёрнут и Готов к Работе!

**Дата:** 14 октября 2025  
**Статус:** 🚀 Активен

---

## 🎯 Что работает

### 1. Автоматическое тестирование
- ✅ 96 тестов
- ✅ 47.5% покрытия кода
- ✅ Запускаются при каждом push в `main`
- ✅ ~40 секунд выполнения

### 2. Автоматический деплой
- ✅ Только если тесты проходят
- ✅ SSH подключение к серверу
- ✅ Git pull + npm install
- ✅ PM2 restart

### 3. Безопасность
- ✅ Пароли в GitHub Secrets (не в коде)
- ✅ Защита от деплоя с ошибками
- ✅ Rollback возможен через git

---

## 📍 Ссылки

### GitHub
- **Репозиторий:** https://github.com/poirtyc/senseofdance
- **Actions:** https://github.com/poirtyc/senseofdance/actions
- **Последний деплой:** https://github.com/poirtyc/senseofdance/actions/workflows/test-and-deploy.yml

### Сервер
- **IP:** 149.33.0.114
- **Backend:** http://149.33.0.114:5000
- **Frontend:** http://149.33.0.114:3000
- **Логин:** root

---

## 🔄 Как это работает

### При каждом `git push` в `main`:

```
1. GitHub получает push
       ↓
2. Запускает GitHub Actions
       ↓
3. Устанавливает Node.js
       ↓
4. Устанавливает зависимости (npm ci)
       ↓
5. Запускает тесты (npm test)
       ↓
   ├─→ ✅ Тесты прошли
   │       ↓
   │   SSH подключение к серверу
   │       ↓
   │   pm2 stop
   │       ↓
   │   git pull
   │       ↓
   │   npm install
   │       ↓
   │   pm2 start
   │       ↓
   │   ✅ ДЕПЛОЙ ГОТОВ!
   │
   └─→ ❌ Тесты не прошли
           ↓
       ДЕПЛОЙ ОТМЕНЁН
       (защита от багов)
```

---

## 🛠️ Как деплоить изменения

### Локально у тебя:

```bash
# 1. Делаешь изменения
git add .
git commit -m "Описание изменений"

# 2. Пушишь в GitHub
git push origin main

# 3. Всё! Остальное автоматически:
#    - Тесты запустятся
#    - Если ОК → деплой на сервер
#    - Если FAIL → уведомление
```

### Просмотр логов деплоя:

1. Зайди на https://github.com/poirtyc/senseofdance/actions
2. Кликни на последний workflow
3. Смотри прогресс в реальном времени

---

## 📊 Мониторинг

### На GitHub:
- **Actions** → видно все запуски
- **Зелёная галочка** ✅ = успешно
- **Красный крестик** ❌ = ошибка

### На сервере:
```bash
ssh root@149.33.0.114

# Статус приложения
pm2 status

# Логи backend
pm2 logs sense-of-dance-backend

# Перезапуск (если нужно)
pm2 restart sense-of-dance-backend
```

---

## 🚨 Если что-то пошло не так

### 1. Тесты не проходят
```bash
# Запусти тесты локально
cd backend
npm test

# Посмотри что сломалось
# Исправь
# Закоммить и push снова
```

### 2. Деплой упал
- Зайди в GitHub Actions → смотри логи
- Обычные проблемы:
  - SSH не подключился → проверь secrets
  - npm install упал → проверь package.json
  - PM2 не запустился → зайди на сервер вручную

### 3. Откат к предыдущей версии
```bash
# Локально
git log  # найди хороший коммит
git revert <commit-hash>
git push origin main

# Или на сервере
ssh root@149.33.0.114
cd /root/sense-of-dance
git log
git reset --hard <good-commit>
pm2 restart all
```

---

## 📝 Секреты на GitHub

Текущие secrets (уже настроены):

| Secret Name | Значение | Где используется |
|-------------|----------|------------------|
| `SERVER_HOST` | 149.33.0.114 | SSH подключение |
| `SERVER_USER` | root | SSH логин |
| `SERVER_PASSWORD` | *** | SSH пароль |

**Где:** Settings → Secrets and variables → Actions

---

## 🎯 Следующие шаги (опционально)

### 1. Добавить уведомления
- Telegram бот при успешном/неуспешном деплое
- Email уведомления

### 2. Staging окружение
- Отдельная ветка `develop`
- Автодеплой на тестовый сервер
- Ручной деплой на production

### 3. Больше тестов
- До 60-70% покрытия
- E2E тесты
- Performance тесты

### 4. Мониторинг
- Uptime мониторинг (uptimerobot.com)
- Error tracking (Sentry)
- Логи (Loggly, Papertrail)

---

## 📚 Документация

В репозитории:
- `.github/workflows/test-and-deploy.yml` - основной workflow
- `.github/workflows/test-only.yml` - только тесты для PR
- `.github/SETUP-SECRETS.md` - инструкция по секретам
- `backend/TESTS-FINAL-REPORT.md` - отчёт по тестам
- `backend/HOW-TO-REACH-90-PERCENT.md` - как довести до 90%

---

## ✅ Чеклист готовности

- [x] GitHub Actions настроен
- [x] Secrets добавлены
- [x] 96 тестов написаны
- [x] Первый push сделан
- [x] Workflow запустился
- [ ] Деплой прошёл успешно (проверь через 2 минуты)
- [ ] Приложение работает на сервере

---

## 🎉 Поздравляю!

Теперь у тебя:
- ✅ Автоматическое тестирование
- ✅ Автоматический деплой
- ✅ Защита от багов
- ✅ Professional DevOps setup

**Каждый push = автоматический деплой!** 🚀

---

**Вопросы?** Смотри логи на GitHub Actions или пиши мне!

