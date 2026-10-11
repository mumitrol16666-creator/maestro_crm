# Maestro CRM Rebrand

CRM полностью переведена на **Музыкальная школа Maestro**.

## Сделано

- Палитра Maestro (gold / ink / cream)
- Брендинг login + admin
- Удалены GitHub Actions автодеплои
- Удалены legacy deploy/fix документы, `.exp` скрипты, MongoDB-скрипты
- Удалена старая документация Sense of Dance
- Docker/PM2: `maestro-crm-*`
- CORS: только Maestro + localhost
- Направления: музыка (Гитара, Вокал, Фортепиано, …)
- Кабинеты вместо танцевальных залов
- PostgreSQL `maestro_crm` (Prisma)

## Первый запуск

```bash
cd backend
cp .env.example .env          # DATABASE_URL, JWT_SECRET
npm install
npx prisma db push
node scripts/init-maestro-config.js
node create-super-admin.js +77001234567 --password-stdin < /secure/path/admin-password
npm run dev
```

## Полезные скрипты

| Скрипт | Назначение |
|--------|------------|
| `scripts/init-maestro-config.js` | Направления + кабинеты |
| `create-super-admin.js` | Создать супер-админа |
| `make-admin.js` | Отключён; роли меняются через CRM под супер-администратором |
| `reset-admin.js` | Сброс пароля действующего администратора по точному ID, пароль только из stdin |
| `scripts/health-check.sh` | Проверка API + PM2 |

Правила подготовки файла пароля и восстановления доступа описаны в [README](README.md). Скрипты не используют пароли по умолчанию и не меняют существующему пользователю роль при создании администратора.

## Контакты на фронте

Номер школы задаётся в `frontend/js/brand.js` → `supportPhone`.
Пока пусто — показывается сайт `maestro-school.duckdns.org`.

## Локально

```bash
cd backend && npm run dev
cd frontend && python3 -m http.server 8000
```

`http://localhost:8000/public/login.html`
