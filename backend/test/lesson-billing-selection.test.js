const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveGroupBillingSelection } = require('../src/services/lessonBillingSelection');

const memberships = [
    { id: 'membership-a', planId: 'plan-a', type: 'monthly' },
    { id: 'membership-b', planId: 'plan-b', type: 'hybrid_1m' },
    { id: 'legacy-membership', planId: null },
];

test('единственный тариф из списка группы выбирается автоматически', () => {
    assert.deepEqual(resolveGroupBillingSelection(memberships, ['plan-b']), {
        state: 'automatic',
        suggestedMembershipId: 'membership-b',
        allowedMembershipIds: ['membership-b'],
        message: '',
    });
});

test('при нескольких совпадениях CRM требует ручной выбор', () => {
    const result = resolveGroupBillingSelection(memberships, ['plan-a', 'plan-b']);
    assert.equal(result.state, 'multiple_matches');
    assert.equal(result.suggestedMembershipId, null);
    assert.deepEqual(result.allowedMembershipIds, ['membership-a', 'membership-b']);
});

test('отсутствующий в карточке ученика тариф не подставляется случайно', () => {
    const result = resolveGroupBillingSelection(memberships, ['plan-missing']);
    assert.equal(result.state, 'no_match');
    assert.equal(result.suggestedMembershipId, null);
});

test('группа без настройки тарифов всегда требует ручной выбор', () => {
    const result = resolveGroupBillingSelection(memberships, []);
    assert.equal(result.state, 'group_tariffs_not_configured');
    assert.equal(result.suggestedMembershipId, null);
});

test('настроенный глобальный тип подходит направленческому тарифу', () => {
    const result = resolveGroupBillingSelection(memberships, [
        { id: 'global-hybrid', legacyType: 'hybrid_1m' },
    ]);
    assert.equal(result.state, 'automatic');
    assert.equal(result.suggestedMembershipId, 'membership-b');
});

test('старая настройка hybrid_1 принимает актуальные гибридные пакеты', () => {
    const result = resolveGroupBillingSelection(memberships, [
        { id: 'legacy-hybrid-plan', legacyType: 'hybrid_1' },
    ]);
    assert.equal(result.state, 'automatic');
    assert.equal(result.suggestedMembershipId, 'membership-b');
});
