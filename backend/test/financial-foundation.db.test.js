const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('financial foundation HTTP + PostgreSQL', { skip: 'TEST_DATABASE_URL required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /test|qa/.test(url.pathname));
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, JWT_SECRET: 'foundation-test-secret' });
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const { prisma } = require('../src/config/db');
    let server, base, admin, sales, staff, student;

    const makeUser = (role = 'student', extra = {}) => prisma.student.create({ data: {
        name: 'Foundation', lastName: 'QA', phone: randomUUID(), password: 'unused', role, ...extra,
    } });
    function token(user, extra = {}) { return jwt.sign({ userId: user.id, ...extra }, process.env.JWT_SECRET); }
    async function request(path, { method = 'GET', body, key = randomUUID(), user = admin, authToken, form = false } = {}) {
        const res = await fetch(base + path, { method, headers: {
            Authorization: `Bearer ${authToken || token(user)}`,
            'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
            ...(key ? { 'X-Idempotency-Key': key } : {}),
        }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
        return { status: res.status, body: await res.json() };
    }
    const topUp = (extra = {}) => ({ studentId: student.id, amount: 4000, paymentMethod: 'cash', ...extra });
    const balance = async () => (await prisma.student.findUnique({ where: { id: student.id } })).accountBalance;
    const post = (body = topUp(), key = randomUUID()) => request('/payments', { method: 'POST', body, key });

    test.before(async () => {
        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        const idempotency = require('../src/middleware/idempotency');
        app.use((req, res, next) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
            ? idempotency(req, res, next) : next());
        app.use('/api/payments', require('../src/routes/payments'));
        app.use('/api/students', require('../src/routes/students'));
        app.use('/api/cashbox', require('../src/routes/cashbox'));
        app.use('/api/salary', require('../src/routes/salary'));
        app.use('/api/admin', require('../src/routes/admin'));
        await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
        base = `http://127.0.0.1:${server.address().port}/api`;
    });
    test.beforeEach(async () => {
        // This suite is only allowed against a dedicated disposable local DB.
        const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
        for (const { tablename } of tables) {
            if (tablename !== '_prisma_migrations') await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE`);
        }
        admin = await makeUser('super_admin');
        sales = await makeUser('sales_manager');
        staff = await makeUser('staff');
        student = await makeUser();
    });
    test.after(async () => {
        await new Promise(resolve => server.close(resolve));
        await prisma.$disconnect();
    });

    test('concurrent requests and retry with a fresh JWT produce one payment and cash receipt', async () => {
        const key = randomUUID();
        const body = topUp();
        const results = await Promise.all([post(body, key), post(body, key)]);
        assert.equal(results[0].status, 201, JSON.stringify(results));
        assert.deepEqual(results[1], results[0]);
        await prisma.financialRequest.updateMany({ data: { createdAt: new Date('2020-01-01') } });
        const replay = await request('/payments', { method: 'POST', key, body, authToken: token(admin, { jti: randomUUID() }) });
        assert.deepEqual(replay, results[0]);
        assert.equal(await balance(), 4000);
        assert.equal(await prisma.payment.count(), 1);
        assert.equal(await prisma.cashTransaction.count(), 1);
        assert.equal(await prisma.financialRequest.count(), 1);
        const conflict = await post(topUp({ amount: 9000 }), key);
        assert.equal(conflict.status, 409);
        assert.equal(await balance(), 4000);
        const denied = await request('/payments', { method: 'POST', body, key, user: sales });
        assert.equal(denied.status, 403);
    });

    test('missing key, fractional money and malformed input have no side effects', async () => {
        assert.equal((await post(topUp(), null)).status, 400);
        for (const amount of [1000.99, '1000.99', '4000x', [4000], true, 2147483648]) {
            assert.equal((await post(topUp({ amount }))).status, 400);
        }
        assert.equal((await post(topUp({ paymentDate: 'bad-date' }))).status, 400);
        assert.equal(await prisma.payment.count(), 0);
        assert.equal(await balance(), 0);
    });

    test('payment URL aliases still check payload and current role before replay', async () => {
        const key = randomUUID();
        const authToken = token(admin);
        const alias = '/../../API/PAYMENTS';
        const options = { method: 'POST', body: topUp(), key, authToken };
        const created = await request(alias, options);
        assert.equal(created.status, 201);
        assert.deepEqual(await request('/payments', options), created);
        const changed = await request(alias, { ...options, body: topUp({ amount: 5000 }) });
        assert.equal(changed.status, 409);
        await prisma.student.update({ where: { id: admin.id }, data: { role: 'sales_manager' } });
        assert.equal((await request(alias, options)).status, 403);
        assert.equal(await balance(), 4000);
        assert.equal(await prisma.payment.count(), 1);
    });

    test('student write replay after role change cannot return an old privileged card', async () => {
        await prisma.student.update({ where: { id: student.id }, data: { accountBalance: 12500, monthlySalary: 12345 } });
        const path = `/../../API/STUDENTS/${student.id}`;
        const options = { method: 'PUT', body: {}, key: randomUUID(), authToken: token(admin) };
        const first = await request(path, options);
        assert.equal(first.status, 200);
        assert.equal(first.body.student.accountBalance, 12500);
        assert.deepEqual(await request(path, options), first);
        await prisma.student.update({ where: { id: admin.id }, data: { role: 'sales_manager' } });
        const downgraded = await request(path, options);
        assert.equal(downgraded.status, 200);
        assert.equal(downgraded.body.student.name, 'Foundation');
        for (const field of ['accountBalance', 'monthlySalary', 'salaryIndividual', 'memberships']) {
            assert.ok(!Object.hasOwn(downgraded.body.student, field), field);
        }
        await prisma.student.update({ where: { id: admin.id }, data: { status: 'inactive' } });
        assert.equal((await request(path, options)).status, 401);
    });

    test('top-up rejects all supplied payment links before recovery or money changes', async () => {
        const other = await makeUser();
        const linked = await prisma.payment.create({ data: {
            studentId: other.id, managerId: admin.id, amount: 5000, type: 'membership_full', status: 'refunded',
        } });
        await prisma.student.update({ where: { id: student.id }, data: {
            status: 'inactive', lostAt: new Date(), createdAt: new Date('2020-01-01'),
        } });
        for (const relatedPaymentId of [linked.id, 'missing', '', false, 0, [], [linked.id], { id: linked.id }]) {
            const response = await post(topUp({ relatedPaymentId }));
            assert.equal(response.status, 400, JSON.stringify(response));
        }
        const form = await request('/payments', { method: 'POST', form: true,
            body: `studentId=${student.id}&amount=4000&paymentMethod=cash&relatedPaymentId[id]=${linked.id}` });
        assert.equal(form.status, 400);
        assert.equal((await prisma.payment.findUnique({ where: { id: linked.id } })).status, 'refunded');
        assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).status, 'inactive');
        assert.equal(await prisma.studentRecovery.count(), 0);
        assert.equal(await prisma.cashTransaction.count(), 0);
        assert.equal(await balance(), 0);
        assert.equal((await post(topUp({ relatedPaymentId: null }))).status, 201);
    });

    test('cash write failure rolls back payment and recovery; the same key can then retry', async () => {
        await prisma.student.update({ where: { id: student.id }, data: {
            status: 'inactive', lostAt: new Date(), createdAt: new Date('2020-01-01'),
        } });
        const key = randomUUID();
        await prisma.$executeRawUnsafe('ALTER TABLE "CashTransaction" ADD CONSTRAINT "foundation_fail_cash" CHECK (amount < 0)');
        try {
            assert.equal((await post(topUp(), key)).status, 500);
            assert.equal(await prisma.payment.count(), 0);
            assert.equal(await prisma.financialRequest.count(), 0);
            assert.equal(await prisma.studentRecovery.count(), 0);
            assert.equal(await balance(), 0);
            assert.equal((await prisma.student.findUnique({ where: { id: student.id } })).status, 'inactive');
        } finally {
            await prisma.$executeRawUnsafe('ALTER TABLE "CashTransaction" DROP CONSTRAINT "foundation_fail_cash"');
        }
        assert.equal((await post(topUp(), key)).status, 201);
        assert.equal(await balance(), 4000);
        assert.equal(await prisma.studentRecovery.count(), 1);
    });

    test('partial refund replay and normal payment correction preserve exact balances', async () => {
        const payment = (await post()).body.payment;
        const refundBody = { studentId: student.id, amount: 1000, originalPaymentId: payment.id,
            reason: 'Частичный возврат', paymentMethod: 'cash' };
        const key = randomUUID();
        const refunds = await Promise.all([0, 1].map(() => request('/payments/refund', { method: 'POST', body: refundBody, key })));
        assert.equal(refunds[0].status, 201);
        assert.deepEqual(refunds[0], refunds[1]);
        assert.equal(await balance(), 3000);
        const edited = await request(`/payments/${payment.id}`, { method: 'PATCH', body: { amount: 5000, paymentMethod: 'cash' } });
        assert.equal(edited.status, 200, JSON.stringify(edited));
        assert.equal(await balance(), 4000);
    });

    test('cancellation keeps original records, adds one reversal, and rejects editing cancelled money', async () => {
        const payment = (await post()).body.payment;
        const originalCash = await prisma.cashTransaction.findFirst();
        const cancel = () => request(`/payments/${payment.id}`, { method: 'DELETE', body: { reason: 'Ошибочная оплата' } });
        assert.equal((await cancel()).status, 200);
        assert.equal((await cancel()).status, 200);
        const original = await prisma.payment.findUnique({ where: { id: payment.id } });
        assert.equal(original.amount, 4000);
        assert.equal(original.status, 'completed');
        assert.ok(original.cancelledAt);
        assert.deepEqual(await prisma.cashTransaction.findUnique({ where: { id: originalCash.id } }), originalCash);
        assert.equal(await prisma.payment.count({ where: { relatedPaymentId: payment.id, isCancellation: true } }), 1);
        assert.equal(await balance(), 0);
        const stats = await request('/admin/stats');
        assert.equal(stats.status, 200, JSON.stringify(stats));
        assert.equal(stats.body.stats.monthlyRevenue, 0);
        const history = await request(`/payments/student/${student.id}`);
        assert.equal(history.body.summary.totalPaid, 0);
        assert.equal(history.body.payments.length, 2);
        assert.equal((await request(`/students/${student.id}`)).body.student.lastPaymentDate, null);
        const edit = await request(`/payments/${payment.id}`, { method: 'PATCH', body: { amount: 6000, paymentMethod: 'cash' } });
        assert.equal(edit.status, 400);
        assert.equal((await request('/payments/refund', { method: 'POST', body: { studentId: student.id,
            originalPaymentId: payment.id, amount: 1, reason: 'test', paymentMethod: 'cash' } })).status, 400);
    });

    test('departure preserves positive balances and debt; permanent deletion cannot erase history', async () => {
        const payment = (await post()).body.payment;
        for (const amount of [4000, -12000]) {
            await prisma.student.update({ where: { id: student.id }, data: { accountBalance: amount, status: 'active' } });
            const departure = await request(`/students/${student.id}/finish-education`, { method: 'POST', body: { reason: 'moved' } });
            assert.equal(departure.status, 200, JSON.stringify(departure));
            assert.equal(await balance(), amount);
            const removal = await request(`/students/${student.id}/permanent`, { method: 'DELETE' });
            assert.equal(removal.status, 409);
            assert.ok(await prisma.payment.findUnique({ where: { id: payment.id } }));
            assert.equal(await prisma.cashTransaction.count(), 1);
        }
    });

    test('role projection protects card, update, list and print; admin employee editor still works', async () => {
        await prisma.student.update({ where: { id: student.id }, data: { accountBalance: 12500, monthlySalary: 12345 } });
        const forbidden = ['password', 'accountBalance', 'accountBalanceInitializedAt', 'monthlySalary', 'salaryIndividual',
            'salesCommissionPercent', 'payrollEnabled', 'employmentStartDate', 'staffPosition', 'debtAmount',
            'lastPaymentDate', 'memberships', 'payments', 'balanceCoverage', 'activeMembership'];
        for (const user of [sales, staff]) {
            const card = await request(`/students/${student.id}`, { user });
            assert.equal(card.status, 200, JSON.stringify(card));
            assert.equal(card.body.student.name, 'Foundation');
            for (const field of forbidden) assert.ok(!Object.hasOwn(card.body.student, field), field);
            assert.equal((await request(`/students/${admin.id}`, { user })).status, 404);
            const list = await request('/students?role=student', { user });
            assert.equal(list.status, 403);
            for (const item of list.body.students || []) for (const field of forbidden) assert.ok(!Object.hasOwn(item, field), field);
        }
        const update = await request(`/students/${student.id}`, { user: sales, method: 'PUT', body: {} });
        assert.equal(update.status, 200, JSON.stringify(update));
        for (const field of forbidden) assert.ok(!Object.hasOwn(update.body.student, field), field);
        const print = await request(`/students/${student.id}/print-data`, { user: sales });
        assert.equal(print.status, 200, JSON.stringify(print));
        assert.equal(print.body.financial, null);
        assert.ok(!Object.hasOwn(print.body.student, 'accountBalance'));
        const employee = await request(`/students/${admin.id}`);
        assert.equal(employee.status, 200);
        assert.equal(employee.body.student.monthlySalary, 0);
        assert.equal((await request(`/students/${student.id}`)).body.student.accountBalance, 12500);
    });

    test('cashbox, salary and manual adjustment reject fractional amounts', async () => {
        const cash = await request('/cashbox/transactions', { method: 'POST', body: {
            type: 'income', amount: '0.99', category: 'other', description: 'QA', paymentMethod: 'cash',
        } });
        assert.equal(cash.status, 400);
        assert.equal((await request(`/students/${student.id}/balance-adjustment`, { method: 'POST',
            body: { amount: '1000.99', reason: 'QA' } })).status, 400);
        assert.equal((await request('/salary/operations', { method: 'POST',
            body: { employeeId: admin.id, type: 'bonus', amount: 1000.99 } })).status, 400);
        assert.equal(await balance(), 0);
    });
}
