const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMonthlyPayroll, buildPeriodPayroll } = require('../src/services/payroll');

function employee(id, status = 'inactive') {
    return { id, name: id, lastName: 'QA', role: 'teacher', status, monthlySalary: 0 };
}

function database({ employees, operations = [], classes = [], payments = [] }) {
    return {
        student: { findMany: async () => employees },
        class: { findMany: async query => query.select.title ? classes : [] },
        payment: { findMany: async query => query.distinct ? [] : payments },
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


test('fixed salary stops at termination while earlier earned months remain unchanged', async () => {
    const former = { ...employee('former'), monthlySalary: 150000,
        employmentEndDate: new Date('2026-09-01') };
    const db = database({ employees: [former] });
    const august = await buildMonthlyPayroll(db, '2026-08');
    const september = await buildMonthlyPayroll(db, '2026-09');
    const november = await buildMonthlyPayroll(db, '2026-11');
    assert.equal(august.employees[0].fixedSalary, 150000);
    assert.equal(september.employees.length, 0);
    assert.equal(november.totals.due, 0);
    assert.equal(november.employees.length, 0);
});

test('mid-month termination prorates only worked days and keeps the debt visible', async () => {
    const result = await buildMonthlyPayroll(database({ employees: [{ ...employee('former'),
        monthlySalary: 310000, employmentStartDate: new Date('2026-08-01'),
        employmentEndDate: new Date('2026-08-17') }] }), '2026-08');
    assert.equal(result.employees[0].fixedSalary, 160000);
    assert.equal(result.employees[0].due, 160000);
});

test('salary cannot accrue when termination precedes the requested report period', async () => {
    const { calculateFixedSalaryForRange } = require('../src/services/payroll');
    assert.equal(calculateFixedSalaryForRange(150000, new Date('2026-09-01'),
        new Date('2026-10-01'), null, new Date('2026-09-01')), 0);
});

test('sales after termination cannot create commission for a former employee', async () => {
    const result = await buildMonthlyPayroll(database({ employees: [{ ...employee('former'),
        salesCommissionPercent: 4, employmentEndDate: new Date('2026-09-01') }], payments: [
        { id: 'sale', managerId: 'former', amount: 100000, status: 'completed', paymentDate: new Date('2026-10-10') },
    ] }), '2026-10');
    assert.equal(result.employees.length, 0);
    assert.equal(result.totals.salesCommission, 0);
});

test('refund of a sale before termination still reduces commission', async () => {
    const result = await buildMonthlyPayroll(database({ employees: [{ ...employee('former'),
        salesCommissionPercent: 4, employmentEndDate: new Date('2026-09-15') }], payments: [
        { id: 'sale', managerId: 'former', amount: 100000, status: 'completed', paymentDate: new Date('2026-09-10') },
        { id: 'refund', managerId: 'other', amount: 20000, status: 'refunded', paymentDate: new Date('2026-09-20'),
            relatedPayment: { managerId: 'former', paymentDate: new Date('2026-09-10') } },
    ] }), '2026-09');
    assert.equal(result.employees[0].salesBase, 80000);
    assert.equal(result.employees[0].salesCommission, 3200);
});


test('employment cutoff edits require payroll permission', () => {
    const { requiredPermissions } = require('../src/services/rolePermissions');
    assert.ok(requiredPermissions({ method: 'PUT', originalUrl: '/api/users/employee',
        body: { employmentEndDate: '2026-09-01' } }).includes('canManagePayments'));
});

// 07.11 audit Д4: deactivated before 04.11, so no employmentEndDate was ever stored.
test('staff deactivated without a termination date keep their earlier debt and stop accruing after 04.11', async () => {
    const legacy = { ...employee('legacy'), role: 'manager', monthlySalary: 150000 };
    const september = await buildMonthlyPayroll(database({ employees: [legacy], operations: [
        { id: 'payout', teacherId: 'legacy', type: 'payout', amount: 100000, date: new Date('2026-09-25') },
    ] }), '2026-09');
    assert.equal(september.employees.length, 1);
    assert.equal(september.employees[0].fixedSalary, 150000);
    assert.equal(september.totals.due, 50000, 'the debt from before the release is still payable');
    assert.equal(september.employees[0].needsEmploymentEndDate, true);

    const december = await buildMonthlyPayroll(database({ employees: [legacy] }), '2026-12');
    assert.equal(december.totals.fixedSalary, 0, 'nothing accrues after the release');
    assert.deepEqual(december.employees, []);
});

test('commission of staff deactivated without a date stays for sales before 04.11 only', async () => {
    const seller = { ...employee('seller'), role: 'manager', salesCommissionPercent: 10 };
    const sale = (id, date) => ({ id, managerId: 'seller', amount: 50000, status: 'paid', paymentDate: new Date(date) });
    const october = await buildMonthlyPayroll(database({ employees: [seller], payments: [sale('oct', '2026-10-15')] }), '2026-10');
    assert.equal(october.totals.salesCommission, 5000);
    const november = await buildMonthlyPayroll(database({ employees: [seller], payments: [sale('nov', '2026-11-10')] }), '2026-11');
    assert.equal(november.totals.salesCommission, 0);
});
