# Maestro CRM Backend

Express + Prisma + PostgreSQL API для операционного и финансового контура
музыкальной школы.

## Основные модули

- auth и роли;
- заявки и конверсия;
- ученики, семьи и группы;
- направления и тарифы;
- абонементы, оплаты, заморозки и касса;
- расписание, кабинеты, уроки и посещаемость;
- подтверждение уроков;
- зарплаты и комиссии;
- аналитика и журнал действий;
- интеграция с Maestro Learning Platform.

## Роли

- `student`;
- `sales_manager`;
- `teacher`;
- `admin`;
- `super_admin`.

Серверные middleware в `src/middleware/auth.js` являются окончательной
границей доступа. Видимость пункта меню сама по себе не предоставляет право
на API-операцию.

## Локальный запуск

```bash
cp .env.example .env
npm install
npx prisma db push
npm run dev
```

## Интеграция с Learning Platform

Маршруты `/api/integration/v1/*` защищены integration middleware и
обеспечивают:

- создание онлайн-заявок;
- link/provision/sync аккаунтов;
- SSO;
- расписание преподавателя;
- offline summary ученика;
- статусы урока, посещаемость и admin approve.

Подробный функциональный срез:
[../IMPLEMENTATION_AUDIT_2026-06-19.md](../IMPLEMENTATION_AUDIT_2026-06-19.md).
