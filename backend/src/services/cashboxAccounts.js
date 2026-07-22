const {
    PAYMENT_METHODS,
    PAYMENT_METHOD_VALUES,
    getPaymentMethodLabel,
} = require('./paymentMethods');

const UNSPECIFIED_PAYMENT_METHOD = 'unspecified';
const TECHNICAL_CATEGORIES = new Set(['correction', 'balance_adjustment']);

function resolveCashboxPaymentMethod(transaction) {
    const paymentMethod = String(
        transaction?.paymentMethod
        || transaction?.relatedPayment?.paymentMethod
        || transaction?.relatedShopSale?.paymentMethod
        || '',
    ).trim();
    return PAYMENT_METHOD_VALUES.has(paymentMethod)
        ? paymentMethod
        : UNSPECIFIED_PAYMENT_METHOD;
}

function isCashboxPaymentMethodFilter(value) {
    return value === UNSPECIFIED_PAYMENT_METHOD || PAYMENT_METHOD_VALUES.has(value);
}

function cashboxEffectiveAmount(transaction) {
    if (transaction?.category === 'payment' && transaction.relatedPayment?.amount != null) {
        return Number(transaction.relatedPayment.amount) || 0;
    }
    return Number(transaction?.amount) || 0;
}

function buildCashboxAccountSummary(transactions) {
    const accounts = new Map();

    for (const transaction of transactions || []) {
        if (TECHNICAL_CATEGORIES.has(transaction?.category)) continue;

        const paymentMethod = resolveCashboxPaymentMethod(transaction);
        const current = accounts.get(paymentMethod) || {
            paymentMethod,
            label: paymentMethod === UNSPECIFIED_PAYMENT_METHOD
                ? 'Счёт не указан'
                : getPaymentMethodLabel(paymentMethod),
            income: 0,
            expense: 0,
            balance: 0,
            operations: 0,
        };
        const amount = cashboxEffectiveAmount(transaction);

        if (transaction?.type === 'income') current.income += amount;
        if (transaction?.type === 'expense') current.expense += amount;
        current.balance = current.income - current.expense;
        current.operations += 1;
        accounts.set(paymentMethod, current);
    }

    const order = new Map([
        ...PAYMENT_METHODS.map((method, index) => [method.value, index]),
        [UNSPECIFIED_PAYMENT_METHOD, PAYMENT_METHODS.length],
    ]);
    return [...accounts.values()].sort((a, b) => (
        (order.get(a.paymentMethod) ?? 999) - (order.get(b.paymentMethod) ?? 999)
    ));
}

module.exports = {
    UNSPECIFIED_PAYMENT_METHOD,
    buildCashboxAccountSummary,
    cashboxEffectiveAmount,
    isCashboxPaymentMethodFilter,
    resolveCashboxPaymentMethod,
};
