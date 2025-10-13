# 🚀 Быстрая настройка сервера (одна команда!)

## Способ 1: Автоматическая установка (рекомендуется)

**1. Подключись к серверу:**
```bash
ssh root@149.33.0.114
# Введи пароль: D7V7vcfK2i
```

**2. Запусти одну команду:**
```bash
curl -fsSL https://raw.githubusercontent.com/poirtyc/senseofdance/main/server-setup.sh | bash
```

**Или скачай скрипт локально:**
```bash
wget https://raw.githubusercontent.com/poirtyc/senseofdance/main/server-setup.sh
chmod +x server-setup.sh
./server-setup.sh
```

**Готово!** Скрипт автоматически:
- ✅ Установит Node.js 18
- ✅ Установит PM2
- ✅ Клонирует репозиторий
- ✅ Создаст .env файл
- ✅ Установит зависимости
- ✅ Запустит backend и frontend
- ✅ Настроит Nginx
- ✅ Настроит автозапуск

---

## Способ 2: Если нет доступа к GitHub

**1. Подключись к серверу:**
```bash
ssh root@149.33.0.114
```

**2. Создай скрипт вручную:**
```bash
nano /root/server-setup.sh
```

**3. Скопируй содержимое из `server-setup.sh` (я создал его локально)**

**4. Запусти:**
```bash
chmod +x /root/server-setup.sh
bash /root/server-setup.sh
```

---

## 📋 Что делать после установки

**Проверь что всё работает:**
```bash
# Статус процессов
pm2 status

# Логи backend (должны быть без ошибок)
pm2 logs sense-of-dance-backend --lines 50

# Проверь API
curl http://localhost:5000/api/students
```

**Открой в браузере:**
- Frontend: http://149.33.0.114
- Backend API: http://149.33.0.114/api

---

## 🔄 Тестируем автодеплой

**1. Сделай любое изменение в коде (локально):**
```bash
cd /Users/poirtyc/Desktop/sense-of-dance
echo "# Test deploy" >> README.md
git add .
git commit -m "test: проверка автодеплоя"
git push origin main
```

**2. Открой GitHub Actions:**
https://github.com/poirtyc/senseofdance/actions

**3. Дождись зелёного чекмарка ✅**

**4. Проверь на сервере:**
```bash
ssh root@149.33.0.114
cd /root/sense-of-dance
git log -1  # Должен быть твой последний коммит
```

---

## 🚨 Если что-то пошло не так

**Логи backend:**
```bash
pm2 logs sense-of-dance-backend
```

**Перезапуск вручную:**
```bash
pm2 restart sense-of-dance-backend
pm2 restart sense-of-dance-frontend
```

**Полная переустановка:**
```bash
pm2 delete all
rm -rf /root/sense-of-dance
# Запусти скрипт заново
bash /root/server-setup.sh
```

---

## ✅ Готово!

После запуска скрипта сервер будет полностью настроен и готов к автоматическим деплоям! 🎉

