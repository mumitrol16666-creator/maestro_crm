const express = require('express');
const router = express.Router();
const Student = require('../models/Student');
const Group = require('../models/Group');
const Membership = require('../models/Membership');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Attendance = require('../models/Attendance');
const { authenticate, requireAdmin, requireSalesOrAdmin, protect, adminOnly } = require('../middleware/auth');

// ⚡ КЭШИРОВАНИЕ: Сохраняем статистику на 2 минуты
let statsCache = null;
let statsCacheTime = null;
const CACHE_DURATION = 2 * 60 * 1000; // 2 минуты

// @route   GET /api/admin/stats
// @desc    Получить статистику для дашборда
// @access  Private/Admin/SalesManager
router.get('/stats', protect, requireSalesOrAdmin, async (req, res) => {
    // Проверяем кэш
    const now = Date.now();
    if (statsCache && statsCacheTime && (now - statsCacheTime < CACHE_DURATION)) {
        return res.json({ success: true, stats: statsCache, cached: true });
    }
    try {
        // Доход за текущий месяц
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        // ⚡ ОПТИМИЗАЦИЯ: Все запросы выполняем параллельно
        const [
            totalStudents,
            totalGroups,
            newBookings,
            activeMemberships,
            monthlyPayments,
            enrolledThisMonth,
            directionStats,
            recentBookings,
            totalDebt,
            overduePayments
        ] = await Promise.all([
            // Подсчет общей статистики (считаем только учеников, не админов/преподавателей)
            Student.countDocuments({ status: 'active', role: 'student' }),
            Group.countDocuments({ isActive: true }),
            Booking.countDocuments({ status: 'new' }),
            Membership.countDocuments({ status: 'active' }),
            
            // Доход за текущий месяц
            Payment.aggregate([
                { $match: { status: 'paid', confirmedAt: { $gte: startOfMonth } } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            
            // Количество записавшихся за месяц (для менеджеров)
            Booking.countDocuments({ status: 'trial', processedAt: { $gte: startOfMonth } }),
            
            // Статистика по направлениям
            Group.aggregate([
                { $match: { isActive: true } },
                { $group: { _id: '$direction', totalStudents: { $sum: '$currentStudents' }, groupsCount: { $sum: 1 } } },
                { $sort: { totalStudents: -1 } }
            ]),
            
            // Недавние заявки
            Booking.find().sort({ createdAt: -1 }).limit(5),
            
            // 🔴 ДОЛГИ: Сумма всех долгов (remainingAmount > 0)
            Membership.aggregate([
                { $match: { status: 'active', remainingAmount: { $gt: 0 } } },
                { $group: { _id: null, total: { $sum: '$remainingAmount' } } }
            ]),
            
            // 🔴 ПРОСРОЧКИ: Платежи с просроченным dueDate
            Payment.find({
                status: { $in: ['pending', 'not_paid'] },
                dueDate: { $lt: new Date() }
            }).populate('student', 'name lastName phone')
        ]);
        
        const monthlyRevenue = monthlyPayments.length > 0 ? monthlyPayments[0].total : 0;
        const totalDebtAmount = totalDebt.length > 0 ? totalDebt[0].total : 0;
        const overdueAmount = overduePayments.reduce((sum, p) => sum + p.amount, 0);
        
        const stats = {
            totalStudents,
            totalGroups,
            newBookings,
            activeMemberships,
            monthlyRevenue,
            enrolledThisMonth,
            directionStats,
            recentBookings,
            // 🔴 ДОЛГИ
            totalDebt: totalDebtAmount,
            overdueAmount,
            overdueCount: overduePayments.length
        };
        
        // Сохраняем в кэш
        statsCache = stats;
        statsCacheTime = Date.now();
        
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            error: 'Ошибка при получении статистики'
        });
    }
});

// @route   GET /api/admin/expiring-memberships
// @desc    Получить абонементы которые скоро истекут
// @access  Private/Admin
router.get('/expiring-memberships', protect, adminOnly, async (req, res) => {
    try {
        const memberships = await Membership.find({
            status: 'active',
            classesRemaining: { $lte: 2 }
        })
        .populate('student', 'name phone')
        .sort({ classesRemaining: 1 });
        
        res.json({
            success: true,
            count: memberships.length,
            memberships
        });
    } catch (error) {
        console.error('Get expiring memberships error:', error);
        res.status(500).json({
            error: 'Ошибка при получении истекающих абонементов'
        });
    }
});

// @route   GET /api/admin/attendance-report
// @desc    Отчет по посещаемости
// @access  Private/Admin
router.get('/attendance-report', protect, adminOnly, async (req, res) => {
    try {
        const { startDate, endDate, groupId } = req.query;
        
        const filter = {};
        
        if (startDate && endDate) {
            filter.date = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }
        
        if (groupId) {
            filter.group = groupId;
        }
        
        const attendance = await Attendance.find(filter)
            .populate('student', 'name phone')
            .populate('group', 'name direction')
            .sort({ date: -1 });
        
        res.json({
            success: true,
            count: attendance.length,
            attendance
        });
    } catch (error) {
        console.error('Get attendance report error:', error);
        res.status(500).json({
            error: 'Ошибка при получении отчета'
        });
    }
});

module.exports = router;


