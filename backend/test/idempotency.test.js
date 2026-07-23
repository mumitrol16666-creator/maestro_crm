const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
const { createIdempotencyMiddleware } = require('../src/middleware/idempotency');

function createResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        },
    };
}

function makeRequest(key = 'same-click') {
    return {
        method: 'POST',
        originalUrl: '/api/payments',
        headers: {
            authorization: 'Bearer admin-token',
            'x-idempotency-key': key,
        },
    };
}

test('одинаковый завершённый запрос получает сохранённый ответ без повторного выполнения', async () => {
    const stored = new Map();
    const db = {
        idempotencyKey: {
            findUnique: async ({ where }) => stored.get(where.key) || null,
            create: async ({ data }) => {
                stored.set(data.key, { ...data, responseStatus: null, responseBody: null });
            },
            update: async ({ where, data }) => {
                stored.set(where.key, { ...stored.get(where.key), ...data });
            },
            delete: async ({ where }) => stored.delete(where.key),
        },
    };
    const middleware = createIdempotencyMiddleware(db);

    let executions = 0;
    const firstResponse = createResponse();
    await middleware(makeRequest(), firstResponse, () => {
        executions += 1;
        firstResponse.status(201).json({ success: true, id: 'payment-1' });
    });
    await new Promise((resolve) => setImmediate(resolve));

    const secondResponse = createResponse();
    await middleware(makeRequest(), secondResponse, () => {
        executions += 1;
    });

    assert.equal(executions, 1);
    assert.equal(secondResponse.statusCode, 201);
    assert.deepEqual(secondResponse.body, { success: true, id: 'payment-1' });
});

test('параллельный дубль с тем же ключом получает конфликт', async () => {
    const stored = new Map();
    const db = {
        idempotencyKey: {
            findUnique: async ({ where }) => stored.get(where.key) || null,
            create: async ({ data }) => {
                if (stored.has(data.key)) {
                    const error = new Error('duplicate');
                    error.code = 'P2002';
                    throw error;
                }
                stored.set(data.key, { ...data, responseStatus: null, responseBody: null });
            },
            update: async () => {},
            delete: async () => {},
        },
    };
    const middleware = createIdempotencyMiddleware(db);
    let releaseFirst;
    const firstStarted = new Promise((resolve) => {
        releaseFirst = resolve;
    });
    const first = middleware(makeRequest('parallel'), createResponse(), () => firstStarted);
    await new Promise((resolve) => setImmediate(resolve));

    const duplicateResponse = createResponse();
    await middleware(makeRequest('parallel'), duplicateResponse, () => {
        throw new Error('duplicate request must not execute');
    });
    releaseFirst();
    await first;

    assert.equal(duplicateResponse.statusCode, 409);
    assert.match(duplicateResponse.body.error, /уже обрабатывается/i);
});

test('ответ отправляется только после сохранения результата запроса', async () => {
    let releaseSave;
    const saveStarted = new Promise((resolve) => {
        releaseSave = resolve;
    });
    let saved = false;
    const db = {
        idempotencyKey: {
            findUnique: async () => null,
            create: async () => {},
            update: async () => {
                await saveStarted;
                saved = true;
            },
            delete: async () => {},
        },
    };
    const middleware = createIdempotencyMiddleware(db);
    const response = createResponse();

    await middleware(makeRequest('save-before-send'), response, () => {
        response.status(201).json({ success: true });
    });

    assert.equal(response.body, null);
    releaseSave();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(saved, true);
    assert.deepEqual(response.body, { success: true });
});
