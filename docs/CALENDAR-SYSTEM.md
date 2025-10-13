# 📅 Система Календаря и Расписания

## Описание

Визуальный календарь с drag & drop для управления расписанием занятий преподавателями.

---

## 🎯 Функционал

### Для Преподавателей:
- ✅ Визуальный календарь (месяц/неделя/день)
- ✅ Создание занятий drag & drop
- ✅ Перенос занятий перетаскиванием
- ✅ Повторяющиеся занятия (еженедельно)
- ✅ Отметка посещаемости
- ✅ Отмена занятий

### Для Админов:
- ✅ Просмотр календаря всех преподавателей
- ✅ Создание/редактирование любых занятий
- ✅ Фильтрация по преподавателям/группам

---

## 🗄️ База данных

### Модель Class (занятие):

```javascript
{
  group: ObjectId (ссылка на Group),
  teacher: ObjectId (ссылка на Student),
  title: String,                      // "K-pop Начинающие - K-pop"
  date: Date,                         // 2025-10-15
  startTime: String,                  // "18:00"
  endTime: String,                    // "19:30"
  duration: Number,                   // 90 минут
  status: "scheduled" | "completed" | "cancelled",
  isRecurring: Boolean,               // Повторяющееся?
  recurringRule: {
    frequency: "daily" | "weekly" | "monthly" | "none",
    daysOfWeek: [1, 3, 5],           // Пн, Ср, Пт
    endDate: Date                     // До какой даты
  },
  attendees: [{
    student: ObjectId,
    attended: Boolean,
    markedAt: Date
  }],
  notes: String,
  backgroundColor: String,            // Цвет в календаре
  createdBy: ObjectId
}
```

---

## 🔌 API Endpoints

### GET `/api/classes`
**Доступ:** Teacher, Admin  
**Описание:** Получить занятия с фильтрами  
**Query параметры:**
- `start` - начальная дата (ISO 8601)
- `end` - конечная дата
- `teacherId` - ID преподавателя (только для админа)
- `groupId` - ID группы

**Пример:**
```
GET /api/classes?start=2025-10-01&end=2025-10-31&teacherId=123
```

**Ответ:**
```json
{
  "success": true,
  "count": 24,
  "classes": [...]
}
```

---

### POST `/api/classes`
**Доступ:** Teacher, Admin  
**Описание:** Создать занятие (одиночное или повторяющееся)  
**Body:**
```json
{
  "groupId": "abc123",
  "date": "2025-10-15",
  "startTime": "18:00",
  "endTime": "19:30",
  "duration": 90,
  "isRecurring": true,
  "recurringRule": {
    "frequency": "weekly",
    "daysOfWeek": [1, 3],
    "endDate": "2026-01-15"
  },
  "notes": "Пробное занятие"
}
```

**Логика повторяющихся занятий:**
- Система автоматически создаст занятия на все указанные дни до `endDate`
- Например: каждый Пн и Ср с 15.10.2025 до 15.01.2026

---

### PATCH `/api/classes/:id`
**Доступ:** Teacher, Admin  
**Описание:** Обновить занятие (перенести, изменить время)  
**Body:**
```json
{
  "date": "2025-10-16",
  "startTime": "19:00",
  "endTime": "20:30",
  "status": "cancelled",
  "notes": "Перенесено из-за праздника"
}
```

**Используется для:**
- Drag & drop (изменение даты/времени)
- Отмена занятия
- Добавление заметок

---

### DELETE `/api/classes/:id`
**Доступ:** Teacher, Admin  
**Описание:** Удалить занятие

---

### POST `/api/classes/:id/attendance`
**Доступ:** Teacher, Admin  
**Описание:** Отметить посещаемость ученика  
**Body:**
```json
{
  "studentId": "student123",
  "attended": true
}
```

---

## 🎨 Frontend (FullCalendar.js)

### Подключение библиотеки:

```html
<!-- FullCalendar CSS -->
<link href='https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.css' rel='stylesheet' />

<!-- FullCalendar JS -->
<script src='https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js'></script>
```

### Инициализация календаря:

