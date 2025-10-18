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
window.formatGroupWithSchedule = function(group) {
    if (!group) return '';
    
    const name = group.name || 'Без названия';
    
    // Если нет расписания - возвращаем только название
    if (!group.schedule || group.schedule.length === 0) {
        return name;
    }
    
    // Группируем занятия по времени
    const timeGroups = {};
    
    group.schedule.forEach(item => {
        const time = item.time;
        if (!timeGroups[time]) {
            timeGroups[time] = [];
        }
        timeGroups[time].push(item.dayOfWeek);
    });
    
    // Формируем строки для каждой группы времени
    const scheduleStrings = [];
    
    for (const [time, days] of Object.entries(timeGroups)) {
        // Сортируем дни
        days.sort((a, b) => {
            // Воскресенье (0) идет последним
            const aVal = a === 0 ? 7 : a;
            const bVal = b === 0 ? 7 : b;
            return aVal - bVal;
        });
        
        // Форматируем дни
        const daysFormatted = days.map(d => DAYS_SHORT[d]).join('-');
        
        scheduleStrings.push(`${daysFormatted} ${time}`);
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
window.formatGroupsForSelect = function(groups) {
    if (!groups || groups.length === 0) {
        return '<option value="">Нет доступных групп</option>';
    }
    
    return groups.map(group => {
        const formatted = window.formatGroupWithSchedule(group);
        return `<option value="${group._id}">${formatted}</option>`;
    }).join('');
};

