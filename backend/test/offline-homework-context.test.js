const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../src/config/db');
require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: { prisma: {} },
    children: [],
    paths: [],
};

const {
    buildRecentLessonsByStudent,
    buildStudentLessonHistory,
    mapOfflineHomeworkReview,
    mapClassDetail,
} = require('../src/services/integrationRead');

test('CRM projection keeps lesson type and delivery format independent', () => {
    const mapped = mapClassDetail({
        id: 'online-class',
        title: 'Онлайн-урок',
        date: new Date('2026-09-02T12:00:00.000Z'),
        startTime: '18:00',
        endTime: '19:00',
        duration: 60,
        status: 'scheduled',
        classType: 'individual',
        deliveryFormat: 'online',
        meetingUrl: 'https://meet.example.test/lesson',
        isPractice: false,
        startedAt: null,
        finishedAt: null,
        submittedAt: null,
        reviewedAt: null,
        updatedAt: new Date('2026-09-01T12:00:00.000Z'),
        group: null,
        teacher: { id: 'teacher-1', name: 'Иван', lastName: 'Петров' },
        room: null,
        individualStudentId: 'student-1',
        topic: null,
        lessonGoals: null,
        lessonSummary: null,
        homeworkDraft: null,
        nextLessonFocus: null,
        materials: null,
        teacherComment: null,
        teacherOutcomeHint: null,
        trialReport: null,
        trialAiAnalysis: null,
    });

    assert.equal(mapped.classType, 'individual');
    assert.equal(mapped.deliveryFormat, 'online');
    assert.equal(mapped.meetingUrl, 'https://meet.example.test/lesson');
    assert.equal(mapped.room, null);
});

function attendance({
    studentId = 'student-1',
    classId,
    homework,
    homeworkStatus,
    completionPercent = null,
    reviewedHomeworkClassId = null,
}) {
    return {
        studentId,
        attendanceStatus: 'present',
        teacherNote: null,
        homeworkStatus,
        homeworkCompletionPercent: completionPercent,
        homeworkDifficulties: null,
        homeworkNotCompletedReason: null,
        reviewedHomeworkClassId,
        markedAt: new Date('2026-08-20T12:00:00.000Z'),
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
        sourceCrmClassId: null,
        reviewedAt: null,
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
        {
            ...lesson('guitar-new', '2026-08-13', 'guitar', 'partial', 60),
            attendees: [{
                ...lesson('guitar-new', '2026-08-13', 'guitar', 'partial', 60).attendees[0],
                reviewedHomeworkClassId: 'guitar-old',
                markedAt: new Date('2026-08-13T13:00:00.000Z'),
            }],
        },
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
            reviewedHomeworkClassId: 'lesson-previous',
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
    assert.equal(recent[1].homeworkReview, null);
});

test('неоднозначная legacy-проверка не привязывается к случайному уроку', () => {
    const lesson = (id, date, homeworkStatus = null) => ({
        id,
        title: id,
        date: new Date(date),
        startTime: '17:00',
        endTime: '17:45',
        status: 'completed',
        classType: 'group',
        group: { id: 'guitar', name: 'Гитара' },
        teacher: { id: 'teacher-guitar', name: 'Иван', lastName: 'Петров' },
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
            homeworkCompletionPercent: 100,
            homeworkDifficulties: null,
            homeworkNotCompletedReason: null,
            reviewedHomeworkClassId: null,
            markedAt: null,
        }],
    });

    const history = buildStudentLessonHistory([
        lesson('lesson-1', '2026-08-01'),
        lesson('lesson-2', '2026-08-08'),
        lesson('lesson-3', '2026-08-15', 'completed'),
    ], new Date('2026-08-16'));

    assert.equal(history.find((item) => item.crmClassId === 'lesson-1').homeworkReview, null);
    assert.equal(history.find((item) => item.crmClassId === 'lesson-2').homeworkReview, null);
});
