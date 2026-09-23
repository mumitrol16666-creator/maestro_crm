const test = require('node:test');
const assert = require('node:assert/strict');
const { outstandingClassCharges } = require('../src/services/classChargeLedger');

test('legacy event debt stays visible after later quantity-based cycles are settled', () => {
    const events = [
        { membershipId: 'm', type: 'manual_deduct', amount: 0 },
        { membershipId: 'm', type: 'manual_deduct', amount: 1, chargeAmount: 4000 },
        { membershipId: 'm', type: 'add', amount: 1, chargeAmount: 4000 },
    ];
    assert.deepEqual(outstandingClassCharges(events), [{ membershipId: 'm', amount: 0, chargeAmount: 0 }]);
    events.push({ membershipId: 'm', type: 'add', amount: 0 });
    assert.deepEqual(outstandingClassCharges(events), []);
});

test('aggregated quantity reversal and individual zero-event reversals settle independently', () => {
    const events = [0, 0, 1, 1].map(amount => ({ membershipId: 'm', type: 'manual_deduct', amount, chargeAmount: 2000 }));
    const reversals = outstandingClassCharges(events);
    assert.deepEqual(reversals.map(row => row.amount), [2, 0, 0]);
    assert.equal(reversals.reduce((sum, row) => sum + row.chargeAmount, 0), 8000);
    assert.deepEqual(outstandingClassCharges([...events, ...reversals.map(row => ({ ...row, type: 'add' }))]), []);
});
