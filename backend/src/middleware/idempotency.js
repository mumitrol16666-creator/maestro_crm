const { prisma } = require('../config/db');
const crypto = require('crypto');

const createIdempotencyMiddleware = (db = prisma) => async (req, res, next) => {
    const rawKey = req.headers['x-idempotency-key'] || req.headers['idempotency-key'];
    if (!rawKey) {
        return next();
    }
    if (String(rawKey).length > 200) {
        return res.status(400).json({ success: false, error: 'Некорректный ключ запроса' });
    }
    const key = crypto.createHash('sha256')
        .update([
            req.method,
            req.originalUrl,
            req.headers.authorization || 'anonymous',
            String(rawKey),
        ].join(':'))
        .digest('hex');

    try {
        // Find existing key
        const existing = await db.idempotencyKey.findUnique({
            where: { key }
        });

        if (existing) {
            // Lazy deletion of expired keys
            if (new Date() > existing.expiresAt) {
                try {
                    await db.idempotencyKey.delete({ where: { key } });
                } catch (e) {
                    // Ignore P2025 record-not-found errors on concurrent deletes
                }
            } else {
                // If it is already finished, return cached response
                if (existing.responseStatus !== null) {
                    res.status(existing.responseStatus);
                    try {
                        const parsed = JSON.parse(existing.responseBody);
                        return res.json(parsed);
                    } catch (e) {
                        return res.send(existing.responseBody);
                    }
                } else {
                    // Request is in progress (409 Conflict)
                    return res.status(409).json({
                        success: false,
                        error: 'Запрос уже обрабатывается. Пожалуйста, подождите.'
                    });
                }
            }
        }

        // Create the record in database representing the key in progress
        await db.idempotencyKey.create({
            data: {
                key,
                expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes TTL
            }
        });

        // Capture response properties
        const originalJson = res.json;
        const originalSend = res.send;
        let finished = false;

        const saveResponse = async (status, body) => {
            try {
                let bodyStr = '';
                if (typeof body === 'string') {
                    bodyStr = body;
                } else if (body !== undefined) {
                    bodyStr = JSON.stringify(body);
                }
                await db.idempotencyKey.update({
                    where: { key },
                    data: {
                        responseStatus: status,
                        responseBody: bodyStr
                    }
                });
            } catch (e) {
                console.error('Failed to save idempotency response to DB:', e);
            }
        };

        res.json = function (data) {
            if (finished) {
                return originalJson.call(this, data);
            }
            finished = true;
            const response = this;
            saveResponse(res.statusCode, data)
                .finally(() => originalJson.call(response, data));
            return response;
        };

        res.send = function (body) {
            if (finished) {
                return originalSend.call(this, body);
            }
            finished = true;
            const response = this;
            saveResponse(res.statusCode, body)
                .finally(() => originalSend.call(response, body));
            return response;
        };

        next();
    } catch (error) {
        console.error('Idempotency middleware error:', error);
        // Handle database constraint exceptions on parallel creations (e.g. error code P2002)
        if (error.code === 'P2002') {
            return res.status(409).json({
                success: false,
                error: 'Запрос уже обрабатывается или был обработан.'
            });
        }
        next();
    }
};

module.exports = createIdempotencyMiddleware();
module.exports.createIdempotencyMiddleware = createIdempotencyMiddleware;
