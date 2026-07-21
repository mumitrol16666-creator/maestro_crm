const test = require('node:test');
const assert = require('node:assert/strict');

const {
    TRIAL_PAYMENT_CATEGORY,
    syncTrialPayment,
} = require('../src/services/trialPayment');

function makeTx(existing = null) {
    const calls = [];
    return {
        calls,
        cashTransaction: {
            findUnique: async () => existing,
            create: async ({ data }) => {
                calls.push(data);
                return { id: 'cash-trial-1', ...data };
            },
        },
    };
}

test('оплата диагностики создаётся в кассе отдельной операцией и не касается баланса ученика', async () => {
    const tx = makeTx();
    const operation = await syncTrialPayment(tx, {
        id: 'booking-1',
        name: 'Анна',
        lastName: 'Тестова',
        middleName: null,
    }, {
        paid: true,
        actorId: 'admin-1',
        paymentMethod: 'kaspi',
    });

    assert.equal(operation.amount, 2000);
    assert.equal(operation.type, 'income');
    assert.equal(operation.category, TRIAL_PAYMENT_CATEGORY);
    assert.equal(operation.relatedBookingId, 'booking-1');
    assert.equal(operation.paymentMethod, 'kaspi');
    assert.match(operation.description, /Диагностический урок 2000/);
    assert.equal(tx.calls.length, 1);
});

test('повторная фиксация оплаты диагностики идемпотентна', async () => {
    const existing = { id: 'cash-existing', amount: 2000 };
    const tx = makeTx(existing);
    const operation = await syncTrialPayment(tx, { id: 'booking-1' }, { paid: true, actorId: 'admin-1' });
    assert.equal(operation, existing);
    assert.equal(tx.calls.length, 0);
});

test('невозвратную оплату диагностики нельзя отменить', async () => {
    const tx = makeTx({ id: 'cash-existing', amount: 2000 });
    await assert.rejects(
        syncTrialPayment(tx, { id: 'booking-1' }, { paid: false, actorId: 'admin-1' }),
        (error) => error.code === 'TRIAL_PAYMENT_NOT_REVERSIBLE' && error.statusCode === 400,
    );
});
