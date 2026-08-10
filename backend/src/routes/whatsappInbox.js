const express = require('express');
const { prisma } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
    normalizeManualMessage,
    buildOutboxIdempotencyKey,
    canQueueManualMessage,
} = require('../services/whatsappOutboxPolicy');
const { getWhatsappQr } = require('../services/whatsappQrStore');

const router = express.Router();
router.use(authenticate, requireAdmin);

function positiveInt(value, fallback, max) {
    const parsed = Number.parseInt(value, 10);
    return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, 1), max);
}

async function conversationWhere(query) {
    const where = { source: { startsWith: 'whatsapp' } };
    const search = String(query.search || '').trim().slice(0, 100);
    if (query.filter === 'needs_reply') {
        const rawMatches = await prisma.$queryRaw`
            SELECT id FROM "Conversation"
            WHERE source LIKE 'whatsapp%'
              AND "lastInboundAt" IS NOT NULL
              AND ("lastOutboundAt" IS NULL OR "lastOutboundAt" < "lastInboundAt")
        `;
        where.id = { in: rawMatches.map(r => r.id) };
    } else if (query.filter === 'taken') {
        where.automationStatus = 'paused';
    } else if (query.filter === 'unlinked') {
        where.studentId = null;
        where.bookingId = null;
    }
    if (search) {
        const searchConditions = [
            { name: { contains: search, mode: 'insensitive' } },
            { phoneNumber: { contains: search.replace(/\D/g, '') || search } },
            { student: { is: { OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
            ] } } },
        ];
        if (where.OR) {
            where.AND = [{ OR: where.OR }, { OR: searchConditions }];
            delete where.OR;
        } else {
            where.OR = searchConditions;
        }
    }
    return where;
}

router.get('/status', async (req, res) => {
    try {
        const staleBefore = new Date(Date.now() - 45_000);
        const [session, total, needsReplyRows, taken, queued] = await Promise.all([
            prisma.whatsappBrowserSession.findFirst({
                orderBy: { updatedAt: 'desc' },
                select: {
                    accountKey: true,
                    connector: true,
                    mode: true,
                    status: true,
                    phoneNumber: true,
                    profileLabel: true,
                    lastHeartbeatAt: true,
                    lastIncomingAt: true,
                    qrRequiredAt: true,
                    stoppedReason: true,
                },
            }),
            prisma.conversation.count({ where: { source: { startsWith: 'whatsapp' } } }),
            prisma.$queryRaw`
                SELECT COUNT(*)::int AS count FROM "Conversation"
                WHERE source LIKE 'whatsapp%'
                  AND "lastInboundAt" IS NOT NULL
                  AND ("lastOutboundAt" IS NULL OR "lastOutboundAt" < "lastInboundAt")
            `,
            prisma.conversation.count({ where: { source: { startsWith: 'whatsapp' }, automationStatus: 'paused' } }),
            prisma.whatsappOutbox.count({ where: { status: { in: ['approved', 'claimed', 'uncertain'] } } }),
        ]);
        const needsReply = Number(needsReplyRows[0]?.count || 0);
        const workerAlive = Boolean(session?.lastHeartbeatAt && session.lastHeartbeatAt >= staleBefore);
        const online = Boolean(session?.status === 'connected' && workerAlive);
        res.json({
            success: true,
            status: { online, workerAlive, session, totals: { conversations: total, needsReply, taken, queued } },
        });
    } catch (error) {
        console.error('[whatsapp-inbox] status:', error.message);
        res.status(500).json({ success: false, error: 'Не удалось получить состояние WhatsApp' });
    }
});

