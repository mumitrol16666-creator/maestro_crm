// =====================================================
// Общие утилиты по ученикам: признак "потерянного", активность.
// Используется в routes/students.js, utils/pricing.js, routes/analytics.js.
// =====================================================
const { prisma } = require('../config/db');

// Сколько месяцев без посещений = "потерян"
const LOST_STUDENT_MONTHS = 3;

function getLostThresholdDate(now = new Date()) {
    const threshold = new Date(now);
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

module.exports = {
    LOST_STUDENT_MONTHS,
    getLostThresholdDate,
    isStudentActive,
    countActiveFamilyMembers,
};
