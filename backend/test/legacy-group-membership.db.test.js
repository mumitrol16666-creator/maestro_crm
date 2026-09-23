const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// Воспроизводит инцидент с дуо-абонементом: карточка показывала 2 750 за урок,
// а подтверждение урока списывало константу 1 200. Старые однородные
// абонементы сначала переносятся на явные расценки, сохраняя цену покупки.
if (!process.env.TEST_DATABASE_URL) {
    test('legacy group membership PostgreSQL HTTP suite', { skip: 'TEST_DATABASE_URL не задан' }, () => {});
} else {
    const database = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
        && /(?:test|qa)/i.test(database.pathname), 'Use a dedicated local QA/test database');
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'legacy-group-local-qa-secret';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.TELEGRAM_BOT_TOKEN = '';
    process.env.TELEGRAM_CHAT_ID = '';
    process.env.LEARNING_PLATFORM_API_URL = 'http://127.0.0.1:9';
    process.env.INTEGRATION_SERVICE_SECRET = '';

    const jwt = require('jsonwebtoken');
    const app = require('../src/server');
    const { prisma } = require('../src/config/db');
    const { legacyRates } = require('../src/services/rateCardMigration');
    const suffix = randomUUID();
    let admin;
    let teacher;
    let direction;
    let group;
    let baseUrl;
    let lessonDay = 2;

    async function createUser(role, label) {
        return prisma.student.create({ data: {
            name: 'Legacy QA', lastName: `${label}-${suffix}`,
            phone: `qa-legacy-${label}-${suffix}`, password: 'local-test-only', role,
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

    // Абонемент, купленный до релиза 13.09: снапшотов цен нет, есть только покупка.
    async function createLegacyMembership(student, { type, totalPrice, totalClasses, lessonPrice = 0, basePrice = totalPrice, discountPercent = 0 }) {
        return prisma.membership.create({ data: {
            studentId: student.id, groupId: group.id, directionId: direction.id,
            lessonFormat: 'group', type, status: 'active',
            totalClasses, classesRemaining: totalClasses,
            totalPrice, basePrice, lessonPrice, discountPercent,
            startDate: new Date('2099-01-01'), endDate: new Date('2099-03-01'),
        } });
    }

    async function pay(student, amount) {
        const response = await request('/payments', { method: 'POST', body: {
            studentId: student.id, amount, type: 'membership_full', paymentMethod: 'cash',
        } });
        assert.equal(response.status, 201, JSON.stringify(response.body));
    }

    async function createLesson(classType, price = 0) {
        const day = lessonDay++;
        return prisma.class.create({ data: {
            teacherId: teacher.id, groupId: group.id,
            title: `Legacy QA ${classType} ${day} ${suffix}`,
            date: new Date(`2099-01-${String(day).padStart(2, '0')}T00:00:00Z`),
            startTime: '12:00', endTime: '12:45', duration: 45,
            status: 'scheduled', classType, price,
        } });
    }

    async function activate(student, old, explicitRates) {
        const response = await request('/memberships/rate-card', { method: 'POST', body: {
            studentId: student.id, name: 'Перенос старой цены', expectedActiveIds: [old.id],
            lessonRates: explicitRates || legacyRates(old),
        } });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal((await prisma.membership.findUnique({ where: { id: old.id } })).totalPrice, old.totalPrice);
        return response.body.membership;
    }

    async function approve(lesson, student, membership) {
        return request(`/classes/${lesson.id}/approve`, { method: 'POST', body: {
            topic: 'Учебная проверка', lessonSummary: 'Проверка списания старого абонемента',
            billingDecisions: [{ studentId: student.id, membershipId: membership.id, attendanceStatus: 'present',
                amount: membership.lessonRates?.[lesson.classType === 'theory' ? 'theory' : (Object.hasOwn(membership.lessonRates || {}, 'duo') ? 'duo' : 'quartet')]?.price ?? 999 }],
        } });
    }

    const balance = async student => (await prisma.student.findUnique({ where: { id: student.id } })).accountBalance;

    test.before(async () => {
        await prisma.$connect();
        admin = await createUser('super_admin', 'admin');
        teacher = await createUser('teacher', 'teacher');
        direction = await prisma.direction.create({ data: {
            name: `Legacy QA ${suffix}`, description: 'Local QA fixture', minAge: 7, level: 'beginner',
            trialLessonPrice: 2000, individualLessonPrice: 4000, theoryLessonPrice: 1000, groupLessonPrice: 2250,
        } });
        group = await prisma.group.create({ data: { name: `Legacy QA group ${suffix}`, direction: direction.name, teacherId: teacher.id, billingType: 'duo' } });
        await new Promise(resolve => app.httpServer.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${app.httpServer.address().port}/api`;
    });

    test.after(async () => {
        if (app.httpServer.listening) await new Promise(resolve => app.httpServer.close(resolve));
        await prisma.$disconnect();
    });

    test('legacy duo membership: billing options and approval both use 2 750 per lesson, theory stays 1 000', async () => {
        const student = await createUser('student', 'duo');
        const old = await createLegacyMembership(student, { type: 'duet', totalPrice: 22000, totalClasses: 8, lessonPrice: 2750 });
        const membership = await activate(student, old, { ...legacyRates(old), theory: 1000 });
        await pay(student, 22000);

        // Явная цена занятия 999 не должна перебивать цену абонемента.
        const lesson = await createLesson('group', 999);
        const options = await request(`/classes/${lesson.id}/billing-options?studentIds=${student.id}`);
        assert.equal(options.status, 200, JSON.stringify(options.body));
        const optionsStudent = options.body.students.find(item => item.studentId === student.id);
        assert.equal(optionsStudent.memberships.find(item => item.id === membership.id).lessonPrice, 2750);

        const approved = await approve(lesson, student, membership);
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        assert.equal(await balance(student), 22000 - 2750);
        const attendee = await prisma.classAttendee.findFirst({ where: { classId: lesson.id, studentId: student.id } });
        assert.equal(attendee.chargeAmount, 2750);

        const theory = await createLesson('theory');
        assert.equal((await approve(theory, student, membership)).status, 200);
        assert.equal(await balance(student), 22000 - 2750 - 1000);

        // Повторное подтверждение того же урока не списывает второй раз.
        const again = await approve(lesson, student, membership);
        assert.ok([200, 400, 409].includes(again.status), JSON.stringify(again.body));
        assert.equal(await balance(student), 22000 - 2750 - 1000);
    });

    test('ambiguous legacy group cannot charge until its purpose and rate are explicitly assigned', async () => {
        const student = await createUser('student', 'mini');
        const old = await createLegacyMembership(student, { type: 'group_mini', totalPrice: 16000, totalClasses: 8 });
        await pay(student, 16000);
        const lesson = await createLesson('group');
        assert.equal((await approve(lesson, student, old)).status, 400);
        assert.equal(await balance(student), 16000);
        await prisma.group.update({ where: { id: group.id }, data: { billingType: 'quartet' } });
        const membership = await activate(student, old, { quartet: 2000 });
        assert.equal((await approve(lesson, student, membership)).status, 200);
        assert.equal(await balance(student), 16000 - 2000);
    });

    test('discounted legacy duo charges the discounted purchase price once, not twice', async () => {
        const student = await createUser('student', 'duo-discount');
        const old = await createLegacyMembership(student, { type: 'duet', totalPrice: 18000, basePrice: 22000, totalClasses: 8, discountPercent: 18 });
        await prisma.group.update({ where: { id: group.id }, data: { billingType: 'duo' } });
        const membership = await activate(student, old);
        await pay(student, 18000);
        const lesson = await createLesson('group');
        assert.equal((await approve(lesson, student, membership)).status, 200);
        assert.equal(await balance(student), 18000 - 2250);
    });
}