```javascript
const calendar = new FullCalendar.Calendar(calendarEl, {
  initialView: 'dayGridMonth',
  locale: 'ru',
  headerToolbar: {
    left: 'prev,next today',
    center: 'title',
    right: 'dayGridMonth,timeGridWeek,timeGridDay'
  },
  editable: true,
  droppable: true,
  events: fetchClasses,  // Загрузка из API
  eventDrop: handleEventDrop,  // Drag & drop
  eventClick: handleEventClick,  // Клик по занятию
  dateClick: handleDateClick  // Создание нового занятия
});
```

---

## 🎯 UI/UX для Преподавателя

### Вкладка "Расписание":

```
┌──────────────────────────────────────────────┐
│  [← октябрь 2025 →]  [Месяц▾] [Неделя] [День]│
├──────────────────────────────────────────────┤
│  ПН   ВТ   СР   ЧТ   ПТ   СБ   ВС           │
├──────────────────────────────────────────────┤
│                    1    2    3    4    5     │
│  6    7    8    9   10   11   12            │
│                      [занятие]               │
│                       18:00                  │
│                   K-pop (8/12)               │
│ 13   14   15   16   17   18   19            │
│            [занятие][занятие]                │
│             18:00    20:00                   │
└──────────────────────────────────────────────┘

Мои группы:
┌─ K-pop Начинающие (8/12) ─┐
└────────────────────────────┘
← перетащите на календарь для создания занятия
```

### Модальное окно занятия:

```
┌──────────────────────────────────┐
│  K-pop Начинающие                │
│  📅 15 октября 2025, Среда       │
│  ⏰ 18:00 - 19:30 (90 мин)       │
├──────────────────────────────────┤
│  Посещаемость (8/12):            │
│  ✓ Айгуль                        │
│  ✓ Асем                          │
│  ✗ Дана (пропуск)                │
│  ...                             │
├──────────────────────────────────┤
│  📝 Заметки:                     │
│  Новая комбинация                │
├──────────────────────────────────┤
│  [Отменить занятие] [Сохранить]  │
└──────────────────────────────────┘
```

---

## 🚀 План реализации

### Этап 1: Backend ✅
- ✅ Модель Class создана
- ✅ API endpoints созданы
- ✅ Роуты зарегистрированы

### Этап 2: Frontend (следующий шаг)
- [ ] Подключить FullCalendar
- [ ] Создать вкладку "Расписание"
- [ ] Реализовать drag & drop
- [ ] Модалка создания/редактирования
- [ ] Отметка посещаемости

### Этап 3: Автоматизация
- [ ] Cron-задача генерации занятий
- [ ] Уведомления (Telegram)
- [ ] Списание занятий с абонемента

---

## 💡 Преимущества FullCalendar

1. ✅ **Визуально красиво** - профессиональный вид
2. ✅ **Drag & Drop из коробки** - не нужно писать самим
3. ✅ **Адаптивный** - работает на телефонах
4. ✅ **Локализация** - русский язык
5. ✅ **Много view** - месяц, неделя, день
6. ✅ **События** - легко обрабатывать клики, перемещения
7. ✅ **Темизация** - легко стилизовать под наш дизайн

---

## 📊 Формат событий для FullCalendar

```javascript
{
  id: '123',
  title: 'K-pop Начинающие (8/12)',
  start: '2025-10-15T18:00:00',
  end: '2025-10-15T19:30:00',
  backgroundColor: '#eb4d77',
  extendedProps: {
    groupId: 'abc',
    teacherId: 'xyz',
    status: 'scheduled',
    attendees: [...]
  }
}
```

---

## 🎨 Кастомизация под наш стиль

```css
.fc {
  background: rgba(26, 26, 26, 0.5);
  border: 1px solid rgba(235, 77, 119, 0.1);
}

.fc-event {
  background: #eb4d77;
  border: none;
  border-radius: 5px;
}

.fc-event:hover {
  background: #ff0080;
}
```

---

**Дата создания:** 09.10.2025  
**Статус:** Backend готов, Frontend в разработке

