const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLessonSubmission } = require('../src/services/lessonSubmissionPolicy');

function rosterState(overrides = {}) {
    return {
        expectedStudentIds: ['student-1'],
        unmarkedStudentIds: [],
        presentStudentIds: ['student-1'],
        absentStudentIds: [],
        allAbsent: false,
        ...overrides,
    };
}

test('held lesson requires both topic and lesson summary', () => {
    const missingTopic = validateLessonSubmission({
        rosterState: rosterState(),
        topic: '',
        lessonSummary: 'Разобрали упражнение',
    });
    const missingSummary = validateLessonSubmission({
        rosterState: rosterState(),
        topic: 'Аккорды',
        lessonSummary: '',
    });

    assert.equal(missingTopic.success, false);
    assert.equal(missingTopic.code, 'LESSON_TOPIC_REQUIRED');
    assert.equal(missingSummary.success, false);
    assert.equal(missingSummary.code, 'LESSON_SUMMARY_REQUIRED');
});

test('lesson cannot be submitted while attendance is incomplete', () => {
    const result = validateLessonSubmission({
        rosterState: rosterState({
            unmarkedStudentIds: ['student-1'],
            presentStudentIds: [],
        }),
        topic: 'Аккорды',
        lessonSummary: 'Разобрали упражнение',
    });

    assert.equal(result.success, false);
    assert.equal(result.code, 'LESSON_ATTENDANCE_INCOMPLETE');
});

test('all absent students create an attendance-only submission', () => {
    const result = validateLessonSubmission({
        rosterState: rosterState({
            presentStudentIds: [],
            absentStudentIds: ['student-1'],
            allAbsent: true,
        }),
        topic: '',
        lessonSummary: '',
    });

    assert.deepEqual(result, {
        success: true,
        outcome: 'no_submission',
        requiresReport: false,
    });
});

test('empty lesson roster is rejected', () => {
    const result = validateLessonSubmission({
        rosterState: rosterState({
            expectedStudentIds: [],
            presentStudentIds: [],
        }),
        topic: 'Аккорды',
        lessonSummary: 'Разобрали упражнение',
    });

    assert.equal(result.success, false);
    assert.equal(result.code, 'LESSON_ROSTER_EMPTY');
});
