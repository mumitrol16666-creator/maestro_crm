const test = require('node:test');
const assert = require('node:assert/strict');
const { selectCrmStudentForAppSync } = require('../src/services/userLink');

test('shared phone sync selects the CRM card with the matching student name', () => {
    const child = {
        id: 'child',
        name: 'Алёна',
        lastName: 'Иванова',
        role: 'student',
        appUserId: null,
    };
    const adult = {
        id: 'adult',
        name: 'Мария',
        lastName: 'Иванова',
        role: 'student',
        appUserId: null,
    };

    assert.deepEqual(
        selectCrmStudentForAppSync([child, adult], {
            appUserId: 'app-adult',
            firstName: 'мария',
            lastName: 'ИВАНОВА',
        }),
        { kind: 'match', student: adult },
    );
});

test('shared phone sync creates a separate CRM card for another family member', () => {
    const child = {
        id: 'child',
        name: 'Алёна',
        lastName: 'Иванова',
        role: 'student',
        appUserId: 'app-child',
    };

    assert.deepEqual(
        selectCrmStudentForAppSync([child], {
            appUserId: 'app-adult',
            firstName: 'Мария',
            lastName: 'Иванова',
        }),
        { kind: 'create' },
    );
});

test('shared phone sync does not steal an already linked same-name CRM card', () => {
    const student = {
        id: 'student',
        name: 'Мария',
        lastName: 'Иванова',
        role: 'student',
        appUserId: 'another-app',
    };

    assert.deepEqual(
        selectCrmStudentForAppSync([student], {
            appUserId: 'new-app',
            firstName: 'Мария',
            lastName: 'Иванова',
        }),
        { kind: 'conflict', count: 1 },
    );
});
