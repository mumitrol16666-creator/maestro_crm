# Целевая архитектура абонементов и раздела «Уроки в школе»

Документ фиксирует целевую модель экосистемы Maestro: разделение CRM-контура и Learning Platform, модель абонементов в четыре слоя, интеграционные границы и правила безопасности.

Связанные документы: [BUSINESS_LOGIC.md](./BUSINESS_LOGIC.md), [INTEGRATION_GUIDE.md](../architecture/INTEGRATION_GUIDE.md), [API_ROADMAP.md](../api-contracts/API_ROADMAP.md).

---

## Главный вывод

Операционная система школы (CRM) должна владеть расписанием, посещаемостью, уроками, группами, преподавателями, биллингом и остатками пакетов/абонементов. Learning layer (Learning Platform) должен владеть онлайн-курсами, заданиями, прогрессом, достижениями и сдачей работ.

Для Maestro:

- **CRM** остаётся источником истины по офлайн-школе.
- **Learning Platform** — единый пользовательский интерфейс для ученика и преподавателя.
- Ученик видит офлайн-уроки и абонементы в режиме **read-only**.
- Преподаватель в Learning Platform видит свои уроки на сегодня, отмечает посещаемость, тему и ДЗ; запись уходит в CRM через **backend-to-backend proxy**, а не в локальную БД платформы.

Иначе появятся два конкурирующих источника истины и неизбежные расхождения по остаткам, долгам и истории уроков.

---

## Двухконтурная архитектура

### CRM-контур владеет

- учеником, семьёй/плательщиком, преподавателем;
- направлением, группой, кабинетом;
- шаблоном расписания, экземпляром урока (`Class`);
- посещаемостью (`ClassAttendee`);
- абонементом (`Membership`), журналом движений баланса (`MembershipTransaction`);
- счетами, оплатами, долгом, заморозкой (`Freeze`), make-up credit;
- комментариями по офлайн-урокам (тема, ДЗ, internal/shared notes).

### Learning Platform-контур владеет

- пользователем (`User`);
- онлайн-курсами, модулями, видеоуроками;
- assignments, quiz attempts, submissions;
- badges/achievements, progress, practice log;
- online notifications;
- mapping `crmStudentId` / `crmTeacherId`;
- offline UI surfaces (read-only для ученика, command proxy для преподавателя).

### Интеграционный слой

Связь не через общую таблицу в БД, а через:

| Механизм | Назначение |
|----------|------------|
| `crmStudentId`, `crmTeacherId` | Идентификаторы связи в `User` |
| Backend proxy в Learning Platform | Единая точка входа для фронтенда |
| Read API из CRM | Ученик: расписание, остатки, история |
| Command API в CRM | Преподаватель: start/finish/submit/not-held |
| Webhook / event bus (позже) | Кэш, реактивные обновления read model |

### Boundary map

```
CRM
  ├─ students / teachers / families
  ├─ groups / rooms / schedules
  ├─ lessons / attendance / homework
  ├─ membership plans / student memberships / ledger
  └─ invoices / payments / debt

Learning Platform
  ├─ users
  ├─ online courses / modules / assignments
  ├─ submissions / grades / badges / progress
  ├─ crmStudentId / crmTeacherId mapping
  └─ offline UI surfaces

Integration
  ├─ GET  /api/v1/students/me/offline-summary        (LP → CRM read)
  ├─ GET  /api/v1/teachers/me/today-agenda           (LP → CRM read, planned)
  ├─ POST /api/v1/teachers/me/lessons/:id/attendance (LP → CRM write, planned)
  ├─ POST /api/v1/teachers/me/lessons/:id/complete   (LP → CRM write, planned)
  └─ later: webhooks / cache invalidation / event replay
```

CRM integration endpoints (service-to-service): префикс `/api/integration/v1/`.

---

## Безопасность

Допустимая схема **только** такая:

```
Frontend Learning Platform → Backend Learning Platform → CRM API
```

- Студент и преподаватель **никогда** не обращаются к CRM напрямую.
- CRM integration token **не уходит** во фронтенд.
- Teacher/student identity берётся из **авторизованной сессии** и mapping внутри backend, не из query params.
- Write-операции в CRM — **идемпотентные** (`X-Idempotency-Key`), иначе двойное списание и задвоенные события при retry.