router.get('/qr', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, private, max-age=0');
        res.set('Pragma', 'no-cache');
        const session = await prisma.whatsappBrowserSession.findFirst({
            orderBy: { updatedAt: 'desc' },
            select: { accountKey: true, status: true, lastHeartbeatAt: true },
        });
        if (!session) return res.status(404).json({ success: false, error: 'Сессия WhatsApp ещё не запускалась' });
        if (session.status === 'connected') {
            return res.status(409).json({ success: false, error: 'WhatsApp уже подключён' });
        }
        if (session.status !== 'qr_required') {
            return res.status(409).json({ success: false, error: 'Worker пока не запросил QR-код' });
        }
        const qr = getWhatsappQr(session.accountKey);
        if (!qr) {
            return res.status(404).json({ success: false, error: 'Свежий QR ещё готовится. Нажмите «Обновить» через несколько секунд.' });
        }
        return res.json({
            success: true,
            qr: {
                imageDataUrl: `data:image/png;base64,${qr.image.toString('base64')}`,
                capturedAt: qr.capturedAt,
                expiresAt: qr.expiresAt,
            },
        });
    } catch (error) {
        console.error('[whatsapp-inbox] qr:', error.message);
        return res.status(500).json({ success: false, error: 'Не удалось получить QR-код' });
    }
});

router.get('/conversations', async (req, res) => {
    try {
        const page = positiveInt(req.query.page, 1, 100000);
        const limit = positiveInt(req.query.limit, 40, 100);
        const where = await conversationWhere(req.query);
        const [items, total] = await Promise.all([
            prisma.conversation.findMany({
                where,
                orderBy: { lastMessageAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    student: { select: { id: true, name: true, lastName: true, middleName: true } },
                    booking: { select: { id: true, name: true, lastName: true, status: true } },
                    messages: { orderBy: { timestamp: 'desc' }, take: 1 },
                },
            }),
            prisma.conversation.count({ where }),
        ]);
        res.json({ success: true, conversations: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (error) {
        console.error('[whatsapp-inbox] list:', error.message);
        res.status(500).json({ success: false, error: 'Не удалось загрузить диалоги' });
    }
});

router.get('/conversations/:id', async (req, res) => {
    try {
        const conversation = await prisma.conversation.findUnique({
            where: { id: req.params.id },
            include: {
                student: { select: { id: true, name: true, lastName: true, middleName: true, phone: true } },
                booking: { select: { id: true, name: true, lastName: true, phone: true, status: true } },
                messages: { orderBy: { timestamp: 'desc' }, take: 300 },
                outbox: { orderBy: { createdAt: 'desc' }, take: 20 },
            },
        });
        if (!conversation) return res.status(404).json({ success: false, error: 'Диалог не найден' });
        res.json({ success: true, conversation });
    } catch (error) {
        console.error('[whatsapp-inbox] detail:', error.message);
        res.status(500).json({ success: false, error: 'Не удалось загрузить переписку' });
    }
});

router.patch('/conversations/:id/takeover', async (req, res) => {
    try {
        const action = String(req.body?.action || 'take');
        if (!['take', 'release'].includes(action)) {
            return res.status(400).json({ success: false, error: 'Некорректное действие' });
        }
        const current = await prisma.conversation.findUnique({ where: { id: req.params.id } });
        if (!current) return res.status(404).json({ success: false, error: 'Диалог не найден' });
        if (action === 'take' && current.takeoverById && current.takeoverById !== req.user.id && req.user.role !== 'super_admin') {
            return res.status(409).json({ success: false, error: 'Диалог уже забрал другой администратор' });
        }
        if (action === 'release' && current.takeoverById && current.takeoverById !== req.user.id && req.user.role !== 'super_admin') {
            return res.status(409).json({ success: false, error: 'Диалог забрал другой администратор' });
        }
        const data = action === 'take' ? {
                automationStatus: 'paused',
                takeoverById: req.user.id,
                takeoverAt: new Date(),
                takeoverUntil: null,
                takeoverReason: String(req.body?.reason || 'Ручная работа администратора').trim().slice(0, 300),
            } : {
                automationStatus: 'observer',
                takeoverById: null,
                takeoverAt: null,
                takeoverUntil: null,
                takeoverReason: null,
            };
        const isSuperAdmin = req.user.role === 'super_admin';
        const guard = action === 'take'
            ? { OR: [{ takeoverById: null }, { takeoverById: req.user.id }, { automationStatus: { not: 'paused' } }] }
            : { OR: [{ takeoverById: null }, { takeoverById: req.user.id }] };
        const updated = await prisma.conversation.updateMany({
            where: { id: current.id, ...(isSuperAdmin ? {} : guard) },
            data,
        });
        if (updated.count !== 1) {
            return res.status(409).json({ success: false, error: 'Состояние диалога уже изменил другой администратор' });
        }
        const conversation = await prisma.conversation.findUnique({ where: { id: current.id } });
        req.app.get('io')?.emit('whatsapp:conversation', { conversationId: conversation.id, action });
        res.json({ success: true, conversation });
    } catch (error) {
        console.error('[whatsapp-inbox] takeover:', error.message);
        res.status(500).json({ success: false, error: 'Не удалось изменить режим диалога' });
    }
});

router.patch('/conversations/:id/link', async (req, res) => {
    try {
        const studentId = req.body?.studentId || null;
        const bookingId = req.body?.bookingId || null;
        if (studentId && !await prisma.student.findUnique({ where: { id: studentId }, select: { id: true } })) {
            return res.status(400).json({ success: false, error: 'Ученик не найден' });
        }
        if (bookingId && !await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true } })) {
            return res.status(400).json({ success: false, error: 'Заявка не найдена' });
        }
        const conversation = await prisma.conversation.update({
            where: { id: req.params.id },
            data: { studentId, bookingId, isLead: !studentId },
        });
        req.app.get('io')?.emit('whatsapp:conversation', { conversationId: conversation.id, action: 'link' });
        res.json({ success: true, conversation });
    } catch (error) {
        if (error?.code === 'P2025') return res.status(404).json({ success: false, error: 'Диалог не найден' });
        console.error('[whatsapp-inbox] link:', error.message);
        res.status(500).json({ success: false, error: 'Не удалось изменить привязку' });
    }
});

