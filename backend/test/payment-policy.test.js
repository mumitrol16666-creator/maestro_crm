const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parsePositiveMoney,
    calculatePaymentAdjustment,
    assertPaymentCanBeEdited,
    assertRefundAllowed,
} = require('../src/services/paymentPolicy');

test('платёж принимает только положительную целую сумму', () => {
    assert.equal(parsePositiveMoney('4000'), 4000);
    assert.throws(() => parsePositiveMoney(0), { code: 'INVALID_MONEY_AMOUNT' });
    assert.throws(() => parsePositiveMoney(-1), { code: 'INVALID_MONEY_AMOUNT' });
    assert.throws(() => parsePositiveMoney('abc'), { code: 'INVALID_MONEY_AMOUNT' });
});

test('редактирование платежа меняет баланс только на разницу', () => {
    assert.equal(calculatePaymentAdjustment(4000, 6000), 2000);
    assert.equal(calculatePaymentAdjustment(6000, 4000), -2000);
    assert.equal(calculatePaymentAdjustment(4000, 4000), 0);
});

test('нельзя уменьшить платёж ниже уже возвращённой суммы', () => {
    const payment = { status: 'completed' };
    assert.equal(assertPaymentCanBeEdited(payment, 5000, 3000), 5000);
    assert.throws(
        () => assertPaymentCanBeEdited(payment, 2000, 3000),
        { code: 'PAYMENT_BELOW_REFUNDS' },
    );
});

test('возврат ограничен текущим балансом ученика', () => {
    assert.equal(assertRefundAllowed({ studentBalance: 4000, refundAmount: 4000 }), 4000);
    assert.throws(
        () => assertRefundAllowed({ studentBalance: 3999, refundAmount: 4000 }),
        { code: 'REFUND_EXCEEDS_BALANCE' },
    );
    assert.throws(
        () => assertRefundAllowed({ studentBalance: -100, refundAmount: 1 }),
        { code: 'REFUND_EXCEEDS_BALANCE' },
    );
});

test('сумма нескольких возвратов не может превысить исходный платёж', () => {
    assert.equal(assertRefundAllowed({
        studentBalance: 10000,
        refundAmount: 3000,
        originalPaymentAmount: 5000,
        alreadyRefunded: 2000,
    }), 3000);
    assert.throws(() => assertRefundAllowed({
        studentBalance: 10000,
        refundAmount: 3001,
        originalPaymentAmount: 5000,
        alreadyRefunded: 2000,
    }), { code: 'REFUND_EXCEEDS_PAYMENT' });
});
