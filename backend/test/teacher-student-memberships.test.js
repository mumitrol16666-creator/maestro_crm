const test = require('node:test');
const assert = require('node:assert/strict');
const { teacherVisibleMemberships } = require('../src/services/teacherStudentMemberships');

test('индивидуальный тариф виден преподавателю из регулярного расписания', () => {
    const memberships = teacherVisibleMemberships([
        {
            id: 'membership-1',
            teacherId: null,
            groupId: null,
            type: 'individual_package',
            lessonFormat: 'individual',
        },
    ], {
        teacherId: 'teacher-1',
        teacherGroupIds: [],
        assignedDirectly: false,
        hasTeacherSchedule: true,
    });

    assert.deepEqual(memberships.map((item) => item.id), ['membership-1']);
});

test('групповой тариф виден только преподавателю связанной группы', () => {
    const memberships = [
        {
            id: 'matching-group',
            teacherId: null,
            groupId: 'group-1',
            type: 'monthly',
            lessonFormat: 'group',
        },
        {
            id: 'other-group',
            teacherId: null,
            groupId: 'group-2',
            type: 'monthly',
            lessonFormat: 'group',
        },
    ];

    const visible = teacherVisibleMemberships(memberships, {
        teacherId: 'teacher-1',
        teacherGroupIds: ['group-1'],
        assignedDirectly: false,
        hasTeacherSchedule: false,
    });

    assert.deepEqual(visible.map((item) => item.id), ['matching-group']);
});

test('явно закреплённый тариф остаётся виден преподавателю', () => {
    const visible = teacherVisibleMemberships([
        {
            id: 'membership-1',
            teacherId: 'teacher-1',
            groupId: null,
            type: 'monthly',
            lessonFormat: 'group',
        },
    ], {
        teacherId: 'teacher-1',
        teacherGroupIds: [],
        assignedDirectly: false,
        hasTeacherSchedule: false,
    });

    assert.equal(visible.length, 1);
});
