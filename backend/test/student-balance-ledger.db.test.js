const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('student balance ledger PostgreSQL/HTTP', { skip: 'TEST_DATABASE_URL required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /test|qa/.test(url.pathname));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL,
        JWT_SECRET: 'local-ledger-tests', LEARNING_PLATFORM_API_URL: 'http://127.0.0.1:9',
        TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' });
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const { prisma } = require('../src/config/db');
    const { recordBalanceMovement } = require('../src/services/studentBalanceLedger');
    const { auditBalanceLedger } = require('../scripts/audit-student-balance-ledger');
    const { rateCardMembershipData } = require('../src/services/rateCards');
    let admin, sales, teacher, server, base;
    const user = (extra = {}) => prisma.student.create({ data: {
        role: 'student', name: 'Ledger', lastName: 'QA', phone: randomUUID(), password: 'test-only', ...extra,
    } });
    const balance = async student => (await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).accountBalance;
    const entries = student => prisma.studentBalanceEntry.findMany({ where: { studentId: student.id }, orderBy: { position: 'asc' } });
    const input = (student, amount, extra = {}) => ({ studentId: student.id, amount, kind: 'manual_adjustment',
        sourceType: 'test', sourceId: student.id, actorId: admin.id, reason: 'Проверяемая корректировка', operationKey: randomUUID(), ...extra });
    const movement = data => prisma.$transaction(tx => recordBalanceMovement(tx, data));
    async function request(path, body, { method = body ? 'POST' : 'GET', actor = admin, key = randomUUID(), token } = {}) {
        const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json',
            'X-Idempotency-Key': key, Authorization: `Bearer ${token || jwt.sign({ id: actor.id }, process.env.JWT_SECRET)}` },
            ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
    }
    test.before(async () => {
        const app = express(); app.use(express.json());
        const idempotency = require('../src/middleware/idempotency');
        app.use((req, res, next) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? idempotency(req, res, next) : next());
        app.use('/api/payments', require('../src/routes/payments'));
        app.use('/api/students', require('../src/routes/students'));
        app.use('/api/classes', require('../src/routes/classes'));
        await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
        base = `http://127.0.0.1:${server.address().port}/api`;
    });
    test.beforeEach(async () => {
        const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
        await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(({ tablename }) => `"${tablename}"`).join(',')} CASCADE`);
        admin = await user({ role: 'super_admin' }); sales = await user({ role: 'sales_manager' }); teacher = await user({ role: 'teacher' });
    });
    test.afterEach(async () => {
        const audit = await auditBalanceLedger(prisma);
        assert.equal(audit.consistent, true, JSON.stringify(audit.discrepancies));
    });
    test.after(async () => { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

    test('migration carries existing positive, negative and zero balances without payments or recalculation', async () => {
        // Exercise the exact migration against a populated isolated schema.
        const { Client } = require('pg');
        const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
        const schema = `cutover_${randomUUID().replaceAll('-', '')}`;
        await client.connect();
        try {
            await client.query(`CREATE SCHEMA "${schema}"`);
            await client.query(`SET search_path TO "${schema}"`);
            await client.query('CREATE TABLE "Student" (id TEXT PRIMARY KEY, role TEXT, "accountBalance" INTEGER, "updatedAt" TIMESTAMP DEFAULT now())');
            await client.query(`INSERT INTO "Student" (id,role,"accountBalance") VALUES ('positive','student',184332),('debt','student',-12000),('zero','student',0)`);
            const before = (await client.query('SELECT id,"accountBalance" FROM "Student" ORDER BY id')).rows;
            const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../prisma/migrations/20261011070000_student_balance_ledger/migration.sql'), 'utf8');
            await client.query(sql);
            assert.deepEqual((await client.query('SELECT id,"accountBalance" FROM "Student" ORDER BY id')).rows, before);
            const opening = (await client.query('SELECT "studentId",amount,kind,"needsReview" FROM "StudentBalanceEntry" ORDER BY "studentId"')).rows;
            assert.deepEqual(opening.map(row => ({ id: row.studentId, accountBalance: row.amount })), before);
            assert.ok(opening.every(row => row.kind === 'opening' && row.needsReview));
            await assert.rejects(client.query(sql));
            await client.query('ROLLBACK');
            assert.equal((await client.query('SELECT count(*)::int AS n FROM "StudentBalanceEntry"')).rows[0].n, 3);
        } finally {
            await client.query('ROLLBACK');
            await client.query('SET search_path TO public');
            await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.end();
        }
    });

    test('new accounts start at their exact balance; movements serialize and identical requests replay', async () => {
        const student = await user({ accountBalance: -12000 });
        const opening = (await entries(student))[0];
        assert.deepEqual([opening.amount, opening.balanceBefore, opening.balanceAfter, opening.needsReview], [-12000, 0, -12000, true]);
        const same = input(student, 1000);
        const [first, replay] = await Promise.all([movement(same), movement(same)]);
        assert.equal(first.id, replay.id);
        await assert.rejects(movement({ ...same, amount: 2000 }), { code: 'BALANCE_MOVEMENT_CONFLICT' });
        await Promise.all(Array.from({ length: 10 }, (_, index) => movement(input(student, index % 2 ? 400 : -200))));
        assert.equal(await balance(student), -10000);
        assert.equal((await entries(student)).length, 12);
        assert.equal(await prisma.payment.count(), 0);
        assert.equal(await prisma.cashTransaction.count(), 0);
    });

    test('direct writes, historical edits, erasure and unbalanced reversals are rejected by PostgreSQL', async () => {
        const student = await user();
        const entry = await movement(input(student, 4000));
        await assert.rejects(prisma.student.update({ where: { id: student.id }, data: { accountBalance: 99 } }), /BALANCE_LEDGER_REQUIRED/);
        await assert.rejects(prisma.$executeRaw`UPDATE "Student" SET "accountBalance" = 50 WHERE id = ${student.id}`, /BALANCE_LEDGER_REQUIRED/);
        await assert.rejects(prisma.studentBalanceEntry.update({ where: { id: entry.id }, data: { reason: 'erase proof' } }), /BALANCE_HISTORY_IMMUTABLE/);
        await assert.rejects(prisma.studentBalanceEntry.delete({ where: { id: entry.id } }), /BALANCE_HISTORY_IMMUTABLE/);
        await assert.rejects(prisma.student.delete({ where: { id: student.id } }));
        await assert.rejects(movement(input(student, -4000, { reversalOfId: entry.id, kind: 'lesson_reversal' })), /BALANCE_REVERSAL_INVALID/);
        assert.equal(await balance(student), 4000);
        assert.equal((await entries(student)).length, 2);
        const { resetOperationalData } = require('../src/services/operationalReset');
        await assert.rejects(resetOperationalData(), { code: 'BALANCE_HISTORY_PROTECTED' });
        assert.equal(await balance(student), 4000);
    });

    test('a later failure rolls the journal and balance back together; overflowing totals never change money', async () => {
        const student = await user({ accountBalance: 200 });
        const data = input(student, 1000);
        await assert.rejects(prisma.$transaction(async tx => { await recordBalanceMovement(tx, data); throw new Error('later failure'); }), /later failure/);
        assert.equal(await balance(student), 200);
        assert.equal((await entries(student)).length, 1);
        await movement(data);
        assert.equal(await balance(student), 1200);
        await assert.rejects(movement(input(student, 2147483647)));
        assert.equal(await balance(student), 1200);
    });

    test('payment, correction, refund and cancellation each have one linked journal movement', async () => {
        const student = await user();
        const payment = (await request('/payments', { studentId: student.id, amount: 4000, paymentMethod: 'cash' })).body.payment;
        assert.ok(payment);
        assert.equal((await request(`/payments/${payment.id}`, { amount: 6000, paymentMethod: 'cash' }, { method: 'PATCH' })).status, 200);
        const refundBody = { studentId: student.id, amount: 1000, originalPaymentId: payment.id, reason: 'Возврат', paymentMethod: 'cash' };
        const key = randomUUID();
        assert.equal((await request('/payments/refund', refundBody, { key })).status, 201);
        assert.equal((await request('/payments/refund', refundBody, { key })).status, 201);
        const mistaken = (await request('/payments', { studentId: student.id, amount: 500, paymentMethod: 'cash' })).body.payment;
        assert.equal((await request(`/payments/${mistaken.id}`, { reason: 'Ошибка' }, { method: 'DELETE' })).status, 200);
        assert.equal(await balance(student), 5000);
        const journal = await entries(student);
        assert.deepEqual(journal.map(entry => entry.amount), [0, 4000, 2000, -1000, 500, -500]);
        assert.deepEqual(journal.slice(1).map(entry => entry.kind), ['payment', 'payment_correction', 'payment_refund', 'payment', 'payment_cancellation']);
        assert.ok(journal.slice(1).every(entry => entry.actorId === admin.id && entry.sourceType === 'payment'));
    });

    test('manual adjustment is durable, rejects conflicting replay, and journal paging stays private', async () => {
        const student = await user();
        const path = `/students/${student.id}/balance-adjustment`;
        const body = { amount: 3000, reason: 'Подтверждённый остаток' }; const key = randomUUID();
        const results = await Promise.all([request(path, body, { key }), request(path, body, { key })]);
        assert.equal(results[0].status, 200); assert.deepEqual(results[0], results[1]);
        assert.deepEqual(await request(path, body, { key, token: jwt.sign({ id: admin.id, jti: randomUUID() }, process.env.JWT_SECRET) }), results[0]);
        assert.equal((await request(path, { ...body, amount: 4000 }, { key })).status, 409);
        assert.equal(await balance(student), 3000);
        assert.equal(await prisma.cashTransaction.count(), 0);
        for (let i = 0; i < 51; i++) await movement(input(student, 1));
        const page = await request(`/students/${student.id}/balance-ledger`);
        assert.equal(page.status, 200); assert.equal(page.body.entries.length, 50);
        assert.equal(page.body.summary.balance, 3051); assert.equal(page.body.summary.consistent, true);
        const last = await request(`/students/${student.id}/balance-ledger?before=${page.body.nextBefore}`);
        assert.equal(last.body.entries.length, 3); assert.equal(last.body.nextBefore, null);
        for (const actor of [sales, teacher]) assert.equal((await request(`/students/${student.id}/balance-ledger`, null, { actor })).status, 403);
        assert.equal((await request(`/students/${student.id}/balance-ledger?before=abc`)).status, 400);
    });

    test('lesson reopen reverses the saved charge, then approval at a changed rate creates a new movement', async () => {
        const student = await user({ accountBalance: 6000 });
        const membership = await prisma.membership.create({ data: rateCardMembershipData({ studentId: student.id, name: 'QA', rates: { individual: 4000 } }) });
        const lesson = await prisma.class.create({ data: { title: 'Ledger lesson', date: new Date(Date.now() - 86400000 * 2), startTime: '09:00', endTime: '09:45',
            classType: 'individual', individualStudentId: student.id, teacherId: teacher.id, status: 'pending_admin_review', topic: 'Аккорды', lessonSummary: 'Итог' } });
        await prisma.classAttendee.create({ data: { classId: lesson.id, studentId: student.id, attended: true, attendanceStatus: 'present' } });
        const approve = amount => request(`/classes/${lesson.id}/approve`, { billingDecisions: [{ studentId: student.id, membershipId: membership.id, attendanceStatus: 'present', amount }] });
        let result = await approve(4000); assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(await balance(student), 2000);
        result = await request(`/classes/${lesson.id}/reopen`, { reason: 'Проверка' }); assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(await balance(student), 6000);
        await prisma.membership.update({ where: { id: membership.id }, data: { lessonRates: { individual: { basePrice: 5000, price: 5000 } } } });
        result = await approve(5000); assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(await balance(student), 1000);
        const journal = await entries(student);
        assert.deepEqual(journal.map(entry => entry.amount), [6000, -4000, 4000, -5000]);
        assert.equal(journal[2].reversalOfId, journal[1].id);
    });
}
