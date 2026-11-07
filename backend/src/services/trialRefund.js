const { PAYMENT_METHOD_VALUES, getPaymentMethodLabel } = require('./paymentMethods');
const { createCashTransaction } = require('./cashTelegramNotifications');
const { acquireClassScheduleLocks } = require('./classScheduleGuard');
const { TRIAL_PAYMENT_CATEGORY, TRIAL_REFUND_CATEGORY, trialBookingName } = require('./trialPayment');

// Document 26: the diagnostic lesson fee is returned in full when the client
// cancels at least this many hours before the lesson. Outside the rule only
// admin / super_admin may return it, with an explicit tick and a reason.
const TRIAL_REFUND_POLICY_HOURS = 24;
const TRIAL_REFUND_REASON_MAX = 200;
const REFUND_ROLES = new Set(['admin', 'super_admin']);
const REFUND_REASON_VIEW_ROLES = new Set(['admin', 'super_admin', 'sales_manager']);
const HELD_CLASS_STATUSES = new Set(['completed', 'pending_admin_review']);
const OPEN_CLASS_STATUSES = ['scheduled', 'started'];

function refundError(message, code, statusCode = 400, extra = null) {
    return Object.assign(new Error(message), { code, statusCode, ...(extra ? { details: extra } : {}) });
}

/**
 * Pure rule. Moments are compared in UTC, so the school time zone does not
 * change the result. A booking without a lesson date has no lesson to lose.
 * hoursBefore is a whole number rounded down and may be negative (lesson passed).
 */
function classifyTrialRefund({ trialScheduledAt, cancelledAt }) {
    if (!trialScheduledAt) return { withinPolicy: true, hoursBefore: null };
    const scheduled = new Date(trialScheduledAt).getTime();
    const cancelled = new Date(cancelledAt).getTime();
    if (Number.isNaN(scheduled) || Number.isNaN(cancelled)) {
        throw refundError('Некорректная дата урока или отмены', 'INVALID_REFUND_INPUT');
    }
    const diffMs = scheduled - cancelled;
    return {
        withinPolicy: diffMs >= TRIAL_REFUND_POLICY_HOURS * 60 * 60 * 1000,
        hoursBefore: Math.floor(diffMs / (60 * 60 * 1000)),
    };
}

function outsidePolicyNote(hoursBefore) {
    return hoursBefore !== null && hoursBefore < 0
        ? 'Вне правила: после начала урока'
        : `Вне правила: ${hoursBefore} ч до урока`;
}

/**
 * Returns the whole diagnostic fee (income -> expense, one refund per income
 * enforced by the unique refundOfCashTransactionId). Lock order: booking
 * (advisory) -> income row (FOR UPDATE). Everything happens in the caller's
 * transaction; the platform notification is sent by the caller after commit.
 */
