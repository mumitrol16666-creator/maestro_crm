const test = require('node:test');
const assert = require('node:assert/strict');

const {
    UNSPECIFIED_PAYMENT_METHOD,
    buildCashboxAccountSummary,
    isCashboxPaymentMethodFilter,
    normalizeCashboxTransferInput,
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
            currentBalance: 11000,
        },
        {
            paymentMethod: 'cash',
            label: 'Наличные',
            income: 0,
            expense: 10000,
            balance: -10000,
            operations: 1,
            currentBalance: -10000,
        },
        {
            paymentMethod: 'kaspi_pay',
            label: 'КаспиПей',
            income: 0,
            expense: 0,
            balance: 0,
            operations: 0,
            currentBalance: 0,
        },
        {
            paymentMethod: 'freedom',
            label: 'Фридом',
            income: 0,
            expense: 0,
            balance: 0,
            operations: 0,
            currentBalance: 0,
        },
        {
            paymentMethod: 'halyk',
            label: 'Халык Банк',
            income: 0,
            expense: 0,
            balance: 0,
            operations: 0,
            currentBalance: 0,
        },
        {
            paymentMethod: 'unspecified',
            label: 'Счёт не указан',
            income: 2000,
            expense: 0,
            balance: 2000,
            operations: 1,
            currentBalance: 2000,
        },
    ]);
});

test('сводка показывает текущий остаток по всей истории отдельно от периода', () => {
    const periodTransactions = [
        { type: 'income', amount: 1000, category: 'payment', paymentMethod: 'kaspi' },
    ];
    const allTransactions = [
        { type: 'income', amount: 9000, category: 'payment', paymentMethod: 'kaspi' },
        { type: 'expense', amount: 2000, category: 'account_transfer_out', paymentMethod: 'kaspi' },
        { type: 'income', amount: 2000, category: 'account_transfer_in', paymentMethod: 'cash' },
    ];

    const accounts = buildCashboxAccountSummary(periodTransactions, allTransactions);
    assert.equal(accounts.find(account => account.paymentMethod === 'kaspi').balance, 1000);
    assert.equal(accounts.find(account => account.paymentMethod === 'kaspi').currentBalance, 7000);
    assert.equal(accounts.find(account => account.paymentMethod === 'cash').currentBalance, 2000);
});

test('перевод между счетами проверяет счета и сумму', () => {
    const transfer = normalizeCashboxTransferInput({
        fromPaymentMethod: 'kaspi',
        toPaymentMethod: 'cash',
        amount: '5000',
        date: '2026-07-22',
        notes: 'Инкассация',
    });

    assert.equal(transfer.amount, 5000);
    assert.equal(transfer.fromPaymentMethod, 'kaspi');
    assert.equal(transfer.toPaymentMethod, 'cash');
    assert.equal(transfer.notes, 'Инкассация');
    assert.throws(
        () => normalizeCashboxTransferInput({ fromPaymentMethod: 'cash', toPaymentMethod: 'cash', amount: 100 }),
        /два разных счёта/,
    );
    assert.throws(
        () => normalizeCashboxTransferInput({ fromPaymentMethod: 'cash', toPaymentMethod: 'kaspi', amount: 0 }),
        /больше 0/,
    );
});

test('фильтр кассы принимает только настроенные счета', () => {
    assert.equal(isCashboxPaymentMethodFilter('kaspi_pay'), true);
    assert.equal(isCashboxPaymentMethodFilter('unspecified'), true);
    assert.equal(isCashboxPaymentMethodFilter('bank_card'), false);
});
