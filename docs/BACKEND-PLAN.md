# 🚀 BACKEND РАЗРАБОТКА - SENSE OF DANCE

## 📊 ОБЩАЯ ИНФОРМАЦИЯ

**Стек технологий:**
- Backend: Node.js + Express
- Database: MongoDB Atlas (облако)
- Auth: JWT (JSON Web Tokens)
- Deploy: Railway.app (бесплатно)

**Timeline:** 20 дней (полная версия) | 10 дней (MVP)

**Статус:** 🟡 Планирование

---

## 📅 ЭТАП 1: НАСТРОЙКА ОКРУЖЕНИЯ (1 день)

**Статус:** ⏳ Не начато

### Задачи:

- [ ] 1.1 Создать структуру папок backend/
- [ ] 1.2 Инициализировать npm проект (package.json)
- [ ] 1.3 Установить зависимости:
  - express
  - mongoose
  - cors
  - dotenv
  - bcryptjs
  - jsonwebtoken
  - express-validator
  - helmet
  - morgan
  - axios
- [ ] 1.4 Настроить MongoDB Atlas:
  - Регистрация
  - Создание кластера M0 (бесплатный)
  - Получение connection string
  - Настройка IP whitelist
- [ ] 1.5 Создать .env файл с переменными
- [ ] 1.6 Настроить .gitignore для backend

### Структура проекта:
```
sense-of-dance/
├── frontend/              # Текущий сайт (✅ ГОТОВО)
│   ├── index.html
│   ├── styles.css
│   ├── script.js
│   └── source/
│
└── backend/               # Новый backend
    ├── src/
    │   ├── server.js      # Главный файл
    │   ├── config/
    │   │   └── db.js      # MongoDB подключение
    │   ├── models/
    │   │   ├── Student.js
    │   │   ├── Group.js
    │   │   ├── Membership.js
    │   │   ├── Booking.js
    │   │   ├── Practice.js
    │   │   ├── Attendance.js
    │   │   └── Payment.js
    │   ├── routes/
    │   │   ├── auth.js
    │   │   ├── students.js
    │   │   ├── groups.js
    │   │   ├── bookings.js
    │   │   ├── memberships.js
    │   │   ├── practices.js
    │   │   └── payments.js
    │   ├── controllers/
    │   ├── middleware/
    │   │   ├── auth.js
    │   │   └── validation.js
    │   └── utils/
    │       ├── telegram.js
    │       └── helpers.js
    ├── package.json
    ├── .env
    └── .gitignore
```

---

## 📅 ЭТАП 2: MONGODB МОДЕЛИ (2 дня)

**Статус:** ⏳ Не начато

### Задачи:

- [ ] 2.1 Создать модель Student (Ученик)
- [ ] 2.2 Создать модель Group (Группа)
- [ ] 2.3 Создать модель Membership (Абонемент)
- [ ] 2.4 Создать модель Booking (Заявка)
- [ ] 2.5 Создать модель Practice (Практика)
- [ ] 2.6 Создать модель Attendance (Посещение)
- [ ] 2.7 Создать модель Payment (Платеж)
- [ ] 2.8 Настроить связи между моделями
- [ ] 2.9 Добавить валидацию данных
- [ ] 2.10 Создать seed данные для тестирования

### Модели в деталях:

#### Student (Ученик)
```javascript
{
  name: String,              // ФИО
  phone: String,             // Телефон (unique)
  email: String,             // Email (опционально)
  password: String,          // Хеш пароля
  dateOfBirth: Date,         // Дата рождения
  
  groups: [                  // Может быть в 2 группах!
    {
      groupId: ObjectId,
      joinedAt: Date,
      status: String         // 'active' | 'frozen' | 'left'
    }
  ],
  
  activeMembership: ObjectId,
  role: String,              // 'student' | 'sales_manager' | 'teacher' | 'admin' | 'super_admin'
  registeredAt: Date,
  status: String,            // 'active' | 'inactive'
  notes: String,
  
  // Для преподавателей
  teacherInfo: {
    directions: [String],    // Направления которые ведет
    assignedGroups: [ObjectId], // Группы которые ведет
    bio: String,
    photo: String
  }
}
```

#### Group (Группа)
```javascript
{
  name: String,              // "K-pop Продвинутые"
  direction: String,         // "K-pop"
  level: String,             // "beginner" | "intermediate" | "advanced"
  instructor: String,        // Имя преподавателя (пока String)
  
  schedule: [                // Расписание группы
    {
      dayOfWeek: Number,     // 1-7 (Пн-Вс)
      time: String,          // "18:00"
      duration: Number       // 90 минут
    }
  ],
  
  maxStudents: Number,       // Макс 15-20
  currentStudents: Number,
  isActive: Boolean,
  createdAt: Date
}
```

#### Membership (Абонемент)
```javascript
{
  student: ObjectId,
  type: String,              // 'trial' | 'monthly' | '3months'
  price: Number,             // 2000, 22000, 55000
  
  // ЗАНЯТИЯ
  classesTotal: Number,      // Всего занятий в абонементе (8, 24)
  classesRemaining: Number,  // Осталось занятий (автоматически уменьшается)
  classesUsed: Number,       // Использовано занятий
  
  startDate: Date,           // Дата активации
  endDate: Date,             // Расчетная дата окончания (может сдвигаться)
  status: String,            // 'active' | 'expired' | 'frozen'
  
  // ЗАМОРОЗКА (2 занятия в месяц)
  freezeCredits: Number,     // 2 в месяц
  freezesUsed: [
    {
      date: Date,            // Когда заморозил
      classDate: Date,       // Какое занятие
      group: ObjectId,
      reason: String
    }
  ],
  
  paymentStatus: String,     // 'paid' | 'pending' | 'overdue'
  paymentMethod: String,     // 'kaspi' | 'cash' | 'card'
  paymentDate: Date,
  
  createdAt: Date
}
```

**БИЗНЕС-ЛОГИКА ПОДСЧЕТА ЗАНЯТИЙ:**

