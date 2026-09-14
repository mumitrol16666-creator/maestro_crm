const DEFAULT_LESSON_CHARGES = Object.freeze({
    individual: 4000,
    group: 1200,
    theory: 1000,
});

const HYBRID_GROUP_CHARGES = Object.freeze({
    hybrid_1m: 2250,
    hybrid_2m: 1750,
    hybrid_3m: 1750,
    hybrid_6m: 1750,
    hybrid_10m: 1750,
});

function getLessonChargeAmount(classRecord) {
    const explicitPrice = Number(classRecord?.price || 0);
    if (Number.isFinite(explicitPrice) && explicitPrice > 0) return Math.round(explicitPrice);
    return DEFAULT_LESSON_CHARGES[classRecord?.classType] || null;
}

function getMembershipType(membership) {
    return membership?.type || membership?.plan?.legacyType || null;
}

function getMembershipDiscountFactor(membership) {
    const basePrice = Number(membership?.basePrice);
    const totalPrice = Number(membership?.totalPrice);

    // The price pair is the authoritative discount snapshot. It is more precise
    // than discountPercent, which is stored as a rounded whole number.
    if (
        Number.isFinite(basePrice)
        && basePrice > 0
        && Number.isFinite(totalPrice)
        && totalPrice >= 0
        && totalPrice < basePrice
    ) {
        return totalPrice / basePrice;
    }

    // Older and extended memberships may not have a usable price pair, but do
    // retain the discount percentage from their latest purchase.
    const discountPercent = Number(membership?.discountPercent);
    if (Number.isFinite(discountPercent) && discountPercent > 0) {
        return (100 - Math.min(100, discountPercent)) / 100;
    }

    return 1;
}

function getMembershipLessonBaseChargeAmount(membership, classRecord) {
    const membershipType = getMembershipType(membership);
    if (Object.hasOwn(HYBRID_GROUP_CHARGES, membershipType)) {
        if (classRecord?.classType === 'individual') return DEFAULT_LESSON_CHARGES.individual;
        if (classRecord?.classType === 'theory') return DEFAULT_LESSON_CHARGES.theory;
        if (classRecord?.classType === 'group') return HYBRID_GROUP_CHARGES[membershipType];
    }
    return getLessonChargeAmount(classRecord);
}

function getMembershipLessonChargeAmount(membership, classRecord) {
    if (['program', 'individual'].includes(membership?.lessonFormat) && classRecord?.classType === 'individual'
        && membership.individualBudgetRemaining !== null && membership.individualBudgetRemaining !== undefined
        && Number.isInteger(membership.individualClassesRemaining) && membership.individualClassesRemaining > 0) {
        const budget = Number(membership.individualBudgetRemaining);
        if (!Number.isSafeInteger(budget) || budget < 0) throw new Error('Некорректный остаток стоимости индивидуальных занятий');
        return Math.floor(budget / membership.individualClassesRemaining);
    }
    const snapshotField = {
        individual: 'individualLessonPrice',
        group: 'groupLessonPrice',
        theory: 'theoryLessonPrice',
    }[classRecord?.classType];
    const snapshot = snapshotField ? membership?.[snapshotField] : null;
    // New program snapshots are final purchase prices, including any discount.
    // Historical rows may contain dormant snapshots that the previous release
    // never read; preserve its type/class-price/discount calculation for them.
    if (['program', 'individual'].includes(membership?.lessonFormat)
        && snapshot !== null && snapshot !== undefined && Number.isFinite(Number(snapshot)) && Number(snapshot) >= 0) {
        return Math.round(Number(snapshot));
    }
    const baseCharge = getMembershipLessonBaseChargeAmount(membership, classRecord);
    if (baseCharge === null || baseCharge === undefined) return null;
    return Math.max(0, Math.round(baseCharge * getMembershipDiscountFactor(membership)));
}

module.exports = {
    DEFAULT_LESSON_CHARGES,
    HYBRID_GROUP_CHARGES,
    getLessonChargeAmount,
    getMembershipDiscountFactor,
    getMembershipLessonBaseChargeAmount,
    getMembershipLessonChargeAmount,
};
