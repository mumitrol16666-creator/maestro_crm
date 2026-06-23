const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { retryIntegrationLog } = require('../services/integrationJournal');
const { reconcileCrmWithLearningPlatform } = require('../services/integrationReconciliation');

router.use(authenticate, requireAdmin);

// GET /api/integration-logs
router.get('/', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            status,
            direction,
            system,
            retryable,
            search,
        } = req.query;

        const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
        const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;
        const where = {};

        if (status) where.status = status;
        if (direction) where.direction = direction;
        if (system) where.system = system;
        if (retryable === 'true') where.retryable = true;
        if (retryable === 'false') where.retryable = false;
        if (search && String(search).trim()) {
            const term = String(search).trim();
            where.OR = [
                { operation: { contains: term, mode: 'insensitive' } },
                { path: { contains: term, mode: 'insensitive' } },
                { errorMessage: { contains: term, mode: 'insensitive' } },
                { entityId: { contains: term, mode: 'insensitive' } },
            ];
        }

        const [logs, total] = await Promise.all([
            prisma.integrationLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take,
            }),
            prisma.integrationLog.count({ where }),
        ]);

        res.json({
            success: true,
            logs,
            pagination: {
                total,
                page: Math.max(parseInt(page, 10) || 1, 1),
                totalPages: Math.ceil(total / take),
                limit: take,
            },
        });
    } catch (error) {
        console.error('Get integration logs error:', error);
        res.status(500).json({ success: false, error: 'Ошибка получения журнала интеграций' });
    }
});

// POST /api/integration-logs/:id/retry
router.post('/:id/retry', async (req, res) => {
    try {
        const result = await retryIntegrationLog(req.params.id);
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        return res.json(result);
    } catch (error) {
        console.error('Retry integration operation error:', error);
        res.status(500).json({ success: false, error: 'Не удалось повторить операцию' });
    }
});

// GET /api/integration-logs/reconciliation/summary
router.get('/reconciliation/summary', async (req, res) => {
    try {
        const result = await reconcileCrmWithLearningPlatform();
        return res.json(result);
    } catch (error) {
        console.error('Integration reconciliation error:', error);
        res.status(500).json({ success: false, error: 'Ошибка сверки CRM и приложения' });
    }
});

module.exports = router;