1. **При создании абонемента:**
   - Месяц = 8 занятий (`classesTotal: 8`)
   - 3 месяца = 24 занятия (`classesTotal: 24`)
   - Пробное = 1 занятие (`classesTotal: 1`)

2. **Автоматический подсчет:**
   - Занятия считаются **автоматически** согласно расписанию групп ученика
   - Первое занятие = **сразу после активации/оплаты** абонемента
   - Каждое занятие по расписанию → `classesRemaining--`
   - Система автоматически отслеживает даты занятий из `schedule` групп

3. **Продление раньше срока (ВАЖНО!):**
   - Если осталось 2 занятия, а ученик купил новый месяц (8 занятий)
   - То: `classesRemaining = 2 + 8 = 10 занятий`
   - Остаток **суммируется** с новым абонементом
   - `endDate` пересчитывается на основе 10 занятий и расписания

4. **Пример работы:**
   ```
   День 1: Оплатил месяц → classesRemaining = 8
   День 2: Посетил занятие → classesRemaining = 7
   День 4: Посетил занятие → classesRemaining = 6
   ...
   День 25: classesRemaining = 2 (осталось 2 занятия)
   День 25: Продлил месяц → classesRemaining = 2 + 8 = 10
   ```

5. **Заморозка:**
   - При заморозке занятие **не вычитается** из `classesRemaining`
   - `endDate` сдвигается на количество дней заморозки
   - Максимум 2 заморозки в месяц

#### Booking (Заявка)
```javascript
{
  name: String,
  phone: String,
  direction: String,
  
  status: String,            // 'new' | 'processed' | 'enrolled' | 'rejected'
  notes: String,             // Заметки админа
  
  createdBy: String,         // 'website' | 'admin' | 'telegram'
  createdAt: Date,
  
  processedBy: ObjectId,     // Админ кто обработал
  processedAt: Date,
  
  convertedToStudent: ObjectId  // Если стал учеником
}
```

#### Practice (Практика)
```javascript
{
  name: String,              // "Практика All Styles"
  date: Date,                // Дата
  time: String,              // "20:00"
  duration: Number,          // 120 минут
  
  forDirections: [String],   // Для каких направлений
  instructor: String,
  
  maxAttendees: Number,      // Макс участников
  attendees: [ObjectId],     // Кто записался
  
  isOpen: Boolean,           // Открыта для записи
  createdAt: Date
}
```

#### Attendance (Посещение)
```javascript
{
  student: ObjectId,
  group: ObjectId,
  date: Date,                // Дата и время занятия
  attended: Boolean,         // Пришел или нет
  frozen: Boolean,           // Заморожено
  type: String,              // 'regular' | 'practice'
  createdAt: Date
}
```

#### Payment (Платеж)
```javascript
{
  student: ObjectId,
  membership: ObjectId,
  amount: Number,            // Сумма в тенге
  method: String,            // 'kaspi' | 'cash' | 'card' | 'kaspi-qr'
  status: String,            // 'paid' | 'pending' | 'cancelled'
  
  // Для Kaspi API (когда подключим)
  kaspiPaymentId: String,
  kaspiQrCode: String,
  
  date: Date,
  confirmedBy: ObjectId,     // Админ кто подтвердил
  createdAt: Date
}
```

---

## 👥 СИСТЕМА РОЛЕЙ И ПРАВ ДОСТУПА

### 🎯 ПЯТЬ УРОВНЕЙ ПОЛЬЗОВАТЕЛЕЙ:

#### 1️⃣ SUPER ADMIN (Суперадминистратор)
**Роль:** `super_admin`
**Количество:** Только 1 в системе (владелец студии)

**Права доступа:**
```
✅ ВСЁ, что может Admin
✅ Управление администраторами:
   - Создать нового Admin
   - Удалить Admin
   - Изменить роль Admin → Student
   - Изменить роль Student → Admin
✅ Управление преподавателями:
   - Создать Teacher
   - Удалить Teacher
   - Назначить группы преподавателю
✅ Доступ ко ВСЕМ разделам админки
✅ Изменение системных настроек
✅ Просмотр логов действий всех админов
```

**UI:**
- Видит полную админ-панель
- Дополнительный раздел "Администраторы"
- Дополнительный раздел "Преподаватели"
- Раздел "Настройки системы"

---

#### 2️⃣ ADMIN (Администратор)
**Роль:** `admin`
**Количество:** Несколько (менеджеры студии)

**Права доступа:**
```
✅ Управление заявками:
   - Просмотр всех заявок
   - Изменение статусов
   - Создание заявок
   - Конвертация в учеников
   
✅ Управление учениками:
   - Просмотр всех учеников
   - Создание учеников
   - Редактирование учеников
   - Добавление в группы
   - Удаление учеников
   
✅ Управление группами:
   - Просмотр всех групп
   - Создание групп
   - Редактирование расписания
   - Назначение преподавателей
   - Удаление групп
   
✅ Управление абонементами:
   - Создание абонементов
   - Продление
   - Подтверждение заморозок
   
✅ Управление практиками:
   - Создание практик
   - Просмотр записавшихся
   - Отметка посещений
   
✅ Управление платежами:
   - Подтверждение оплат
   - Просмотр истории
   - Создание чеков
   
✅ Управление преподавателями:
   - Создать Teacher
   - Редактировать Teacher
   - Назначить группы
   - ❌ НЕ может удалить Teacher (только Super Admin)
   
✅ Аналитика и статистика:
   - Дашборд
   - Отчеты
   
❌ НЕ может:
   - Управлять другими Admin
   - Изменять роли пользователей на Admin
   - Удалять преподавателей
   - Доступ к системным настройкам
```

**UI:**
- Видит полную админ-панель (как сейчас)
- Раздел "Преподаватели" (создание/редактирование)
- Не видит раздел "Администраторы"

---

#### 3️⃣ SALES MANAGER (Менеджер по продажам)
**Роль:** `sales_manager`
**Количество:** Несколько (отдел продаж)

