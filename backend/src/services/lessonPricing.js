const { DEFAULT_LESSON_PRICING } = require('../config/officialCatalog');

// Последний резерв, когда у абонемента нет ни снапшота, ни цены покупки.
// Реальные цены живут в направлении и в снапшоте абонемента.
const DEFAULT_LESSON_CHARGES = Object.freeze({
    individual: 4000,
    group: 1200,
    theory: 1000,
});

// Старые гибридные пакеты (lessonFormat = mixed) без снапшотов цен.
// Значения равны distributePlanPrice() по составу пакета и сохранены, чтобы
// не менять уже идущие списания до бэкфилла снапшотов.
const HYBRID_GROUP_CHARGES = Object.freeze({
    hybrid_1m: 2250,
    hybrid_2m: 1750,
    hybrid_3m: 1750,
    hybrid_6m: 1750,
    hybrid_10m: 1750,
});

const SNAPSHOT_FIELDS = Object.freeze({
    individual: 'individualLessonPrice',
    group: 'groupLessonPrice',
    theory: 'theoryLessonPrice',
});

const SNAPSHOT_FORMATS = new Set(['program', 'individual']);

function toNonNegativeInteger(value) {
    if (value === null || value === undefined) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    return Math.round(number);
}

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

function getMembershipSnapshotPrice(membership, classType) {
    const field = SNAPSHOT_FIELDS[classType];
    return field ? toNonNegativeInteger(membership?.[field]) : null;
}

/**
 * Средняя цена одного урока по фактической покупке абонемента.
 * Это уже итоговая цена со скидкой: totalPrice хранится после скидки.
 * null означает, что данных о покупке нет и нужен резервный расчёт.
 */
function getMembershipAverageLessonPrice(membership) {
    const stored = Number(membership?.lessonPrice);
    if (Number.isFinite(stored) && stored > 0) return Math.round(stored);

    const totalPrice = Number(membership?.totalPrice);
    const totalClasses = Number(membership?.totalClasses);
    if (!Number.isInteger(totalClasses) || totalClasses <= 0) return null;
    if (!Number.isFinite(totalPrice) || totalPrice < 0) return null;
    if (totalPrice === 0) {
        // Нулевая покупка это либо стопроцентная скидка (есть basePrice),
        // либо незаполненная старая запись. Второе не считаем бесплатным.
        const basePrice = Number(membership?.basePrice);
        return Number.isFinite(basePrice) && basePrice > 0 ? 0 : null;
    }
    return Math.round(totalPrice / totalClasses);
}

/**
 * Распределение стоимости тарифа по видам уроков.
 * Фиксированные виды (индивидуальный, теория) берут цену направления,
 * остаток тарифа делится на групповые уроки. Однородный тариф делится поровну.
 * Возвращает целые цены или null для видов, которых в тарифе нет.
 */
function distributePlanPrice(plan, directionPrices = {}) {
    const fixed = {
        individual: toNonNegativeInteger(directionPrices.individual) ?? DEFAULT_LESSON_PRICING.individual,
        theory: toNonNegativeInteger(directionPrices.theory) ?? DEFAULT_LESSON_PRICING.theory,
    };
    const result = { individual: null, group: null, theory: null, trial: null };

    const price = toNonNegativeInteger(plan?.price);
    if (price === null) return result;
    const format = String(plan?.lessonFormat || '').trim().toLowerCase();
    const legacyType = String(plan?.legacyType || plan?.type || '').trim().toLowerCase();

    if (format === 'trial' || legacyType === 'trial') {
        result.trial = price;
        return result;
    }

    if (format === 'mixed') {
        const individual = toNonNegativeInteger(plan?.individualClasses) || 0;
        const group = toNonNegativeInteger(plan?.groupClasses) || 0;
        const theory = toNonNegativeInteger(plan?.theoryClasses) || 0;
        if (individual > 0) result.individual = fixed.individual;
        if (theory > 0) result.theory = fixed.theory;
        if (group > 0) {
            const remainder = price - individual * fixed.individual - theory * fixed.theory;
            result.group = remainder >= 0 ? Math.round(remainder / group) : null;
        }
        return result;
    }

    const units = toNonNegativeInteger(plan?.includedUnits ?? plan?.classes);
    if (!units) return result;
    const unitPrice = Math.round(price / units);
    if (format === 'individual') result.individual = unitPrice;
    else if (legacyType === 'theory') result.theory = unitPrice;
    else result.group = unitPrice;
    return result;
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
    const classType = classRecord?.classType;
    const lessonFormat = membership?.lessonFormat;

    if (['program', 'individual'].includes(lessonFormat) && classType === 'individual'
        && membership.individualBudgetRemaining !== null && membership.individualBudgetRemaining !== undefined
        && Number.isInteger(membership.individualClassesRemaining) && membership.individualClassesRemaining > 0) {
        const budget = Number(membership.individualBudgetRemaining);
        if (!Number.isSafeInteger(budget) || budget < 0) throw new Error('Некорректный остаток стоимости индивидуальных занятий');
        return Math.floor(budget / membership.individualClassesRemaining);
    }

    const snapshot = getMembershipSnapshotPrice(membership, classType);
    // New program snapshots are final purchase prices, including any discount.
    if (SNAPSHOT_FORMATS.has(lessonFormat) && snapshot !== null) return snapshot;

    // Старые гибриды (mixed) до бэкфилла считаются только по таблице пакетов:
    // их исторические снапшоты прошлый релиз не читал, и менять списания нельзя.
    const isLegacyHybrid = lessonFormat === 'mixed' || Object.hasOwn(HYBRID_GROUP_CHARGES, getMembershipType(membership));

    if (!SNAPSHOT_FORMATS.has(lessonFormat) && !isLegacyHybrid) {
        // Однородные абонементы (дуо, квартет, теория, старые групповые):
        // цена урока это цена самого абонемента, а не константа по типу занятия.
        if (snapshot !== null) return snapshot;
        if (classType === 'group') {
            const average = getMembershipAverageLessonPrice(membership);
            if (average !== null) return average;
        }
    }

    const baseCharge = getMembershipLessonBaseChargeAmount(membership, classRecord);
    if (baseCharge === null || baseCharge === undefined) return null;
    return Math.max(0, Math.round(baseCharge * getMembershipDiscountFactor(membership)));
}

module.exports = {
    DEFAULT_LESSON_CHARGES,
    HYBRID_GROUP_CHARGES,
    distributePlanPrice,
    getLessonChargeAmount,
    getMembershipAverageLessonPrice,
    getMembershipDiscountFactor,
    getMembershipLessonBaseChargeAmount,
    getMembershipLessonChargeAmount,
};