---

## Модуль абонементов: четыре слоя

Раздел «Абонементы» нельзя строить как одно поле `classesRemaining`. Нужны минимум четыре слоя:

| Слой | Сущность (целевая) | Текущее в CRM | Назначение |
|------|-------------------|---------------|------------|
| 1 | `MembershipPlan` | `DirectionPlan` + `MEMBERSHIP_CONFIG` | Шаблон тарифа — что школа продаёт |
| 2 | `StudentMembership` | `Membership` | Экземпляр абонемента ученика |
| 3 | `BalanceLedgerEntry` | `MembershipTransaction` | Неизменяемый журнал движений баланса |
| 4 | Financial documents | `Payment`, `Invoice` (частично) | Счета, оплаты, долг |

История денег и уроков должна быть **историей**, а не «живым полем», которое меняется задним числом.

---

## MembershipPlan — шаблон тарифа

Шаблон того, что школа продаёт. Не равен записи ученика на урок (паттерн Sawyer: membership даёт право на потребление по правилам, а не автозапись в roster).

### Поля

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string | Первичный ключ |
| `name` | string | Отображаемое название («Месячный 8 занятий») |
| `directionId` | string? | Направление; null = универсальный план |
| `groupBindMode` | enum | `required` \| `optional` \| `none` — привязка к группе |
| `billingModel` | enum | `per_class` \| `package` \| `subscription` \| `hours` |
| `unitType` | enum | `class` \| `hour` \| `month` |
| `includedUnits` | int | Количество единиц в пакете/периоде |
| `price` | int | Базовая цена (тенге) |
| `currency` | string | `KZT` по умолчанию |
| `validityModel` | enum | `fixed_days` \| `calendar_month` \| `until_units_exhausted` |
| `validityDays` | int? | Срок действия в днях |
| `calendarRule` | json? | Правила календарного биллинга (день списания, prorate) |
| `autoRenew` | boolean | Автопродление |
| `prorationPolicy` | enum | `none` \| `daily` \| `by_class` |
| `lateCancelPolicy` | enum | `no_charge` \| `charge` \| `makeup_credit` |
| `noShowPolicy` | enum | `no_charge` \| `charge` \| `makeup_credit` |
| `freezePolicy` | json | Макс. заморозок, мин. дней, перенос срока |
| `makeupPolicy` | json | Правила отработок и срока годности кредитов |
| `carryoverPolicy` | enum | `none` \| `limited` \| `full` — перенос неиспользованных единиц |
| `debtPolicy` | enum | `block_lessons` \| `allow_with_debt` \| `admin_only` |
| `branchId` | string? | Филиал (будущее) |
| `isVisible` | boolean | Показывать в каталоге/записи |
| `status` | enum | `active` \| `archived` |

### Маппинг с текущей моделью

| Текущее | Целевое |
|---------|---------|
| `DirectionPlan.type` + `classes` + `days` + `price` | `billingModel`, `unitType`, `includedUnits`, `validityDays`, `price` |
| `MEMBERSHIP_CONFIG[type]` | Fallback, пока план не в БД |
| `Membership.type` | Ссылка на `planId` + snapshot полей на момент покупки |

При создании `StudentMembership` (сейчас `Membership`) снимается **snapshot** цены и правил плана — изменение `MembershipPlan` не переписывает старые абонементы.

---

## StudentMembership — экземпляр абонемента

| Поле | Описание |
|------|----------|
| `id` | Первичный ключ |
| `studentId` | Ученик |
| `planId` | Ссылка на `MembershipPlan` |
| `groupId` | Опциональная привязка к группе |
| `status` | `active` \| `expired` \| `frozen` \| `cancelled` |
| `startDate`, `endDate` | Период действия |
| `unitsRemaining` | Остаток (замена `classesRemaining`) |
| `unitsTotal` | Всего единиц |
| `unitsUsed` | Использовано |
| `paidAmount`, `remainingAmount` | Финансовый snapshot |
| `paymentStatus` | `not_paid` \| `partial` \| `paid` |
| `planSnapshot` | JSON: цена и правила на момент покупки |
| `previousMembershipId` | Цепочка продлений |

