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
    individual_package: { classes: 8,  days: 365, price: 55900, freezes: 0 },
    hybrid_1m:          { classes: 10, individualClasses: 4, groupClasses: 4, theoryClasses: 2, days: 31, price: 27000, freezes: 0, emergencyFreezes: 0 },
    hybrid_2m:          { classes: 20, individualClasses: 8, groupClasses: 8, theoryClasses: 4, days: 60, price: 50000, freezes: 1, emergencyFreezes: 2 },
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
async function computeMembershipPrice(studentId, type, opts = {}, tx = prisma) {
    const config = MEMBERSHIP_CONFIG[type] || MEMBERSHIP_CONFIG.monthly;
    
    let defaultPrice = config.price;
    if (opts.directionPlanId) {
        const plan = await tx.directionPlan.findUnique({
            where: { id: opts.directionPlanId },
            select: { price: true, isActive: true },
        });
        if (!plan || !plan.isActive) {
            throw new Error('Выбранный тариф не найден или отключён');
        }
        defaultPrice = plan.price;
    } else if (opts.groupId) {
        const group = await tx.group.findUnique({ where: { id: opts.groupId }, select: { direction: true } });
        if (group && group.direction) {
            // Ищем активный план для этого направления и типа
            const plan = await tx.directionPlan.findFirst({
                where: {
                    direction: { name: group.direction },
                    type: type,
                    isActive: true
                }
            });
            
            if (plan) {
                defaultPrice = plan.price;
            } else {
                // Фоллбэк на легаси поля если план не найден (для обратной совместимости)
                const dir = await tx.direction.findUnique({ where: { name: group.direction }, select: { pricingTrial: true, pricingMonth: true, pricingThreeMonths: true } });
                if (dir) {
                    if (type === 'trial') defaultPrice = dir.pricingTrial || 2000;
                    if (type === 'monthly' || type === 'monthly_12') defaultPrice = dir.pricingMonth || 22000;
                    if (type === 'quarterly') defaultPrice = dir.pricingThreeMonths || 55000;
                }
            }
        }
    }

    const basePrice = Number.isFinite(opts.basePriceOverride) && opts.basePriceOverride > 0
        ? Math.round(opts.basePriceOverride)
        : defaultPrice;

    const reasons = [];
    let discountReferralPercent = 0;
    let discountFamilyPercent = 0;
    let discountConcessionPercent = 0;
    const discountManualPercent = Math.max(0, Math.min(100, Math.round(Number(opts.manualDiscountPercent) || 0)));

    // Загружаем студента с нужными полями
    let student = null;
    if (studentId) {
        student = await tx.student.findUnique({
            where: { id: studentId },
            select: {
                id: true,
                familyId: true,
                referredByStudentId: true,
                referredByBookingId: true,
                concessionType: true
            }
        });
    }

    const manualOnlyDiscountPercent = Math.max(0, Math.min(100, Math.round(Number(opts.manualDiscountPercent) || 0)));

    // Явный отказ от автоматических скидок. Ручная скидка администратора
    // остается доступной для формы создания абонемента.
    if (opts.skipAllDiscounts) {
        const totalPrice = Math.round(basePrice * (100 - manualOnlyDiscountPercent) / 100);
        return {
            basePrice,
            totalPrice,
            discountPercent: manualOnlyDiscountPercent,
            discountReferralPercent: 0,
            discountFamilyPercent: 0,
            discountConcessionPercent: 0,
            discountManualPercent: manualOnlyDiscountPercent,
            reasons: manualOnlyDiscountPercent > 0 ? [`Дополнительная скидка −${manualOnlyDiscountPercent}%`] : []
        };
    }

    // ===== Реферальная скидка =====
    let hasActiveReferral = false;

    // 1. Проверяем, был ли ученик кем-то приглашён и активны ли оба
    if (student && (student.referredByStudentId || student.referredByBookingId)) {
        let referrerActive = false;
        if (student.referredByStudentId) {
            referrerActive = await isStudentActive(student.referredByStudentId, new Date(), tx);
        } else if (student.referredByBookingId) {
            const booking = await tx.booking.findUnique({
                where: { id: student.referredByBookingId },
                select: { status: true }
            });
            if (booking && ['new', 'processed', 'trial'].includes(booking.status)) {
                referrerActive = true;
            }
        }
        
        const currentActive = await isStudentActive(student.id, new Date(), tx);
        if (currentActive && referrerActive) {
            hasActiveReferral = true;
        }
    } else if (opts.previewReferrerId) {
        // Preview mode: studentId ещё не существует, но уже выбран реферер
        let referrerActive = false;
        if (opts.previewReferrerId.startsWith('booking_')) {
            const bId = opts.previewReferrerId.replace('booking_', '');
            const booking = await tx.booking.findUnique({
                where: { id: bId },
                select: { status: true }
            });
            if (booking && ['new', 'processed', 'trial'].includes(booking.status)) {
                referrerActive = true;
            }
        } else {
            referrerActive = await isStudentActive(opts.previewReferrerId, new Date(), tx);
        }
        if (referrerActive) {
            hasActiveReferral = true;
        }
    }

    // 2. Проверяем, приглашал ли этот ученик кого-то (кто сейчас активен)
    if (student && !hasActiveReferral) {
        const referrals = await tx.student.findMany({
            where: { referredByStudentId: student.id },
            select: { id: true }
        });
        for (const ref of referrals) {
            if (await isStudentActive(ref.id, new Date(), tx)) {
                hasActiveReferral = true;
                break;
            }
        }

        // Если все еще нет активного реферала среди учеников, проверяем заявки, которые сослались на этого ученика
        if (!hasActiveReferral) {
            const pendingBookings = await tx.booking.findFirst({
                where: {
                    referrerStudentId: student.id,
                    status: { in: ['new', 'processed', 'trial'] }
                },
                select: { id: true }
            });
            if (pendingBookings) {
                hasActiveReferral = true;
            }
        }
    }

    if (hasActiveReferral) {
        discountReferralPercent = DISCOUNT_REFERRAL;
        reasons.push(`Реферал −${DISCOUNT_REFERRAL}%`);
    }

    // ===== Семейная скидка =====
    if (student && student.familyId) {
        const activeInFamily = await countActiveFamilyMembers(student.familyId, tx);
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
    if (discountManualPercent > 0) {
        reasons.push(`Дополнительная скидка −${discountManualPercent}%`);
    }

    const discountPercent = Math.min(
        100,
        discountReferralPercent + discountFamilyPercent + discountConcessionPercent + discountManualPercent
    );
    const totalPrice = Math.round(basePrice * (100 - discountPercent) / 100);

    return {
        basePrice,
        totalPrice,
        discountPercent,
        discountReferralPercent,
        discountFamilyPercent,
        discountConcessionPercent,
        discountManualPercent,
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
