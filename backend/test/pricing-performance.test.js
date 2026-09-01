const test = require('node:test');
const assert = require('node:assert/strict');

const { computeMembershipPrice } = require('../src/utils/pricing');

test('активный приглашённый ученик ищется одним пакетным запросом', async () => {
    let referralQueries = 0;
    const tx = {
        student: {
            findUnique: async () => ({
                id: 'referrer-1',
                familyId: null,
                referredByStudentId: null,
                referredByBookingId: null,
                concessionType: null,
            }),
            findFirst: async (query) => {
                referralQueries += 1;
                assert.equal(query.where.referredByStudentId, 'referrer-1');
                assert.equal(query.where.OR.length, 2);
                return { id: 'active-referral-1' };
            },
        },
        booking: {
            findFirst: async () => null,
        },
    };

    const result = await computeMembershipPrice('referrer-1', 'monthly', {}, tx);

    assert.equal(referralQueries, 1);
    assert.equal(result.discountReferralPercent, 5);
    assert.equal(result.totalPrice, 20_900);
});
