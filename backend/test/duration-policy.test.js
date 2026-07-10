const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_LESSON_DURATION_MINUTES,
    normalizeLessonDuration,
} = require('../src/utils/duration');

test('длительность занятия не привязана к 45 минутам', () => {
    assert.equal(DEFAULT_LESSON_DURATION_MINUTES, 60);
    assert.equal(normalizeLessonDuration(25), 25);
    assert.equal(normalizeLessonDuration('45'), 45);
    assert.equal(normalizeLessonDuration('90'), 90);
});

test('пустая или некорректная длительность получает только мягкий дефолт', () => {
    assert.equal(normalizeLessonDuration(null), DEFAULT_LESSON_DURATION_MINUTES);
    assert.equal(normalizeLessonDuration(''), DEFAULT_LESSON_DURATION_MINUTES);
    assert.equal(normalizeLessonDuration(0), DEFAULT_LESSON_DURATION_MINUTES);
    assert.equal(normalizeLessonDuration('abc'), DEFAULT_LESSON_DURATION_MINUTES);
});
