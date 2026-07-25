const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildTeacherStudentRosterWhere,
    mapTeacherGroupStudent,
} = require('../src/services/integrationRead');

test('мои ученики включают только учеников, закреплённых в карточке', () => {
    const where = buildTeacherStudentRosterWhere('teacher-1');

    assert.deepEqual(where, {
        role: 'student',
        status: 'active',
        assignedTeacherId: 'teacher-1',
    });
    assert.equal(Object.hasOwn(where, 'OR'), false);
});

test('состав группы не раскрывает телефоны и служебные идентификаторы приложения', () => {
    const student = mapTeacherGroupStudent({
        id: 'student-1',
        name: 'Анна',
        lastName: 'Иванова',
        middleName: 'Сергеевна',
        phone: '+77000000000',
        appUserId: 'app-user-1',
        studentAvatar: null,
        assignedTeacherId: 'teacher-1',
    }, 'teacher-1');

    assert.deepEqual(student, {
        crmStudentId: 'student-1',
        name: 'Иванова Анна Сергеевна',
        avatarUrl: null,
        assignedDirectly: true,
    });
    assert.equal(Object.hasOwn(student, 'phone'), false);
    assert.equal(Object.hasOwn(student, 'appUserId'), false);
});
