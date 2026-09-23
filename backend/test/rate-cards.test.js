const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRates, getLessonBillingType, getRateCardPrice, selectRateCard, rateCardSelectionOptions } = require('../src/services/rateCards');
const { getMembershipLessonChargeAmount } = require('../src/services/lessonPricing');
const { calculateBalanceCoverage } = require('../src/services/balanceCoverage');
const { legacyRates, classifyGroup, snapshotFingerprint } = require('../src/services/rateCardMigration');
const card = (rates, extra = {}) => ({ id: 'card', status: 'active', billingModel: 'rate_card', lessonFormat: 'rate_card',
    classesRemaining: 0, startDate: '2000-01-01', endDate: '2000-01-02', lessonRates: normalizeRates(rates), ...extra });
const lesson = kind => ({ id: kind, classType: kind === 'individual' ? 'individual' : 'group', groupId: kind === 'individual' ? null : 'g', group: { billingType: kind }, date: '2026-09-01', startTime: '12:00', status: 'scheduled', price: 999999 });

test('group purpose resolves quartet, duo, trio and theory independently of class price or attendance', () => {
    const m = card({ individual: 4000, quartet: 2250, duo: 2750, trio: 2400, theory: 1000 });
    for (const [kind, price] of Object.entries({ individual: 4000, quartet: 2250, duo: 2750, trio: 2400, theory: 1000 })) {
        assert.equal(getLessonBillingType(lesson(kind)), kind);
        assert.equal(getMembershipLessonChargeAmount(m, lesson(kind)), price);
        assert.equal(getMembershipLessonChargeAmount(m, { ...lesson(kind), attendees: [{}, {}] }), price);
    }
});

test('missing duo rate never takes quartet, theory, class price or a fallback', () => {
    const m = card({ quartet: 2250 });
    assert.equal(getRateCardPrice(m, lesson('duo')), null);
    assert.equal(getMembershipLessonChargeAmount(m, { classType: 'group', price: 8000 }), null);
    assert.equal(rateCardSelectionOptions([m], lesson('duo')).state, 'no_match');
    assert.equal(rateCardSelectionOptions([m], { classType: 'group' }).state, 'billing_type_missing');
});

test('discount applies exactly once to its own row; free individual remains free', () => {
    const m = card({ individual: { basePrice: 4000, discountPercent: 100, reason: 'Льгота' }, quartet: 2250,
        duo: { basePrice: 2750, discountPercent: 10, reason: 'Семейная' }, theory: { basePrice: 1000, discountAmount: 100, reason: 'Персональная' } },
    { discountPercent: 90, basePrice: 27000, totalPrice: 100 });
    assert.equal(getMembershipLessonChargeAmount(m, lesson('individual')), 0);
    assert.equal(getMembershipLessonChargeAmount(m, lesson('quartet')), 2250);
    assert.equal(getMembershipLessonChargeAmount(m, lesson('duo')), 2475);
    assert.equal(getMembershipLessonChargeAmount(m, lesson('theory')), 900);
});

test('rounding and invalid inputs cannot create negative, NaN or accidentally free rates', () => {
    assert.equal(normalizeRates({ duo: { basePrice: 2750, discountPercent: 7.33, reason: 'Скидка' } }).duo.price, 2548);
    for (const input of [{ duo: '' }, { duo: { basePrice: '' } }, { duo: -1 }, { duo: 0 },
        { duo: { basePrice: 2500, discountPercent: 101, reason: 'x' } }, { duo: { basePrice: 2500, discountAmount: 2600, reason: 'x' } },
        { duo: { basePrice: 2500, discountAmount: 100, discountPercent: 5, reason: 'x' } }, { group: 2250 }, {}]) {
        assert.throws(() => normalizeRates(input));
    }
});

test('zero counts and expired dates do not limit rates or monetary forecast', () => {
    const m = card({ quartet: 2250, theory: 1000 });
    assert.equal(selectRateCard([m], lesson('quartet')), m);
    const forecast = calculateBalanceCoverage({ balance: 6000, memberships: [m], lessons: [lesson('quartet'), { ...lesson('theory'), startTime: '13:00' }, { ...lesson('quartet'), id: 'third', startTime: '14:00' }] });
    assert.equal(forecast.coveredLessons, 3);
    assert.equal(forecast.remainingBalance, 500);
    assert.equal(m.classesRemaining, 0);
});

test('multiple matching cards require an explicit selection, inactive cards never match', () => {
    const a = card({ duo: 2750 }); const b = card({ duo: 2500 }, { id: 'other' });
    assert.equal(selectRateCard([a, b], lesson('duo')), null);
    assert.equal(selectRateCard([a, b], lesson('duo'), b.id), b);
    assert.equal(selectRateCard([{ ...a, status: 'archived' }], lesson('duo')), null);
});

test('migration preserves zero snapshots and single-format price instead of average across a program', () => {
    const converted = legacyRates({ lessonFormat: 'program', type: 'program', programMonths: 1, individualLessonPrice: 0, groupLessonPrice: 2250, theoryLessonPrice: 1000 });
    assert.equal(converted.individual.price, 0); assert.equal(converted.quartet.price, 2250);
    assert.equal(legacyRates({ type: 'duet', lessonFormat: 'group', totalPrice: 22000, totalClasses: 8 }).duo.price, 2750);
    assert.throws(() => legacyRates({ type: 'hybrid_1', lessonFormat: 'mixed', totalPrice: 9600, totalClasses: 8 }));
});

test('group migration uses known purpose, not the number or names of participants', () => {
    assert.equal(classifyGroup({ name: 'Теория 1', billingPlans: [] }), 'theory');
    assert.equal(classifyGroup({ name: 'Е бемоль', billingPlans: [{ legacyType: 'quartet_only' }], currentStudents: 2 }), 'quartet');
    assert.equal(classifyGroup({ name: 'Яна и Мирон', billingPlans: [], currentStudents: 2 }), null);
});

test('migration fingerprint survives serialization and detects tariff changes', () => {
    const s = { memberships: [{ id: 'm', createdAt: new Date(), updatedAt: new Date(), plan: { createdAt: new Date() } }], groups: [], students: [] };
    assert.equal(snapshotFingerprint(s), snapshotFingerprint(JSON.parse(JSON.stringify(s))));
    assert.notEqual(snapshotFingerprint(s), snapshotFingerprint({ ...s, memberships: [{ ...s.memberships[0], totalPrice: 10 }] }));
});
