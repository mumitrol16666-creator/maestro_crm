const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateProgramPrice, membershipLessonPrice, normalizePurchaseFormat, normalizeProgramMonths } = require('../src/utils/pricing');
const { getMembershipLessonChargeAmount } = require('../src/services/lessonPricing');
const { membershipSupportsClass } = require('../src/services/classMembership');
const { OFFICIAL_DIRECTIONS, INDIVIDUAL_TERMS } = require('../src/config/officialCatalog');

const rates = { trial: 2000, individual: 4000, theory: 1000, group: 2250 };
const discount = (type, value, reason = 'Согласованная скидка') => ({
    additionalDiscountType: type,
    additionalDiscountValue: value,
    additionalDiscountReason: reason,
});

test('individual tariff 1 month: 8 lessons for 32,000 KZT', () => {
    const p = calculateProgramPrice(rates, 'individual', 1);
    assert.equal(p.lessonFormat, 'individual');
    assert.equal(p.programMonths, 1);
    assert.equal(p.lessonCount, 8);
    assert.equal(p.totalPrice, 32000);
    assert.equal(p.baseProgramPrice, 32000);
    assert.equal(p.programSavings, 0);
    assert.equal(p.lessonPrice, 4000);
    assert.equal(p.validityDays, 30);
    assert.equal(p.emergencyFreezesAvailable, 0);
    assert.deepEqual(p.lessonCounts, { trial: 0, individual: 8, theory: 0, group: 0 });
    assert.deepEqual(p.componentTotals, { trial: 0, individual: 32000, theory: 0, group: 0 });
    assert.deepEqual(p.componentPrices.individual, 4000);
});

test('individual tariff 2 months: 16 lessons for 62,000 KZT with 2,000 KZT base savings', () => {
    const p = calculateProgramPrice(rates, 'individual', 2);
    assert.equal(p.lessonFormat, 'individual');
    assert.equal(p.programMonths, 2);
    assert.equal(p.lessonCount, 16);
    assert.equal(p.totalPrice, 62000);
    assert.equal(p.baseProgramPrice, 62000);
    assert.equal(p.undiscountedTotalPrice, 64000);
    assert.equal(p.programSavings, 2000);
    assert.equal(p.lessonPrice, 3875);
    assert.equal(p.validityDays, 60);
    assert.equal(p.emergencyFreezesAvailable, 2);
    assert.deepEqual(p.lessonCounts, { trial: 0, individual: 16, theory: 0, group: 0 });
    assert.deepEqual(p.componentTotals, { trial: 0, individual: 62000, theory: 0, group: 0 });
    assert.deepEqual(p.componentPrices.individual, 3875);
});

test('individual tariff 3 months: 24 lessons for 90,000 KZT with 6,000 KZT base savings', () => {
    const p = calculateProgramPrice(rates, 'individual', 3);
    assert.equal(p.lessonFormat, 'individual');
    assert.equal(p.programMonths, 3);
    assert.equal(p.lessonCount, 24);
    assert.equal(p.totalPrice, 90000);
    assert.equal(p.baseProgramPrice, 90000);
    assert.equal(p.undiscountedTotalPrice, 96000);
    assert.equal(p.programSavings, 6000);
    assert.equal(p.lessonPrice, 3750);
    assert.equal(p.validityDays, 90);
    assert.equal(p.emergencyFreezesAvailable, 3);
    assert.deepEqual(p.lessonCounts, { trial: 0, individual: 24, theory: 0, group: 0 });
    assert.deepEqual(p.componentTotals, { trial: 0, individual: 90000, theory: 0, group: 0 });
    assert.deepEqual(p.componentPrices.individual, 3750);
});

test('individual terms validation rejects non-supported months', () => {
    for (const invalid of [0, 4, 12, -1, 'abc']) {
        assert.throws(() => normalizeProgramMonths(invalid, 'individual'), /1, 2 или 3 месяца/);
    }
});

test('additional percent discount applies cleanly to individual tariffs', () => {
    // 10% on 32k = 3200 -> 28800
    const p1 = calculateProgramPrice(rates, 'individual', 1, discount('percent', 10));
    assert.equal(p1.additionalDiscountAmount, 3200);
    assert.equal(p1.totalPrice, 28800);
    assert.equal(p1.componentTotals.individual, 28800);

    // 10% on 62k = 6200 -> 55800
    const p2 = calculateProgramPrice(rates, 'individual', 2, discount('percent', 10));
    assert.equal(p2.additionalDiscountAmount, 6200);
    assert.equal(p2.totalPrice, 55800);
    assert.equal(p2.componentTotals.individual, 55800);

    // 10% on 90k = 9000 -> 81000
    const p3 = calculateProgramPrice(rates, 'individual', 3, discount('percent', 10));
    assert.equal(p3.additionalDiscountAmount, 9000);
    assert.equal(p3.totalPrice, 81000);
    assert.equal(p3.componentTotals.individual, 81000);
});

test('additional fixed tenge discount allocates remainder down to 1 KZT and reconciles exactly during deduction', () => {
    const p = calculateProgramPrice(rates, 'individual', 2, discount('amount', 5001));
    assert.equal(p.totalPrice, 56999);
    assert.equal(p.additionalDiscountAmount, 5001);
    assert.deepEqual(p.individualAllocation, {
        lessonCount: 16,
        totalAmount: 56999,
        lowerPrice: 3562,
        higherPrice: 3563,
        higherPriceLessonCount: 7,
        lowerPriceLessonCount: 9,
    });

    // Simulate 16 lesson deductions
    let budgetRemaining = p.totalPrice;
    let classesRemaining = 16;
    let totalDeducted = 0;

    for (let i = 0; i < 16; i++) {
        const membership = {
            lessonFormat: 'individual',
            individualClassesRemaining: classesRemaining,
            individualBudgetRemaining: budgetRemaining,
        };
        const charge = getMembershipLessonChargeAmount(membership, { classType: 'individual' });
        assert.ok(charge === 3562 || charge === 3563, `Unexpected charge amount: ${charge}`);
        totalDeducted += charge;
        budgetRemaining -= charge;
        classesRemaining -= 1;
    }

    assert.equal(totalDeducted, 56999);
    assert.equal(budgetRemaining, 0);
    assert.equal(classesRemaining, 0);
});

test('individual membership supports only individual classes', () => {
    const membership = {
        lessonFormat: 'individual',
        classesRemaining: 8,
        individualClassesRemaining: 8,
        groupClassesRemaining: 0,
        theoryClassesRemaining: 0,
    };

    assert.equal(membershipSupportsClass(membership, { classType: 'individual' }), true);
    assert.equal(membershipSupportsClass(membership, { classType: 'group' }), false);
    assert.equal(membershipSupportsClass(membership, { classType: 'theory' }), false);

    // exhausted individual classes
    assert.equal(membershipSupportsClass({ ...membership, individualClassesRemaining: 0 }, { classType: 'individual' }), false);
});

test('all official musical directions can calculate individual tariffs', () => {
    assert.deepEqual(OFFICIAL_DIRECTIONS, [
        'Гитара',
        'Электрогитара',
        'Басгитара',
        'Вокал',
        'Фортепиано',
        'Укулеле',
    ]);

    for (const direction of OFFICIAL_DIRECTIONS) {
        for (const months of [1, 2, 3]) {
            const p = calculateProgramPrice(rates, 'individual', months);
            assert.ok(p.totalPrice > 0);
            assert.equal(p.lessonCounts.individual, INDIVIDUAL_TERMS[months].individual);
        }
    }
});
