const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateProgramPrice, membershipLessonPrice } = require('../src/utils/pricing');
const { getMembershipLessonChargeAmount } = require('../src/services/lessonPricing');
const rates = { trial: 2000, individual: 4000, theory: 1000, group: 2250 };
const discount = (type, value, reason = 'Согласованная скидка') => ({ additionalDiscountType: type, additionalDiscountValue: value, additionalDiscountReason: reason });

test('1001 KZT additional discount applies after the two-month 4000 discount, only to individuals', () => {
    const p = calculateProgramPrice(rates, 'program', 2, discount('amount', 1001));
    assert.equal(p.baseProgramPrice, 50000);
    assert.equal(p.programSavings, 4000);
    assert.equal(p.additionalDiscountAmount, 1001);
    assert.equal(p.totalPrice, 48999);
    assert.deepEqual(p.componentTotals, { trial: 0, individual: 26999, theory: 4000, group: 18000 });
    assert.deepEqual(p.individualAllocation, { lessonCount: 8, totalAmount: 26999, lowerPrice: 3374, higherPrice: 3375, higherPriceLessonCount: 7, lowerPriceLessonCount: 1 });
});

test('7.33 percent is taken from 27k/50k, rounded once to whole KZT, and audited separately', () => {
    for (const [months, expected] of [[1, 1979], [2, 3665]]) {
        const p = calculateProgramPrice(rates, 'program', months, discount('percent', '7.33'));
        assert.equal(p.additionalDiscountAmount, expected);
        assert.equal(p.additionalDiscountBasisPoints, 733);
        assert.equal(p.totalPrice, (months === 1 ? 27000 : 50000) - expected);
        assert.equal(p.componentPrices.group, 2250);
        assert.equal(p.componentPrices.theory, 1000);
    }
});

test('zero-priced individuals never fall back to full lesson or average program prices', () => {
    const p = calculateProgramPrice(rates, 'program', 2, discount('amount', 28000));
    const membership = { lessonFormat: 'program', individualLessonPrice: 0, lessonPrice: p.lessonPrice, individualBudgetRemaining: 0, individualClassesRemaining: 8 };
    assert.equal(p.totalPrice, 22000);
    assert.equal(membershipLessonPrice(membership, 'individual', 9999), 0);
    assert.equal(getMembershipLessonChargeAmount(membership, { classType: 'individual', price: 9999 }), 0);
});

test('additional discount validation rejects malformed, excessive, unaudited and trial discounts', () => {
    for (const input of [discount('other', 0), discount('amount', -1), discount('amount', 1.1), discount('percent', 7.333), discount('percent', 101), discount('amount', 28001), discount('none', 1), discount('amount', 1, ''), discount('amount', 1, 'x'.repeat(501))]) {
        assert.throws(() => calculateProgramPrice(rates, 'program', 2, input));
    }
    assert.throws(() => calculateProgramPrice(rates, 'trial', 1, discount('percent', 1)));
});
