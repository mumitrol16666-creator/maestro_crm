const crypto = require('crypto');
const { prisma } = require('../config/db');
const { normalizePhoneDigits } = require('../utils/phone');

const ALLOWED_MESSAGE_TYPES = new Set([
    'text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'unknown'
]);
// @lid deliberately is not accepted yet: it is an internal WhatsApp identifier,
// not a phone number, and must not be linked to a CRM student by digits.
const PERSONAL_CHAT_SUFFIXES = ['@c.us', '@s.whatsapp.net'];

function normalizeExternalChatId(value) {
    return String(value || '').trim().slice(0, 180);
}

function isPersonalChatId(chatId) {
    const normalized = normalizeExternalChatId(chatId).toLowerCase();
    if (!normalized) return false;
    if (normalized.includes('@g.us') || normalized.includes('status@broadcast')) return false;
    return PERSONAL_CHAT_SUFFIXES.some(suffix => normalized.endsWith(suffix)) || /^\+?\d{7,15}$/.test(normalized);
}

function normalizeMessageText(value) {
    return String(value || '').replace(/\u0000/g, '').trim().slice(0, 20000);
}

function parseTimestamp(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) throw new Error('Некорректное время сообщения');
    return date;
}

function buildMessageFingerprint(message) {
    const stableParts = [
        message.accountKey,
        message.externalChatId,
        message.externalMessageId || '',
        message.timestamp.toISOString(),
        message.messageType,
        message.content,
    ];
    return crypto.createHash('sha256').update(stableParts.join('\u001f')).digest('hex');
}

function prepareInboundMessage(rawMessage, accountKey) {
    if (!rawMessage || typeof rawMessage !== 'object' || Array.isArray(rawMessage)) {
        throw new Error('Сообщение должно быть объектом');
    }

    const externalChatId = normalizeExternalChatId(rawMessage.externalChatId);
    if (!isPersonalChatId(externalChatId)) {
        throw new Error('Поддерживаются только личные WhatsApp-диалоги');
    }

    const phoneNumber = normalizePhoneDigits(rawMessage.phoneNumber || externalChatId);
    if (phoneNumber.length < 7 || phoneNumber.length > 15) {
        throw new Error('Не удалось определить номер телефона');
    }

    const content = normalizeMessageText(rawMessage.content);
    const messageType = ALLOWED_MESSAGE_TYPES.has(rawMessage.messageType)
        ? rawMessage.messageType
        : 'unknown';
    if (!content && messageType === 'text') throw new Error('Пустое текстовое сообщение');

    const message = {
        accountKey: String(accountKey || '').trim(),
        externalChatId,
        externalMessageId: String(rawMessage.externalMessageId || '').trim().slice(0, 250) || null,
        phoneNumber,
        displayName: normalizeMessageText(rawMessage.displayName).slice(0, 200) || null,
        content: content || `[${messageType}]`,
        messageType,
        timestamp: parseTimestamp(rawMessage.timestamp),
        rawPayload: rawMessage.rawPayload && typeof rawMessage.rawPayload === 'object'
            ? rawMessage.rawPayload
            : null,
    };
    message.fingerprint = buildMessageFingerprint(message);
    return message;
}

function prepareInboundBatch(rawMessages, accountKey) {
    const messages = Array.isArray(rawMessages) ? rawMessages : [];
    if (!accountKey || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,79}$/.test(accountKey)) {
        throw new Error('Некорректный accountKey');
    }
    if (messages.length === 0 || messages.length > 100) {
        throw new Error('Пакет должен содержать от 1 до 100 сообщений');
    }

    const unique = new Map();
    for (const rawMessage of messages) {
        const prepared = prepareInboundMessage(rawMessage, accountKey);
        const key = prepared.externalMessageId || prepared.fingerprint;
        if (!unique.has(key)) unique.set(key, prepared);
    }
    return [...unique.values()];
}