**Права доступа:**
```
✅ Управление заявками:
   - Просмотр всех заявок
   - Изменение статусов (new → processed → enrolled)
   - Создание заявок
   - Конвертация в учеников
   - Звонки клиентам
   
✅ Просмотр учеников:
   - Список всех учеников
   - Контакты учеников (для звонков о продлении)
   - Статус абонемента (когда истекает)
   - Группы ученика
   
✅ Просмотр групп:
   - Список всех групп
   - Расписание групп
   - Количество мест в группах
   - Для консультирования клиентов
   
✅ Запись на пробное занятие:
   - Создание пробного абонемента
   - Добавление ученика в группу
   
❌ НЕ может:
   - Видеть платежи и финансы
   - Подтверждать оплаты
   - Создавать/удалять группы
   - Создавать полные абонементы (месяц/3 месяца)
   - Управлять преподавателями
   - Видеть полную историю платежей
   - Удалять учеников
   - Редактировать абонементы
   - Доступ к аналитике и отчетам
```

**UI:**
- Упрощенная панель продаж
- Разделы:
  1. Заявки (с фильтрами)
  2. Ученики (только контакты и статус абонемента)
  3. Группы (просмотр для консультаций)
  4. Пробные занятия

**Задачи Sales Manager:**
- Обработка входящих заявок
- Звонки новым клиентам
- Консультирование по направлениям
- Запись на пробное занятие
- Звонки текущим ученикам о продлении
- Работа с "теплыми" лидами

---

#### 4️⃣ TEACHER (Преподаватель)
**Роль:** `teacher`
**Количество:** Несколько (инструкторы студии)

**Права доступа:**
```
✅ Просмотр СВОИХ групп:
   - Список своих групп
   - Расписание своих групп
   - Список учеников в своих группах
   
✅ Управление посещаемостью:
   - Отметка посещений в своих группах
   - Просмотр истории посещений
   
✅ Просмотр учеников:
   - Только учеников из своих групп
   - Контакты учеников
   - Статус абонементов (для информации)
   
✅ Практики:
   - Просмотр практик по своему направлению
   - Список записавшихся
   
❌ НЕ может:
   - Видеть другие группы
   - Видеть всех учеников
   - Создавать/удалять группы
   - Управлять абонементами
   - Управлять платежами
   - Создавать учеников
   - Видеть заявки
   - Доступ к финансам
```

**UI:**
- Упрощенная панель преподавателя
- Разделы:
  1. Мои группы
  2. Расписание
  3. Посещаемость
  4. Ученики (только из своих групп)

---

#### 5️⃣ STUDENT (Ученик)
**Роль:** `student`
**Количество:** Неограниченно

**Права доступа:**
```
✅ Личный кабинет:
   - Просмотр своих данных
   - Редактирование профиля
   - Изменение пароля
   
✅ Мои группы:
   - Просмотр своих 2 групп
   - Расписание
   - Информация о преподавателе
   
✅ Мой абонемент:
   - Статус абонемента
   - Остаток занятий
   - Заморозки (2 в месяц)
   - Заморозить занятие
   
✅ Практики:
   - Просмотр предстоящих практик
   - Запись на практику
   - Отмена записи
   
✅ История:
   - История посещений
   - История платежей
   
❌ НЕ может:
   - Видеть других учеников
   - Видеть финансы студии
   - Доступ к админке
```

**UI:**
- Личный кабинет ученика (как сейчас реализовано)

---

### 🔐 MIDDLEWARE ДЛЯ ПРОВЕРКИ ПРАВ:

```javascript
// backend/src/middleware/auth.js

// Базовая проверка авторизации
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  req.user = decoded;
  next();
};

// Только для Super Admin
const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Доступ запрещен: только для Super Admin' });
  }
  next();
};

// Для Admin и Super Admin
const requireAdmin = (req, res, next) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Доступ запрещен: только для администраторов' });
  }
  next();
};

// Для Sales Manager, Admin и Super Admin
const requireSalesOrAdmin = (req, res, next) => {
  if (!['sales_manager', 'admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Доступ запрещен: только для менеджеров и администраторов' });
  }
  next();
};

// Для Teacher, Admin и Super Admin
const requireTeacherOrAdmin = (req, res, next) => {
  if (!['teacher', 'admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }
  next();
};

// Для всех авторизованных
const requireAuth = authenticate;

module.exports = {
  authenticate,
  requireSuperAdmin,
  requireAdmin,
  requireSalesOrAdmin,
  requireTeacherOrAdmin,
  requireAuth
};
```

---

### 📋 API ENDPOINTS С ПРОВЕРКОЙ ПРАВ:

#### USERS / STUDENTS
```
POST   /api/students                    [requireSalesOrAdmin] - Создать ученика
GET    /api/students                    [requireSalesOrAdmin] - Все ученики (sales видит только контакты)
GET    /api/students/:id                [requireAuth]         - Один ученик (свой или если админ/sales)
PATCH  /api/students/:id                [requireAuth]         - Обновить (свой или если админ)
DELETE /api/students/:id                [requireAdmin]        - Удалить ученика (только Admin)

POST   /api/students/:id/change-role    [requireSuperAdmin]   - Изменить роль (только Super Admin)
```

#### ADMINS (УПРАВЛЕНИЕ АДМИНИСТРАТОРАМИ)
```
GET    /api/admins                      [requireSuperAdmin]   - Список админов
POST   /api/admins                      [requireSuperAdmin]   - Создать админа
DELETE /api/admins/:id                  [requireSuperAdmin]   - Удалить админа
PATCH  /api/admins/:id/demote           [requireSuperAdmin]   - Понизить до student
```

#### SALES MANAGERS (УПРАВЛЕНИЕ МЕНЕДЖЕРАМИ)
```
GET    /api/sales-managers              [requireSuperAdmin]   - Список менеджеров
POST   /api/sales-managers              [requireSuperAdmin]   - Создать менеджера
DELETE /api/sales-managers/:id          [requireSuperAdmin]   - Удалить менеджера
PATCH  /api/sales-managers/:id/demote   [requireSuperAdmin]   - Понизить до student
```

