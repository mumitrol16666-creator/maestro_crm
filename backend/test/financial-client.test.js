const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { projectStudent } = require('../src/services/studentProjection');
const source = fs.readFileSync(require.resolve('../../frontend/js/modules/core/api.js'), 'utf8')
    .split('// Мгновенно блокируем submit-кнопку')[0];

function browser(fetch, storage = new Map()) {
    const window = { fetch, crypto: { randomUUID } };
    const token = `test.${Buffer.from(JSON.stringify({ userId: 'admin-1' })).toString('base64url')}.signature`;
    const context = { window, Headers, Response, URLSearchParams, atob,
        API_BASE_URL: 'http://localhost:5001', getAuthToken: () => token,
        console: { warn() {} }, setTimeout: fn => { queueMicrotask(fn); return 1; },
        sessionStorage: {
            getItem: key => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key),
        },
    };
    vm.runInNewContext(source, context);
    return { fetch: window.fetch, storage };
}
const url = 'http://localhost:5001/api/payments';
const options = (amount = 4000) => ({ method: 'POST', body: JSON.stringify({ studentId: 'student-1', amount }) });

test('lost payment response keeps its key across reload; acknowledged success allows a new payment', async () => {
    const keys = [];
    const storage = new Map();
    let page = browser(async (_, request) => { keys.push(request.headers.get('X-Idempotency-Key')); throw new Error('offline'); }, storage);
    await assert.rejects(() => page.fetch(url, options()), /offline/);
    assert.equal(storage.size, 1);
    page = browser(async (_, request) => {
        keys.push(request.headers.get('X-Idempotency-Key'));
        return Response.json({ success: true, payment: { id: 'payment-1' } }, { status: 201 });
    }, storage);
    await page.fetch(url, options());
    assert.equal(keys[0], keys[1]);
    assert.equal(storage.size, 0);
    await page.fetch(url, options());
    assert.notEqual(keys[2], keys[1]);
});

test('uncertain response cannot silently be retried with another amount', async () => {
    const page = browser(async () => { throw new Error('offline'); });
    await assert.rejects(() => page.fetch(url, options()), /offline/);
    await assert.rejects(() => page.fetch(url, options(5000)), /предыдущей денежной операции/);
    assert.equal(page.storage.size, 1);
});

test('manual balance correction reuses the pending key after reload and rejects a changed reason', async () => {
    const endpoint = 'http://localhost:5001/api/students/student-1/balance-adjustment';
    const storage = new Map();
    const keys = [];
    const request = { method: 'POST', body: JSON.stringify({ amount: -2000, reason: 'Сверка по документу' }) };
    let page = browser(async (_, options) => { keys.push(options.headers.get('X-Idempotency-Key')); throw new Error('offline'); }, storage);
    await assert.rejects(() => page.fetch(endpoint, request), /offline/);
    page = browser(async (_, options) => {
        keys.push(options.headers.get('X-Idempotency-Key'));
        return Response.json({ success: true });
    }, storage);
    await assert.rejects(() => page.fetch(endpoint, { ...request, body: JSON.stringify({ amount: -2000, reason: 'Другая причина' }) }), /предыдущей денежной операции/);
    await page.fetch(endpoint, request);
    assert.equal(keys[0], keys[1]);
    assert.equal(storage.size, 0);
});

test('truncated JSON leaves the draft, validation rejection clears it', async () => {
    const storage = new Map();
    let page = browser(async () => new Response('{', { status: 201 }), storage);
    await assert.rejects(() => page.fetch(url, options()));
    assert.equal(storage.size, 1);
    page = browser(async () => Response.json({ success: false }, { status: 400 }), storage);
    await page.fetch(url, options());
    assert.equal(storage.size, 0);
});

test('expired or revoked access preserves the uncertain payment key until authenticated replay', async () => {
    const storage = new Map();
    const keys = [];
    for (const status of [500, 401, 403, 201]) {
        const page = browser(async (_, request) => {
            keys.push(request.headers.get('X-Idempotency-Key'));
            return Response.json({ success: status === 201 }, { status });
        }, storage);
        await page.fetch(url, options());
        assert.equal(storage.size, status === 201 ? 0 : 1);
    }
    assert.equal(new Set(keys).size, 1);
});

test('student projection denies future scalar fields and financial aliases while preserving operational data', () => {
    const record = { id: 's1', name: 'Асем', phone: '87770000000', customerName: 'Родитель',
        password: 'secret', accountBalance: 12500, debtAmount: 0, futureSalarySecret: 123, monthlySalary: 50000 };
    assert.deepEqual(projectStudent(record, 'sales_manager'), {
        id: 's1', name: 'Асем', phone: '87770000000', customerName: 'Родитель',
    });
    assert.equal(projectStudent(record, 'admin').monthlySalary, 50000);
    assert.equal(projectStudent(record, 'admin').password, undefined);
});
