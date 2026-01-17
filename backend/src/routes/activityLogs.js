const express = require('express');
const router = express.Router();
const ActivityLog = require('../models/ActivityLog');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { cacheUtils } = require('../config/redis');

// @route   GET /api/activity-logs
// @desc    Получить журнал действий (для раздела "Действия")
// @access  Private/Admin
router.get('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50, action, entityType } = req.query;

        console.log(`📜 GET /api/activity-logs requested by ${req.user.name}`, req.query);

        // Redis кэширование
        const cacheKey = `activity_logs:${page}:${limit}:${action || 'all'}:${entityType || 'all'}`;
        const cachedData = await cacheUtils.get(cacheKey);

        if (cachedData) {
            console.log('📦 Cache HIT for activity logs');
            return res.json(cachedData);
        }

        const query = {};
        if (action) query.action = action;
        if (entityType) query.entityType = entityType;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [logs, total] = await Promise.all([
            ActivityLog.find(query)
                .populate('user', 'name lastName role') // Кто сделал
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            ActivityLog.countDocuments(query)
        ]);

        const totalPages = Math.ceil(total / parseInt(limit));

        const responseData = {
            success: true,
            logs,
            pagination: {
                total,
                page: parseInt(page),
                totalPages,
                limit: parseInt(limit)
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

        const stats = await ActivityLog.aggregate([
            { $match: { createdAt: { $gte: today } } },
            { $group: { _id: '$action', count: { $sum: 1 } } }
        ]);

        const formattedStats = stats.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
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
