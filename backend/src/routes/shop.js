const express = require('express');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../config/db');
const { authenticate, requireAdmin, requireSalesOrAdmin } = require('../middleware/auth');
const { normalizePaymentMethod } = require('../services/paymentMethods');
const {
    MAX_SHOP_QUANTITY,
    buildShopSaleNumber,
    calculateSaleTotals,
    checkedShopInteger,
    multiplyShopIntegers,
    parseShopInteger,
    shopStockStatus,
    shopValidationError,
    weightedAverageCost,
} = require('../services/shopInventory');

const router = express.Router();

function personName(person, fallback = '') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function parseDateRange(from, to) {
    const now = new Date();
    const start = from
        ? new Date(`${from}T00:00:00.000Z`)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = to ? new Date(`${to}T23:59:59.999Z`) : now;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
        throw shopValidationError('Некорректный период');
    }
    return { start, end };
}

function optionalDate(value, fallback = new Date()) {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw shopValidationError('Некорректная дата');
    return date;
}

function cleanText(value, maxLength = 250) {
    const text = String(value || '').trim();
    return text ? text.slice(0, maxLength) : null;
}

function normalizeSku(value) {
    const sku = String(value || '').trim().toUpperCase().replace(/\s+/g, '-');
    if (sku) return sku.slice(0, 80);
    return `PRD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function canSeeCosts(user) {
    return ['admin', 'super_admin'].includes(user?.role);
}

function publicProduct(product, includeCosts = true) {
    return {
        ...product,
        purchasePrice: includeCosts ? product.purchasePrice : undefined,
        stockStatus: shopStockStatus(product),
        marginAmount: includeCosts ? product.salePrice - product.purchasePrice : undefined,
    };
}

function publicSale(sale, includeCosts = true) {
    return {
        ...sale,
        costAmount: includeCosts ? sale.costAmount : undefined,
        items: Array.isArray(sale.items)
            ? sale.items.map(item => ({
                ...item,
                purchasePrice: includeCosts ? item.purchasePrice : undefined,
            }))
            : sale.items,
    };
}

function handleShopError(res, error, fallback) {
    console.error(fallback, error);
    if (error.code === 'INVALID_PAYMENT_METHOD') {
        return res.status(400).json({ success: false, error: error.message, code: error.code });
    }
    if (error.code === 'P2002') {
        const fields = Array.isArray(error.meta?.target) ? error.meta.target.join(', ') : '';
        return res.status(409).json({
            success: false,
            error: fields.includes('barcode')
                ? 'Товар с таким штрихкодом уже существует'
                : fields.includes('sku')
                    ? 'Товар с таким артикулом уже существует'
                    : 'Запись с такими данными уже существует. Обновите страницу и повторите.',
        });
    }
    if (error.status) {
        return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: fallback });
}

async function lockProducts(tx, productIds) {
    const ids = [...new Set(productIds)].sort();
    if (!ids.length) return;
    await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ShopProduct" WHERE "id" IN (${Prisma.join(ids)}) FOR UPDATE`,
    );
}

router.get('/summary', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const { start, end } = parseDateRange(req.query.from, req.query.to);
        const [products, salesAggregate, salesCount, cancelledCount] = await Promise.all([
            prisma.shopProduct.findMany({
                where: { active: true },
                select: {
                    stockQuantity: true,
                    minimumStock: true,
                    purchasePrice: true,
                    salePrice: true,
                },
            }),
            prisma.shopSale.aggregate({
                where: { status: 'completed', saleDate: { gte: start, lte: end } },
                _sum: { totalAmount: true, costAmount: true, discountAmount: true },
            }),
            prisma.shopSale.count({
                where: { status: 'completed', saleDate: { gte: start, lte: end } },
            }),
            prisma.shopSale.count({
                where: { status: 'cancelled', saleDate: { gte: start, lte: end } },
            }),
        ]);

        const revenue = salesAggregate._sum.totalAmount || 0;
        const cost = salesAggregate._sum.costAmount || 0;
        const inventoryUnits = products.reduce((sum, product) => sum + product.stockQuantity, 0);
        const stockValue = products.reduce(
            (sum, product) => sum + product.stockQuantity * product.purchasePrice,
            0,
        );
        const retailValue = products.reduce(
            (sum, product) => sum + product.stockQuantity * product.salePrice,
            0,
        );

        return res.json({
            success: true,
            period: { from: start, to: end },
            summary: {
                productsCount: products.length,
                inventoryUnits,
                lowStockCount: products.filter(product => shopStockStatus(product) !== 'ok').length,
                salesCount,
                cancelledCount,
                revenue,
                discountAmount: salesAggregate._sum.discountAmount || 0,
                ...(canSeeCosts(req.user) ? {
                    stockValue,
                    retailValue,
                    cost,
                    grossProfit: revenue - cost,
                } : {}),
            },
        });
    } catch (error) {
        return handleShopError(res, error, 'Ошибка получения сводки магазина');
    }
});

