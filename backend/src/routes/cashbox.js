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

// @route   GET /api/cashbox/salary/:managerId
// @desc    Рассчитать зарплату менеджера за месяц
// @access  Private/Admin
router.get('/salary/:managerId', authenticate, requireAdmin, async (req, res) => {
    try {
        const { managerId } = req.params;
        const { month } = req.query; // Формат: '2025-10'
        
        // Определить месяц
        let startOfMonth, endOfMonth;
        if (month) {
            const [year, monthNum] = month.split('-');
            startOfMonth = new Date(year, monthNum - 1, 1);
            endOfMonth = new Date(year, monthNum, 0, 23, 59, 59);
        } else {
            const now = new Date();
            startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        }
        
        // Получить менеджера
        const Student = require('../models/Student');
        const manager = await Student.findById(managerId);
        if (!manager) {
            return res.status(404).json({
                success: false,
                error: 'Менеджер не найден'
            });
        }
        
        // Получить конфигурацию комиссий
        const CommissionConfig = require('../models/CommissionConfig');
        const config = await CommissionConfig.findOne({
            role: 'sales_manager',
            isActive: true,
            effectiveFrom: { $lte: startOfMonth }
        }).sort({ effectiveFrom: -1 });
        
        if (!config) {
            return res.status(404).json({
                success: false,
                error: 'Конфигурация комиссий не найдена'
            });
        }
        
        // Получить все ЗАВЕРШЕННЫЕ платежи менеджера за месяц
        const payments = await Payment.find({
            manager: managerId,
            status: 'completed',
            paymentDate: { $gte: startOfMonth, $lte: endOfMonth }
        }).populate('membership', 'type').lean();
        
        // Подсчитать количество проданных АБОНЕМЕНТОВ (не пробных!) за месяц
        const membershipPayments = payments.filter(p => 
            p.type === 'membership_full' || p.type === 'membership_advance'
        );
        
        const membershipCount = membershipPayments.length;
        
        // Определить ставку на основе количества абонементов
        const rate = config.getMembershipRate(membershipCount);
        
        // Рассчитать комиссию для каждого платежа
        let totalCommission = 0;
        const breakdown = {
            memberships: { count: 0, amount: 0, commission: 0 },
            trials: { count: 0, amount: 0, commission: 0 },
            singleClasses: { count: 0, amount: 0, commission: 0 },
            individualClasses: { count: 0, amount: 0, commission: 0 }
        };
        
        payments.forEach(payment => {
            let commission = 0;
            
            switch(payment.type) {
                case 'membership_full':
                case 'membership_advance':
                case 'membership_balance':
                    // Абонементы - прогрессивная ставка
                    commission = payment.amount * (rate / 100);
                    breakdown.memberships.count++;
                    breakdown.memberships.amount += payment.amount;
                    breakdown.memberships.commission += commission;
                    break;
                    
                case 'trial_full':
                case 'trial_advance':
                    // Пробные - фиксированная ставка
                    commission = payment.amount * (config.trialRate / 100);
                    breakdown.trials.count++;
                    breakdown.trials.amount += payment.amount;
                    breakdown.trials.commission += commission;
                    break;
                    
                case 'single_class':
                    // Разовые - фиксированная ставка
                    commission = payment.amount * (config.singleClassRate / 100);
                    breakdown.singleClasses.count++;
                    breakdown.singleClasses.amount += payment.amount;
                    breakdown.singleClasses.commission += commission;
                    break;
                    
                case 'individual_class':
                    // Индивидуальные - фиксированная ставка
                    commission = payment.amount * (config.individualClassRate / 100);
                    breakdown.individualClasses.count++;
                    breakdown.individualClasses.amount += payment.amount;
                    breakdown.individualClasses.commission += commission;
                    break;
            }
            
            totalCommission += commission;
        });
        
        // Проверить выполнение плана (если есть)
        // TODO: Добавить модель SalesPlan и проверку выполнения
        const planBonus = 0; // Пока 0, потом добавим
        
        const totalSalary = totalCommission + planBonus;
        
        res.json({
            success: true,
            manager: {
                id: manager._id,
                name: `${manager.name} ${manager.lastName || ''}`
            },
            period: {
                month,
                start: startOfMonth,
                end: endOfMonth
            },
            summary: {
                totalRevenue: payments.reduce((sum, p) => sum + p.amount, 0),
                paymentsCount: payments.length,
                membershipsSold: membershipCount,
                commissionRate: rate,
                totalCommission: Math.round(totalCommission),
                planBonus,
                totalSalary: Math.round(totalSalary)
            },
            breakdown,
            config: {
                membershipTiers: config.membershipTiers,
                trialRate: config.trialRate,
                singleClassRate: config.singleClassRate,
                individualClassRate: config.individualClassRate
            }
        });
    } catch (error) {
        console.error('Get manager salary error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при расчете зарплаты'
        });
    }
});

module.exports = router;

