const test = require('node:test');
const assert = require('node:assert/strict');

const {
    TRIAL_REFUND_POLICY_HOURS,
    classifyTrialRefund,
    refundTrialPayment,
    trialRefundView,
} = require('../src/services/trialRefund');
const { trialRefundMessage } = require('../src/services/trialInvitation');

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-08T10:00:00.000Z');
const admin = { id: 'admin-1', role: 'admin' };
const superAdmin = { id: 'owner-1', role: 'super_admin' };

function makeTx({ booking = {}, income = {}, cls = {} } = {}) {
    const state = {
        booking: {
            id: 'booking-1',
            name: 'Анна',
            lastName: 'Тестова',
            middleName: null,
            phone: '8 701 123 45 67',
            status: 'trial',
            trialFunnelStage: 'scheduled',
            trialScheduledAt: new Date(NOW.getTime() + 3 * 24 * HOUR),
            trialClassId: 'class-1',
            convertedToStudentId: null,
            depositPaid: true,
            ...booking,
        },
        income: income === null ? null : {
            id: 'cash-income-1',
            type: 'income',
            category: 'trial_payment',
            amount: 2000,
            paymentMethod: 'kaspi_pay',
            date: new Date(NOW.getTime() - 24 * HOUR),
            refundedBy: null,
            ...income,
        },
        cls: cls === null ? null : { id: 'class-1', status: 'scheduled', teacherId: 'teacher-1', ...cls },
        created: [],
        notifications: [],
        classUpdates: [],
        activity: [],
        bookingUpdates: [],
    };
    const tx = {
        state,
        $queryRawUnsafe: async () => [],
        $queryRaw: async () => (state.income ? [{ id: state.income.id }] : []),
        booking: {
            findUnique: async () => state.booking,
            update: async ({ data }) => {
                state.bookingUpdates.push(data);
                state.booking = { ...state.booking, ...data };
                return state.booking;
            },
        },
        cashTransaction: {
            findUnique: async () => state.income,
            create: async ({ data }) => {
                const row = { id: `cash-refund-${state.created.length + 1}`, ...data };
                state.created.push(row);
                return row;
            },
        },
        integrationLog: { create: async ({ data }) => { state.notifications.push(data); return data; } },
        class: {
            findUnique: async () => (state.cls ? { ...state.cls } : null),
            updateMany: async ({ where, data }) => {
                state.classUpdates.push({ where, data });
                if (state.cls && where.status.in.includes(state.cls.status)) {
                    state.cls.status = data.status;
                    return { count: 1 };
                }
                return { count: 0 };
            },
        },
        activityLog: { create: async ({ data }) => { state.activity.push(data); return data; } },
    };
    return tx;
}

const run = (tx, extra = {}) => refundTrialPayment(tx, {
    bookingId: 'booking-1', actor: admin, reason: 'Клиент заболел', now: NOW, ...extra,
});

test('правило: ровно 24 часа до урока — по правилу, 23 ч 59 мин — нет', () => {
    const scheduled = new Date(NOW.getTime() + TRIAL_REFUND_POLICY_HOURS * HOUR);
    assert.deepEqual(classifyTrialRefund({ trialScheduledAt: scheduled, cancelledAt: NOW }), { withinPolicy: true, hoursBefore: 24 });
    const almost = new Date(scheduled.getTime() - 60 * 1000);
    assert.deepEqual(classifyTrialRefund({ trialScheduledAt: almost, cancelledAt: NOW }), { withinPolicy: false, hoursBefore: 23 });
});

test('правило: без даты урока — по правилу, после урока часы отрицательные', () => {
    assert.deepEqual(classifyTrialRefund({ trialScheduledAt: null, cancelledAt: NOW }), { withinPolicy: true, hoursBefore: null });
    const passed = new Date(NOW.getTime() - 90 * 60 * 1000);
    const result = classifyTrialRefund({ trialScheduledAt: passed, cancelledAt: NOW });
    assert.equal(result.withinPolicy, false);
    assert.equal(result.hoursBefore, -2);
});

