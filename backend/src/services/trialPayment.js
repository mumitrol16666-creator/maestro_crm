const { TRIAL_LESSON_PRICE } = require('./trialPolicy');
const { PAYMENT_METHOD_VALUES } = require('./paymentMethods');

const TRIAL_PAYMENT_CATEGORY = 'trial_payment';

function trialBookingName(booking) {
    return [booking?.lastName, booking?.name, booking?.middleName]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || 'Клиент без имени';
}

function trialPaymentDescription(booking) {
    return `Диагностический урок ${TRIAL_LESSON_PRICE} ₸: ${trialBookingName(booking)}`;
}

/**
 * Records the non-refundable diagnostic lesson fee in the cashbox.
 * The fee is deliberately not a Student Payment: a lead may not have a
 * student card yet, and the money must not increase the student's balance.
 * The unique booking relation makes this operation idempotent.
 */
async function syncTrialPayment(tx, booking, {
    paid = booking?.depositPaid,
    actorId,
    paymentMethod = null,
    paymentDate = null,
} = {}) {
    if (!booking?.id) return null;

    const existing = await tx.cashTransaction.findUnique({
        where: { relatedBookingId: booking.id },
    });
    const nextPaid = Boolean(paid);

    if (!nextPaid) {
        if (existing) {
            const error = new Error('Проведённая оплата диагностического урока уже сохранена в кассе');
            error.code = 'TRIAL_PAYMENT_NOT_REVERSIBLE';
            error.statusCode = 400;
            throw error;
        }
        return null;
    }

    if (existing) return existing;
    if (!actorId) {
        const error = new Error('Не удалось определить сотрудника, принявшего оплату диагностики');
        error.code = 'TRIAL_PAYMENT_ACTOR_REQUIRED';
        error.statusCode = 400;
        throw error;
    }

    const parsedPaymentDate = paymentDate ? new Date(paymentDate) : new Date();
    const date = Number.isNaN(parsedPaymentDate.getTime()) ? new Date() : parsedPaymentDate;
    const normalizedPaymentMethod = paymentMethod ? String(paymentMethod).trim() : null;
    if (normalizedPaymentMethod && !PAYMENT_METHOD_VALUES.has(normalizedPaymentMethod)) {
        const error = new Error('Выберите корректный счет оплаты диагностики');
        error.code = 'INVALID_PAYMENT_METHOD';
        error.statusCode = 400;
        throw error;
    }

    return tx.cashTransaction.create({
        data: {
            type: 'income',
            amount: TRIAL_LESSON_PRICE,
            category: TRIAL_PAYMENT_CATEGORY,
            description: trialPaymentDescription(booking),
            date,
            createdById: actorId,
            relatedBookingId: booking.id,
            paymentMethod: normalizedPaymentMethod,
            notes: null,
        },
    });
}

module.exports = {
    TRIAL_PAYMENT_CATEGORY,
    trialPaymentDescription,
    syncTrialPayment,
};
