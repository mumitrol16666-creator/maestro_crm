const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parseMonthKey,
    getMonthRange,
    monthKeyFromDate,
    calculateFixedSalaryForRange,
    syncClassPayrollSnapshot,
    syncFirstPaymentBonusForStudent,
} = require('../src/services/payroll');

test('месяц зарплаты нормализуется в стабильный период UTC', () => {
    assert.equal(parseMonthKey('2026-07'), '2026-07');
    assert.equal(parseMonthKey('2026-13'), null);
    assert.equal(parseMonthKey('07.2026'), null);

    const range = getMonthRange('2026-07');
    assert.equal(range.start.toISOString(), '2026-07-01T00:00:00.000Z');
    assert.equal(range.end.toISOString(), '2026-08-01T00:00:00.000Z');
    assert.equal(monthKeyFromDate('2026-07-31T23:59:59.000Z'), '2026-07');
});

test('месячный оклад начисляется полностью за полный месяц', () => {
    assert.equal(
        calculateFixedSalaryForRange(
            180000,
            new Date('2026-07-01T00:00:00.000Z'),
            new Date('2026-08-01T00:00:00.000Z'),
            new Date('2026-06-15T00:00:00.000Z'),
        ),
        180000,
    );
});

test('оклад нового сотрудника рассчитывается с даты начала работы', () => {
    assert.equal(
        calculateFixedSalaryForRange(
            310000,
            new Date('2026-07-01T00:00:00.000Z'),
            new Date('2026-08-01T00:00:00.000Z'),
            new Date('2026-07-17T00:00:00.000Z'),
        ),
        150000,
    );
});

test('проведённый пробный урок фиксируется по ставке 500 тенге', async () => {
    let updateData = null;
    const db = {
        class: {
            findUnique: async () => ({
                id: 'trial-class',
                teacherId: 'teacher',
                teacher: {
                    role: 'teacher',
                    salaryIndividual: 0,
                    salaryGroup: 0,
                    salaryOther: 0,
                },
                classType: 'trial',
                status: 'completed',
                teacherOutcomeHint: 'held',
                teacherRateSnapshot: null,
                attendees: [{ attendanceStatus: 'present', attended: true }],
                salaryRecords: [],
            }),
            update: async ({ data }) => {
                updateData = data;
                return data;
            },
        },
    };

    await syncClassPayrollSnapshot(db, 'trial-class');
    assert.equal(updateData.teacherRateSnapshot, 500);
    assert.equal(updateData.teacherBaseEarning, 500);
    assert.equal(updateData.teacherEarningStatus, 'active');
});

test('групповая ставка фиксируется один раз за урок, а не за каждого ученика', async () => {
    let updateData = null;
    const db = {
        class: {
            findUnique: async () => ({
                id: 'group-class',
                teacherId: 'teacher',
                teacher: {
                    role: 'teacher',
                    salaryIndividual: 4000,
                    salaryGroup: 3000,
                    salaryOther: 1500,
                },
                classType: 'group',
                status: 'completed',
                teacherOutcomeHint: 'held',
                teacherRateSnapshot: null,
                attendees: [
                    { attendanceStatus: 'present', attended: true },
                    { attendanceStatus: 'present', attended: true },
                    { attendanceStatus: 'late', attended: true },
                ],
                salaryRecords: [],
            }),
            update: async ({ data }) => {
                updateData = data;
                return data;
            },
        },
    };

    await syncClassPayrollSnapshot(db, 'group-class');
    assert.equal(updateData.teacherBaseEarning, 3000);
});

test('бонус берётся только из первого завершённого платежа и сохраняет источник', async () => {
    let update = null;
    const paymentDate = new Date('2026-07-18T12:00:00.000Z');
    const db = {
        payment: {
            findFirst: async () => ({
                id: 'first-payment',
                amount: 60000,
                paymentDate,
            }),
        },
        booking: {
            findMany: async () => [{ trialClassId: 'trial-class' }],
        },
        class: {
            findFirst: async () => null,
            findUnique: async () => null,
            updateMany: async () => ({ count: 0 }),
            update: async args => {
                update = args;
                return args.data;
            },
        },
    };

    await syncFirstPaymentBonusForStudent(db, 'student');
    assert.equal(update.where.id, 'trial-class');
    assert.equal(update.data.teacherFirstPaymentBonus, 2000);
    assert.equal(update.data.teacherFirstPaymentId, 'first-payment');
    assert.equal(update.data.teacherFirstPaymentAmount, 60000);
    assert.equal(update.data.teacherFirstPaymentBonusDate, paymentDate);
});
