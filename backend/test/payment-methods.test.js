const test = require('node:test');
const assert = require('node:assert/strict');

const {
    PAYMENT_METHODS,
    getPaymentMethodLabel,
    normalizePaymentMethod,
} = require('../src/services/paymentMethods');

test('обычный Каспи удалён из активных счетов', () => {
    assert.equal(PAYMENT_METHODS.some(method => method.value === 'kaspi'), false);
    assert.equal(PAYMENT_METHODS.some(method => method.value === 'kaspi_pay'), true);
    assert.throws(() => normalizePaymentMethod('kaspi'), /Выберите счет оплаты/);
    assert.equal(normalizePaymentMethod('kaspi_pay'), 'kaspi_pay');
});

test('старое значение Каспи остаётся читаемым только для аудита', () => {
    assert.equal(getPaymentMethodLabel('kaspi'), 'Каспи (архив)');
});
