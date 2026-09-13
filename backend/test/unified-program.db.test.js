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

    for (const [months, discountType, discountValue, expectedDiscount] of [[2, 'amount', 1001, 1001], [1, 'percent', 7.33, 1979], [2, 'percent', 7.33, 3665], [2, 'amount', 28000, 28000]]) {
        test(`additional ${discountType} ${discountValue}: concurrent approvals and out-of-order reopen preserve every KZT`, async () => {
            const person = await createUser('student', `discount-${months}-${discountValue}`);
            const scenarioTeacher = await createUser('teacher', `discount-teacher-${months}-${discountValue}`);
            const scenarioGroup = await prisma.group.create({ data: { name: `Discount group ${person.id}`, direction: direction.name, teacherId: scenarioTeacher.id } });
            const discountInput = { additionalDiscountType: discountType, additionalDiscountValue: discountValue, additionalDiscountReason: 'Согласованная локальная QA скидка' };
            const preview = await request('/memberships/price-preview?' + new URLSearchParams({ directionId: direction.id, lessonFormat: 'program', programMonths: months, ...discountInput }));
            assert.equal(preview.status, 200, JSON.stringify(preview.body));
            const membership = await buy(person.id, months, { ...discountInput, totalPrice: 1, manualFinalPrice: 1, discountPercent: 100 });
            const expectedTotal = (months === 1 ? 27000 : 50000) - expectedDiscount;
            assert.equal(membership.totalPrice, expectedTotal);
            assert.equal(preview.body.totalPrice, expectedTotal);
            assert.equal(membership.programMonths, months);
            assert.equal(membership.additionalDiscountAmount, expectedDiscount);
            assert.equal(membership.additionalDiscountReason, discountInput.additionalDiscountReason);
            assert.equal(membership.discountPercent, 0);
            assert.equal(membership.groupLessonPrice, 2250);
            assert.equal(membership.theoryLessonPrice, 1000);
            assert.equal(membership.individualBudgetTotal, (months === 1 ? 16000 : 28000) - expectedDiscount);
            assert.equal((await request('/payments', { method: 'POST', body: { studentId: person.id, amount: expectedTotal, type: 'membership_full', paymentMethod: 'cash' } })).status, 201);

            const kinds = [...Array(months * 4).fill('individual'), ...Array(months * 2).fill('theory'), ...Array(months * 4).fill('group')];
            const lessons = [];
            for (const [index, classType] of kinds.entries()) {
                lessons.push(await prisma.class.create({ data: {
                    teacherId: scenarioTeacher.id, groupId: classType === 'individual' ? null : scenarioGroup.id,
                    individualStudentId: classType === 'individual' ? person.id : null,
                    title: `Discount QA ${person.id} ${index}`, date: new Date(`2099-01-${String(index + 2).padStart(2, '0')}T00:00:00Z`),
                    startTime: '15:00', endTime: '16:00', duration: 60, classType, status: 'scheduled', price: 999,
                } }));
            }
            const billingOptions = await request(`/classes/${lessons[0].id}/billing-options?studentIds=${person.id}`);
            assert.equal(billingOptions.status, 200, JSON.stringify(billingOptions.body));
            const billingStudent = billingOptions.body.students.find(item => item.studentId === person.id);
            assert.equal(billingStudent.suggestedMembershipId, membership.id);
            assert.equal(billingStudent.suggestedAmount, preview.body.componentPrices.individual);
            assert.equal(billingStudent.memberships.find(item => item.id === membership.id).lessonPrice, preview.body.componentPrices.individual);
            const concurrent = await Promise.all(lessons.slice(0, 3).map(lesson => approve(lesson, person, membership)));
            concurrent.forEach(result => assert.equal(result.status, 200, JSON.stringify(result.body)));
            for (const lesson of lessons.slice(3)) {
                const result = await approve(lesson, person, membership);
                assert.equal(result.status, 200, JSON.stringify(result.body));
            }
            const load = () => prisma.membership.findUnique({ where: { id: membership.id } });
            const balance = async () => (await prisma.student.findUnique({ where: { id: person.id } })).accountBalance;
            assert.equal(await balance(), 0);
            let fresh = await load();
            assert.equal(fresh.individualBudgetRemaining, 0);
            assert.equal(fresh.classesRemaining, 0);
            const charges = await prisma.classAttendee.findMany({ where: { chargedMembershipId: membership.id } });
            assert.equal(charges.reduce((sum, attendee) => sum + attendee.chargeAmount, 0), expectedTotal);

            // Undo the last individual and then the first; their charges can differ by 1 KZT.
            const undoLessons = [lessons[months * 4 - 1], lessons[0]];
            let restoredMoney = 0;
            for (const lesson of undoLessons) {
                restoredMoney += charges.find(attendee => attendee.classId === lesson.id).chargeAmount;
                const reopened = await request(`/classes/${lesson.id}/reopen`, { method: 'POST', body: { reason: 'Out-of-order QA undo' } });
                assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
            }
            fresh = await load();
            assert.equal(fresh.individualBudgetRemaining, restoredMoney);
            assert.equal(fresh.individualClassesRemaining, 2);
            assert.equal(await balance(), restoredMoney);
            const reapproved = await Promise.all(undoLessons.map(lesson => approve(lesson, person, membership)));
            reapproved.forEach(result => assert.equal(result.status, 200, JSON.stringify(result.body)));
            fresh = await load();
            assert.equal(fresh.individualBudgetRemaining, 0);
            assert.equal(fresh.classesRemaining, 0);
            assert.equal(fresh.individualBudgetTotal, membership.individualBudgetTotal);
            assert.equal(await balance(), 0);
            const duplicate = await approve(lessons[0], person, membership);
            assert.equal(duplicate.status, 409);
            assert.equal(await balance(), 0);

            const extra = await request(`/memberships/${membership.id}/add-classes`, { method: 'PATCH', body: { amount: 2, lessonType: 'individual', reason: 'QA additional units' } });
            assert.equal(extra.status, 200, JSON.stringify(extra.body));
            assert.equal(extra.body.membership.individualBudgetRemaining, 2 * membership.individualLessonPrice);
            assert.equal(extra.body.membership.individualBudgetTotal, membership.individualBudgetTotal);
            assert.equal(extra.body.membership.programMonths, months);
            const removed = await request(`/memberships/${membership.id}/remove-classes`, { method: 'PATCH', body: { amount: 1, lessonType: 'individual', reason: 'QA undo extra unit' } });
            assert.equal(removed.status, 200, JSON.stringify(removed.body));
            assert.equal(removed.body.membership.individualBudgetRemaining, membership.individualLessonPrice);
            assert.equal(removed.body.membership.additionalDiscountAmount, expectedDiscount);
        });
    }

    test('HTTP purchase rejects unaudited/over-budget additional discounts and cannot discount a trial', async () => {
        const person = await createUser('student', 'invalid-discount');
        for (const payload of [
            { additionalDiscountType: 'amount', additionalDiscountValue: 1 },
            { additionalDiscountType: 'amount', additionalDiscountValue: 28001, additionalDiscountReason: 'too much' },
            { additionalDiscountType: 'percent', additionalDiscountValue: 1.234, additionalDiscountReason: 'precision' },
            { lessonFormat: 'trial', additionalDiscountType: 'amount', additionalDiscountValue: 1, additionalDiscountReason: 'trial' },
        ]) {
            const result = await request('/memberships', { method: 'POST', body: { studentId: person.id, directionId: direction.id, lessonFormat: 'program', programMonths: 2, forceNew: true, ...payload } });
            assert.equal(result.status, 400, JSON.stringify(result.body));
        }
        assert.equal(await prisma.membership.count({ where: { studentId: person.id } }), 0);
    });

    test('refund racing another lesson approval restores exact cash/budget and is idempotent', async () => {
        const { refundMembershipForClass } = require('../src/services/classMembership');
        const person = await createUser('student', 'refund-discount');
        const membership = await buy(person.id, 2, { additionalDiscountType: 'amount', additionalDiscountValue: 1001, additionalDiscountReason: 'QA refund' });
        assert.equal((await request('/payments', { method: 'POST', body: { studentId: person.id, amount: membership.totalPrice, type: 'membership_full', paymentMethod: 'cash' } })).status, 201);
        const first = await createLesson(person, 'individual', 24);
        const second = await createLesson(person, 'individual', 25);
        assert.equal((await approve(first, person, membership)).status, 200);
        const [refund, approved] = await Promise.all([
            prisma.$transaction(tx => refundMembershipForClass(person.id, first, admin.id, tx, 'QA refund concurrent')),
            approve(second, person, membership),
        ]);
        assert.equal(refund.refunded, true);
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        const charge = await prisma.classAttendee.findFirst({ where: { classId: second.id, studentId: person.id } });
        let fresh = await prisma.membership.findUnique({ where: { id: membership.id } });
        assert.equal(fresh.individualBudgetRemaining, membership.individualBudgetTotal - charge.chargeAmount);
        assert.equal(fresh.individualClassesRemaining, 7);
        assert.equal((await prisma.student.findUnique({ where: { id: person.id } })).accountBalance, membership.totalPrice - charge.chargeAmount);
        for (let repeat = 0; repeat < 2; repeat += 1) {
            await prisma.$transaction(tx => refundMembershipForClass(person.id, second, admin.id, tx, 'QA exact refund'));
        }
        fresh = await prisma.membership.findUnique({ where: { id: membership.id } });
        assert.equal(fresh.individualBudgetRemaining, membership.individualBudgetTotal);
        assert.equal(fresh.individualClassesRemaining, 8);
        assert.equal(fresh.classesRemaining, 20);
        assert.equal((await prisma.student.findUnique({ where: { id: person.id } })).accountBalance, membership.totalPrice);
    });

    test('finishing education clears remaining budget with counters; later undo refunds only the actual lesson', async () => {
        const { finishStudentEducation } = require('../src/services/studentDeparture');
        const person = await createUser('student', 'finished-discount');
        const membership = await buy(person.id, 2, { additionalDiscountType: 'amount', additionalDiscountValue: 1001, additionalDiscountReason: 'QA finish' });
        const legacy = await prisma.membership.create({ data: {
            studentId: person.id, lessonFormat: 'individual', type: 'individual_package',
            totalClasses: 4, classesRemaining: 4, startDate: new Date('2099-01-01'), endDate: new Date('2099-02-01'),
        } });
        const lesson = await createLesson(person, 'individual', 27);
        assert.equal((await approve(lesson, person, membership)).status, 200);
        const charged = await prisma.classAttendee.findFirst({ where: { classId: lesson.id, studentId: person.id } });
        await finishStudentEducation(prisma, person.id, admin.id, { reason: 'stopped' });
        let fresh = await prisma.membership.findUnique({ where: { id: membership.id } });
        assert.equal(fresh.individualBudgetRemaining, 0);
        assert.equal(fresh.individualClassesRemaining, 0);
        assert.equal(fresh.individualBudgetTotal, membership.individualBudgetTotal);
        assert.equal((await prisma.membership.findUnique({ where: { id: legacy.id } })).individualBudgetRemaining, null);

        const reopened = await request(`/classes/${lesson.id}/reopen`, { method: 'POST', body: { reason: 'QA correction after finish' } });
        assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
        fresh = await prisma.membership.findUnique({ where: { id: membership.id } });
        assert.equal(fresh.individualClassesRemaining, 1);
        assert.equal(fresh.individualBudgetRemaining, charged.chargeAmount);
        assert.equal((await prisma.student.findUnique({ where: { id: person.id } })).accountBalance, charged.chargeAmount);
        assert.equal((await approve(lesson, person, membership)).status, 200);
        fresh = await prisma.membership.findUnique({ where: { id: membership.id } });
        assert.equal(fresh.individualBudgetRemaining, 0);
        assert.equal((await prisma.student.findUnique({ where: { id: person.id } })).accountBalance, 0);
    });

    for (const undoMode of ['reopen', 'refund']) {
        test(`${undoMode} reads status under rowlock and never resurrects a concurrently deleted program`, async () => {
            const { refundMembershipForClass } = require('../src/services/classMembership');
            const person = await createUser('student', `deleted-race-${undoMode}`);
            const membership = await buy(person.id, 2, { additionalDiscountType: 'amount', additionalDiscountValue: 1001, additionalDiscountReason: 'QA deletion race' });
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
            assert.equal(fresh.individualBudgetRemaining, membership.individualBudgetTotal);
            assert.equal(fresh.individualClassesRemaining, 8);
            assert.equal((await prisma.student.findUnique({ where: { id: person.id } })).accountBalance, 0);
        });
    }
}
