const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEPARTURE_REASONS,
    normalizeDepartureReason,
    finishStudentEducation,
    permanentlyDeleteStudent,
} = require('../src/services/studentDeparture');

test('причина ухода принимается только из фиксированного справочника', () => {
    assert.equal(normalizeDepartureReason('moved'), 'moved');
    assert.equal(DEPARTURE_REASONS.moved, 'Переехал');
    assert.equal(normalizeDepartureReason('случайный текст'), null);
});

test('завершение обучения требует причину до запуска транзакции', async () => {
    let transactionStarted = false;
    const prisma = {
        $transaction: async () => {
            transactionStarted = true;
        },
    };

    await assert.rejects(
        () => finishStudentEducation(prisma, 'student-1', 'admin-1', {}),
        error => error.code === 'INVALID_DEPARTURE_REASON' && error.statusCode === 400
    );
    assert.equal(transactionStarted, false);
});

test('полное удаление разрешено только бывшему ученику', async () => {
    const prisma = {
        $transaction: callback => callback({
            student: { findFirst: async () => null },
        }),
    };

    await assert.rejects(
        () => permanentlyDeleteStudent(prisma, 'student-1'),
        error => error.code === 'STUDENT_NOT_FORMER' && error.statusCode === 400
    );
});
