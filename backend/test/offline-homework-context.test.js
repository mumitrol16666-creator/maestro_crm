const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildRecentLessonsByStudent,
    buildStudentLessonHistory,
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

test('история ученика связывает проверку только со следующим уроком того же потока', () => {
    const lesson = (id, date, groupId, homeworkStatus = 'not_checked', completionPercent = null) => ({
        id,
        title: id,
        date: new Date(date),
        startTime: '17:00',
        endTime: '17:45',
        status: 'completed',
        classType: 'group',
        group: { id: groupId, name: groupId },
        teacher: { id: `teacher-${groupId}`, name: 'Иван', lastName: 'Петров' },
        room: null,
        topic: id,
        lessonGoals: null,
        lessonSummary: null,
        homeworkDraft: `ДЗ ${id}`,
        nextLessonFocus: null,
        materials: [],
        attendees: [{
            attended: true,
            homeworkStatus,
            homeworkCompletionPercent: completionPercent,
            homeworkDifficulties: null,
            homeworkNotCompletedReason: null,
        }],
    });
    const history = buildStudentLessonHistory([
        lesson('guitar-old', '2026-08-10', 'guitar'),
        lesson('piano-new', '2026-08-12', 'piano', 'not_completed', 0),
        lesson('guitar-new', '2026-08-13', 'guitar', 'partial', 60),
    ], new Date('2026-08-14'));

    const oldGuitar = history.find((item) => item.crmClassId === 'guitar-old');
    assert.equal(oldGuitar.homeworkReview.status, 'partial');
    assert.equal(oldGuitar.homeworkReview.completionPercent, 60);
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
