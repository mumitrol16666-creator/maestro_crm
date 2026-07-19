const test = require('node:test');
const assert = require('node:assert/strict');

const {
    estimateCancelledClassRevenue,
    summarizeDailyLessons,
} = require('../src/services/dailyLessonReport');
const { formatEveningReportMessage } = require('../src/utils/telegram');

function membership(totalPrice, totalClasses, extra = {}) {
    return {
        totalPrice,
        totalClasses,
        lessonFormat: 'individual',
        type: 'monthly',
        ...extra,
    };
}

test('daily lesson summary counts the whole schedule, cancellations and missing reports', () => {
    const classes = [
        { id: '1', classType: 'individual', status: 'scheduled', isPractice: false },
        { id: '2', classType: 'group', status: 'scheduled', isPractice: false },
        { id: '3', classType: 'trial', status: 'not_filled', isPractice: false },
        {
            id: '4',
            classType: 'individual',
            status: 'cancelled',
            isPractice: false,
            individualStudent: {
                id: 'student-1',
                memberships: [membership(24000, 6)],
            },
        },
    ];

    assert.deepEqual(summarizeDailyLessons(classes), {
        scheduled: 4,
        active: 3,
        completed: 0,
        pendingReview: 0,
        awaitingReport: 3,
        notFilled: 1,
        cancelled: 1,
        cancelledLostRevenue: 4000,
    });
});

test('cancelled group revenue uses every student and subtracts already charged lessons', () => {
    const classItem = {
        id: 'group-class',
        classType: 'group',
        groupId: 'group-1',
        status: 'cancelled',
        group: {
            currentStudents: 2,
            students: [
                {
                    student: {
                        id: 'student-1',
                        memberships: [membership(12000, 8, { lessonFormat: 'group', groupId: 'group-1' })],
                    },
                },
                {
                    student: {
                        id: 'student-2',
                        memberships: [membership(12000, 8, { lessonFormat: 'group', groupId: 'group-1' })],
                    },
                },
            ],
        },
        attendees: [{ studentId: 'student-1', chargeAmount: 1500 }],
    };

    assert.equal(estimateCancelledClassRevenue(classItem), 1500);
});

test('rescheduled lesson does not become a cancellation or lost revenue', () => {
    const result = summarizeDailyLessons([{
        id: 'moved-class',
        classType: 'individual',
        status: 'scheduled',
        notes: 'Перенесено на другое время',
        isPractice: false,
    }]);

    assert.equal(result.cancelled, 0);
    assert.equal(result.cancelledLostRevenue, 0);
    assert.equal(result.awaitingReport, 1);
});

test('Telegram evening report shows schedule, missing reports, cancellations and loss', () => {
    const message = formatEveningReportMessage({
        date: '2026-07-19',
        admin: 'Админ',
        lessons: {
            scheduled: 4,
            active: 3,
            completed: 0,
            pendingReview: 0,
            awaitingReport: 3,
            cancelled: 1,
            cancelledLostRevenue: 4000,
        },
        trials: { scheduled: 0, completed: 0, pendingReview: 0, awaitingReport: 0, cancelled: 0 },
        bookings: {
            newNonParentChats: 0,
            bySource: [],
            whatsapp: {},
            rejected: 0,
            rejectionReasons: [],
        },
        finance: {
            membershipPaymentsCount: 0,
            revenue: 0,
            revenueByMethod: {},
            otherIncome: 0,
            otherIncomeByCategory: {},
            expenses: 0,
            expensesByCategory: {},
            cashBalance: 0,
            shopCashBalance: 0,
        },
        tomorrow: { plannedPaymentsCount: 0, expectedRevenue: 0, classes: 0, trials: 0, plan: [] },
        students: { active: 0, new: 0, pausedOrLeft: 0 },
        administration: { unclosedTasks: 0, totals: {} },
        attention: { total: 0, tasks: [] },
        aiComment: '—',
    });

    assert.match(message, /По расписанию на день: 4/);
    assert.match(message, /Без отчёта к концу дня: 3/);
    assert.match(message, /Отменено: 1/);
    assert.match(message, /Расчётная упущенная выручка: 4\s000 ₸/);
});
