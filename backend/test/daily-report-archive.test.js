const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildDailyAdminKpis,
    markDailyReportTelegramResult,
    persistDailyReportSnapshot,
    summarizeDailyReportArchive,
} = require('../src/services/dailyReportArchive');

test('summarizeDailyReportArchive keeps end-of-day backlog history and aggregates staff KPI', () => {
    const reports = [
        {
            reportDate: '2026-07-03',
            sentToTelegram: true,
            unclosedTasks: 0,
            unclosedBreakdown: [],
            adminKpis: [
                {
                    adminId: 'admin-1',
                    adminName: 'Иванова Анна',
                    role: 'admin',
                    activityCount: 6,
                    bookingsProcessed: 2,
                    lessonsReviewed: 3,
                    paymentsProcessed: 1,
                    paymentAmount: 25000,
                    remindersSent: 0,
                    completedActions: 6,
                },
            ],
        },
        {
            reportDate: '2026-07-02',
            sentToTelegram: false,
            unclosedTasks: 5,
            unclosedBreakdown: [
                { label: 'Новые заявки', count: 2 },
                { label: 'Отчёты на подтверждении', count: 3 },
            ],
            adminKpis: [
                {
                    adminId: 'admin-1',
                    adminName: 'Иванова Анна',
                    role: 'admin',
                    activityCount: 4,
                    bookingsProcessed: 1,
                    lessonsReviewed: 1,
                    paymentsProcessed: 0,
                    paymentAmount: 0,
                    remindersSent: 2,
                    completedActions: 4,
                },
                {
                    adminId: 'admin-2',
                    adminName: 'Петров Пётр',
                    role: 'super_admin',
                    activityCount: 0,
                    bookingsProcessed: 0,
                    lessonsReviewed: 0,
                    paymentsProcessed: 0,
                    paymentAmount: 0,
                    remindersSent: 0,
                    completedActions: 0,
                },
            ],
        },
    ];

    const result = summarizeDailyReportArchive(reports);

    assert.equal(result.reportDays, 2);
    assert.equal(result.sentDays, 1);
    assert.equal(result.unclosedTaskDays, 5);
    assert.equal(result.averageUnclosedTasks, 2.5);
    assert.equal(result.maxUnclosedTasks, 5);
    assert.equal(result.latestUnclosedTasks, 0);
    assert.equal(result.latestReportDate, '2026-07-03');
    assert.equal(result.daysWithoutBacklog, 1);
    assert.deepEqual(result.categories, [
        { label: 'Отчёты на подтверждении', count: 3 },
        { label: 'Новые заявки', count: 2 },
    ]);

    const anna = result.staff.find(row => row.adminId === 'admin-1');
    assert.equal(anna.reportDays, 2);
    assert.equal(anna.activeDays, 2);
    assert.equal(anna.completedActions, 10);
    assert.equal(anna.lessonsReviewed, 4);
    assert.equal(anna.paymentAmount, 25000);
    assert.equal(anna.averageActionsPerReportDay, 5);

    const petr = result.staff.find(row => row.adminId === 'admin-2');
    assert.equal(petr.reportDays, 1);
    assert.equal(petr.activeDays, 0);
    assert.equal(petr.averageActionsPerReportDay, 0);
});

test('buildDailyAdminKpis uses attributable CRM actions instead of assigning team backlog', async () => {
    const db = {
        student: {
            findMany: async () => [
                {
                    id: 'admin-1',
                    name: 'Анна',
                    lastName: 'Иванова',
                    middleName: null,
                    role: 'admin',
                },
            ],
        },
        activityLog: {
            groupBy: async ({ where }) => (
                where.entityType === 'WhatsAppReminder'
                    ? [{ userId: 'admin-1', _count: { _all: 2 } }]
                    : [{ userId: 'admin-1', _count: { _all: 9 } }]
            ),
        },
        booking: {
            groupBy: async () => [{ processedById: 'admin-1', _count: { _all: 3 } }],
        },
        class: {
            groupBy: async () => [{ reviewedById: 'admin-1', _count: { _all: 4 } }],
        },
        payment: {
            groupBy: async () => [{
                managerId: 'admin-1',
                _count: { _all: 1 },
                _sum: { amount: 18000 },
            }],
        },
    };

    const rows = await buildDailyAdminKpis(
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-07-02T00:00:00.000Z'),
        db,
    );

    assert.deepEqual(rows, [
        {
            adminId: 'admin-1',
            adminName: 'Иванова Анна',
            role: 'admin',
            activityCount: 9,
            bookingsProcessed: 3,
            lessonsReviewed: 4,
            paymentsProcessed: 1,
            paymentAmount: 18000,
            remindersSent: 2,
            completedActions: 10,
        },
    ]);
});

test('persistDailyReportSnapshot upserts one report per date and replaces staff snapshots', async () => {
    const calls = {};
    const tx = {
        dailyReportSnapshot: {
            upsert: async args => {
                calls.upsert = args;
                return { id: 'report-1', reportDate: '2026-07-04', sentToTelegram: true };
            },
        },
        dailyAdminKpiSnapshot: {
            deleteMany: async args => { calls.deleteMany = args; },
            createMany: async args => { calls.createMany = args; },
        },
    };
    const db = {
        $transaction: async callback => callback(tx),
    };
    const stats = {
        date: '2026-07-04',
        generatedAt: '2026-07-04T16:00:00.000Z',
        adminId: 'admin-1',
        admin: 'Иванова Анна',
        attention: {
            total: 3,
            tasks: [{ label: 'Новые заявки', count: 3 }],
        },
        administration: {
            staff: [{
                adminId: 'admin-1',
                adminName: 'Иванова Анна',
                role: 'admin',
                activityCount: 8,
                bookingsProcessed: 2,
                lessonsReviewed: 3,
                paymentsProcessed: 1,
                paymentAmount: 12000,
                remindersSent: 1,
                completedActions: 7,
            }],
        },
        aiComment: 'Закрыть новые заявки.',
    };

    const result = await persistDailyReportSnapshot(stats, {
        source: 'manual',
        generatedById: 'admin-1',
    }, db);

    assert.equal(result.id, 'report-1');
    assert.equal(calls.upsert.where.reportDate, '2026-07-04');
    assert.equal(calls.upsert.create.unclosedTasks, 3);
    assert.equal(calls.upsert.update.unclosedTasks, 3);
    assert.equal(calls.upsert.update.sentToTelegram, undefined);
    assert.deepEqual(calls.upsert.create.unclosedBreakdown, [
        { label: 'Новые заявки', count: 3 },
    ]);
    assert.deepEqual(calls.deleteMany, { where: { dailyReportId: 'report-1' } });
    assert.equal(calls.createMany.data[0].completedActions, 7);
    assert.equal(calls.createMany.data[0].dailyReportId, 'report-1');
});

test('markDailyReportTelegramResult increments send history only after successful delivery', async () => {
    let updateArgs = null;
    const db = {
        dailyReportSnapshot: {
            update: async args => {
                updateArgs = args;
                return { id: 'report-1' };
            },
        },
    };

    assert.equal(await markDailyReportTelegramResult('2026-07-04', false, db), null);
    assert.equal(updateArgs, null);

    await markDailyReportTelegramResult('2026-07-04', true, db);
    assert.equal(updateArgs.where.reportDate, '2026-07-04');
    assert.equal(updateArgs.data.sentToTelegram, true);
    assert.deepEqual(updateArgs.data.sendCount, { increment: 1 });
    assert.ok(updateArgs.data.lastSentAt instanceof Date);
});
