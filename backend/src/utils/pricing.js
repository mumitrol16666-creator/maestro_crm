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

function calculateProgramPrice(pricing, purchaseFormat = 'program', programMonths = 1) {
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
        return {
            lessonFormat: format,
            programMonths: 0,
            lessonCounts: { trial: 1, individual: 0, theory: 0, group: 0 },
            componentPrices: normalized,
            componentTotals: { trial: normalized.trial, individual: 0, theory: 0, group: 0 },
            lessonCount: 1,
            lessonPrice: normalized.trial,
            basePrice: normalized.trial,
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
    const totalPrice = componentTotals.individual + componentTotals.theory + componentTotals.group;
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
        totalPrice,
        undiscountedTotalPrice,
        programSavings: undiscountedTotalPrice - totalPrice,
        validityDays: program.validityDays,
    };
}

async function computeMembershipPrice({ directionId, lessonFormat, programMonths }, tx = prisma) {
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
        }, format, programMonths),
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
    const stored = Number(membership?.[fields[classType]] || 0);
    if (stored > 0) return stored;

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
    calculateProgramPrice,
    computeMembershipPrice,
    membershipLessonPrice,
    resolveMembershipPurchaseDates,
};
