const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateProgramPrice } = require('../src/utils/pricing');
const { getMembershipLessonChargeAmount } = require('../src/services/lessonPricing');

const rates = { trial: 2000, individual: 4000, theory: 1000, group: 2250 };
function consumeIndividual(preview) {
    const membership = {
        lessonFormat: 'program', individualLessonPrice: preview.componentPrices.individual,
        individualClassesRemaining: preview.lessonCounts.individual,
        individualBudgetRemaining: preview.componentTotals.individual,
    };
    let total = 0;
    while (membership.individualClassesRemaining > 0) {
        const charge = getMembershipLessonChargeAmount(membership, { classType: 'individual', price: 99999 });
        assert.ok(Number.isInteger(charge) && charge >= 0);
        membership.individualBudgetRemaining -= charge;
        membership.individualClassesRemaining -= 1;
        total += charge;
    }
    assert.equal(membership.individualBudgetRemaining, 0);
    return total;
}

for (const months of [1, 2]) {
    test(`every whole-tenge discount reconciles exactly for ${months} month program`, () => {
        const base = calculateProgramPrice(rates, 'program', months);
        const cap = base.componentTotals.individual;
        for (let amount = 0; amount <= cap; amount += 1) {
            const preview = calculateProgramPrice(rates, 'program', months, {
                additionalDiscountType: 'amount', additionalDiscountValue: amount, additionalDiscountReason: 'QA exhaustive reconciliation',
            });
            assert.equal(preview.totalPrice, base.totalPrice - amount);
            assert.equal(preview.componentTotals.group, base.componentTotals.group);
            assert.equal(preview.componentTotals.theory, base.componentTotals.theory);
            const actual = consumeIndividual(preview) + preview.componentTotals.group + preview.componentTotals.theory;
            assert.equal(actual, preview.totalPrice);
        }
    });
}

test('7.33 percent is applied to 50,000, and maximum discount preserves group and theory', () => {
    const preview = calculateProgramPrice(rates, 'program', 2, {
        additionalDiscountType: 'percent', additionalDiscountValue: '7.33', additionalDiscountReason: 'QA fractional percent',
    });
    assert.equal(preview.additionalDiscountAmount, 3665);
    assert.equal(preview.totalPrice, 46335);
    assert.equal(consumeIndividual(preview), 24335);
    const freeIndividual = calculateProgramPrice(rates, 'program', 2, {
        additionalDiscountType: 'amount', additionalDiscountValue: 28000, additionalDiscountReason: 'QA free individual',
    });
    assert.equal(consumeIndividual(freeIndividual), 0);
    assert.equal(freeIndividual.totalPrice, 22000);
});
