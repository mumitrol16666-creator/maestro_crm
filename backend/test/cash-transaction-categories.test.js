const test = require('node:test');
const assert = require('node:assert/strict');

const {
    isAnalyticsExcludedCashCategory,
    isCashBalanceExcludedCategory,
    isCashReconciliationCategory,
} = require('../src/services/cashTransactionCategories');

test('сверка кассы исключена из аналитики, но участвует в текущем остатке', () => {
    for (const category of ['cash_reconciliation_school', 'cash_reconciliation_shop']) {
        assert.equal(isCashReconciliationCategory(category), true);
        assert.equal(isAnalyticsExcludedCashCategory(category), true);
        assert.equal(isCashBalanceExcludedCategory(category), false);
    }
});

test('старые корректировки баланса не меняют остаток кассового счёта', () => {
    assert.equal(isCashBalanceExcludedCategory('correction'), true);
    assert.equal(isCashBalanceExcludedCategory('balance_adjustment'), true);
});
