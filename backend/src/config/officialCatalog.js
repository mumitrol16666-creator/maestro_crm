const OFFICIAL_DIRECTIONS = [
    'Гитара',
    'Электрогитара',
    'Басгитара',
    'Вокал',
    'Фортепиано',
    'Укулеле',
];

const OFFICIAL_TARIFFS = [
    { type: 'hybrid_1', label: 'Гибрид 1', price: 9600, classes: 8, days: 30, lessonFormat: 'mixed', durationMinutes: 60, individualClasses: 4, groupClasses: 4, theoryClasses: 0 },
    { type: 'group_evening', label: 'Группа вечер', price: 20000, classes: 8, days: 30, lessonFormat: 'group', durationMinutes: 60 },
    { type: 'group_mini', label: 'Группа мини', price: 16000, classes: 8, days: 30, lessonFormat: 'group', durationMinutes: 60 },
    { type: 'duet', label: 'Дуэт', price: 21120, classes: 8, days: 30, lessonFormat: 'group', durationMinutes: 60 },
    { type: 'individual_1_2', label: 'Индив 1-2', price: 32000, classes: 8, days: 30, lessonFormat: 'individual', durationMinutes: 45 },
    { type: 'individual_2_2', label: 'Индив 2-2', price: 60000, classes: 16, days: 60, lessonFormat: 'individual', durationMinutes: 45 },
    { type: 'individual_4_long', label: 'Индив 4', price: 216000, classes: 60, days: 365, lessonFormat: 'individual', durationMinutes: 60 },
    { type: 'individual_archived', label: 'Индивидуальный (Архивный)', price: 53000, classes: 16, days: 60, lessonFormat: 'individual', durationMinutes: 60, isActive: false },
    { type: 'individual_1', label: 'Индивидуальный 1', price: 32000, classes: 8, days: 30, lessonFormat: 'individual', durationMinutes: 60 },
    { type: 'individual_2', label: 'Индивидуальный 2', price: 60000, classes: 16, days: 60, lessonFormat: 'individual', durationMinutes: 60 },
    { type: 'individual_3', label: 'Индивидуальный 3', price: 90000, classes: 24, days: 90, lessonFormat: 'individual', durationMinutes: 60 },
    { type: 'individual_4', label: 'Индивидуальный 4', price: 16000, classes: 4, days: 30, lessonFormat: 'individual', durationMinutes: 60 },
    { type: 'individual_8_25', label: 'Индивидуальный 8 по 25', price: 20000, classes: 8, days: 30, lessonFormat: 'individual', durationMinutes: 25 },
    { type: 'individual_year', label: 'Индивидуальный год', price: 288000, classes: 80, days: 365, lessonFormat: 'individual', durationMinutes: 60 },
    { type: 'single_lesson', label: 'Одноразовые уроки', price: 4500, classes: 1, days: 7, lessonFormat: 'individual', durationMinutes: 60 },
    { type: 'theory', label: 'Теория', price: 4000, classes: 4, days: 30, lessonFormat: 'group', durationMinutes: 60 },
    { type: 'quartet_only', label: 'Только квартет', price: 8000, classes: 4, days: 30, lessonFormat: 'group', durationMinutes: 60 },
].map((tariff, order) => ({ ...tariff, isActive: tariff.isActive !== false, order }));

const OFFICIAL_TARIFF_TYPES = new Set(OFFICIAL_TARIFFS.map(tariff => tariff.type));

function tariffByType(type) {
    return OFFICIAL_TARIFFS.find(tariff => tariff.type === type) || null;
}

module.exports = {
    OFFICIAL_DIRECTIONS,
    OFFICIAL_TARIFFS,
    OFFICIAL_TARIFF_TYPES,
    tariffByType,
};
