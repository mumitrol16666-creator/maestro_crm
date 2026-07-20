const test = require('node:test');
const assert = require('node:assert/strict');

const { isClassEnded } = require('../src/services/automation');

test('преподаватель может заполнить итог вчерашнего урока', () => {
    const yesterdayLesson = {
        date: new Date('2026-07-19T00:00:00.000Z'),
        endTime: '18:00',
    };
    const almatyNow = new Date('2026-07-20T10:00:00.000Z');

    assert.equal(isClassEnded(yesterdayLesson, almatyNow), true);
});

test('итог будущего урока недоступен до времени окончания', () => {
    const futureLesson = {
        date: new Date('2026-07-20T00:00:00.000Z'),
        endTime: '18:00',
    };
    const almatyNow = new Date('2026-07-20T10:00:00.000Z');

    assert.equal(isClassEnded(futureLesson, almatyNow), false);
});
