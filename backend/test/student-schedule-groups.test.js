const test = require('node:test');
const assert = require('node:assert/strict');

const { listActiveGroupSchedules } = require('../src/services/studentSchedule');

test('карточка ученика получает все активные группы, включая группы без расписания', () => {
    const theoryGroup = {
        id: 'group-theory',
        name: 'Теория 1',
        direction: 'Теория',
        isActive: true,
        teacherId: 'teacher-1',
        teacher: { id: 'teacher-1', lastName: 'Иванова', name: 'Анна' },
        schedules: [],
    };
    const quartetGroup = {
        id: 'group-quartet',
        name: 'Квартет 2',
        direction: 'Электрогитара',
        isActive: true,
        schedules: [
            { id: 'late', dayOfWeek: 6, time: '16:00', duration: 45 },
            { id: 'early', dayOfWeek: 2, time: '18:00', duration: 45 },
        ],
    };

    const result = listActiveGroupSchedules({
        groups: [
            { status: 'active', groupId: theoryGroup.id, group: theoryGroup },
            { status: 'active', groupId: quartetGroup.id, group: quartetGroup },
            { status: 'active', groupId: quartetGroup.id, group: quartetGroup },
            { status: 'left', groupId: 'old', group: { id: 'old', name: 'Старая группа', schedules: [] } },
            { status: 'active', groupId: 'closed', group: { id: 'closed', name: 'Закрытая', isActive: false, schedules: [] } },
        ],
    });

    assert.deepEqual(result.map((group) => group.groupName), ['Квартет 2', 'Теория 1']);
    assert.deepEqual(result[0].schedules.map((schedule) => schedule.id), ['early', 'late']);
    assert.equal(result[1].schedules.length, 0);
    assert.equal(result[1].teacher.name, 'Иванова Анна');
});