router.get('/products', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const search = cleanText(req.query.search, 120);
        const category = cleanText(req.query.category, 120);
        const stock = String(req.query.stock || 'all');
        const active = req.query.active === 'all' ? undefined : req.query.active !== 'false';
        const where = {
            ...(active === undefined ? {} : { active }),
            ...(category ? { category } : {}),
            ...(search ? {
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { sku: { contains: search, mode: 'insensitive' } },
                    { barcode: { contains: search, mode: 'insensitive' } },
                ],
            } : {}),
        };
        const products = await prisma.shopProduct.findMany({
            where,
            orderBy: [{ active: 'desc' }, { category: 'asc' }, { name: 'asc' }],
        });
        const filtered = products.filter(product => {
            const status = shopStockStatus(product);
            if (stock === 'available') return status !== 'out';
            if (stock === 'low') return status === 'low';
            if (stock === 'out') return status === 'out';
            return true;
        });
        const categories = await prisma.shopProduct.findMany({
            where: { active: true },
            distinct: ['category'],
            select: { category: true },
            orderBy: { category: 'asc' },
        });

        return res.json({
            success: true,
            products: filtered.map(product => publicProduct(product, canSeeCosts(req.user))),
            categories: categories.map(item => item.category),
        });
    } catch (error) {
        return handleShopError(res, error, 'Ошибка загрузки товаров');
    }
});

router.post('/products', authenticate, requireAdmin, async (req, res) => {
    try {
        const name = cleanText(req.body.name, 180);
        if (!name) throw shopValidationError('Название товара обязательно');
        const initialStock = parseShopInteger(req.body.initialStock || 0, 'Начальный остаток', { min: 0, max: 1_000_000 });
        const purchasePrice = parseShopInteger(req.body.purchasePrice || 0, 'Закупочная цена', { min: 0 });
        const salePrice = parseShopInteger(req.body.salePrice, 'Цена продажи', { min: 1 });
        const minimumStock = parseShopInteger(req.body.minimumStock || 0, 'Минимальный остаток', { min: 0 });
        const initialStockValue = multiplyShopIntegers(
            purchasePrice,
            initialStock,
            'Стоимость начального остатка',
        );

        const product = await prisma.$transaction(async tx => {
            const created = await tx.shopProduct.create({
                data: {
                    sku: normalizeSku(req.body.sku),
                    barcode: cleanText(req.body.barcode, 120),
                    name,
                    category: cleanText(req.body.category, 120) || 'Другое',
                    unit: cleanText(req.body.unit, 30) || 'шт.',
                    description: cleanText(req.body.description, 2000),
                    purchasePrice,
                    salePrice,
                    stockQuantity: initialStock,
                    minimumStock,
                    createdById: req.user.id,
                },
            });
            if (initialStock > 0) {
                await tx.shopStockMovement.create({
                    data: {
                        productId: created.id,
                        type: 'adjustment',
                        quantity: initialStock,
                        balanceAfter: initialStock,
                        unitCost: purchasePrice,
                        totalCost: initialStockValue,
                        reason: 'Начальный остаток при создании товара',
                        createdById: req.user.id,
                    },
                });
            }
            return created;
        });

        return res.status(201).json({ success: true, product: publicProduct(product) });
    } catch (error) {
        return handleShopError(res, error, 'Ошибка создания товара');
    }
});

