# Maestro CRM Rebrand

CRM переведена с Sense of Dance на **Музыкальная школа Maestro**.

## Сделано

- Палитра Maestro (gold / ink / cream)
- Брендинг login + admin
- Удалены GitHub Actions автодеплои
- Удалены legacy deploy/fix документы и `.exp` скрипты
- Docker/PM2 переименованы в `maestro-crm-*`
- CORS: только Maestro + localhost (без senseofdance.kz)

## Вручную при запуске

1. Направления в админке → музыка (Гитара, Вокал, …)
2. `backend/.env` — свой `DATABASE_URL`, `JWT_SECRET`
3. Telegram-бот — обновить тексты под школу Maestro
4. Домен и nginx — настроить на своём сервере

## Локально

```bash
cd backend && npm run dev
cd frontend && python3 -m http.server 8000
```

`http://localhost:8000/public/login.html`