test('возврат по правилу: расход равен приходу, ссылка на приход, заявка закрыта, урок отменён', async () => {
    const tx = makeTx();
    const result = await run(tx);

    assert.equal(tx.state.created.length, 1);
    const refund = tx.state.created[0];
    assert.equal(refund.type, 'expense');
    assert.equal(refund.amount, 2000);
    assert.equal(refund.category, 'trial_refund');
    assert.equal(refund.refundOfCashTransactionId, 'cash-income-1');
    assert.equal(refund.relatedBookingId, undefined);
    assert.equal(refund.paymentMethod, 'kaspi_pay');
    assert.equal(refund.createdById, 'admin-1');
    assert.equal(refund.notes, 'Клиент заболел');
    assert.equal(tx.state.notifications.length, 1);

    assert.equal(result.policy.withinPolicy, true);
    assert.equal(result.classCancelled, true);
    assert.equal(result.classRecord.status, 'cancelled');
    assert.equal(tx.state.cls.status, 'cancelled');
    const update = tx.state.bookingUpdates[0];
    assert.equal(update.depositPaid, false);
    assert.equal(update.trialRefundOutsidePolicy, false);
    assert.equal(update.trialRefundedById, 'admin-1');
    assert.equal(update.status, 'rejected');
    assert.equal(update.trialFunnelStage, 'rejected');
    assert.equal(update.lossStage, 'before_trial');
    assert.equal(update.lossReason, 'Клиент заболел');
    assert.equal(tx.state.activity.length, 1);
    assert.equal(tx.state.activity[0].action, 'trial_refund');
    assert.equal(tx.state.activity[0].metadata.withinPolicy, true);
});

test('счёт возврата по умолчанию — счёт прихода, можно выбрать другой настоящий счёт', async () => {
    const tx = makeTx({ income: { paymentMethod: 'kaspi' } });
    await run(tx);
    assert.equal(tx.state.created[0].paymentMethod, 'kaspi');
    const other = makeTx();
    await run(other, { paymentMethod: 'cash' });
    assert.equal(other.state.created[0].paymentMethod, 'cash');
});

test('неверный счёт возврата — 400 и ничего не записано', async () => {
    const tx = makeTx();
    await assert.rejects(run(tx, { paymentMethod: 'bitcoin' }),
        (error) => error.code === 'INVALID_PAYMENT_METHOD' && error.statusCode === 400);
    assert.equal(tx.state.created.length, 0);
});

test('второй возврат того же прихода — 409', async () => {
    const tx = makeTx({ income: { refundedBy: { id: 'cash-refund-1' } } });
    await assert.rejects(run(tx),
        (error) => error.code === 'TRIAL_PAYMENT_ALREADY_REFUNDED' && error.statusCode === 409);
    assert.equal(tx.state.created.length, 0);
});

test('нет прихода — 404, нет заявки — 404', async () => {
    await assert.rejects(run(makeTx({ income: null })),
        (error) => error.code === 'TRIAL_PAYMENT_NOT_FOUND' && error.statusCode === 404);
    const tx = makeTx();
    tx.booking.findUnique = async () => null;
    await assert.rejects(run(tx), (error) => error.code === 'BOOKING_NOT_FOUND' && error.statusCode === 404);
});

test('менеджер продаж и любая другая роль — 403', async () => {
    for (const role of ['sales_manager', 'teacher', 'student', undefined]) {
        const tx = makeTx();
        await assert.rejects(run(tx, { actor: { id: 'u-1', role } }),
            (error) => error.code === 'FORBIDDEN' && error.statusCode === 403);
        assert.equal(tx.state.created.length, 0);
    }
});

test('причина обязательна и не длиннее 200 знаков; отмена в будущем и раньше оплаты — 400', async () => {
    for (const reason of ['', '   ', undefined, 'я'.repeat(201)]) {
        await assert.rejects(run(makeTx(), { reason }),
            (error) => error.code === 'INVALID_REFUND_INPUT' && error.statusCode === 400);
    }
    await run(makeTx(), { reason: 'я'.repeat(200) });
    await assert.rejects(run(makeTx(), { cancelledAt: new Date(NOW.getTime() + 60 * 1000).toISOString() }),
        (error) => error.code === 'INVALID_REFUND_INPUT');
    await assert.rejects(run(makeTx(), { cancelledAt: new Date(NOW.getTime() - 48 * HOUR).toISOString() }),
        (error) => error.code === 'INVALID_REFUND_INPUT');
    await assert.rejects(run(makeTx(), { cancelledAt: 'не дата' }),
        (error) => error.code === 'INVALID_REFUND_INPUT');
});

test('меньше суток: без отметки — 400 с часами, с отметкой — проходит с пометкой и флагом', async () => {
    const soon = { trialScheduledAt: new Date(NOW.getTime() + 5 * HOUR) };
    const refused = makeTx({ booking: soon });
    await assert.rejects(run(refused),
        (error) => error.code === 'TRIAL_REFUND_OUTSIDE_POLICY' && error.statusCode === 400 && error.details.hoursBefore === 5);
    assert.equal(refused.state.created.length, 0);
    assert.equal(refused.state.cls.status, 'scheduled');

    const tx = makeTx({ booking: soon });
    const result = await run(tx, { overridePolicy: true });
    assert.equal(result.policy.withinPolicy, false);
    assert.match(tx.state.created[0].notes, /Вне правила: 5 ч до урока/);
    assert.equal(tx.state.bookingUpdates[0].trialRefundOutsidePolicy, true);
    assert.equal(tx.state.activity[0].metadata.overridePolicy, true);
    assert.equal(tx.state.activity[0].metadata.hoursBefore, 5);
    assert.match(tx.state.activity[0].details, /вне правила/);
});

