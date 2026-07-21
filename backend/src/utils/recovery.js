// =====================================================
// Авто-фиксация возврата потерянного ученика.
//
// Правило:
//   - "Потерянный" ученик = последний платёж ≥ 3 мес назад
//     (или платежей никогда не было и зарегистрирован > 3 мес назад).
//   - Любой новый платёж такого ученика — это ВОЗВРАТ.
//     Автору платежа (admin / sales_manager) зачитывается в статистику
//     через запись в StudentRecovery.
//
// Функция вызывается ПЕРЕД созданием нового платежа — чтобы детект
// "был ли потерян" работал на прошлом состоянии.
// =====================================================
const { prisma } = require('../config/db');
const { getLostThresholdDate } = require('./students');

/**
 * @param {string} studentId
 * @param {string} actorUserId - id пользователя, вносящего платёж (req.user.id)
 * @param {object} [opts]
 * @param {Date}   [opts.atDate]  - дата нового платежа (по умолчанию now)
 * @param {string} [opts.note]    - комментарий к возврату
 * @param {string} [opts.source]  - источник (payment | new_membership | ...)
 * @param {import('@prisma/client').Prisma.TransactionClient} [opts.tx]
 * @returns {Promise<boolean>} true, если возврат был зафиксирован
 */
async function autoRecoverStudent(studentId, actorUserId, opts = {}) {
    if (!studentId || !actorUserId) return false;
    const client = opts.tx || prisma;
    try {
        const atDate = opts.atDate || new Date();
        const threshold = getLostThresholdDate(atDate);

        // Был ли у ученика хоть один платёж в окне 3 месяцев ДО нового?
        const recent = await client.payment.findFirst({
            where: {
                studentId,
                paymentDate: { gte: threshold, lte: atDate },
            },
            select: { id: true },
        });
        if (recent) return false; // ученик активен — это не возврат

        // Нет платежей в окне: посмотрим историю + дату регистрации.
        const anyPast = await client.payment.findFirst({
            where: { studentId, paymentDate: { lt: threshold } },
            select: { id: true },
        });
        if (!anyPast) {
            const st = await client.student.findUnique({
                where: { id: studentId },
                select: { createdAt: true },
            });
            // Новичок (зарегистрирован < 3 мес назад) не считается "вернувшимся"
            if (!st || new Date(st.createdAt) >= threshold) return false;
        }

        const noteSuffix = opts.source ? ` · ${opts.source}` : '';
        const note = `${opts.note || 'Возврат по платежу'}${noteSuffix}`.slice(0, 500);

        await client.studentRecovery.create({
            data: {
                studentId,
                recoveredByUserId: actorUserId,
                note,
                recoveredAt: atDate,
            },
        });

        // Сбросим legacy-поля ручной отметки, если они были установлены ранее.
        await client.student.update({
            where: { id: studentId },
            data: {
                lostAt: null,
                lostReason: null,
                lostMarkedById: null,
                pausedUntil: null,
                status: 'active',
            },
        }).catch(() => {});
        return true;
    } catch (err) {
        console.error('autoRecoverStudent error:', err);
        return false;
    }
}

module.exports = { autoRecoverStudent };
