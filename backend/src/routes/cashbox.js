const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getPaymentMethodLabel, normalizePaymentMethod } = require('../services/paymentMethods');
const {
    buildCashboxAccountSummary,
    cashboxEffectiveAmount,
    isCashboxPaymentMethodFilter,
    normalizeCashboxTransferInput,
    resolveCashboxPaymentMethod,
} = require('../services/cashboxAccounts');

const ACCOUNT_TRANSFER_CATEGORIES = new Set(['account_transfer_in', 'account_transfer_out']);

const cashboxAccountSelect = {
    type: true,
    amount: true,
    category: true,
    paymentMethod: true,
    relatedPayment: { select: { amount: true, paymentMethod: true } },
    relatedShopSale: { select: { paymentMethod: true } },
};

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
        const paymentMethod = String(req.query.paymentMethod || '').trim();
        if (paymentMethod && !isCashboxPaymentMethodFilter(paymentMethod)) {
            return res.status(400).json({ success: false, error: 'Выбран неизвестный счёт' });
        }

        const [allTransactions, balanceTransactions] = await Promise.all([
            prisma.cashTransaction.findMany({
                where: { date: { gte: start, lte: end } },
                select: cashboxAccountSelect,
            }),
            prisma.cashTransaction.findMany({
                where: { date: { lte: new Date() } },
                select: cashboxAccountSelect,
            }),
        ]);
        const accounts = buildCashboxAccountSummary(allTransactions, balanceTransactions);
        const transactions = paymentMethod
            ? allTransactions.filter(tx => resolveCashboxPaymentMethod(tx) === paymentMethod)
            : allTransactions;

        let paymentsTotal = 0;
        let trialPaymentsTotal = 0;
        let correctionsTotal = 0;
        let manualIncome = 0;
        let realExpenses = 0;
        let refundsTotal = 0;
        let shopSalesTotal = 0;
        let shopRefundsTotal = 0;
        let shopPurchasesTotal = 0;

        let paymentsCount = 0;
        let trialPaymentsCount = 0;
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
            const amount = cashboxEffectiveAmount(tx);
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

            if (ACCOUNT_TRANSFER_CATEGORIES.has(tx.category)) {
                continue;
            }

            if (tx.category === 'payment' || tx.category === 'trial_payment') {
                paymentsTotal += amount;
                paymentsCount++;
                if (tx.category === 'trial_payment') {
                    trialPaymentsTotal += amount;
                    trialPaymentsCount++;
                }
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
            accounts,
            summary: {
                paymentsTotal,
                trialPaymentsTotal,
                trialPaymentsCount,
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
        const { from, to, type, category, search, paymentMethod, page = 1, limit = 50 } = req.query;
        const pageNum = parseInt(page, 10);
        const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
        const skip = (pageNum - 1) * limitNum;
        const accountFilter = String(paymentMethod || '').trim();
        if (accountFilter && !isCashboxPaymentMethodFilter(accountFilter)) {
            return res.status(400).json({ success: false, error: 'Выбран неизвестный счёт' });
        }

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

        const include = {
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
            relatedBooking: {
                select: {
                    id: true,
                    name: true,
                    lastName: true,
                    middleName: true,
                    phone: true,
                    direction: true,
                },
            },
        };

        let transactions;
        let total;
        if (accountFilter) {
            const matchingTransactions = (await prisma.cashTransaction.findMany({
                where,
                include,
                orderBy: { date: 'desc' },
            })).filter(tx => resolveCashboxPaymentMethod(tx) === accountFilter);
            total = matchingTransactions.length;
            transactions = matchingTransactions.slice(skip, skip + limitNum);
        } else {
            [transactions, total] = await Promise.all([
                prisma.cashTransaction.findMany({
                    where,
                    include,
                    orderBy: { date: 'desc' },
                    skip,
                    take: limitNum
                }),
                prisma.cashTransaction.count({ where })
            ]);
        }

        res.json({
            success: true,
            transactions: transactions.map(t => ({
                ...t,
                _id: t.id,
                paymentMethod: resolveCashboxPaymentMethod(t),
            })),
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
        let paymentMethod;
        try {
            paymentMethod = normalizePaymentMethod(req.body.paymentMethod);
        } catch (error) {
            return res.status(400).json({ success: false, error: error.message });
        }

        if (!['income', 'expense'].includes(type)) {
            return res.status(400).json({ success: false, error: 'Выберите приход или расход' });
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
                relatedPaymentId: relatedPaymentId || null,
                paymentMethod,
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

// POST /api/cashbox/accounts/transfer
router.post('/accounts/transfer', authenticate, requireAdmin, async (req, res) => {
    try {
        let transferInput;
        try {
            transferInput = normalizeCashboxTransferInput(req.body);
        } catch (error) {
            return res.status(400).json({ success: false, error: error.message });
        }

        const {
            amount,
            fromPaymentMethod,
            toPaymentMethod,
            date,
            notes,
        } = transferInput;
        const fromLabel = getPaymentMethodLabel(fromPaymentMethod);
        const toLabel = getPaymentMethodLabel(toPaymentMethod);

        const transfer = await prisma.cashAccountTransfer.create({
            data: {
                amount,
                fromPaymentMethod,
                toPaymentMethod,
                date,
                notes,
                createdById: req.user.id,
                transactions: {
                    create: [
                        {
                            type: 'expense',
                            amount,
                            category: 'account_transfer_out',
                            description: `Перевод на счёт «${toLabel}»`,
                            date,
                            paymentMethod: fromPaymentMethod,
                            notes,
                            createdById: req.user.id,
                        },
                        {
                            type: 'income',
                            amount,
                            category: 'account_transfer_in',
                            description: `Перевод со счёта «${fromLabel}»`,
                            date,
                            paymentMethod: toPaymentMethod,
                            notes,
                            createdById: req.user.id,
                        },
                    ],
                },
            },
            include: { transactions: true },
        });

        res.status(201).json({
            success: true,
            message: `Перевод со счёта «${fromLabel}» на счёт «${toLabel}» проведён`,
            transfer,
        });
    } catch (error) {
        console.error('Cashbox account transfer error:', error);
        res.status(500).json({ success: false, error: 'Не удалось провести перевод между счетами' });
    }
});

module.exports = router;
