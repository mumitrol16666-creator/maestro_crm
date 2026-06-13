# Maestro CRM

CRM для **музыкальной школы Maestro** (офлайн-школа: заявки, группы, абонементы, касса, расписание).

Онлайн-платформа курсов — отдельный проект: `maestro_school`.

## Запуск локально

```bash
cd backend
cp .env.example .env   # DATABASE_URL, JWT_SECRET
npm install
npx prisma db push
node scripts/init-maestro-config.js   # направления + кабинеты
node create-super-admin.js 77001234567 YourPassword
npm run dev

cd ../frontend
python3 -m http.server 8000
```

- CRM логин: `http://localhost:8000/public/login.html`
- API: `http://localhost:5001`

## Docker

```bash
docker compose up --build -d
```

## Деплой

Автодеплой отключён. Деплой вручную на свой сервер.

Подробности ребрендинга: [MAESTRO-REBRAND.md](./MAESTRO-REBRAND.md)
