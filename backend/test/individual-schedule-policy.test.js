const test = require('node:test');
const assert = require('node:assert/strict');
const { isIndividualMembership, individualScheduleRange } = require('../src/services/individualSchedulePolicy');
const { parseValidity, rateCardValidOnDate } = require('../src/services/rateCardValidity');
const { rateCardMembershipData, selectRateCard } = require('../src/services/rateCards');
const { calculateBalanceCoverage } = require('../src/services/balanceCoverage');
const card = rates => ({ id: 'rate', ...rateCardMembershipData({ studentId: 'student', name: 'Тариф', rates }) });

test('individual schedule recognises rate cards, including a free lesson, without guessing from the name', () => {
    assert.equal(isIndividualMembership(card({ individual: 4000 })), true);
    assert.equal(isIndividualMembership(card({ individual: { basePrice: 0, reason: 'Бесплатно' } })), true);
    assert.equal(isIndividualMembership({ ...card({ quartet: 2250 }), tariffName: 'Индивидуально · 1 месяц' }), false);
    assert.equal(isIndividualMembership({ ...card({ individual: 4000 }), status: 'archived' }), false);
    assert.equal(isIndividualMembership({ status: 'active', lessonFormat: 'individual' }), true);
});

test('sentinel 9999 cannot create an unbounded calendar; a real period limits generation', () => {
    const m = card({ individual: 4000 });
    const now = new Date('2026-10-08T10:00:00Z');
    const range = individualScheduleRange(m, now);
    assert.equal(range.startDate.toISOString().slice(0, 10), '2026-10-08');
    assert.equal((range.endDate - range.startDate) / 86400000, 90);
    const limited = individualScheduleRange({ ...m, ...parseValidity({ validFrom: '2026-10-10', validUntil: '2026-11-09' }) }, now);
    assert.equal(limited.startDate.toISOString().slice(0, 10), '2026-10-10');
    assert.equal(limited.endDate.toISOString().slice(0, 10), '2026-11-09');
});

test('dates are explicit, valid calendar dates with an inclusive end; imports remain usable until reviewed', () => {
    for (const input of [{}, { validFrom: '2026-02-30', validUntil: '2026-03-30' },
        { validFrom: '2026-10-08', validUntil: '2026-10-07' }, { validFrom: '2026-10-08T00:00:00Z', validUntil: '2026-11-08' }]) {
        assert.throws(() => parseValidity(input));
    }
    const validity = parseValidity({ validFrom: '2026-10-08', validUntil: '2026-11-07' });
    assert.equal(rateCardValidOnDate(validity, '2026-10-08'), true);
    assert.equal(rateCardValidOnDate(validity, '2026-11-07'), true);
    assert.equal(rateCardValidOnDate(validity, '2026-11-08'), false);
    assert.equal(rateCardValidOnDate(validity, '2026-10-07'), false);
    assert.equal(rateCardValidOnDate(validity, undefined), false);
    assert.equal(rateCardValidOnDate(card({ individual: 4000 }), '2026-10-08'), true);
});

test('billing selection and balance forecast use the lesson date, including approval after the period ends', () => {
    const m = { ...card({ individual: 4000 }), ...parseValidity({ validFrom: '2026-10-01', validUntil: '2026-10-31' }) };
    const inside = { id: 'inside', classType: 'individual', date: '2026-10-31', startTime: '14:00' };
    const outside = { ...inside, id: 'outside', date: '2026-11-01' };
    assert.equal(selectRateCard([m], inside), m);
    assert.equal(selectRateCard([m], outside), null);
    const coverage = calculateBalanceCoverage({ balance: 24000, memberships: [m], lessons: [inside, outside] });
    assert.equal(coverage.coveredLessons, 1);
    assert.equal(coverage.remainingBalance, 20000);
});
