const OFFICIAL_DIRECTIONS = [
    'Гитара',
    'Электрогитара',
    'Басгитара',
    'Вокал',
    'Фортепиано',
    'Укулеле',
];

const OFFICIAL_TARIFFS = [
    { type: 'hybrid_1', label: 'Гибрид 1 (архивный)', price: 9600, classes: 8, days: 30, lessonFormat: 'mixed', durationMinutes: 60, individualClasses: 4, groupClasses: 4, theoryClasses: 0, isActive: false },
    { type: 'hybrid_1m', label: 'Гибридный формат · 1 месяц', price: 27000, classes: 10, days: 31, lessonFormat: 'mixed', durationMinutes: 45, individualClasses: 4, groupClasses: 4, theoryClasses: 2, emergencyFreezes: 0 },
    { type: 'hybrid_2m', label: 'Гибридный формат · 2 месяца', price: 50000, classes: 20, days: 60, lessonFormat: 'mixed', durationMinutes: 45, individualClasses: 8, groupClasses: 8, theoryClasses: 4, emergencyFreezes: 1 },
    { type: 'hybrid_3m', label: 'Гибридный формат · 3 месяца', price: 75000, classes: 30, days: 90, lessonFormat: 'mixed', durationMinutes: 45, individualClasses: 12, groupClasses: 12, theoryClasses: 6, emergencyFreezes: 2 },
    { type: 'hybrid_6m', label: 'Гибридный формат · 6 месяцев', price: 150000, classes: 60, days: 180, lessonFormat: 'mixed', durationMinutes: 45, individualClasses: 24, groupClasses: 24, theoryClasses: 12, emergencyFreezes: 3 },
    { type: 'hybrid_10m', label: 'Гибридный формат · 10 месяцев', price: 250000, classes: 100, days: 305, lessonFormat: 'mixed', durationMinutes: 45, individualClasses: 40, groupClasses: 40, theoryClasses: 20, emergencyFreezes: 5 },
    { type: 'group_evening', label: 'Группа вечер (архивный)', price: 20000, classes: 8, days: 30, lessonFormat: 'group', durationMinutes: 60, isActive: false },
    { type: 'group_mini', label: 'Группа мини', price: 16000, classes: 8, days: 30, lessonFormat: 'group', durationMinutes: 60 },
    { type: 'duet', label: 'Дуо · 1 месяц', price: 22000, classes: 8, days: 31, lessonFormat: 'group', durationMinutes: 45, emergencyFreezes: 0 },
    { type: 'duet_2m', label: 'Дуо · 2 месяца', price: 40000, classes: 16, days: 60, lessonFormat: 'group', durationMinutes: 45, emergencyFreezes: 2 },
    { type: 'duet_3m', label: 'Дуо · 3 месяца', price: 60000, classes: 24, days: 90, lessonFormat: 'group', durationMinutes: 45, emergencyFreezes: 3 },
    { type: 'individual_1_2', label: 'Индив 1-2 (архивный)', price: 32000, classes: 8, days: 30, lessonFormat: 'individual', durationMinutes: 60, isActive: false },
    { type: 'individual_2_2', label: 'Индив 2-2 (архивный)', price: 60000, classes: 16, days: 60, lessonFormat: 'individual', durationMinutes: 60, isActive: false },
    { type: 'individual_4_long', label: 'Индив 4 (архивный)', price: 216000, classes: 60, days: 365, lessonFormat: 'individual', durationMinutes: 60, isActive: false },
    { type: 'individual_archived', label: 'Индивидуальный (Архивный)', price: 53000, classes: 16, days: 60, lessonFormat: 'individual', durationMinutes: 60, isActive: false },
    { type: 'individual_1', label: 'Индивидуально · 1 месяц', price: 32000, classes: 8, days: 31, lessonFormat: 'individual', durationMinutes: 45, emergencyFreezes: 0 },
    { type: 'individual_2', label: 'Индивидуально · 2 месяца', price: 62000, classes: 16, days: 60, lessonFormat: 'individual', durationMinutes: 45, emergencyFreezes: 2 },
    { type: 'individual_3', label: 'Индивидуально · 3 месяца', price: 90000, classes: 24, days: 90, lessonFormat: 'individual', durationMinutes: 45, emergencyFreezes: 3 },
    { type: 'individual_6m', label: 'Индивидуально · 6 месяцев', price: 180000, classes: 48, days: 180, lessonFormat: 'individual', durationMinutes: 45, emergencyFreezes: 6 },
    { type: 'individual_10m', label: 'Индивидуально · 10 месяцев', price: 300000, classes: 80, days: 305, lessonFormat: 'individual', durationMinutes: 45, emergencyFreezes: 10 },
    { type: 'individual_4', label: 'Индивидуальный 4 (архивный)', price: 16000, classes: 4, days: 30, lessonFormat: 'individual', durationMinutes: 60, isActive: false },
    { type: 'individual_8_25', label: 'Индивидуальный 8 по 25 (архивный)', price: 20000, classes: 8, days: 30, lessonFormat: 'individual', durationMinutes: 25, isActive: false },
    { type: 'individual_year', label: 'Индивидуально · 10 месяцев (архивный ключ)', price: 300000, classes: 80, days: 305, lessonFormat: 'individual', durationMinutes: 45, emergencyFreezes: 10, isActive: false },
    { type: 'single_lesson', label: 'Одноразовые уроки', price: 4500, classes: 1, days: 7, lessonFormat: 'individual', durationMinutes: 60 },
    { type: 'theory', label: 'Теория', price: 4000, classes: 4, days: 30, lessonFormat: 'group', durationMinutes: 60 },
    { type: 'quartet_only', label: 'Только квартет', price: 8000, classes: 4, days: 30, lessonFormat: 'group', durationMinutes: 60 },
].map((tariff, order) => ({ ...tariff, isActive: tariff.isActive !== false, order }));

const OFFICIAL_TARIFF_TYPES = new Set(OFFICIAL_TARIFFS.map(tariff => tariff.type));

function tariffByType(type) {
    return OFFICIAL_TARIFFS.find(tariff => tariff.type === type) || null;
}

function tariffsForDirection(directionName) {
    const sellingDirections = new Set(['Гитара', 'Электрогитара', 'Басгитара', 'Вокал', 'Укулеле']);
    const hybridDirections = new Set(['Гитара', 'Электрогитара', 'Басгитара']);
    const guitarOnlyTypes = new Set(['theory', 'quartet_only']);
    return OFFICIAL_TARIFFS.map(tariff => ({
        ...tariff,
        isActive: sellingDirections.has(directionName)
            && (!tariff.type.startsWith('hybrid_') || hybridDirections.has(directionName))
            && (!guitarOnlyTypes.has(tariff.type) || hybridDirections.has(directionName))
            && tariff.isActive,
    }));
}

module.exports = {
    OFFICIAL_DIRECTIONS,
    OFFICIAL_TARIFFS,
    OFFICIAL_TARIFF_TYPES,
    tariffByType,
    tariffsForDirection,
};
