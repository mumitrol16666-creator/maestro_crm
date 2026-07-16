const crypto = require('crypto');
const axios = require('axios');
const { prisma } = require('../config/db');
const { normalizePhoneDigits } = require('../utils/phone');

function getGraphApiVersion() {
    return process.env.WHATSAPP_META_GRAPH_VERSION || 'v23.0';
}

function verifyMetaSignature(req) {
    const appSecret = process.env.WHATSAPP_META_APP_SECRET;
    if (!appSecret) return true;

    const signature = req.get('x-hub-signature-256') || '';
    const rawBody = req.rawBody;
    if (!signature || !rawBody || !signature.startsWith('sha256=')) return false;

    const expected = `sha256=${crypto
        .createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex')}`;

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function extractMessageText(message) {
    if (!message) return '';
    if (message.type === 'text') return message.text?.body || '';
    if (message.type === 'button') return message.button?.text || message.button?.payload || '';
    if (message.type === 'interactive') {
        return message.interactive?.button_reply?.title
            || message.interactive?.list_reply?.title
            || JSON.stringify(message.interactive);
    }
    if (message.type === 'image') return message.image?.caption || '[image]';
    if (message.type === 'audio') return '[audio]';
    if (message.type === 'video') return message.video?.caption || '[video]';
    if (message.type === 'document') return message.document?.filename || '[document]';
    if (message.type === 'sticker') return '[sticker]';
    if (message.type === 'location') return '[location]';
    if (message.type === 'contacts') return '[contacts]';
    return `[${message.type || 'message'}]`;
}

function getMessageTimestamp(message) {
    const seconds = Number(message?.timestamp);
    if (!Number.isFinite(seconds) || seconds <= 0) return new Date();
    return new Date(seconds * 1000);
}

async function findLinkedStudent(phoneDigits) {
    if (!phoneDigits) return null;
    return prisma.student.findFirst({
        where: {
            role: 'student',
            OR: [
                { phoneDigits },
                { phoneDigits: { endsWith: phoneDigits.slice(-10) } },
                { additionalPhones: { some: { phoneDigits } } },
                { additionalPhones: { some: { phoneDigits: { endsWith: phoneDigits.slice(-10) } } } }
            ]
        },
        select: { id: true, name: true, lastName: true, middleName: true }
    });
}

async function findLinkedBooking(phoneDigits) {
    if (!phoneDigits) return null;
    return prisma.booking.findFirst({
        where: {
            OR: [
                { phoneDigits },
                { phoneDigits: { endsWith: phoneDigits.slice(-10) } }
            ]
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true }
    });
}

function appendMetaMessageId(context, messageId) {
    const current = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const ids = Array.isArray(current.metaMessageIds) ? current.metaMessageIds : [];
    if (messageId && ids.includes(messageId)) {
        return { context: current, isDuplicate: true };
    }
    const nextIds = messageId ? [...ids.slice(-49), messageId] : ids.slice(-50);
    return {
        context: {
            ...current,
            metaMessageIds: nextIds,
            lastMetaMessageId: messageId || current.lastMetaMessageId || null
        },
        isDuplicate: false
    };
}

async function saveInboundMessage({ message, contact, metadata }) {
    const phoneDigits = normalizePhoneDigits(message.from || contact?.wa_id || '');
    const displayName = contact?.profile?.name || null;
    const content = extractMessageText(message);
    const timestamp = getMessageTimestamp(message);
    const linkedStudent = await findLinkedStudent(phoneDigits);
    const linkedBooking = await findLinkedBooking(phoneDigits);

    const existing = await prisma.conversation.findUnique({
        where: { phoneNumber: phoneDigits },
        select: { id: true, context: true, messageCount: true, studentId: true, bookingId: true }
    });

    if (existing) {
        const { context, isDuplicate } = appendMetaMessageId(existing.context, message.id);
        if (isDuplicate) return { conversationId: existing.id, skipped: true };

        const conversation = await prisma.conversation.update({
            where: { id: existing.id },
            data: {
                realPhone: phoneDigits,
                name: displayName || undefined,
                isLead: !linkedStudent,
                studentId: existing.studentId || linkedStudent?.id || null,
                bookingId: existing.bookingId || linkedBooking?.id || null,
                lastMessageAt: timestamp,
                messageCount: { increment: 1 },
                source: 'whatsapp_meta',
                context: {
                    ...context,
                    displayPhoneNumber: metadata?.display_phone_number || null,
                    phoneNumberId: metadata?.phone_number_id || null,
                    lastInboundType: message.type || null
                }
            }
        });

        await prisma.conversationMessage.create({
            data: {
                conversationId: conversation.id,
                role: 'user',
                content,
                timestamp
            }
        });

        return { conversationId: conversation.id, skipped: false };
    }

    const { context } = appendMetaMessageId({
        displayPhoneNumber: metadata?.display_phone_number || null,
        phoneNumberId: metadata?.phone_number_id || null,
        firstInboundType: message.type || null,
        lastInboundType: message.type || null
    }, message.id);

    const conversation = await prisma.conversation.create({
        data: {
            phoneNumber: phoneDigits,
            realPhone: phoneDigits,
            name: displayName,
            isLead: !linkedStudent,
            status: 'active',
            bookingId: linkedBooking?.id || null,
            studentId: linkedStudent?.id || null,
            lastMessageAt: timestamp,
            firstMessageAt: timestamp,
            messageCount: 1,
            followUpStatus: 'none',
            source: 'whatsapp_meta',
            context,
            messages: {
                create: {
                    role: 'user',
                    content,
                    timestamp
                }
            }
        }
    });

    return { conversationId: conversation.id, skipped: false };
}

async function processWebhookPayload(payload) {
    const results = [];
    for (const entry of payload?.entry || []) {
        for (const change of entry?.changes || []) {
            if (change.field !== 'messages') continue;
            const value = change.value || {};
            const contactsByWaId = new Map((value.contacts || []).map(contact => [contact.wa_id, contact]));

            for (const message of value.messages || []) {
                const contact = contactsByWaId.get(message.from) || null;
                results.push(await saveInboundMessage({
                    message,
                    contact,
                    metadata: value.metadata || {}
                }));
            }
        }
    }
    return results;
}

async function sendWhatsappTextMessage(to, body) {
    const accessToken = process.env.WHATSAPP_META_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_META_PHONE_NUMBER_ID;
    if (!accessToken || !phoneNumberId) {
        throw new Error('WhatsApp Meta API is not configured');
    }

    const response = await axios.post(
        `https://graph.facebook.com/${getGraphApiVersion()}/${phoneNumberId}/messages`,
        {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: normalizePhoneDigits(to),
            type: 'text',
            text: { body }
        },
        {
            timeout: 15000,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        }
    );

    return response.data;
}

module.exports = {
    verifyMetaSignature,
    processWebhookPayload,
    sendWhatsappTextMessage
};
