const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeBookingLossStages } = require('../src/utils/bookingLoss');

test('этапы потерь для списка рассчитываются одним запросом платежей', async () => {
    let paymentQueries = 0;
    const prisma = {
        payment: {
            findMany: async () => {
                paymentQueries += 1;
                return [{ studentId: 'student-1', paymentDate: new Date('2026-08-10T00:00:00.000Z') }];
            },
        },
    };
    const bookings = [
        {
            id: 'paid',
            status: 'processed',
            appStatus: 'scheduled',
            lossStage: 'on_trial',
            convertedToStudentId: 'student-1',
            trialScheduledAt: new Date('2026-08-09T00:00:00.000Z'),
            createdAt: new Date('2026-08-01T00:00:00.000Z'),
        },
        {
            id: 'before',
            status: 'rejected',
            appStatus: null,
            lossStage: 'before_trial',
            convertedToStudentId: null,
            createdAt: new Date('2026-08-01T00:00:00.000Z'),
        },
    ];

    const stages = await normalizeBookingLossStages(prisma, bookings);

    assert.equal(paymentQueries, 1);
    assert.equal(stages.get('paid'), 'after_trial');
    assert.equal(stages.get('before'), 'before_trial');
});
