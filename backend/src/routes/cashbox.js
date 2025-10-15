const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const { authenticate, requireAdmin } = require('../middleware/auth');

// @route   GET /api/cashbox/stats
// @desc    Получить статистику по кассе за период
// @access  Private/Admin
router.get('/stats', authenticate, requireAdmin, async (req, res) => {
    try {
        const { period = 'month', startDate, endDate } = req.query;
        
        let start, end;
        const now = new Date();
        
        // Определить период
        if (startDate && endDate) {
            start = new Date(startDate);
            end = new Date(endDate);
        } else {
            switch(period) {
                case 'today':
                    start = new Date(now.setHours(0, 0, 0, 0));
                    end = new Date(now.setHours(23, 59, 59, 999));
                    break;
                case 'week':
                    start = new Date(now);
                    start.setDate(start.getDate() - 7);
                    end = new Date();
                    break;
                case 'month':
                    start = new Date(now.getFullYear(), now.getMonth(), 1);
                    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
                    break;
                case 'year':
                    start = new Date(now.getFullYear(), 0, 1);
                    end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
                    break;
                default:
                    start = new Date(now.getFullYear(), now.getMonth(), 1);
                    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
            }
        }
        
        // Параллельные запросы для всей статистики
        const [
            totalRevenue,
            revenueByType,
            revenueByManager,
            revenueByDay,
            paymentsList
        ] = await Promise.all([
            // Общая выручка за период
            Payment.aggregate([
                { 
                    $match: { 
                        status: 'completed',
                        paymentDate: { $gte: start, $lte: end }
                    }
                },
                { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
            ]),
            
            // Разбивка по типам платежей
            Payment.aggregate([
                { 
                    $match: { 
                        status: 'completed',
                        paymentDate: { $gte: start, $lte: end }
                    }
                },
                { 
                    $group: { 
                        _id: '$type',
                        total: { $sum: '$amount' },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { total: -1 } }
            ]),
            
            // Разбивка по менеджерам
            Payment.aggregate([
                { 
                    $match: { 
                        status: 'completed',
                        paymentDate: { $gte: start, $lte: end },
                        manager: { $ne: null }
                    }
                },
                { 
                    $group: { 
                        _id: '$manager',
                        total: { $sum: '$amount' },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { total: -1 } }
            ]),
            
            // Разбивка по дням
            Payment.aggregate([
                { 
                    $match: { 
                        status: 'completed',
                        paymentDate: { $gte: start, $lte: end }
                    }
                },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: '%Y-%m-%d', date: '$paymentDate' }
                        },
                        total: { $sum: '$amount' },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
            
            // Последние платежи
            Payment.find({
                status: 'completed',
                paymentDate: { $gte: start, $lte: end }
            })
            .populate('student', 'name lastName phone')
            .populate('manager', 'name lastName')
            .sort({ paymentDate: -1 })
            .limit(20)
            .lean()
        ]);
        
        // Populate manager names для разбивки
        const Student = require('../models/Student');
        const managersWithNames = await Promise.all(
            revenueByManager.map(async (item) => {
                const manager = await Student.findById(item._id).select('name lastName');
                return {
                    managerId: item._id,
                    managerName: manager ? `${manager.name} ${manager.lastName || ''}` : 'Неизвестно',
                    total: item.total,
                    count: item.count
                };
            })
        );
        
        res.json({
            success: true,
            period: {
                type: period,
                start,
                end
            },
            summary: {
                total: totalRevenue.length > 0 ? totalRevenue[0].total : 0,
                count: totalRevenue.length > 0 ? totalRevenue[0].count : 0,
                average: totalRevenue.length > 0 && totalRevenue[0].count > 0 
                    ? Math.round(totalRevenue[0].total / totalRevenue[0].count) 
                    : 0
            },
            byType: revenueByType,
            byManager: managersWithNames,
            byDay: revenueByDay,
            recentPayments: paymentsList
        });
    } catch (error) {
        console.error('Get cashbox stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении статистики кассы'
        });
    }
});

module.exports = router;