Текущая модель `Membership` уже содержит большую часть полей; миграция — добавить `planId`, переименовать счётчики в `units*`, вынести правила в `MembershipPlan`.

---

## BalanceLedgerEntry — журнал движений

Неизменяемая цепочка событий. Каждое изменение остатка — отдельная запись.

| Поле | Описание |
|------|----------|
| `id` | Первичный ключ |
| `membershipId` | Абонемент |
| `type` | `initial` \| `deduct` \| `add` \| `manual_deduct` \| `freeze_used` \| `makeup_credit` \| `refund` \| `adjustment` |
| `amount` | Дельта (+/- единицы или деньги — отдельные поля при необходимости) |
| `balanceAfter` | Остаток после операции |
| `reason` | Текст / код причины |
| `classId` | Связанный урок (при списании) |
| `freezeId` | Связанная заморозка |
| `addedById` | Кто инициировал (admin) |
| `idempotencyKey` | Защита от дублей |
| `createdAt` | Время (immutable) |

Текущая `MembershipTransaction` — база; целевое улучшение: поле `balanceAfter`, обязательный `idempotencyKey`, запрет UPDATE/DELETE.

---

## Financial documents

| Сущность | Назначение |
|----------|------------|
| `Payment` | Факт оплаты, привязка к membership |
| `Invoice` (будущее) | Документ к оплате, recurring |
| Debt | Производное от `remainingAmount` на membership |

Правило: **списание занятия** и **фиксация оплаты** — разные операции; преподаватель не инициирует ни одну из них.

---

## Раздел «Уроки в школе»

### Ученик (Learning Platform)

Read-only из CRM через `GET /api/v1/students/me/offline-summary`:

- ближайшие уроки (`upcomingLessons`);
- история (`lessonHistory`);
- тема и ДЗ — только после `status = completed` (админ подтвердил);
- остаток абонемента (`balanceSnapshot`);
- группы, долг.

Реализовано в CRM: `GET /api/integration/v1/students/:crmStudentId/offline-summary`.  
Реализовано в LP: прокси `GET /api/v1/students/me/offline-summary`, страница `/school-lessons`.

### Преподаватель (Learning Platform, planned)

- `GET /api/v1/teachers/me/today-agenda` → CRM offline-classes;
- `POST` attendance, complete, submit → CRM integration write API;
- без доступа к ценам и списанию.

### CRM profile.html

Параллельный read-only кабинет для учеников, зашедших напрямую в CRM (`GET /api/students/me/cabinet`).

---

## Ориентиры рынка (кратко)

| Платформа | Паттерн для Maestro |
|-----------|---------------------|
| Jackrabbit | Расписание + tuition + Staff/Parent portal, attendance |
| Sawyer | Membership ≠ запись на урок; pause, perk spots |
| My Music Staff | Calendar billing, make-up credits, история не переписывается |
| Teachworks | Package balances: purchased/scheduled/used; teacher workflow без биллинга |
| Opus1 | Teacher portal: attendance + lesson recaps в реальном времени |
| TeacherZone | LMS поверх lesson business workflows |
| Moodle / Canvas | Онлайн-достижения — отдельный контур, не в CRM |

---

## План миграции (без гибридного v2 сразу)

1. **Сейчас:** read-only «Уроки в школе» и абонементы в LP; teacher write через integration API.
2. **Фаза 2:** `MembershipPlan` в Prisma, seed из `DirectionPlan` + `MEMBERSHIP_CONFIG`.
3. **Фаза 3:** `planId` на `Membership`, ledger с `balanceAfter` и idempotency.
4. **Фаза 4:** webhooks `student-offline-summary-updated`, read model cache в LP.
5. **Не начинать:** гибридные абонементы v2 (раздельные остатки инд/группа/теория) до стабилизации слоёв 1–4.

---

## Стандарты на будущее

Data contracts проектировать совместимо с:

- **OneRoster** — users, courses, classes, enrollments, results;
- **LTI 1.3 / LTI Advantage** — deep integration инструментов и ролей.

Внедрение не обязательно сейчас, но новые API не должны противоречить этой модели.
