const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildShopSaleNumber,
    calculateSaleTotals,
    normalizeSaleItems,
    weightedAverageCost,
} = require('../src/services/shopInventory');

test('магазин объединяет повторяющиеся строки одного товара', () => {
    assert.deepEqual(normalizeSaleItems([
        { productId: 'product-1', quantity: 2 },
        { productId: 'product-2', quantity: 1 },
        { productId: 'product-1', quantity: 3 },
    ]), [
        { productId: 'product-1', quantity: 5 },
        { productId: 'product-2', quantity: 1 },
    ]);
});

test('продажа фиксирует выручку, себестоимость, скидку и маржу', () => {
    const result = calculateSaleTotals([
        {
            id: 'product-1',
            name: 'Струны',
            sku: 'STR-01',
            active: true,
            stockQuantity: 10,
            purchasePrice: 2400,
            salePrice: 4000,
        },
        {
            id: 'product-2',
            name: 'Медиаторы',
            sku: 'MED-01',
            active: true,
            stockQuantity: 30,
            purchasePrice: 150,
            salePrice: 400,
        },
    ], [
        { productId: 'product-1', quantity: 2 },
        { productId: 'product-2', quantity: 3 },
    ], 500);

    assert.equal(result.subtotal, 9200);
    assert.equal(result.discountAmount, 500);
    assert.equal(result.totalAmount, 8700);
    assert.equal(result.costAmount, 5250);
    assert.equal(result.totalAmount - result.costAmount, 3450);
});

test('продажа не допускает отрицательный склад', () => {
    assert.throws(() => calculateSaleTotals([
        {
            id: 'product-1',
            name: 'Струны',
            sku: 'STR-01',
            active: true,
            stockQuantity: 1,
            purchasePrice: 2000,
            salePrice: 3500,
        },
    ], [{ productId: 'product-1', quantity: 2 }]), /Недостаточно товара/);
});

test('приход пересчитывает средневзвешенную себестоимость', () => {
    assert.equal(weightedAverageCost(10, 2000, 5, 2600), 2200);
    assert.equal(weightedAverageCost(0, 0, 4, 1750), 1750);
});

test('номер продажи содержит дату и устойчивый суффикс', () => {
    assert.equal(
        buildShopSaleNumber(new Date(2026, 6, 19, 14, 5, 9), 'AB12'),
        'MS-20260719-140509-AB12',
    );
});

test('магазин отклоняет сумму, которая не помещается в денежное поле', () => {
    assert.throws(() => calculateSaleTotals([
        {
            id: 'product-1',
            name: 'Дорогой товар',
            sku: 'MAX-01',
            active: true,
            stockQuantity: 2,
            purchasePrice: 1,
            salePrice: 1_500_000_000,
        },
    ], [{ productId: 'product-1', quantity: 2 }]), /Сумма товара/);
});

test('магазин ограничивает итоговое количество повторяющихся строк', () => {
    assert.throws(() => normalizeSaleItems([
        { productId: 'product-1', quantity: 60_000 },
        { productId: 'product-1', quantity: 60_000 },
    ]), /Количество товара/);
});
