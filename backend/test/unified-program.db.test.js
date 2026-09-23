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
        const active = await prisma.membership.findMany({ where: { studentId, status: 'active' } });
        const response = await request('/memberships/rate-card', { method: 'POST', body: {
            studentId, name: months === 1 ? '27 000' : '50 000', expectedActiveIds: active.map(m => m.id),
            lessonRates: { individual: months === 1 ? 4000 : 3500, quartet: 2250, theory: 1000, ...extra },
        } });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        return response.body.membership;
    }

    async function pay(person, amount) {
        const response = await request('/payments', { method: 'POST', body: {
            studentId: person.id, amount, type: 'membership_full', paymentMethod: 'cash',
        } });
        assert.equal(response.status, 201, JSON.stringify(response.body));
    }
    const balance = async person => (await prisma.student.findUnique({ where: { id: person.id } })).accountBalance;
    let lessonNumber = 0;

    async function createLesson(student, classType, day) {
        return prisma.class.create({ data: {
            teacherId: teacher.id,
            individualStudentId: classType === 'individual' ? student.id : null,
            groupId: classType === 'individual' ? null : group.id,
            title: `Unified QA ${classType} ${day} ${suffix}`,
            date: new Date(Date.UTC(2099, 0, ++lessonNumber)),
            startTime: '12:00', endTime: '13:00', duration: 60,
            status: 'scheduled', classType, price: 999,
        } });
    }

    async function approve(lesson, student, membership) {
        return request(`/classes/${lesson.id}/approve`, { method: 'POST', body: {
            topic: 'Учебная проверка', lessonSummary: 'Проверка расчётов на локальной QA базе',
            billingDecisions: [{ studentId: student.id, membershipId: membership.id, attendanceStatus: 'present', amount: membership.lessonRates[lesson.classType === 'group' ? 'quartet' : lesson.classType].price }],
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
        group = await prisma.group.create({ data: { name: `Unified QA group ${suffix}`, direction: direction.name, teacherId: teacher.id, billingType: 'quartet' } });
        await new Promise(resolve => app.httpServer.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${app.httpServer.address().port}/api`;
    });

    test.after(async () => {
        if (app.httpServer.listening) await new Promise(resolve => app.httpServer.close(resolve));
        await prisma.$disconnect();
    });


    test('replacing 27k with 50k preserves the old rate snapshot and rejects obsolete purchase APIs', async () => {
        const person = await createUser('student', 'replace');
        const first = await buy(person.id, 1);
        const next = await buy(person.id, 2);
        assert.notEqual(next.id, first.id);
        assert.equal(next.previousMembershipId, first.id);
        assert.equal(next.lessonRates.individual.price, 3500);
        const archived = await prisma.membership.findUnique({ where: { id: first.id } });
        assert.equal(archived.status, 'archived');
        assert.equal(archived.lessonRates.individual.price, 4000);
        assert.equal(await balance(person), 0);
        for (const lessonFormat of ['program', 'individual']) {
            const result = await request('/memberships', { method: 'POST', body: {
                studentId: person.id, directionId: direction.id, lessonFormat, programMonths: 2, renewMembershipId: first.id,
            } });
            assert.equal(result.status, 400);
        }
        assert.equal(await prisma.membership.count({ where: { studentId: person.id } }), 2);
    });

    test('20 HTTP approvals total exactly 50k; next lesson is allowed and creates debt without changing counters', async () => {
        const person = await createUser('student', 'billing');
        const membership = await buy(person.id, 2);
        await pay(person, 50000);
        let last;
        for (const classType of [...Array(8).fill('individual'), ...Array(4).fill('theory'), ...Array(8).fill('group')]) {
            last = await createLesson(person, classType);
            const result = await approve(last, person, membership);
            assert.equal(result.status, 200, JSON.stringify(result.body));
        }
        assert.equal(await balance(person), 0);
        assert.equal((await approve(last, person, membership)).status, 409);
        const fresh = await prisma.membership.findUnique({ where: { id: membership.id } });
        assert.deepEqual([fresh.classesRemaining, fresh.classesUsed, fresh.totalClasses], [0, 0, 0]);
        const extra = await createLesson(person, 'group');
        assert.equal((await approve(extra, person, membership)).status, 200);
        assert.equal(await balance(person), -2250);
        assert.equal((await request('/classes/' + extra.id + '/reopen', { method: 'POST', body: { reason: 'QA' } })).status, 200);
        assert.equal(await balance(person), 0);
    });

    for (const discount of [
        { discountAmount: 125 }, { discountPercent: 7.33 }, { discountAmount: 3500 }, { discountPercent: 100 },
    ]) {
        test('per-lesson discount ' + JSON.stringify(discount) + ' survives concurrent approvals and out-of-order refunds', async () => {
            const person = await createUser('student', 'discount-' + randomUUID());
            const rate = { basePrice: 3500, ...discount, reason: 'QA индивидуальная скидка' };
            const preview = await request('/memberships/rate-card-preview', { method: 'POST', body: {
                lessonRates: { individual: rate, quartet: 2250, theory: 1000 },
            } });
            assert.equal(preview.status, 200, JSON.stringify(preview.body));
            const membership = await buy(person.id, 2, { individual: rate });
            const price = preview.body.lessonRates.individual.price;
            assert.equal(membership.lessonRates.individual.price, price);
            const total = 8 * price + 8 * 2250 + 4 * 1000;
            await pay(person, total);
            const lessons = [];
            for (const kind of [...Array(8).fill('individual'), ...Array(4).fill('theory'), ...Array(8).fill('group')]) lessons.push(await createLesson(person, kind));
            const options = await request('/classes/' + lessons[0].id + '/billing-options?studentIds=' + person.id);
            assert.equal(options.body.students[0].suggestedAmount, price);
            const first = await Promise.all(lessons.slice(0, 3).map(lesson => approve(lesson, person, membership)));
            first.forEach(result => assert.equal(result.status, 200, JSON.stringify(result.body)));
            for (const lesson of lessons.slice(3)) assert.equal((await approve(lesson, person, membership)).status, 200);
            assert.equal(await balance(person), 0);
            for (const index of [6, 0, 4]) {
                assert.equal((await request('/classes/' + lessons[index].id + '/reopen', { method: 'POST', body: { reason: 'QA порядок возвратов' } })).status, 200);
            }
            assert.equal(await balance(person), 3 * price);
            for (const index of [4, 0, 6]) assert.equal((await approve(lessons[index], person, membership)).status, 200);
            assert.equal(await balance(person), 0);
        });
    }

    test('refund racing another approval restores exact cash and repeated refunds are idempotent', async () => {
        const { refundMembershipForClass } = require('../src/services/classMembership');
        const person = await createUser('student', 'refund');
        const membership = await buy(person.id, 2, { individual: { basePrice: 3500, discountAmount: 125, reason: 'QA' } });
        await pay(person, 50000);
        const a = await createLesson(person, 'individual');
        const b = await createLesson(person, 'individual');
        assert.equal((await approve(a, person, membership)).status, 200);
        const [refund, approval] = await Promise.all([
            refundMembershipForClass(person.id, a, admin.id, null, 'QA параллельный возврат'),
            approve(b, person, membership),
        ]);
        assert.equal(refund.refunded, true);
        assert.equal(approval.status, 200, JSON.stringify(approval.body));
        assert.equal(await balance(person), 50000 - 3375);
        for (let i = 0; i < 2; i++) await refundMembershipForClass(person.id, b, admin.id, null, 'QA повтор');
        assert.equal(await balance(person), 50000);
        const fresh = await prisma.membership.findUnique({ where: { id: membership.id } });
        assert.equal(fresh.classesRemaining, 0);
        assert.equal(fresh.individualBudgetRemaining, null);
    });

    test('finishing education disables the rate card; historical refund does not reactivate it', async () => {
        const { finishStudentEducation } = require('../src/services/studentDeparture');
        const person = await createUser('student', 'finished');
        const membership = await buy(person.id, 2);
        const lesson = await createLesson(person, 'individual');
        assert.equal((await approve(lesson, person, membership)).status, 200);
        await finishStudentEducation(prisma, person.id, admin.id, { reason: 'stopped' });
        const before = await balance(person);
        const reopened = await request('/classes/' + lesson.id + '/reopen', { method: 'POST', body: { reason: 'QA после завершения' } });
        assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
        assert.equal(await balance(person), before + 3500);
        assert.equal((await prisma.membership.findUnique({ where: { id: membership.id } })).status, 'expired');
        assert.equal((await approve(lesson, person, membership)).status, 400);
    });

    for (const undoMode of ['reopen', 'refund']) {
        test(`${undoMode} reads status under rowlock and never resurrects a concurrently deleted rate card`, async () => {
            const { refundMembershipForClass } = require('../src/services/classMembership');
            const person = await createUser('student', `deleted-race-${undoMode}`);
            const membership = await buy(person.id, 2);
            const lesson = await createLesson(person, 'individual', 26);
            assert.equal((await approve(lesson, person, membership)).status, 200);
            await prisma.membership.update({ where: { id: membership.id }, data: { status: 'expired' } });

            let releaseDelete;
            let signalLocked;
            const deleteGate = new Promise(resolve => { releaseDelete = resolve; });
            const locked = new Promise(resolve => { signalLocked = resolve; });
            const deletion = prisma.$transaction(async tx => {
                await tx.membership.update({ where: { id: membership.id }, data: { status: 'deleted' } });
                signalLocked();
                await deleteGate;
            }, { timeout: 10000 });
            await locked;
            const undo = undoMode === 'reopen'
                ? request(`/classes/${lesson.id}/reopen`, { method: 'POST', body: { reason: 'QA deletion race' } })
                : refundMembershipForClass(person.id, lesson, admin.id, null, 'QA deletion race');
            try {
                // Wait for the real SELECT FOR UPDATE to block behind deletion.
                // At this point the old include snapshot still says "expired".
                const deadline = Date.now() + 4000;
                let observedWait = false;
                while (Date.now() < deadline) {
                    const waiters = await prisma.$queryRaw`SELECT pid FROM pg_stat_activity
                        WHERE datname = current_database() AND wait_event_type = 'Lock'
                            AND query LIKE '%Membership%' AND query LIKE '%FOR UPDATE%'`;
                    if (waiters.length > 0) { observedWait = true; break; }
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                assert.equal(observedWait, true, 'Undo must wait on the concurrently deleted membership row');
            } finally {
                releaseDelete();
                await deletion;
            }
            const result = await undo;
            if (undoMode === 'reopen') assert.equal(result.status, 200, JSON.stringify(result.body));
            else assert.equal(result.refunded, true);
            const fresh = await prisma.membership.findUnique({ where: { id: membership.id } });
            assert.equal(fresh.status, 'deleted');
            assert.equal(fresh.individualBudgetRemaining, null);
            assert.equal(fresh.classesRemaining, 0);
            assert.equal((await prisma.student.findUnique({ where: { id: person.id } })).accountBalance, 0);
        });
    }
}
