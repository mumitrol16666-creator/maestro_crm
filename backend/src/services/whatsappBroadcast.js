// Рассылка из «Напоминаний». CRM хранит очередь и сама держит паузу между
// сообщениями: воркер получает следующее сообщение, только когда с прошлой
// отправки прошло intervalSec, поэтому даже два воркера не отправят чаще.
// Одна карточка уходит не больше одного раза: перед выдачей CRM ещё раз
// проверяет ручную отметку «Отправлено» и другие рассылки этой карточки.

const BROADCAST_KINDS = {
    today: 'Сегодня урок',
    tomorrow: 'Завтра урок',
    homework: 'После урока',
    oneLesson: 'Низкий баланс',
    tasks: 'Запланированные контакты',
    exam: 'Экзамены',
};
// Те же подписи, что пишет ручная галочка «Отправлено» (routes/admin.js): одна лента «Активности».
const REMINDER_LOG_LABELS = {
    today: 'Сегодня урок',
    tomorrow: 'Завтра урок',
    homework: 'Домашнее задание',
    oneLesson: 'Оплата',
    tasks: 'Запланированный контакт',
    exam: 'Экзамен сектора',
};
const RESULT_STATUSES = new Set(['sent', 'invalid', 'failed', 'uncertain']);
// Карточка с таким элементом в другую рассылку не попадает: она в очереди или, возможно, уже ушла.
const LOCKING_STATUSES = ['pending', 'claimed', 'duplicate', 'sent', 'uncertain'];
const DEFAULT_INTERVAL_SEC = 180;
const MAX_ITEMS = 300;
const MAX_CONTENT = 4000;
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_TTL_MS = 48 * 60 * 60 * 1000;
// Сообщение, которое воркер взял и не отчитался, второй раз не отправляем:
// оно могло уйти. Через это время оно становится «uncertain».
const STALE_CLAIM_MS = 10 * 60 * 1000;
const ONLINE_HEARTBEAT_MS = 45_000;
const LOCK_KEY = 'whatsapp-broadcast-claim';

class BroadcastError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

