// =====================================================
// Общие утилиты по ученикам: признак "потерянного", активность.
// Используется в routes/students.js, utils/pricing.js, routes/analytics.js.
//
// Правило (обновлено):
//   - "Потерянный" — у ученика нет платежей ≥ LOST_STUDENT_MONTHS (по умолчанию 3 мес).
//     Если платежей никогда не было, ученик считается потерянным только когда он
//     зарегистрирован более 3 месяцев назад (даём фору на первый платёж).
//   - "Возврат" фиксируется автоматически при поступлении нового платежа на
//     ученика, который на момент платежа был "потерянным". Кто внёс платёж —
//     тот и получает зачёт в статистику (см. utils/recovery.js).
// =====================================================
const { prisma } = require('../config/db');

const LOST_STUDENT_MONTHS = 3;

function getLostThresholdDate(now = new Date()) {
    const threshold = new Date(now);
    threshold.setMonth(threshold.getMonth() - LOST_STUDENT_MONTHS);
    threshold.setHours(0, 0, 0, 0);
    return threshold;
}

/**
 * Проверяет, активен ли ученик (не "потерян") на указанную дату.
 * Источник истины — последний платёж (включая пробный) ученика.
 */
async function isStudentActive(studentId, atDate = new Date(), tx = prisma) {
    if (!studentId) return false;
    const threshold = getLostThresholdDate(atDate);
    const lastPayment = await tx.payment.findFirst({
        where: { studentId },
        orderBy: { paymentDate: 'desc' },
        select: { paymentDate: true },
    });
    if (lastPayment?.paymentDate) {
        return new Date(lastPayment.paymentDate) >= threshold;
    }
    // Платежей не было никогда — новичкам даём фору в 3 месяца с регистрации
    const student = await tx.student.findUnique({
        where: { id: studentId },
        select: { createdAt: true },
    });
    if (!student) return false;
    return new Date(student.createdAt) >= threshold;
}

/**
 * Сколько активных (не потерянных) учеников в семье.
 */
async function countActiveFamilyMembers(familyId, tx = prisma) {
    if (!familyId) return 0;
    const threshold = getLostThresholdDate();
    // Активный = роль student и (последний платёж в окне 3мес) ИЛИ (платежей не было и createdAt >= threshold)
    const rows = await tx.$queryRaw`
        SELECT COUNT(*)::int AS cnt
        FROM "Student" s
        WHERE s."familyId" = ${familyId}
        AND s.role = 'student'
        AND (
            COALESCE(
                (SELECT MAX(p."paymentDate") FROM "Payment" p
                 WHERE p."studentId" = s.id AND p."paymentDate" IS NOT NULL),
                s."createdAt"
            ) >= ${threshold}
        )
    `;
    return rows && rows[0] ? Number(rows[0].cnt || 0) : 0;
}

module.exports = {
    LOST_STUDENT_MONTHS,
    getLostThresholdDate,
    isStudentActive,
    countActiveFamilyMembers,
};
