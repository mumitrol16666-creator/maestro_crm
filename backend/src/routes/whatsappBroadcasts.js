const express = require('express');
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
    BroadcastError,
    createBroadcast,
    cancelBroadcast,
    broadcastOverview,
} = require('../services/whatsappBroadcast');

const router = express.Router();
router.use(authenticate, requireAdmin);

function sendError(res, error, fallback) {
    if (error instanceof BroadcastError) {
        return res.status(error.status).json({ success: false, error: error.message });
    }
    console.error(`[whatsapp-broadcast] ${fallback}:`, error.message);
    return res.status(500).json({ success: false, error: fallback });
}

// @route GET /api/admin/whatsapp-broadcasts
// @desc  Идущие и сегодняшние рассылки, состояние WhatsApp-воркера
router.get('/', async (req, res) => {
    try {
        res.json({ success: true, ...(await broadcastOverview(prisma)) });
    } catch (error) {
        sendError(res, error, 'Не удалось загрузить рассылки');
    }
});

// @route POST /api/admin/whatsapp-broadcasts
// @desc  Поставить в очередь сообщения одного фильтра «Напоминаний»
router.post('/', async (req, res) => {
    try {
        const { broadcast, skipped } = await createBroadcast(prisma, {
            kind: String(req.body?.kind || ''),
            items: req.body?.items,
            intervalSec: req.body?.intervalSec,
            userId: req.user.id,
        });
        res.status(201).json({
            success: true,
            broadcast: { id: broadcast.id, label: broadcast.label, count: broadcast.items.length },
            skipped,
        });
    } catch (error) {
        sendError(res, error, 'Не удалось запустить рассылку');
    }
});

// @route POST /api/admin/whatsapp-broadcasts/:id/cancel
// @desc  Остановить рассылку: неотправленные сообщения снимаются с очереди
router.post('/:id/cancel', async (req, res) => {
    try {
        const broadcast = await cancelBroadcast(prisma, req.params.id);
        res.json({ success: true, broadcast: { id: broadcast.id, status: broadcast.status } });
    } catch (error) {
        sendError(res, error, 'Не удалось остановить рассылку');
    }
});

module.exports = router;