#### TEACHERS (УПРАВЛЕНИЕ ПРЕПОДАВАТЕЛЯМИ)
```
GET    /api/teachers                    [requireAdmin]        - Список преподавателей
POST   /api/teachers                    [requireAdmin]        - Создать преподавателя
PATCH  /api/teachers/:id                [requireAdmin]        - Редактировать
DELETE /api/teachers/:id                [requireSuperAdmin]   - Удалить (только Super Admin)
POST   /api/teachers/:id/assign-group   [requireAdmin]        - Назначить группу
DELETE /api/teachers/:id/remove-group   [requireAdmin]        - Убрать группу
```

#### GROUPS
```
GET    /api/groups                      [requireAuth]         - Все группы (с фильтрацией по роли)
GET    /api/groups/:id                  [requireAuth]         - Одна группа
GET    /api/groups/:id/students         [requireTeacherOrAdmin] - Ученики группы
POST   /api/groups                      [requireAdmin]        - Создать группу
PATCH  /api/groups/:id                  [requireAdmin]        - Обновить
DELETE /api/groups/:id                  [requireAdmin]        - Удалить
```

#### BOOKINGS
```
POST   /api/bookings                    [public]              - Создать заявку (с сайта)
GET    /api/bookings                    [requireSalesOrAdmin] - Список заявок
PATCH  /api/bookings/:id/status         [requireSalesOrAdmin] - Изменить статус
POST   /api/bookings/create-admin       [requireSalesOrAdmin] - Создать заявку
POST   /api/bookings/:id/convert        [requireSalesOrAdmin] - Конвертировать в ученика
```

#### MEMBERSHIPS
```
GET    /api/memberships                 [requireAdmin]        - Все абонементы
GET    /api/memberships/:id             [requireAuth]         - Один абонемент
POST   /api/memberships/trial           [requireSalesOrAdmin] - Создать пробное занятие
POST   /api/memberships                 [requireAdmin]        - Создать абонемент (только Admin)
PATCH  /api/memberships/:id             [requireAdmin]        - Обновить
GET    /api/memberships/:id/freeze-info [requireAuth]         - Сколько заморозок осталось
POST   /api/memberships/:id/freeze      [requireAuth]         - Заморозить занятие
```

#### ATTENDANCE (ПОСЕЩАЕМОСТЬ)
```
GET    /api/attendance/group/:id        [requireTeacherOrAdmin] - Посещаемость группы
POST   /api/attendance/mark             [requireTeacherOrAdmin] - Отметить посещение
GET    /api/attendance/student/:id      [requireAuth]         - История ученика (свои или если админ)
```

---

### 🎨 UI/UX ДЛЯ КАЖДОЙ РОЛИ:

#### SUPER ADMIN - Видит:
```
АДМИН-ПАНЕЛЬ:
├── 📊 Дашборд (полная статистика)
├── 📝 Заявки
├── 👥 Ученики
├── 👨‍💼 Преподаватели ⭐ (управление)
├── 🔑 Администраторы ⭐ (управление)
├── 👥 Группы
├── 💳 Абонементы
├── 🎯 Практики
├── 💰 Платежи
├── 📈 Аналитика
└── ⚙️ Настройки ⭐
```

#### ADMIN - Видит:
```
АДМИН-ПАНЕЛЬ:
├── 📊 Дашборд
├── 📝 Заявки
├── 👥 Ученики
├── 👨‍💼 Преподаватели (создание/редактирование)
├── 💼 Менеджеры (создание/редактирование)
├── 👥 Группы
├── 💳 Абонементы
├── 🎯 Практики
├── 💰 Платежи
└── 📈 Аналитика
```

#### SALES MANAGER - Видит:
```
ПАНЕЛЬ ПРОДАЖ:
├── 📝 Заявки (полное управление)
├── 👥 Ученики (только контакты и статус абонемента)
├── 👥 Группы (просмотр для консультаций)
└── 🎫 Пробные занятия
```

#### TEACHER - Видит:
```
ПАНЕЛЬ ПРЕПОДАВАТЕЛЯ:
├── 📊 Мои группы
├── 📅 Расписание
├── ✅ Посещаемость
├── 👥 Ученики (только из моих групп)
└── 🎯 Практики (мои направления)
```

#### STUDENT - Видит:
```
ЛИЧНЫЙ КАБИНЕТ:
├── 👤 Мой профиль
├── 👥 Мои группы
├── 💳 Мой абонемент
├── 🎯 Практики
└── 📜 История посещений
```

---

### 📝 ФОРМА СОЗДАНИЯ ПОЛЬЗОВАТЕЛЕЙ В АДМИНКЕ:

#### Создание Ученика:
```
[Добавить ученика]

Форма:
- Имя: _______
- Телефон: _______
- Email: _______ (опционально)
- Дата рождения: _______ (опционально)
- Пароль: [Сгенерировать автоматически] ✅

Роль: Student (не меняется при создании)

[Создать] [Отмена]
```

#### Создание Преподавателя (Admin):
```
[Добавить преподавателя]

Форма:
- Имя: _______
- Телефон: _______
- Email: _______
- Направления: [☐ K-pop] [☐ Bachata] [☐ High heels] ...
- Био: _______
- Фото: [Загрузить]
- Пароль: [Сгенерировать] ✅

Роль: Teacher (автоматически)

[Создать] [Отмена]
```

#### Создание Менеджера по продажам (Super Admin или Admin):
```
[Добавить менеджера]

Форма:
- Имя: _______
- Телефон: _______
- Email: _______
- Пароль: [Сгенерировать] ✅

Роль: Sales Manager (автоматически)

ℹ️ Менеджер сможет работать с заявками и консультировать клиентов

[Создать] [Отмена]
```

