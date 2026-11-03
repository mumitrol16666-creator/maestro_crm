const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMonthlyPayroll, buildPeriodPayroll } = require('../src/services/payroll');

function employee(id, status = 'inactive') {
    return { id, name: id, lastName: 'QA', role: 'teacher', status, monthlySalary: 0 };
}

function database({ employees, operations = [], classes = [] }) {
    return {
        student: { findMany: async () => employees },
        class: { findMany: async query => query.select.title ? classes : [] },
        payment: { findMany: async () => [] },
        salary: { findMany: async () => [] },
        salaryOperation: {
            updateMany: async () => ({ count: 0 }),
            findMany: async () => operations,
        },
    };
}

test('empty inactive employees are omitted while active employees with zero accrual remain', async () => {
    const db = database({ employees: [employee('former'), employee('current', 'active')] });
    for (const result of [
        await buildMonthlyPayroll(db, '2026-09'),
        await buildPeriodPayroll(db, new Date('2026-09-01'), new Date('2026-09-26')),
    ]) {
        assert.deepEqual(result.employees.map(row => row.employeeId), ['current']);
        assert.equal(result.totals.employees, 1);
        assert.equal(result.totals.teachers, 1);
        assert.equal(result.totals.due, 0);
    }
});

test('historical payments for an inactive employee remain even when the balance is zero', async () => {
    const result = await buildMonthlyPayroll(database({ employees: [employee('former')], operations: [
        { id: 'bonus', teacherId: 'former', type: 'bonus', amount: 10000, date: new Date('2026-07-10') },
        { id: 'payout', teacherId: 'former', type: 'payout', amount: 10000, date: new Date('2026-07-11') },
    ] }), '2026-07');
    assert.equal(result.employees.length, 1);
    assert.equal(result.employees[0].isInactive, true);
    assert.equal(result.employees[0].timeline.length, 2);
    assert.equal(result.totals.bonuses, 10000);
    assert.equal(result.totals.paid, 10000);
    assert.equal(result.totals.due, 0);
});

test('an inactive teacher with earned lessons retains the outstanding salary', async () => {
    const result = await buildMonthlyPayroll(database({ employees: [employee('former')], classes: [
        { id: 'lesson', teacherId: 'former', date: new Date('2026-09-10'), title: 'QA lesson',
            status: 'completed', teacherEarningStatus: 'active', teacherBaseEarning: 2500 },
    ] }), '2026-09');
    assert.equal(result.employees[0].isInactive, true);
    assert.equal(result.totals.lessons, 1);
    assert.equal(result.totals.due, 2500);
});

test('scheduled lessons without accrual do not restore an empty inactive row', async () => {
    const result = await buildMonthlyPayroll(database({ employees: [employee('former')], classes: [
        { id: 'scheduled', teacherId: 'former', date: new Date('2026-09-30'), title: 'QA lesson',
            status: 'scheduled', teacherEarningStatus: 'pending', teacherBaseEarning: 0 },
    ] }), '2026-09');
    assert.equal(result.employees.length, 0);
    assert.equal(result.totals.employees, 0);
});

test('empty former employees are returned separately for the operation form, without money', async () => {
    const db = database({ employees: [employee('former'), employee('current', 'active')] });
    const result = await buildMonthlyPayroll(db, '2026-09');
    assert.deepEqual(result.formerEmployees, [
        { employeeId: 'former', employeeName: 'QA former', position: 'Преподаватель', isInactive: true, due: 0 },
    ]);
    assert.equal(result.employees.some(row => row.employeeId === 'former'), false);
});

test('a former employee with history this month is a register row, not a former-employee option', async () => {
    const result = await buildMonthlyPayroll(database({ employees: [employee('former')], operations: [
        { id: 'bonus', teacherId: 'former', type: 'bonus', amount: 5000, date: new Date('2026-07-10') },
    ] }), '2026-07');
    assert.equal(result.employees.length, 1);
    assert.deepEqual(result.formerEmployees, []);
});

test('a former employee who still has a fixed salary stays in the register with the accrual', async () => {
    // Current behaviour, fixed by this test: deactivation keeps monthlySalary, so the
    // salary keeps accruing. Whether it should is a separate decision.
    const former = { ...employee('former'), role: 'manager', monthlySalary: 200000 };
    const result = await buildMonthlyPayroll(database({ employees: [former] }), '2026-09');
    assert.equal(result.employees.length, 1);
    assert.equal(result.employees[0].isInactive, true);
    assert.equal(result.totals.due, 200000);
    assert.deepEqual(result.formerEmployees, []);
});
