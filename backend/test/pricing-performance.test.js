const test = require('node:test');
const assert = require('node:assert/strict');

const { computeMembershipPrice } = require('../src/utils/pricing');

test('цена программы требует только один запрос направления и не применяет старые скидки', async () => {
    let directionQueries = 0;
    const tx = {
        direction: {
            findUnique: async () => ({
                id: `direction-${++directionQueries}`,
                isActive: true,
                trialLessonPrice: 2000,
                individualLessonPrice: 4000,
                theoryLessonPrice: 1000,
                groupLessonPrice: 2250,
            }),
        },
    };

    const result = await computeMembershipPrice({ directionId: 'direction-1', lessonFormat: 'program', programMonths: 2 }, tx);

    assert.equal(directionQueries, 1);
    assert.equal(result.totalPrice, 50_000);
    assert.equal(result.componentPrices.individual, 3_500);
    assert.equal(result.programSavings, 4_000);
});
