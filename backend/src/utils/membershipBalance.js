function getMembershipLessonPrice(membership, fallbackPrice = 0) {
    if (membership?.billingModel === 'rate_card') {
        const prices = [...new Set(Object.values(membership.lessonRates || {}).map(row => row.price))];
        return prices.length === 1 ? prices[0] : 0;
    }
    const totalPrice = Number(membership?.totalPrice || membership?.plan?.price || 0);
    const totalClasses = Number(membership?.totalClasses || membership?.plan?.includedUnits || 0);
    if (totalPrice > 0 && totalClasses > 0) {
        return Math.round(totalPrice / totalClasses);
    }
    const fallback = Number(fallbackPrice || 0);
    return Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : 0;
}

function estimateLessonsFromBalance(balance, membership, fallbackPrice = 0) {
    const lessonPrice = getMembershipLessonPrice(membership, fallbackPrice);
    if (!lessonPrice) {
        return {
            lessonPrice: 0,
            estimatedLessonsRemaining: null,
        };
    }
    return {
        lessonPrice,
        estimatedLessonsRemaining: Math.floor(Number(balance || 0) / lessonPrice),
    };
}

function enrichMembershipBalance(membership, fallbackPrice = 0) {
    const balance = Number(membership?.student?.accountBalance || 0);
    const estimate = estimateLessonsFromBalance(balance, membership, fallbackPrice);
    return {
        ...membership,
        lessonPrice: estimate.lessonPrice,
        estimatedLessonsRemaining: estimate.estimatedLessonsRemaining,
        classesRemaining: membership.billingModel === 'rate_card' ? null : (membership.lessonFormat === 'program' || (membership.lessonFormat === 'individual' && membership.individualClassesRemaining !== null && membership.individualClassesRemaining !== undefined))
            ? membership.classesRemaining
            : estimate.estimatedLessonsRemaining,
        remainingAmount: balance,
        ...(membership.billingModel === 'rate_card' ? { startDate: null, endDate: null, totalClasses: null } : {}),
    };
}

module.exports = {
    getMembershipLessonPrice,
    estimateLessonsFromBalance,
    enrichMembershipBalance,
};
