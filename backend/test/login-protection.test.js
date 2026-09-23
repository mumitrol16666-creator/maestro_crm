const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createLoginProtection } = require('../src/middleware/loginProtection');
const { configureTrustedProxy } = require('../src/config/trustedProxy');

test('PM2 and Docker proxy topologies preserve client isolation and ignore forged XFF prefixes', () => {
    for (const [hops, peer] of [[undefined, '127.0.0.1'], ['1', '172.18.0.3']]) {
        const app = express(); configureTrustedProxy(app, hops);
        for (const client of ['198.51.100.20', '198.51.100.21']) {
            const req = Object.create(app.request);
            req.socket = { remoteAddress: peer };
            req.headers = { 'x-forwarded-for': `203.0.113.8, ${client}` };
            assert.equal(req.ip, client);
        }
    }
    const app = express(); configureTrustedProxy(app);
    const req = Object.create(app.request); req.socket = { remoteAddress: '198.51.100.22' };
    req.headers = { 'x-forwarded-for': '203.0.113.8' };
    assert.equal(req.ip, '198.51.100.22');
});

async function harness(t, options, trustProxy = 'loopback') {
    const app = express(); app.set('trust proxy', trustProxy); app.use(express.json());
    let attempts = 0;
    app.post('/login', ...createLoginProtection(options), (req, res) => {
        attempts++; res.status(req.body.password === 'correct' ? 200 : 401).json({ success: req.body.password === 'correct' });
    });
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const send = (phone, password = 'wrong', forwarded = '198.51.100.1') => fetch(`http://127.0.0.1:${server.address().port}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(forwarded ? { 'X-Forwarded-For': forwarded } : {}) },
        body: JSON.stringify({ phone, password }),
    });
    return { send, attempts: () => attempts };
}

test('phone limit survives formatting and client-IP changes, preserves unrelated login and expires', async t => {
    const h = await harness(t, { windowMs: 350, ipLimit: 50, phoneLimit: 2 });
    assert.equal((await h.send('+7 777 111 22 33')).status, 401);
    assert.equal((await h.send('87771112233', 'wrong', '198.51.100.2')).status, 401);
    const blocked = await h.send('77771112233', 'correct', '198.51.100.3');
    assert.equal(blocked.status, 429); assert.ok(blocked.headers.get('retry-after'));
    assert.equal((await h.send('77771112244', 'correct')).status, 200);
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal((await h.send('77771112233', 'correct')).status, 200);
});

test('IP limit rejects forged XFF prefixes and malformed credentials before reaching login', async t => {
    const h = await harness(t, { ipLimit: 2, phoneLimit: 10 });
    assert.equal((await h.send(undefined, 'wrong', '203.0.113.1, 198.51.100.4')).status, 400);
    assert.equal((await h.send({ not: null }, 'wrong', '203.0.113.2, 198.51.100.4')).status, 400);
    assert.equal((await h.send('77771112233', 'correct', '203.0.113.3, 198.51.100.4')).status, 429);
    assert.equal(h.attempts(), 0);
    assert.equal((await h.send('77771112233', 'correct', '198.51.100.5')).status, 200);
});

test('successful logins do not exhaust allowances, direct requests are limited too', async t => {
    const h = await harness(t, { ipLimit: 2, phoneLimit: 2 }, false);
    for (let i = 0; i < 5; i++) assert.equal((await h.send('77771112233', 'correct', '')).status, 200);
    assert.equal((await h.send('77771112233', 'wrong', '')).status, 401);
    assert.equal((await h.send('77771112233', 'wrong', '')).status, 401);
    assert.equal((await h.send('77771112244', 'correct', '')).status, 429);
});
