const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRecurringSlots } = require('../src/services/regularScheduleAutomation');

test('индивидуальное регулярное расписание использует fallback преподавателя, если в строке он не задан', () => {
    const slots = buildRecurringSlots({
        schedules: [{ dayOfWeek: 1, time: '18:00', duration: 60, roomId: 'room-1', teacherId: null }],
        startDate: new Date('2026-07-20T00:00:00.000Z'),
        endDate: new Date('2026-07-20T23:59:59.999Z'),
        individualStudentId: 'student-1',
        defaultTeacherId: 'teacher-main',
        title: 'Индивидуально',
        classType: 'individual',
    });

    assert.equal(slots.length, 1);
    assert.equal(slots[0].teacherId, 'teacher-main');
});

test('преподаватель в строке регулярного расписания важнее fallback преподавателя', () => {
    const slots = buildRecurringSlots({
        schedules: [{ dayOfWeek: 1, time: '19:00', duration: 60, roomId: 'room-1', teacherId: 'teacher-slot' }],
        startDate: new Date('2026-07-20T00:00:00.000Z'),
        endDate: new Date('2026-07-20T23:59:59.999Z'),
        individualStudentId: 'student-1',
        defaultTeacherId: 'teacher-main',
        title: 'Индивидуально',
        classType: 'individual',
    });

    assert.equal(slots.length, 1);
    assert.equal(slots[0].teacherId, 'teacher-slot');
});
