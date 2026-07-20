const assert = require('node:assert/strict');
const test = require('node:test');
const { buildExpectedPaymentOverview } = require('../src/services/integrationRead');

test('expected payment overview includes active low balances and tops them up to threshold', () => {
    const overview = buildExpectedPaymentOverview([
        {
            id: 'student-a',
            name: 'Анна',
            lastName: 'Иванова',
            phone: '+77000000001',
            accountBalance: 3000,
            learningDirections: ['Гитара'],
            memberships: [],
        },
        {
            id: 'student-b',
            name: 'Борис',
            lastName: 'Петров',
            phone: '+77000000002',
            accountBalance: -2000,
            learningDirections: [],
            memberships: [{ group: { direction: 'Вокал' }, plan: { name: 'Индивидуальный' } }],
        },
        {
            id: 'student-c',
            name: 'Вера',
            lastName: 'Сидорова',
            phone: '+77000000003',
            accountBalance: 4000,
            learningDirections: [],
            memberships: [],
        },
    ], 4000);

    assert.equal(overview.count, 2);
    assert.equal(overview.debtCount, 1);
    assert.equal(overview.expectedRevenueKzt, 7000);
    assert.deepEqual(
        overview.students.map((student) => [student.crmStudentId, student.expectedTopUpKzt]),
        [['student-b', 6000], ['student-a', 1000]],
    );
    assert.equal(overview.students[0].direction, 'Вокал');
});