router.patch('/products/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const existing = await prisma.shopProduct.findUnique({ where: { id: req.params.id } });
        if (!existing) return res.status(404).json({ success: false, error: 'Товар не найден' });
        const data = {};
        if (req.body.name !== undefined) {
            data.name = cleanText(req.body.name, 180);
            if (!data.name) throw shopValidationError('Название товара обязательно');
        }
        if (req.body.sku !== undefined) data.sku = normalizeSku(req.body.sku);
        if (req.body.barcode !== undefined) data.barcode = cleanText(req.body.barcode, 120);
        if (req.body.category !== undefined) data.category = cleanText(req.body.category, 120) || 'Другое';
        if (req.body.unit !== undefined) data.unit = cleanText(req.body.unit, 30) || 'шт.';
        if (req.body.description !== undefined) data.description = cleanText(req.body.description, 2000);
        if (req.body.purchasePrice !== undefined) {
            data.purchasePrice = parseShopInteger(req.body.purchasePrice, 'Закупочная цена', { min: 0 });
        }
        if (req.body.salePrice !== undefined) {
            data.salePrice = parseShopInteger(req.body.salePrice, 'Цена продажи', { min: 1 });
        }
        if (req.body.minimumStock !== undefined) {
            data.minimumStock = parseShopInteger(req.body.minimumStock, 'Минимальный остаток', { min: 0 });
        }
        if (req.body.active !== undefined) data.active = Boolean(req.body.active);

        const product = await prisma.shopProduct.update({ where: { id: existing.id }, data });
        return res.json({ success: true, product: publicProduct(product) });
    } catch (error) {
        return handleShopError(res, error, 'Ошибка обновления товара');
    }
});

router.post('/stock/receipt', authenticate, requireAdmin, async (req, res) => {
    try {
        const productId = String(req.body.productId || '');
        const quantity = parseShopInteger(req.body.quantity, 'Количество', { min: 1, max: 1_000_000 });
        const unitCost = parseShopInteger(req.body.unitCost || 0, 'Закупочная цена', { min: 0 });
        const occurredAt = optionalDate(req.body.occurredAt);
        const recordExpense = req.body.recordExpense !== false;
        const paymentMethod = recordExpense ? normalizePaymentMethod(req.body.paymentMethod || 'cash') : null;
        const receiptCost = multiplyShopIntegers(unitCost, quantity, 'Сумма прихода');

        const result = await prisma.$transaction(async tx => {
            await lockProducts(tx, [productId]);
            const product = await tx.shopProduct.findUnique({ where: { id: productId } });
            if (!product) throw Object.assign(new Error('Товар не найден'), { status: 404 });
            const balanceAfter = checkedShopInteger(
                product.stockQuantity + quantity,
                'Остаток после прихода',
                { min: 0, max: MAX_SHOP_QUANTITY },
            );
            const averageCost = weightedAverageCost(
                product.stockQuantity,
                product.purchasePrice,
                quantity,
                unitCost,
            );
            const updated = await tx.shopProduct.update({
                where: { id: product.id },
                data: {
                    stockQuantity: balanceAfter,
                    purchasePrice: averageCost,
                },
            });
            const movement = await tx.shopStockMovement.create({
                data: {
                    productId,
                    type: 'receipt',
                    quantity,
                    balanceAfter,
                    unitCost,
                    totalCost: receiptCost,
                    supplier: cleanText(req.body.supplier, 180),
                    documentNumber: cleanText(req.body.documentNumber, 120),
                    reason: cleanText(req.body.reason, 1000) || 'Приход товара',
                    occurredAt,
                    createdById: req.user.id,
                },
            });
            if (recordExpense && receiptCost > 0) {
                await tx.cashTransaction.create({
                    data: {
                        type: 'expense',
                        amount: receiptCost,
                        category: 'shop_purchase',
                        description: `Закупка товара: ${product.name} × ${quantity}`,
                        date: occurredAt,
                        createdById: req.user.id,
                        paymentMethod,
                        notes: [cleanText(req.body.supplier, 180), cleanText(req.body.documentNumber, 120)]
                            .filter(Boolean)
                            .join(' · '),
                    },
                });
            }
            return { product: updated, movement };
        });

        return res.status(201).json({
            success: true,
            product: publicProduct(result.product),
            movement: result.movement,
        });
    } catch (error) {
        return handleShopError(res, error, 'Ошибка приёмки товара');
    }
});