router.get('/link-options', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim().slice(0, 100);
        if (search.length < 2) return res.json({ success: true, students: [], bookings: [] });
        const digits = search.replace(/\D/g, '');
        const [students, bookings] = await Promise.all([
            prisma.student.findMany({
                where: { role: 'student', OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    ...(digits ? [{ phoneDigits: { contains: digits } }] : []),
                ] },
                select: { id: true, name: true, lastName: true, phone: true },
                take: 15,
            }),
            prisma.booking.findMany({
                where: { OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    ...(digits ? [{ phoneDigits: { contains: digits } }] : []),
                ] },
                select: { id: true, name: true, lastName: true, phone: true, status: true },
                orderBy: { createdAt: 'desc' },
                take: 15,
            }),
        ]);
        res.json({ success: true, students, bookings });
    } catch (error) {
        console.error('[whatsapp-inbox] link options:', error.message);
        res.status(500).json({ success: false, error: 'Не удалось найти ученика или заявку' });
    }
});

router.post('/conversations/:id/messages', async (req, res) => {
    try {
        const content = normalizeManualMessage(req.body?.content);
        const requestKey = req.headers['x-idempotency-key'];
        const result = await prisma.$transaction(async tx => {
            const conversation = await tx.conversation.findUnique({ where: { id: req.params.id } });
            if (!conversation) return { error: 'not_found' };
            if (!canQueueManualMessage(conversation, req.user.id)) return { error: 'not_taken' };
            const idempotencyKey = buildOutboxIdempotencyKey({ conversationId: conversation.id, userId: req.user.id, requestKey, content });
            const outbox = await tx.whatsappOutbox.upsert({
                where: { idempotencyKey },
                update: {},
                create: {
                    conversationId: conversation.id,
                    idempotencyKey,
                    content,
                    source: 'crm_manual',
                    status: 'approved',
                    requiresApproval: false,
                    approvedById: req.user.id,
                    approvedAt: new Date(),
                },
            });
            return { conversation, outbox };
        });
        if (result.error === 'not_found') return res.status(404).json({ success: false, error: 'Диалог не найден' });
        if (result.error === 'not_taken') return res.status(409).json({ success: false, error: 'Сначала заберите этот диалог вручную' });
        req.app.get('io')?.emit('whatsapp:outbox', { conversationId: result.conversation.id, outboxId: result.outbox.id, status: result.outbox.status });
        res.status(201).json({ success: true, outbox: result.outbox });
    } catch (error) {
        if (/Введите|4000/.test(error.message)) return res.status(400).json({ success: false, error: error.message });
        console.error('[whatsapp-inbox] queue:', error.message);
        res.status(500).json({ success: false, error: 'Не удалось поставить сообщение в очередь' });
    }
});

module.exports = router;
