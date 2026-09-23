const test = require('node:test');
const assert = require('node:assert/strict');
const { deductMembershipForClass, membershipSupportsClass, hasDeductionForClass } = require('../src/services/classMembership');
const { enrichMembershipBalance } = require('../src/utils/membershipBalance');
const { buildFreezeMembershipAdjustment } = require('../src/services/freezeService');

function program() {
    return {
        id: 'program', studentId: 'student', status: 'active', lessonFormat: 'program',
        groupId: 'quartet', classesRemaining: 20, classesUsed: 0,
        individualClassesRemaining: 8, groupClassesRemaining: 8, theoryClassesRemaining: 4,
        individualLessonPrice: 3500, groupLessonPrice: 2250, theoryLessonPrice: 1000,
        direction: { name: 'Гитара' }, totalPrice: 50000, totalClasses: 20,
        startDate: new Date('2026-09-01'), endDate: new Date('2026-11-01'),
    };
}

test('program eligibility enforces purchased type, group and direction', () => {
    const membership = program();
    assert.equal(membershipSupportsClass(membership, { classType: 'group', groupId: 'quartet', group: { direction: 'Гитара' } }), true);
    assert.equal(membershipSupportsClass(membership, { classType: 'group', groupId: 'quartet', group: { direction: 'Ансамбль' } }), true);
    assert.equal(membershipSupportsClass(membership, { classType: 'group', groupId: 'other' }), false);
    assert.equal(membershipSupportsClass(membership, { classType: 'theory', group: { direction: 'Вокал' } }), false);
    assert.equal(membershipSupportsClass({ ...membership, individualClassesRemaining: 0 }, { classType: 'individual' }), false);
    assert.equal(membershipSupportsClass({ lessonFormat: 'mixed', classesRemaining: 0, individualClassesRemaining: 0 }, { classType: 'individual' }), true);
});

test('rate-card deduction records money without consuming a counter and can be reapplied after reversal', async () => {
    const membership = { ...program(), billingModel: 'rate_card', lessonFormat: 'rate_card', classesRemaining: 0,
        lessonRates: { individual: { price: 3500, basePrice: 3500 } } };
    const transactions = [];
    const updates = [];
    const db = {
        $queryRaw: async (sql, id) => {
            assert.match(sql.join(''), /FOR UPDATE/);
            assert.equal(id, membership.id);
            return [{ ...membership }];
        },
        membership: {
            findFirst: async () => membership,
            updateMany: async ({ data }) => { updates.push(data); return { count: 1 }; },
        },
        membershipTransaction: {
            findMany: async () => transactions,
            create: async ({ data }) => { transactions.push(data); return data; },
        },
        classAttendee: { findFirst: async () => null },
    };
    const lesson = { id: 'lesson', title: 'Урок', classType: 'individual', date: new Date('2026-09-10') };
    const first = await deductMembershipForClass('student', lesson, 'admin', db, 'program');
    assert.equal(first.deducted, true);
    assert.equal(first.classesBalanceAfter, null);
    assert.equal(first.chargeAmount, 3500);
    assert.equal(transactions[0].chargeAmount, 3500);
    assert.equal(updates.length, 0);
    assert.equal(transactions[0].amount, 1);
    assert.equal((await deductMembershipForClass('student', lesson, 'admin', db, 'program')).reason, 'already_deducted');
    assert.equal(updates.length, 0);
    transactions.push({ membershipId: 'program', type: 'add', amount: 1 });
    assert.equal(await hasDeductionForClass('program', 'lesson', db), false);
    assert.equal((await deductMembershipForClass('student', lesson, 'admin', db, 'program')).deducted, true);
});

test('a legacy program cannot be used for new deductions', async () => {
    const db = { membership: { findFirst: async () => program() } };
    const result = await deductMembershipForClass('student', { id: 'lesson', classType: 'individual', date: new Date('2026-09-10') }, 'admin', db, 'program');
    assert.equal(result.deducted, false);
});

test('membership enrichment preserves purchased program counters', () => {
    const result = enrichMembershipBalance({ ...program(), student: { accountBalance: 100000 } });
    assert.equal(result.classesRemaining, 20);
    assert.equal(result.individualClassesRemaining, 8);
});

test('program freeze extends expiry without adding lessons and cancellation reverses it', () => {
    const membership = program();
    const freeze = { startDate: new Date('2026-09-10T00:00:00Z'), endDate: new Date('2026-09-12T23:59:59.999Z'), frozenClasses: 2 };
    const update = buildFreezeMembershipAdjustment(membership, freeze);
    assert.deepEqual(update, { freezesUsed: { increment: 1 }, endDate: new Date('2026-11-04') });
    const reversed = buildFreezeMembershipAdjustment({ ...membership, endDate: update.endDate }, freeze, true);
    assert.deepEqual(reversed, { freezesUsed: { decrement: 1 }, endDate: membership.endDate });
    assert.deepEqual(buildFreezeMembershipAdjustment({ lessonFormat: 'mixed' }, freeze), {
        freezesUsed: { increment: 1 }, classesRemaining: { increment: 2 }, totalClasses: { increment: 2 },
    });
});
