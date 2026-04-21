// =====================================================
// Единый расчёт цены абонемента со скидками
// Используется в:
//   - POST /api/memberships (создание и продление)
//   - POST /api/bookings/:id/convert
//   - GET  /api/memberships/price-preview
// =====================================================
const { prisma } = require('../config/db');

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

// Сколько месяцев без посещений = "потерян"
// (должно совпадать с LOST_STUDENT_MONTHS в routes/students.js)
const LOST_STUDENT_MONTHS = 3;

function getLostThresholdDate() {
    const threshold = new Date();
    threshold.setMonth(threshold.getMonth() - LOST_STUDENT_MONTHS);
    threshold.setHours(0, 0, 0, 0);
    return threshold;
}

/**
 * Проверяет, активен ли ученик (не "потерян"):
 * последнее посещённое занятие моложе 3 месяцев ИЛИ ученик создан < 3 мес. назад.
 */
async function isStudentActive(studentId) {
    if (!studentId) return false;
    const threshold = getLostThresholdDate();

    const rows = await prisma.$queryRaw`
        SELECT s.id,
               COALESCE(
                   (SELECT MAX(c.date) FROM "ClassAttendee" ca
                    JOIN "Class" c ON c.id = ca."classId"
                    WHERE ca."studentId" = s.id AND ca.attended = true),
                   s."createdAt"
               ) AS activity
        FROM "Student" s
        WHERE s.id = ${studentId}
        LIMIT 1
    `;
    if (!rows || rows.length === 0) return false;
    const activity = rows[0].activity ? new Date(rows[0].activity) : null;
    return !!activity && activity >= threshold;
}

/**
 * Сколько активных (не потерянных) учеников в семье.
 */
async function countActiveFamilyMembers(familyId) {
    if (!familyId) return 0;
    const threshold = getLostThresholdDate();
    const rows = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS cnt
        FROM "Student" s
        WHERE s."familyId" = ${familyId}
        AND s.role = 'student'
        AND COALESCE(
            (SELECT MAX(c.date) FROM "ClassAttendee" ca
             JOIN "Class" c ON c.id = ca."classId"
             WHERE ca."studentId" = s.id AND ca.attended = true),
            s."createdAt"
        ) >= ${threshold}
    `;
    return rows && rows[0] ? Number(rows[0].cnt || 0) : 0;
}

/**
 * Расчёт цены абонемента со скидками.
 *
 * @param {string} studentId
 * @param {string} type - ключ MEMBERSHIP_CONFIG
 * @param {Object} opts
 * @param {number} [opts.basePriceOverride] - ручная база (приоритет над конфигом)
 * @param {boolean} [opts.skipConcession] - не применять льготу на этой покупке
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
