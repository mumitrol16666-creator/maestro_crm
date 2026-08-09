const crypto = require('crypto');

const OUTBOX_RESULT_STATUSES = new Set(['sent', 'uncertain', 'failed']);

function normalizeManualMessage(value) {
    const content = String(value || '').replace(/\u0000/g, '').trim();
    if (!content) throw new Error('Введите текст сообщения');
    if (content.length > 4000) throw new Error('Сообщение не должно превышать 4000 символов');
    return content;
}

function buildOutboxIdempotencyKey({ conversationId, userId, requestKey, content }) {
    const seed = [conversationId, userId, requestKey || '', content].join('\u001f');
    return crypto.createHash('sha256').update(seed).digest('hex');
}

function validateOutboxResult(value) {
    const status = String(value || '').trim();
    if (!OUTBOX_RESULT_STATUSES.has(status)) {
        throw new Error('Некорректный результат отправки');
    }
    return status;
}

function canQueueManualMessage(conversation, userId) {
    return Boolean(
        conversation
        && conversation.automationStatus === 'paused'
        && conversation.takeoverById === userId
        && conversation.externalChatId
    );
}

module.exports = {
    OUTBOX_RESULT_STATUSES,
    normalizeManualMessage,
    buildOutboxIdempotencyKey,
    validateOutboxResult,
    canQueueManualMessage,
};
