const test = require('node:test');
const assert = require('node:assert/strict');
const { tariffsForDirection } = require('../src/config/officialCatalog');

const activeTypes = direction => tariffsForDirection(direction)
    .filter(plan => plan.isActive)
    .map(plan => plan.type);

test('укулеле имеет всю индивидуальную линейку и не имеет гибрида', () => {
    const types = activeTypes('Укулеле');
    assert.deepEqual(
        ['individual_1', 'individual_2', 'individual_3', 'individual_6m', 'individual_10m']
            .filter(type => types.includes(type)),
        ['individual_1', 'individual_2', 'individual_3', 'individual_6m', 'individual_10m'],
    );
    assert.equal(types.some(type => type.startsWith('hybrid_')), false);
});

test('все пять гибридных сроков доступны только для гитарных направлений', () => {
    const expected = ['hybrid_1m', 'hybrid_2m', 'hybrid_3m', 'hybrid_6m', 'hybrid_10m'];
    for (const direction of ['Гитара', 'Электрогитара', 'Басгитара']) {
        assert.deepEqual(activeTypes(direction).filter(type => type.startsWith('hybrid_')), expected);
    }
    for (const direction of ['Вокал', 'Фортепиано', 'Укулеле']) {
        assert.deepEqual(activeTypes(direction).filter(type => type.startsWith('hybrid_')), []);
    }
});

test('архивные позиции не возвращаются после полной синхронизации каталога', () => {
    const legacyTypes = new Set([
        'group_evening',
        'individual_1_2',
        'individual_2_2',
        'individual_4_long',
        'individual_4',
        'individual_8_25',
        'individual_year',
    ]);
    for (const direction of ['Гитара', 'Электрогитара', 'Басгитара', 'Вокал', 'Укулеле']) {
        assert.equal(activeTypes(direction).some(type => legacyTypes.has(type)), false);
    }
});

test('фортепиано сохраняет отключённый каталог до отдельного решения', () => {
    assert.deepEqual(activeTypes('Фортепиано'), []);
});

test('теория и квартет как отдельные позиции не появляются у вокала и укулеле', () => {
    for (const direction of ['Вокал', 'Укулеле']) {
        const types = activeTypes(direction);
        assert.equal(types.includes('theory'), false);
        assert.equal(types.includes('quartet_only'), false);
    }
});

test('актуальные индивидуальные и Duo доступны на всех продающих направлениях', () => {
    const individual = ['individual_1', 'individual_2', 'individual_3', 'individual_6m', 'individual_10m'];
    const duo = ['duet', 'duet_2m', 'duet_3m'];
    for (const direction of ['Гитара', 'Электрогитара', 'Басгитара', 'Вокал', 'Укулеле']) {
        const types = activeTypes(direction);
        assert.deepEqual(individual.filter(type => types.includes(type)), individual);
        assert.deepEqual(duo.filter(type => types.includes(type)), duo);
    }
});

test('лимиты экстренных отмен заданы по сроку и формату', () => {
    const plans = tariffsForDirection('Гитара');
    const emergency = Object.fromEntries(plans.map(plan => [plan.type, plan.emergencyFreezes || 0]));

    assert.deepEqual(
        [emergency.individual_1, emergency.individual_2, emergency.individual_3, emergency.individual_6m, emergency.individual_10m],
        [0, 2, 3, 6, 10],
    );
    assert.deepEqual(
        [emergency.duet, emergency.duet_2m, emergency.duet_3m],
        [0, 2, 3],
    );
    assert.deepEqual(
        [emergency.hybrid_1m, emergency.hybrid_2m, emergency.hybrid_3m, emergency.hybrid_6m, emergency.hybrid_10m],
        [0, 1, 2, 3, 5],
    );
});
