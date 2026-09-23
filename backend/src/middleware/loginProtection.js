const { rateLimit } = require('express-rate-limit');
const { createHash } = require('node:crypto');
const { normalizePhoneDigits } = require('../utils/phone');

function validateLoginCredentials(req, res, next) {
    const { phone, password } = req.body || {};
    if (typeof phone !== 'string' || !phone.trim() || phone.length > 128
        || typeof password !== 'string' || !password.length || password.length > 1024) {
        return res.status(400).json({ success: false, error: 'Укажите телефон и пароль строками' });
    }
    next();
}

function createLoginProtection({ windowMs = 15 * 60 * 1000, ipLimit = 60, phoneLimit = 10 } = {}) {
    const options = {
        windowMs,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        skipSuccessfulRequests: true,
        message: { success: false, error: 'Слишком много попыток входа. Повторите позже.' },
    };
    return [
        rateLimit({ ...options, limit: ipLimit }),
        validateLoginCredentials,
        rateLimit({ ...options, limit: phoneLimit, keyGenerator: req => {
            // Phone formatting must not create a fresh brute-force allowance.
            const key = normalizePhoneDigits(req.body.phone) || req.body.phone.trim().toLowerCase();
            return createHash('sha256').update(key).digest('hex');
        } }),
    ];
}

module.exports = { createLoginProtection, validateLoginCredentials };
