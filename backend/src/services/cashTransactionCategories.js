const CASH_BALANCE_EXCLUDED_CATEGORIES = new Set([
    'correction',
    'balance_adjustment',
]);

const CASH_RECONCILIATION_CATEGORIES = new Set([
    'cash_reconciliation_school',
    'cash_reconciliation_shop',
]);

const ANALYTICS_EXCLUDED_CATEGORIES = new Set([
    ...CASH_BALANCE_EXCLUDED_CATEGORIES,
    ...CASH_RECONCILIATION_CATEGORIES,
    'account_transfer_in',
    'account_transfer_out',
]);

function isCashBalanceExcludedCategory(category) {
    return CASH_BALANCE_EXCLUDED_CATEGORIES.has(String(category || ''));
}

function isCashReconciliationCategory(category) {
    return CASH_RECONCILIATION_CATEGORIES.has(String(category || ''));
}

function isAnalyticsExcludedCashCategory(category) {
    return ANALYTICS_EXCLUDED_CATEGORIES.has(String(category || ''));
}

module.exports = {
    ANALYTICS_EXCLUDED_CATEGORIES,
    CASH_BALANCE_EXCLUDED_CATEGORIES,
    CASH_RECONCILIATION_CATEGORIES,
    isAnalyticsExcludedCashCategory,
    isCashBalanceExcludedCategory,
    isCashReconciliationCategory,
};
