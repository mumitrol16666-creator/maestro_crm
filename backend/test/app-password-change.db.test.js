const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

if (!process.env.TEST_DATABASE_URL) {
    test('password changed in the app reaches CRM HTTP + PostgreSQL', { skip: 'TEST_DATABASE_URL required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /test|qa/.test(url.pathname));
    const SECRET = 'app-password-change-test';
    Object.assign(process.env, {
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        NODE_ENV: 'test',
        JWT_SECRET: 'app-password-change-test-secret',
        INTEGRATION_SERVICE_SECRET: SECRET,
        CRM_PASSWORD_VAULT_KEY: crypto.randomBytes(32).toString('base64'),
    });
    const bcrypt = require('bcryptjs');
    const express = require('express');
    const { prisma } = require('../src/config/db');
    const { signSession } = require('../src/utils/sessionVersion');
    const idempotency = require('../src/middleware/idempotency');
    let server, base, platform, admin, student, teacher;
    const created = [];
    // What the fake app answers on session-state, per app user id.
    const appState = new Map();
    let platformCalls = 0;

    const person = async (role, extra = {}) => {
        const row = await prisma.student.create({ data: { name: 'Смена', lastName: `В приложении ${role}`, role, phone: `+7${crypto.randomInt(1e9, 9e9)}`, password: await bcrypt.hash('unused-pass', 4), ...extra } });
        created.push(row.id);
        return row;
    };
    const linked = role => person(role, { appUserId: crypto.randomUUID(), externalLinkStatus: 'linked' });
    const post = async (path, headers, body = {}) => {
        const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
        return { status: r.status, body: await r.json() };
    };
    const fromApp = (body, headers = {}) => post('/api/integration/v1/users/password-changed-in-app',
        { Authorization: `Bearer ${SECRET}`, 'X-Integration-System': 'learning-platform', ...headers }, body);
    const asAdmin = (path, body) => post(path, { Authorization: `Bearer ${signSession(admin)}` }, body);
    const copyOf = id => prisma.student.findUnique({ where: { id }, select: { password: true, passwordEncrypted: true, passwordEncryptedAt: true } });

    test.before(async () => {
        platform = http.createServer((req, res) => {
            platformCalls += 1;
            const match = req.url.match(/^\/api\/integration\/v1\/users\/([^/]+)\/session-state/);
            const state = match && appState.get(decodeURIComponent(match[1]));
            res.setHeader('Content-Type', 'application/json');
            if (req.headers.authorization !== `Bearer ${SECRET}` || !state || state === 'down') {
                res.statusCode = state === 'down' ? 503 : 401;
                return res.end(JSON.stringify({ success: false }));
            }
            res.end(JSON.stringify({ success: true, data: { sessionVersion: 0, role: 'student', passwordChangedInAppAt: state.changedAt } }));
        });
        platform.listen(0, '127.0.0.1');
        await new Promise(resolve => platform.once('listening', resolve));
        process.env.LEARNING_PLATFORM_API_URL = `http://127.0.0.1:${platform.address().port}`;

        admin = await person('admin');
        student = await linked('student');
        teacher = await linked('teacher');
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => (['GET', 'HEAD'].includes(req.method) ? next() : idempotency(req, res, next)));
        app.use('/api/users', require('../src/routes/users'));
        app.use('/api/integration/v1', require('../src/routes/integration'));
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        base = `http://127.0.0.1:${server.address().port}`;
    });

    test.after(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        if (platform) await new Promise(resolve => platform.close(resolve));
        await prisma.integrationLog.deleteMany({ where: { OR: [{ path: { contains: 'password-changed-in-app' } }, { entityId: { in: created } }] } });
        // A student row keeps its opening balance entry, which the ledger never deletes.
        await prisma.student.deleteMany({ where: { id: { in: created }, role: { not: 'student' } } });
        await prisma.$disconnect();
    });

    // The admin sets a password in CRM; the fake app has seen no change of its own.
    const setInCrm = async (user, password) => {
        appState.set(user.appUserId, { changedAt: null });
        const r = await asAdmin(`/api/users/${user.id}/reset-password`, { password });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        return (await copyOf(user.id)).passwordEncryptedAt;
    };

    test('the app reports a change: the copy is gone, the admin is told why and offered a new password', async () => {
        await setInCrm(student, 'from-crm-2026');
        assert.equal((await asAdmin(`/api/users/${student.id}/reveal-password`)).body.password, 'from-crm-2026');

        const changedAt = new Date().toISOString();
        const sent = await fromApp({ appUserId: student.appUserId, crmUserId: student.id, changedAt });
        assert.equal(sent.status, 200, JSON.stringify(sent.body));
        assert.deepEqual(sent.body.data, { cleared: true });
        const row = await copyOf(student.id);
        assert.equal(row.passwordEncrypted, null);
        assert.equal(row.passwordEncryptedAt, null);
        assert.equal(await bcrypt.compare('from-crm-2026', row.password), true, 'the CRM hash is not touched');

        appState.set(student.appUserId, { changedAt });
        const shown = await asAdmin(`/api/users/${student.id}/reveal-password`);
        assert.equal(shown.status, 404);
        assert.equal(shown.body.code, 'PASSWORD_CHANGED_IN_APP');
        assert.equal(shown.body.changedAt, changedAt);
        assert.equal(shown.body.password, undefined);

        // With the app out of reach there is still nothing to show, and no false reason is given.
        appState.set(student.appUserId, 'down');
        const offline = await asAdmin(`/api/users/${student.id}/reveal-password`);
        assert.deepEqual([offline.status, offline.body.code], [404, 'PASSWORD_NOT_STORED']);
    });

    test('the notice is safe to repeat, carries no password, and is never served from the replay cache', async () => {
        await setInCrm(student, 'repeat-pass-1');
        const key = crypto.randomUUID();
        const body = { appUserId: student.appUserId, crmUserId: student.id, changedAt: new Date().toISOString() };
        const first = await fromApp(body, { 'X-Idempotency-Key': key });
        const again = await fromApp(body, { 'X-Idempotency-Key': key });
        assert.deepEqual([first.status, first.body.data], [200, { cleared: true }]);
        assert.deepEqual([again.status, again.body.data], [200, { cleared: false }], 'the second call ran again and found nothing to clear');
        const logs = await prisma.integrationLog.findMany({ where: { path: { contains: 'password-changed-in-app' } } });
        assert.ok(logs.length >= 2);
        assert.ok(!JSON.stringify(logs).includes('repeat-pass-1'));
    });

    test('a late notice does not wipe a password the admin set after the change in the app', async () => {
        const changedInApp = new Date(Date.now() - 60_000).toISOString();
        await setInCrm(teacher, 'newer-than-app');
        const late = await fromApp({ appUserId: teacher.appUserId, crmUserId: teacher.id, changedAt: changedInApp });
        assert.deepEqual([late.status, late.body.data], [200, { cleared: false }]);
        appState.set(teacher.appUserId, { changedAt: changedInApp });
        const shown = await asAdmin(`/api/users/${teacher.id}/reveal-password`);
        assert.equal(shown.status, 200, JSON.stringify(shown.body));
        assert.equal(shown.body.password, 'newer-than-app');
    });

    test('a lost notice: the reveal asks the app first and does not show the old password', async () => {
        await setInCrm(teacher, 'stale-after-app');
        const changedAt = new Date(Date.now() + 1000).toISOString();
        appState.set(teacher.appUserId, { changedAt });
        const shown = await asAdmin(`/api/users/${teacher.id}/reveal-password`);
        assert.equal(shown.status, 404, JSON.stringify(shown.body));
        assert.equal(shown.body.code, 'PASSWORD_CHANGED_IN_APP');
        assert.equal(shown.body.password, undefined);
        assert.equal((await copyOf(teacher.id)).passwordEncrypted, null, 'the stale copy is forgotten for good');
    });

    test('when the app cannot be asked, the copy is kept but not shown', async () => {
        await setInCrm(teacher, 'kept-while-down');
        appState.set(teacher.appUserId, 'down');
        const shown = await asAdmin(`/api/users/${teacher.id}/reveal-password`);
        assert.equal(shown.status, 503);
        assert.equal(shown.body.code, 'PASSWORD_APP_CHECK_FAILED');
        assert.equal(shown.body.password, undefined);
        assert.ok((await copyOf(teacher.id)).passwordEncrypted);
        appState.set(teacher.appUserId, { changedAt: null });
        assert.equal((await asAdmin(`/api/users/${teacher.id}/reveal-password`)).body.password, 'kept-while-down');
    });

    test('a user not linked to the app is shown without asking the app', async () => {
        const local = await person('sales_manager');
        await asAdmin(`/api/users/${local.id}/reset-password`, { password: 'crm-only-pass' });
        const before = platformCalls;
        const shown = await asAdmin(`/api/users/${local.id}/reveal-password`);
        assert.equal(shown.body.password, 'crm-only-pass');
        assert.equal(platformCalls, before);
    });

    test('only the app may send the notice, for a matching account, with a real time', async () => {
        await setInCrm(student, 'guarded-pass-1');
        const good = { appUserId: student.appUserId, crmUserId: student.id, changedAt: new Date().toISOString() };
        assert.equal((await fromApp(good, { 'X-Integration-System': 'crm' })).status, 403);
        assert.equal((await fromApp(good, { Authorization: 'Bearer wrong' })).status, 401);
        assert.equal((await fromApp({ ...good, appUserId: crypto.randomUUID() })).status, 404);
        assert.equal((await fromApp({ ...good, crmUserId: teacher.id })).status, 404);
        for (const changedAt of [undefined, 'not-a-date', 1730000000000]) {
            assert.equal((await fromApp({ ...good, changedAt })).status, 400, String(changedAt));
        }
        assert.ok((await copyOf(student.id)).passwordEncrypted, 'nothing above cleared the copy');
    });
}
