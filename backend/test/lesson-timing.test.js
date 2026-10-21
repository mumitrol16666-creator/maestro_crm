const test = require('node:test');
const assert = require('node:assert/strict');

const {
    isClassEnded,
    isClassReportSubmittable,
} = require('../src/services/automation');

test('преподаватель может заполнить итог вчерашнего урока', () => {
    const yesterdayLesson = {
        date: new Date('2026-07-19T00:00:00.000Z'),
        endTime: '18:00',
    };
    const almatyNow = new Date('2026-07-20T10:00:00.000Z');

    assert.equal(isClassEnded(yesterdayLesson, almatyNow), true);
});

test('полный отчёт открывается ровно за 20 минут до конца урока', () => {
    const lesson = {
        date: new Date('2026-07-20T00:00:00.000Z'),
        endTime: '18:00',
    };
    const minuteBeforeWindow = new Date('2026-07-20T17:39:00.000Z');
    const windowOpens = new Date('2026-07-20T17:40:00.000Z');

    assert.equal(isClassReportSubmittable(lesson, minuteBeforeWindow), false);
    assert.equal(isClassReportSubmittable(lesson, windowOpens), true);
});

test('за 20 минут до конца урок ещё не считается завершённым', () => {
    const lesson = {
        date: new Date('2026-07-20T00:00:00.000Z'),
        endTime: '18:00',
    };
    const reportWindowOpen = new Date('2026-07-20T17:40:00.000Z');

    assert.equal(isClassEnded(lesson, reportWindowOpen), false);
});

test('отметку «ученик не пришёл» можно передать с начала урока, не дожидаясь конца', () => {
    const { isClassStarted } = require('../src/services/automation');
    const lesson = {
        date: new Date('2026-07-20T00:00:00.000Z'),
        startTime: '17:00',
        endTime: '18:00',
    };

    assert.equal(isClassStarted(lesson, new Date('2026-07-20T16:59:00.000Z')), false);
    assert.equal(isClassStarted(lesson, new Date('2026-07-20T17:00:00.000Z')), true);
    assert.equal(isClassEnded(lesson, new Date('2026-07-20T17:00:00.000Z')), false);
});
