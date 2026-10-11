const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('session revocation through HTTP and PostgreSQL', { skip: 'TEST_DATABASE_URL required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /test|qa/.test(url.pathname));
    Object.assign(process.env, { DATABASE_URL: process.env.TEST_DATABASE_URL, NODE_ENV: 'test',
        JWT_SECRET: 'session-local-test-secret', INTEGRATION_SERVICE_SECRET: 'session-integration-test-secret' });
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const bcrypt = require('bcryptjs');
    const { prisma } = require('../src/config/db');
    const { authenticate, optionalAuth, requireAdmin } = require('../src/middleware/auth');
    const { signSession } = require('../src/utils/sessionVersion');
    let server, base, executions = 0;
    const createUser = async (extra = {}) => prisma.student.create({ data: {
        name: 'Session', lastName: 'Test', role: 'admin', phone: randomUUID(),
        password: await bcrypt.hash('previous-password', 4), ...extra,
    } });
    const request = async (path, token, method = 'GET', body, key = randomUUID()) => {
        const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Idempotency-Key': key },
        body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: res.status, body: await res.json() };
    };
    test.before(async () => {
        const app = express();
        app.use(express.json());
        const idempotency = require('../src/middleware/idempotency');
        app.use((req, res, next) => req.method === 'GET' ? next() : idempotency(req, res, next));
        app.use('/api/auth', require('../src/routes/auth'));
        app.use('/api/integration/v1', require('../src/routes/integration'));
        app.get('/api/optional', optionalAuth, (req, res) => res.json({ id: req.user?.id || null }));
        app.post('/api/session-control', authenticate, requireAdmin, (_req, res) => res.json({ execution: ++executions }));
        await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
        base = `http://127.0.0.1:${server.address().port}`;
    });
    test.after(async () => { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

    test('self password change issues a replacement and revokes normal, optional and cached old sessions', async () => {
        const user = await createUser();
        const old = signSession(user), key = randomUUID();
        const cached = await request('/api/session-control', old, 'POST', {}, key);
        assert.equal(cached.status, 200);
        assert.deepEqual(await request('/api/session-control', old, 'POST', {}, key), cached);
        const changed = await request('/api/auth/change-password', old, 'PATCH', {
            currentPassword: 'previous-password', newPassword: 'replacement-password',
        });
        assert.equal(changed.status, 200, JSON.stringify(changed));
        assert.ok(changed.body.token);
        assert.equal((await request('/api/auth/me', old)).status, 401);
        assert.equal((await request('/api/session-control', old, 'POST', {}, key)).status, 401);
        assert.equal((await request('/api/optional', old)).body.id, null);
        assert.equal((await request('/api/auth/me', changed.body.token)).status, 200);
        assert.equal((await request('/api/optional', changed.body.token)).body.id, user.id);
        const loginKey = randomUUID();
        const login = await request('/api/auth/login', null, 'POST', { phone: user.phone, password: 'replacement-password' }, loginKey);
        assert.equal(login.status, 200);
        assert.equal((await request('/api/auth/login', null, 'POST', { phone: user.phone, password: 'previous-password' }, loginKey)).status, 401);
    });

    test('administrative writes and disable/reactivate cannot resurrect a JWT; malformed revisions fail closed', async () => {
        let user = await createUser();
        const legacy = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
        assert.equal((await request('/api/auth/me', legacy)).status, 200);
        for (const version of [null, '0', -1, 0.5, {}]) {
            assert.equal((await request('/api/auth/me', jwt.sign({ userId: user.id, sessionVersion: version }, process.env.JWT_SECRET))).status, 401);
        }
        await prisma.$executeRaw`UPDATE "Student" SET password = 'admin-reset' WHERE id = ${user.id}`;
        assert.equal((await request('/api/auth/me', legacy)).status, 401);
        user = await prisma.student.findUnique({ where: { id: user.id } });
        const current = signSession(user), key = randomUUID();
        assert.equal((await request('/api/session-control', current, 'POST', {}, key)).status, 200);
        await prisma.student.update({ where: { id: user.id }, data: { status: 'inactive' } });
        assert.equal((await request('/api/session-control', current, 'POST', {}, key)).status, 401);
        await prisma.student.update({ where: { id: user.id }, data: { status: 'active' } });
        assert.equal((await request('/api/auth/me', current)).status, 401);
        const fresh = await prisma.student.findUnique({ where: { id: user.id } });
        assert.equal((await request('/api/auth/me', signSession(fresh))).status, 200);
        await assert.rejects(prisma.student.update({ where: { id: user.id }, data: { sessionVersion: 0 } }));
        await prisma.student.update({ where: { id: user.id }, data: { role: 'staff' } });
        assert.equal((await request('/api/session-control', signSession(fresh), 'POST', {}, key)).status, 403);
    });

    test('teacher remains denied CRM and linked access state requires service auth, exact binding and active account', async () => {
        const user = await createUser({ role: 'teacher', appUserId: randomUUID(), externalLinkStatus: 'linked' });
        assert.equal((await request('/api/auth/me', signSession(user))).status, 403);
        const path = `/api/integration/v1/users/${user.id}/session-state?appUserId=${user.appUserId}`;
        assert.equal((await request(path, signSession(user))).status, 401);
        const check = async (pathOverride = path) => {
            const r = await fetch(base + pathOverride, { headers: { Authorization: `Bearer ${process.env.INTEGRATION_SERVICE_SECRET}`, 'X-Integration-System': 'learning-platform' } });
            return { status: r.status, body: await r.json() };
        };
        assert.equal((await check()).body.data.sessionVersion, 0);
        assert.equal((await check(path + 'mismatch')).status, 401);
        await prisma.student.update({ where: { id: user.id }, data: { status: 'inactive' } });
        assert.equal((await check()).status, 401);
        await prisma.student.update({ where: { id: user.id }, data: { status: 'active' } });
        assert.equal((await check()).body.data.sessionVersion, 2);
    });

    test('SSO issuer binds both account revisions and denies inactive staff before contacting Platform', async t => {
        const axios = require('axios');
        const { createSsoToken } = require('../src/services/userLink');
        const user = await createUser({ role: 'teacher', appUserId: randomUUID(), externalLinkStatus: 'linked' });
        let calls = 0, version = 3;
        t.mock.method(axios, 'get', async (url, options) => {
            calls++;
            assert.ok(url.endsWith(`/api/integration/v1/users/${user.appUserId}/session-state`));
            assert.equal(options.params.crmUserId, user.id);
            assert.equal(options.headers.Authorization, `Bearer ${process.env.INTEGRATION_SERVICE_SECRET}`);
            return { data: { success: true, data: { sessionVersion: version, role: 'curator' } } };
        });
        const issued = await createSsoToken(user.id);
        assert.equal(issued.success, true);
        const claims = jwt.verify(issued.data.token, process.env.INTEGRATION_SSO_SECRET || process.env.JWT_SECRET);
        assert.equal(claims.sessionVersion, 3);
        assert.equal(claims.crmSessionVersion, 0);
        assert.equal(claims.appUserId, user.appUserId);
        version = '3';
        assert.equal((await createSsoToken(user.id)).success, false);
        await prisma.student.update({ where: { id: user.id }, data: { status: 'inactive' } });
        assert.equal((await createSsoToken(user.id)).success, false);
        assert.equal(calls, 2);
    });
}
