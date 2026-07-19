const MAX_SHOP_AMOUNT = 2_000_000_000;
const MAX_SHOP_QUANTITY = 1_000_000;
const MAX_SALE_ITEM_QUANTITY = 100_000;

function shopValidationError(message, code = 'SHOP_VALIDATION_ERROR') {
    const error = new Error(message);
    error.code = code;
    error.status = 400;
    return error;
}

function parseShopInteger(value, label, options = {}) {
    const number = Number(value);
    if (!Number.isInteger(number)) {
        throw shopValidationError(`${label}: укажите целое число`);
    }
    const min = options.min ?? 0;
    const max = options.max ?? MAX_SHOP_AMOUNT;
    if (number < min || number > max) {
        throw shopValidationError(`${label}: допустимое значение от ${min} до ${max}`);
    }
    return number;
}

function checkedShopInteger(value, label, options = {}) {
    if (!Number.isSafeInteger(value)) {
        throw shopValidationError(`${label}: значение слишком большое`);
    }
    return parseShopInteger(value, label, options);
}

function multiplyShopIntegers(left, right, label, options = {}) {
    return checkedShopInteger(Number(left) * Number(right), label, options);
}

function normalizeSaleItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
        throw shopValidationError('Добавьте хотя бы один товар в продажу', 'EMPTY_SHOP_SALE');
    }

    const quantities = new Map();
    for (const item of items) {
        const productId = String(item?.productId || '').trim();
        if (!productId) {
            throw shopValidationError('В продаже найден товар без идентификатора');
        }
        const quantity = parseShopInteger(item.quantity, 'Количество товара', {
            min: 1,
            max: MAX_SALE_ITEM_QUANTITY,
        });
        quantities.set(productId, checkedShopInteger(
            (quantities.get(productId) || 0) + quantity,
            'Количество товара',
            { min: 1, max: MAX_SALE_ITEM_QUANTITY },
        ));
    }

    return [...quantities.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

function calculateSaleTotals(products, rawItems, rawDiscount = 0) {
    const items = normalizeSaleItems(rawItems);
    const productMap = new Map(products.map(product => [product.id, product]));
    const saleItems = items.map(item => {
        const product = productMap.get(item.productId);
        if (!product || !product.active) {
            throw shopValidationError('Один из товаров недоступен для продажи', 'SHOP_PRODUCT_UNAVAILABLE');
        }
        if (product.stockQuantity < item.quantity) {
            throw shopValidationError(
                `Недостаточно товара «${product.name}»: доступно ${product.stockQuantity}`,
                'SHOP_STOCK_CHANGED',
            );
        }
        const unitPrice = parseShopInteger(product.salePrice, 'Цена продажи', { min: 0 });
        const purchasePrice = parseShopInteger(product.purchasePrice, 'Закупочная цена', { min: 0 });
        const lineTotal = multiplyShopIntegers(
            unitPrice,
            item.quantity,
            `Сумма товара «${product.name}»`,
        );
        return {
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            quantity: item.quantity,
            unitPrice,
            purchasePrice,
            lineTotal,
        };
    });

    const subtotal = saleItems.reduce(
        (sum, item) => checkedShopInteger(sum + item.lineTotal, 'Сумма продажи'),
        0,
    );
    const discountAmount = parseShopInteger(rawDiscount || 0, 'Скидка', { min: 0 });
    if (discountAmount > subtotal) {
        throw shopValidationError('Скидка не может быть больше суммы товаров');
    }
    const totalAmount = subtotal - discountAmount;
    if (totalAmount <= 0) {
        throw shopValidationError('Итоговая сумма продажи должна быть больше нуля');
    }

    return {
        items: saleItems,
        subtotal,
        discountAmount,
        totalAmount,
        costAmount: saleItems.reduce(
            (sum, item) => checkedShopInteger(
                sum + multiplyShopIntegers(
                    item.purchasePrice,
                    item.quantity,
                    `Себестоимость товара «${item.productName}»`,
                ),
                'Себестоимость продажи',
            ),
            0,
        ),
    };
}

function buildShopSaleNumber(date = new Date(), suffix = '') {
    const d = date instanceof Date ? date : new Date(date);
    const pad = value => String(value).padStart(2, '0');
    const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const random = suffix || Math.random().toString(36).slice(2, 6).toUpperCase();
    return `MS-${day}-${time}-${random}`;
}

function weightedAverageCost(currentQuantity, currentCost, incomingQuantity, incomingCost) {
    const currentQty = parseShopInteger(currentQuantity || 0, 'Текущий остаток', { min: 0, max: MAX_SHOP_QUANTITY });
    const incomingQty = parseShopInteger(incomingQuantity || 0, 'Количество прихода', { min: 0, max: MAX_SHOP_QUANTITY });
    const currentUnitCost = parseShopInteger(currentCost || 0, 'Текущая себестоимость', { min: 0 });
    const incomingUnitCost = parseShopInteger(incomingCost || 0, 'Себестоимость прихода', { min: 0 });
    const totalQuantity = currentQty + incomingQty;
    if (totalQuantity === 0) return incomingUnitCost;
    return Math.round(
        ((currentQty * currentUnitCost) + (incomingQty * incomingUnitCost)) / totalQuantity,
    );
}

function shopStockStatus(product) {
    const stock = Number(product?.stockQuantity) || 0;
    const minimum = Number(product?.minimumStock) || 0;
    if (stock <= 0) return 'out';
    if (stock <= minimum) return 'low';
    return 'ok';
}

module.exports = {
    MAX_SHOP_AMOUNT,
    MAX_SHOP_QUANTITY,
    buildShopSaleNumber,
    calculateSaleTotals,
    checkedShopInteger,
    multiplyShopIntegers,
    normalizeSaleItems,
    parseShopInteger,
    shopStockStatus,
    shopValidationError,
    weightedAverageCost,
};
