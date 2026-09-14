const test = require('node:test');
const assert = require('node:assert/strict');

const {
    LESSON_RATES,
    normalizePurchaseFormat,
    normalizeProgramMonths,
    calculateProgramPrice,
    membershipLessonPrice,
} = require('../src/utils/pricing');

test('the standard program always totals 27,000 KZT', () => {
    assert.equal(LESSON_RATES.trial.price, 2000);
    assert.equal(LESSON_RATES.individual.price, 4000);
    assert.equal(LESSON_RATES.theory.price, 1000);
    assert.equal(LESSON_RATES.group.price, 2250);

    const result = calculateProgramPrice({
        trial: 2000,
        individual: 4000,
        theory: 1000,
        group: 2250,
    });

    assert.deepEqual(result.lessonCounts, { trial: 0, individual: 4, theory: 2, group: 4 });
    assert.deepEqual(result.componentTotals, { trial: 0, individual: 16000, theory: 2000, group: 9000 });
    assert.equal(result.lessonCount, 10);
    assert.equal(result.totalPrice, 27000);
    assert.equal(result.validityDays, 60);
});

test('the two-month program totals 50,000 KZT with the discount only on individual lessons', () => {
    const result = calculateProgramPrice({
        trial: 2000,
        individual: 4000,
        theory: 1000,
        group: 2250,
    }, 'program', 2);

    assert.deepEqual(result.lessonCounts, { trial: 0, individual: 8, theory: 4, group: 8 });
    assert.deepEqual(result.componentPrices, { trial: 2000, individual: 3500, theory: 1000, group: 2250 });
    assert.deepEqual(result.componentTotals, { trial: 0, individual: 28000, theory: 4000, group: 18000 });
    assert.equal(result.lessonCount, 20);
    assert.equal(result.undiscountedTotalPrice, 54000);
    assert.equal(result.programSavings, 4000);
    assert.equal(result.totalPrice, 50000);
    assert.equal(result.validityDays, 120);
});

test('the trial remains a separate 2,000 KZT purchase', () => {
    const result = calculateProgramPrice({
        trial: 2000,
        individual: 4000,
        theory: 1000,
        group: 2250,
    }, 'trial');

    assert.equal(result.lessonCount, 1);
    assert.equal(result.totalPrice, 2000);
    assert.equal(result.validityDays, 7);
});

test('billing uses the matching component snapshot', () => {
    const membership = {
        lessonFormat: 'program',
        lessonPrice: 2700,
        individualLessonPrice: 4000,
        theoryLessonPrice: 1000,
        groupLessonPrice: 2250,
    };

    assert.equal(membershipLessonPrice(membership, 'individual'), 4000);
    assert.equal(membershipLessonPrice(membership, 'theory'), 1000);
    assert.equal(membershipLessonPrice(membership, 'group'), 2250);
});

test('additional purchase formats and invalid prices are rejected', () => {
    assert.throws(() => normalizePurchaseFormat('package'), /основную программу/);
    assert.equal(normalizePurchaseFormat('individual'), 'individual');
    assert.throws(() => normalizeProgramMonths(3), /1 или 2 месяца/);
    assert.throws(() => calculateProgramPrice({
        trial: 2000,
        individual: 4000,
        theory: 0,
        group: 2250,
    }), /Некорректная цена/);
});

test('resolveMembershipPurchaseDates respects custom endDate and falls back to doubled validityDays', () => {
    const { resolveMembershipPurchaseDates } = require('../src/utils/pricing');
    const start = '2026-09-14';
    const autoDates = resolveMembershipPurchaseDates({ startDate: start, validityDays: 60 });
    assert.equal(autoDates.start.toISOString().slice(0, 10), '2026-09-14');
    assert.equal(autoDates.end.toISOString().slice(0, 10), '2026-11-13');

    const customEnd = '2026-10-01';
    const manualDates = resolveMembershipPurchaseDates({ startDate: start, endDate: customEnd, validityDays: 60 });
    assert.equal(manualDates.start.toISOString().slice(0, 10), '2026-09-14');
    assert.equal(manualDates.end.toISOString().slice(0, 10), '2026-10-01');

    const yearEnd = '2027-09-14';
    const yearDates = resolveMembershipPurchaseDates({ startDate: start, endDate: yearEnd, validityDays: 60 });
    assert.equal(yearDates.end.toISOString().slice(0, 10), '2027-09-14');
});
