const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildMembershipEdit,
    buildManualPriceSnapshot,
} = require('../src/services/membershipEditPolicy');

const membership = {
    id: 'membership-1',
    startDate: new Date('2026-08-01T00:00:00.000Z'),
    endDate: new Date('2026-09-01T00:00:00.000Z'),
    freezesAvailable: 2,
    emergencyFreezesAvailable: 1,
    totalPrice: 18000,
    basePrice: 20000,
    discountPercent: 10,
    discountReferralPercent: 5,
    discountFamilyPercent: 5,
    discountConcessionPercent: 0,
    discountManualPercent: 0,
    paidAmount: 12000,
    remainingAmount: 6000,
    paymentStatus: 'partial',
};

test('изменение даты не затрагивает цену, скидки и оплату', () => {
    const edit = buildMembershipEdit(membership, { endDate: '2026-09-15' });

    assert.deepEqual(Object.keys(edit.updateData), ['endDate']);
    assert.equal(edit.updateData.endDate.toISOString(), '2026-09-15T00:00:00.000Z');
    assert.equal(Object.hasOwn(edit.updateData, 'totalPrice'), false);
    assert.equal(Object.hasOwn(edit.updateData, 'paidAmount'), false);
    assert.equal(Object.hasOwn(edit.updateData, 'paymentStatus'), false);
});

test('неизменённые значения не создают обновление', () => {
    const edit = buildMembershipEdit(membership, {
        startDate: '2026-08-01',
        endDate: '2026-09-01',
        freezesAvailable: 2,
        emergencyFreezesAvailable: 1,
        totalPrice: 18000,
    });

    assert.equal(edit.changed, false);
    assert.deepEqual(edit.updateData, {});
});

test('ручная цена обновляет только ценовой снимок и не трогает оплату', () => {
    const edit = buildMembershipEdit(membership, { totalPrice: 17000 });

    assert.deepEqual(edit.updateData, {
        totalPrice: 17000,
        basePrice: 20000,
        discountPercent: 15,
        discountReferralPercent: 0,
        discountFamilyPercent: 0,
        discountConcessionPercent: 0,
        discountManualPercent: 15,
    });
    assert.equal(Object.hasOwn(edit.updateData, 'paidAmount'), false);
    assert.equal(Object.hasOwn(edit.updateData, 'remainingAmount'), false);
    assert.equal(Object.hasOwn(edit.updateData, 'paymentStatus'), false);
});

test('ручная цена выше прежней базы становится новой базовой ценой', () => {
    assert.deepEqual(buildManualPriceSnapshot(membership, 22000), {
        totalPrice: 22000,
        basePrice: 22000,
        discountPercent: 0,
        discountReferralPercent: 0,
        discountFamilyPercent: 0,
        discountConcessionPercent: 0,
        discountManualPercent: 0,
    });
});

test('нельзя сохранить некорректный период или число заморозок', () => {
    assert.throws(
        () => buildMembershipEdit(membership, { endDate: '2026-07-31' }),
        { code: 'INVALID_MEMBERSHIP_PERIOD' },
    );
    assert.throws(
        () => buildMembershipEdit(membership, { freezesAvailable: 25 }),
        { code: 'INVALID_MEMBERSHIP_VALUE' },
    );
});
