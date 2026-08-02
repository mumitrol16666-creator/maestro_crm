const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLessonFollowupMessage } = require('../src/services/lessonFollowupMessage');

test('сообщение после урока содержит только тему, ДЗ и итог', () => {
    const message = buildLessonFollowupMessage({
        topic: 'Переходы между аккордами',
        homeworkDraft: 'Повторить Am–C–G в медленном темпе',
        lessonSummary: 'Переходы стали ровнее, продолжаем работать над ритмом',
        teacherNote: 'Эта заметка не должна попасть в сообщение',
        homeworkReview: { status: 'partial', completionPercent: 60 },
    });

    assert.equal(
        message,
        [
            '*Тема урока:*\nПереходы между аккордами',
            '*Домашнее задание:*\nПовторить Am–C–G в медленном темпе',
            '*Итог урока:*\nПереходы стали ровнее, продолжаем работать над ритмом',
        ].join('\n\n'),
    );
    assert.doesNotMatch(message, /заметка|60%|куратор|преподавател/i);
});

test('пустые поля не создают служебный текст в сообщении', () => {
    assert.equal(
        buildLessonFollowupMessage({ topic: 'Ритм', homeworkDraft: '   ' }),
        '*Тема урока:*\nРитм',
    );
});
