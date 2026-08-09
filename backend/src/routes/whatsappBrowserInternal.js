const express = require('express');
const { prisma } = require('../config/db');
const { requireWhatsappWorkerAuth } = require('../middleware/whatsappWorkerAuth');
const { importInboundBatch } = require('../services/whatsappBrowserInbox');

const router = express.Router();
const ACCOUNT_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,79}$/;
const SESSION_STATUSES = new Set(['starting', 'qr_required', 'connected', 'degraded', 'stopped']);

router.use(requireWhatsappWorkerAuth);

router.post('/heartbeat', async (req, res) => {
    try {
        const {
            accountKey,
            status,
            connector = 'playwright',
            mode = 'observer',
            phoneNumber = null,
            profileLabel = null,
            stoppedReason = null,
            metadata = null,
        } = req.body || {};

        if (!ACCOUNT_KEY_PATTERN.test(String(accountKey || ''))) {
            return res.status(400).json({ success: false, error: 'Некорректный accountKey' });
        }
        if (!SESSION_STATUSES.has(status)) {
            return res.status(400).json({ success: false, error: 'Некорректный статус сессии' });
        }
        if (connector !== 'playwright' || mode !== 'observer') {
            return res.status(409).json({
                success: false,
                error: 'На первом этапе разрешён только Playwright в режиме observer',
            });
        }

        const now = new Date();
        const session = await prisma.whatsappBrowserSession.upsert({
            where: { accountKey },
            create: {
                accountKey,
                connector,
                mode,
                status,
                workerId: req.whatsappWorkerId,
                phoneNumber,
                profileLabel,
                stoppedReason,
                metadata: metadata || undefined,
                lastHeartbeatAt: now,
                qrRequiredAt: status === 'qr_required' ? now : null,
            },
            update: {
                connector,
                mode,
                status,
                workerId: req.whatsappWorkerId,
                phoneNumber,
                profileLabel,
                stoppedReason,
                metadata: metadata || undefined,
                lastHeartbeatAt: now,
                ...(status === 'qr_required' ? { qrRequiredAt: now } : {}),
            },
        });

        return res.json({
            success: true,
            session: {
                accountKey: session.accountKey,
                status: session.status,
                mode: session.mode,
                lastHeartbeatAt: session.lastHeartbeatAt,
            },
        });
    } catch (error) {
        console.error('[whatsapp-browser] heartbeat:', error.message);
        return res.status(500).json({ success: false, error: 'Не удалось сохранить состояние worker' });
    }
});

router.post('/messages/import', async (req, res) => {
    try {
        const { accountKey, messages } = req.body || {};
        const session = await prisma.whatsappBrowserSession.findUnique({ where: { accountKey } });
        if (!session || session.workerId !== req.whatsappWorkerId) {
            return res.status(409).json({
                success: false,
                error: 'Worker сначала должен зарегистрировать эту сессию через heartbeat',
            });
        }
        if (session.mode !== 'observer') {
            return res.status(409).json({ success: false, error: 'Сессия находится в неподдерживаемом режиме' });
        }

        const result = await importInboundBatch({ accountKey, rawMessages: messages });
        req.app.get('io')?.emit('whatsapp:message', { source: 'browser', accountKey, ...result });
        return res.json({ success: true, ...result });
    } catch (error) {
        if (/Некоррект|должно|Пакет|Поддерживаются|Пустое|номер/.test(error.message)) {
            return res.status(400).json({ success: false, error: error.message });
        }
        console.error('[whatsapp-browser] import:', error.message);
        return res.status(500).json({ success: false, error: 'Не удалось импортировать сообщения' });
    }
});

router.get('/session/:accountKey', async (req, res) => {
    const session = await prisma.whatsappBrowserSession.findUnique({
        where: { accountKey: req.params.accountKey },
        select: {
            accountKey: true,
            connector: true,
            mode: true,
            status: true,
            workerId: true,
            phoneNumber: true,
            lastHeartbeatAt: true,
            lastIncomingAt: true,
            qrRequiredAt: true,
            stoppedReason: true,
        },
    });
    if (!session) return res.status(404).json({ success: false, error: 'Сессия не найдена' });
    return res.json({ success: true, session });
});

module.exports = router;
