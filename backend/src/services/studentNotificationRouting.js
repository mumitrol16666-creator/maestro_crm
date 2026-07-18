const NOTIFICATION_FIELDS = Object.freeze({
    homework: 'notifyHomework',
    lessons: 'notifyLessons',
    payments: 'notifyPayments',
});

function notificationField(kind) {
    const field = NOTIFICATION_FIELDS[kind];
    if (!field) throw new Error(`Unknown student notification kind: ${kind}`);
    return field;
}

function validPhone(phone) {
    const value = String(phone || '').trim();
    if (!value || value.startsWith('IMPORT_NO_PRIMARY_') || value.startsWith('NO_PHONE_')) return null;
    return value;
}

function studentNotificationContacts(student) {
    return [
        {
            phone: validPhone(student?.phone),
            notifyHomework: student?.notifyHomework,
            notifyLessons: student?.notifyLessons,
            notifyPayments: student?.notifyPayments,
        },
        ...(student?.additionalPhones || []).map(phone => ({
            phone: validPhone(phone?.phone),
            notifyHomework: phone?.notifyHomework,
            notifyLessons: phone?.notifyLessons,
            notifyPayments: phone?.notifyPayments,
        })),
    ];
}

function resolveStudentNotificationPhone(student, kind) {
    const field = notificationField(kind);
    const contacts = studentNotificationContacts(student);
    const explicit = contacts.find(contact => contact[field] === true && contact.phone);
    if (explicit) return explicit.phone;

    const isConfigured = contacts.some(contact => typeof contact[field] === 'boolean');
    return isConfigured ? null : contacts.find(contact => contact.phone)?.phone || null;
}

function normalizeNotificationFlag(value) {
    return typeof value === 'boolean' ? value : null;
}

function assertUniqueNotificationRoutes(primary, additionalPhones = []) {
    const contacts = [primary, ...additionalPhones];
    for (const [kind, field] of Object.entries(NOTIFICATION_FIELDS)) {
        if (contacts.filter(contact => contact?.[field] === true).length > 1) {
            const labels = { homework: 'ДЗ', lessons: 'Уроки', payments: 'Оплата' };
            const error = new Error(`Получатель «${labels[kind]}» может быть выбран только у одного номера`);
            error.code = 'DUPLICATE_NOTIFICATION_ROUTE';
            error.statusCode = 400;
            throw error;
        }
    }
}

module.exports = {
    NOTIFICATION_FIELDS,
    normalizeNotificationFlag,
    assertUniqueNotificationRoutes,
    resolveStudentNotificationPhone,
};
