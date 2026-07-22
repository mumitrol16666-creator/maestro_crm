const test = require('node:test');
const assert = require('node:assert/strict');

const {
    UNSPECIFIED_PAYMENT_METHOD,
    buildCashboxAccountSummary,
    isCashboxPaymentMethodFilter,
    resolveCashboxPaymentMethod,
} = require('../src/services/cashboxAccounts');

test('касса получает счёт из самой операции или связанного платежа', () => {
    assert.equal(resolveCashboxPaymentMethod({ paymentMethod: 'cash' }), 'cash');
    assert.equal(resolveCashboxPaymentMethod({ relatedPayment: { paymentMethod: 'kaspi' } }), 'kaspi');
    assert.equal(resolveCashboxPaymentMethod({ relatedShopSale: { paymentMethod: 'freedom' } }), 'freedom');
    assert.equal(resolveCashboxPaymentMethod({ paymentMethod: 'legacy_card' }), UNSPECIFIED_PAYMENT_METHOD);
    assert.equal(resolveCashboxPaymentMethod({}), UNSPECIFIED_PAYMENT_METHOD);
});

test('сводка разделяет приход и расход по счетам', () => {
    const accounts = buildCashboxAccountSummary([
        { type: 'income', amount: 15000, category: 'payment', paymentMethod: 'kaspi' },
        { type: 'expense', amount: 4000, category: 'refund', paymentMethod: 'kaspi' },
        { type: 'expense', amount: 10000, category: 'salary_advance', paymentMethod: 'cash' },
        { type: 'income', amount: 2000, category: 'trial_payment' },
        { type: 'income', amount: 999, category: 'correction', paymentMethod: 'kaspi' },
    ]);

    assert.deepEqual(accounts, [
        {
            paymentMethod: 'kaspi',
            label: 'Каспи',
            income: 15000,
            expense: 4000,
            balance: 11000,
            operations: 2,
        },
        {
            paymentMethod: 'cash',
            label: 'Наличные',
            income: 0,
            expense: 10000,
            balance: -10000,
            operations: 1,
        },
        {
            paymentMethod: 'unspecified',
            label: 'Счёт не указан',
            income: 2000,
            expense: 0,
            balance: 2000,
            operations: 1,
        },
    ]);
});

test('фильтр кассы принимает только настроенные счета', () => {
    assert.equal(isCashboxPaymentMethodFilter('kaspi_pay'), true);
    assert.equal(isCashboxPaymentMethodFilter('unspecified'), true);
    assert.equal(isCashboxPaymentMethodFilter('bank_card'), false);
});
