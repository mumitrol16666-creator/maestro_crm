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

    for (const type of ['hybrid_3m', 'hybrid_6m', 'hybrid_10m']) {
        const membership = { type };
        assert.equal(getMembershipLessonChargeAmount(membership, { classType: 'individual', price: 0 }), 4000);
        assert.equal(getMembershipLessonChargeAmount(membership, { classType: 'group', price: 0 }), 1750);
        assert.equal(getMembershipLessonChargeAmount(membership, { classType: 'theory', price: 0 }), 1000);
    }
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

test('applies the exact membership price ratio instead of the rounded discount percent', () => {
    const discounted = {
        type: 'hybrid_1m',
        basePrice: 27000,
        totalPrice: 24000,
        discountPercent: 11,
    };

    assert.equal(getMembershipLessonChargeAmount(discounted, { classType: 'individual', price: 0 }), 3556);
    assert.equal(getMembershipLessonChargeAmount(discounted, { classType: 'group', price: 0 }), 2000);
    assert.equal(getMembershipLessonChargeAmount(discounted, { classType: 'theory', price: 0 }), 889);
});

test('applies membership discounts to non-hybrid lesson prices', () => {
    assert.equal(getMembershipLessonChargeAmount(
        { type: 'individual_1', basePrice: 32000, totalPrice: 30000, discountPercent: 6 },
        { classType: 'individual', price: 4000 },
    ), 3750);
});

test('falls back to the stored discount percent when the price pair is unusable', () => {
    assert.equal(getMembershipLessonChargeAmount(
        { type: 'hybrid_1m', basePrice: 27000, totalPrice: 52000, discountPercent: 10 },
        { classType: 'group', price: 0 },
    ), 2025);
});

test('preserves full price when the membership has no discount', () => {
    assert.equal(getMembershipLessonChargeAmount(
        { type: 'hybrid_1m', basePrice: 27000, totalPrice: 27000, discountPercent: 0 },
        { classType: 'group', price: 0 },
    ), 2250);
});

test('supports fully discounted memberships without falling back to full price', () => {
    assert.equal(getMembershipLessonChargeAmount(
        { type: 'hybrid_1m', basePrice: 27000, totalPrice: 0, discountPercent: 100 },
        { classType: 'group', price: 0 },
    ), 0);
});
