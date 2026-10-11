const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.TEST_DATABASE_URL) {
    test('enrollment PostgreSQL/HTTP', { skip: 'TEST_DATABASE_URL required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && /test|qa/.test(url.pathname));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, JWT_SECRET: 'enrollment-test-only', LEARNING_PLATFORM_API_URL: 'http://127.0.0.1:9', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' });
    const express = require('express'); const jwt = require('jsonwebtoken');
    const { prisma } = require('../src/config/db');
    const { auditBalanceLedger } = require('../scripts/audit-student-balance-ledger');
    const { isMinor, today } = require('../src/services/enrollment');
    let server, base, admin, other, student;
    const person = extra => prisma.student.create({ data: { name: 'Тест', lastName: 'Оформление', dateOfBirth: new Date('1990-01-01'), phone: '77770001122', password: 'not-a-real-password', ...extra } });
    async function req(path, body, { method = body ? 'POST' : 'GET', actor = admin } = {}) {
        const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: actor.id }, process.env.JWT_SECRET)}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
        return { status: response.status, data };
    }
    const terms = { name: 'Индивидуально', direction: 'Гитара', scheduleText: 'Суббота, 14:00', days: 45, totalPrice: 24000, firstPayment: 12000,
        emergencyCancellations: 1, rates: { individual: 4000 }, durations: { individual: 45 } };
    const customer = { type: 'self', iin: '900101000001', address: 'Тестовый адрес', phone: '87770001122' };
    async function start() { const r = await req('/start', { studentId: student.id }); assert.equal(r.status, 200, JSON.stringify(r)); return r.data.enrollment; }
    async function setup() {
        let e = await start();
        let r = await req(`/${e.id}`, { revision: e.revision, customer, terms, documentDate: today() }, { method: 'PUT' }); assert.equal(r.status, 200, JSON.stringify(r));
        e = r.data.enrollment;
        const doc = await req(`/${e.id}/documents`, { revision: e.revision }); assert.equal(doc.status, 200, JSON.stringify(doc));
        for (const field of ['contractSignedAt', 'appendixSignedAt', 'consentSignedAt']) assert.equal((await req(`/${e.id}/documents/${doc.data.documentId}/status`, { field, confirmed: true })).status, 200);
        return { e, documentId: doc.data.documentId };
    }
    async function pay(e, amount = 12000) {
        const r = await req(`/${e.id}/payment-intents`, { amount, paymentMethod: 'cash', paymentDate: new Date().toISOString(), payer: 'Заказчик' });
        assert.equal(r.status, 200, JSON.stringify(r)); return r.data.intent;
    }
    test.before(async () => {
        const app = express(); app.use(express.json()); app.use('/api/enrollments', require('../src/routes/enrollments')); app.use('/api/bookings', require('../src/routes/bookings')); app.use('/api/students', require('../src/routes/students'));
        await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${server.address().port}/api/enrollments`;
    });
    test.beforeEach(async () => {
        const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
        await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(',')} CASCADE`);
        admin = await person({ role: 'super_admin' }); other = await person({ role: 'admin' }); student = await person({ role: 'student' });
    });
    test.afterEach(async () => assert.equal((await auditBalanceLedger(prisma)).consistent, true));
    test.after(async () => { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });
    test('two administrators resume one enrollment; partial steps persist; stale revision cannot overwrite', async () => {
        const results = await Promise.all([req('/start', { studentId: student.id }), req('/start', { studentId: student.id }, { actor: other })]);
        assert.equal(results[0].data.enrollment.id, results[1].data.enrollment.id);
        const e = results[0].data.enrollment;
        assert.equal((await req(`/${e.id}`, { revision: 0, customer }, { method: 'PUT' })).status, 200);
        assert.equal((await req(`/${e.id}`, { revision: 0, terms }, { method: 'PUT', actor: other })).status, 409);
        const view = (await req(`/${e.id}`)).data.enrollment;
        assert.equal(view.customer.fullName, 'Оформление Тест'); assert.equal(view.terms, null);
        assert.equal((await req('/')).data.enrollments.length, 1);
    });
    test('shared draft credits ledger and cash once after concurrent retries by different admins', async () => {
        const e = await start(); const intent = await pay(e);
        const second = await pay(e, 999); assert.equal(second.id, intent.id); assert.equal(second.payload.amount, 12000);
        const confirmed = await Promise.all([req(`/${e.id}/payment-intents/${intent.id}/confirm`, {}), req(`/${e.id}/payment-intents/${intent.id}/confirm`, {}, { actor: other })]);
        assert.ok(confirmed.every(r => r.status === 200), JSON.stringify(confirmed)); assert.equal(confirmed[0].data.paymentId, confirmed[1].data.paymentId);
        assert.equal(await prisma.payment.count(), 1); assert.equal(await prisma.cashTransaction.count(), 1);
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).accountBalance, 12000);
        assert.equal((await req(`/${e.id}/activate`, {})).status, 400);
        assert.equal((await req(`/${e.id}/payment-intents/${intent.id}/cancel`, {})).status, 409);
        assert.equal((await req(`/${e.id}/access/student`, { password: 'student-password' })).status, 502);
        assert.equal((await req(`/${e.id}`)).data.enrollment.paidAmount, 12000);
    });
    test('print snapshots stay immutable and printing does not imply signing', async () => {
        const e = await start();
        const saved = await req(`/${e.id}`, { revision: 0, customer, terms }, { method: 'PUT' });
        const revision = saved.data.enrollment.revision;
        const prepared = await req(`/${e.id}/documents`, { revision }); const id = prepared.data.documentId;
        assert.equal((await req(`/${e.id}/documents`, { revision })).data.documentId, id);
        const printed = await req(`/${e.id}/documents/${id}`); assert.equal(printed.status, 200);
        assert.ok(printed.data.includes('900101000001')); assert.ok(printed.data.includes('Марата Оспанова'));
        assert.ok(printed.data.includes('Срок использования: 45'));
        assert.equal((await prisma.enrollmentDocument.findUnique({ where: { id } })).contractSignedAt, null);
        await prisma.student.update({ where: { id: student.id }, data: { name: 'Другое имя' } });
        assert.equal((await req(`/${e.id}/documents/${id}`)).data, printed.data);
        await assert.rejects(prisma.enrollmentDocument.update({ where: { id }, data: { html: 'tampered' } }), /immutable/);
        assert.equal((await req(`/${e.id}/documents/${id}/status`, { field: 'contractSignedAt' })).status, 409);
    });
    test('paid first period activates once; later deposits do not shift the agreed dates', async () => {
        const { e } = await setup(); const intent = await pay(e);
        await req(`/${e.id}/payment-intents/${intent.id}/confirm`, {});
        assert.equal((await req(`/${e.id}/activate`, {})).status, 200);
        assert.equal((await req(`/${e.id}/activate`, {})).status, 200);
        const view = (await req(`/${e.id}`)).data.enrollment;
        assert.equal(await prisma.membership.count(), 1);
        assert.equal((new Date(view.membership.validUntil) - new Date(view.membership.validFrom)) / 86400000, 45);
        await prisma.enrollment.update({ where: { id: e.id }, data: { completedAt: new Date() } });
        assert.equal((await req('/')).data.enrollments.length, 1, 'installment stays in admin queue after completing setup');
        const extra = await pay(e, 12000); await req(`/${e.id}/payment-intents/${extra.id}/confirm`, {});
        const after = (await req(`/${e.id}`)).data.enrollment;
        assert.equal(after.remainingAmount, 0); assert.equal((await req('/')).data.enrollments.length, 0); assert.ok(after.completedAt); assert.equal(after.membership.validUntil, view.membership.validUntil);
        assert.equal((await req(`/${e.id}`, { revision: view.revision, terms }, { method: 'PUT' })).status, 409);
        assert.equal(after.complete, false); assert.equal(after.nextLesson, null);
    });
    test('child needs representative; teacher and revoked admin actions cannot bypass permissions', async () => {
        await prisma.student.update({ where: { id: student.id }, data: { dateOfBirth: new Date('2015-01-01') } });
        const e = await start();
        assert.equal((await req(`/${e.id}`, { revision: 0, customer }, { method: 'PUT' })).status, 400);
        assert.equal((await req(`/${e.id}`, { revision: 0, customer: { ...customer, type: 'representative', fullName: 'Родитель Тест', relationship: 'mother', representation: 'Родитель' } }, { method: 'PUT' })).status, 200);
        const teacher = await person({ role: 'teacher' }); assert.equal((await req(`/${e.id}`, undefined, { actor: teacher })).status, 403);
        await prisma.rolePermissions.create({ data: { role: 'admin', permissions: { canManagePayments: false, canCreateUsers: false }, visibility: {} } });
        assert.equal((await req(`/${e.id}/payment-intents`, {}, { actor: other })).status, 403);
        assert.equal((await req(`/${e.id}/access/parent`, {}, { actor: other })).status, 403);
    });
    test('concurrent booking conversion creates one student and enrollment; retries do not reset access', async () => {
        const booking = await prisma.booking.create({ data: { name: 'Новый', lastName: 'Ученик', phone: '77779998811', direction: 'Гитара', dateOfBirth: new Date('2014-01-01') } });
        const convert = async actor => {
            const response = await fetch(base.replace('/enrollments', `/bookings/${booking.id}/convert`), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: actor.id }, process.env.JWT_SECRET)}` }, body: JSON.stringify({ password: 'conversion-password' }) });
            return { status: response.status, data: await response.json() };
        };
        const [a, b] = await Promise.all([convert(admin), convert(other)]);
        assert.equal(a.status, 200, JSON.stringify(a)); assert.equal(b.status, 200, JSON.stringify(b));
        assert.equal(a.data.student.id, b.data.student.id); assert.equal(await prisma.enrollment.count(), 1);
        assert.equal((await convert(admin)).data.alreadyConverted, true);
        assert.equal(await prisma.student.count({ where: { phone: booking.phone } }), 1);
    });
    test('first-lesson readiness checks actual calendar, teacher, duration, dates and current tariff', async () => {
        const { e } = await setup(); const intent = await pay(e); await req(`/${e.id}/payment-intents/${intent.id}/confirm`, {}); await req(`/${e.id}/activate`, {});
        const teacher = await person({ role: 'teacher' });
        const tomorrow = new Date(`${today()}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const lesson = await prisma.class.create({ data: { title: 'Первый урок', classType: 'individual', individualStudentId: student.id, date: tomorrow, startTime: '14:00', endTime: '14:45', duration: 45, teacherId: teacher.id } });
        await prisma.class.create({ data: { title: 'Репетиция', classType: 'individual', isPractice: true, individualStudentId: student.id,
            date: tomorrow, startTime: '12:00', endTime: '12:45', duration: 45, teacherId: teacher.id } });
        assert.equal((await req(`/${e.id}`)).data.enrollment.nextLesson.id, lesson.id, 'practice does not replace the first teaching lesson');
        assert.equal((await req(`/${e.id}`)).data.enrollment.readyForLesson, true);
        const membershipId = (await req(`/${e.id}`)).data.enrollment.membership.id;
        await prisma.membership.update({ where: { id: membershipId }, data: { lessonRates: { individual: { price: 6000 } } } });
        assert.equal((await req(`/${e.id}`)).data.enrollment.readyForLesson, false, 'rates must still match signed terms');
        await prisma.class.update({ where: { id: lesson.id }, data: { duration: 90 } });
        assert.equal((await req(`/${e.id}`)).data.enrollment.readyForLesson, false);
        assert.equal((await req(`/${e.id}/complete`, {})).status, 502);
    });
    test('a lost provision response can repair the exact student link without changing a password', async () => {
        const e = await start(); const original = await prisma.student.findUnique({ where: { id: student.id } });
        const mock = express(); mock.get('/api/integration/v1/family/:id', (_req, res) => res.json({ data: { student: { id: 'qa-platform-student', isActive: true }, parents: [] } }));
        const lp = await new Promise(resolve => { const srv = mock.listen(0, '127.0.0.1', () => resolve(srv)); });
        const oldUrl = process.env.LEARNING_PLATFORM_API_URL; process.env.LEARNING_PLATFORM_API_URL = `http://127.0.0.1:${lp.address().port}`;
        try {
            assert.equal((await req(`/${e.id}/access/student-link`, {})).status, 200);
            const linked = await prisma.student.findUnique({ where: { id: student.id } });
            assert.equal(linked.appUserId, 'qa-platform-student'); assert.equal(linked.password, original.password);
            await prisma.student.update({ where: { id: student.id }, data: { appUserId: 'different-student' } });
            assert.equal((await req(`/${e.id}/access/student-link`, {})).status, 409);
        } finally { process.env.LEARNING_PLATFORM_API_URL = oldUrl; await new Promise(resolve => lp.close(resolve)); }
    });
    test('age boundary follows Aktobe calendar date', () => {
        assert.equal(isMinor('2008-10-12', new Date('2026-10-11T19:01:00Z')), false);
        assert.equal(isMinor('2008-10-12', new Date('2026-10-11T18:59:00Z')), true);
    });
}
