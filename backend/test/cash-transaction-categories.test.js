const test = require('node:test');
const assert = require('node:assert/strict');

const {
    isAnalyticsExcludedCashCategory,
    isCashBalanceExcludedCategory,
    isCashReconciliationCategory,
    isShopCashCategory,
} = require('../src/services/cashTransactionCategories');

test('сверка кассы исключена из аналитики, но участвует в текущем остатке', () => {
    for (const category of ['cash_reconciliation_school', 'cash_reconciliation_shop']) {
        assert.equal(isCashReconciliationCategory(category), true);
        assert.equal(isAnalyticsExcludedCashCategory(category), true);
        assert.equal(isCashBalanceExcludedCategory(category), false);
    }
});

test('операции магазина отделяются от кассы школы', () => {
    for (const category of [
        'shop_sale',
        'shop_purchase',
        'shop_refund',
        'shop_manual_income',
        'shop_manual_expense',
        'shop_account_transfer_in',
        'shop_account_transfer_out',
    ]) {
        assert.equal(isShopCashCategory(category), true);
    }
    assert.equal(isShopCashCategory('payment'), false);
    assert.equal(isShopCashCategory('salary'), false);
});

test('старые корректировки баланса не меняют остаток кассового счёта', () => {
    assert.equal(isCashBalanceExcludedCategory('correction'), true);
    assert.equal(isCashBalanceExcludedCategory('balance_adjustment'), true);
});
