async function inferBookingLossStage(prisma, booking) {
    if (booking.appStatus === 'completed') return 'after_trial';

    if (booking.convertedToStudentId) {
        const trialMembership = await prisma.membership.findFirst({
            where: { bookingId: booking.id, type: 'trial' },
            select: { totalClasses: true, classesRemaining: true, classesUsed: true }
        });
        const trialWasUsed = trialMembership && (
            trialMembership.classesUsed > 0
            || trialMembership.classesRemaining < trialMembership.totalClasses
        );
        if (trialWasUsed) return 'after_trial';

        const attendedTrial = await prisma.classAttendee.findFirst({
            where: {
                studentId: booking.convertedToStudentId,
                attended: true,
                class: {
                    status: 'completed',
                    date: { gte: booking.convertedAt || booking.createdAt }
                }
            },
            select: { id: true }
        });
        if (attendedTrial) return 'after_trial';
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

module.exports = { inferBookingLossStage, normalizeBookingLossStage };
