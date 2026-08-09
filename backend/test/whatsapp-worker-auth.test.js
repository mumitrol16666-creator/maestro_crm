const test = require('node:test');
const assert = require('node:assert/strict');
const { requireWhatsappWorkerAuth } = require('../src/middleware/whatsappWorkerAuth');

function responseRecorder() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

test('worker auth requires separate secret and a valid worker id', () => {
    const previous = process.env.WHATSAPP_BROWSER_WORKER_SECRET;
    process.env.WHATSAPP_BROWSER_WORKER_SECRET = 'worker-secret';
    try {
        const req = {
            headers: {
                authorization: 'Bearer worker-secret',
                'x-whatsapp-worker-id': 'maestro-playwright-1',
            },
        };
        const res = responseRecorder();
        let nextCalled = false;
        requireWhatsappWorkerAuth(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
        assert.equal(req.whatsappWorkerId, 'maestro-playwright-1');
    } finally {
        if (previous === undefined) delete process.env.WHATSAPP_BROWSER_WORKER_SECRET;
        else process.env.WHATSAPP_BROWSER_WORKER_SECRET = previous;
    }
});

test('worker auth rejects the learning-platform integration secret', () => {
    const previous = process.env.WHATSAPP_BROWSER_WORKER_SECRET;
    process.env.WHATSAPP_BROWSER_WORKER_SECRET = 'worker-secret';
    try {
        const req = {
            headers: {
                authorization: 'Bearer integration-secret',
                'x-whatsapp-worker-id': 'maestro-playwright-1',
            },
        };
        const res = responseRecorder();
        requireWhatsappWorkerAuth(req, res, () => assert.fail('next must not be called'));
        assert.equal(res.statusCode, 401);
    } finally {
        if (previous === undefined) delete process.env.WHATSAPP_BROWSER_WORKER_SECRET;
        else process.env.WHATSAPP_BROWSER_WORKER_SECRET = previous;
    }
});
