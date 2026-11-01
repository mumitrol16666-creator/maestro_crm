const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('admin password reveal HTTP + PostgreSQL', { skip: 'TEST_DATABASE_URL required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /test|qa/.test(url.pathname));
    Object.assign(process.env, {
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        NODE_ENV: 'test',
        JWT_SECRET: 'password-reveal-test-secret',
        CRM_PASSWORD_VAULT_KEY: crypto.randomBytes(32).toString('base64'),
    });
    const bcrypt = require('bcryptjs');
    const express = require('express');
    const { prisma } = require('../src/config/db');
    const { signSession } = require('../src/utils/sessionVersion');
    const { activityLogger } = require('../src/middleware/activityLogger');
    const idempotency = require('../src/middleware/idempotency');
    let server, base, admin, owner, teacher, otherAdmin, legacy;
    const created = [];

    const person = async (role, extra = {}) => {
        const row = await prisma.student.create({ data: { name: 'Пароль', lastName: `Тест ${role}`, role, phone: `+7${crypto.randomInt(1e9, 9e9)}`, password: await bcrypt.hash('unused-pass', 4), ...extra } });
        created.push(row.id);
        return row;
    };
    const call = async (path, token, body = {}, headers = {}) => {
        const r = await fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
        return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json() };
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 150));

    test.before(async () => {
        admin = await person('admin');
        owner = await person('super_admin');
        teacher = await person('teacher');
        otherAdmin = await person('admin');
        legacy = await person('sales_manager');
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => (['GET', 'HEAD'].includes(req.method) ? next() : idempotency(req, res, next)));
        app.use(activityLogger);
        app.use('/api/users', require('../src/routes/users'));
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        base = `http://127.0.0.1:${server.address().port}`;
    });

    test.after(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        await prisma.activityLog.deleteMany({ where: { userId: { in: created } } });
        await prisma.student.deleteMany({ where: { id: { in: created } } });
        await prisma.$disconnect();
    });

    test('admin sets an own password, sees it again later, and the login hash matches', async () => {
        const token = signSession(admin);
        const reset = await call(`/api/users/${teacher.id}/reset-password`, token, { password: 'Гитара-2026' });
        assert.equal(reset.status, 200, JSON.stringify(reset.body));
        assert.equal(reset.body.newPassword, 'Гитара-2026');
        assert.equal(reset.cache, 'no-store');

        const row = await prisma.student.findUnique({ where: { id: teacher.id } });
        assert.equal(Object.hasOwn(row, 'passwordEncrypted'), false, 'default reads never carry the copy');
        assert.equal(await bcrypt.compare('Гитара-2026', row.password), true);
        assert.ok(row.passwordEncryptedAt instanceof Date);
        const raw = await prisma.student.findUnique({ where: { id: teacher.id }, omit: { passwordEncrypted: false } });
        assert.ok(raw.passwordEncrypted && !raw.passwordEncrypted.includes('Гитара'));

        const shown = await call(`/api/users/${teacher.id}/reveal-password`, token);
        assert.equal(shown.status, 200, JSON.stringify(shown.body));
        assert.equal(shown.body.password, 'Гитара-2026');
        assert.equal(shown.cache, 'no-store');
        assert.equal(new Date(shown.body.setAt).getTime(), row.passwordEncryptedAt.getTime());
    });

    test('a generated password is shown again exactly; a second reset replaces the copy', async () => {
        const token = signSession(owner);
        const first = await call(`/api/users/${teacher.id}/reset-password`, token);
        assert.equal(first.status, 200);
        assert.match(first.body.newPassword, /^[A-Za-z0-9]{8}$/);
        assert.equal((await call(`/api/users/${teacher.id}/reveal-password`, token)).body.password, first.body.newPassword);
        const second = await call(`/api/users/${teacher.id}/reset-password`, token, { password: 'another-pass-1' });
        assert.equal(second.status, 200);
        assert.equal((await call(`/api/users/${teacher.id}/reveal-password`, token)).body.password, 'another-pass-1');
    });

    test('an admin cannot see or reset another admin; the super admin can', async () => {
        await call(`/api/users/${otherAdmin.id}/reset-password`, signSession(owner), { password: 'admin-pass-123' });
        const denied = await call(`/api/users/${otherAdmin.id}/reveal-password`, signSession(admin));
        assert.equal(denied.status, 403);
        assert.equal(denied.body.password, undefined);
        assert.equal((await call(`/api/users/${otherAdmin.id}/reset-password`, signSession(admin), { password: 'x-pass-12345' })).status, 403);
        const allowed = await call(`/api/users/${otherAdmin.id}/reveal-password`, signSession(owner));
        assert.equal(allowed.status, 200);
        assert.equal(allowed.body.password, 'admin-pass-123');
    });

    test('teachers and students get no access; a password set before the feature says so plainly', async () => {
        const teacherTry = await call(`/api/users/${legacy.id}/reveal-password`, signSession(teacher));
        assert.ok([401, 403].includes(teacherTry.status));
        assert.equal(teacherTry.body.password, undefined);
        const missing = await call(`/api/users/${legacy.id}/reveal-password`, signSession(admin));
        assert.equal(missing.status, 404);
        assert.equal(missing.body.code, 'PASSWORD_NOT_STORED');
    });

    test('bad own passwords are rejected and change nothing', async () => {
        const token = signSession(admin);
        const before = await prisma.student.findUnique({ where: { id: teacher.id }, select: { password: true } });
        for (const password of ['short', 'line\nbreak-pass', 'я'.repeat(40), 12345678]) {
            const r = await call(`/api/users/${teacher.id}/reset-password`, token, { password });
            assert.equal(r.status, 400, String(password));
        }
        const after = await prisma.student.findUnique({ where: { id: teacher.id }, select: { password: true } });
        assert.equal(after.password, before.password);
    });

    test('every look is in the activity log without the password; replays with an idempotency key are not cached', async () => {
        const token = signSession(admin);
        const key = crypto.randomUUID();
        const a = await call(`/api/users/${teacher.id}/reveal-password`, token, {}, { 'X-Idempotency-Key': key });
        const b = await call(`/api/users/${teacher.id}/reveal-password`, token, {}, { 'X-Idempotency-Key': key });
        assert.equal(a.status, 200);
        assert.equal(b.status, 200);
        await settle();
        const logs = await prisma.activityLog.findMany({ where: { userId: admin.id, action: 'reveal-password', entityId: teacher.id } });
        assert.ok(logs.length >= 2);
        const text = JSON.stringify(logs);
        assert.ok(logs[0].details.startsWith('Просмотр пароля'));
        assert.ok(!text.includes(a.body.password));
        const stored = await prisma.idempotencyKey.findMany({ where: { OR: [{ key: { contains: key } }, { responseBody: { contains: a.body.password } }] } });
        assert.equal(stored.length, 0);
    });

    test('without the server key nothing is stored and the reveal is switched off', async () => {
        const key = process.env.CRM_PASSWORD_VAULT_KEY;
        delete process.env.CRM_PASSWORD_VAULT_KEY;
        try {
            const token = signSession(owner);
            assert.equal((await call(`/api/users/${teacher.id}/reset-password`, token, { password: 'no-vault-pass' })).status, 200);
            const raw = await prisma.student.findUnique({ where: { id: teacher.id }, omit: { passwordEncrypted: false } });
            assert.equal(raw.passwordEncrypted, null);
            assert.equal(raw.passwordEncryptedAt, null);
            const off = await call(`/api/users/${teacher.id}/reveal-password`, token);
            assert.equal(off.status, 503);
            assert.equal(off.body.code, 'PASSWORD_VAULT_DISABLED');
        } finally {
            process.env.CRM_PASSWORD_VAULT_KEY = key;
        }
    });
}
