function getTrialAnchorDate(booking) {
    return new Date(booking.trialScheduledAt || booking.convertedAt || booking.createdAt || Date.now());
}

const MEMBERSHIP_PAYMENT_TYPES = ['membership_advance', 'membership_balance', 'membership_full'];

async function hasTrialCloseSignal(prisma, booking) {
    if (!booking?.convertedToStudentId) return false;

    const anchorDate = getTrialAnchorDate(booking);
    const payment = await prisma.payment.findFirst({
        where: {
            studentId: booking.convertedToStudentId,
            status: 'completed',
            amount: { gt: 0 },
            type: { in: MEMBERSHIP_PAYMENT_TYPES },
            paymentDate: { gte: anchorDate },
        },
        select: { id: true },
    });
    return Boolean(payment);
}

async function inferBookingLossStage(prisma, booking) {
    if (booking.appStatus === 'completed') return 'after_trial';

    if (booking.convertedToStudentId) {
        if (await hasTrialCloseSignal(prisma, booking)) return 'after_trial';

        const anchor = getTrialAnchorDate(booking);
        if (booking.status === 'rejected' && anchor.getTime() <= Date.now()) return 'after_trial';

        const deadline = new Date(anchor);
        deadline.setDate(deadline.getDate() + 14);
        if (Date.now() >= deadline.getTime()) return 'after_trial';
        return 'on_trial';
    }

    if (booking.status === 'trial' || booking.appStatus === 'scheduled') return 'on_trial';
    return 'before_trial';
}

async function normalizeBookingLossStage(prisma, booking) {
    const inferred = await inferBookingLossStage(prisma, booking);
    if (inferred === 'after_trial') return inferred;

    const allowedStages = new Set(['before_trial', 'on_trial', 'after_trial']);
    return allowedStages.has(booking.lossStage) ? booking.lossStage : inferred;
}

async function normalizeBookingLossStages(prisma, bookings) {
    if (!bookings.length) return new Map();
    const studentIds = [...new Set(bookings.map((booking) => booking.convertedToStudentId).filter(Boolean))];
    const payments = studentIds.length
        ? await prisma.payment.findMany({
            where: {
                studentId: { in: studentIds },
                status: 'completed',
                amount: { gt: 0 },
                type: { in: MEMBERSHIP_PAYMENT_TYPES },
            },
            select: { studentId: true, paymentDate: true },
        })
        : [];
    const paymentsByStudent = new Map();
    for (const payment of payments) {
        const dates = paymentsByStudent.get(payment.studentId) || [];
        dates.push(new Date(payment.paymentDate).getTime());
        paymentsByStudent.set(payment.studentId, dates);
    }

    const now = Date.now();
    const allowedStages = new Set(['before_trial', 'on_trial', 'after_trial']);
    const result = new Map();
    for (const booking of bookings) {
        let inferred;
        if (booking.appStatus === 'completed') {
            inferred = 'after_trial';
        } else if (booking.convertedToStudentId) {
            const anchor = getTrialAnchorDate(booking);
            const anchorTime = anchor.getTime();
            const hasPayment = (paymentsByStudent.get(booking.convertedToStudentId) || [])
                .some((paymentTime) => paymentTime >= anchorTime);
            if (hasPayment
                || (booking.status === 'rejected' && anchorTime <= now)
                || now >= anchorTime + (14 * 24 * 60 * 60 * 1000)) {
                inferred = 'after_trial';
            } else {
                inferred = 'on_trial';
            }
        } else if (booking.status === 'trial' || booking.appStatus === 'scheduled') {
            inferred = 'on_trial';
        } else {
            inferred = 'before_trial';
        }
        result.set(
            booking.id,
            inferred === 'after_trial' || !allowedStages.has(booking.lossStage)
                ? inferred
                : booking.lossStage,
        );
    }
    return result;
}

module.exports = {
    inferBookingLossStage,
    normalizeBookingLossStage,
    normalizeBookingLossStages,
    hasTrialCloseSignal,
};
