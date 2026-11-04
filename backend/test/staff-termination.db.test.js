const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('staff termination HTTP and salary history', { skip: 'TEST_DATABASE_URL required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /test|qa/.test(url.pathname));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL,
        JWT_SECRET: 'staff-termination-local-test-secret' });
    const express = require('express');
    const { prisma } = require('../src/config/db');
    const { signSession } = require('../src/utils/sessionVersion');
    let server, base, owner;
    test.before(async () => {
        owner = await prisma.student.create({ data: { name: 'Owner', lastName: 'Termination test',
            role: 'super_admin', phone: randomUUID(), password: 'unused' } });
        const app = express();
        app.use(express.json());
        app.use('/api/users', require('../src/routes/users'));
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        base = `http://127.0.0.1:${server.address().port}`;
    });
    test.after(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        await prisma.$disconnect();
    });
    async function request(method, path, body) {
        const res = await fetch(base + path, { method, headers: {
            Authorization: `Bearer ${signSession(owner)}`, 'Content-Type': 'application/json',
        }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: res.status, body: await res.json() };
    }
    test('terminating a teacher preserves earned lesson links and is repeatable', async () => {
        const teacher = await prisma.student.create({ data: { name: 'Former', lastName: 'Teacher',
            role: 'teacher', phone: randomUUID(), password: 'unused', payrollEnabled: true,
            employmentEndDate: new Date('2026-11-01') } });
        const lesson = await prisma.class.create({ data: { title: 'Earned lesson',
            teacherId: teacher.id, date: new Date('2026-10-20'), startTime: '12:00', endTime: '13:00',
            status: 'completed', teacherEarningStatus: 'active', teacherBaseEarning: 2500 } });
        for (let i = 0; i < 2; i++) {
            assert.equal((await request('DELETE', `/api/users/teachers/${teacher.id}`)).status, 200);
            const stored = await prisma.student.findUnique({ where: { id: teacher.id } });
            assert.equal(stored.status, 'inactive');
            assert.equal(stored.payrollEnabled, false);
            assert.equal(stored.employmentEndDate.toISOString(), '2026-11-01T00:00:00.000Z');
            assert.equal((await prisma.class.findUnique({ where: { id: lesson.id } })).teacherId, teacher.id);
        }
    });
    test('editing a historical cutoff retains the salary and rejects invalid ranges', async () => {
        const employee = await prisma.student.create({ data: { name: 'Former', lastName: 'Administrator',
            role: 'admin', status: 'inactive', phone: randomUUID(), password: 'unused',
            monthlySalary: 150000, employmentStartDate: new Date('2026-07-01') } });
        assert.equal((await request('PUT', `/api/users/${employee.id}`, { employmentEndDate: '2026-09-01' })).status, 200);
        const stored = await prisma.student.findUnique({ where: { id: employee.id } });
        assert.equal(stored.monthlySalary, 150000);
        assert.equal(stored.employmentEndDate.toISOString(), '2026-09-01T00:00:00.000Z');
        assert.equal((await request('PUT', `/api/users/${employee.id}`, { employmentEndDate: '2026-06-01' })).status, 400);
    });
}
