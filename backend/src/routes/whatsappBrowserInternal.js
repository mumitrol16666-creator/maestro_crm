const express = require('express');
const { prisma } = require('../config/db');
const { requireWhatsappWorkerAuth } = require('../middleware/whatsappWorkerAuth');
const { importInboundBatch } = require('../services/whatsappBrowserInbox');
const { validateOutboxResult } = require('../services/whatsappOutboxPolicy');
const { sendTelegramNotification } = require('../utils/telegram');

const router = express.Router();
const ACCOUNT_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,79}$/;
const SESSION_STATUSES = new Set(['starting', 'qr_required', 'connected', 'degraded', 'stopped']);
const SESSION_MODES = new Set(['observer', 'manual']);
const ALERT_TYPES = new Set(['qr_required', 'degraded', 'dom_changed', 'stopped']);

function escapeTelegram(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
        if (connector !== 'playwright' || !SESSION_MODES.has(mode)) {
            return res.status(409).json({
                success: false,
                error: 'Разрешён только Playwright в режиме observer или manual',
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
        if (!SESSION_MODES.has(session.mode)) {
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

router.post('/outbox/claim', async (req, res) => {
    try {
        const { accountKey } = req.body || {};
        const session = await prisma.whatsappBrowserSession.findUnique({ where: { accountKey } });
        if (!session || session.workerId !== req.whatsappWorkerId || session.mode !== 'manual') {
            return res.status(409).json({ success: false, error: 'Сессия worker не зарегистрирована' });
        }
        if (session.status !== 'connected' || !session.lastHeartbeatAt || session.lastHeartbeatAt < new Date(Date.now() - 45_000)) {
            return res.status(409).json({ success: false, error: 'WhatsApp worker не подключён' });
        }

        const claimed = await prisma.$transaction(async tx => {
            const candidate = await tx.whatsappOutbox.findFirst({
                where: {
                    status: 'approved',
                    conversation: { browserAccountKey: accountKey, externalChatId: { not: null } },
                },
                orderBy: { createdAt: 'asc' },
                include: { conversation: { select: { externalChatId: true, phoneNumber: true } } },
            });
            if (!candidate) return null;
            const updated = await tx.whatsappOutbox.updateMany({
                where: { id: candidate.id, status: 'approved' },
                data: {
                    status: 'claimed',
                    claimedBy: req.whatsappWorkerId,
                    claimedAt: new Date(),
                    attemptCount: { increment: 1 },
                },
            });
            return updated.count === 1 ? candidate : null;
        });

        return res.json({
            success: true,
            message: claimed ? {
                id: claimed.id,
                externalChatId: claimed.conversation.externalChatId,
                phoneNumber: claimed.conversation.phoneNumber,
                content: claimed.content,
            } : null,
        });
    } catch (error) {
        console.error('[whatsapp-browser] claim:', error.message);
        return res.status(500).json({ success: false, error: 'Не удалось получить исходящее сообщение' });
    }
});

router.post('/outbox/:id/result', async (req, res) => {
    try {
        const status = validateOutboxResult(req.body?.status);
        const externalMessageId = String(req.body?.externalMessageId || '').trim().slice(0, 250) || null;
        const errorMessage = String(req.body?.error || '').trim().slice(0, 1000) || null;
        const current = await prisma.whatsappOutbox.findUnique({
            where: { id: req.params.id },
            include: { conversation: true },
        });
        if (!current || current.status !== 'claimed' || current.claimedBy !== req.whatsappWorkerId) {
            return res.status(409).json({ success: false, error: 'Сообщение не закреплено за этим worker' });
        }

        const result = await prisma.$transaction(async tx => {
            const outbox = await tx.whatsappOutbox.update({
                where: { id: current.id },
                data: {
                    status,
                    externalMessageId,
                    lastError: errorMessage,
                    sentAt: status === 'sent' ? new Date() : null,
                },
            });
            if (status === 'sent') {
                const timestamp = new Date();
                await tx.conversationMessage.create({
                    data: {
                        conversationId: current.conversationId,
                        externalMessageId,
                        fingerprint: current.idempotencyKey,
                        role: 'assistant',
                        direction: 'outgoing',
                        messageType: 'text',
                        content: current.content,
                        timestamp,
                    },
                });
                await tx.conversation.update({
                    where: { id: current.conversationId },
                    data: {
                        lastMessageAt: timestamp,
                        lastOutboundAt: timestamp,
                        messageCount: { increment: 1 },
                    },
                });
            }
            return outbox;
        });
        req.app.get('io')?.emit('whatsapp:outbox', {
            conversationId: current.conversationId,
            outboxId: result.id,
            status: result.status,
        });
        return res.json({ success: true, result: { id: result.id, status: result.status } });
    } catch (error) {
        if (/Некорректный результат/.test(error.message)) {
            return res.status(400).json({ success: false, error: error.message });
        }
        if (error?.code === 'P2002') {
            return res.status(409).json({ success: false, error: 'Результат отправки уже зарегистрирован' });
        }
        console.error('[whatsapp-browser] result:', error.message);
        return res.status(500).json({ success: false, error: 'Не удалось сохранить результат отправки' });
    }
});

router.post('/alert', async (req, res) => {
    try {
        const accountKey = String(req.body?.accountKey || '').trim();
        const type = String(req.body?.type || '').trim();
        const details = String(req.body?.details || '').trim().slice(0, 800);
        if (!ACCOUNT_KEY_PATTERN.test(accountKey) || !ALERT_TYPES.has(type)) {
            return res.status(400).json({ success: false, error: 'Некорректная авария worker' });
        }
        const session = await prisma.whatsappBrowserSession.findUnique({ where: { accountKey } });
        if (!session || session.workerId !== req.whatsappWorkerId) {
            return res.status(409).json({ success: false, error: 'Сессия worker не зарегистрирована' });
        }
        const labels = {
            qr_required: 'WhatsApp вышел из аккаунта — требуется QR',
            degraded: 'WhatsApp worker работает с ошибками',
            dom_changed: 'WhatsApp изменил интерфейс — сообщения не читаются',
            stopped: 'WhatsApp worker остановлен',
        };
        const message = `⚠️ <b>${labels[type]}</b>\nАккаунт: ${escapeTelegram(accountKey)}${details ? `\nДетали: ${escapeTelegram(details)}` : ''}`;
        const delivered = await sendTelegramNotification(message);
        req.app.get('io')?.emit('whatsapp:alert', { accountKey, type, delivered });
        return res.json({ success: true, delivered });
    } catch (error) {
        console.error('[whatsapp-browser] alert:', error.message);
        return res.status(500).json({ success: false, error: 'Не удалось отправить аварию' });
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