router.post('/stock/write-off', authenticate, requireAdmin, async (req, res) => {
    try {
        const productId = String(req.body.productId || '');
        const quantity = parseShopInteger(req.body.quantity, 'Количество', { min: 1, max: 1_000_000 });
        const reason = cleanText(req.body.reason, 1000);
        if (!reason) throw shopValidationError('Укажите причину списания');
        const occurredAt = optionalDate(req.body.occurredAt);

        const result = await prisma.$transaction(async tx => {
            await lockProducts(tx, [productId]);
            const product = await tx.shopProduct.findUnique({ where: { id: productId } });
            if (!product) throw Object.assign(new Error('Товар не найден'), { status: 404 });
            if (product.stockQuantity < quantity) {
                throw shopValidationError(`На складе только ${product.stockQuantity} ${product.unit}`, 'SHOP_STOCK_CHANGED');
            }
            const balanceAfter = product.stockQuantity - quantity;
            const writeOffCost = multiplyShopIntegers(
                product.purchasePrice,
                quantity,
                'Себестоимость списания',
            );
            const updated = await tx.shopProduct.update({
                where: { id: product.id },
                data: { stockQuantity: balanceAfter },
            });
            const movement = await tx.shopStockMovement.create({
                data: {
                    productId,
                    type: 'write_off',
                    quantity: -quantity,
                    balanceAfter,
                    unitCost: product.purchasePrice,
                    totalCost: writeOffCost,
                    reason,
                    occurredAt,
                    createdById: req.user.id,
                },
            });
            return { product: updated, movement };
        });

        return res.status(201).json({
            success: true,
            product: publicProduct(result.product),
            movement: result.movement,
        });
    } catch (error) {
        return handleShopError(res, error, 'Ошибка списания товара');
    }
});

router.post('/stock/adjustment', authenticate, requireAdmin, async (req, res) => {
    try {
        const productId = String(req.body.productId || '');
        const actualQuantity = parseShopInteger(req.body.actualQuantity, 'Фактический остаток', { min: 0, max: 1_000_000 });
        const reason = cleanText(req.body.reason, 1000);
        if (!reason) throw shopValidationError('Укажите причину корректировки');
        const occurredAt = optionalDate(req.body.occurredAt);

        const result = await prisma.$transaction(async tx => {
            await lockProducts(tx, [productId]);
            const product = await tx.shopProduct.findUnique({ where: { id: productId } });
            if (!product) throw Object.assign(new Error('Товар не найден'), { status: 404 });
            const delta = actualQuantity - product.stockQuantity;
            if (delta === 0) throw shopValidationError('Фактический остаток уже совпадает с учётным');
            const adjustmentCost = multiplyShopIntegers(
                Math.abs(delta),
                product.purchasePrice,
                'Стоимость корректировки',
            );
            const updated = await tx.shopProduct.update({
                where: { id: product.id },
                data: { stockQuantity: actualQuantity },
            });
            const movement = await tx.shopStockMovement.create({
                data: {
                    productId,
                    type: 'adjustment',
                    quantity: delta,
                    balanceAfter: actualQuantity,
                    unitCost: product.purchasePrice,
                    totalCost: adjustmentCost,
                    reason,
                    occurredAt,
                    createdById: req.user.id,
                },
            });
            return { product: updated, movement };
        });

        return res.status(201).json({
            success: true,
            product: publicProduct(result.product),
            movement: result.movement,
        });
    } catch (error) {
        return handleShopError(res, error, 'Ошибка инвентаризации');
    }
});

