const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyCutover } = require('../scripts/audit-student-balance-ledger');

const snapshot = { count: 2, total: 6000, fingerprint: 'fixture', students: [
    { id: 'a', accountBalance: 10000 }, { id: 'b', accountBalance: -4000 },
] };

test('cutover accepts unchanged accounts only when the journal is consistent', () => {
    assert.equal(verifyCutover({ snapshot }, { snapshot, consistent: true }), true);
    for (const consistent of [false, undefined]) {
        assert.throws(() => verifyCutover({ snapshot }, { snapshot, consistent }), /BALANCE_CUTOVER_MISMATCH/);
    }
});

test('same total cannot conceal changed individual balances or account identities', () => {
    for (const students of [
        [{ id: 'a', accountBalance: 9000 }, { id: 'b', accountBalance: -3000 }],
        [{ id: 'another', accountBalance: 10000 }, { id: 'b', accountBalance: -4000 }],
    ]) {
        assert.throws(() => verifyCutover({ snapshot }, { snapshot: { ...snapshot, students }, consistent: true }), /BALANCE_CUTOVER_MISMATCH/);
    }
    assert.throws(() => verifyCutover({}, { consistent: true }), /BALANCE_CUTOVER_MISMATCH/);
});
