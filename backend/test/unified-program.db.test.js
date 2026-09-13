const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('unified program PostgreSQL HTTP suite', { skip: 'TEST_DATABASE_URL не задан' }, () => {});
} else {
    const database = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
        && /(?:test|qa)/i.test(database.pathname), 'Use a dedicated local QA/test database');
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'unified-program-local-qa-secret';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.TELEGRAM_BOT_TOKEN = '';
    process.env.TELEGRAM_CHAT_ID = '';
    process.env.LEARNING_PLATFORM_API_URL = 'http://127.0.0.1:9';
    process.env.INTEGRATION_SERVICE_SECRET = '';

    const jwt = require('jsonwebtoken');
    const app = require('../src/server');
    const { prisma } = require('../src/config/db');
    const suffix = randomUUID();
    let admin;
    let teacher;
    let direction;
    let group;
    let baseUrl;

    async function createUser(role, label) {
        return prisma.student.create({ data: {
            name: 'Unified QA', lastName: `${label}-${suffix}`,
            phone: `qa-${label}-${suffix}`, password: 'local-test-only', role,
            learningDirections: [], teacherDirections: [],
        } });
    }

    async function request(path, { method = 'GET', body } = {}) {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '10m' })}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': randomUUID(),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
    }

    async function buy(studentId, months, extra = {}) {
        const response = await request('/memberships', { method: 'POST', body: {
            studentId, directionId: direction.id, lessonFormat: 'program', programMonths: months,
            startDate: '2099-01-01', forceNew: true, ...extra,
        } });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        return response.body.membership;
    }

    async function createLesson(student, classType, day) {
        return prisma.class.create({ data: {
            teacherId: teacher.id,
            individualStudentId: classType === 'individual' ? student.id : null,
            groupId: classType === 'individual' ? null : group.id,
            title: `Unified QA ${classType} ${day} ${suffix}`,
            date: new Date(`2099-01-${String(day).padStart(2, '0')}T00:00:00Z`),
            startTime: '12:00', endTime: '13:00', duration: 60,
            status: 'scheduled', classType, price: 999,
        } });
    }

    async function approve(lesson, student, membership) {
        return request(`/classes/${lesson.id}/approve`, { method: 'POST', body: {
            topic: 'Учебная проверка', lessonSummary: 'Проверка расчётов на локальной QA базе',
            billingDecisions: [{ studentId: student.id, membershipId: membership.id, attendanceStatus: 'present', amount: 999 }],
        } });
    }

    test.before(async () => {
        await prisma.$connect();
        admin = await createUser('super_admin', 'admin');
        teacher = await createUser('teacher', 'teacher');
        direction = await prisma.direction.create({ data: {
            name: `Unified QA ${suffix}`, description: 'Local QA fixture', minAge: 7, level: 'beginner',
            trialLessonPrice: 2000, individualLessonPrice: 4000, theoryLessonPrice: 1000, groupLessonPrice: 2250,
        } });
        group = await prisma.group.create({ data: { name: `Unified QA group ${suffix}`, direction: direction.name, teacherId: teacher.id } });
        await new Promise(resolve => app.httpServer.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${app.httpServer.address().port}/api`;
    });

    test.after(async () => {
        if (app.httpServer.listening) await new Promise(resolve => app.httpServer.close(resolve));
        await prisma.$disconnect();
    });

    test('HTTP purchase 27k and explicit renewal 50k keep original PostgreSQL snapshots intact', async () => {
        const student = await createUser('student', 'renewal');
        const first = await buy(student.id, 1, { startDate: '2099-09-01' });
        assert.equal(first.totalPrice, 27000);
        assert.equal(first.totalClasses, 10);
        assert.deepEqual([first.individualClassesRemaining, first.theoryClassesRemaining, first.groupClassesRemaining], [4, 2, 4]);
        assert.equal(first.individualLessonPrice, 4000);
        const before = await prisma.membership.findUnique({ where: { id: first.id } });
        const next = await buy(student.id, 2, {
            forceNew: false, renewMembershipId: first.id,
            startDate: '2026-09-01', endDate: '2026-09-02', manualFinalPrice: 1,
        });
        assert.notEqual(next.id, first.id);
        assert.equal(next.previousMembershipId, first.id);
        assert.equal(next.totalPrice, 50000);
        assert.equal(next.individualLessonPrice, 3500);
        assert.equal(next.startDate, first.endDate);
        assert.equal((new Date(next.endDate) - new Date(next.startDate)) / 86400000, 60);
        assert.deepEqual(await prisma.membership.findUnique({ where: { id: first.id } }), before);
        const duplicate = await request('/memberships', { method: 'POST', body: {
            studentId: student.id, directionId: direction.id, lessonFormat: 'program', programMonths: 2,
            renewMembershipId: first.id, forceNew: false,
        } });
        assert.equal(duplicate.status, 400);
        assert.equal(await prisma.membership.count({ where: { studentId: student.id } }), 2);
    });

    test('20 actual HTTP approvals charge exactly 50k; counters, duplicate approval and reopen reconcile', async () => {
        const student = await createUser('student', 'billing');
        const membership = await buy(student.id, 2);
        assert.deepEqual([membership.individualClassesRemaining, membership.theoryClassesRemaining, membership.groupClassesRemaining], [8, 4, 8]);
        const payment = await request('/payments', { method: 'POST', body: {
            studentId: student.id, amount: 50000, type: 'membership_full', paymentMethod: 'cash',
        } });
        assert.equal(payment.status, 201, JSON.stringify(payment.body));
        const lessonTypes = [...Array(8).fill('individual'), ...Array(4).fill('theory'), ...Array(8).fill('group')];
        const charges = { individual: 3500, theory: 1000, group: 2250 };
        let sum = 0;
        let last;
        for (const [index, classType] of lessonTypes.entries()) {
            const lesson = await createLesson(student, classType, index + 2);
            const result = await approve(lesson, student, membership);
            assert.equal(result.status, 200, JSON.stringify(result.body));
            const attendee = await prisma.classAttendee.findFirst({ where: { classId: lesson.id, studentId: student.id } });
            assert.equal(attendee.chargeAmount, charges[classType]);
            assert.equal(attendee.chargedMembershipId, membership.id);
            assert.equal(attendee.autoDeducted, true);
            sum += attendee.chargeAmount;
            const freshStudent = await prisma.student.findUnique({ where: { id: student.id } });
            assert.equal(freshStudent.accountBalance, 50000 - sum);
            last = lesson;
        }
        assert.equal(sum, 50000);
        let remaining = await prisma.membership.findUnique({ where: { id: membership.id } });
        assert.deepEqual([remaining.classesRemaining, remaining.classesUsed, remaining.individualClassesRemaining,
            remaining.theoryClassesRemaining, remaining.groupClassesRemaining], [0, 20, 0, 0, 0]);

        const repeated = await approve(last, student, membership);
        assert.equal(repeated.status, 409);
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).accountBalance, 0);
        const extraLesson = await createLesson(student, 'group', 22);
        const exhausted = await approve(extraLesson, student, membership);
        assert.equal(exhausted.status, 400);
        assert.equal(await prisma.classAttendee.count({ where: { classId: extraLesson.id } }), 0);

        const reopened = await request(`/classes/${last.id}/reopen`, { method: 'POST', body: { reason: 'Локальная QA проверка отката' } });
        assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).accountBalance, 2250);
        remaining = await prisma.membership.findUnique({ where: { id: membership.id } });
        assert.deepEqual([remaining.classesRemaining, remaining.classesUsed, remaining.groupClassesRemaining], [1, 19, 1]);
        assert.equal((await approve(last, student, membership)).status, 200);
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).accountBalance, 0);
        remaining = await prisma.membership.findUnique({ where: { id: membership.id } });
        assert.deepEqual([remaining.classesRemaining, remaining.classesUsed, remaining.groupClassesRemaining], [0, 20, 0]);
    });
}
