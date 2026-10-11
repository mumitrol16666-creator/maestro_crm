const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.TEST_DATABASE_URL) {
    test('manual subscription periods PostgreSQL/HTTP', { skip: 'TEST_DATABASE_URL required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && /test|qa/.test(url.pathname));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, JWT_SECRET: 'periods-test-only', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' });
    const express = require('express'), jwt = require('jsonwebtoken');
    const { prisma } = require('../src/config/db');
    const service = require('../src/services/subscriptionPeriods');
    const enrollmentService = require('../src/services/enrollment');
    const { normalizeRates, rateCardMembershipData } = require('../src/services/rateCards');
    const { recordReceivedPayment } = require('../src/services/receivedPayment');
    const { recordBalanceMovement } = require('../src/services/studentBalanceLedger');
    const { auditBalanceLedger } = require('../scripts/audit-student-balance-ledger');
    const { restoreExpiredStudentPauses } = require('../src/services/studentPause');
    let server, base, admin, other, student, source, enrollment;
    const terms = { name: 'Индивидуально', direction: 'Гитара', scheduleText: 'Суббота 14:00', days: 45, totalPrice: 24000,
        firstPayment: 12000, emergencyCancellations: 1, rates: normalizeRates({ individual: 4000 }), durations: { individual: 45 }, additionalTerms: '', renewalKind: 'ordinary' };
    const person = extra => prisma.student.create({ data: { name: 'Тест', lastName: 'Продление', dateOfBirth: new Date('1990-01-01'), phone: '77770001122', password: 'not-a-real-password', ...extra } });
    async function req(path, body, actor = admin) {
        const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${jwt.sign({ id: actor.id }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: r.status, data: await r.json() };
    }
    const received = amount => ({ amount, paymentMethod: 'cash', paymentDate: new Date().toISOString(), payer: 'Заказчик', notes: '' });
    const proposal = (extra = {}) => ({ terms, creditAmount: 4000, creditReason: '24000 получено минус 5 уроков по 4000', documentBasis: { mode: 'same', reference: 'Договор тест-1, приложение 1' }, confirmed: true, payment: received(8000), ...extra });
    async function payment(amount, membershipId) {
        return prisma.$transaction(async db => {
            const p = await recordReceivedPayment(db, { studentId: student.id, parsedAmount: amount, normalizedType: 'membership_full', actorId: admin.id, notes: 'Тест', paymentDate: new Date(), normalizedPaymentMethod: 'cash' });
            if (membershipId) await db.payment.update({ where: { id: p.id }, data: { membershipId } }); return p;
        });
    }
    async function charge(membershipId, date, amount = 4000, free = false) {
        const lesson = await prisma.class.create({ data: { title: 'Учтённый урок', classType: 'individual', individualStudentId: student.id, date: new Date(date), startTime: '13:00', endTime: '13:45', duration: 45, status: free ? 'cancelled' : 'completed' } });
        return prisma.$transaction(async db => {
            const a = await db.classAttendee.create({ data: { classId: lesson.id, studentId: student.id, chargeAmount: free ? 0 : amount, chargedMembershipId: free ? null : membershipId, attendanceStatus: 'present' } });
            if (!free) await recordBalanceMovement(db, { studentId: student.id, amount: -amount, kind: 'lesson_charge', sourceType: 'class', sourceId: lesson.id, actorId: admin.id, reason: 'Урок теста', operationKey: `test:${lesson.id}` }); return a;
        });
    }
    test.before(async () => {
        const app = express(); app.use(express.json()); app.use('/api/subscription-periods', require('../src/routes/subscriptionPeriods'));
        await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${server.address().port}/api/subscription-periods`;
    });
    test.beforeEach(async () => {
        const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
        await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(',')} CASCADE`);
        admin = await person({ role: 'super_admin' }); other = await person({ role: 'admin' }); student = await person({ role: 'student' });
        source = await prisma.membership.create({ data: { ...rateCardMembershipData({ studentId: student.id, name: terms.name, rates: terms.rates, actorId: admin.id }), validFrom: new Date('2026-09-01'), validUntil: new Date('2026-10-16'), totalPrice: 24000, paidAmount: 24000, paymentStatus: 'paid' } });
        enrollment = await prisma.enrollment.create({ data: { studentId: student.id, membershipId: source.id, terms, responsibleId: admin.id, activatedAt: new Date(), completedAt: new Date() } });
        await prisma.student.update({ where: { id: student.id }, data: { activeMembershipId: source.id } });
        await payment(24000, source.id);
        for (let i = 1; i <= 5; i++) await charge(source.id, `2026-09-0${i}`);
    });
    test.afterEach(async () => assert.equal((await auditBalanceLedger(prisma)).consistent, true));
    test.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await prisma.$disconnect(); });
    const printedProposal = () => proposal({ documentBasis: { mode: 'new_appendix', generated: true } });
    const appendixInput = () => ({ contractNumber: 'М-12', contractDate: '2026-09-01', customerName: 'Заказчик <тест>', confirmed: true });
    async function htmlRequest(id, actor = admin) {
        const response = await fetch(`${base}/documents/${id}`, { headers: { Authorization: `Bearer ${jwt.sign({ id: actor.id }, process.env.JWT_SECRET)}` } });
        return { status: response.status, html: await response.text(), cache: response.headers.get('cache-control') };
    }
    test('printed renewal requires signature; concurrent preparation and confirmation create one immutable copy and payment', async () => {
        const r = await service.prepareRenewal(source.id, printedProposal(), admin.id);
        assert.equal((await req(`/renewals/${r.id}/confirm`, {})).status, 409);
        const docs = await Promise.all([req(`/renewals/${r.id}/appendix`, appendixInput()), req(`/renewals/${r.id}/appendix`, appendixInput(), other)]);
        assert.ok(docs.every(d => d.status === 200), JSON.stringify(docs));
        const doc = docs[0].data.document; assert.equal(doc.id, docs[1].data.document.id);
        assert.equal(await prisma.renewalDocument.count(), 1); assert.equal(await prisma.payment.count(), 1);
        assert.equal((await req(`/renewals/${r.id}/confirm`, {})).status, 409);
        const print = await htmlRequest(doc.id);
        assert.equal(print.status, 200); assert.equal(print.cache, 'no-store');
        assert.equal((print.html.match(/<article /g) || []).length, 2);
        assert.match(print.html, /Зачёт остатка: 4000/); assert.match(print.html, /К оплате с учётом зачёта: 20000/);
        assert.match(print.html, /Первый платёж: 8000 тенге. Доплата: 12000/);
        assert.match(print.html, /№ М-12 от 01.09.2026/); assert.match(print.html, /Пайдалану мерзімі/);
        assert.match(print.html, /Марата Оспанова, 52\/2/); assert.match(print.html, /KZ65722S000039869067/);
        assert.match(print.html, /Заказчик: Продление Тест/); // Adult is the customer, even if another name was sent.
        assert.equal((await req(`/documents/${doc.id}/sign`, { date: new Date().toISOString(), confirmed: false })).status, 400);
        assert.equal((await req(`/documents/${doc.id}/sign`, { date: '2099-01-01', confirmed: true })).status, 400);
        await req(`/documents/${doc.id}/sign`, { date: new Date().toISOString(), confirmed: true });
        const confirms = await Promise.all([req(`/renewals/${r.id}/confirm`, {}), req(`/renewals/${r.id}/confirm`, {})]);
        assert.ok(confirms.every(x => x.status === 200), JSON.stringify(confirms)); assert.equal(await prisma.payment.count(), 2);
        assert.equal((await service.prepareAppendix(r.id, { contractNumber: 'different' }, admin.id)).id, doc.id);
        assert.equal((await htmlRequest(doc.id)).html, print.html);
        await assert.rejects(prisma.renewalDocument.update({ where: { id: doc.id }, data: { html: 'changed' } }), /immutable/);
        await assert.rejects(prisma.renewalDocument.delete({ where: { id: doc.id } }), /immutable/);
        await assert.rejects(prisma.renewalDocument.update({ where: { id: doc.id }, data: { signedAt: null, signedById: null } }), /immutable/);
        const view = (await req(`/student/${student.id}`)).data;
        assert.equal(view.documents[0].id, doc.id); assert.equal(view.documentDefaults.contractNumber, 'М-12');
        await prisma.student.update({ where: { id: student.id }, data: { lastName: 'Новое имя' } });
        assert.equal((await htmlRequest(doc.id)).html, print.html);
    });
    test('child appendix identifies representative and escapes text; missing data cannot issue a document', async () => {
        await prisma.student.update({ where: { id: student.id }, data: { dateOfBirth: new Date('2015-01-01') } });
        const r = await service.prepareRenewal(source.id, printedProposal(), admin.id);
        assert.equal((await req(`/renewals/${r.id}/appendix`, { ...appendixInput(), customerName: '' })).status, 400);
        assert.equal((await req(`/renewals/${r.id}/appendix`, { ...appendixInput(), contractDate: '2026-02-30' })).status, 400);
        assert.equal((await req(`/renewals/${r.id}/appendix`, { ...appendixInput(), confirmed: false })).status, 400);
        const doc = await service.prepareAppendix(r.id, appendixInput(), admin.id);
        const html = await service.appendixHtml(doc.id);
        assert.match(html, /Заказчик: Заказчик &lt;тест&gt;/); assert.match(html, /Дата рождения Ученика: 01.01.2015/);
        assert.doesNotMatch(html, /<тест>/);
        assert.equal((await req(`/student/${student.id}`)).data.documentDefaults.minor, true);
    });
    test('credit-only appendix shows zero first cash and correct debt, without inventing a receipt', async () => {
        const r = await service.prepareRenewal(source.id, proposal({ ...printedProposal(), terms: { ...terms, totalPrice: 8000, firstPayment: 4000 }, payment: received(0) }), admin.id);
        const doc = await service.prepareAppendix(r.id, appendixInput(), admin.id);
        assert.match(await service.appendixHtml(doc.id), /Первый платёж: 0 тенге. Доплата: 4000/);
        await service.signAppendix(doc.id, { date: new Date().toISOString(), confirmed: true }, admin.id);
        const result = await service.confirmRenewal(r.id, admin.id); assert.equal(result.paymentId, null); assert.equal(await prisma.payment.count(), 1);
    });
    test('cancelled and stale calculations cannot be signed or used; corrected copy has a new number', async () => {
        const r = await service.prepareRenewal(source.id, printedProposal(), admin.id);
        const doc = await service.prepareAppendix(r.id, appendixInput(), admin.id);
        await charge(source.id, '2026-09-06');
        assert.equal((await req(`/documents/${doc.id}/sign`, { date: new Date().toISOString(), confirmed: true })).status, 409);
        await service.cancelRenewal(r.id);
        assert.equal((await htmlRequest(doc.id)).status, 409);
        assert.equal((await req(`/documents/${doc.id}/sign`, { date: new Date().toISOString(), confirmed: true })).status, 409);
        const next = await service.prepareRenewal(source.id, { ...printedProposal(), creditAmount: 0, payment: received(12000) }, admin.id);
        const corrected = await service.prepareAppendix(next.id, appendixInput(), admin.id);
        assert.notEqual(corrected.number, doc.number); assert.equal(await prisma.renewalDocument.count(), 2);
    });
    test('identity changes block signing and activation, but never rewrite the issued appendix', async () => {
        const r = await service.prepareRenewal(source.id, printedProposal(), admin.id);
        const doc = await service.prepareAppendix(r.id, appendixInput(), admin.id);
        const original = await service.appendixHtml(doc.id);
        await prisma.student.update({ where: { id: student.id }, data: { dateOfBirth: new Date('1991-01-01') } });
        assert.equal((await req(`/documents/${doc.id}/sign`, { date: new Date().toISOString(), confirmed: true })).status, 409);
        await prisma.student.update({ where: { id: student.id }, data: { dateOfBirth: new Date('1990-01-01') } });
        await service.signAppendix(doc.id, { date: new Date().toISOString(), confirmed: true }, admin.id);
        await prisma.student.update({ where: { id: student.id }, data: { dateOfBirth: new Date('1991-01-01') } });
        assert.equal((await req(`/renewals/${r.id}/confirm`, {})).status, 409);
        assert.equal(await service.appendixHtml(doc.id), original); assert.equal(await prisma.payment.count(), 1);
    });
    test('teacher cannot prepare, read or sign appendices; revoked finance permission blocks writes', async () => {
        const r = await service.prepareRenewal(source.id, printedProposal(), admin.id);
        const doc = await service.prepareAppendix(r.id, appendixInput(), admin.id);
        const teacher = await person({ role: 'teacher' });
        assert.equal((await req(`/renewals/${r.id}/appendix`, appendixInput(), teacher)).status, 403);
        assert.equal((await htmlRequest(doc.id, teacher)).status, 403);
        assert.equal((await req(`/documents/${doc.id}/sign`, { date: new Date().toISOString(), confirmed: true }, teacher)).status, 403);
        await prisma.rolePermissions.create({ data: { role: 'admin', permissions: { canManagePayments: false }, visibility: {} } });
        assert.equal((await req(`/documents/${doc.id}/sign`, { date: new Date().toISOString(), confirmed: true }, other)).status, 403);
    });
    test('admin preview has no financial effects; concurrent confirmation credits cash once and carry never creates cash', async () => {
        const results = await Promise.all([req(`/memberships/${source.id}/renewals`, proposal()), req(`/memberships/${source.id}/renewals`, proposal(), other)]);
        assert.ok(results.every(r => r.status === 200), JSON.stringify(results)); const r = results[0].data.renewal;
        assert.equal(r.id, results[1].data.renewal.id); assert.equal(await prisma.membership.count(), 1); assert.equal(await prisma.payment.count(), 1);
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).accountBalance, 4000);
        const confirms = await Promise.all([req(`/renewals/${r.id}/confirm`, {}), req(`/renewals/${r.id}/confirm`, {}, other)]);
        assert.ok(confirms.every(x => x.status === 200), JSON.stringify(confirms)); assert.equal(confirms[0].data.membershipId, confirms[1].data.membershipId);
        assert.equal(await prisma.payment.count(), 2); assert.equal(await prisma.cashTransaction.count(), 2);
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).accountBalance, 12000);
        const m = await prisma.membership.findUnique({ where: { id: confirms[0].data.membershipId } });
        assert.equal(m.remainingAmount, 12000); assert.equal(m.paidAmount, 12000); assert.equal((m.validUntil - m.validFrom) / 86400000, 45); assert.equal(m.emergencyFreezesUsed, 0);
        assert.equal((await prisma.membership.findUnique({ where: { id: source.id } })).status, 'archived');
        assert.equal((await req(`/memberships/${source.id}/renewals`, proposal())).status, 409);
        await assert.rejects(prisma.subscriptionRenewal.update({ where: { id: r.id }, data: { creditAmount: 0 } }), /immutable/);
    });
    test('balance or lesson changes after preview block confirmation without recording any payment', async () => {
        const r = await service.prepareRenewal(source.id, proposal(), admin.id);
        await charge(source.id, '2026-09-06');
        assert.equal((await req(`/renewals/${r.id}/confirm`, {})).status, 409);
        assert.equal(await prisma.payment.count(), 1); assert.equal(await prisma.membership.count(), 1);
        await service.cancelRenewal(r.id); await service.cancelRenewal(r.id);
        const fresh = await service.prepareRenewal(source.id, proposal({ creditAmount: 0, payment: received(12000) }), admin.id);
        assert.notEqual(fresh.id, r.id);
        await service.confirmRenewal(fresh.id, admin.id);
    });
    test('half-year and changed terms require a new appendix; verified historic paper terms may be reused', async () => {
        assert.equal((await req(`/memberships/${source.id}/renewals`, proposal({ terms: { ...terms, renewalKind: 'half_year' } }))).status, 400);
        assert.equal((await req(`/memberships/${source.id}/renewals`, proposal({ terms: { ...terms, days: 75 } }))).status, 409);
        await prisma.enrollment.update({ where: { id: enrollment.id }, data: { terms: null } });
        const paper = await req(`/memberships/${source.id}/renewals`, proposal());
        assert.equal(paper.status, 200, JSON.stringify(paper));
        await service.cancelRenewal(paper.data.renewal.id);
        assert.equal((await req(`/memberships/${source.id}/renewals`, proposal({ terms: { ...terms, rates: normalizeRates({ individual: 5000 }) } }))).status, 409);
        const r = await req(`/memberships/${source.id}/renewals`, proposal({ documentBasis: { mode: 'new_appendix', reference: 'Подписанное приложение №2 от 11.10.2026' } }));
        assert.equal(r.status, 200, JSON.stringify(r));
        assert.equal((await req(`/renewals/${r.data.renewal.id}/confirm`, {})).status, 200);
    });
    test('credit requires evidence and cannot exceed balance or owned period funds', async () => {
        assert.equal((await req(`/memberships/${source.id}/renewals`, proposal({ creditReason: '' }))).status, 400);
        assert.equal((await req(`/memberships/${source.id}/renewals`, proposal({ creditAmount: 8000 }))).status, 409);
        await payment(10000); // Unallocated deposit is not this period's carry.
        assert.equal((await req(`/memberships/${source.id}/renewals`, proposal({ creditAmount: 8000 }))).status, 409);
        assert.equal((await req(`/memberships/${source.id}/renewals`, proposal({ confirmed: false }))).status, 400);
    });
    test('only carry may cover first part; no invented zero payment or cash entry', async () => {
        const r = await service.prepareRenewal(source.id, proposal({ terms: { ...terms, totalPrice: 8000, firstPayment: 4000 }, documentBasis: { mode: 'new_appendix', reference: 'Подписанное приложение №2' }, payment: received(0) }), admin.id);
        const result = await service.confirmRenewal(r.id, admin.id);
        assert.equal(result.paymentId, null); assert.equal(await prisma.payment.count(), 1); assert.equal(await prisma.cashTransaction.count(), 1);
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).accountBalance, 4000);
    });
    test('top-up covers only current debt, never shifts dates or resumes an inactive student', async () => {
        const r = await service.prepareRenewal(source.id, proposal(), admin.id); const bought = await service.confirmRenewal(r.id, admin.id);
        const before = await prisma.membership.findUnique({ where: { id: bought.membershipId } });
        await prisma.student.update({ where: { id: student.id }, data: { status: 'inactive', pausedUntil: new Date('2026-01-01'), createdAt: new Date('2020-01-01'), lostAt: new Date('2025-01-01') } });
        // Force the old sales-recovery branch too: the payment must still not resume education.
        await prisma.payment.updateMany({ data: { paymentDate: new Date('2025-01-01') } });
        const i = await service.prepareInstallment(before.id, received(12000), admin.id);
        const results = await Promise.all([service.confirmInstallment(i.id, admin.id), service.confirmInstallment(i.id, other.id)]);
        assert.equal(results[0].paymentId, results[1].paymentId);
        const after = await prisma.membership.findUnique({ where: { id: before.id } });
        assert.deepEqual(after.validFrom, before.validFrom); assert.deepEqual(after.validUntil, before.validUntil); assert.equal(after.remainingAmount, 0);
        const s = await prisma.student.findUnique({ where: { id: student.id } }); assert.equal(s.status, 'inactive'); assert.ok(s.pausedUntil); assert.ok(s.lostAt);
        assert.deepEqual(await restoreExpiredStudentPauses(), { restored: 0 });
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).status, 'inactive');
        await assert.rejects(service.prepareInstallment(before.id, received(1), admin.id), /Осталось/);
    });
    test('first-enrollment and installment screens share paid total and reject racing overpayment', async () => {
        await prisma.enrollment.update({ where: { id: enrollment.id }, data: { terms: { ...terms, totalPrice: 36000 }, completedAt: null } });
        const eDraft = await enrollmentService.preparePayment(enrollment.id, received(12000), admin.id);
        const i = await service.prepareInstallment(source.id, received(12000), admin.id);
        await service.confirmInstallment(i.id, admin.id);
        await assert.rejects(enrollmentService.confirmPayment(enrollment.id, eDraft.id, admin.id), /Размер доплаты изменился/);
        const state = await enrollmentService.enrollmentView(enrollment.id); assert.equal(state.paidAmount, 36000); assert.equal(state.remainingAmount, 0);
    });
    test('overdue reminders use the second charged lesson and school time; GET never pauses or removes schedules', async () => {
        const r = await service.prepareRenewal(source.id, proposal(), admin.id); const bought = await service.confirmRenewal(r.id, admin.id);
        await charge(bought.membershipId, '2026-10-01'); await charge(bought.membershipId, '2026-10-02', 4000, true); const second = await charge(bought.membershipId, '2026-10-03');
        const m = await prisma.membership.findUnique({ where: { id: bought.membershipId } });
        const due = await service.periodState(prisma, m, new Date('2026-10-03T08:45:00Z'));
        assert.equal(due.countedLessons, 2); assert.equal(due.dueAt.toISOString(), '2026-10-03T08:45:00.000Z'); assert.equal(due.overdue, true); assert.equal(due.reviewAfter, '2026-10-11');
        const before = await prisma.student.findUnique({ where: { id: student.id } });
        const queue = await req('/attention'); assert.equal(queue.status, 200, JSON.stringify(queue)); assert.ok(queue.data.rows[0].messages.some(x => x.includes('Просрочена')));
        assert.deepEqual(await prisma.student.findUnique({ where: { id: student.id } }), before);
        await prisma.classAttendee.update({ where: { id: second.id }, data: { chargeAmount: 0, chargedMembershipId: null } });
        const reopened = await service.periodState(prisma, m); assert.equal(reopened.countedLessons, 1); assert.equal(reopened.dueAt, null);
    });
    test('manual release preserves balance, term and past lessons; repeated click does not duplicate removal', async () => {
        const schedule = await prisma.studentSchedule.create({ data: { studentId: student.id, dayOfWeek: 6, time: '14:00', duration: 45 } });
        const future = await prisma.class.create({ data: { title: 'Будущий урок', classType: 'individual', individualStudentId: student.id, date: new Date('2099-01-01'), startTime: '14:00', endTime: '14:45', duration: 45 } });
        assert.equal((await req(`/student/${student.id}/release-schedule`, { confirmed: true, reason: 'Просрочка доплаты после уведомления' })).status, 409);
        await prisma.student.update({ where: { id: student.id }, data: { status: 'inactive', pausedUntil: new Date('2026-10-01') } });
        const r = await req(`/student/${student.id}/release-schedule`, { confirmed: true, reason: 'Просрочка доплаты после уведомления' });
        assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.data.removedSchedules, 1); assert.equal(r.data.cancelledClasses, 1);
        assert.equal(await prisma.studentSchedule.findUnique({ where: { id: schedule.id } }), null);
        assert.equal((await prisma.class.findUnique({ where: { id: future.id } })).status, 'cancelled');
        assert.equal(await prisma.class.count({ where: { status: 'completed' } }), 5);
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).accountBalance, 4000);
        assert.deepEqual((await prisma.membership.findUnique({ where: { id: source.id } })).validUntil, source.validUntil);
        assert.equal((await req(`/student/${student.id}/release-schedule`, { confirmed: true, reason: 'Повтор подтверждения после потери ответа' })).status, 200);
        assert.equal(await prisma.activityLog.count({ where: { action: 'release_student_schedule' } }), 1);
    });
    test('teachers cannot access periods; revoked admin financial permission blocks new actions', async () => {
        const teacher = await person({ role: 'teacher' });
        assert.equal((await req(`/student/${student.id}`, undefined, teacher)).status, 403);
        await prisma.rolePermissions.create({ data: { role: 'admin', permissions: { canManagePayments: false }, visibility: {} } });
        assert.equal((await req(`/memberships/${source.id}/renewals`, proposal(), other)).status, 403);
        assert.equal((await req('/installments/missing/confirm', {}, other)).status, 403);
        const view = await req(`/student/${student.id}`); assert.equal(view.status, 200, JSON.stringify(view));
    });
}
