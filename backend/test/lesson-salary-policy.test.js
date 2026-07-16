const test = require('node:test');
const assert = require('node:assert/strict');

const {
    shouldChargeAttendance,
    isPresentAttendance,
    canApproveClass,
} = require('../src/services/lessonBillingPolicy');
const {
    TRIAL_TEACHER_RATE,
    getFirstPaymentTeacherBonus,
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
    assert.equal(shouldChargeAttendance('emergency_freeze'), false);
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

test('админ может подтвердить урок из расписания без отправки преподавателем', () => {
    assert.equal(canApproveClass({ status: 'scheduled', isPractice: false }).allowed, true);
    assert.equal(canApproveClass({ status: 'started', isPractice: false }).allowed, true);
    assert.equal(canApproveClass({ status: 'not_filled', isPractice: false }).allowed, true);
    assert.deepEqual(canApproveClass({ status: 'cancelled', isPractice: false }), {
        allowed: false,
        status: 400,
        reason: 'Урок нельзя подтвердить в текущем статусе',
    });
});

test('проведённый пробный урок оплачивается преподавателю фиксированно', () => {
    const lesson = { classType: 'trial', status: 'completed', attendees: [{ attendanceStatus: 'present' }] };
    assert.equal(TRIAL_TEACHER_RATE, 500);
    assert.equal(getTeacherRate(teacher, lesson), 500);
    assert.equal(isPayableClass(lesson), true);
});

test('бонус за первый платеж ученика считается по новой сетке без дыр', () => {
    assert.equal(getFirstPaymentTeacherBonus(31999), 0);
    assert.equal(getFirstPaymentTeacherBonus(32000), 500);
    assert.equal(getFirstPaymentTeacherBonus(59999), 500);
    assert.equal(getFirstPaymentTeacherBonus(60000), 2000);
    assert.equal(getFirstPaymentTeacherBonus(149999), 2000);
    assert.equal(getFirstPaymentTeacherBonus(150000), 5000);
    assert.equal(getFirstPaymentTeacherBonus(300000), 5000);
    assert.equal(getFirstPaymentTeacherBonus(300001), 0);
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

test('экстренная заморозка оплачивается преподавателю', () => {
    const lesson = {
        classType: 'individual',
        status: 'completed',
        attendees: [{ attendanceStatus: 'emergency_freeze' }],
    };
    assert.equal(isPayableClass(lesson), true);
});
