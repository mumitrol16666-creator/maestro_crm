const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('trial refund HTTP + PostgreSQL', { skip: 'TEST_DATABASE_URL required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /test|qa/.test(url.pathname));
    Object.assign(process.env, {
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        NODE_ENV: 'test',
        JWT_SECRET: 'trial-refund-test-secret',
        TELEGRAM_CASHBOX_NOTIFICATIONS_ENABLED: 'false',
        // Nothing listens here: the platform notification fails and is only journalled.
        LEARNING_PLATFORM_API_URL: 'http://127.0.0.1:9',
    });
    const express = require('express');
    const { prisma } = require('../src/config/db');
    const { signSession } = require('../src/utils/sessionVersion');
    const { syncTrialPayment } = require('../src/services/trialPayment');

    const HOUR = 60 * 60 * 1000;
    const users = {};
    const created = { bookings: [], classes: [], rooms: [] };
    let server;
    let base;

    const call = async (method, path, role, body, key = randomUUID()) => {
        const response = await fetch(base + path, {
            method,
            headers: {
                Authorization: `Bearer ${signSession(users[role])}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': key,
            },
            ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }),
        });
        return { status: response.status, body: await response.json() };
    };

    async function makeTrial({ hoursAhead = 72, classStatus = 'scheduled', paid = true, method = 'kaspi_pay' } = {}) {
        const scheduledAt = new Date(Date.now() + hoursAhead * HOUR);
        const room = await prisma.room.create({ data: { name: `Refund room ${randomUUID()}` } });
        created.rooms.push(room.id);
        const cls = await prisma.class.create({
            data: {
                title: 'Пробный урок — Возврат', date: scheduledAt, startTime: '15:00', endTime: '15:30', duration: 30,
                teacherId: users.teacher.id, roomId: room.id, classType: 'trial', status: classStatus,
            },
        });
        created.classes.push(cls.id);
        const booking = await prisma.booking.create({
            data: {
                name: 'Анна', lastName: 'Возвратова', phone: '+77011234567', phoneDigits: '77011234567',
                direction: 'Фортепиано', requestType: 'trial', status: 'trial', trialFunnelStage: 'scheduled',
                trialScheduledAt: scheduledAt, trialClassId: cls.id, trialTeacherId: users.teacher.id,
                depositPaid: paid, isTest: false,
            },
        });
        created.bookings.push(booking.id);
        let income = null;
        if (paid) {
            income = await prisma.$transaction((tx) => syncTrialPayment(tx, booking, {
                paid: true, actorId: users.admin.id, paymentMethod: method,
            }));
        }
        return { booking, cls, income };
    }

    const summaryToday = async () => {
        const day = new Date().toISOString().slice(0, 10);
        const response = await call('GET', `/api/cashbox/summary?from=${day}&to=${day}`, 'admin');
        assert.equal(response.status, 200);
        const accounts = Object.fromEntries(response.body.schoolAccounts.map((a) => [a.paymentMethod, a.currentBalance]));
        return { ...response.body.summary, accounts };
    };
    const trialMetrics = async () => {
        const response = await call('GET', '/api/analytics/overview', 'admin');
        assert.equal(response.status, 200, JSON.stringify(response.body));
        return response.body.period_metrics;
    };

    test.before(async () => {
        // Test database only: a crashed permission test may leave restricted role grants behind.
        await prisma.rolePermissions.deleteMany();
        for (const role of ['admin', 'super_admin', 'sales_manager', 'teacher']) {
            users[role] = await prisma.student.create({
                data: { name: `Refund ${role}`, lastName: 'Test', role, phone: randomUUID(), password: 'unused' },
            });
        }
        const app = express();
        app.use(express.json());
        app.use('/api/bookings', require('../src/routes/bookings'));
        app.use('/api/cashbox', require('../src/routes/cashbox'));
        app.use('/api/analytics', require('../src/routes/analytics'));
        server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        base = `http://127.0.0.1:${server.address().port}`;
    });

    test.after(async () => {
        if (server) await new Promise((resolve) => server.close(resolve));
        const userIds = Object.values(users).map((u) => u.id);
        const cash = await prisma.cashTransaction.findMany({
            where: { OR: [{ relatedBookingId: { in: created.bookings } }, { createdById: { in: userIds } }] },
            select: { id: true },
        });
        const cashIds = cash.map((c) => c.id);
        await prisma.integrationLog.deleteMany({
            where: { OR: [{ entityId: { in: [...cashIds, ...created.classes] } }] },
        });
        await prisma.cashTransaction.deleteMany({ where: { id: { in: cashIds } } });
        await prisma.activityLog.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.financialRequest.deleteMany({ where: { actorId: { in: userIds } } });
        await prisma.booking.deleteMany({ where: { id: { in: created.bookings } } });
        await prisma.class.deleteMany({ where: { id: { in: created.classes } } });
        await prisma.room.deleteMany({ where: { id: { in: created.rooms } } });
        await prisma.student.deleteMany({ where: { id: { in: userIds } } });
        await prisma.$disconnect();
    });

    test('возврат за 3 дня: один расход, повтор с тем же ключом отдаёт тот же ответ, другой ключ — 409', async () => {
        const { booking, cls, income } = await makeTrial();
        const paymentsBefore = await prisma.payment.count();
        const before = await summaryToday();
        const metricsBefore = await trialMetrics();
        const key = randomUUID();
        const body = { reason: 'Клиент заболел', paymentMethod: 'kaspi_pay' };

        const first = await call('POST', `/api/bookings/${booking.id}/trial-refund`, 'admin', body, key);
        assert.equal(first.status, 201, JSON.stringify(first.body));
        assert.equal(first.body.refund.amount, 2000);
        assert.equal(first.body.classCancelled, true);
        assert.equal(first.body.policy.withinPolicy, true);
        assert.match(first.body.clientMessage.message, /2\s000 ₸ вернём на Kaspi/);
        assert.match(first.body.clientMessage.whatsappUrl, /^https:\/\/wa\.me\/77011234567\?text=/);

        const replay = await call('POST', `/api/bookings/${booking.id}/trial-refund`, 'admin', body, key);
        assert.equal(replay.status, 201);
        assert.deepEqual(replay.body, first.body);

        const otherKey = await call('POST', `/api/bookings/${booking.id}/trial-refund`, 'admin', body, randomUUID());
        assert.equal(otherKey.status, 409);
        assert.equal(otherKey.body.code, 'TRIAL_PAYMENT_ALREADY_REFUNDED');

        const changedBody = await call('POST', `/api/bookings/${booking.id}/trial-refund`, 'admin', { ...body, reason: 'Другая причина' }, key);
        assert.equal(changedBody.status, 409);
        assert.equal(changedBody.body.code, 'REQUEST_KEY_CONFLICT');

        const expenses = await prisma.cashTransaction.findMany({ where: { refundOfCashTransactionId: income.id } });
        assert.equal(expenses.length, 1);
        assert.equal(expenses[0].amount, 2000);
        assert.equal(expenses[0].type, 'expense');
        assert.equal(expenses[0].category, 'trial_refund');
        assert.equal(expenses[0].relatedBookingId, null);
        assert.equal(expenses[0].paymentMethod, 'kaspi_pay');
        assert.equal(await prisma.cashTransaction.count({ where: { relatedBookingId: booking.id } }), 1);

        const stored = await prisma.booking.findUnique({ where: { id: booking.id } });
        assert.equal(stored.depositPaid, false);
        assert.equal(stored.status, 'rejected');
        assert.equal(stored.trialFunnelStage, 'rejected');
        assert.equal(stored.lossStage, 'before_trial');
        assert.equal(stored.lossReason, 'Клиент заболел');
        assert.equal(stored.trialRefundOutsidePolicy, false);
        assert.equal(stored.trialRefundedById, users.admin.id);
        assert.equal((await prisma.class.findUnique({ where: { id: cls.id } })).status, 'cancelled');

        assert.equal(await prisma.activityLog.count({ where: { action: 'trial_refund', entityId: booking.id } }), 1);
        const outbox = await prisma.integrationLog.findMany({ where: { idempotencyKey: `telegram:cash:${expenses[0].id}` } });
        assert.equal(outbox.length, 1);
        assert.equal(outbox[0].status, 'pending');
        const platform = await prisma.integrationLog.findMany({
            where: { entityId: cls.id, operation: 'notifications.offline-lesson-cancelled' },
        });
        assert.equal(platform.length, 1, 'платформа получает событие отмены один раз (повтор не шлёт второе)');

        // Деньги: касса, счёт и аналитика.
        const after = await summaryToday();
        assert.equal(after.refundsTotal - before.refundsTotal, 2000);
        assert.equal(after.trialRefundsTotal - before.trialRefundsTotal, 2000);
        assert.equal(after.trialRefundsCount - before.trialRefundsCount, 1);
        assert.equal(after.realExpenses - before.realExpenses, 0, 'возврат диагностики не попадает в обычные расходы');
        assert.equal(after.profit - before.profit, -2000);
        assert.equal(after.accounts.kaspi_pay - before.accounts.kaspi_pay, -2000);
        const metrics = await trialMetrics();
        assert.equal(metrics.trialRevenue - metricsBefore.trialRevenue, -2000);
        assert.equal(metrics.trialRevenueGross - metricsBefore.trialRevenueGross, 0);
        assert.equal(metrics.trialRefunds - metricsBefore.trialRefunds, 2000);
        assert.equal(metrics.trialRefundsCount - metricsBefore.trialRefundsCount, 1);
        assert.equal(await prisma.payment.count(), paymentsBefore, 'студенческие платежи и баланс не затронуты');

        // Чтение: админ видит возврат, кнопки больше нет; менеджер продаж видит состояние.
        const asAdmin = await call('GET', `/api/bookings/${booking.id}`, 'admin');
        assert.equal(asAdmin.body.booking.trialRefundAvailable, false);
        assert.equal(asAdmin.body.booking.trialRefund.reason, 'Клиент заболел');
        assert.equal(asAdmin.body.booking.trialRefund.outsidePolicy, false);
        const asSales = await call('GET', `/api/bookings/${booking.id}`, 'sales_manager');
        assert.equal(asSales.body.booking.trialRefundAvailable, false);
        assert.equal(asSales.body.booking.trialRefund.paymentMethod, 'kaspi_pay');
    });

    test('вторая запись не создаёт приход на возвращённой заявке', async () => {
        const { booking } = await makeTrial();
        assert.equal((await call('POST', `/api/bookings/${booking.id}/trial-refund`, 'admin', { reason: 'Передумали' })).status, 201);
        await assert.rejects(
            prisma.$transaction((tx) => syncTrialPayment(tx, { ...booking, depositPaid: true }, { paid: true, actorId: users.admin.id })),
            (error) => error.code === 'TRIAL_PAYMENT_REFUNDED',
        );
        assert.equal(await prisma.cashTransaction.count({ where: { relatedBookingId: booking.id } }), 1);
    });

    test('кнопка возврата видна только админу и только пока возврата нет; менеджер продаж и учитель получают 403', async () => {
        const { booking } = await makeTrial();
        assert.equal((await call('GET', `/api/bookings/${booking.id}`, 'admin')).body.booking.trialRefundAvailable, true);
        assert.equal((await call('GET', `/api/bookings/${booking.id}`, 'super_admin')).body.booking.trialRefundAvailable, true);
        assert.equal((await call('GET', `/api/bookings/${booking.id}`, 'sales_manager')).body.booking.trialRefundAvailable, false);
        for (const role of ['sales_manager', 'teacher']) {
            const denied = await call('POST', `/api/bookings/${booking.id}/trial-refund`, role, { reason: 'x' });
            assert.equal(denied.status, 403);
        }
        assert.equal(await prisma.cashTransaction.count({ where: { category: 'trial_refund', refundOf: { relatedBookingId: booking.id } } }), 0);
        const noKey = await fetch(`${base}/api/bookings/${booking.id}/trial-refund`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${signSession(users.admin)}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'x' }),
        });
        assert.equal(noKey.status, 400);
        assert.equal((await noKey.json()).code, 'INVALID_REQUEST_KEY');
    });

    test('за 5 часов до урока: без отметки отказ, с отметкой возврат вне правила записан в кассу и журнал', async () => {
        const { booking, cls, income } = await makeTrial({ hoursAhead: 5 });
        const refused = await call('POST', `/api/bookings/${booking.id}/trial-refund`, 'admin', { reason: 'Не придём' });
        assert.equal(refused.status, 400);
        assert.equal(refused.body.code, 'TRIAL_REFUND_OUTSIDE_POLICY');
        assert.ok(refused.body.hoursBefore >= 4 && refused.body.hoursBefore <= 5);
        assert.equal((await prisma.class.findUnique({ where: { id: cls.id } })).status, 'scheduled');

        const allowed = await call('POST', `/api/bookings/${booking.id}/trial-refund`, 'super_admin', {
            reason: 'Не придём', overridePolicy: true, paymentMethod: 'cash',
        });
        assert.equal(allowed.status, 201, JSON.stringify(allowed.body));
        assert.equal(allowed.body.policy.withinPolicy, false);
        const expense = await prisma.cashTransaction.findUnique({ where: { refundOfCashTransactionId: income.id } });
        assert.match(expense.notes, /Не придём\. Вне правила: [45] ч до урока/);
        assert.equal(expense.paymentMethod, 'cash');
        assert.equal((await prisma.booking.findUnique({ where: { id: booking.id } })).trialRefundOutsidePolicy, true);
        const log = await prisma.activityLog.findFirst({ where: { action: 'trial_refund', entityId: booking.id } });
        assert.equal(log.userId, users.super_admin.id);
        assert.equal(log.metadata.withinPolicy, false);
        assert.equal(log.metadata.overridePolicy, true);
    });

    test('урок уже проведён: возврат вне правила не меняет урок и статус заявки', async () => {
        const { booking, cls } = await makeTrial({ hoursAhead: -3, classStatus: 'completed' });
        const result = await call('POST', `/api/bookings/${booking.id}/trial-refund`, 'admin', { reason: 'Недоволен', overridePolicy: true });
        assert.equal(result.status, 201, JSON.stringify(result.body));
        assert.equal(result.body.classCancelled, false);
        const stored = await prisma.booking.findUnique({ where: { id: booking.id } });
        assert.equal(stored.status, 'trial');
        assert.equal(stored.depositPaid, false);
        assert.ok(stored.trialRefundedAt);
        assert.equal(stored.lossReason, null);
        assert.equal((await prisma.class.findUnique({ where: { id: cls.id } })).status, 'completed');
    });

    test('две одновременные попытки с разными ключами: ровно один расход', async () => {
        const { booking, income } = await makeTrial();
        const results = await Promise.all([
            call('POST', `/api/bookings/${booking.id}/trial-refund`, 'admin', { reason: 'Гонка А' }),
            call('POST', `/api/bookings/${booking.id}/trial-refund`, 'super_admin', { reason: 'Гонка Б' }),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        assert.equal(await prisma.cashTransaction.count({ where: { refundOfCashTransactionId: income.id } }), 1);
    });

    test('база не допускает второй возврат того же прихода', async () => {
        const { booking, income } = await makeTrial();
        assert.equal((await call('POST', `/api/bookings/${booking.id}/trial-refund`, 'admin', { reason: 'Раз' })).status, 201);
        await assert.rejects(
            prisma.cashTransaction.create({
                data: {
                    type: 'expense', amount: 2000, category: 'trial_refund', description: 'Дубль',
                    createdById: users.admin.id, refundOfCashTransactionId: income.id,
                },
            }),
            (error) => error.code === 'P2002',
        );
    });

    test('воронка по источникам: возвращённая оплата не считается оплаченной', async () => {
        const { booking } = await makeTrial();
        const before = (await call('GET', '/api/analytics/trials', 'admin')).body;
        const total = (body, key) => body.sources.reduce((sum, row) => sum + (row[key] || 0), 0);
        await call('POST', `/api/bookings/${booking.id}/trial-refund`, 'admin', { reason: 'Воронка' });
        const after = (await call('GET', '/api/analytics/trials', 'admin')).body;
        assert.equal(total(after, 'diagnosticPaid') - total(before, 'diagnosticPaid'), -1);
        assert.equal(total(after, 'diagnosticRevenue') - total(before, 'diagnosticRevenue'), -2000);
        assert.equal(total(after, 'diagnosticRefunded') - total(before, 'diagnosticRefunded'), 1);
    });

    test('жёсткое удаление заявки с приходом диагностики запрещено, без прихода — разрешено', async () => {
        const { booking } = await makeTrial();
        const blocked = await call('DELETE', `/api/bookings/${booking.id}?hardDelete=1`, 'admin');
        assert.equal(blocked.status, 400);
        assert.equal(blocked.body.code, 'BOOKING_HAS_TRIAL_PAYMENT');
        assert.ok(await prisma.booking.findUnique({ where: { id: booking.id } }));
        // Даже после возврата приход остаётся в кассе: удалять заявку по-прежнему нельзя.
        await call('POST', `/api/bookings/${booking.id}/trial-refund`, 'admin', { reason: 'Возврат' });
        assert.equal((await call('DELETE', `/api/bookings/${booking.id}?hardDelete=1`, 'admin')).status, 400);

        const free = await makeTrial({ paid: false });
        const removed = await call('DELETE', `/api/bookings/${free.booking.id}?hardDelete=1`, 'admin');
        assert.equal(removed.status, 200, JSON.stringify(removed.body));
        assert.equal(await prisma.booking.findUnique({ where: { id: free.booking.id } }), null);
    });
}
