# 🎯 Как достичь 90% покрытия тестами

**Текущее состояние:** 47.5% покрытия (96 тестов)  
**Цель:** 90% покрытия  
**Проблема:** MongoDB Memory Server медленный (34 сек для 96 тестов, зависает на 150+)

---

## 🚀 РЕКОМЕНДУЕМОЕ РЕШЕНИЕ: Реальная тестовая БД

### Шаг 1: Создать тестовую базу в MongoDB Atlas

1. Зайти в MongoDB Atlas
2. Создать новую базу `sense-of-dance-test`
3. Получить connection string

### Шаг 2: Обновить `.env.test`

```bash
# backend/.env.test
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/sense-of-dance-test?retryWrites=true&w=majority
JWT_SECRET=test-secret-key
PORT=5001
```

### Шаг 3: Обновить `__tests__/setup.js`

```javascript
const mongoose = require('mongoose');

let isConnected = false;

beforeAll(async () => {
    if (!isConnected) {
        // Используем реальную тестовую БД вместо Memory Server
        await mongoose.connect(process.env.MONGODB_URI);
        isConnected = true;
        console.log('✅ Test DB connected');
    }
}, 30000);

afterEach(async () => {
    // Быстрая очистка всех коллекций
    if (mongoose.connection.readyState !== 0) {
        const collections = mongoose.connection.collections;
        const promises = Object.keys(collections).map(key => 
            collections[key].deleteMany({})
        );
        await Promise.all(promises);
    }
});

afterAll(async () => {
    if (isConnected) {
        await mongoose.disconnect();
        isConnected = false;
        console.log('✅ Test DB disconnected');
    }
}, 30000);

// ... остальные helper функции
```

### Шаг 4: Удалить MongoDB Memory Server

```bash
cd backend
npm uninstall mongodb-memory-server
```

### Результат:

✅ **Скорость:** В 3-5 раз быстрее  
✅ **Стабильность:** Нет зависаний  
✅ **Масштабируемость:** Можно добавить 200+ тестов  
✅ **Простота:** Та же самая логика тестов

**Время выполнения:**
- Было: 34 сек для 96 тестов
- Станет: 10-15 сек для 96 тестов
- С 200 тестами: 30-40 сек

---

## 📋 План добавления тестов до 90%

### 1. Students API (34% → 70%)
**Нужно:** ~30 тестов

```javascript
// __tests__/students/students-advanced.test.js

- Получение статистики для разных ролей
- Фильтрация по группам
- Сортировка по разным полям
- Batch операции
- Upcoming classes для разных сценариев
- Edge cases (несуществующие ID, пустые данные)
```

### 2. Classes API (41% → 75%)
**Нужно:** ~25 тестов

```javascript
// __tests__/classes/classes-advanced.test.js

- Рекуррентные занятия (разные паттерны)
- Обновление посещаемости (частичное, полное)
- Практики vs обычные занятия
- Получение по разным фильтрам
- Удаление с каскадом
- Weekly schedule
```

### 3. Memberships API (54% → 80%)
**Нужно:** ~20 тестов

```javascript
// __tests__/memberships/memberships-advanced.test.js

- Продление абонементов (все комбинации типов)
- Заморозки и их влияние
- Добавление/вычитание занятий
- Истечение и автопродление
- Смена статусов
- История изменений
```

### 4. Freezes API (23% → 70%)
**Нужно:** ~15 тестов

```javascript
// __tests__/freezes/freezes-complete.test.js

- Создание (все валидации)
- Отмена в разных состояниях
- Активация/завершение автоматически
- Проверка перекрытий
- Влияние на абонементы
```

### 5. Users API (30% → 70%)
**Нужно:** ~15 тестов

```javascript
// __tests__/users/users-advanced.test.js

- Создание всех типов пользователей
- Смена ролей
- Сброс паролей
- Удаление с проверками
- Права доступа для каждой роли
```

### 6. Admin & Permissions (38-59% → 80%)
**Нужно:** ~10 тестов

```javascript
// __tests__/admin/admin-stats.test.js
// __tests__/permissions/permissions-complete.test.js

- Статистика для разных периодов
- Права доступа для всех ролей
- Dashboard данные
```

---

## 📈 Прогноз покрытия

| Модуль | Сейчас | После доработки | Тестов |
|--------|--------|-----------------|--------|
| auth.js | 87.87% | **95%** | +3 |
| students.js | 34.53% | **70%** | +30 |
| classes.js | 41.49% | **75%** | +25 |
| memberships.js | 54.71% | **80%** | +20 |
| freezes.js | 23.68% | **70%** | +15 |
| users.js | 30.55% | **70%** | +15 |
| groups.js | 71.07% | **85%** | +8 |
| bookings.js | 68.88% | **80%** | +7 |
| directions.js | 65.38% | **80%** | +5 |
| admin.js | 59.57% | **80%** | +5 |
| permissions.js | 38.57% | **80%** | +8 |
| rooms.js | 72.22% | **85%** | +3 |
| payments.js | 77.77% | **90%** | +2 |

**ИТОГО:**
- Тестов сейчас: 96
- Нужно добавить: ~146 тестов
- Итого: ~242 теста
- **Покрытие: 85-90%**

---

## ⏱️ Оценка времени

### С реальной тестовой БД:
- Настройка: 15 минут
- Написание 146 тестов: 4-5 часов
- Отладка: 1 час
- **Всего: 6 часов чистого времени**

### С MongoDB Memory Server:
- ❌ Невозможно (зависает на >150 тестах)

---

## ✅ Альтернатива: Частичное покрытие 60-70%

Если нет возможности настроить реальную БД:

**Добавить только критичные тесты:**
- Students: +15 тестов
- Classes: +10 тестов
- Memberships: +10 тестов
- Freezes: +5 тестов

**Итого:** +40 тестов = 136 тестов (60-65% покрытия)  
**Время:** ~40-45 секунд (ещё приемлемо)

---

## 🎯 Рекомендация

**Для production-ready проекта:**
1. Переключиться на реальную тестовую БД (15 минут работы)
2. Добавить критичные тесты до 70% (2-3 часа)
3. Постепенно довести до 85-90% (ещё 3-4 часа)

**Текущие 47.5% - это хорошая база**, но для серьёзного проекта рекомендуется минимум 60-70%.

