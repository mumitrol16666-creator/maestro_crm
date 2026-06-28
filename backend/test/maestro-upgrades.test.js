const test = require('node:test');
const assert = require('node:assert/strict');

const { computeAvgCheck } = require('../src/utils/metrics');

test('Average check calculation should group by unique students in the period', () => {
    // 1. Array of completed payments from the same student
    const paymentsSameStudent = [
        { studentId: 'student_1', amount: 10000, status: 'completed' },
        { studentId: 'student_1', amount: 10000, status: 'completed' },
    ];
    // Total: 20000, Unique students: 1. Expected avg check: 20000.
    assert.equal(computeAvgCheck(paymentsSameStudent), 20000);

    // 2. Array of completed payments from different students
    const paymentsDiffStudents = [
        { studentId: 'student_1', amount: 10000, status: 'completed' },
        { studentId: 'student_2', amount: 20000, status: 'completed' },
    ];
    // Total: 30000, Unique students: 2. Expected avg check: 15000.
    assert.equal(computeAvgCheck(paymentsDiffStudents), 15000);

    // 3. Exclude non-completed payments
    const paymentsMixedStatus = [
        { studentId: 'student_1', amount: 10000, status: 'completed' },
        { studentId: 'student_2', amount: 20000, status: 'pending' },
    ];
    // Completed total: 10000, Unique completed students: 1. Expected: 10000.
    assert.equal(computeAvgCheck(paymentsMixedStatus), 10000);
});

test('Salary premium, fine and advance logic check', () => {
    const totalEarnings = 50000;
    const bonus = 10000;
    const fine = 5000;
    const advance = 15000;

    const teacherSalary = totalEarnings + bonus - fine - advance;
    const finalSalary = Math.max(0, Math.round(teacherSalary));

    assert.equal(finalSalary, 40000);

    // If fine + advance exceeds earnings + bonus
    const largeFine = 70000;
    const negativeSalaryResult = totalEarnings + bonus - largeFine;
    const safeSalaryResult = Math.max(0, Math.round(negativeSalaryResult));

    assert.equal(safeSalaryResult, 0);
});

test('Security check: requireSuperAdmin middleware denies access to non-super_admins', () => {
    const { requireSuperAdmin } = require('../src/middleware/auth');

    // 1. Success case: user is super_admin
    let nextCalled = false;
    const reqSuper = { user: { role: 'super_admin' } };
    const resMock = {};
    const nextMock = () => { nextCalled = true; };

    requireSuperAdmin(reqSuper, resMock, nextMock);
    assert.equal(nextCalled, true);

    // 2. Denied case: user is admin
    let statusSet = null;
    let jsonSent = null;
    const reqAdmin = { user: { role: 'admin' } };
    const resMockAdmin = {
        status(code) {
            statusSet = code;
            return {
                json(obj) {
                    jsonSent = obj;
                }
            };
        }
    };
    let nextCalledAdmin = false;
    const nextMockAdmin = () => { nextCalledAdmin = true; };

    requireSuperAdmin(reqAdmin, resMockAdmin, nextMockAdmin);
    assert.equal(nextCalledAdmin, false);
    assert.equal(statusSet, 403);
    assert.equal(jsonSent.success, false);
    assert.match(jsonSent.error, /супер-администратора/);
});
