function getTrialAnchorDate(booking) {
    return new Date(booking.convertedAt || booking.createdAt || Date.now());
}

async function hasTrialCloseSignal(prisma, booking) {
    if (!booking?.convertedToStudentId) return false;

    const anchorDate = getTrialAnchorDate(booking);
    const membershipPromise = prisma.membership.findFirst({
        where: {
            studentId: booking.convertedToStudentId,
            type: { not: 'trial' },
            createdAt: { gte: anchorDate },
        },
        select: { id: true },
    });
    const paymentPromise = prisma.payment.findFirst({
        where: {
            studentId: booking.convertedToStudentId,
            status: 'completed',
            amount: { gt: 0 },
            paymentDate: { gte: anchorDate },
        },
        select: { id: true },
    });

    const [membership, payment] = await Promise.all([membershipPromise, paymentPromise]);
    return Boolean(membership || payment);
}

async function inferBookingLossStage(prisma, booking) {
    if (booking.appStatus === 'completed') return 'after_trial';

    if (booking.convertedToStudentId) {
        if (await hasTrialCloseSignal(prisma, booking)) return 'after_trial';
        if (booking.status === 'rejected') return 'after_trial';

        const deadline = getTrialAnchorDate(booking);
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

    if (await hasTrialCloseSignal(prisma, booking)) return 'after_trial';

    const allowedStages = new Set(['before_trial', 'on_trial', 'after_trial']);
    return allowedStages.has(booking.lossStage) ? booking.lossStage : inferred;
}

module.exports = { inferBookingLossStage, normalizeBookingLossStage, hasTrialCloseSignal };
