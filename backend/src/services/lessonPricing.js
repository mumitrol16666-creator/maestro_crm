const DEFAULT_LESSON_CHARGES = Object.freeze({
    individual: 4000,
    group: 1200,
    theory: 1000,
});

const HYBRID_GROUP_CHARGES = Object.freeze({
    hybrid_1m: 2250,
    hybrid_2m: 1750,
});

function getLessonChargeAmount(classRecord) {
    const explicitPrice = Number(classRecord?.price || 0);
    if (Number.isFinite(explicitPrice) && explicitPrice > 0) return Math.round(explicitPrice);
    return DEFAULT_LESSON_CHARGES[classRecord?.classType] || null;
}

function getMembershipType(membership) {
    return membership?.type || membership?.plan?.legacyType || null;
}

function getMembershipLessonChargeAmount(membership, classRecord) {
    const membershipType = getMembershipType(membership);
    if (Object.hasOwn(HYBRID_GROUP_CHARGES, membershipType)) {
        if (classRecord?.classType === 'individual') return DEFAULT_LESSON_CHARGES.individual;
        if (classRecord?.classType === 'theory') return DEFAULT_LESSON_CHARGES.theory;
        if (classRecord?.classType === 'group') return HYBRID_GROUP_CHARGES[membershipType];
    }
    return getLessonChargeAmount(classRecord);
}

module.exports = {
    DEFAULT_LESSON_CHARGES,
    HYBRID_GROUP_CHARGES,
    getLessonChargeAmount,
    getMembershipLessonChargeAmount,
};
