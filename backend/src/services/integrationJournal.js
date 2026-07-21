const axios = require('axios');
const { prisma } = require('../config/db');

const SENSITIVE_KEYS = new Set([
    'password',
    'token',
    'authorization',
    'secret',
    'apiKey',
    'geminiApiKey',
]);

function redact(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(redact);
    if (value instanceof Date) return value.toISOString();
    if (typeof value !== 'object') return value;

    return Object.entries(value).reduce((acc, [key, item]) => {
        acc[key] = SENSITIVE_KEYS.has(key) ? '[скрыто]' : redact(item);
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

function normalizeError(error) {
    return error.response?.data?.error?.message
        || error.response?.data?.error
        || error.response?.data?.message
        || error.message
        || 'Integration operation failed';
}

function isRetryableStatus(status) {
    if (!status) return true;
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function integrationHeaders() {
    return {
        Authorization: `Bearer ${process.env.INTEGRATION_SERVICE_SECRET}`,
        'X-Integration-System': 'crm',
        'Content-Type': 'application/json',
    };
}

async function createIntegrationLog(data) {
    return prisma.integrationLog.create({
        data: {
            direction: data.direction,
            system: data.system,
            operation: data.operation,
            method: data.method,
            path: data.path,
            status: data.status || 'pending',
            responseStatus: data.responseStatus || null,
            requestBody: safeBody(data.requestBody),
            responseBody: safeBody(data.responseBody),
            errorMessage: data.errorMessage || null,
            attempts: data.attempts || 0,
            retryable: Boolean(data.retryable),
            lastAttemptAt: data.lastAttemptAt || null,
            nextRetryAt: data.nextRetryAt || null,
            completedAt: data.completedAt || null,
            entityType: data.entityType || null,
            entityId: data.entityId || null,
            createdById: data.createdById || null,
            idempotencyKey: data.idempotencyKey || null,
        },
    });
}

async function finishIntegrationLog(id, data) {
    return prisma.integrationLog.update({
        where: { id },
        data: {
            status: data.status,
            responseStatus: data.responseStatus || null,
            responseBody: safeBody(data.responseBody),
            errorMessage: data.errorMessage || null,
            retryable: Boolean(data.retryable),
            attempts: data.attempts,
            lastAttemptAt: data.lastAttemptAt || new Date(),
            nextRetryAt: data.nextRetryAt || null,
            completedAt: data.status === 'success' ? new Date() : null,
        },
    });
}

function createIntegrationAuditMiddleware() {
    return async function integrationAudit(req, res, next) {
        const startedAt = new Date();
        let log = null;

        try {
            log = await createIntegrationLog({
                direction: 'inbound',
                system: req.integrationSystem || 'unknown',
                operation: `${req.method} ${req.route?.path || req.path}`,
                method: req.method,
                path: req.originalUrl,
                requestBody: req.body,
                idempotencyKey: req.headers['x-idempotency-key'] || null,
                attempts: 1,
                lastAttemptAt: startedAt,
            });
        } catch (error) {
            console.error('[integration-journal] failed to create inbound log:', error.message);
        }

        const originalJson = res.json;
        res.json = function jsonWithAudit(body) {
            res.locals.integrationResponseBody = body;
            return originalJson.call(this, body);
        };

        res.on('finish', async () => {
            if (!log) return;
            const failed = res.statusCode >= 400;
            try {
                await finishIntegrationLog(log.id, {
                    status: failed ? 'failed' : 'success',
                    responseStatus: res.statusCode,
                    responseBody: res.locals.integrationResponseBody || null,
                    errorMessage: failed
                        ? res.locals.integrationResponseBody?.error || `HTTP ${res.statusCode}`
                        : null,
                    retryable: false,
                    attempts: 1,
                    lastAttemptAt: startedAt,
                });
            } catch (error) {
                console.error('[integration-journal] failed to finish inbound log:', error.message);
            }
        });

        next();
    };
}

async function executeOutboundIntegration({
    operation,
    url,
    method = 'POST',
    payload,
    entityType,
    entityId,
    timeout = 15000,
}) {
    const log = await createIntegrationLog({
        direction: 'outbound',
        system: 'learning-platform',
        operation,
        method,
        path: url,
        requestBody: payload,
        attempts: 1,
        lastAttemptAt: new Date(),
        entityType,
        entityId,
    });

    try {
        const response = await axios({
            url,
            method,
            data: payload,
            headers: integrationHeaders(),
            timeout,
        });
        await finishIntegrationLog(log.id, {
            status: 'success',
            responseStatus: response.status,
            responseBody: response.data,
            retryable: false,
            attempts: 1,
        });
        return response.data;
    } catch (error) {
        const status = error.response?.status || null;
        const retryable = isRetryableStatus(status);
        await finishIntegrationLog(log.id, {
            status: 'failed',
            responseStatus: status,
            responseBody: error.response?.data || null,
            errorMessage: normalizeError(error),
            retryable,
            attempts: 1,
            nextRetryAt: retryable ? new Date(Date.now() + 5 * 60 * 1000) : null,
        });
        throw error;
    }
}

async function retryIntegrationLog(logId) {
    const log = await prisma.integrationLog.findUnique({ where: { id: logId } });
    if (!log) {
        return { success: false, status: 404, error: 'Интеграционная операция не найдена' };
    }
    if (log.direction !== 'outbound') {
        return { success: false, status: 400, error: 'Повтор доступен только для исходящих операций CRM → приложение' };
    }
    if (!log.retryable && log.status !== 'failed') {
        return { success: false, status: 400, error: 'Эту операцию нельзя повторить' };
    }

    const attempts = log.attempts + 1;
    try {
        const response = await axios({
            url: log.path,
            method: log.method,
            data: log.requestBody || undefined,
            headers: integrationHeaders(),
            timeout: 15000,
        });
        const updated = await prisma.integrationLog.update({
            where: { id: log.id },
            data: {
                status: 'success',
                responseStatus: response.status,
                responseBody: safeBody(response.data),
                errorMessage: null,
                retryable: false,
                attempts,
                lastAttemptAt: new Date(),
                nextRetryAt: null,
                completedAt: new Date(),
            },
        });
        return { success: true, data: updated };
    } catch (error) {
        const status = error.response?.status || null;
        const retryable = isRetryableStatus(status);
        const updated = await prisma.integrationLog.update({
            where: { id: log.id },
            data: {
                status: 'failed',
                responseStatus: status,
                responseBody: safeBody(error.response?.data || null),
                errorMessage: normalizeError(error),
                retryable,
                attempts,
                lastAttemptAt: new Date(),
                nextRetryAt: retryable ? new Date(Date.now() + Math.min(attempts, 12) * 5 * 60 * 1000) : null,
            },
        });
        return { success: false, status: status || 502, error: updated.errorMessage, data: updated };
    }
}

module.exports = {
    createIntegrationAuditMiddleware,
    createIntegrationLog,
    executeOutboundIntegration,
    retryIntegrationLog,
    safeBody,
    redact,
    isRetryableStatus,
};