#### Создание Администратора (Super Admin):
```
[Добавить администратора] ⭐

Форма:
- Имя: _______
- Телефон: _______
- Email: _______
- Пароль: [Сгенерировать] ✅

Роль: Admin (автоматически)

⚠️ Администратор получит полный доступ к управлению студией

[Создать] [Отмена]
```

#### Изменение роли пользователя:
```
В карточке пользователя:

Роль: Student [▼]
  ├── Student
  ├── Sales Manager  (только Super Admin/Admin)
  ├── Teacher        (только Super Admin/Admin)
  └── Admin ⭐        (только Super Admin)

При выборе Sales Manager:
ℹ️ Пользователь получит доступ к заявкам и ученикам
[Да, изменить] [Отмена]

При выборе Teacher:
ℹ️ Пользователь станет преподавателем. Не забудьте назначить группы.
[Да, изменить] [Отмена]

При выборе Admin:
⚠️ Вы уверены? Этот пользователь получит права администратора.
[Да, повысить] [Отмена]
```

---

### 🔔 УВЕДОМЛЕНИЯ В TELEGRAM:

```
При создании Admin:
"🔑 Создан новый администратор: Имя (+7 700 000 00 00)"

При удалении Admin:
"⚠️ Удален администратор: Имя (+7 700 000 00 00)"

При создании Sales Manager:
"💼 Добавлен менеджер по продажам: Имя (+7 700 000 00 00)"

При создании Teacher:
"👨‍🏫 Добавлен новый преподаватель: Имя - K-pop, Bachata"

При изменении роли:
"🔄 Имя: Student → Admin"
"🔄 Имя: Student → Sales Manager"
"🔄 Имя: Sales Manager → Teacher"
```

---

### 🛡️ БЕЗОПАСНОСТЬ:

#### Правила:
1. **Super Admin не может:**
   - Удалить себя
   - Изменить свою роль
   - Понизить себя

2. **Admin не может:**
   - Создать другого Admin
   - Изменить роль на Admin
   - Удалить Admin
   - Удалять Teacher (только Super Admin)
   - Изменить свою роль

3. **Sales Manager не может:**
   - Видеть финансы и полную историю платежей
   - Подтверждать оплаты
   - Создавать полные абонементы (только пробные)
   - Удалять учеников
   - Создавать/удалять группы
   - Управлять преподавателями
   - Менять свою роль

4. **Teacher не может:**
   - Видеть финансы
   - Видеть других преподавателей
   - Создавать группы
   - Видеть заявки
   - Видеть учеников не из своих групп

5. **Student не может:**
   - Видеть других учеников
   - Менять свою роль
   - Доступ к админке

---

## 📅 ЭТАП 3: БАЗОВЫЙ API (3 дня)

**Статус:** ⏳ Не начато

### Задачи:

- [ ] 3.1 Настроить Express сервер
- [ ] 3.2 Настроить CORS
- [ ] 3.3 Подключить MongoDB
- [ ] 3.4 Создать роуты для заявок (CRUD)
- [ ] 3.5 Создать роуты для учеников (CRUD)
- [ ] 3.6 Создать роуты для групп (CRUD)
- [ ] 3.7 Создать роуты для абонементов
- [ ] 3.8 Создать роуты для практик
- [ ] 3.9 Интегрировать Telegram уведомления
- [ ] 3.10 Тестирование API через Postman

### API Endpoints:

#### BOOKINGS (Заявки)
```
POST   /api/bookings                    - Создать заявку (с сайта)
GET    /api/bookings                    - Список (админ)
GET    /api/bookings?status=new         - Фильтр по статусу
PATCH  /api/bookings/:id/status         - Изменить статус
POST   /api/bookings/create-admin       - Админ создает заявку
DELETE /api/bookings/:id                - Удалить
```

#### STUDENTS (Ученики)
```
GET    /api/students                    - Все ученики (админ)
GET    /api/students/:id                - Один ученик
POST   /api/students                    - Создать ученика (админ)
PATCH  /api/students/:id                - Обновить данные
DELETE /api/students/:id                - Удалить
POST   /api/students/:id/add-group      - Добавить в группу
DELETE /api/students/:id/remove-group   - Убрать из группы
```

#### GROUPS (Группы)
```
GET    /api/groups                      - Все группы
GET    /api/groups/:id                  - Одна группа
GET    /api/groups/:id/students         - Ученики группы
POST   /api/groups                      - Создать группу (админ)
PATCH  /api/groups/:id                  - Обновить расписание
DELETE /api/groups/:id                  - Удалить группу
```

#### MEMBERSHIPS (Абонементы)
```
GET    /api/memberships                 - Все абонементы
GET    /api/memberships/:id             - Один абонемент
POST   /api/memberships                 - Создать абонемент
PATCH  /api/memberships/:id             - Обновить
GET    /api/memberships/:id/freeze-info - Сколько заморозок осталось
POST   /api/memberships/:id/freeze      - Заморозить занятие
```

#### PRACTICES (Практики)
```
GET    /api/practices                   - Все практики
GET    /api/practices/upcoming          - Предстоящие
POST   /api/practices                   - Создать (админ)
POST   /api/practices/:id/attend        - Записаться
DELETE /api/practices/:id/cancel        - Отменить запись
GET    /api/practices/:id/attendees     - Кто записался
```

#### PAYMENTS (Платежи)
```
POST   /api/payments/create             - Создать счет
POST   /api/payments/:id/confirm-manual - Подтвердить вручную (админ)
GET    /api/payments/:id                - Статус платежа
GET    /api/payments/student/:id        - История платежей ученика
```

---

## 📅 ЭТАП 4: АВТОРИЗАЦИЯ (2 дня)

**Статус:** ⏳ Не начато

### Задачи:

- [ ] 4.1 Настроить bcrypt для хеширования паролей
- [ ] 4.2 Создать JWT токены (access + refresh)
- [ ] 4.3 Middleware для проверки авторизации
- [ ] 4.4 Middleware для проверки ролей (admin only)
- [ ] 4.5 API endpoints авторизации
- [ ] 4.6 Защитить роуты (только для админа/ученика)
- [ ] 4.7 Тестирование авторизации

