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
        
        console.log(`📊 GET /api/cashbox/stats - period: ${period}, startDate: ${startDate}, endDate: ${endDate}`);
        
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
        
        console.log(`📅 Период для выборки: ${start.toISOString()} - ${end.toISOString()}`);
        
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
            
            // Последние платежи (не используем populate - берем сохраненные имена)
            Payment.find({
                status: 'completed',
                paymentDate: { $gte: start, $lte: end }
            })
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
        
        console.log(`✅ Найдено платежей: ${totalRevenue.length > 0 ? totalRevenue[0].count : 0}`);
        console.log(`💰 Общая выручка: ${totalRevenue.length > 0 ? totalRevenue[0].total : 0}₸`);
        console.log(`📋 Типов платежей: ${revenueByType.length}`);
        
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
        
        // Получить все платежи менеджера за месяц (ИСКЛЮЧАЯ продления)
        const allPayments = await Payment.find({
            manager: managerId,
            paymentDate: { $gte: startOfMonth, $lte: endOfMonth },
            commissionStatus: { $ne: 'excluded' }  // ❌ Исключаем продления
        }).populate('membership', 'type').lean();
        
        // ✅ Подсчитать количество ПЕРВЫХ абонементов за месяц
        // (для определения ставки комиссии)
        // Доплаты (membership_balance) НЕ входят в COUNT!
        const firstMembershipPayments = allPayments.filter(p => 
            (p.type === 'membership_full' || p.type === 'membership_advance') &&
            p.isFirstMembershipForManager === true  // ✅ Только ПЕРВЫЕ абонементы
        );
        
        const membershipCount = firstMembershipPayments.length;
        
        // 💰 Для расчета комиссии берем ВСЕ платежи (включая доплаты)
        // ВАЖНО: Доплаты используют ставку ТЕКУЩЕГО месяца (месяца доплаты), а не месяца аванса!
        const payments = allPayments.filter(p => {
            // Аванс учитываем ТОЛЬКО если он в текущем месяце
            if (p.type === 'membership_advance' && p.isFirstMembershipForManager) {
                return true;  // Аванс в текущем месяце → +1 к COUNT, получает комиссию
            }
            // Доплата: НЕ в COUNT, но получает комиссию по ставке ТЕКУЩЕГО месяца
            if (p.type === 'membership_balance') {
                return true;  // Доплата → +0 к COUNT, но комиссия по ставке ТЕКУЩЕГО месяца!
            }
            // Остальные типы (полная оплата, пробные, разовые)
            if (p.isFirstMembershipForManager || p.type.includes('trial') || p.type.includes('single') || p.type.includes('individual')) {
                return true;
            }
            return false;
        });
        
        // 📊 Определить ставку на основе количества абонементов ТЕКУЩЕГО месяца
        // Эта ставка применится КО ВСЕМ платежам (включая доплаты за старые авансы)
        const rate = config.getMembershipRate(membershipCount);
        
        // Разбить платежи по типам и посчитать суммы
        const breakdown = {
            memberships: { count: 0, amount: 0, commission: 0 },
            trials: { count: 0, amount: 0, commission: 0 },
            singleClasses: { count: 0, amount: 0, commission: 0 },
            individualClasses: { count: 0, amount: 0, commission: 0 }
        };
        
        payments.forEach(payment => {
            switch(payment.type) {
                case 'membership_full':
                case 'membership_advance':
                case 'membership_balance':
                    breakdown.memberships.count++;
                    breakdown.memberships.amount += payment.amount;
                    break;
                    
                case 'trial_full':
                case 'trial_advance':
                    breakdown.trials.count++;
                    breakdown.trials.amount += payment.amount;
                    break;
                    
                case 'single_class':
                    breakdown.singleClasses.count++;
                    breakdown.singleClasses.amount += payment.amount;
                    break;
                    
                case 'individual_class':
                    breakdown.individualClasses.count++;
                    breakdown.individualClasses.amount += payment.amount;
                    break;
            }
        });
        
        // ПРАВИЛЬНАЯ ЛОГИКА: Процент применяется к ОБЩЕЙ сумме каждого типа
        breakdown.memberships.commission = breakdown.memberships.amount * (rate / 100);
        breakdown.trials.commission = breakdown.trials.amount * (config.trialRate / 100);
        breakdown.singleClasses.commission = breakdown.singleClasses.amount * (config.singleClassRate / 100);
        breakdown.individualClasses.commission = breakdown.individualClasses.amount * (config.individualClassRate / 100);
        
        const totalCommission = 
            breakdown.memberships.commission +
            breakdown.trials.commission +
            breakdown.singleClasses.commission +
            breakdown.individualClasses.commission;
        
        // Проверить выполнение плана (если указан в запросе)
        const { plan } = req.query;
        let planBonus = 0;
        if (plan && parseFloat(plan) > 0) {
            const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);
            if (totalRevenue >= parseFloat(plan)) {
                planBonus = 20000; // +20k₸ за выполнение плана
            }
        }
        
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

