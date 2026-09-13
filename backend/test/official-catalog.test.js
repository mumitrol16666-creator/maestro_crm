const test = require('node:test');
const assert = require('node:assert/strict');
const { OFFICIAL_DIRECTIONS, tariffsForDirection, DEFAULT_LESSON_PRICING, PROGRAM_TERMS } = require('../src/config/officialCatalog');

test('исторические тарифы не возвращаются в продажу ни на одном направлении', () => {
    for (const direction of OFFICIAL_DIRECTIONS) {
        assert.equal(tariffsForDirection(direction).some(plan => plan.isActive), false);
    }
});

test('единая программа имеет два срока и скидку только на индивидуальную часть', () => {
    assert.deepEqual(Object.keys(PROGRAM_TERMS), ['1', '2']);
    const totals = Object.values(PROGRAM_TERMS).map(term => (
        term.individual * (DEFAULT_LESSON_PRICING.individual - term.individualDiscountPerLesson)
        + term.theory * DEFAULT_LESSON_PRICING.theory
        + term.group * DEFAULT_LESSON_PRICING.group
    ));
    assert.deepEqual(totals, [27000, 50000]);
});