### Auth API:
```
POST /api/auth/register     - Регистрация ученика
POST /api/auth/login        - Вход (phone + password)
POST /api/auth/logout       - Выход
GET  /api/auth/me           - Текущий пользователь
POST /api/auth/refresh      - Обновить токен
```

---

## 📅 ЭТАП 5: ИНТЕГРАЦИЯ TELEGRAM (1 день)

**Статус:** ⏳ Не начато

### Задачи:

- [ ] 5.1 Перенести Telegram функции в backend
- [ ] 5.2 Уведомления при новой заявке
- [ ] 5.3 Уведомление при регистрации ученика
- [ ] 5.4 Уведомление об истечении абонемента
- [ ] 5.5 Напоминания о практиках

---

## 📅 ЭТАП 6: ЛИЧНЫЙ КАБИНЕТ - FRONTEND (3 дня)

**Статус:** ⏳ Не начато

### Задачи:

- [ ] 6.1 Создать страницу /login.html (вход)
- [ ] 6.2 Создать страницу /register.html (регистрация)
- [ ] 6.3 Создать страницу /profile.html (личный кабинет)
- [ ] 6.4 Подключить API к формам
- [ ] 6.5 Сохранение JWT токена в localStorage
- [ ] 6.6 Защита страниц (редирект если не залогинен)
- [ ] 6.7 Отображение групп ученика
- [ ] 6.8 Отображение абонемента и заморозок
- [ ] 6.9 Функция заморозки занятия
- [ ] 6.10 Список ближайших занятий по расписанию
- [ ] 6.11 Запись на практики
- [ ] 6.12 История посещений

### Что увидит ученик в профиле:
```
МОЙ ПРОФИЛЬ
├── Личные данные (редактирование)
├── Мои группы (2 группы макс):
│   ├── Название группы
│   ├── Направление
│   ├── Расписание
│   └── Преподаватель
├── Мой абонемент:
│   ├── Активен до
│   ├── Заморозок осталось: X/2
│   └── [Заморозить занятие]
├── Ближайшие занятия (из расписания групп)
├── Практики:
│   ├── Предстоящие практики
│   └── [Записаться] кнопки
└── История посещений
```

---

## 📅 ЭТАП 7: АДМИН-ПАНЕЛЬ (4 дня)

**Статус:** ⏳ Не начато

### Задачи:

- [ ] 7.1 Создать /admin/index.html (дашборд)
- [ ] 7.2 Дашборд со статистикой
- [ ] 7.3 Раздел "Заявки":
  - [ ] Список заявок
  - [ ] Фильтры по статусу
  - [ ] Изменение статуса
  - [ ] Создание заявки админом
  - [ ] Конвертация в ученика
- [ ] 7.4 Раздел "Ученики":
  - [ ] Таблица учеников
  - [ ] Поиск по имени/телефону
  - [ ] Карточка ученика
  - [ ] Добавление/удаление из групп
  - [ ] История посещений
- [ ] 7.5 Раздел "Группы":
  - [ ] Список групп
  - [ ] Создание группы
  - [ ] Редактирование расписания
  - [ ] Список учеников группы
  - [ ] Статистика по группам
- [ ] 7.6 Раздел "Абонементы":
  - [ ] Создание абонемента
  - [ ] Продление
  - [ ] История заморозок
  - [ ] Истекающие абонементы (уведомления)
- [ ] 7.7 Раздел "Практики":
  - [ ] Создание практики
  - [ ] Список записавшихся
  - [ ] Отметка посещения
- [ ] 7.8 Раздел "Платежи":
  - [ ] Ручное подтверждение (Kaspi/наличные)
  - [ ] История платежей
  - [ ] Отчеты по доходам
- [ ] 7.9 Раздел "Аналитика":
  - [ ] Статистика по направлениям
  - [ ] Графики посещаемости
  - [ ] Доход по месяцам

---

## 📅 ЭТАП 8: СИСТЕМА ОПЛАТЫ (2 дня)

**Статус:** ⏳ Не начато

### Задачи ФАЗА 1 (Сейчас):

- [ ] 8.1 UI для выбора способа оплаты
- [ ] 8.2 Инструкции по оплате Kaspi
- [ ] 8.3 Ручное подтверждение оплаты админом
- [ ] 8.4 Генерация чека (PDF)
- [ ] 8.5 Отправка чека на email/Telegram

### Методы оплаты ФАЗА 1:
```
1. 📱 Kaspi переводы:
   - Показываем номер телефона
   - Ученик переводит
   - Пишет админу
   - Админ подтверждает в админке
   
2. 💵 Наличные:
   - Ученик платит в студии
   - Админ сразу активирует в системе
```

### Задачи ФАЗА 2 (Через 3-6 месяцев):

- [ ] 8.6 Регистрация в Kaspi Pay (business.kaspi.kz)
- [ ] 8.7 Получение API ключей Kaspi
- [ ] 8.8 Интеграция Kaspi Pay API
- [ ] 8.9 Генерация QR кодов автоматически
- [ ] 8.10 Webhook для автоподтверждения
- [ ] 8.11 Интеграция CloudPayments (карты)
- [ ] 8.12 Автоматические чеки

---

## 📅 ЭТАП 9: ДЕПЛОЙ (2 дня)

**Статус:** ⏳ Не начато

### Задачи:

- [ ] 9.1 Настроить MongoDB Atlas production кластер
- [ ] 9.2 Подготовить backend к деплою
- [ ] 9.3 Создать аккаунт на Railway.app
- [ ] 9.4 Задеплоить backend на Railway
- [ ] 9.5 Настроить переменные окружения
- [ ] 9.6 Подключить frontend к production API
- [ ] 9.7 Задеплоить frontend на Netlify
- [ ] 9.8 Настроить custom domain (опционально)
- [ ] 9.9 Настроить HTTPS
- [ ] 9.10 Тестирование в production

