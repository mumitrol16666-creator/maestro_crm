const { prisma } = require('../config/db');
const { PROGRAM_TERMS } = require('../config/officialCatalog');
const { getMembershipLessonChargeAmount } = require('../services/lessonPricing');

const LESSON_RATES = Object.freeze({
    trial: Object.freeze({ field: 'trialLessonPrice', price: 2000, durationMinutes: 30 }),
    group: Object.freeze({ field: 'groupLessonPrice', price: 2250, durationMinutes: 60 }),
    theory: Object.freeze({ field: 'theoryLessonPrice', price: 1000, durationMinutes: 60 }),
    individual: Object.freeze({ field: 'individualLessonPrice', price: 4000, durationMinutes: 60 }),
});

function normalizePurchaseFormat(value) {
    const format = String(value || '').trim().toLowerCase();
    if (!['trial', 'program'].includes(format)) {
        throw new Error('Выберите пробный урок или основную программу');
    }
    return format;
}

function normalizeProgramMonths(value) {
    const months = value === undefined || value === null || value === '' ? 1 : Number(value);
    if (!Number.isInteger(months) || !PROGRAM_TERMS[months]) {
        throw new Error('Выберите срок программы: 1 или 2 месяца');
    }
    return months;
}

function normalizeAdditionalDiscount(input = {}, baseProgramPrice, individualTotal, format) {
    const type = String(input.additionalDiscountType ?? 'none');
    if (!['none', 'percent', 'amount'].includes(type)) throw new Error('Выберите вид дополнительной скидки');
    const raw = input.additionalDiscountValue === '' || input.additionalDiscountValue == null ? '0' : String(input.additionalDiscountValue);
    const pattern = type === 'percent' ? /^\d+(?:\.\d{1,2})?$/ : /^\d+$/;
    if (!pattern.test(raw)) throw new Error(type === 'percent' ? 'Процент скидки должен иметь не более двух знаков после запятой' : 'Скидка в тенге должна быть целым неотрицательным числом');
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || (type === 'percent' && value > 100) || (type !== 'percent' && !Number.isSafeInteger(value))) {
        throw new Error('Некорректное значение дополнительной скидки');
    }
    if (type === 'none' && value !== 0) throw new Error('Для варианта без скидки укажите ноль');
    if (format === 'trial' && (type !== 'none' || value !== 0)) throw new Error('Дополнительная скидка доступна только для основной программы');
    const basisPoints = type === 'percent' ? Math.round(value * 100) : null;
    const amount = type === 'percent' ? Math.round(baseProgramPrice * basisPoints / 10000) : value;
    if (amount > individualTotal) throw new Error(`Дополнительная скидка не может превышать стоимость индивидуальных занятий: ${individualTotal} ₸`);
    const reason = String(input.additionalDiscountReason ?? '').trim();
    if (amount > 0 && !reason) throw new Error('Укажите причину дополнительной скидки');
    if (reason.length > 500) throw new Error('Причина скидки должна содержать не более 500 символов');
    return { type, value, basisPoints, amount, reason: amount > 0 ? reason : '' };
}

function calculateProgramPrice(pricing, purchaseFormat = 'program', programMonths = 1, additionalDiscount = {}) {
    const format = normalizePurchaseFormat(purchaseFormat);
    const normalized = Object.fromEntries(
        Object.entries(LESSON_RATES).map(([key, config]) => {
            const value = Number(pricing?.[key]);
            if (!Number.isInteger(value) || value <= 0) {
                throw new Error(`Некорректная цена формата ${key}`);
            }
            return [key, value];
        }),
    );

    if (format === 'trial') {
        normalizeAdditionalDiscount(additionalDiscount, normalized.trial, 0, format);
        return {
            lessonFormat: format,
            programMonths: 0,
            lessonCounts: { trial: 1, individual: 0, theory: 0, group: 0 },
            componentPrices: normalized,
            componentTotals: { trial: normalized.trial, individual: 0, theory: 0, group: 0 },
            lessonCount: 1,
            lessonPrice: normalized.trial,
            basePrice: normalized.trial,
            baseProgramPrice: normalized.trial,
            additionalDiscountType: 'none', additionalDiscountValue: 0,
            additionalDiscountAmount: 0, additionalDiscountReason: '', maxAdditionalDiscountAmount: 0,
            totalPrice: normalized.trial,
            validityDays: 7,
        };
    }

    const months = normalizeProgramMonths(programMonths);
    const program = PROGRAM_TERMS[months];
    const componentPrices = {
        ...normalized,
        individual: normalized.individual - program.individualDiscountPerLesson,
    };
    if (componentPrices.individual <= 0) {
        throw new Error('Цена индивидуального урока меньше скидки двухмесячной программы');
    }
    const componentTotals = {
        trial: 0,
        individual: componentPrices.individual * program.individual,
        theory: componentPrices.theory * program.theory,
        group: componentPrices.group * program.group,
    };
    const lessonCount = program.individual + program.theory + program.group;
    const baseProgramPrice = componentTotals.individual + componentTotals.theory + componentTotals.group;
    const discount = normalizeAdditionalDiscount(additionalDiscount, baseProgramPrice, componentTotals.individual, format);
    const maxAdditionalDiscountAmount = componentTotals.individual;
    componentTotals.individual -= discount.amount;
    componentPrices.individual = Math.floor(componentTotals.individual / program.individual);
    const remainder = componentTotals.individual % program.individual;
    const totalPrice = baseProgramPrice - discount.amount;
    const undiscountedTotalPrice = (normalized.individual * program.individual)
        + (normalized.theory * program.theory)
        + (normalized.group * program.group);

    return {
        lessonFormat: format,
        programMonths: months,
        lessonCounts: {
            trial: 0,
            individual: program.individual,
            theory: program.theory,
            group: program.group,
        },
        componentPrices,
        componentTotals,
        lessonCount,
        lessonPrice: Math.round(totalPrice / lessonCount),
        basePrice: totalPrice,
        baseProgramPrice,
        additionalDiscountType: discount.type,
        additionalDiscountValue: discount.value,
        additionalDiscountBasisPoints: discount.basisPoints,
        additionalDiscountAmount: discount.amount,
        additionalDiscountReason: discount.reason,
        maxAdditionalDiscountAmount,
        individualAllocation: {
            lessonCount: program.individual, totalAmount: componentTotals.individual,
            lowerPrice: componentPrices.individual,
            higherPrice: componentPrices.individual + (remainder > 0 ? 1 : 0),
            higherPriceLessonCount: remainder,
            lowerPriceLessonCount: program.individual - remainder,
        },
        totalPrice,
        undiscountedTotalPrice,
        programSavings: undiscountedTotalPrice - baseProgramPrice,
        validityDays: program.validityDays,
    };
}

