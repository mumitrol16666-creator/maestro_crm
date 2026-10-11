const { autoRecoverStudent } = require('../utils/recovery');
const { recordBalanceMovement } = require('./studentBalanceLedger');
const { createCashTransaction } = require('./cashTelegramNotifications');
const { syncFirstPaymentBonusForStudent } = require('./payroll');
const formatPaymentPersonName = person => [person.lastName, person.name, person.middleName].filter(Boolean).join(' ');
// Caller owns the transaction and its durable operation key.
async function recordReceivedPayment(tx, { studentId, parsedAmount, normalizedType, actorId, teacherId,
    notes, paymentDate, normalizedPaymentMethod }) {
    const lockedStudents = await tx.$queryRaw`
        SELECT id, name, "lastName", "middleName", "accountBalance" FROM "Student" WHERE id = ${studentId} AND role = 'student' FOR UPDATE
    `;
    const student = lockedStudents[0];
    if (!student) {
        const error = new Error('Ученик не найден');
        error.code = 'STUDENT_NOT_FOUND';
        error.statusCode = 404;
        throw error;
    }

    await autoRecoverStudent(studentId, actorId, {
        tx, source: 'payment', atDate: paymentDate,
        note: `Платёж ${parsedAmount}₸ (${normalizedType})`,
    });

    const created = await tx.payment.create({
        data: {
            studentId,
            amount: parsedAmount,
            type: normalizedType,
            membershipId: null,
            managerId: actorId,
            teacherId: teacherId || null,
            notes: notes || '',
            status: 'completed',
            paymentDate,
            paymentMethod: normalizedPaymentMethod
        }
    });

    // Денежный баланс независим от абонемента: любое зачисление пополняет его.
    await recordBalanceMovement(tx, {
        studentId, amount: parsedAmount, kind: 'payment', sourceType: 'payment', sourceId: created.id,
        actorId: actorId, reason: notes?.trim() || 'Полученная оплата обучения',
        operationKey: `payment:${created.id}`, effectiveAt: created.paymentDate,
    });

    // Создаем запись в кассе
    await createCashTransaction(tx, {
        type: 'income',
        amount: parsedAmount,
        category: 'payment',
        description: `Оплата обучения: ${formatPaymentPersonName(student)}`.trim(),
        date: created.paymentDate,
        createdById: actorId,
        relatedPaymentId: created.id,
        paymentMethod: normalizedPaymentMethod,
        notes: notes || ''
    });

    // Реальные деньги на балансе закрывают пробную заявку как продажу.
    await tx.booking.updateMany({
        where: {
            convertedToStudentId: studentId,
            requestType: 'trial',
            status: { not: 'sold' },
        },
        data: {
            status: 'sold',
            trialFunnelStage: 'sold',
            trialNextAction: 'none',
            trialNextActionAt: null,
            lossReason: null,
            lossStage: null,
            lostAt: null,
        },
    });

    await syncFirstPaymentBonusForStudent(tx, studentId);
    return created;
}
module.exports = { recordReceivedPayment };
