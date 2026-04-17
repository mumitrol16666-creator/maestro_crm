const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin, requireSalesOrAdmin, requireNotStudent } = require('../middleware/auth');
const { cacheUtils } = require('../config/redis');

// Функция для очистки кэша (экспортируем для использования в других модулях)
function clearStatsCache() {
    cacheUtils.delPattern('admin:stats:*');
    console.log('🗑️  Redis кэш статистики дашборда очищен');
}

// @route   GET /api/admin/stats
// @desc    Получить статистику для дашборда
// @access  Private (все, кроме студентов)
router.get('/stats', authenticate, requireNotStudent, async (req, res) => {
    try {
        const userRole = req.user.role;
        const userId = req.user.id;
        
        // 🚀 Redis кэширование
        const cacheKey = `admin:stats:${userRole}:${userId}`;
        const cachedData = await cacheUtils.get(cacheKey);
        if (cachedData) {
            console.log('📦 Cache HIT for admin stats');
            return res.json(cachedData);
        }
        console.log('🔄 Cache MISS for admin stats - fetching from DB');
        
        // Доход за текущий месяц
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        // ⚡ ОПТИМИЗАЦИЯ: Выполняем запросы последовательно или малыми порциями, 
        // чтобы не забивать пул коннектов Prisma (что вызывает долгое подвисание)
        const totalStudents = await prisma.student.count({ where: { status: 'active', role: 'student' } });
        const totalGroups = await prisma.group.count({ where: { isActive: true } });
        const newBookings = await prisma.booking.count({ where: { status: 'new' } });
        const activeMemberships = await prisma.membership.count({ where: { status: 'active' } });
        
        const monthlyPayments = await prisma.payment.aggregate({
            where: { status: 'completed', paymentDate: { gte: startOfMonth } },
            _sum: { amount: true }
        });
        
        const enrolledThisMonth = await prisma.booking.count({
            where: { status: 'trial', processedAt: { gte: startOfMonth } }
        });
        
        const directionStats = await prisma.group.groupBy({
            by: ['direction'],
            where: { isActive: true },
            _sum: { currentStudents: true },
            _count: { id: true }
        });
        
        const recentBookings = await prisma.booking.findMany({
            orderBy: { createdAt: 'desc' },
            take: 5
        });
        
        const totalDebt = await prisma.membership.aggregate({
            where: { status: 'active', remainingAmount: { gt: 0 } },
            _sum: { remainingAmount: true }
        });
        
        const overduePayments = await prisma.payment.findMany({
            where: {
                status: { in: ['pending'] },
                dueDate: { lt: new Date() }
            },
            include: {
                student: { select: { name: true, lastName: true, phone: true } }
            }
        });
        
        const monthlyRevenue = monthlyPayments._sum.amount || 0;
        const totalDebtAmount = totalDebt._sum.remainingAmount || 0;
        const overdueAmount = overduePayments.reduce((sum, p) => sum + p.amount, 0);
        
        // Форматируем directionStats для совместимости с фронтендом
        const formattedDirectionStats = directionStats.map(d => ({
            _id: d.direction,
            totalStudents: d._sum.currentStudents || 0,
            groupsCount: d._count.id
        })).sort((a, b) => b.totalStudents - a.totalStudents);
        
        // Маппим recentBookings для фронтенда
        const mappedRecentBookings = recentBookings.map(b => ({ ...b, _id: b.id }));
        
        // 👨‍🏫 ДЛЯ ПРЕПОДАВАТЕЛЯ: Подсчет посещений в этом месяце
        let teacherAttendanceCount = 0;
        if (userRole === 'teacher') {
            const teacherClasses = await prisma.class.findMany({
                where: {
                    teacherId: userId,
                    date: { gte: startOfMonth, lt: new Date() }
                },
                include: {
                    attendees: true
                }
            });
            
            teacherClasses.forEach(cls => {
                const presentCount = cls.attendees.filter(a => a.attended === true).length;
                teacherAttendanceCount += presentCount;
            });
        }
        
        const stats = {
            totalStudents,
            totalGroups,
            newBookings,
            activeMemberships,
            monthlyRevenue,
            enrolledThisMonth,
            directionStats: formattedDirectionStats,
            recentBookings: mappedRecentBookings,
            // 🔴 ДОЛГИ
            totalDebt: totalDebtAmount,
            overdueAmount,
            overdueCount: overduePayments.length,
            // 👨‍🏫 ДЛЯ ПРЕПОДАВАТЕЛЯ
            teacherAttendanceCount
        };
        
        // Сохраняем в кэш
        const responseData = { success: true, stats };
        
        // 🚀 Кэшируем результат на 2 минуты
        await cacheUtils.set(cacheKey, responseData, 120);
        console.log('💾 Cached admin stats data');
        
        res.json(responseData);
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
router.get('/expiring-memberships', authenticate, requireAdmin, async (req, res) => {
    try {
        const memberships = await prisma.membership.findMany({
            where: {
                status: 'active',
                classesRemaining: { lte: 2 }
            },
            include: {
                student: { select: { id: true, name: true, lastName: true, phone: true } },
                group: { select: { id: true, name: true } }
            },
            orderBy: { classesRemaining: 'asc' }
        });
        
        // Маппим для совместимости с фронтендом
        const mapped = memberships.map(m => ({
            ...m,
            _id: m.id,
            student: m.student ? { ...m.student, _id: m.student.id } : null,
            group: m.group ? { ...m.group, _id: m.group.id } : null
        }));
        
        res.json({
            success: true,
            count: mapped.length,
            memberships: mapped
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
router.get('/attendance-report', authenticate, requireAdmin, async (req, res) => {
    try {
        const { startDate, endDate, groupId } = req.query;
        
        const where = {};
        
        if (startDate && endDate) {
            where.date = {
                gte: new Date(startDate),
                lte: new Date(endDate)
            };
        }
        
        if (groupId) {
            where.groupId = groupId;
        }
        
        // В Prisma схеме нет модели Attendance отдельно — 
        // посещаемость хранится в ClassAttendee.
        // Извлекаем через связь class -> attendees
        const classes = await prisma.class.findMany({
            where,
            include: {
                attendees: {
                    include: {
                        student: { select: { id: true, name: true, lastName: true, phone: true } }
                    }
                },
                group: { select: { id: true, name: true, direction: true } }
            },
            orderBy: { date: 'desc' }
        });
        
        // Формируем плоский список посещений для совместимости
        const attendance = [];
        for (const cls of classes) {
            for (const att of cls.attendees) {
                attendance.push({
                    _id: att.id,
                    id: att.id,
                    date: cls.date,
                    attended: att.attended,
                    student: att.student ? { ...att.student, _id: att.student.id } : null,
                    group: cls.group ? { ...cls.group, _id: cls.group.id } : null
                });
            }
        }
        
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

// Экспортируем и router и функцию очистки кэша
module.exports = router;
module.exports.clearStatsCache = clearStatsCache;