router.get('/movements', authenticate, requireAdmin, async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(Number(req.query.limit) || 150, 500));
        const where = {};
        if (req.query.productId) where.productId = String(req.query.productId);
        if (req.query.type) where.type = String(req.query.type);
        if (req.query.from || req.query.to) {
            const { start, end } = parseDateRange(req.query.from, req.query.to);
            where.occurredAt = { gte: start, lte: end };
        }
        const movements = await prisma.shopStockMovement.findMany({
            where,
            include: {
                product: { select: { id: true, sku: true, name: true, unit: true } },
                createdBy: { select: { name: true, lastName: true, middleName: true } },
                sale: { select: { id: true, number: true } },
            },
            orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
            take: limit,
        });
        return res.json({
            success: true,
            movements: movements.map(movement => ({
                ...movement,
                createdByName: personName(movement.createdBy, 'Система'),
            })),
        });
    } catch (error) {
        return handleShopError(res, error, 'Ошибка загрузки движений склада');
    }
});

router.post('/sales', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
        const productIds = [...new Set(rawItems.map(item => String(item?.productId || '')).filter(Boolean))];
        const paymentMethod = normalizePaymentMethod(req.body.paymentMethod);
        const saleDate = optionalDate(req.body.saleDate);

        const sale = await prisma.$transaction(async tx => {
            await lockProducts(tx, productIds);
            const products = await tx.shopProduct.findMany({ where: { id: { in: productIds } } });
            const totals = calculateSaleTotals(products, rawItems, req.body.discountAmount || 0);

            let customer = null;
            const customerId = cleanText(req.body.customerId, 120);
            if (customerId) {
                customer = await tx.student.findFirst({
                    where: { id: customerId, role: 'student' },
                    select: { id: true, name: true, lastName: true, middleName: true, phone: true },
                });
                if (!customer) throw shopValidationError('Выбранный ученик не найден');
            }

            const created = await tx.shopSale.create({
                data: {
                    number: buildShopSaleNumber(saleDate),
                    customerId: customer?.id || null,
                    customerName: cleanText(req.body.customerName, 180) || personName(customer) || null,
                    customerPhone: cleanText(req.body.customerPhone, 80) || customer?.phone || null,
                    sellerId: req.user.id,
                    paymentMethod,
                    subtotal: totals.subtotal,
                    discountAmount: totals.discountAmount,
                    totalAmount: totals.totalAmount,
                    costAmount: totals.costAmount,
                    notes: cleanText(req.body.notes, 2000) || '',
                    saleDate,
                    items: { create: totals.items },
                },
                include: { items: true },
            });

            const productMap = new Map(products.map(product => [product.id, product]));
            for (const item of totals.items) {
                const product = productMap.get(item.productId);
                const balanceAfter = product.stockQuantity - item.quantity;
                await tx.shopProduct.update({
                    where: { id: product.id },
                    data: { stockQuantity: balanceAfter },
                });
                await tx.shopStockMovement.create({
                    data: {
                        productId: product.id,
                        type: 'sale',
                        quantity: -item.quantity,
                        balanceAfter,
                        unitCost: item.purchasePrice,
                        totalCost: item.purchasePrice * item.quantity,
                        saleId: created.id,
                        reason: `Продажа ${created.number}`,
                        occurredAt: saleDate,
                        createdById: req.user.id,
                    },
                });
            }

            await tx.cashTransaction.create({
                data: {
                    type: 'income',
                    amount: totals.totalAmount,
                    category: 'shop_sale',
                    description: `Продажа магазина ${created.number}`,
                    date: saleDate,
                    createdById: req.user.id,
                    relatedShopSaleId: created.id,
                    paymentMethod,
                    notes: created.notes,
                },
            });
            return created;
        });

        return res.status(201).json({
            success: true,
            sale: publicSale(sale, canSeeCosts(req.user)),
        });
    } catch (error) {
        return handleShopError(res, error, 'Ошибка оформления продажи');
    }
});

