const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTeacherStudentRosterWhere } = require('../src/services/integrationRead');

test('мои ученики включают только учеников, закреплённых в карточке', () => {
    const where = buildTeacherStudentRosterWhere('teacher-1');

    assert.deepEqual(where, {
        role: 'student',
        status: 'active',
        assignedTeacherId: 'teacher-1',
    });
    assert.equal(Object.hasOwn(where, 'OR'), false);
});