---

## 📅 ЭТАП 10: ТЕСТИРОВАНИЕ И ДОКУМЕНТАЦИЯ (1 день)

**Статус:** ⏳ Не начато

### Задачи:

- [ ] 10.1 Полное тестирование всех функций
- [ ] 10.2 Создать API документацию
- [ ] 10.3 Создать инструкции для админа
- [ ] 10.4 Создать инструкции для учеников
- [ ] 10.5 Видео-гайд по админке

---

## 💰 ПЛАТЕЖНЫЕ СИСТЕМЫ - ДЕТАЛИ

### 📱 KASPI PAY - КАК ПОДКЛЮЧИТЬ:

#### Шаг 1: Регистрация бизнеса
```
1. Открыть business.kaspi.kz
2. Зарегистрировать ИП или ТОО
3. Загрузить документы:
   - Свидетельство о регистрации
   - БИН
   - Паспорт
4. Ждать одобрения (1-5 дней)
```

#### Шаг 2: Подключение Kaspi Pay
```
1. В личном кабинете: Сервисы → Kaspi Pay
2. Заполнить заявку на подключение
3. Указать:
   - Сайт
   - Описание бизнеса
   - Callback URL для webhook
4. Ждать одобрения (1-2 недели)
5. Получить API ключи:
   - Client ID
   - Client Secret
   - Merchant ID
```

