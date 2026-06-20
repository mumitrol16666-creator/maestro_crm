const { prisma } = require('../config/db');

const idempotency = async (req, res, next) => {
    const key = req.headers['x-idempotency-key'] || req.headers['idempotency-key'];
    if (!key) {
        return next();
    }

    try {
        // Find existing key
        const existing = await prisma.idempotencyKey.findUnique({
            where: { key }
        });

        if (existing) {
            // Lazy deletion of expired keys
            if (new Date() > existing.expiresAt) {
                try {
                    await prisma.idempotencyKey.delete({ where: { key } });
                } catch (e) {
                    // Ignore P2025 record-not-found errors on concurrent deletes
                }
            } else {
                // If it is already finished, return cached response
                if (existing.responseStatus !== null) {
                    try {
                        await prisma.activityLog.create({
                            data: {
                                userId: req.user?.id || 'system',
                                action: 'idempotency_cache_hit',
                                entityType: 'System',
                                details: `Повторный запрос обслужен из кэша идемпотентности. Ключ: ${key}`,
                                metadata: { key, path: req.originalUrl }
                            }
                        });
                    } catch (e) {
                        console.error('Failed to log idempotency cache hit:', e);
                    }

                    res.status(existing.responseStatus);
                    try {
                        const parsed = JSON.parse(existing.responseBody);
                        return res.json(parsed);
                    } catch (e) {
                        return res.send(existing.responseBody);
                    }
                } else {
                    // Request is in progress (409 Conflict)
                    try {
                        await prisma.activityLog.create({
                            data: {
                                userId: req.user?.id || 'system',
                                action: 'idempotency_conflict_in_progress',
                                entityType: 'System',
                                details: `Запрос заблокирован (в процессе выполнения). Ключ: ${key}`,
                                metadata: { key, path: req.originalUrl }
                            }
                        });
                    } catch (e) {
                        console.error('Failed to log idempotency conflict:', e);
                    }

                    return res.status(409).json({
                        success: false,
                        error: 'Запрос уже обрабатывается. Пожалуйста, подождите.'
                    });
                }
            }
        }

        // Create the record in database representing the key in progress
        await prisma.idempotencyKey.create({
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
            if (finished) return;
            finished = true;
            try {
                let bodyStr = '';
                if (typeof body === 'string') {
                    bodyStr = body;
                } else if (body !== undefined) {
                    bodyStr = JSON.stringify(body);
                }
                await prisma.idempotencyKey.update({
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
            saveResponse(res.statusCode, data);
            return originalJson.call(this, data);
        };

        res.send = function (body) {
            saveResponse(res.statusCode, body);
            return originalSend.call(this, body);
        };

        next();
    } catch (error) {
        console.error('Idempotency middleware error:', error);
        // Handle database constraint exceptions on parallel creations (e.g. error code P2002)
        if (error.code === 'P2002') {
            try {
                await prisma.activityLog.create({
                    data: {
                        userId: req.user?.id || 'system',
                        action: 'idempotency_conflict_parallel',
                        entityType: 'System',
                        details: `Параллельный запрос заблокирован из-за конфликта (P2002). Ключ: ${key}`,
                        metadata: { key, path: req.originalUrl }
                    }
                });
            } catch (e) {
                console.error('Failed to log idempotency conflict parallel:', e);
            }
            return res.status(409).json({
                success: false,
                error: 'Запрос уже обрабатывается или был обработан.'
            });
        }
        next();
    }
};

module.exports = idempotency;