function normalizeBroadcastPhone(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
    if (digits.length === 10) digits = `7${digits}`;
    return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

// Платёжные шаблоны содержат «Сумма: ___ ₸»: с пропуском такое сообщение отправлять нельзя.
function hasUnfilledPlaceholder(content) {
    return /_{3,}/.test(content);
}

function lock(tx) {
    return tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0)) IS NULL AS locked`;
}

function expiryFor(raw, now) {
    const requested = raw ? new Date(raw) : null;
    if (requested && Number.isNaN(requested.getTime())) return new Date(now.getTime() + DEFAULT_TTL_MS);
    const value = requested || new Date(now.getTime() + DEFAULT_TTL_MS);
    return new Date(Math.min(value.getTime(), now.getTime() + MAX_TTL_MS));
}

async function lockedReminderIds(tx, reminderIds) {
    if (!reminderIds.length) return { sent: new Set(), busy: new Set() };
    const [logged, items] = await Promise.all([
        tx.activityLog.findMany({
            where: { entityType: 'WhatsAppReminder', action: 'sent', entityId: { in: reminderIds } },
            select: { entityId: true },
        }),
        tx.whatsappBroadcastItem.findMany({
            where: { reminderId: { in: reminderIds }, status: { in: LOCKING_STATUSES } },
            select: { reminderId: true },
        }),
    ]);
    return {
        sent: new Set(logged.map(row => row.entityId)),
        busy: new Set(items.map(row => row.reminderId)),
    };
}

async function createBroadcast(db, { kind, items, userId, intervalSec = DEFAULT_INTERVAL_SEC, now = new Date() }) {
    if (!BROADCAST_KINDS[kind]) throw new BroadcastError('Некорректная очередь напоминаний');
    if (!Array.isArray(items) || !items.length) throw new BroadcastError('В рассылке нет сообщений');
    if (items.length > MAX_ITEMS) throw new BroadcastError(`В одной рассылке не больше ${MAX_ITEMS} сообщений`);
    const interval = Math.round(Number(intervalSec));
    if (!Number.isFinite(interval) || interval < 60 || interval > 3600) {
        throw new BroadcastError('Пауза между сообщениями должна быть от 1 до 60 минут');
    }

    const skipped = [];
    const accepted = [];
    const seenReminders = new Set();
    for (const raw of items) {
        const reminderId = String(raw?.reminderId || '').trim().slice(0, 200);
        const content = String(raw?.content || '').trim();
        const phone = normalizeBroadcastPhone(raw?.phone);
        const recipientName = String(raw?.recipientName || '').trim().slice(0, 200) || null;
        const expiresAt = expiryFor(raw?.expiresAt, now);
        const skip = reason => skipped.push({ reminderId, recipientName, reason });
        if (!reminderId || seenReminders.has(reminderId)) continue;
        seenReminders.add(reminderId);
        if (!phone) { skip('нет телефона'); continue; }
        if (!content) { skip('пустой текст'); continue; }
        if (content.length > MAX_CONTENT) { skip('слишком длинный текст'); continue; }
        if (hasUnfilledPlaceholder(content)) { skip('в тексте пропуск «___», например не указана сумма'); continue; }
        if (expiresAt <= now) { skip('урок уже начался'); continue; }
        accepted.push({ reminderId, studentId: String(raw?.studentId || '').trim() || null, recipientName, phone, content, expiresAt });
    }

    return db.$transaction(async tx => {
        await lock(tx);
        const running = await tx.whatsappBroadcast.findFirst({ where: { status: 'running' }, select: { label: true } });
        if (running) {
            throw new BroadcastError(`Уже идёт рассылка «${running.label}». Новую можно запустить после неё`, 409);
        }

        const { sent, busy } = await lockedReminderIds(tx, accepted.map(item => item.reminderId));
        const queue = [];
        const firstByMessage = new Map();
        for (const item of accepted) {
            if (sent.has(item.reminderId)) { skipped.push({ reminderId: item.reminderId, recipientName: item.recipientName, reason: 'уже отправлено' }); continue; }
            if (busy.has(item.reminderId)) { skipped.push({ reminderId: item.reminderId, recipientName: item.recipientName, reason: 'уже в рассылке или, возможно, ушло рассылкой' }); continue; }
            // Тот же текст на тот же номер (общий телефон родителя): уходит один раз,
            // отметку «Отправлено» получают обе карточки.
            const messageKey = `${item.phone}\n${item.content}`;
            const duplicate = firstByMessage.has(messageKey);
            if (!duplicate) firstByMessage.set(messageKey, item);
            queue.push({ ...item, status: duplicate ? 'duplicate' : 'pending' });
        }
        if (!queue.some(item => item.status === 'pending')) {
            throw new BroadcastError('Отправлять некому: у всех нет телефона, текст не готов или сообщение уже ушло', 409);
        }

        const broadcast = await tx.whatsappBroadcast.create({
            data: {
                kind,
                label: BROADCAST_KINDS[kind],
                intervalSec: interval,
                createdById: userId || null,
                items: { create: queue.map((item, position) => ({ ...item, position })) },
            },
            include: { items: { orderBy: { position: 'asc' } } },
        });
        return { broadcast, skipped };
    });
}

async function finishIfEmpty(tx, broadcastId) {
    const left = await tx.whatsappBroadcastItem.count({
        where: { broadcastId, status: { in: ['pending', 'claimed'] } },
    });
    if (left === 0) {
        await tx.whatsappBroadcastItem.updateMany({
            where: { broadcastId, status: 'duplicate' },
            data: { status: 'cancelled', lastError: 'Основное сообщение на этот номер не отправлялось' },
        });
        await tx.whatsappBroadcast.updateMany({
            where: { id: broadcastId, status: 'running' },
            data: { status: 'done', finishedAt: new Date() },
        });
    }
}

async function claimNextBroadcastItem(db, { workerId, now = new Date() }) {
    return db.$transaction(async tx => {
        await lock(tx);
        const touched = new Set();

        const stale = await tx.whatsappBroadcastItem.findMany({
            where: { status: 'claimed', claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
            select: { id: true, broadcastId: true, phone: true, content: true },
        });
        for (const row of stale) {
            const lastError = 'Воркер не сообщил результат за 10 минут';
            await tx.whatsappBroadcastItem.updateMany({ where: { id: row.id, status: 'claimed' }, data: { status: 'uncertain', lastError } });
            await tx.whatsappBroadcastItem.updateMany({
                where: { broadcastId: row.broadcastId, status: 'duplicate', phone: row.phone, content: row.content },
                data: { status: 'uncertain', lastError },
            });
            touched.add(row.broadcastId);
        }

        let result = null;
        if (await tx.whatsappBroadcastItem.count({ where: { status: 'claimed' } })) {
            result = { item: null, waitSeconds: 5 };
        }

        while (!result) {
            const candidate = await tx.whatsappBroadcastItem.findFirst({
                where: { status: 'pending', broadcast: { status: 'running' } },
                orderBy: [{ broadcast: { createdAt: 'asc' } }, { position: 'asc' }],
                include: { broadcast: { select: { intervalSec: true } } },
            });
            if (!candidate) { result = { item: null, waitSeconds: null }; break; }

            if (candidate.expiresAt && candidate.expiresAt <= now) {
                await tx.whatsappBroadcastItem.updateMany({
                    where: { id: candidate.id, status: 'pending' },
                    data: { status: 'expired', lastError: 'Время для этого напоминания прошло' },
                });
                touched.add(candidate.broadcastId);
                continue;
            }
            // Пока ждали очереди, карточку могли отправить вручную или другой рассылкой.
            const [logged, other] = await Promise.all([
                tx.activityLog.findFirst({
                    where: { entityType: 'WhatsAppReminder', action: 'sent', entityId: candidate.reminderId },
                    select: { id: true },
                }),
                tx.whatsappBroadcastItem.findFirst({
                    where: { reminderId: candidate.reminderId, id: { not: candidate.id }, status: { in: ['claimed', 'sent', 'uncertain'] } },
                    select: { id: true },
                }),
            ]);
            if (logged || other) {
                await tx.whatsappBroadcastItem.updateMany({
                    where: { id: candidate.id, status: 'pending' },
                    data: { status: 'cancelled', lastError: 'Уже отправлено' },
                });
                touched.add(candidate.broadcastId);
                continue;
            }

            const last = await tx.whatsappBroadcastItem.findFirst({
                where: { claimedAt: { not: null } },
                orderBy: { claimedAt: 'desc' },
                select: { claimedAt: true },
            });
            const waitMs = last ? last.claimedAt.getTime() + candidate.broadcast.intervalSec * 1000 - now.getTime() : 0;
            if (waitMs > 0) { result = { item: null, waitSeconds: Math.ceil(waitMs / 1000) }; break; }

            const claimed = await tx.whatsappBroadcastItem.updateMany({
                where: { id: candidate.id, status: 'pending' },
                data: { status: 'claimed', claimedBy: workerId, claimedAt: now },
            });
            if (claimed.count === 1) {
                result = { item: { id: candidate.id, phoneNumber: candidate.phone, content: candidate.content }, waitSeconds: null };
            }
        }

        for (const broadcastId of touched) await finishIfEmpty(tx, broadcastId);
        return result;
    });
}

async function markReminderSent(tx, item, broadcast) {
    if (!broadcast.createdById) return;
    const existing = await tx.activityLog.findFirst({
        where: { entityType: 'WhatsAppReminder', action: 'sent', entityId: item.reminderId },
        select: { id: true },
    });
    if (existing) return;
    const reminderLabel = REMINDER_LOG_LABELS[broadcast.kind];
    await tx.activityLog.create({
        data: {
            userId: broadcast.createdById,
            action: 'sent',
            entityType: 'WhatsAppReminder',
            entityId: item.reminderId,
            details: `${item.recipientName || 'Ученик'} — Рассылка — ${reminderLabel}`,
            metadata: {
                kind: broadcast.kind,
                studentId: item.studentId,
                studentName: item.recipientName,
                reminderLabel,
                broadcastId: broadcast.id,
                automatic: true,
            },
        },
    });
}

async function reportBroadcastItemResult(db, { itemId, workerId, status, error, externalMessageId }) {
    if (!RESULT_STATUSES.has(status)) throw new BroadcastError('Некорректный результат отправки');
    return db.$transaction(async tx => {
        const item = await tx.whatsappBroadcastItem.findUnique({
            where: { id: itemId },
            include: { broadcast: { select: { id: true, kind: true, createdById: true } } },
        });
        if (!item || item.status !== 'claimed' || item.claimedBy !== workerId) {
            throw new BroadcastError('Сообщение не закреплено за этим воркером', 409);
        }
        const sentAt = status === 'sent' ? new Date() : null;
        const lastError = String(error || '').trim().slice(0, 1000) || null;
        await tx.whatsappBroadcastItem.update({
            where: { id: item.id },
            data: { status, sentAt, lastError, externalMessageId: String(externalMessageId || '').trim().slice(0, 250) || null },
        });
        // Карточки с тем же текстом на тот же номер разделяют судьбу основного сообщения.
        const duplicates = await tx.whatsappBroadcastItem.findMany({
            where: { broadcastId: item.broadcastId, status: 'duplicate', phone: item.phone, content: item.content },
        });
        if (duplicates.length) {
            await tx.whatsappBroadcastItem.updateMany({
                where: { id: { in: duplicates.map(row => row.id) } },
                data: { status, sentAt, lastError },
            });
        }
        // Та же отметка «Отправлено», что ставит администратор галочкой: карточка уходит из очереди.
        if (status === 'sent') {
            for (const row of [item, ...duplicates]) await markReminderSent(tx, row, item.broadcast);
        }
        await finishIfEmpty(tx, item.broadcastId);
        return { id: item.id, status };
    });
}

async function cancelBroadcast(db, broadcastId) {
    return db.$transaction(async tx => {
        await lock(tx);
        const broadcast = await tx.whatsappBroadcast.findUnique({ where: { id: broadcastId } });
        if (!broadcast) throw new BroadcastError('Рассылка не найдена', 404);
        if (broadcast.status !== 'running') return broadcast;
        await tx.whatsappBroadcastItem.updateMany({
            where: { broadcastId, status: { in: ['pending', 'duplicate'] } },
            data: { status: 'cancelled' },
        });
        return tx.whatsappBroadcast.update({
            where: { id: broadcastId },
            data: { status: 'cancelled', finishedAt: new Date() },
        });
    });
}

function summarizeItems(items) {
    const counts = { pending: 0, claimed: 0, sent: 0, invalid: 0, failed: 0, uncertain: 0, cancelled: 0, expired: 0, duplicate: 0 };
    for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
}

async function broadcastOverview(db, { now = new Date() } = {}) {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [broadcasts, session, last, claimedNow, locked] = await Promise.all([
        db.whatsappBroadcast.findMany({
            where: { OR: [{ status: 'running' }, { finishedAt: { gte: since } }] },
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: { items: { orderBy: { position: 'asc' } } },
        }),
        db.whatsappBrowserSession.findFirst({ orderBy: { lastHeartbeatAt: 'desc' } }),
        db.whatsappBroadcastItem.findFirst({
            where: { claimedAt: { not: null } },
            orderBy: { claimedAt: 'desc' },
            select: { claimedAt: true },
        }),
        db.whatsappBroadcastItem.findFirst({
            where: { status: 'claimed', claimedAt: { gte: new Date(now.getTime() - 3 * 60 * 1000) } },
            select: { id: true },
        }),
        db.whatsappBroadcastItem.findMany({
            where: { status: { in: LOCKING_STATUSES }, createdAt: { gte: new Date(now.getTime() - MAX_TTL_MS) } },
            orderBy: { createdAt: 'asc' },
            select: { reminderId: true, status: true, sentAt: true, claimedAt: true, createdAt: true },
        }),
    ]);
    const fresh = Boolean(session?.lastHeartbeatAt && now.getTime() - session.lastHeartbeatAt.getTime() < ONLINE_HEARTBEAT_MS);
    // Пока воркер отправляет сообщение, он не отвечает на heartbeat: это не «пропал».
    const online = Boolean(claimedNow) || (fresh && ['connected', 'starting'].includes(session?.status));
    const running = broadcasts.find(row => row.status === 'running');
    const nextSendAt = running && last
        ? new Date(Math.max(now.getTime(), last.claimedAt.getTime() + running.intervalSec * 1000))
        : null;
    const reminderStates = {};
    for (const row of locked) {
        reminderStates[row.reminderId] = { status: row.status, at: row.sentAt || row.claimedAt || row.createdAt };
    }
    return {
        worker: {
            online,
            status: session?.status || 'stopped',
            broadcastEnabled: session?.metadata?.broadcast === true,
            lastHeartbeatAt: session?.lastHeartbeatAt || null,
        },
        nextSendAt,
        reminderStates,
        broadcasts: broadcasts.map(row => ({
            id: row.id,
            kind: row.kind,
            label: row.label,
            status: row.status,
            intervalSec: row.intervalSec,
            createdAt: row.createdAt,
            finishedAt: row.finishedAt,
            counts: summarizeItems(row.items),
            items: row.items.map(item => ({
                id: item.id,
                reminderId: item.reminderId,
                recipientName: item.recipientName,
                phone: item.phone,
                status: item.status,
                sentAt: item.sentAt,
                lastError: item.lastError,
            })),
        })),
    };
}

module.exports = {
    BROADCAST_KINDS,
    BroadcastError,
    DEFAULT_INTERVAL_SEC,
    STALE_CLAIM_MS,
    normalizeBroadcastPhone,
    hasUnfilledPlaceholder,
    createBroadcast,
    claimNextBroadcastItem,
    reportBroadcastItemResult,
    cancelBroadcast,
    broadcastOverview,
};
