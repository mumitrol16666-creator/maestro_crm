const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyCancellation } = require('../src/services/cancellationPolicy');

const classDateKey = '2026-09-10';

test('отмена до 19:00 предыдущего дня бесплатна', () => {
    assert.equal(classifyCancellation({
        classDateKey,
        now: new Date('2026-09-09T13:59:59.000Z'), // 18:59:59 в Актобе
    }), 'free');
});

test('отмена ровно в 19:00 предыдущего дня уже списывает урок', () => {
    assert.equal(classifyCancellation({
        classDateKey,
        now: new Date('2026-09-09T14:00:00.000Z'), // 19:00 в Актобе
    }), 'charge');
});

test('отмена в день занятия использует экстренную отмену', () => {
    assert.equal(classifyCancellation({
        classDateKey,
        now: new Date('2026-09-10T05:00:00.000Z'), // 10:00 в Актобе
    }), 'emergency');
});

test('заблаговременная отмена остаётся бесплатной', () => {
    assert.equal(classifyCancellation({
        classDateKey,
        now: new Date('2026-09-08T18:00:00.000Z'),
    }), 'free');
});

test('поздняя обработка прошедшего занятия не расходует экстренную отмену', () => {
    assert.equal(classifyCancellation({
        classDateKey,
        now: new Date('2026-09-11T05:00:00.000Z'),
    }), 'charge');
});
