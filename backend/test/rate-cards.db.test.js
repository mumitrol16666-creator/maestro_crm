const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('rate-card PostgreSQL/HTTP integration', { skip: 'TEST_DATABASE_URL is required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /(?:test|qa)/.test(url.pathname));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, JWT_SECRET: 'rate-card-local-tests',
        TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', LEARNING_PLATFORM_API_URL: 'http://127.0.0.1:9', INTEGRATION_SERVICE_SECRET: 'local-billing-test-secret' });
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const { prisma } = require('../src/config/db');
    const { rateCardMembershipData, normalizeRates } = require('../src/services/rateCards');
    const { capture } = require('../scripts/audit-rate-cards');
    const { buildMigrationPlan } = require('../src/services/rateCardMigration');
    const { applyPlan } = require('../scripts/migrate-rate-cards');
    const { adminApproveClass } = require('../src/services/integrationWrite');
    let server, base, admin, teacher;
    const makeUser = (role = 'student') => prisma.student.create({ data: { role, name: 'Rate QA', lastName: randomUUID(), phone: `qa-${randomUUID()}`, password: 'qa-only', learningDirections: [], teacherDirections: [], accountBalance: 50000 } });
    const card = (student, rates) => prisma.membership.create({ data: rateCardMembershipData({ studentId: student.id, name: 'QA', rates: normalizeRates(rates) }) });
    async function request(path, body, roleUser = admin) {
        const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: {
            Authorization: `Bearer ${path.startsWith('/integration/') ? process.env.INTEGRATION_SERVICE_SECRET : jwt.sign({ id: roleUser.id }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json',
            'X-Integration-System': 'learning-platform',
        }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: res.status, body: await res.json() };
    }
    async function lesson(student, kind) {
        const group = kind === 'individual' ? null : await prisma.group.create({ data: { name: `QA ${randomUUID()}`, direction: 'Ансамбль', billingType: kind === 'unknown' ? null : kind, teacherId: teacher.id } });
        const cls = await prisma.class.create({ data: { title: `QA ${kind}`, teacherId: teacher.id, groupId: group?.id,
            individualStudentId: group ? null : student.id, classType: group ? 'group' : 'individual', price: 99999,
            date: new Date('2026-09-20T00:00:00Z'), startTime: '10:00', endTime: '10:45', status: 'pending_admin_review',
            topic: 'Аккорды', lessonSummary: 'Учебная проверка' } });
        await prisma.classAttendee.create({ data: { classId: cls.id, studentId: student.id, attended: true, attendanceStatus: 'present' } });
        return cls;
    }
    const decision = (s, m, amount) => ({ studentId: s.id, membershipId: m.id, amount, attendanceStatus: 'present' });
    const approve = (c, decisions) => request(`/classes/${c.id}/approve`, { billingDecisions: decisions });
    const balance = async s => (await prisma.student.findUnique({ where: { id: s.id } })).accountBalance;

    test.before(async () => {
        admin = await makeUser('super_admin'); teacher = await makeUser('teacher');
        const app = express(); app.use(express.json());
        app.use('/memberships', require('../src/routes/memberships'));
        app.use('/classes', require('../src/routes/classes'));
        app.use('/groups', require('../src/routes/groups'));
        app.use('/integration', require('../src/routes/integration'));
        await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
        base = `http://127.0.0.1:${server.address().port}`;
    });
    test.after(async () => { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

    test('assignment archives reviewed old rates without touching wallet, rejects stale replacement and nonadmin', async () => {
        const s = await makeUser(); const old = await card(s, { individual: 4000 });
        const input = { studentId: s.id, name: 'Семейный', lessonRates: { individual: { basePrice: 4000, discountPercent: 10, reason: 'Семья' }, theory: 1000 }, expectedActiveIds: [old.id] };
        assert.equal((await request('/memberships/rate-card', input, s)).status, 403);
        const result = await request('/memberships/rate-card', input);
        assert.equal(result.status, 201, JSON.stringify(result.body));
        assert.equal(result.body.membership.lessonRates.individual.price, 3600);
        assert.equal((await prisma.membership.findUnique({ where: { id: old.id } })).status, 'archived');
        assert.equal(await balance(s), 50000);
        assert.equal((await request('/memberships/rate-card', input)).status, 409);
    });

    test('theory in a group uses 1000, quartet 2250, duo personal discount 2475, without lesson limits', async () => {
        const s = await makeUser(); const m = await card(s, { individual: 4000, theory: 1000, quartet: 2250, duo: { basePrice: 2750, discountPercent: 10, reason: 'Семья' } });
        await prisma.membership.update({ where: { id: m.id }, data: { endDate: new Date('2000-01-01'), classesRemaining: 0 } });
        for (const [kind, price] of [['theory', 1000], ['quartet', 2250], ['duo', 2475]]) {
            const c = await lesson(s, kind);
            const options = await request(`/classes/${c.id}/billing-options?studentIds=${s.id}`);
            assert.equal(options.body.students[0].suggestedAmount, price, JSON.stringify(options.body));
            assert.equal(options.body.students[0].suggestedMembershipId, m.id);
            const r = await approve(c, [decision(s, m, price)]);
            assert.equal(r.status, 200, JSON.stringify(r.body));
        }
        assert.equal(await balance(s), 44275);
        assert.equal((await prisma.membership.findUnique({ where: { id: m.id } })).classesRemaining, 0);
    });

    test('missing rate, unknown group, wrong pupil, duplicate decisions and stale amount all roll back', async () => {
        const s = await makeUser(); const other = await makeUser(); const m = await card(s, { quartet: 2250 });
        for (const kind of ['duo', 'unknown']) {
            const c = await lesson(s, kind); assert.equal((await approve(c, [decision(s, m, 2250)])).status, 400);
        }
        const c = await lesson(s, 'quartet');
        assert.equal((await approve(c, [])).status, 400);
        assert.equal((await approve(c, [decision(other, m, 2250)])).status, 400);
        assert.equal((await approve(c, [decision(s, m, 2250), decision(s, m, 2250)])).status, 400);
        assert.equal((await approve(c, [decision(s, m, 1)])).status, 409);
        assert.equal(await balance(s), 50000);
        assert.equal(await prisma.membershipTransaction.count({ where: { classId: c.id } }), 0);
    });

    test('concurrent approval charges once; repeated reopen restores exact historical amount even after tariff replacement', async () => {
        const s = await makeUser(); const m = await card(s, { duo: 2750 }); const c = await lesson(s, 'duo');
        const results = await Promise.all([approve(c, [decision(s, m, 2750)]), approve(c, [decision(s, m, 2750)])]);
        assert.equal(results.filter(r => r.status === 200).length, 1, JSON.stringify(results));
        assert.equal(await balance(s), 47250);
        await request('/memberships/rate-card', { studentId: s.id, name: 'Новый', lessonRates: { duo: 2500 }, expectedActiveIds: [m.id] });
        assert.equal((await request(`/classes/${c.id}/reopen`, { reason: 'Проверка' })).status, 200);
        assert.equal(await balance(s), 50000);
        assert.equal((await request(`/classes/${c.id}/reopen`, { reason: 'Повтор' })).status, 400);
        assert.equal(await balance(s), 50000);
        const refunds = await prisma.membershipTransaction.findMany({ where: { classId: c.id, type: 'add' } });
        assert.equal(refunds.length, 1); assert.equal(refunds[0].chargeAmount, 2750);
    });

    test('free lesson preserves wallet and can be reopened and approved again', async () => {
        const s = await makeUser(); const m = await card(s, { individual: { basePrice: 4000, discountPercent: 100, reason: 'Льгота' } }); const c = await lesson(s, 'individual');
        assert.equal((await approve(c, [decision(s, m, 0)])).status, 200);
        assert.equal((await request(`/classes/${c.id}/reopen`, { reason: 'Проверка' })).status, 200);
        assert.equal((await approve(c, [decision(s, m, 0)])).status, 200);
        assert.equal(await balance(s), 50000);
    });

    test('participants of one duo are charged their own rates, including a full discount', async () => {
        const a = await makeUser(); const b = await makeUser();
        const am = await card(a, { duo: 2750, quartet: 2250 });
        const bm = await card(b, { duo: { basePrice: 2500, discountPercent: 100, reason: 'Льгота' }, quartet: 2250 });
        const c = await lesson(a, 'duo');
        await prisma.classAttendee.create({ data: { classId: c.id, studentId: b.id, attendanceStatus: 'present', attended: true } });
        const result = await approve(c, [decision(a, am, 2750), decision(b, bm, 0)]);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(await balance(a), 47250); assert.equal(await balance(b), 50000);
        assert.equal((await request(`/classes/${c.id}/reopen`, { reason: 'Проверка двух участников' })).status, 200);
        assert.equal(await balance(a), 50000); assert.equal(await balance(b), 50000);
    });

    test('integration approval uses same server rate and rejects manual charge without tariff', async () => {
        const s = await makeUser(); const m = await card(s, { theory: 1000 }); const c = await lesson(s, 'theory');
        const rejected = await adminApproveClass(c.id, { billingDecisions: [{ studentId: s.id, amount: 1 }] });
        assert.equal(rejected.success, false);
        assert.equal(await balance(s), 50000);
        const approved = await adminApproveClass(c.id, { billingDecisions: [decision(s, m, 1000)] });
        assert.equal(approved.success, true, JSON.stringify(approved));
        assert.equal(await balance(s), 49000);
    });

    test('late cancellation uses exact duo price; missing rate rolls back; trial is not charged', async () => {
        const s = await makeUser(); await card(s, { duo: 2750 });
        const c = await lesson(s, 'duo');
        assert.equal((await request(`/classes/${c.id}/postpone`, {})).status, 200);
        assert.equal(await balance(s), 47250);
        assert.equal((await request(`/classes/${c.id}/postpone`, {})).status, 400);
        assert.equal(await balance(s), 47250);
        const missing = await lesson(s, 'quartet');
        const rejected = await request(`/classes/${missing.id}/postpone`, {});
        assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
        assert.equal((await prisma.class.findUnique({ where: { id: missing.id } })).status, 'pending_admin_review');
        assert.equal(await balance(s), 47250);
        const trial = await lesson(s, 'individual');
        await prisma.class.update({ where: { id: trial.id }, data: { classType: 'trial' } });
        assert.equal((await request(`/classes/${trial.id}/postpone`, {})).status, 200);
        assert.equal(await balance(s), 47250);
    });

    test('CRM rejects deduct, returns 409 on stale prices, then charges correctly', async () => {
        for (const prefix of ['']) {
            const s = await makeUser(); const m = await card(s, { individual: 4000 }); const c = await lesson(s, 'individual');
            for (const deduct of [false, true, null, 0, 'false']) {
                assert.equal((await request(`${prefix}/classes/${c.id}/approve`, { deduct, billingDecisions: [decision(s, m, 4000)] })).status, 400);
            }
            assert.equal((await request(`${prefix}/classes/${c.id}/approve`, { billingDecisions: [decision(s, m, 1)] })).status, 409);
            assert.equal(await balance(s), 50000);
            assert.equal((await prisma.class.findUnique({ where: { id: c.id } })).status, 'pending_admin_review');
            assert.equal(await prisma.membershipTransaction.count({ where: { classId: c.id } }), 0);
            assert.equal((await request(`${prefix}/classes/${c.id}/approve`, { billingDecisions: [decision(s, m, 4000)] })).status, 200);
            assert.equal(await balance(s), 46000);
        }
    });

    test('server rules preserve trial, practice, not-held, excused absence and free-rate approvals', async () => {
        for (const prefix of ['']) {
            for (const kind of ['trial', 'practice', 'not_held', 'excused_absence', 'free']) {
                const s = await makeUser(); const c = await lesson(s, 'individual');
                const changes = kind === 'trial' ? { classType: 'trial' } : kind === 'practice' ? { isPractice: true }
                    : kind === 'not_held' ? { teacherOutcomeHint: 'not_held' } : {};
                await prisma.class.update({ where: { id: c.id }, data: changes });
                let decisions = [];
                if (kind === 'excused_absence') {
                    await prisma.classAttendee.updateMany({ where: { classId: c.id }, data: { attended: false, attendanceStatus: kind } });
                    decisions = [{ studentId: s.id, attendanceStatus: kind }];
                } else if (kind === 'free') {
                    const m = await card(s, { individual: { basePrice: 4000, discountPercent: 100, reason: 'Льгота' } });
                    decisions = [decision(s, m, 0)];
                }
                const result = await request(`${prefix}/classes/${c.id}/approve`, { billingDecisions: decisions });
                assert.equal(result.status, 200, JSON.stringify({ kind, prefix, body: result.body }));
                assert.equal(await balance(s), 50000);
                assert.equal(await prisma.membershipTransaction.count({ where: { classId: c.id } }), kind === 'free' ? 1 : 0);
                assert.equal(await prisma.classAttendee.count({ where: { classId: c.id, studentId: s.id } }), 1);
            }
        }
    });

    test('legacy zero-unit reopening refunds actual cash once and permits approval with the replacement tariff', async () => {
        const { hasDeductionForClass } = require('../src/services/classMembership');
        const s = await makeUser(); const c = await lesson(s, 'individual');
        const old = await prisma.membership.create({ data: { studentId: s.id, type: 'individual_8', lessonFormat: 'individual',
            status: 'archived', totalPrice: 22000, totalClasses: 8, classesRemaining: 7, classesUsed: 1,
            startDate: new Date('2026-01-01'), endDate: new Date('2026-12-01') } });
        await prisma.class.update({ where: { id: c.id }, data: { status: 'completed' } });
        await prisma.student.update({ where: { id: s.id }, data: { accountBalance: 47250 } });
        await prisma.classAttendee.updateMany({ where: { classId: c.id }, data: { chargeAmount: 2750, chargedMembershipId: old.id, chargeSource: 'membership', autoDeducted: true } });
        await prisma.membershipTransaction.create({ data: { membershipId: old.id, classId: c.id, type: 'manual_deduct', amount: 0, reason: 'Legacy' } });
        assert.equal(await hasDeductionForClass(old.id, c.id), true);
        assert.equal((await request(`/classes/${c.id}/reopen`, { reason: 'QA legacy' })).status, 200);
        assert.equal(await balance(s), 50000); assert.equal(await hasDeductionForClass(old.id, c.id), false);
        assert.equal((await prisma.membership.findUnique({ where: { id: old.id } })).classesRemaining, 7);
        assert.equal((await prisma.membershipTransaction.findFirst({ where: { membershipId: old.id, classId: c.id, type: 'add' } })).amount, 0);
        assert.equal((await request(`/classes/${c.id}/reopen`, { reason: 'QA repeat' })).status, 400);
        const m = await card(s, { individual: 4000 });
        assert.equal((await approve(c, [decision(s, m, 4000)])).status, 200); assert.equal(await balance(s), 46000);
        assert.equal((await request(`/classes/${c.id}/reopen`, { reason: 'QA next cycle' })).status, 200); assert.equal(await balance(s), 50000);
        assert.equal(await prisma.membershipTransaction.count({ where: { membershipId: old.id, classId: c.id, type: 'add' } }), 1);
    });

    test('legacy refund handles multiple zero events idempotently without altering lesson counters', async () => {
        const { refundMembershipForClass, hasDeductionForClass } = require('../src/services/classMembership');
        const s = await makeUser(); const c = await lesson(s, 'individual');
        const m = await prisma.membership.create({ data: { studentId: s.id, type: 'individual_8', lessonFormat: 'individual',
            totalPrice: 22000, totalClasses: 8, classesRemaining: 8, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-01') } });
        await prisma.student.update({ where: { id: s.id }, data: { accountBalance: 47250 } });
        await prisma.classAttendee.updateMany({ where: { classId: c.id }, data: { chargeAmount: 2750, chargedMembershipId: m.id, chargeSource: 'membership' } });
        await prisma.membershipTransaction.createMany({ data: [0, 0].map(amount => ({ membershipId: m.id, classId: c.id, type: 'manual_deduct', amount, reason: 'Legacy' })) });
        await Promise.all([refundMembershipForClass(s.id, c, admin.id), refundMembershipForClass(s.id, c, admin.id)]);
        assert.equal(await balance(s), 50000); assert.equal(await hasDeductionForClass(m.id, c.id), false);
        assert.equal((await prisma.membership.findUnique({ where: { id: m.id } })).classesRemaining, 8);
        assert.equal(await prisma.membershipTransaction.count({ where: { membershipId: m.id, classId: c.id, type: 'add' } }), 2);
        assert.equal((await refundMembershipForClass(s.id, c, admin.id)).refunded, false);
    });

    test('Platform integration cannot approve any lesson; an admin can still approve it in CRM', async () => {
        const s = await makeUser(); const m = await card(s, { individual: 4000 }); const c = await lesson(s, 'individual');
        for (const payload of [{}, { deduct: false }, { billingDecisions: [decision(s, m, 4000)] }]) {
            const result = await request(`/integration/classes/${c.id}/approve`, payload);
            assert.equal(result.status, 409);
            assert.equal(result.body.code, 'CRM_APPROVAL_REQUIRED');
        }
        assert.equal(await balance(s), 50000);
        assert.equal(await prisma.membershipTransaction.count({ where: { classId: c.id } }), 0);
        assert.equal((await prisma.class.findUnique({ where: { id: c.id } })).status, 'pending_admin_review');
        assert.equal((await approve(c, [decision(s, m, 4000)])).status, 200);
        assert.equal(await balance(s), 46000);
        const teacherDenied = await request(`/classes/${c.id}/approve`, { billingDecisions: [decision(s, m, 4000)] }, teacher);
        assert.equal(teacherDenied.status, 403);
    });

    test('migration is atomic, preserves balances and historical records, refuses stale/replayed plan', async () => {
        // The migration validates the entire billing domain; start from a complete
        // isolated fixture rather than earlier deliberate invalid scenarios.
        const tables = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations'`);
        await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => '"' + t.tablename + '"').join(',')} CASCADE`);
        const s = await makeUser();
        const old = await prisma.membership.create({ data: { studentId: s.id, type: 'duet', lessonFormat: 'group', totalPrice: 22000,
            basePrice: 22000, totalClasses: 8, classesRemaining: 0, emergencyFreezesAvailable: 2, emergencyFreezesUsed: 1,
            startDate: new Date('2000-01-01'), endDate: new Date('2000-02-01') } });
        const unpriced = await makeUser();
        const incomplete = buildMigrationPlan(await capture(prisma));
        assert.ok(incomplete.issues.length > 0);
        await assert.rejects(() => applyPlan(prisma, incomplete), /заблокирован/);
        await prisma.student.update({ where: { id: unpriced.id }, data: { status: 'inactive' } });
        const original = await capture(prisma); const plan = buildMigrationPlan(original);
        const result = await applyPlan(prisma, JSON.parse(JSON.stringify(plan)));
        assert.equal(result.balancesUnchanged, true);
        assert.equal(await balance(s), 50000);
        assert.equal((await prisma.membership.findUnique({ where: { id: old.id } })).totalPrice, 22000);
        const fresh = await prisma.membership.findFirst({ where: { studentId: s.id, billingModel: 'rate_card', status: 'active' } });
        assert.equal(fresh.lessonRates.duo.price, 2750);
        assert.equal(fresh.emergencyFreezesAvailable, 2);
        assert.equal(fresh.emergencyFreezesUsed, 1);
        await assert.rejects(() => applyPlan(prisma, plan), /Данные изменились/);
    });
}
