const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeBillingPlanIds,
    validateBillingPlanIds,
} = require('../src/routes/groups');

test('пустой список тарифов не блокирует сохранение группы', async () => {
    let queried = false;
    const result = await validateBillingPlanIds([], {
        findMany: async () => {
            queried = true;
            return [];
        },
    });

    assert.deepEqual(result, { ids: [] });
    assert.equal(queried, false);
});

test('отсутствующее поле тарифов не блокирует создание группы через API', async () => {
    assert.deepEqual(await validateBillingPlanIds(undefined), { ids: [] });
});

test('список тарифов очищается от дублей перед проверкой', () => {
    assert.deepEqual(normalizeBillingPlanIds([' plan-a ', 'plan-a', '', 'plan-b']), [
        'plan-a',
        'plan-b',
    ]);
});

test('явно выбранный недоступный тариф по-прежнему отклоняется', async () => {
    const result = await validateBillingPlanIds(['plan-a', 'plan-missing'], {
        findMany: async () => [{ id: 'plan-a' }],
    });

    assert.deepEqual(result, {
        error: 'Один или несколько выбранных тарифов недоступны',
        status: 400,
    });
});
