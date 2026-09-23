const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('emergency freeze PostgreSQL/HTTP checks', { skip: 'TEST_DATABASE_URL is required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && /test|qa/.test(url.pathname));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL,
        JWT_SECRET: 'local-emergency-freeze-tests', LEARNING_PLATFORM_API_URL: 'http://127.0.0.1:9',
        TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', INTEGRATION_SERVICE_SECRET: 'local-freeze-integration-secret' });
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const { prisma } = require('../src/config/db');
    const { rateCardMembershipData } = require('../src/services/rateCards');
    const { useEmergencyFreezeForClass } = require('../src/services/classMembership');
    const { zonedDateTimeParts } = require('../src/services/cancellationPolicy');
    let server, base, admin;
    async function user(role = 'student') {
        return prisma.student.create({ data: { role, name: 'Freeze QA', lastName: randomUUID(), phone: `qa-${randomUUID()}`,
            password: 'qa-only', learningDirections: [], teacherDirections: [], accountBalance: 50000 } });
    }
    async function fixture(rights = 1) {
        const student = await user(); const teacher = await user('teacher');
        const membership = await prisma.membership.create({ data: rateCardMembershipData({ studentId: student.id,
            name: 'Freeze QA', rates: { individual: 4000 }, emergencyFreezesAvailable: rights }) });
        const lessons = [];
        for (let i = 0; i < 3; i++) {
            const lesson = await prisma.class.create({ data: { title: `Freeze QA ${i}`, teacherId: teacher.id,
                individualStudentId: student.id, classType: 'individual', status: 'scheduled',
                date: new Date(`${zonedDateTimeParts(new Date()).dateKey}T00:00:00Z`), startTime: `${10 + i}:00`, endTime: `${10 + i}:45`,
                topic: 'Аккорды', lessonSummary: 'Проверка' } });
            await prisma.classAttendee.create({ data: { classId: lesson.id, studentId: student.id, attended: false, attendanceStatus: 'emergency_freeze' } });
            lessons.push(lesson);
        }
        return { student, membership, lessons };
    }
    async function request(lesson, action, body = {}, integration = false) {
        const response = await fetch(`${base}${integration ? '/integration' : ''}/classes/${lesson.id}/${action}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Integration-System': 'learning-platform',
                Authorization: `Bearer ${integration ? process.env.INTEGRATION_SERVICE_SECRET : jwt.sign({ id: admin.id }, process.env.JWT_SECRET)}` },
            body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
    }
    const approve = (f, lesson, status = 'emergency_freeze') => request(lesson, 'approve', {
        billingDecisions: [{ studentId: f.student.id, membershipId: f.membership.id, attendanceStatus: status, amount: status === 'present' ? 4000 : 0 }],
    });
    async function counters(f) {
        const row = await prisma.membership.findUnique({ where: { id: f.membership.id } });
        return [row.emergencyFreezesAvailable, row.emergencyFreezesUsed];
    }
    async function event(f, lesson, type) {
        return prisma.membershipTransaction.create({ data: { membershipId: f.membership.id, classId: lesson.id, type, amount: 0, reason: 'Historical fixture' } });
    }
    test.before(async () => {
        admin = await user('super_admin');
        const app = express(); app.use(express.json());
        app.use('/classes', require('../src/routes/classes'));
        app.use('/integration', require('../src/routes/integration'));
        await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
        base = `http://127.0.0.1:${server.address().port}`;
    });
    test.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

    test('three confirmation and reopen cycles each use and restore one emergency right', async () => {
        const f = await fixture(); const c = f.lessons[0];
        for (let i = 0; i < 3; i++) {
            const result = await approve(f, c);
            assert.equal(result.status, 200, JSON.stringify(result.body));
            assert.deepEqual(await counters(f), [0, 1]);
            const reopened = await request(c, 'reopen', { reason: 'QA repeat cycle' });
            assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
            assert.equal(reopened.body.data.restoredFreezes, 1);
            assert.deepEqual(await counters(f), [1, 0]);
        }
        assert.equal(await prisma.membershipTransaction.count({ where: { classId: c.id, type: 'freeze_used' } }), 3);
        assert.equal(await prisma.membershipTransaction.count({ where: { classId: c.id, type: 'freeze_restored' } }), 3);
        assert.equal((await prisma.student.findUnique({ where: { id: f.student.id } })).accountBalance, 50000);
    });

    test('same-day cancellation remains free after reopening and concurrent duplicate clicks', async () => {
        const f = await fixture(); const c = f.lessons[0];
        for (let i = 0; i < 2; i++) {
            const results = await Promise.all([request(c, 'postpone'), request(c, 'postpone')]);
            assert.equal(results.filter(r => r.status === 200).length, 1);
            assert.deepEqual(await counters(f), [0, 1]);
            assert.equal((await prisma.student.findUnique({ where: { id: f.student.id } })).accountBalance, 50000);
            const reopened = await Promise.all([request(c, 'reopen'), request(c, 'reopen')]);
            assert.equal(reopened.filter(r => r.status === 200).length, 1);
            assert.deepEqual(await counters(f), [1, 0]);
        }
        assert.equal(await prisma.membershipTransaction.count({ where: { classId: c.id, type: 'manual_deduct' } }), 0);
    });

    test('old settled freeze on a paid lesson cannot steal the right used by another lesson', async () => {
        const f = await fixture(2); const [a, b] = f.lessons;
        assert.equal((await approve(f, a)).status, 200);
        assert.equal((await request(a, 'reopen')).status, 200);
        assert.equal((await approve(f, b)).status, 200);
        assert.equal((await approve(f, a, 'present')).status, 200);
        const reopened = await request(a, 'reopen');
        assert.equal(reopened.status, 200);
        assert.equal(reopened.body.data.restoredFreezes, 0);
        assert.deepEqual(await counters(f), [1, 1]);
        assert.equal(await prisma.membershipTransaction.count({ where: { classId: a.id, type: 'freeze_restored' } }), 1);
        assert.equal((await prisma.student.findUnique({ where: { id: f.student.id } })).accountBalance, 50000);
        assert.equal((await request(b, 'reopen')).status, 200);
        assert.deepEqual(await counters(f), [2, 0]);
    });

    test('historical duplicate events restore only the outstanding right on the original archived membership', async () => {
        const f = await fixture(); const c = f.lessons[0];
        await prisma.membership.update({ where: { id: f.membership.id }, data: { status: 'archived', emergencyFreezesAvailable: 0, emergencyFreezesUsed: 1 } });
        await prisma.class.update({ where: { id: c.id }, data: { status: 'completed' } });
        await event(f, c, 'freeze_used'); await event(f, c, 'freeze_restored'); await event(f, c, 'freeze_used');
        const result = await request(c, 'reopen');
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.data.restoredFreezes, 1);
        assert.deepEqual(await counters(f), [1, 0]);
        assert.equal((await prisma.membership.findUnique({ where: { id: f.membership.id } })).status, 'archived');
        assert.equal(await prisma.membershipTransaction.count({ where: { classId: c.id, type: 'freeze_restored' } }), 2);
    });

    test('concurrent direct uses serialize the last right and duplicate requests', async () => {
        const f = await fixture(1);
        const results = await Promise.all(f.lessons.map(c => useEmergencyFreezeForClass(f.student.id, c, admin.id, null, f.membership.id)));
        assert.equal(results.filter(r => r.frozen).length, 1);
        assert.deepEqual(await counters(f), [0, 1]);
        const second = await fixture(2); const c = second.lessons[0];
        const duplicate = await Promise.all([1, 2].map(() => useEmergencyFreezeForClass(second.student.id, c, admin.id, null, second.membership.id)));
        assert.equal(duplicate.filter(r => r.frozen).length, 1);
        assert.deepEqual(await counters(second), [1, 1]);
    });

    test('historical rights restore separately for each participant and each outstanding use', async () => {
        const a = await fixture(0); const b = await fixture(0); const c = a.lessons[0];
        await prisma.class.update({ where: { id: c.id }, data: { status: 'completed' } });
        await prisma.classAttendee.create({ data: { classId: c.id, studentId: b.student.id, attendanceStatus: 'emergency_freeze' } });
        await prisma.membership.update({ where: { id: a.membership.id }, data: { emergencyFreezesUsed: 2 } });
        await prisma.membership.update({ where: { id: b.membership.id }, data: { emergencyFreezesUsed: 1 } });
        await event(a, c, 'freeze_used'); await event(a, c, 'freeze_used'); await event(b, c, 'freeze_used');
        const result = await request(c, 'reopen');
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.data.restoredFreezes, 3);
        assert.deepEqual(await counters(a), [2, 0]);
        assert.deepEqual(await counters(b), [1, 0]);
        assert.equal(await prisma.membershipTransaction.count({ where: { classId: c.id, type: 'freeze_restored' } }), 3);
    });

    test('counter conflict returns 409 and rolls back the whole reopen including cash refund', async () => {
        const f = await fixture(0); const c = f.lessons[0];
        assert.equal((await approve(f, c, 'present')).status, 200);
        await event(f, c, 'freeze_used');
        for (const integration of [false, true]) {
            const result = await request(c, 'reopen', { reason: 'QA inconsistent history' }, integration);
            assert.equal(result.status, 409, JSON.stringify(result.body));
            assert.equal(result.body.code, 'EMERGENCY_FREEZE_LEDGER_CONFLICT');
        }
        assert.deepEqual(await counters(f), [0, 0]);
        assert.equal((await prisma.class.findUnique({ where: { id: c.id } })).status, 'completed');
        assert.equal((await prisma.student.findUnique({ where: { id: f.student.id } })).accountBalance, 46000);
        assert.equal(await prisma.membershipTransaction.count({ where: { classId: c.id, type: { in: ['add', 'freeze_restored'] } } }), 0);
    });

    test('same-day cancellation without a free right charges once and reopens with an exact cash refund', async () => {
        const f = await fixture(0); const c = f.lessons[0];
        for (let i = 0; i < 2; i++) {
            const results = await Promise.all([request(c, 'postpone'), request(c, 'postpone')]);
            assert.equal(results.filter(r => r.status === 200).length, 1);
            assert.equal((await prisma.student.findUnique({ where: { id: f.student.id } })).accountBalance, 46000);
            assert.deepEqual(await counters(f), [0, 0]);
            const result = await request(c, 'reopen');
            assert.equal(result.status, 200, JSON.stringify(result.body));
            assert.equal(result.body.data.restoredFreezes, 0);
            assert.equal((await prisma.student.findUnique({ where: { id: f.student.id } })).accountBalance, 50000);
        }
    });

    test('nullable historical used counter becomes one on use and zero on restoration', async () => {
        const f = await fixture(); const c = f.lessons[0];
        await prisma.membership.update({ where: { id: f.membership.id }, data: { emergencyFreezesUsed: null } });
        assert.equal((await approve(f, c)).status, 200);
        assert.deepEqual(await counters(f), [0, 1]);
        assert.equal((await request(c, 'reopen')).status, 200);
        assert.deepEqual(await counters(f), [1, 0]);
    });

    test('excess historical restorations block reopening and new cancellation without a cash charge', async () => {
        const f = await fixture(); const c = f.lessons[0];
        await event(f, c, 'freeze_restored');
        const cancelled = await request(c, 'postpone');
        assert.equal(cancelled.status, 409, JSON.stringify(cancelled.body));
        assert.equal(cancelled.body.code, 'EMERGENCY_FREEZE_LEDGER_CONFLICT');
        assert.equal((await prisma.class.findUnique({ where: { id: c.id } })).status, 'scheduled');
        const approved = await approve(f, c);
        assert.equal(approved.status, 409, JSON.stringify(approved.body));
        assert.equal(approved.body.code, 'EMERGENCY_FREEZE_LEDGER_CONFLICT');
        await prisma.class.update({ where: { id: c.id }, data: { status: 'completed' } });
        assert.equal((await request(c, 'reopen')).status, 409);
        assert.deepEqual(await counters(f), [1, 0]);
        assert.equal((await prisma.student.findUnique({ where: { id: f.student.id } })).accountBalance, 50000);
        assert.equal(await prisma.membershipTransaction.count({ where: { classId: c.id } }), 1);
    });

    test('membership archived between selection and lock cannot consume an emergency right', async () => {
        const f = await fixture(); const c = f.lessons[0];
        let locked, reachedLock;
        const isLocked = new Promise(resolve => { locked = resolve; });
        const isSelected = new Promise(resolve => { reachedLock = resolve; });
        const archive = prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM "Membership" WHERE id = ${f.membership.id} FOR UPDATE`;
            await tx.membership.update({ where: { id: f.membership.id }, data: { status: 'archived' } });
            locked();
            await isSelected;
        });
        await isLocked;
        const use = prisma.$transaction(tx => {
            const db = new Proxy(tx, { get(target, key) {
                if (key !== '$queryRaw') return target[key];
                return (...args) => {
                    if (args[0].join('').includes('"Membership"')) reachedLock();
                    return target.$queryRaw(...args);
                };
            } });
            return useEmergencyFreezeForClass(f.student.id, c, admin.id, db, f.membership.id);
        });
        const [, result] = await Promise.all([archive, use]);
        assert.equal(result.frozen, false);
        assert.equal(result.reason, 'membership_not_available');
        assert.deepEqual(await counters(f), [1, 0]);
        assert.equal(await prisma.membershipTransaction.count({ where: { classId: c.id } }), 0);
    });
}
