const test = require('node:test');
const assert = require('node:assert/strict');
const { selectPreviousGroupHomework } = require('../src/services/groupHomeworkSource');

test('групповое ДЗ берётся один раз из последнего урока с заданием', () => {
    const source = selectPreviousGroupHomework([
        {
            id: 'lesson-empty',
            date: new Date('2026-08-20T10:00:00.000Z'),
            title: 'Урок без задания',
            topic: 'Ритм',
            homeworkDraft: '   ',
            nextLessonFocus: null,
        },
        {
            id: 'lesson-homework',
            date: new Date('2026-08-13T10:00:00.000Z'),
            title: 'Переходы аккордов',
            topic: 'Am-Dm',
            homeworkDraft: '  Играть под метроном  ',
            nextLessonFocus: 'Добавить бой',
        },
    ]);

    assert.deepEqual(source, {
        crmClassId: 'lesson-homework',
        date: new Date('2026-08-13T10:00:00.000Z'),
        title: 'Переходы аккордов',
        topic: 'Am-Dm',
        homework: 'Играть под метроном',
        nextLessonFocus: 'Добавить бой',
    });
});

test('групповая проверка не создаётся без прошлого задания', () => {
    assert.equal(selectPreviousGroupHomework([]), null);
    assert.equal(selectPreviousGroupHomework([{ id: 'lesson', homeworkDraft: null }]), null);
});
