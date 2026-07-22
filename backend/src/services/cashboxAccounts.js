const {
    PAYMENT_METHODS,
    PAYMENT_METHOD_VALUES,
    getPaymentMethodLabel,
    normalizePaymentMethod,
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

function createAccountSummary(paymentMethod) {
    return {
        paymentMethod,
        label: paymentMethod === UNSPECIFIED_PAYMENT_METHOD
            ? 'Счёт не указан'
            : getPaymentMethodLabel(paymentMethod),
        income: 0,
        expense: 0,
        balance: 0,
        operations: 0,
        currentBalance: 0,
    };
}

function buildCashboxAccountSummary(periodTransactions, balanceTransactions = periodTransactions) {
    const accounts = new Map();

    for (const method of PAYMENT_METHODS) {
        accounts.set(method.value, createAccountSummary(method.value));
    }

    for (const transaction of periodTransactions || []) {
        if (TECHNICAL_CATEGORIES.has(transaction?.category)) continue;

        const paymentMethod = resolveCashboxPaymentMethod(transaction);
        const current = accounts.get(paymentMethod) || createAccountSummary(paymentMethod);
        const amount = cashboxEffectiveAmount(transaction);

        if (transaction?.type === 'income') current.income += amount;
        if (transaction?.type === 'expense') current.expense += amount;
        current.balance = current.income - current.expense;
        current.operations += 1;
        accounts.set(paymentMethod, current);
    }

    for (const transaction of balanceTransactions || []) {
        if (TECHNICAL_CATEGORIES.has(transaction?.category)) continue;

        const paymentMethod = resolveCashboxPaymentMethod(transaction);
        const current = accounts.get(paymentMethod) || createAccountSummary(paymentMethod);
        const amount = cashboxEffectiveAmount(transaction);

        if (transaction?.type === 'income') current.currentBalance += amount;
        if (transaction?.type === 'expense') current.currentBalance -= amount;
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

function normalizeCashboxTransferInput(input = {}) {
    const fromPaymentMethod = normalizePaymentMethod(input.fromPaymentMethod);
    const toPaymentMethod = normalizePaymentMethod(input.toPaymentMethod);
    if (fromPaymentMethod === toPaymentMethod) {
        const error = new Error('Выберите два разных счёта');
        error.code = 'SAME_CASHBOX_ACCOUNT';
        throw error;
    }

    const amount = Number(input.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
        const error = new Error('Сумма перевода должна быть целым числом больше 0');
        error.code = 'INVALID_CASHBOX_TRANSFER_AMOUNT';
        throw error;
    }

    const date = input.date ? new Date(input.date) : new Date();
    if (Number.isNaN(date.getTime())) {
        const error = new Error('Укажите корректную дату перевода');
        error.code = 'INVALID_CASHBOX_TRANSFER_DATE';
        throw error;
    }

    return {
        amount,
        fromPaymentMethod,
        toPaymentMethod,
        date,
        notes: String(input.notes || '').trim().slice(0, 2000),
    };
}

module.exports = {
    UNSPECIFIED_PAYMENT_METHOD,
    buildCashboxAccountSummary,
    cashboxEffectiveAmount,
    isCashboxPaymentMethodFilter,
    normalizeCashboxTransferInput,
    resolveCashboxPaymentMethod,
};
