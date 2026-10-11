const { createHash } = require('node:crypto');

function financialError(message, code, statusCode = 400) {
    return Object.assign(new Error(message), { code, statusCode });
}

function financialRequestKey(req) {
    const first = req.get('X-Idempotency-Key');
    const second = req.get('Idempotency-Key');
    const key = first || second;
    if (!key || !/^[A-Za-z0-9_-]{8,200}$/.test(key) || (first && second && first !== second)) {
        throw financialError('Обновите страницу и повторите операцию: нужен корректный ключ запроса.', 'INVALID_REQUEST_KEY');
    }
    return key;
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    return value;
}

// The outcome is committed with the money, survives a lost HTTP response and
// is scoped to a stable authenticated actor (not to a short-lived JWT).
async function runFinancialRequest(db, { key, actorId, operation, payload }, execute) {
    const id = createHash('sha256').update(JSON.stringify([actorId, operation, key])).digest('hex');
    const requestHash = createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
    return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`financial:${id}`}, 0)) IS NULL AS locked`;
        const existing = await tx.financialRequest.findUnique({ where: { id } });
        if (existing) {
            if (existing.requestHash !== requestHash) {
                throw financialError('Этот ключ уже использован для другой операции. Проверьте сохранённый платёж.', 'REQUEST_KEY_CONFLICT', 409);
            }
            return { status: existing.responseStatus, body: existing.responseBody, replayed: true };
        }
        const result = await execute(tx);
        const body = JSON.parse(JSON.stringify(result.body));
        await tx.financialRequest.create({ data: {
            id, actorId, operation, requestHash, responseStatus: result.status, responseBody: body,
        } });
        return { status: result.status, body, replayed: false };
    }, { maxWait: 10000, timeout: 20000 });
}

module.exports = { financialRequestKey, runFinancialRequest, financialError };
