const { randomUUID } = require('node:crypto');
const { recordBalanceMovement } = require('../../src/services/studentBalanceLedger');

// Test setup also respects the production balance guard. No disabled triggers
// or undocumented bypass flag: fixtures are explicit technical adjustments.
async function updateTestStudent(db, options) {
    return db.$transaction(tx => applyTestStudentState(tx, options));
}

async function applyTestStudentState(db, options) {
    const { accountBalance, ...data } = options.data;
    if (accountBalance !== undefined) {
        const current = await db.student.findUniqueOrThrow({ where: options.where });
        await recordBalanceMovement(db, {
            studentId: current.id, amount: accountBalance - current.accountBalance, kind: 'manual_adjustment',
            sourceType: 'test_fixture', sourceId: current.id, operationKey: `fixture:${randomUUID()}`,
            reason: 'Подготовка тестового состояния',
        });
    }
    return db.student.update({ ...options, data });
}

module.exports = { updateTestStudent };
