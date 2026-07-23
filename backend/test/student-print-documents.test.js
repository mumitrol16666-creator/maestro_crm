const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseStudentPrintRange,
    buildStudentAttendanceSummary,
    buildStudentFinancialStatement,
} = require('../src/services/studentPrintDocuments');

test('период печати включает выбранные дни целиком', () => {
    const range = parseStudentPrintRange('2026-07-01', '2026-07-31');
    assert.equal(range.start.toISOString(), '2026-07-01T00:00:00.000Z');
    assert.equal(range.end.toISOString(), '2026-07-31T23:59:59.999Z');
    assert.throws(
        () => parseStudentPrintRange('2026-08-01', '2026-07-31'),
        /Начало периода/,
    );
});

test('сводка посещаемости отдельно считает опоздания, пропуски и заморозки', () => {
    const summary = buildStudentAttendanceSummary([
        { attendanceStatus: 'present', chargeAmount: 4000 },
        { attendanceStatus: 'late', chargeAmount: 4000 },
        { attendanceStatus: 'excused_absence', chargeAmount: 0 },
        { attendanceStatus: 'unexcused_absence', chargeAmount: 4000 },
        { attendanceStatus: 'emergency_freeze', chargeAmount: 0 },
        { attendanceStatus: 'unmarked', chargeAmount: 0 },
    ]);

    assert.equal(summary.totalClasses, 6);
    assert.equal(summary.attendedCount, 2);
    assert.equal(summary.missedCount, 3);
    assert.equal(summary.unmarkedCount, 1);
    assert.equal(summary.attendanceRate, 40);
    assert.equal(summary.chargedTotal, 12000);
});

test('финансовая выписка восстанавливает начальный и конечный баланс периода', () => {
    const statement = buildStudentFinancialStatement({
        currentBalance: 9000,
        rangeEnd: new Date('2026-07-31T23:59:59.999Z'),
        payments: [
            {
                id: 'pay-1',
                paymentDate: new Date('2026-07-05T10:00:00.000Z'),
                status: 'completed',
                amount: 20000,
                type: 'membership_full',
                manager: { lastName: 'Админ' },
            },
            {
                id: 'pay-after',
                paymentDate: new Date('2026-08-03T10:00:00.000Z'),
                status: 'completed',
                amount: 5000,
                type: 'membership_full',
            },
        ],
        attendances: [{
            id: 'attendance-1',
            chargeAmount: 4000,
            class: { date: new Date('2026-07-10T00:00:00.000Z'), title: 'Гитара' },
        }],
        adjustments: [{
            id: 'adjustment-1',
            createdAt: new Date('2026-07-20T10:00:00.000Z'),
            metadata: { amount: -2000, reason: 'Исправление' },
        }],
    });

    assert.equal(statement.summary.openingBalance, -10000);
    assert.equal(statement.summary.income, 20000);
    assert.equal(statement.summary.expenses, 6000);
    assert.equal(statement.summary.movement, 14000);
    assert.equal(statement.summary.closingBalance, 4000);
    assert.equal(statement.events.at(-1).balanceAfter, 4000);
});
