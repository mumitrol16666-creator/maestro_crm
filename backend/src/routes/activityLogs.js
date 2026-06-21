const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { cacheUtils } = require('../config/redis');

// @route   GET /api/activity-logs
// @desc    Получить журнал действий (для раздела "Действия")
// @access  Private/Admin
router.get('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50, action, entityType, search } = req.query;

        console.log(`📜 GET /api/activity-logs requested by ${req.user.name}`, req.query);

        // Redis кэширование
        const cacheKey = `activity_logs:${page}:${limit}:${action || 'all'}:${entityType || 'all'}:${search || 'all'}`;
        const cachedData = await cacheUtils.get(cacheKey);

        if (cachedData) {
            console.log('📦 Cache HIT for activity logs');
            return res.json(cachedData);
        }

        // Каноничное имя -> все варианты, которые могли быть в БД (старые записи: lowercase plural)
        const ENTITY_ALIASES = {
            Booking: ['Booking', 'bookings'],
            Student: ['Student', 'students'],
            User: ['User', 'users'],
            Group: ['Group', 'groups'],
            Payment: ['Payment', 'payments'],
            Membership: ['Membership', 'memberships'],
            Family: ['Family', 'families'],
            Direction: ['Direction', 'directions'],
            ActivityLog: ['ActivityLog', 'activity-logs'],
            Attendance: ['Attendance', 'attendance'],
            Rental: ['Rental', 'rentals'],
        };

        const where = {};
        if (action) where.action = action;
        if (entityType) {
            where.entityType = { in: ENTITY_ALIASES[entityType] || [entityType] };
        }
        if (search && String(search).trim()) {
            const term = String(search).trim();
            where.OR = [
                { details: { contains: term, mode: 'insensitive' } },
                { entityId: { contains: term, mode: 'insensitive' } },
                { user: { is: { name: { contains: term, mode: 'insensitive' } } } },
                { user: { is: { lastName: { contains: term, mode: 'insensitive' } } } },
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        const [logs, total] = await Promise.all([
            prisma.activityLog.findMany({
                where,
                include: {
                    user: {
                        select: { name: true, lastName: true, role: true }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take
            }),
            prisma.activityLog.count({ where })
        ]);

        const totalPages = Math.ceil(total / take);

        const responseData = {
            success: true,
            logs,
            pagination: {
                total,
                page: parseInt(page),
                totalPages,
                limit: take
            }
        };

        // Кэшируем на 30 секунд (логи могут часто обновляться)
        await cacheUtils.set(cacheKey, responseData, 30);

        res.json(responseData);

    } catch (error) {
        console.error('Get activity logs error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении журнала действий'
        });
    }
});

// @route   GET /api/activity-logs/stats
// @desc    Получить статистику по действиям (например, сколько удалений за сегодня)
// @access  Private/Admin
router.get('/stats', authenticate, requireAdmin, async (req, res) => {
    try {
        // Статистика за сегодня
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const stats = await prisma.activityLog.groupBy({
            by: ['action'],
            where: { createdAt: { gte: today } },
            _count: { action: true }
        });

        const formattedStats = stats.reduce((acc, curr) => {
            acc[curr.action] = curr._count.action;
            return acc;
        }, {});

        res.json({
            success: true,
            today: formattedStats
        });

    } catch (error) {
        console.error('Get activity stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при получении статистики'
        });
    }
});

module.exports = router;
