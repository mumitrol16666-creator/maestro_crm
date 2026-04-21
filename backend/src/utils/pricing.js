// =====================================================
// Единый расчёт цены абонемента со скидками
// Используется в:
//   - POST /api/memberships (создание и продление)
//   - POST /api/bookings/:id/convert
//   - GET  /api/memberships/price-preview
// =====================================================
const { prisma } = require('../config/db');
const {
    LOST_STUDENT_MONTHS,
    getLostThresholdDate,
    isStudentActive,
    countActiveFamilyMembers,
} = require('./students');

// Конфигурация типов абонементов (база, до скидок).
// Поддерживается тот же набор, что и в routes/memberships.js.
const MEMBERSHIP_CONFIG = {
    trial:              { classes: 1,  days: 7,  price: 2000,  freezes: 0 },
    single_class:       { classes: 1,  days: 1,  price: 3500,  freezes: 0 },
    monthly:            { classes: 8,  days: 30, price: 22000, freezes: 1 },
    monthly_12:         { classes: 12, days: 30, price: 22000, freezes: 1 },
    quarterly:          { classes: 24, days: 90, price: 55000, freezes: 3 },
    individual_single:  { classes: 1,  days: 30, price: 10000, freezes: 0 },
    individual_package: { classes: 8,  days: 60, price: 55900, freezes: 1 },
};

// Скидки в % (зафиксированы бизнес-правилами).
const DISCOUNT_REFERRAL   = 5;
const DISCOUNT_FAMILY     = 5;
const DISCOUNT_CONCESSION = 10;

/**
 * Расчёт цены абонемента со скидками.
 *
 * @param {string} studentId
 * @param {string} type - ключ MEMBERSHIP_CONFIG
 * @param {Object} opts
 * @param {number} [opts.basePriceOverride] - ручная цена (приоритет над конфигом)
 * @param {boolean} [opts.skipConcession] - не применять льготу на этой покупке
 * @param {boolean} [opts.skipAllDiscounts] - вообще не применять скидки
 *        (когда админ задаёт итоговую сумму вручную)
 * @returns {Promise<{
 *   basePrice: number,
 *   totalPrice: number,
 *   discountPercent: number,
 *   discountReferralPercent: number,
 *   discountFamilyPercent: number,
 *   discountConcessionPercent: number,
 *   reasons: string[]
 * }>}
 */
async function computeMembershipPrice(studentId, type, opts = {}) {
    const config = MEMBERSHIP_CONFIG[type] || MEMBERSHIP_CONFIG.monthly;
    const basePrice = Number.isFinite(opts.basePriceOverride) && opts.basePriceOverride > 0
        ? Math.round(opts.basePriceOverride)
        : config.price;

    const reasons = [];
    let discountReferralPercent = 0;
    let discountFamilyPercent = 0;
    let discountConcessionPercent = 0;

    // Загружаем студента с нужными полями
    let student = null;
    if (studentId) {
        student = await prisma.student.findUnique({
            where: { id: studentId },
            select: {
                id: true,
                familyId: true,
                referredByStudentId: true,
                concessionType: true
            }
        });
    }

    // Явный отказ от любых скидок (когда админ ввёл финальную сумму руками)
    if (opts.skipAllDiscounts) {
        return {
            basePrice,
            totalPrice: basePrice,
            discountPercent: 0,
            discountReferralPercent: 0,
            discountFamilyPercent: 0,
            discountConcessionPercent: 0,
            reasons: []
        };
    }

    // ===== Реферальная скидка =====
    if (student && student.referredByStudentId) {
        const [currentActive, referrerActive] = await Promise.all([
            isStudentActive(student.id),
            isStudentActive(student.referredByStudentId)
        ]);
        if (currentActive && referrerActive) {
            discountReferralPercent = DISCOUNT_REFERRAL;
            reasons.push(`Реферал −${DISCOUNT_REFERRAL}%`);
        }
    }

    // ===== Семейная скидка =====
    if (student && student.familyId) {
        const activeInFamily = await countActiveFamilyMembers(student.familyId);
        if (activeInFamily >= 2) {
            discountFamilyPercent = DISCOUNT_FAMILY;
            reasons.push(`Семья −${DISCOUNT_FAMILY}%`);
        }
    }

    // ===== Льготная категория =====
    if (student && student.concessionType && !opts.skipConcession) {
        discountConcessionPercent = DISCOUNT_CONCESSION;
        reasons.push(`Льгота −${DISCOUNT_CONCESSION}%`);
    }

    const discountPercent = Math.min(
        100,
        discountReferralPercent + discountFamilyPercent + discountConcessionPercent
    );
    const totalPrice = Math.round(basePrice * (100 - discountPercent) / 100);

    return {
        basePrice,
        totalPrice,
        discountPercent,
        discountReferralPercent,
        discountFamilyPercent,
        discountConcessionPercent,
        reasons
    };
}

module.exports = {
    MEMBERSHIP_CONFIG,
    DISCOUNT_REFERRAL,
    DISCOUNT_FAMILY,
    DISCOUNT_CONCESSION,
    computeMembershipPrice,
    isStudentActive,
    countActiveFamilyMembers
};
