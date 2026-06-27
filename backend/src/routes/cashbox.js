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

        const [cashPaymentIncome, cashManualIncome, cashExpense] = await Promise.all([
            prisma.cashTransaction.aggregate({
                where: {
                    type: 'income',
                    relatedPaymentId: { not: null },
                    date: { gte: start, lte: end }
                },
                _sum: { amount: true },
                _count: true
            }),
            prisma.cashTransaction.aggregate({
                where: {
                    type: 'income',
                    relatedPaymentId: null,
                    date: { gte: start, lte: end }
                },
                _sum: { amount: true },
                _count: true
            }),
            prisma.cashTransaction.aggregate({
                where: { type: 'expense', date: { gte: start, lte: end } },
                _sum: { amount: true },
                _count: true
            })
        ]);

        const paymentsTotal = cashPaymentIncome._sum.amount || 0;
        const manualIncome = cashManualIncome._sum.amount || 0;
        const expenses = cashExpense._sum.amount || 0;
        const totalIncome = paymentsTotal + manualIncome;
        const net = totalIncome - expenses;

        res.json({
            success: true,
            period: { from: start, to: end },
            summary: {
                paymentsTotal,
                paymentsCount: cashPaymentIncome._count,
                manualIncome,
                manualIncomeCount: cashManualIncome._count,
                expenses,
                expensesCount: cashExpense._count,
                totalIncome,
                net
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
        const { from, to, type, page = 1, limit = 50 } = req.query;
        const pageNum = parseInt(page, 10);
        const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
        const skip = (pageNum - 1) * limitNum;

        const where = {};
        if (type && ['income', 'expense'].includes(type)) where.type = type;

        const range = parseDateRange(from, to);
        if (range) where.date = { gte: range.start, lte: range.end };

        const [transactions, total] = await Promise.all([
            prisma.cashTransaction.findMany({
                where,
                include: {
                    createdBy: { select: { id: true, name: true, lastName: true } },
                    relatedPayment: { select: { id: true, amount: true, type: true } }
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