async function computeMembershipPrice({ directionId, lessonFormat, programMonths, ...additionalDiscount }, tx = prisma) {
    if (!directionId) throw new Error('Выберите направление');

    const format = normalizePurchaseFormat(lessonFormat);
    const direction = await tx.direction.findUnique({
        where: { id: directionId },
        select: {
            id: true,
            isActive: true,
            trialLessonPrice: true,
            groupLessonPrice: true,
            theoryLessonPrice: true,
            individualLessonPrice: true,
        },
    });

    if (!direction || !direction.isActive) {
        throw new Error('Направление не найдено или отключено');
    }

    return {
        directionId: direction.id,
        ...calculateProgramPrice({
            trial: direction.trialLessonPrice,
            group: direction.groupLessonPrice,
            theory: direction.theoryLessonPrice,
            individual: direction.individualLessonPrice,
        }, format, programMonths, additionalDiscount),
    };
}

function membershipLessonPrice(membership, classType, fallback = 0) {
    if (membership?.lessonFormat !== 'program' && membership?.lessonFormat !== 'trial') {
        return getMembershipLessonChargeAmount(membership, { classType, price: fallback }) ?? Number(fallback || 0);
    }
    const fields = {
        group: 'groupLessonPrice',
        theory: 'theoryLessonPrice',
        individual: 'individualLessonPrice',
        trial: 'lessonPrice',
    };
    const rawStored = membership?.[fields[classType]];
    const stored = Number(rawStored);
    if (rawStored !== null && rawStored !== undefined && Number.isFinite(stored) && stored >= 0) return stored;

    const average = Number(membership?.lessonPrice || 0)
        || (Number(membership?.totalClasses) > 0
            ? Math.round(Number(membership.totalPrice || 0) / Number(membership.totalClasses))
            : 0);
    return average > 0 ? average : Number(fallback || 0);
}

function resolveMembershipPurchaseDates({ previousMembership, startDate, validityDays, now = new Date() }) {
    const currentTime = new Date(now);
    let start;
    let end;
    if (previousMembership) {
        const previousEnd = new Date(previousMembership.endDate);
        if (!Number.isFinite(previousEnd.getTime())) throw new Error('Некорректная дата окончания продлеваемого абонемента');
        start = new Date(Math.max(previousEnd.getTime(), currentTime.getTime()));
        end = new Date(start);
        end.setDate(end.getDate() + validityDays);
    } else {
        start = startDate ? new Date(startDate) : currentTime;
        end = new Date(start);
        end.setDate(end.getDate() + validityDays);
    }
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
        throw new Error('Укажите корректные даты: окончание должно быть позже начала');
    }
    return { start, end };
}

module.exports = {
    MEMBERSHIP_CONFIG: Object.freeze({ trial: { classes: 1, days: 7, price: 2000, freezes: 0 }, program: { classes: 10, days: 30, price: 27000, freezes: 0 } }),
    LESSON_RATES,
    normalizePurchaseFormat,
    normalizeProgramMonths,
    normalizeAdditionalDiscount,
    calculateProgramPrice,
    computeMembershipPrice,
    membershipLessonPrice,
    resolveMembershipPurchaseDates,
};
