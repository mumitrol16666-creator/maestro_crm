const express = require('express');
const router = express.Router();
const CashTransaction = require('../models/CashTransaction');
const { authenticate, requireAdmin } = require('../middleware/auth');

// @route   GET /api/cash-transactions
// @desc    Получить транзакции кассы с фильтрами
// @access  Private (Admin)
router.get('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { startDate, endDate, type, category } = req.query;
        
        let filter = {};
        
        // Фильтр по типу (income/expense)
        if (type) {
            filter.type = type;
        }
        
        // Фильтр по категории
        if (category) {
            filter.category = category;
        }
        
        // Фильтр по датам
        if (startDate || endDate) {
            filter.date = {};
            if (startDate) {
                filter.date.$gte = new Date(startDate);
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                filter.date.$lte = end;
            }
        }
        
        const transactions = await CashTransaction.find(filter)
            .populate('createdBy', 'name')
            .sort({ date: -1, createdAt: -1 })
            .lean();
        
        res.json({
            success: true,
            transactions
        });
    } catch (error) {
        console.error('Get cash transactions error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении транзакций'
        });
    }
});

// @route   POST /api/cash-transactions
// @desc    Создать транзакцию (доход или расход)
// @access  Private (Admin)
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { type, amount, category, description, date, notes } = req.body;
        
        // Валидация
        if (!type || !['income', 'expense'].includes(type)) {
            return res.status(400).json({
                success: false,
                error: 'Неверный тип транзакции'
            });
        }
        
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Сумма должна быть больше 0'
            });
        }
        
        if (!category) {
            return res.status(400).json({
                success: false,
                error: 'Категория обязательна'
            });
        }
        
        if (!description) {
            return res.status(400).json({
                success: false,
                error: 'Описание обязательно'
            });
        }
        
        const transaction = await CashTransaction.create({
            type,
            amount,
            category,
            description,
            date: date ? new Date(date) : new Date(),
            notes: notes || '',
            createdBy: req.user._id
        });
        
        console.log(`💰 ${type === 'income' ? 'Доход' : 'Расход'}: ${amount}₸ - ${description}`);
        
        res.status(201).json({
            success: true,
            message: `${type === 'income' ? 'Доход' : 'Расход'} добавлен`,
            transaction
        });
    } catch (error) {
        console.error('Create cash transaction error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при создании транзакции'
        });
    }
});

// @route   GET /api/cash-transactions/statistics
// @desc    Получить статистику кассы (обороты, доходы, расходы)
// @access  Private (Admin)
router.get('/statistics', authenticate, requireAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        console.log(`📊 GET /api/cash-transactions/statistics - startDate: ${startDate}, endDate: ${endDate}`);
        
        let filter = {};
        
        // Фильтр по датам
        if (startDate || endDate) {
            filter.date = {};
            if (startDate) {
                filter.date.$gte = new Date(startDate);
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                filter.date.$lte = end;
            }
        }
        
        console.log(`📅 Фильтр для транзакций:`, JSON.stringify(filter));
        
        // Параллельно получаем все необходимые данные
        const [
            incomeTransactions,
            expenseTransactions,
            incomeByCategory,
            expenseByCategory
        ] = await Promise.all([
            CashTransaction.find({ ...filter, type: 'income' }),
            CashTransaction.find({ ...filter, type: 'expense' }),
            CashTransaction.aggregate([
                { $match: { ...filter, type: 'income' } },
                { $group: {
                    _id: '$category',
                    total: { $sum: '$amount' },
                    count: { $sum: 1 }
                }},
                { $sort: { total: -1 } }
            ]),
            CashTransaction.aggregate([
                { $match: { ...filter, type: 'expense' } },
                { $group: {
                    _id: '$category',
                    total: { $sum: '$amount' },
                    count: { $sum: 1 }
                }},
                { $sort: { total: -1 } }
            ])
        ]);
        
        // Подсчитываем итоги
        const totalIncome = incomeTransactions.reduce((sum, t) => sum + t.amount, 0);
        const totalExpense = expenseTransactions.reduce((sum, t) => sum + t.amount, 0);
        const netProfit = totalIncome - totalExpense;
        
        console.log(`✅ Найдено транзакций: доходы=${incomeTransactions.length}, расходы=${expenseTransactions.length}`);
        console.log(`💰 Итоги: доходы=${totalIncome}₸, расходы=${totalExpense}₸, прибыль=${netProfit}₸`);
        
        res.json({
            success: true,
            statistics: {
                totalIncome,      // Общий доход
                totalExpense,     // Общие расходы
                netProfit,        // Чистая прибыль
                incomeCount: incomeTransactions.length,
                expenseCount: expenseTransactions.length,
                incomeByCategory,
                expenseByCategory
            }
        });
    } catch (error) {
        console.error('Get cash statistics error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении статистики'
        });
    }
});

// @route   DELETE /api/cash-transactions/:id
// @desc    Удалить транзакцию
// @access  Private (Admin)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const transaction = await CashTransaction.findById(req.params.id);
        
        if (!transaction) {
            return res.status(404).json({
                success: false,
                error: 'Транзакция не найдена'
            });
        }
        
        await transaction.deleteOne();
        
        console.log(`🗑️ Удалена транзакция: ${transaction.type} - ${transaction.amount}₸`);
        
        res.json({
            success: true,
            message: 'Транзакция удалена'
        });
    } catch (error) {
        console.error('Delete cash transaction error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при удалении транзакции'
        });
    }
});

module.exports = router;

