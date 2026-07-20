const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUserDirectoryWhere } = require('../src/services/userDirectory');

test('рабочая вкладка учеников содержит только активных', () => {
    assert.deepEqual(buildUserDirectoryWhere('student'), {
        role: 'student',
        status: 'active',
    });
});

test('бывшие ученики включают паузу и завершивших обучение', () => {
    assert.deepEqual(buildUserDirectoryWhere('departed'), {
        role: 'student',
        status: 'inactive',
    });
});
