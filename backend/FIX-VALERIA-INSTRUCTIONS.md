# Инструкция по исправлению данных Валерия Валерия

## Проблема с подключением к БД

Скрипт не может подключиться к MongoDB Atlas, потому что ваш IP адрес не в whitelist.

## Решение 1: Добавить IP в whitelist (рекомендуется)

1. Зайдите в MongoDB Atlas: https://cloud.mongodb.com
2. Security → Network Access
3. Нажмите "Add IP Address"
4. Выберите "Add Current IP Address" или "Allow Access from Anywhere" (0.0.0.0/0)
5. Подтвердите

После этого запустите скрипт:
```bash
cd backend
node fix-valeria-duplicate-payment.js
```

## Решение 2: Запустить на сервере

Если у вас есть доступ к серверу, где работает приложение:

```bash
ssh root@149.33.0.114
cd /root/sense-of-dance/backend
node fix-valeria-duplicate-payment.js
```

## Решение 3: Использовать API endpoint

Если сервер работает, можно вызвать API endpoint:

```bash
# Получить токен авторизации (нужен super_admin)
curl -X POST http://your-server:5000/api/payments/fix-valeria-duplicate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

Или через админ-панель, если там есть кнопка для этого.

## Что делает скрипт

1. ✅ Находит ученика "Валерия Валерия"
2. ✅ Удаляет дублирующиеся платежи по 5000₸ (оставляет самый старый)
3. ✅ Исправляет количество занятий (с 33 на 11)
4. ✅ Исправляет остаток к оплате (с 44 000 на 13 000)
5. ✅ Показывает финальную статистику

## После исправления

Проверьте в админ-панели:
- Количество занятий должно быть 11
- Должен быть один платеж 5000₸
- Остаток к оплате должен быть 13 000₸

