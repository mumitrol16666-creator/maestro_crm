const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('people P0 PostgreSQL/HTTP checks', { skip: 'TEST_DATABASE_URL is required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /(?:test|qa)/.test(url.pathname));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL,
        JWT_SECRET: 'people-p0-local-test', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '',
        LEARNING_PLATFORM_API_URL: 'http://127.0.0.1:9', INTEGRATION_SERVICE_SECRET: '' });
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const bcrypt = require('bcryptjs');
    const { prisma } = require('../src/config/db');
    let server, base, admin, superAdmin, sales, passwordHash;
    const password = 'local QA password';
    const makeUser = (role, extra = {}) => prisma.student.create({ data: {
        role, name: 'People QA', lastName: randomUUID(), phone: `qa-${randomUUID()}`,
        password: passwordHash, ...extra,
    } });
    async function request(method, path, body, actor, form = false) {
        const response = await fetch(base + path, { method, headers: {
            'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
            ...(actor ? { Authorization: `Bearer ${jwt.sign({ userId: actor.id }, process.env.JWT_SECRET)}` } : {}),
        }, ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }) });
        return { status: response.status, body: await response.json() };
    }
    test.before(async () => {
        passwordHash = await bcrypt.hash(password, 4);
        admin = await makeUser('admin'); superAdmin = await makeUser('super_admin'); sales = await makeUser('sales_manager');
        const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: true }));
        app.use('/auth', require('../src/routes/auth'));
        app.use('/users', require('../src/routes/users'));
        app.use('/students', require('../src/routes/students'));
        await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
        base = `http://127.0.0.1:${server.address().port}`;
    });
    test.after(async () => { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

    test('login rejects missing and structured credentials; valid shared-phone employee still logs in', async () => {
        for (const body of [{ password }, { phone: null, password }, { phone: { not: null }, password },
            { phone: [admin.phone], password }, { phone: '', password }, { phone: ' '.repeat(5), password },
            { phone: admin.phone, password: { not: null } }, { phone: admin.phone, password: [] }]) {
            const result = await request('POST', '/auth/login', body);
            assert.equal(result.status, 400, JSON.stringify({ body, result }));
            assert.equal(result.body.token, undefined);
        }
        for (const body of [`phone[not]=unknown&password=${encodeURIComponent(password)}`,
            `phone=${encodeURIComponent(admin.phone)}&phone=other&password=${encodeURIComponent(password)}`]) {
            assert.equal((await request('POST', '/auth/login', body, null, true)).status, 400);
        }
        await makeUser('student', { phone: admin.phone });
        const valid = await request('POST', '/auth/login', { phone: admin.phone, password });
        assert.equal(valid.status, 200); assert.equal(valid.body.user._id, admin.id);
        assert.equal((await request('POST', '/auth/login', { phone: admin.phone, password: 'wrong' })).status, 401);
        const teacher = await makeUser('teacher');
        assert.equal((await request('POST', '/auth/login', { phone: teacher.phone, password })).status, 403);
        assert.equal((await request('GET', '/auth/me', undefined, teacher)).status, 403);
        const disabled = await makeUser('staff', { status: 'inactive' });
        assert.equal((await request('POST', '/auth/login', { phone: disabled.phone, password })).status, 403);
    });

    test('only super-admin creates administrator accounts through generic users API', async () => {
        for (const role of ['admin', 'super_admin']) {
            const body = { name: 'QA', lastName: 'Create', phone: randomUUID(), password, role };
            assert.equal((await request('POST', '/users', body, admin)).status, 403);
            assert.equal(await prisma.student.count({ where: { phone: body.phone } }), 0);
            assert.equal((await request('POST', '/users', body, superAdmin)).status, 201);
        }
        assert.equal((await request('POST', '/users', { name: 'QA', lastName: 'Staff', phone: randomUUID(), password, role: 'staff' }, admin)).status, 201);
    });

    test('admin cannot change protected credentials/status but ordinary profile edits and self password change work', async () => {
        for (const role of ['admin', 'super_admin']) {
            const target = await makeUser(role);
            for (const body of [{ password: 'attacker-password' }, { status: 'inactive' }, { phone: randomUUID() }]) {
                assert.equal((await request('PUT', `/users/${target.id}`, body, admin)).status, 403);
                const unchanged = await prisma.student.findUnique({ where: { id: target.id } });
                assert.equal(unchanged.password, target.password); assert.equal(unchanged.phone, target.phone);
                assert.equal(unchanged.status, target.status);
            }
            assert.equal((await request('PUT', `/users/${target.id}`, { name: 'Edited', role, phone: target.phone, status: target.status }, admin)).status, 200);
            assert.equal((await request('PUT', `/users/${target.id}`, { password: 'allowed-password' }, superAdmin)).status, 200);
        }
        const staff = await makeUser('staff');
        assert.equal((await request('PUT', `/users/${staff.id}`, { password: 'allowed-password' }, admin)).status, 200);
        const reset = await request('POST', `/users/${staff.id}/reset-password`, {}, admin);
        assert.equal(reset.status, 200);
        assert.equal(await bcrypt.compare(reset.body.newPassword, (await prisma.student.findUnique({ where: { id: staff.id } })).password), true);
        assert.equal((await request('POST', `/users/${superAdmin.id}/reset-password`, {}, admin)).status, 403);
        assert.equal((await request('PUT', `/users/${admin.id}`, { role: 'super_admin' }, admin)).status, 403);
        const self = await makeUser('admin');
        assert.equal((await request('PATCH', '/auth/change-password', { currentPassword: password, newPassword: 'new local password' }, self)).status, 200);
    });

    test('student PUT/pause rejects every employee role before any state changes; student workflows remain usable', async () => {
        for (const role of ['teacher', 'staff', 'sales_manager', 'admin', 'super_admin']) {
            const employee = await makeUser(role);
            const group = await prisma.group.create({ data: { name: 'QA protected', direction: 'Гитара' } });
            await prisma.studentGroup.create({ data: { studentId: employee.id, groupId: group.id } });
            const lesson = await prisma.class.create({ data: { title: 'QA future', individualStudentId: employee.id,
                classType: 'individual', date: new Date('2099-01-01'), startTime: '10:00', endTime: '10:45' } });
            for (const actor of [sales, admin, superAdmin]) {
                assert.equal((await request('PUT', `/students/${employee.id}`, { phone: randomUUID(), status: 'inactive' }, actor)).status, 404);
                assert.equal((await request('POST', `/students/${employee.id}/pause`, {}, actor)).status, 404);
            }
            const unchanged = await prisma.student.findUnique({ where: { id: employee.id } });
            assert.equal(unchanged.phone, employee.phone); assert.equal(unchanged.status, 'active');
            assert.equal(await prisma.class.count({ where: { id: lesson.id } }), 1);
            assert.equal((await prisma.studentGroup.findFirst({ where: { studentId: employee.id } })).status, 'active');
            assert.equal((await request('GET', `/students/${employee.id}`, undefined, admin)).status, 200);
        }
        const student = await makeUser('student');
        assert.equal((await request('PUT', `/students/${student.id}`, { name: 'Edited pupil' }, sales)).status, 200);
        assert.equal((await request('POST', `/students/${student.id}/pause`, {}, sales)).status, 200);
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).status, 'inactive');
    });

    test('role promotion between preflight and update cannot bypass users or students protection', async () => {
        for (const route of ['users', 'students', 'reset-password']) {
            const target = await makeUser(route === 'students' ? 'student' : 'teacher');
            const original = prisma.student.findUnique;
            let promoted = false;
            prisma.student.findUnique = async args => {
                const result = await original(args);
                if (args.where.id === target.id && !promoted) {
                    promoted = true;
                    await prisma.student.update({ where: { id: target.id }, data: { role: 'super_admin' } });
                }
                return result;
            };
            try {
                const response = route === 'reset-password'
                    ? await request('POST', `/users/${target.id}/reset-password`, {}, admin)
                    : await request('PUT', `/${route}/${target.id}`, { phone: randomUUID(), status: 'inactive' }, admin);
                assert.equal(response.status, route === 'students' ? 404 : 409);
            } finally { prisma.student.findUnique = original; }
            const saved = await prisma.student.findUnique({ where: { id: target.id } });
            assert.equal(saved.role, 'super_admin'); assert.equal(saved.phone, target.phone); assert.equal(saved.status, 'active');
            assert.equal(saved.password, target.password);
        }
    });

    test('pause rechecks the student role after waiting for a concurrent promotion', async () => {
        const target = await makeUser('student');
        let pending;
        await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${target.id} FOR UPDATE`;
            pending = request('POST', `/students/${target.id}/pause`, {}, sales);
            await new Promise(resolve => setTimeout(resolve, 80));
            await tx.student.update({ where: { id: target.id }, data: { role: 'super_admin' } });
        });
        assert.equal((await pending).status, 404);
        assert.equal((await prisma.student.findUnique({ where: { id: target.id } })).status, 'active');
    });
}
