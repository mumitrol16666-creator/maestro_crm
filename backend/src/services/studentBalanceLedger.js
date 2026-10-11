const { createHash } = require('node:crypto');
const { financialError } = require('./financialRequest');
const { parseMoney, MAX_MONEY_AMOUNT } = require('./paymentPolicy');

const MOVEMENT_KINDS = new Set(['payment', 'payment_correction', 'payment_refund', 'payment_cancellation',
    'lesson_charge', 'lesson_reversal', 'manual_adjustment']);

// Inserting the immutable entry is the only balance write. DB triggers compute
// before/after under the student row lock and apply the balance atomically.
async function recordBalanceMovement(db, input) {
    // The caller supplies its existing transaction. Prisma's adapter client can
    // expose $transaction on tx too; never infer transaction ownership from it.
    const amount = parseMoney(input.amount, { min: -MAX_MONEY_AMOUNT });
    if (!MOVEMENT_KINDS.has(input.kind) || !input.studentId || !input.sourceType || !input.sourceId
        || typeof input.operationKey !== 'string' || !input.operationKey.trim()
        || typeof input.reason !== 'string' || !input.reason.trim()) {
        throw financialError('Недостаточно данных для движения баланса', 'INVALID_BALANCE_MOVEMENT');
    }
    const data = {
        studentId: input.studentId, amount, kind: input.kind, sourceType: input.sourceType, sourceId: input.sourceId,
        actorId: input.actorId || null, reason: input.reason.trim(), operationKey: input.operationKey,
        needsReview: Boolean(input.needsReview), reversalOfId: input.reversalOfId || null,
        ...(input.metadata ? { metadata: input.metadata } : {}),
        ...(input.effectiveAt ? { effectiveAt: new Date(input.effectiveAt) } : {}),
    };
    const requestHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const [student] = await db.$queryRaw`SELECT id, role, "accountBalance" FROM "Student" WHERE id = ${input.studentId} FOR UPDATE`;
    if (!student || student.role !== 'student') throw financialError('Ученик не найден', 'STUDENT_NOT_FOUND', 404);
    const existing = await db.studentBalanceEntry.findUnique({ where: { operationKey: data.operationKey } });
    if (existing) {
        if (existing.requestHash !== requestHash) throw financialError('Ключ движения уже использован с другими данными', 'BALANCE_MOVEMENT_CONFLICT', 409);
        return existing;
    }
    if (amount === 0) return { balanceBefore: student.accountBalance, balanceAfter: student.accountBalance, amount: 0 };
    return db.studentBalanceEntry.create({ data: { ...data, requestHash } });
}

async function reverseLessonBalance(db, { attendee, classRecord, actorId, reason }) {
    const amount = Number(attendee.chargeAmount || 0);
    if (amount <= 0) return null;
    await db.$queryRaw`SELECT id FROM "Student" WHERE id = ${attendee.studentId} FOR UPDATE`;
    const charges = await db.studentBalanceEntry.findMany({ where: {
        studentId: attendee.studentId, sourceType: 'class', sourceId: classRecord.id,
        kind: 'lesson_charge', reversal: { is: null },
    }, orderBy: { position: 'asc' } });
    if (charges.length) {
        if (charges.reduce((sum, entry) => sum - entry.amount, 0) !== amount) {
            throw financialError('Сумма списания урока расходится с журналом. Нужна проверка администратора.', 'LESSON_BALANCE_MISMATCH', 409);
        }
        let reversal;
        for (const charge of charges) {
            reversal = await recordBalanceMovement(db, {
                studentId: attendee.studentId, amount: -charge.amount, kind: 'lesson_reversal',
                sourceType: 'class', sourceId: classRecord.id, actorId, reason,
                operationKey: `lesson-reversal:${charge.id}`, reversalOfId: charge.id,
                metadata: { attendeeId: attendee.id },
            });
        }
        return reversal;
    }
    const previous = await db.studentBalanceEntry.findFirst({ where: {
        studentId: attendee.studentId, sourceType: 'class', sourceId: classRecord.id,
        kind: { in: ['lesson_charge', 'lesson_reversal'] },
    } });
    if (previous) throw financialError('Возврат урока уже записан, но отметка списания не совпадает с журналом.', 'LESSON_BALANCE_MISMATCH', 409);
    // A pre-cutover charge is already part of the opening balance. Refund only
    // its recorded amount; do not infer a historic price from today's tariff.
    return recordBalanceMovement(db, {
        studentId: attendee.studentId, amount, kind: 'lesson_reversal', sourceType: 'class', sourceId: classRecord.id,
        actorId, reason, operationKey: `legacy-lesson-reversal:${attendee.id}`, needsReview: true,
        metadata: { attendeeId: attendee.id, legacyCharge: true },
    });
}

module.exports = { recordBalanceMovement, reverseLessonBalance };
