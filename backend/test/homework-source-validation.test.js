const test = require('node:test');
const assert = require('node:assert/strict');

const { validateReviewedHomeworkClass } = require('../src/services/homeworkSource');

const currentClass = {
    id: 'current',
    groupId: 'group-1',
    date: new Date('2026-08-20T00:00:00.000Z'),
    startTime: '18:00',
};

function sourceClass(overrides = {}) {
    return {
        id: 'source',
        groupId: 'group-1',
        individualStudentId: null,
        status: 'completed',
        date: new Date('2026-08-13T00:00:00.000Z'),
        startTime: '18:00',
        homeworkDraft: 'Повторить упражнение',
        attendees: [],
        ...overrides,
    };
}

test('принимает завершённый прошлый урок той же группы', () => {
    assert.equal(validateReviewedHomeworkClass(currentClass, sourceClass(), 'student-1'), null);
});

test('отклоняет чужую группу и урок без домашнего задания', () => {
    assert.match(
        validateReviewedHomeworkClass(currentClass, sourceClass({ groupId: 'group-2' }), 'student-1'),
        /не относится/,
    );
    assert.match(
        validateReviewedHomeworkClass(currentClass, sourceClass({ homeworkDraft: '   ' }), 'student-1'),
        /нет домашнего задания/,
    );
});

test('принимает индивидуальный урок этого ученика и отклоняет будущий', () => {
    assert.equal(validateReviewedHomeworkClass(
        { ...currentClass, groupId: null },
        sourceClass({ groupId: null, individualStudentId: 'student-1' }),
        'student-1',
    ), null);
    assert.match(
        validateReviewedHomeworkClass(
            currentClass,
            sourceClass({ date: new Date('2026-08-27T00:00:00.000Z') }),
            'student-1',
        ),
        /раньше текущего/,
    );
});