async function findLinkedEntities(tx, phoneNumber) {
    const suffix = phoneNumber.slice(-10);
    const [student, booking] = await Promise.all([
        tx.student.findFirst({
            where: {
                role: 'student',
                OR: [
                    { phoneDigits: phoneNumber },
                    { phoneDigits: { endsWith: suffix } },
                    { additionalPhones: { some: { phoneDigits: phoneNumber } } },
                    { additionalPhones: { some: { phoneDigits: { endsWith: suffix } } } },
                ],
            },
            select: { id: true },
        }),
        tx.booking.findFirst({
            where: {
                OR: [
                    { phoneDigits: phoneNumber },
                    { phoneDigits: { endsWith: suffix } },
                ],
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
        }),
    ]);
    return { student, booking };
}

async function importOneMessage(db, message) {
    try {
        return await db.$transaction(async tx => {
            let conversation = await tx.conversation.findFirst({
                where: {
                    OR: [
                        { externalChatId: message.externalChatId },
                        { phoneNumber: message.phoneNumber },
                    ],
                },
            });

            if (conversation) {
                const duplicate = message.externalMessageId
                    ? await tx.conversationMessage.findUnique({ where: { externalMessageId: message.externalMessageId } })
                    : await tx.conversationMessage.findUnique({
                        where: {
                            conversationId_fingerprint: {
                                conversationId: conversation.id,
                                fingerprint: message.fingerprint,
                            },
                        },
                    });
                if (duplicate) return { conversationId: conversation.id, skipped: true };
            }

            const linked = await findLinkedEntities(tx, message.phoneNumber);
            if (!conversation) {
                conversation = await tx.conversation.create({
                    data: {
                        phoneNumber: message.phoneNumber,
                        externalChatId: message.externalChatId,
                        realPhone: message.phoneNumber,
                        name: message.displayName,
                        isLead: !linked.student,
                        status: 'active',
                        automationStatus: 'observer',
                        browserAccountKey: message.accountKey,
                        bookingId: linked.booking?.id || null,
                        studentId: linked.student?.id || null,
                        lastMessageAt: message.timestamp,
                        lastInboundAt: message.timestamp,
                        firstMessageAt: message.timestamp,
                        messageCount: 0,
                        followUpStatus: 'none',
                        source: 'whatsapp_browser',
                        context: { browserAccountKey: message.accountKey },
                    },
                });
            }

            await tx.conversationMessage.create({
                data: {
                    conversationId: conversation.id,
                    externalMessageId: message.externalMessageId,
                    fingerprint: message.fingerprint,
                    role: 'user',
                    direction: 'incoming',
                    messageType: message.messageType,
                    content: message.content,
                    rawPayload: message.rawPayload || undefined,
                    timestamp: message.timestamp,
                },
            });

            await tx.conversation.update({
                where: { id: conversation.id },
                data: {
                    externalChatId: conversation.externalChatId || message.externalChatId,
                    browserAccountKey: message.accountKey,
                    realPhone: message.phoneNumber,
                    name: message.displayName || undefined,
                    studentId: conversation.studentId || linked.student?.id || null,
                    bookingId: conversation.bookingId || linked.booking?.id || null,
                    isLead: !(conversation.studentId || linked.student),
                    lastMessageAt: message.timestamp,
                    lastInboundAt: message.timestamp,
                    messageCount: { increment: 1 },
                    source: 'whatsapp_browser',
                },
            });

            return { conversationId: conversation.id, skipped: false };
        });
    } catch (error) {
        if (error?.code === 'P2002') return { conversationId: null, skipped: true };
        throw error;
    }
}

async function importInboundBatch({ accountKey, rawMessages, db = prisma }) {
    const messages = prepareInboundBatch(rawMessages, accountKey);
    const results = [];
    for (const message of messages) results.push(await importOneMessage(db, message));

    const imported = results.filter(result => !result.skipped).length;
    if (imported > 0) {
        await db.whatsappBrowserSession.updateMany({
            where: { accountKey },
            data: { lastIncomingAt: new Date() },
        });
    }
    return { received: rawMessages.length, accepted: messages.length, imported, skipped: results.length - imported, results };
}

module.exports = {
    normalizeExternalChatId,
    isPersonalChatId,
    normalizeMessageText,
    buildMessageFingerprint,
    prepareInboundMessage,
    prepareInboundBatch,
    importInboundBatch,
};