test('super_admin тоже может вернуть вне правила', async () => {
    const tx = makeTx({ booking: { trialScheduledAt: new Date(NOW.getTime() + 2 * HOUR) } });
    await run(tx, { actor: superAdmin, overridePolicy: true });
    assert.equal(tx.state.created[0].createdById, 'owner-1');
});

test('урок проведён: возврат только вне правила, урок и статус заявки не меняются', async () => {
    const held = {
        booking: { status: 'trial', trialScheduledAt: new Date(NOW.getTime() - 3 * HOUR) },
        cls: { status: 'completed' },
    };
    await assert.rejects(run(makeTx(held)), (error) => error.code === 'TRIAL_REFUND_OUTSIDE_POLICY');

    for (const classStatus of ['completed', 'pending_admin_review']) {
        const tx = makeTx({ ...held, cls: { status: classStatus } });
        const result = await run(tx, { overridePolicy: true });
        assert.equal(result.classCancelled, false);
        assert.equal(tx.state.classUpdates.length, 0);
        assert.equal(tx.state.cls.status, classStatus);
        const update = tx.state.bookingUpdates[0];
        assert.equal(update.depositPaid, false);
        assert.equal(update.status, undefined);
        assert.equal(update.lossReason, undefined);
        assert.match(tx.state.created[0].notes, /Вне правила: после начала урока/);
    }
});

test('заявка в статусах sold / rejected или с карточкой ученика: статус не трогаем, деньги возвращаем', async () => {
    for (const booking of [{ status: 'sold' }, { status: 'rejected' }, { convertedToStudentId: 'student-1' }]) {
        const tx = makeTx({ booking });
        await run(tx);
        assert.equal(tx.state.created.length, 1);
        assert.equal(tx.state.bookingUpdates[0].status, undefined);
    }
});

test('без даты и без урока: по правилу, урок не трогаем, заявка закрывается', async () => {
    const tx = makeTx({ booking: { trialScheduledAt: null, trialClassId: null }, cls: null });
    const result = await run(tx);
    assert.equal(result.policy.withinPolicy, true);
    assert.equal(result.classCancelled, false);
    assert.equal(tx.state.bookingUpdates[0].status, 'rejected');
});

test('урок уже отменён: повторной отмены нет, заявка закрывается', async () => {
    const tx = makeTx({ cls: { status: 'cancelled' } });
    const result = await run(tx);
    assert.equal(result.classCancelled, false);
    assert.equal(tx.state.classUpdates.length, 0);
    assert.equal(tx.state.bookingUpdates[0].status, 'rejected');
});

test('trialRefundView: кнопка только админам и только пока возврата нет', () => {
    const income = { id: 'i', refundedBy: null };
    assert.equal(trialRefundView({}, income, 'admin').trialRefundAvailable, true);
    assert.equal(trialRefundView({}, income, 'super_admin').trialRefundAvailable, true);
    assert.equal(trialRefundView({}, income, 'sales_manager').trialRefundAvailable, false);
    assert.equal(trialRefundView({}, null, 'admin').trialRefundAvailable, false);
    const refunded = trialRefundView(
        { trialRefundReason: 'Болезнь', trialRefundOutsidePolicy: true },
        { id: 'i', refundedBy: { id: 'r', date: NOW, paymentMethod: 'cash' } },
        'admin',
    );
    assert.equal(refunded.trialRefundAvailable, false);
    assert.deepEqual(refunded.trialRefund, { date: NOW, paymentMethod: 'cash', reason: 'Болезнь', outsidePolicy: true });
    const forTeacher = trialRefundView({ trialRefundReason: 'Болезнь' }, { id: 'i', refundedBy: { id: 'r', date: NOW } }, 'teacher');
    assert.equal(forTeacher.trialRefund.reason, null);
});

test('сообщение клиенту: с датой и без неё, без обещанного срока зачисления', () => {
    const withDate = trialRefundMessage({ name: 'Анна', phone: '8 701 123 45 67', trialScheduledAt: '2026-11-10T10:00:00.000Z' });
    assert.match(withDate.message, /^Здравствуйте, Анна! Запись на диагностический урок .*10 ноября.*15:00 отменена\./);
    assert.match(withDate.message, /2\s000 ₸ вернём на Kaspi/);
    assert.doesNotMatch(withDate.message, /дн(ей|я)|рабочих/);
    assert.ok(withDate.whatsappUrl.startsWith('https://wa.me/77011234567?text='));
    const noDate = trialRefundMessage({ name: '', phone: '', trialScheduledAt: null });
    assert.match(noDate.message, /^Здравствуйте! Запись на диагностический урок отменена\./);
    assert.equal(noDate.whatsappUrl, '');
});
