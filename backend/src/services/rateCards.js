const RATE_LABELS = Object.freeze({ individual: 'Индивидуальный', theory: 'Теория', quartet: 'Квартет', duo: 'Дуо', trio: 'Трио' });
const GROUP_BILLING_TYPES = Object.freeze(['quartet', 'duo', 'trio', 'theory']);
const RATE_CARD_MODEL = 'rate_card';

function isRateCard(membership) {
    return membership?.billingModel === RATE_CARD_MODEL;
}

function rateError(message, code = 'INVALID_LESSON_RATE') {
    return Object.assign(new Error(message), { code, statusCode: 400 });
}

function normalizeRates(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw rateError('Укажите расценки занятий');
    const result = {};
    for (const [kind, raw] of Object.entries(input)) {
        if (!Object.hasOwn(RATE_LABELS, kind)) throw rateError(`Неизвестный вид занятия: ${kind}`);
        if (raw === null || raw === undefined) continue;
        const row = typeof raw === 'number' ? { basePrice: raw } : raw;
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw rateError('Некорректная расценка');
        const basePrice = row.basePrice;
        const discountPercent = row.discountPercent ?? 0;
        const discountAmount = row.discountAmount ?? 0;
        const reason = String(row.reason || '').trim();
        if (!Number.isSafeInteger(basePrice) || basePrice < 0 || basePrice > 1000000) throw rateError(`${RATE_LABELS[kind]}: цена должна быть целым числом от 0 до 1 000 000 ₸`);
        if (typeof discountPercent !== 'number' || !Number.isFinite(discountPercent)
            || discountPercent < 0 || discountPercent > 100
            || Math.abs(discountPercent * 100 - Math.round(discountPercent * 100)) > 1e-7) throw rateError('Скидка должна быть от 0 до 100%, не более двух знаков после запятой');
        if (!Number.isSafeInteger(discountAmount) || discountAmount < 0 || discountAmount > basePrice) throw rateError('Скидка в тенге не может превышать цену урока');
        if (discountPercent && discountAmount) throw rateError('Для одной расценки выберите скидку в процентах или тенге');
        if ((discountPercent > 0 || discountAmount > 0 || basePrice === 0) && !reason) throw rateError('Укажите причину скидки или бесплатного урока');
        if (reason.length > 500) throw rateError('Причина не должна превышать 500 символов');
        const price = basePrice - (discountAmount || Math.round(basePrice * Math.round(discountPercent * 100) / 10000));
        result[kind] = { basePrice, discountPercent, discountAmount, price, reason };
    }
    if (!Object.keys(result).length) throw rateError('Добавьте хотя бы одну расценку');
    return result;
}

function getLessonBillingType(lesson) {
    if (!lesson || lesson.isPractice || ['trial', 'rent'].includes(lesson.classType)) return null;
    if (lesson.classType === 'individual') return 'individual';
    if (lesson.classType === 'theory') return 'theory';
    const kind = lesson.group?.billingType || lesson.billingType;
    return GROUP_BILLING_TYPES.includes(kind) ? kind : null;
}

function getRateCardPrice(membership, lesson) {
    if (!isRateCard(membership)) return null;
    const kind = getLessonBillingType(lesson);
    const row = kind ? membership.lessonRates?.[kind] : null;
    return row && Number.isSafeInteger(row.price) && row.price >= 0 ? row.price : null;
}

function rateCardSupportsLesson(membership, lesson) {
    return isRateCard(membership) && membership.status === 'active' && getRateCardPrice(membership, lesson) !== null;
}

function selectRateCard(memberships, lesson, selectedId = null) {
    const matches = (memberships || []).filter(m => rateCardSupportsLesson(m, lesson));
    if (selectedId) return matches.find(m => m.id === selectedId) || null;
    return matches.length === 1 ? matches[0] : null;
}

function rateCardMembershipData({ studentId, name, rates, planId = null, directionId = null, teacherId = null, actorId = null, previousMembershipId = null, source = 'manual', emergencyFreezesAvailable = 0, emergencyFreezesUsed = 0, freezesAvailable = 0 }) {
    rates = normalizeRates(rates);
    return {
        studentId, planId, directionId, teacherId, billingModel: RATE_CARD_MODEL, tariffName: name,
        type: 'rate_card', lessonFormat: 'rate_card', lessonRates: rates,
        // Required historical columns are retained for old API clients. They never limit a rate card.
        totalClasses: 0, classesRemaining: 0, classesUsed: 0,
        startDate: new Date('1970-01-01T00:00:00.000Z'), endDate: new Date('9999-12-31T00:00:00.000Z'),
        status: 'active', paymentStatus: 'detached', freezesAvailable, emergencyFreezesAvailable, emergencyFreezesUsed,
        createdById: actorId, previousMembershipId, source,
        individualLessonPrice: rates.individual?.price ?? null,
        theoryLessonPrice: rates.theory?.price ?? null,
        groupLessonPrice: rates.quartet?.price ?? null,
    };
}

function rateCardSelectionOptions(memberships, lesson) {
    const kind = getLessonBillingType(lesson);
    const matches = (memberships || []).filter(m => rateCardSupportsLesson(m, lesson));
    return {
        state: !kind ? 'billing_type_missing' : matches.length === 1 ? 'automatic' : matches.length ? 'multiple_matches' : 'no_match',
        suggestedMembershipId: matches.length === 1 ? matches[0].id : null,
        allowedMembershipIds: matches.map(m => m.id),
        message: !kind ? 'Укажите назначение группы: квартет, дуо, трио или теория.'
            : !matches.length ? `У ученика нет расценки «${RATE_LABELS[kind]}». Подключите подходящий тариф.`
                : matches.length > 1 ? 'Найдено несколько расценок. Выберите тариф для этого урока.' : '',
    };
}

module.exports = { RATE_LABELS, GROUP_BILLING_TYPES, RATE_CARD_MODEL, isRateCard, rateError, normalizeRates,
    getLessonBillingType, getRateCardPrice, rateCardSupportsLesson, selectRateCard, rateCardMembershipData, rateCardSelectionOptions };