async function refundTrialPayment(tx, {
    bookingId,
    actor,
    reason,
    cancelledAt = null,
    overridePolicy = false,
    paymentMethod = null,
    now = new Date(),
}) {
    if (!actor?.id || !REFUND_ROLES.has(actor.role)) {
        throw refundError('Вернуть оплату диагностики может только администратор', 'FORBIDDEN', 403);
    }

    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (!cleanReason || cleanReason.length > TRIAL_REFUND_REASON_MAX) {
        throw refundError(`Укажите причину возврата (до ${TRIAL_REFUND_REASON_MAX} знаков)`, 'INVALID_REFUND_INPUT');
    }
    const cancelledMoment = cancelledAt ? new Date(cancelledAt) : now;
    if (Number.isNaN(cancelledMoment.getTime())) {
        throw refundError('Некорректная дата отмены клиентом', 'INVALID_REFUND_INPUT');
    }
    if (cancelledMoment.getTime() > now.getTime()) {
        throw refundError('Отмена клиентом не может быть позже сегодняшнего момента', 'INVALID_REFUND_INPUT');
    }
    if (paymentMethod !== null && paymentMethod !== undefined && paymentMethod !== ''
        && (typeof paymentMethod !== 'string' || !PAYMENT_METHOD_VALUES.has(paymentMethod.trim()))) {
        throw refundError('Выберите корректный счёт возврата', 'INVALID_PAYMENT_METHOD');
    }

    const firstRead = await tx.booking.findUnique({ where: { id: bookingId }, select: { id: true, trialClassId: true } });
    if (!firstRead) throw refundError('Заявка не найдена', 'BOOKING_NOT_FOUND', 404);
    await acquireClassScheduleLocks(tx, [{ bookingId: firstRead.id, classId: firstRead.trialClassId || null }]);
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw refundError('Заявка не найдена', 'BOOKING_NOT_FOUND', 404);

    const incomeRows = await tx.$queryRaw`
        SELECT id FROM "CashTransaction" WHERE "relatedBookingId" = ${booking.id} FOR UPDATE
    `;
    const income = incomeRows[0]
        ? await tx.cashTransaction.findUnique({
            where: { id: incomeRows[0].id },
            include: { refundedBy: { select: { id: true } } },
        })
        : null;
    if (!income || income.type !== 'income' || income.category !== TRIAL_PAYMENT_CATEGORY) {
        throw refundError('Оплата диагностики по этой заявке не найдена', 'TRIAL_PAYMENT_NOT_FOUND', 404);
    }
    if (income.refundedBy) {
        throw refundError('Оплата диагностики по этой заявке уже возвращена', 'TRIAL_PAYMENT_ALREADY_REFUNDED', 409);
    }
    if (cancelledMoment.getTime() < new Date(income.date).getTime()) {
        throw refundError('Отмена клиентом не может быть раньше оплаты', 'INVALID_REFUND_INPUT');
    }

    const policy = classifyTrialRefund({ trialScheduledAt: booking.trialScheduledAt, cancelledAt: cancelledMoment });
    if (!policy.withinPolicy && !overridePolicy) {
        throw refundError(
            'Меньше суток до урока или урок уже прошёл: возврат возможен только вне правила, с отметкой и причиной',
            'TRIAL_REFUND_OUTSIDE_POLICY',
            400,
            { hoursBefore: policy.hoursBefore },
        );
    }

    // Default: the account the money came in on (even a legacy/unspecified one,
    // so the same account is reduced); an explicit choice is limited to real accounts.
    const refundMethod = paymentMethod ? paymentMethod.trim() : (income.paymentMethod || null);
    const name = trialBookingName(booking);

    const refund = await createCashTransaction(tx, {
        type: 'expense',
        amount: income.amount,
        category: TRIAL_REFUND_CATEGORY,
        description: `Возврат за диагностический урок: ${name}`,
        date: now,
        createdById: actor.id,
        refundOfCashTransactionId: income.id,
        paymentMethod: refundMethod,
        notes: policy.withinPolicy
            ? cleanReason
            : `${cleanReason}. ${outsidePolicyNote(policy.hoursBefore)}`,
    });

    let classRecord = null;
    let classCancelled = false;
    let lessonHeld = false;
    if (booking.trialClassId) {
        const current = await tx.class.findUnique({ where: { id: booking.trialClassId }, select: { id: true, status: true } });
        lessonHeld = Boolean(current && HELD_CLASS_STATUSES.has(current.status));
        if (current && OPEN_CLASS_STATUSES.includes(current.status)) {
            const cancelled = await tx.class.updateMany({
                where: { id: current.id, status: { in: OPEN_CLASS_STATUSES } },
                data: { status: 'cancelled' },
            });
            classCancelled = cancelled.count > 0;
            if (classCancelled) classRecord = await tx.class.findUnique({ where: { id: current.id } });
        }
    }

    const closeBooking = !lessonHeld
        && !['sold', 'rejected'].includes(booking.status)
        && !booking.convertedToStudentId;
    const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
            depositPaid: false,
            trialRefundedAt: now,
            trialRefundedById: actor.id,
            trialRefundReason: cleanReason,
            trialRefundOutsidePolicy: !policy.withinPolicy,
            ...(closeBooking
                ? {
                    status: 'rejected',
                    trialFunnelStage: 'rejected',
                    trialNextAction: 'none',
                    trialNextActionAt: null,
                    lossReason: cleanReason,
                    lossStage: 'before_trial',
                    lostAt: now,
                }
                : {}),
        },
    });

    await tx.activityLog.create({
        data: {
            userId: actor.id,
            action: 'trial_refund',
            entityType: 'Booking',
            entityId: booking.id,
            details: `Возврат ${income.amount.toLocaleString('ru-RU')} ₸ за диагностику: ${name}, ${getPaymentMethodLabel(refundMethod) || 'счёт не указан'}, ${policy.withinPolicy ? 'по правилу' : 'вне правила'}`,
            metadata: {
                cashTransactionId: refund.id,
                refundOfCashTransactionId: income.id,
                amount: income.amount,
                paymentMethod: refundMethod,
                withinPolicy: policy.withinPolicy,
                overridePolicy: Boolean(overridePolicy),
                hoursBefore: policy.hoursBefore,
                cancelledAt: cancelledMoment.toISOString(),
                trialScheduledAt: booking.trialScheduledAt ? new Date(booking.trialScheduledAt).toISOString() : null,
                classCancelled,
                previousStatus: booking.status,
                bookingClosed: closeBooking,
            },
        },
    });

    return { refund, booking: updatedBooking, policy, classCancelled, classRecord };
}

/**
 * What the read endpoints add to a booking / lesson: the refund summary and
 * whether the «Вернуть оплату» button is available to this user.
 */
function trialRefundView(booking, income, role) {
    const refundedBy = income?.refundedBy || null;
    return {
        trialRefund: refundedBy
            ? {
                date: refundedBy.date,
                paymentMethod: refundedBy.paymentMethod || null,
                reason: REFUND_REASON_VIEW_ROLES.has(role) ? (booking?.trialRefundReason || null) : null,
                outsidePolicy: REFUND_REASON_VIEW_ROLES.has(role) ? Boolean(booking?.trialRefundOutsidePolicy) : null,
            }
            : null,
        trialRefundAvailable: Boolean(income && !refundedBy && REFUND_ROLES.has(role)),
    };
}

/**
 * The lesson endpoints are open to teachers: the refund reason and the
 * outside-policy mark belong to admin, super_admin and sales_manager only.
 */
function withoutRefundDetailsForRole(trialBooking, role) {
    if (!trialBooking || REFUND_REASON_VIEW_ROLES.has(role)) return trialBooking;
    const { trialRefundReason, trialRefundOutsidePolicy, ...rest } = trialBooking;
    return rest;
}

module.exports = {
    TRIAL_REFUND_POLICY_HOURS,
    withoutRefundDetailsForRole,
    classifyTrialRefund,
    refundTrialPayment,
    trialRefundView,
};