router.get('/sales', authenticate, requireSalesOrAdmin, async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(Number(req.query.limit) || 150, 500));
        const where = {};
        if (req.query.status && ['completed', 'cancelled'].includes(req.query.status)) {
            where.status = req.query.status;
        }
        if (req.query.from || req.query.to) {
            const { start, end } = parseDateRange(req.query.from, req.query.to);
            where.saleDate = { gte: start, lte: end };
        }
        const search = cleanText(req.query.search, 120);
        if (search) {
            where.OR = [
                { number: { contains: search, mode: 'insensitive' } },
                { customerName: { contains: search, mode: 'insensitive' } },
                { customerPhone: { contains: search, mode: 'insensitive' } },
            ];
        }
        const sales = await prisma.shopSale.findMany({
            where,
            include: {
                items: true,
                seller: { select: { name: true, lastName: true, middleName: true } },
                cancelledBy: { select: { name: true, lastName: true, middleName: true } },
            },
            orderBy: [{ saleDate: 'desc' }, { createdAt: 'desc' }],
            take: limit,
        });
        return res.json({
            success: true,
            sales: sales.map(sale => ({
                ...publicSale(sale, canSeeCosts(req.user)),
                sellerName: personName(sale.seller),
                cancelledByName: personName(sale.cancelledBy),
            })),
        });
    } catch (error) {
        return handleShopError(res, error, 'Ошибка загрузки продаж');
    }
});

router.post('/sales/:id/cancel', authenticate, requireAdmin, async (req, res) => {
    try {
        const reason = cleanText(req.body.reason, 1000);
        if (!reason) throw shopValidationError('Укажите причину отмены продажи');
        const cancelledAt = new Date();

        const sale = await prisma.$transaction(async tx => {
            await tx.$queryRaw(
                Prisma.sql`SELECT "id" FROM "ShopSale" WHERE "id" = ${req.params.id} FOR UPDATE`,
            );
            const existing = await tx.shopSale.findUnique({
                where: { id: req.params.id },
                include: { items: true },
            });
            if (!existing) throw Object.assign(new Error('Продажа не найдена'), { status: 404 });
            if (existing.status === 'cancelled') {
                const error = shopValidationError('Продажа уже отменена', 'SHOP_SALE_ALREADY_CANCELLED');
                error.status = 409;
                throw error;
            }

            const productIds = existing.items.map(item => item.productId);
            await lockProducts(tx, productIds);
            const products = await tx.shopProduct.findMany({ where: { id: { in: productIds } } });
            const productMap = new Map(products.map(product => [product.id, product]));
            for (const item of existing.items) {
                const product = productMap.get(item.productId);
                if (!product) throw shopValidationError(`Товар «${item.productName}» больше не найден`);
                const balanceAfter = checkedShopInteger(
                    product.stockQuantity + item.quantity,
                    'Остаток после возврата',
                    { min: 0, max: MAX_SHOP_QUANTITY },
                );
                const averageCost = weightedAverageCost(
                    product.stockQuantity,
                    product.purchasePrice,
                    item.quantity,
                    item.purchasePrice,
                );
                await tx.shopProduct.update({
                    where: { id: product.id },
                    data: {
                        stockQuantity: balanceAfter,
                        purchasePrice: averageCost,
                    },
                });
                await tx.shopStockMovement.create({
                    data: {
                        productId: product.id,
                        type: 'sale_return',
                        quantity: item.quantity,
                        balanceAfter,
                        unitCost: item.purchasePrice,
                        totalCost: item.purchasePrice * item.quantity,
                        saleId: existing.id,
                        reason: `Отмена ${existing.number}: ${reason}`,
                        occurredAt: cancelledAt,
                        createdById: req.user.id,
                    },
                });
            }

            await tx.cashTransaction.create({
                data: {
                    type: 'expense',
                    amount: existing.totalAmount,
                    category: 'shop_refund',
                    description: `Отмена продажи магазина ${existing.number}`,
                    date: cancelledAt,
                    createdById: req.user.id,
                    relatedShopSaleId: existing.id,
                    paymentMethod: existing.paymentMethod,
                    notes: reason,
                },
            });

            return tx.shopSale.update({
                where: { id: existing.id },
                data: {
                    status: 'cancelled',
                    cancelledAt,
                    cancelledById: req.user.id,
                    cancellationReason: reason,
                },
                include: { items: true },
            });
        });

        return res.json({ success: true, sale, message: 'Продажа отменена, товар возвращён на склад' });
    } catch (error) {
        return handleShopError(res, error, 'Ошибка отмены продажи');
    }
});

module.exports = router;
