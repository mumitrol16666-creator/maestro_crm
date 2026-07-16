const PAYMENT_METHODS = Object.freeze([
    { value: 'kaspi', label: 'Каспи' },
    { value: 'cash', label: 'Наличные' },
    { value: 'kaspi_pay', label: 'КаспиПей' },
    { value: 'freedom', label: 'Фридом' },
    { value: 'halyk', label: 'Халык Банк' },
]);

const PAYMENT_METHOD_VALUES = new Set(PAYMENT_METHODS.map((method) => method.value));

const LEGACY_PAYMENT_METHOD_LABELS = Object.freeze({
    pay: 'Pay',
    kaspi_transfer: 'Перевод Kaspi Меру',
    halyk_transfer: 'Перевод Halyk Меру',
    freedom_transfer: 'Перевод Freedom Меру',
});

const KASPI_PAY_LINK = process.env.KASPI_PAY_LINK || 'kaspi.kz/pay/ku3aldre';

function normalizePaymentMethod(value) {
    const method = String(value || '').trim();
    if (!method || !PAYMENT_METHOD_VALUES.has(method)) {
        const error = new Error('Выберите счет оплаты: Каспи, Наличные, КаспиПей, Фридом или Халык Банк');
        error.code = 'INVALID_PAYMENT_METHOD';
        throw error;
    }
    return method;
}

function getPaymentMethodLabel(value) {
    const method = PAYMENT_METHODS.find((item) => item.value === value);
    return method?.label || LEGACY_PAYMENT_METHOD_LABELS[value] || value || '';
}

module.exports = {
    PAYMENT_METHODS,
    PAYMENT_METHOD_VALUES,
    KASPI_PAY_LINK,
    normalizePaymentMethod,
    getPaymentMethodLabel,
};
