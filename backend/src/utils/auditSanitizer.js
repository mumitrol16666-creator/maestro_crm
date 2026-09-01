const SENSITIVE_AUDIT_KEYS = new Set([
    'password',
    'currentpassword',
    'newpassword',
    'confirmpassword',
    'generatedpassword',
    'passphrase',
    'token',
    'accesstoken',
    'refreshtoken',
    'ssotoken',
    'authorization',
    'cookie',
    'secret',
    'clientsecret',
    'appsecret',
    'bottoken',
]);

function normalizeAuditKey(key) {
    return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveAuditKey(key) {
    const normalized = normalizeAuditKey(key);
    return SENSITIVE_AUDIT_KEYS.has(normalized)
        || normalized.endsWith('password')
        || normalized.endsWith('token')
        || normalized.endsWith('secret');
}

function sanitizeForAudit(value, seen = new WeakSet()) {
    if (value === null || value === undefined) return value;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(item => sanitizeForAudit(item, seen));
    if (typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';

    seen.add(value);
    const clean = {};
    for (const [key, item] of Object.entries(value)) {
        clean[key] = isSensitiveAuditKey(key) ? '***' : sanitizeForAudit(item, seen);
    }
    seen.delete(value);
    return clean;
}

module.exports = { isSensitiveAuditKey, sanitizeForAudit };
