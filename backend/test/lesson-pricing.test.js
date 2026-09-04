const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getMembershipLessonChargeAmount,
} = require('../src/services/lessonPricing');

test('hybrid lesson rates match the package composition', () => {
    const oneMonth = { type: 'hybrid_1m' };
    const twoMonths = { type: 'hybrid_2m' };

    assert.equal(getMembershipLessonChargeAmount(oneMonth, { classType: 'individual', price: 0 }), 4000);
    assert.equal(getMembershipLessonChargeAmount(oneMonth, { classType: 'group', price: 0 }), 2250);
    assert.equal(getMembershipLessonChargeAmount(oneMonth, { classType: 'theory', price: 0 }), 1000);
    assert.equal(getMembershipLessonChargeAmount(twoMonths, { classType: 'individual', price: 0 }), 4000);
    assert.equal(getMembershipLessonChargeAmount(twoMonths, { classType: 'group', price: 0 }), 1750);
    assert.equal(getMembershipLessonChargeAmount(twoMonths, { classType: 'theory', price: 0 }), 1000);
});

test('hybrid rate takes precedence over a generic class price', () => {
    assert.equal(getMembershipLessonChargeAmount(
        { type: 'hybrid_2m' },
        { classType: 'group', price: 1200 },
    ), 1750);
});

test('legacy memberships preserve the configured class price fallback', () => {
    assert.equal(getMembershipLessonChargeAmount(
        { type: 'hybrid_1' },
        { classType: 'group', price: 1200 },
    ), 1200);
});
