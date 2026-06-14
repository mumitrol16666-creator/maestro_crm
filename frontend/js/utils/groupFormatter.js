/**
 * Утилиты для форматирования групп в админке
 */

// Сокращенные названия дней недели
const DAYS_SHORT = {
    1: 'пн',
    2: 'вт',
    3: 'ср',
    4: 'чт',
    5: 'пт',
    6: 'сб',
    0: 'вс'
};

/**
 * Форматирует расписание группы для отображения в списках
 * @param {Object} group - Объект группы с полем schedule
 * @returns {string} - Отформатированная строка: "Название группы, пн-ср 20:30"
 */
window.formatGroupWithSchedule = function (group) {
    if (!group) return '';

    const name = group.name || 'Без названия';

    // Если нет расписания - возвращаем только название
    if (!group.schedule || group.schedule.length === 0) {
        return name;
    }

    // Группируем занятия по времени (начало-конец)
    const timeGroups = {};

    group.schedule.forEach(item => {
        const startTime = item.time;
        const duration = item.duration || 60; // дефолт 60 мин, если не указано (хотя в модели 90)

        // Вычисляем время окончания
        let [hours, minutes] = startTime.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes + duration;
        const endHours = Math.floor(totalMinutes / 60) % 24;
        const endMinutes = totalMinutes % 60;
        const endTime = `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;

        const timeKey = `${startTime}-${endTime}`;

        if (!timeGroups[timeKey]) {
            timeGroups[timeKey] = [];
        }
        timeGroups[timeKey].push(item.dayOfWeek);
    });

    // Формируем строки для каждой группы времени
    const scheduleStrings = [];

    for (const [timeRange, days] of Object.entries(timeGroups)) {
        // Сортируем дни
        days.sort((a, b) => {
            // Воскресенье (0 или 7) идет последним
            const aVal = (a === 0 || a === 7) ? 7 : a;
            const bVal = (b === 0 || b === 7) ? 7 : b;
            return aVal - bVal;
        });

        // Форматируем дни
        const daysFormatted = days.map(d => DAYS_SHORT[d === 7 ? 0 : d] || DAYS_SHORT[d]).join('-');

        scheduleStrings.push(`${daysFormatted} ${timeRange}`);
    }

    // Возвращаем название + расписание
    if (scheduleStrings.length > 0) {
        return `${name}, ${scheduleStrings.join(', ')}`;
    }

    return name;
};

/**
 * Форматирует массив групп для select option
 * @param {Array} groups - Массив групп
 * @returns {string} - HTML строка с <option> элементами
 */
window.formatGroupsForSelect = function (groups) {
    if (!groups || groups.length === 0) {
        return '<option value="">Нет доступных групп</option>';
    }

    return groups.map(group => {
        const formatted = window.formatGroupWithSchedule(group);
        return `<option value="${group._id}">${formatted}</option>`;
    }).join('');
};

/**
 * Форматирует ТОЛЬКО расписание группы (без названия)
 * @param {Object} group - Объект группы с полем schedule
 * @returns {string} - Отформатированная строка: "пн-ср 20:30-22:00" или название, если нет расписания
 */
window.formatGroupScheduleOnly = function (group) {
    if (!group) return '';

    const name = group.name || 'Без названия';

    // Если нет расписания - возвращаем название как запасной вариант
    if (!group.schedule || group.schedule.length === 0) {
        return name;
    }

    // Группируем занятия по времени (начало-конец)
    const timeGroups = {};

    group.schedule.forEach(item => {
        const startTime = item.time;
        const duration = item.duration || 60; // дефолт 60 мин, если не указано

        // Вычисляем время окончания
        let [hours, minutes] = startTime.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes + duration;
        const endHours = Math.floor(totalMinutes / 60) % 24;
        const endMinutes = totalMinutes % 60;
        const endTime = `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;

        const timeKey = `${startTime}-${endTime}`;

        if (!timeGroups[timeKey]) {
            timeGroups[timeKey] = [];
        }
        timeGroups[timeKey].push(item.dayOfWeek);
    });

    // Формируем строки для каждой группы времени
    const scheduleStrings = [];

    for (const [timeRange, days] of Object.entries(timeGroups)) {
        // Сортируем дни
        days.sort((a, b) => {
            // Воскресенье (0 или 7) идет последним
            const aVal = (a === 0 || a === 7) ? 7 : a;
            const bVal = (b === 0 || b === 7) ? 7 : b;
            return aVal - bVal;
        });

        // Форматируем дни
        const daysFormatted = days.map(d => DAYS_SHORT[d === 7 ? 0 : d] || DAYS_SHORT[d]).join('-');

        scheduleStrings.push(`${daysFormatted} ${timeRange}`);
    }

    // Возвращаем ТОЛЬКО расписание
    if (scheduleStrings.length > 0) {
        return scheduleStrings.join(', ');
    }

    return name;
};

const DAYS_LABEL = {
    1: 'Пн',
    2: 'Вт',
    3: 'Ср',
    4: 'Чт',
    5: 'Пт',
    6: 'Сб',
    0: 'Вс',
    7: 'Вс',
};

/**
 * Компактное расписание для карточки ученика: «Пн 12:00, Ср 15:00»
 * @param {Array} schedules - GroupSchedule[]
 */
window.formatRegularScheduleCompact = function (schedules) {
    if (!schedules || schedules.length === 0) return '—';

    const regular = schedules.filter((item) => !item.isPractice);
    if (regular.length === 0) return '—';

    const sorted = [...regular].sort((a, b) => {
        const aVal = a.dayOfWeek === 0 || a.dayOfWeek === 7 ? 7 : a.dayOfWeek;
        const bVal = b.dayOfWeek === 0 || b.dayOfWeek === 7 ? 7 : b.dayOfWeek;
        return aVal - bVal;
    });

    return sorted
        .map((item) => {
            const day = DAYS_LABEL[item.dayOfWeek] || DAYS_LABEL[item.dayOfWeek === 7 ? 0 : item.dayOfWeek] || '';
            return `${day} ${item.time}`;
        })
        .join(', ');
};

