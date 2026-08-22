const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildRecentLessonsByStudent,
    mapOfflineHomeworkReview,
} = require('../src/services/integrationRead');

function attendance({
    studentId = 'student-1',
    classId,
    homework,
    homeworkStatus,
    completionPercent = null,
}) {
    return {
        studentId,
        attendanceStatus: 'present',
        teacherNote: null,
        homeworkStatus,
        homeworkCompletionPercent: completionPercent,
        homeworkDifficulties: null,
        homeworkNotCompletedReason: null,
        class: {
            id: classId,
            date: new Date('2026-08-20T00:00:00.000Z'),
            title: classId,
            topic: null,
            lessonSummary: null,
            homeworkDraft: homework,
            nextLessonFocus: null,
        },
    };
}

test('текущая проверка возвращается в карточке ученика', () => {
    assert.deepEqual(mapOfflineHomeworkReview({
        homeworkStatus: 'partial',
        homeworkCompletionPercent: 60,
        homeworkDifficulties: 'Переход между аккордами',
        homeworkNotCompletedReason: null,
    }), {
        status: 'partial',
        completionPercent: 60,
        difficulties: 'Переход между аккордами',
        notCompletedReason: null,
    });
    assert.equal(mapOfflineHomeworkReview(null), null);
});

test('статус связывается с домашним заданием предыдущего урока без сдвига', () => {
    const currentAttendees = new Map([[
        'student-1',
        attendance({
            classId: 'lesson-current',
            homework: 'Новое задание',
            homeworkStatus: 'completed',
            completionPercent: 100,
        }),
    ]]);
    const previousAttendances = [
        attendance({
            classId: 'lesson-previous',
            homework: 'Задание с прошлого урока',
            homeworkStatus: 'partial',
            completionPercent: 50,
        }),
        attendance({
            classId: 'lesson-before-previous',
            homework: 'Более старое задание',
            homeworkStatus: 'not_completed',
            completionPercent: 0,
        }),
    ];

    const recent = buildRecentLessonsByStudent(previousAttendances, currentAttendees)
        .get('student-1');

    assert.equal(recent[0].homework, 'Задание с прошлого урока');
    assert.equal(recent[0].homeworkReview.status, 'completed');
    assert.equal(recent[0].homeworkReview.completionPercent, 100);
    assert.equal(recent[1].homework, 'Более старое задание');
    assert.equal(recent[1].homeworkReview.status, 'partial');
    assert.equal(recent[1].homeworkReview.completionPercent, 50);
});
