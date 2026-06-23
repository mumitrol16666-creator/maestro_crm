const test = require('node:test');
const assert = require('node:assert/strict');

const {
    shouldChargeAttendance,
    isPresentAttendance,
    canApproveClass,
} = require('../src/services/lessonBillingPolicy');
const {
    getTeacherRate,
    isPayableClass,
} = require('../src/services/salaryPolicy');

const teacher = {
    salaryIndividual: 5000,
    salaryGroup: 3000,
    salaryOther: 1500,
};

test('списание выполняется за присутствие, опоздание и неуважительный пропуск', () => {
    assert.equal(shouldChargeAttendance('present'), true);
    assert.equal(shouldChargeAttendance('late'), true);
    assert.equal(shouldChargeAttendance('unexcused_absence'), true);
    assert.equal(shouldChargeAttendance('excused_absence'), false);
    assert.equal(shouldChargeAttendance('unmarked'), false);
});

test('повторное подтверждение завершённого урока запрещено', () => {
    assert.deepEqual(canApproveClass({ status: 'completed', isPractice: false }), {
        allowed: false,
        status: 409,
        reason: 'Урок уже подтверждён',
    });
    assert.equal(canApproveClass({ status: 'pending_admin_review', isPractice: false }).allowed, true);
});

test('пробный урок не оплачивается преподавателю', () => {
    const lesson = { classType: 'trial', status: 'completed', attendees: [{ attendanceStatus: 'present' }] };
    assert.equal(getTeacherRate(teacher, lesson), 0);
    assert.equal(isPayableClass(lesson), false);
});

test('обычный подтверждённый урок оплачивается независимо от баланса ученика', () => {
    const lesson = {
        classType: 'individual',
        status: 'completed',
        teacherOutcomeHint: 'held',
        attendees: [{ attendanceStatus: 'present', student: { accountBalance: -12000 } }],
    };
    assert.equal(getTeacherRate(teacher, lesson), 5000);
    assert.equal(isPayableClass(lesson), true);
});

test('уважительная отмена и заморозка не оплачиваются', () => {
    const excused = {
        classType: 'individual',
        status: 'completed',
        attendees: [{ attendanceStatus: 'excused_absence' }],
    };
    const frozenOrNotHeld = {
        classType: 'group',
        status: 'completed',
        teacherOutcomeHint: 'not_held',
        attendees: [],
    };
    assert.equal(isPayableClass(excused), false);
    assert.equal(isPayableClass(frozenOrNotHeld), false);
});

test('неуважительная поздняя отмена оплачивается преподавателю', () => {
    const lesson = {
        classType: 'group',
        status: 'cancelled',
        attendees: [{ attendanceStatus: 'unexcused_absence' }],
    };
    assert.equal(isPayableClass(lesson), true);
    assert.equal(getTeacherRate(teacher, lesson), 3000);
});

test('опоздание считается фактическим присутствием', () => {
    assert.equal(isPresentAttendance('late'), true);
    assert.equal(isPresentAttendance('unexcused_absence'), false);
});
