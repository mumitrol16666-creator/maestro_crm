const express = require('express');
const router = express.Router();
const CashTransaction = require('../models/CashTransaction');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { cacheUtils } = require('../config/redis');

// @route   GET /api/cash-transactions
// @desc    Получить транзакции кассы с фильтрами
// @access  Private (Admin)
router.get('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { startDate, endDate, type, category } = req.query;
        
        // Создаем ключ кэша
        const cacheKey = `cashbox:transactions:${startDate || 'all'}:${endDate || 'all'}:${type || 'all'}:${category || 'all'}`;
        
        // Проверяем кэш
        const cachedData = await cacheUtils.get(cacheKey);
        if (cachedData) {
            console.log('📦 Cache HIT for cashbox transactions');
            return res.json(cachedData);
        }
        
        console.log('🔄 Cache MISS for cashbox transactions - fetching from DB');
        
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
        
        const responseData = {
            success: true,
            transactions
        };
        
        // Сохраняем в кэш на 5 минут
        await cacheUtils.set(cacheKey, responseData, 300);
        console.log('💾 Cached cashbox transactions');
        
        res.json(responseData);
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
        
        // Инвалидируем кэш кассы
        await cacheUtils.delPattern('cashbox:*');
        console.log('🗑️ Cache invalidated for cashbox');
        
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
        
        // Создаем ключ кэша
        const cacheKey = `cashbox:statistics:${startDate || 'all'}:${endDate || 'all'}`;
        
        // Проверяем кэш
        const cachedData = await cacheUtils.get(cacheKey);
        if (cachedData) {
            console.log('📦 Cache HIT for cashbox statistics');
            return res.json(cachedData);
        }
        
        console.log('🔄 Cache MISS for cashbox statistics - fetching from DB');
        
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
        
        const responseData = {
            success: true,
            statistics: {
                totalIncome,      // Общий доход
                totalExpense,    // Общие расходы
                netProfit,       // Чистая прибыль
                incomeCount: incomeTransactions.length,
                expenseCount: expenseTransactions.length,
                incomeByCategory,
                expenseByCategory
            }
        };
        
        // Сохраняем в кэш на 5 минут
        await cacheUtils.set(cacheKey, responseData, 300);
        console.log('💾 Cached cashbox statistics');
        
        res.json(responseData);
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
        
        // Инвалидируем кэш кассы
        await cacheUtils.delPattern('cashbox:*');
        console.log('🗑️ Cache invalidated for cashbox');
        
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

