const test = require('node:test');
const assert = require('node:assert/strict');
const {
    distributePlanPrice,
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

test('new program snapshots total 50,000 with the discount only on individual lessons', () => {
    const membership = {
        lessonFormat: 'program', type: 'program',
        individualLessonPrice: 3500, groupLessonPrice: 2250, theoryLessonPrice: 1000,
        totalPrice: 50000, basePrice: 54000, discountPercent: 7,
    };
    const charge = classType => getMembershipLessonChargeAmount(membership, { classType, price: 9999 });
    assert.equal(charge('individual'), 3500);
    assert.equal(charge('group'), 2250);
    assert.equal(charge('theory'), 1000);
    assert.equal(8 * charge('individual') + 8 * charge('group') + 4 * charge('theory'), 50000);
});

test('nullable historical snapshots preserve existing discounted billing', () => {
    assert.equal(getMembershipLessonChargeAmount({
        type: 'hybrid_2m', groupLessonPrice: null, totalPrice: 45000, basePrice: 50000,
    }, { classType: 'group', price: 1200 }), 1575);
    assert.equal(getMembershipLessonChargeAmount({
        type: 'program', lessonFormat: 'program', groupLessonPrice: 0,
    }, { classType: 'group', price: 1200 }), 0);
});

test('dormant historical snapshots cannot change the pre-release discounted charges', () => {
    const historical = {
        type: 'hybrid_1m', lessonFormat: 'mixed',
        groupLessonPrice: 750, individualLessonPrice: 4000, theoryLessonPrice: 1000,
        basePrice: 27000, totalPrice: 24000, discountPercent: 11,
    };
    assert.equal(getMembershipLessonChargeAmount(historical, { classType: 'group', price: 1200 }), 2000);
    assert.equal(getMembershipLessonChargeAmount(historical, { classType: 'individual', price: 4000 }), 3556);
    assert.equal(getMembershipLessonChargeAmount(historical, { classType: 'theory', price: 1000 }), 889);
});

test('legacy duo memberships charge the price actually paid per lesson', () => {
    const duo = { type: 'duet', lessonFormat: 'group', totalPrice: 22000, totalClasses: 8, basePrice: 22000 };
    assert.equal(getMembershipLessonChargeAmount(duo, { classType: 'group', price: 0 }), 2750);
    assert.equal(getMembershipLessonChargeAmount(duo, { classType: 'group', price: 1200 }), 2750);
    // Теория на дуо-абонементе остаётся по цене теории.
    assert.equal(getMembershipLessonChargeAmount(duo, { classType: 'theory', price: 0 }), 1000);
});

test('legacy homogeneous group memberships derive the lesson price from the purchase', () => {
    assert.equal(getMembershipLessonChargeAmount(
        { type: 'group_mini', lessonFormat: 'group', totalPrice: 16000, totalClasses: 8 },
        { classType: 'group', price: 0 },
    ), 2000);
    assert.equal(getMembershipLessonChargeAmount(
        { type: 'quartet_only', lessonFormat: 'group', lessonPrice: 2000, totalPrice: 8000, totalClasses: 4 },
        { classType: 'group', price: 0 },
    ), 2000);
    // Скидка уже внутри totalPrice: второй раз не применяется.
    assert.equal(getMembershipLessonChargeAmount(
        { type: 'duet', lessonFormat: 'group', basePrice: 22000, totalPrice: 18000, totalClasses: 8, discountPercent: 18 },
        { classType: 'group', price: 0 },
    ), 2250);
});

test('a stored snapshot wins over the purchase average for homogeneous memberships', () => {
    assert.equal(getMembershipLessonChargeAmount(
        { type: 'duet', lessonFormat: 'group', groupLessonPrice: 2600, totalPrice: 22000, totalClasses: 8 },
        { classType: 'group', price: 0 },
    ), 2600);
});

test('homogeneous memberships without purchase data keep the previous fallback', () => {
    assert.equal(getMembershipLessonChargeAmount(
        { type: 'duet', lessonFormat: 'group', totalPrice: 0, totalClasses: 8 },
        { classType: 'group', price: 0 },
    ), 1200);
    assert.equal(getMembershipLessonChargeAmount(
        { type: 'duet', lessonFormat: 'group', totalPrice: 0, basePrice: 22000, totalClasses: 8 },
        { classType: 'group', price: 0 },
    ), 0);
});

test('legacy hybrids keep the package table until their snapshots are backfilled', () => {
    assert.equal(getMembershipLessonChargeAmount(
        { type: 'hybrid_1m', lessonFormat: 'mixed', totalPrice: 27000, totalClasses: 10 },
        { classType: 'group', price: 0 },
    ), 2250);
});

test('distributePlanPrice splits a tariff into per-lesson prices', () => {
    const split = (plan, prices) => distributePlanPrice(plan, prices);
    assert.deepEqual(split({ lessonFormat: 'mixed', price: 27000, individualClasses: 4, groupClasses: 4, theoryClasses: 2 }),
        { individual: 4000, group: 2250, theory: 1000, trial: null });
    assert.deepEqual(split({ lessonFormat: 'mixed', price: 50000, individualClasses: 8, groupClasses: 8, theoryClasses: 4 }),
        { individual: 4000, group: 1750, theory: 1000, trial: null });
    assert.deepEqual(split({ lessonFormat: 'mixed', price: 18000, individualClasses: 0, groupClasses: 8, theoryClasses: 2 }),
        { individual: null, group: 2000, theory: 1000, trial: null });
    assert.deepEqual(split({ lessonFormat: 'group', legacyType: 'duet', price: 22000, includedUnits: 8 }),
        { individual: null, group: 2750, theory: null, trial: null });
    assert.deepEqual(split({ lessonFormat: 'group', legacyType: 'theory', price: 4000, includedUnits: 4 }),
        { individual: null, group: null, theory: 1000, trial: null });
    assert.deepEqual(split({ lessonFormat: 'individual', price: 32000, classes: 8 }),
        { individual: 4000, group: null, theory: null, trial: null });
    assert.deepEqual(split({ lessonFormat: 'trial', price: 2000, includedUnits: 1 }),
        { individual: null, group: null, theory: null, trial: 2000 });
    // Цены направления переопределяют умолчания.
    assert.equal(split({ lessonFormat: 'mixed', price: 27000, individualClasses: 4, groupClasses: 4, theoryClasses: 2 }, { individual: 3500, theory: 1000 }).group, 2750);
    // Тариф дешевле фиксированных компонентов: цену группы вывести нельзя.
    assert.equal(split({ lessonFormat: 'mixed', price: 10000, individualClasses: 4, groupClasses: 4, theoryClasses: 0 }).group, null);
});
