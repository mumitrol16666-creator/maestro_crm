const SENSITIVE_KEYS = new Set([
    'password',
    'token',
    'authorization',
    'secret',
    'apiKey',
    'geminiApiKey',
]);

const PRIVATE_DATA_KEYS = new Set([
    'phone',
    'phoneDigits',
    'email',
    'avatar',
    'avatarUrl',
    'studentAvatar',
    'recipientPhone',
]);

function redact(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(redact);
    if (value instanceof Date) return value.toISOString();
    if (typeof value !== 'object') return value;

    return Object.entries(value).reduce((acc, [key, item]) => {
        const normalizedKey = key.toLowerCase();
        const isSensitive = SENSITIVE_KEYS.has(key)
            || normalizedKey.includes('password')
            || normalizedKey.includes('token')
            || normalizedKey.includes('secret')
            || normalizedKey.includes('authorization')
            || normalizedKey.includes('apikey')
            || normalizedKey.includes('api_key');
        const isPrivateData = PRIVATE_DATA_KEYS.has(key)
            || normalizedKey.endsWith('phone')
            || normalizedKey.endsWith('email');
        acc[key] = isSensitive || isPrivateData ? '[скрыто]' : redact(item);
        return acc;
    }, {});
}

function safeBody(body) {
    if (body === undefined) return null;
    try {
        return redact(body);
    } catch {
        return { value: '[не удалось сохранить тело]' };
    }
}

function inboundResponseForAudit(req, body) {
    if (String(req.method || '').toUpperCase() === 'GET' && body?.success !== false) {
        return {
            success: Boolean(body?.success),
            data: '[ответ GET не сохраняется]',
        };
    }
    return body;
}

function isRetryableStatus(status) {
    if (!status) return true;
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

module.exports = {
    inboundResponseForAudit,
    isRetryableStatus,
    redact,
    safeBody,
};