#### Шаг 3: Интеграция
```javascript
// Создание платежа
const kaspiPayment = await axios.post('https://api.kaspi.kz/v1/payments', {
  amount: 22000,
  currency: 'KZT',
  orderId: generateOrderId(),
  description: 'Абонемент месяц - Sense of Dance',
  returnUrl: 'https://senseofdance.kz/payment/success',
  failUrl: 'https://senseofdance.kz/payment/fail'
}, {
  headers: {
    'Authorization': `Bearer ${KASPI_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

// Получаем:
{
  paymentId: "KSP123456",
  qrCode: "data:image/png;base64...",
  paymentUrl: "kaspi://payment?id=KSP123456"
}

// Показываем QR ученику
// Когда оплатит - Kaspi отправит webhook
```

#### Шаг 4: Webhook
```javascript
router.post('/api/payments/kaspi-webhook', async (req, res) => {
  const { paymentId, status, amount } = req.body;
  
  // Проверяем подпись от Kaspi (безопасность)
  if (!verifyKaspiSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  if (status === 'SUCCESS') {
    // Находим платеж в нашей БД
    const payment = await Payment.findOne({ kaspiPaymentId: paymentId });
    
    // Активируем абонемент!
    await activateMembership(payment.membership);
    
    // Отправляем уведомление ученику
    await sendTelegramNotification(payment.student, 'Оплата прошла! Абонемент активен!');
  }
  
  res.json({ success: true });
});
```

---

### 💳 ДРУГИЕ МЕТОДЫ ОПЛАТЫ:

#### 1. CloudPayments (карты Visa/Mastercard)
```
ПОДКЛЮЧЕНИЕ:
1. Регистрация на cloudpayments.kz
2. Заполнить заявку
3. Предоставить документы ИП/ТОО
4. Получить Public ID и API Secret
5. Интеграция 1-2 дня

КОМИССИЯ: 2.8-3.5%

КОД:
const widget = new cp.CloudPayments();
widget.pay('charge', {
  amount: 22000,
  currency: 'KZT',
  description: 'Абонемент'
});
```

#### 2. PayBox (казахстанская)
```
ПОДКЛЮЧЕНИЕ:
1. Регистрация на paybox.money
2. Подключение ИП/ТОО
3. Получить Merchant ID и Secret Key
4. API интеграция

КОМИССИЯ: ~2%
МЕТОДЫ: Kaspi, карты, e-wallet
```

#### 3. Stripe (международная)
```
ПОДКЛЮЧЕНИЕ:
1. stripe.com
2. Верификация бизнеса
3. Получить API ключи

КОМИССИЯ: 2.9% + $0.30
ПЛЮС: Работает везде, отличное API
МИНУС: Для международных платежей
```

---

## 💡 РЕАЛИЗАЦИЯ ЛОГИКИ ЗАНЯТИЙ В КОДЕ:

### Создание абонемента:
```javascript
async function createMembership(studentId, type) {
  const classesCount = {
    'trial': 1,
    'monthly': 8,
    '3months': 24
  };
  
  const student = await Student.findById(studentId);
  const existingMembership = await Membership.findOne({ 
    student: studentId, 
    status: 'active' 
  });
  
  // Если есть активный абонемент с остатком
  const remainingClasses = existingMembership 
    ? existingMembership.classesRemaining 
    : 0;
  
  const newMembership = await Membership.create({
    student: studentId,
    type: type,
    classesTotal: classesCount[type],
    classesRemaining: classesCount[type] + remainingClasses, // СУММИРУЕМ!
    classesUsed: 0,
    startDate: new Date(),
    status: 'active'
  });
  
  // Рассчитываем endDate на основе расписания групп
  const endDate = calculateEndDate(student.groups, newMembership.classesRemaining);
  newMembership.endDate = endDate;
  await newMembership.save();
  
  return newMembership;
}
```

### Автоматическое списание занятий:
```javascript
// Cron job или scheduled task
async function processClassAttendance() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const currentTime = today.getHours() * 60 + today.getMinutes();
  
  // Находим все группы с занятиями сегодня
  const groups = await Group.find({
    'schedule.dayOfWeek': dayOfWeek,
    isActive: true
  });
  
  for (const group of groups) {
    // Проверяем время занятия
    const classSchedule = group.schedule.find(s => s.dayOfWeek === dayOfWeek);
    const classTime = parseTime(classSchedule.time);
    
    // Если занятие началось (прошло 10 минут)
    if (currentTime >= classTime + 10) {
      // Находим всех учеников этой группы
      const students = await Student.find({
        'groups.groupId': group._id,
        'groups.status': 'active'
      });
      
      for (const student of students) {
        const membership = await Membership.findOne({
          student: student._id,
          status: 'active'
        });
        
        if (membership && membership.classesRemaining > 0) {
          // Проверяем, не заморожено ли это занятие
          const isFrozen = membership.freezesUsed.some(freeze => 
            isSameDay(freeze.classDate, today) && 
            freeze.group.equals(group._id)
          );
          
          if (!isFrozen) {
            // Списываем занятие
            membership.classesRemaining--;
            membership.classesUsed++;
            
            // Создаем запись о посещении
            await Attendance.create({
              student: student._id,
              group: group._id,
              date: today,
              attended: true,
              type: 'regular'
            });
            
            await membership.save();
            
            // Если осталось 1 занятие - отправляем уведомление
            if (membership.classesRemaining === 1) {
              await sendNotification(student, 'Осталось последнее занятие! Пора продлить абонемент.');
            }
            
            // Если закончились занятия
            if (membership.classesRemaining === 0) {
              membership.status = 'expired';
              await membership.save();
              await sendNotification(student, 'Абонемент истек. Продлите для продолжения занятий.');
            }
          }
        }
      }
    }
  }
}
```

### Продление абонемента:
```javascript
async function renewMembership(studentId, newType) {
  const currentMembership = await Membership.findOne({
    student: studentId,
    status: 'active'
  });
  
  const classesCount = {
    'trial': 1,
    'monthly': 8,
    '3months': 24
  };
  
  // Если есть остаток - суммируем
  const remainingClasses = currentMembership 
    ? currentMembership.classesRemaining 
    : 0;
  
  const newClassesTotal = classesCount[newType] + remainingClasses;
  
  // Деактивируем старый
  if (currentMembership) {
    currentMembership.status = 'expired';
    await currentMembership.save();
  }
  
  // Создаем новый с суммой
  const newMembership = await Membership.create({
    student: studentId,
    type: newType,
    classesTotal: classesCount[newType],
    classesRemaining: newClassesTotal, // ВАЖНО: сумма!
    classesUsed: 0,
    startDate: new Date(),
    status: 'active'
  });
  
  return newMembership;
}
```

### Расчет даты окончания:
```javascript
function calculateEndDate(groups, classesRemaining) {
  // Получаем все дни занятий в неделю
  const classDays = [];
  for (const group of groups) {
    for (const schedule of group.schedule) {
      if (!classDays.includes(schedule.dayOfWeek)) {
        classDays.push(schedule.dayOfWeek);
      }
    }
  }
  
  // Сортируем дни
  classDays.sort((a, b) => a - b);
  
  // Считаем сколько занятий в неделю
  const classesPerWeek = classDays.length;
  
  // Считаем сколько недель нужно
  const weeksNeeded = Math.ceil(classesRemaining / classesPerWeek);
  
  // Добавляем недели к текущей дате
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + (weeksNeeded * 7));
  
  return endDate;
}
```

---

## 🎯 ПРИОРИТЕТЫ РАЗРАБОТКИ:

### MVP (10 дней) - СДЕЛАТЬ В ПЕРВУЮ ОЧЕРЕДЬ:

**✅ ОБЯЗАТЕЛЬНО:**
1. Заявки с статусами (new/processed/enrolled/rejected)
2. Создание заявок админом
3. Группы с расписанием
4. Ученик в 2 группах
5. Абонементы с заморозкой (2 занятия/месяц)
6. Ручное подтверждение оплаты
7. Практики (запись учеников)
8. Базовый личный кабинет
9. Базовая админка

**⏳ МОЖНО ПОЗЖЕ:**
1. Автоматическая оплата (Kaspi API)
2. Email уведомления
3. Продвинутая аналитика
4. Экспорт в Excel
5. Мобильное приложение

---

## 📊 ПРОГРЕСС ТРЕКЕР:

### Общий прогресс: 0% ⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜

- [ ] Этап 1: Настройка окружения (0/6)
- [ ] Этап 2: MongoDB модели (0/10)
- [ ] Этап 3: Базовый API (0/10)
- [ ] Этап 4: Авторизация (0/7)
- [ ] Этап 5: Telegram интеграция (0/5)
- [ ] Этап 6: Личный кабинет (0/12)
- [ ] Этап 7: Админ-панель (0/9 разделов)
- [ ] Этап 8: Оплата (0/5 базовых)
- [ ] Этап 9: Деплой (0/10)
- [ ] Этап 10: Тестирование (0/5)

---

## 🔮 БУДУЩИЕ ФИЧИ (ФАЗА 2):

### После MVP (месяц 2-3):

- [ ] Kaspi Pay API автоматизация
- [ ] CloudPayments интеграция
- [ ] Email рассылки
- [ ] SMS напоминания
- [ ] Push уведомления
- [ ] Мобильное приложение (React Native)
- [ ] QR коды для check-in на занятиях
- [ ] Видео-уроки в личном кабинете
- [ ] Чат ученик-преподаватель
- [ ] Онлайн трансляции занятий
- [ ] Программы тренировок
- [ ] Достижения и бейджи
- [ ] Реферальная программа
- [ ] Интеграция с Instagram (автопостинг)

---

## 📝 CHANGELOG

### 2025-10-08
- ✅ Создан BACKEND-PLAN.md
- ✅ Определены все модели БД
- ✅ Спланированы API endpoints
- ✅ Выбран стек: Node.js + Express + MongoDB Atlas
- ✅ Определена стратегия оплаты (старт с ручного подтверждения)

---

## 🎯 СЛЕДУЮЩИЕ ШАГИ:

1. **Начать Этап 1** - Настройка окружения
2. Создать структуру папок backend/
3. Инициализировать npm проект
4. Установить зависимости
5. Подключить MongoDB Atlas

---

**Последнее обновление:** 8 октября 2025  
**Статус проекта:** 🟡 Планирование завершено, готовы к разработке
