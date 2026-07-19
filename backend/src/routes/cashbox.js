const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

function parseDateRange(from, to) {
    const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(new Date().setDate(1));
    const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return null;
    }
    return { start, end };
}

// GET /api/cashbox/summary
router.get('/summary', authenticate, requireAdmin, async (req, res) => {
    try {
        const range = parseDateRange(req.query.from, req.query.to);
        if (!range) {
            return res.status(400).json({ success: false, error: 'Некорректный период' });
        }

        const { start, end } = range;

        const transactions = await prisma.cashTransaction.findMany({
            where: { date: { gte: start, lte: end } },
            select: {
                type: true,
                amount: true,
                category: true,
                relatedPayment: { select: { amount: true } },
            },
        });

        let paymentsTotal = 0;
        let correctionsTotal = 0;
        let manualIncome = 0;
        let realExpenses = 0;
        let refundsTotal = 0;
        let shopSalesTotal = 0;
        let shopRefundsTotal = 0;
        let shopPurchasesTotal = 0;

        let paymentsCount = 0;
        let manualIncomeCount = 0;
        let realExpensesCount = 0;
        let refundsCount = 0;
        let shopSalesCount = 0;
        let shopRefundsCount = 0;
        let shopPurchasesCount = 0;
        let correctionsCount = 0;

        let incomeTotal = 0;
        let expenseTotal = 0;

        for (const tx of transactions) {
            const amount = tx.category === 'payment' && tx.relatedPayment
                ? tx.relatedPayment.amount || 0
                : tx.amount || 0;
            const isTechnicalCorrection = ['correction', 'balance_adjustment'].includes(tx.category);
            if (isTechnicalCorrection) {
                if (tx.type === 'income') {
                    correctionsTotal += amount;
                } else {
                    correctionsTotal -= amount;
                }
                correctionsCount++;
                continue;
            }

            if (tx.type === 'income') {
                incomeTotal += amount;
            } else {
                expenseTotal += amount;
            }

            if (tx.category === 'payment') {
                paymentsTotal += amount;
                paymentsCount++;
            } else if (tx.category === 'refund') {
                refundsTotal += amount;
                refundsCount++;
            } else if (tx.category === 'shop_sale') {
                shopSalesTotal += amount;
                shopSalesCount++;
            } else if (tx.category === 'shop_refund') {
                shopRefundsTotal += amount;
                shopRefundsCount++;
            } else if (tx.category === 'shop_purchase') {
                shopPurchasesTotal += amount;
                shopPurchasesCount++;
                realExpenses += amount;
                realExpensesCount++;
            } else if (tx.type === 'income') {
                manualIncome += amount;
                manualIncomeCount++;
            } else if (tx.type === 'expense') {
                realExpenses += amount;
                realExpensesCount++;
            }
        }

        const cashTotal = incomeTotal - expenseTotal;
        const profit = (paymentsTotal - refundsTotal)
            + (shopSalesTotal - shopRefundsTotal)
            + manualIncome
            - realExpenses;

        res.json({
            success: true,
            period: { from: start, to: end },
            summary: {
                paymentsTotal,
                paymentsCount,
                manualIncome,
                manualIncomeCount,
                realExpenses,
                realExpensesCount,
                refundsTotal,
                refundsCount,
                shopSalesTotal,
                shopSalesCount,
                shopRefundsTotal,
                shopRefundsCount,
                shopPurchasesTotal,
                shopPurchasesCount,
                correctionsTotal,
                correctionsCount,
                cashTotal,
                profit
            }
        });
    } catch (error) {
        console.error('Cashbox summary error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения сводки' });
    }
});

// GET /api/cashbox/transactions
router.get('/transactions', authenticate, requireAdmin, async (req, res) => {
    try {
        const { from, to, type, category, search, page = 1, limit = 50 } = req.query;
        const pageNum = parseInt(page, 10);
        const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
        const skip = (pageNum - 1) * limitNum;

        const where = {};
        if (type && ['income', 'expense'].includes(type)) where.type = type;
        if (category) {
            where.category = { equals: category, mode: 'insensitive' };
        }
        if (search) {
            where.OR = [
                { description: { contains: search, mode: 'insensitive' } },
                { category: { contains: search, mode: 'insensitive' } }
            ];
        }

        const range = parseDateRange(from, to);
        if (range) where.date = { gte: range.start, lte: range.end };

        const [transactions, total] = await Promise.all([
            prisma.cashTransaction.findMany({
                where,
                include: {
                    createdBy: { select: { id: true, name: true, lastName: true, middleName: true } },
                    relatedPayment: {
                        include: {
                            student: { select: { id: true, name: true, lastName: true, middleName: true } },
                            teacher: { select: { id: true, name: true, lastName: true, middleName: true } },
                            manager: { select: { id: true, name: true, lastName: true, middleName: true } }
                        }
                    },
                    relatedShopSale: {
                        select: {
                            id: true,
                            number: true,
                            customerName: true,
                            customerPhone: true,
                            paymentMethod: true,
                        },
                    },
                },
                orderBy: { date: 'desc' },
                skip,
                take: limitNum
            }),
            prisma.cashTransaction.count({ where })
        ]);

        res.json({
            success: true,
            transactions: transactions.map(t => ({ ...t, _id: t.id })),
            total,
            page: pageNum,
            pages: Math.ceil(total / limitNum)
        });
    } catch (error) {
        console.error('Cashbox transactions error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения операций' });
    }
});

// POST /api/cashbox/transactions
router.post('/transactions', authenticate, requireAdmin, async (req, res) => {
    try {
        const { type, amount, category, description, date, notes, relatedPaymentId } = req.body;

        if (!['income', 'expense'].includes(type)) {
            return res.status(400).json({ success: false, error: 'type: income или expense' });
        }
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, error: 'Сумма должна быть больше 0' });
        }
        if (!category || !description) {
            return res.status(400).json({ success: false, error: 'Категория и описание обязательны' });
        }

        const transaction = await prisma.cashTransaction.create({
            data: {
                type,
                amount: parseInt(amount, 10),
                category,
                description,
                date: date ? new Date(date) : new Date(),
                notes: notes || '',
                createdById: req.user.id,
                relatedPaymentId: relatedPaymentId || null
            }
        });

        res.status(201).json({
            success: true,
            transaction: { ...transaction, _id: transaction.id }
        });
    } catch (error) {
        console.error('Create cash transaction error:', error);
        res.status(500).json({ success: false, error: 'Ошибка создания операции' });
    }
});

module.exports = router;
