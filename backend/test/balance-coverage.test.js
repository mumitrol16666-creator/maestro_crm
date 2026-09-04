const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getLessonChargeAmount,
    calculateBalanceCoverage,
    selectMembershipForLesson,
    loadBalanceCoverageForMembershipRows,
} = require('../src/services/balanceCoverage');

function membership(overrides = {}) {
    return {
        id: 'membership-1',
        status: 'active',
        lessonFormat: 'mixed',
        type: 'monthly',
        classesRemaining: 0,
        individualClassesRemaining: 0,
        groupClassesRemaining: 0,
        theoryClassesRemaining: 0,
        groupId: null,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
    };
}

function lesson(id, date, startTime, classType, overrides = {}) {
    return {
        id,
        date: new Date(`${date}T00:00:00.000Z`),
        startTime,
        classType,
        groupId: classType === 'group' ? 'group-1' : null,
        price: 0,
        status: 'scheduled',
        ...overrides,
    };
}

test('uses chronological lesson-type charges for the 6200 example', () => {
    const result = calculateBalanceCoverage({
        balance: 6200,
        memberships: [membership()],
        lessons: [
            lesson('1', '2026-09-05', '10:00', 'individual'),
            lesson('2', '2026-09-06', '10:00', 'group'),
            lesson('3', '2026-09-07', '10:00', 'theory'),
        ],
    });

    assert.equal(result.coveredLessons, 3);
    assert.equal(result.remainingBalance, 0);
    assert.equal(result.stopReason, 'all_scheduled_covered');
    assert.deepEqual(result.breakdown, { individual: 1, group: 1, theory: 1 });
});

test('sorts lessons before calculating and stops at the first uncovered lesson', () => {
    const result = calculateBalanceCoverage({
        balance: 2200,
        memberships: [membership()],
        lessons: [
            lesson('3', '2026-09-07', '10:00', 'individual'),
            lesson('2', '2026-09-06', '10:00', 'theory'),
            lesson('1', '2026-09-05', '10:00', 'group'),
        ],
    });

    assert.equal(result.coveredLessons, 2);
    assert.equal(result.nextLesson.classType, 'individual');
    assert.equal(result.stopReason, 'insufficient_balance');
});

test('does not skip an expensive nearest lesson to count cheaper later lessons', () => {
    const result = calculateBalanceCoverage({
        balance: 3000,
        memberships: [membership()],
        lessons: [
            lesson('1', '2026-09-05', '10:00', 'individual'),
            lesson('2', '2026-09-06', '10:00', 'theory'),
            lesson('3', '2026-09-07', '10:00', 'group'),
        ],
    });

    assert.equal(result.coveredLessons, 0);
    assert.equal(result.remainingBalance, 3000);
    assert.equal(result.nextLesson.id, '1');
});

test('uses multiple memberships for different lesson formats', () => {
    const result = calculateBalanceCoverage({
        balance: 6200,
        memberships: [
            membership({ id: 'individual', lessonFormat: 'individual', type: 'individual_package' }),
            membership({ id: 'group', lessonFormat: 'group', groupId: 'group-1', createdAt: new Date('2026-02-01') }),
        ],
        lessons: [
            lesson('1', '2026-09-05', '10:00', 'individual'),
            lesson('2', '2026-09-06', '10:00', 'group'),
            lesson('3', '2026-09-07', '10:00', 'theory'),
        ],
    });

    assert.equal(result.coveredLessons, 3);
    assert.equal(result.remainingBalance, 0);
});

test('prefers the membership already attached to a lesson', () => {
    const older = membership({ id: 'attached', createdAt: new Date('2026-01-01') });
    const newer = membership({ id: 'newer', createdAt: new Date('2026-02-01') });
    const selected = selectMembershipForLesson([older, newer], lesson(
        '1', '2026-09-05', '10:00', 'individual', { chargedMembershipId: 'attached' }
    ));
    assert.equal(selected.id, 'attached');
});

test('honours an explicit class price', () => {
    assert.equal(getLessonChargeAmount(lesson('1', '2026-09-05', '10:00', 'group', { price: 1500 })), 1500);
});

test('uses the one-month hybrid quartet rate', () => {
    const result = calculateBalanceCoverage({
        balance: 6250,
        memberships: [membership({ type: 'hybrid_1m' })],
        lessons: [
            lesson('1', '2026-09-05', '10:00', 'individual'),
            lesson('2', '2026-09-06', '10:00', 'group'),
            lesson('3', '2026-09-07', '10:00', 'theory'),
        ],
    });

    assert.equal(result.coveredLessons, 2);
    assert.equal(result.remainingBalance, 0);
    assert.equal(result.nextLesson.chargeAmount, 1000);
});

test('uses the two-month hybrid quartet rate', () => {
    const result = calculateBalanceCoverage({
        balance: 6750,
        memberships: [membership({ type: 'hybrid_2m' })],
        lessons: [
            lesson('1', '2026-09-05', '10:00', 'individual'),
            lesson('2', '2026-09-06', '10:00', 'group'),
            lesson('3', '2026-09-07', '10:00', 'theory'),
        ],
    });

    assert.equal(result.coveredLessons, 3);
    assert.equal(result.remainingBalance, 0);
});

test('prefers the active membership configured for the lesson group', () => {
    const selected = selectMembershipForLesson([
        membership({ id: 'other', type: 'individual_package', planId: 'plan-other' }),
        membership({ id: 'hybrid', type: 'hybrid_2m', planId: 'plan-hybrid' }),
    ], lesson('1', '2026-09-05', '10:00', 'group', {
        allowedPlanIds: ['plan-hybrid'],
        allowedPlanTypes: ['hybrid_2m'],
    }));

    assert.equal(selected.id, 'hybrid');
});

test('reports when no future lessons are scheduled', () => {
    const result = calculateBalanceCoverage({ balance: 6200, memberships: [membership()], lessons: [] });
    assert.equal(result.coveredLessons, 0);
    assert.equal(result.stopReason, 'no_schedule');
});

test('ignores an already started-in-the-past scheduled lesson from the current day', () => {
    const result = calculateBalanceCoverage({
        balance: 5200,
        memberships: [membership()],
        lessons: [
            lesson('past', '2026-09-04', '09:00', 'individual'),
            lesson('future', '2026-09-04', '18:00', 'group'),
        ],
        now: new Date('2026-09-04T10:00:00.000Z'),
    });

    assert.equal(result.coveredLessons, 1);
    assert.deepEqual(result.breakdown, { individual: 0, group: 1, theory: 0 });
    assert.equal(result.remainingBalance, 4000);
});

test('stops when the active memberships do not support the next lesson', () => {
    const result = calculateBalanceCoverage({
        balance: 10000,
        memberships: [membership({
            lessonFormat: 'individual',
            type: 'individual_package',
            groupId: 'another-group',
        })],
        lessons: [lesson('1', '2026-09-05', '10:00', 'group')],
    });

    assert.equal(result.coveredLessons, 0);
    assert.equal(result.stopReason, 'membership_unavailable');
});

test('membership-row loader returns coverage keyed by student id', async () => {
    const db = {
        studentGroup: {
            findMany: async () => [],
        },
        class: {
            findMany: async () => [lesson('next', '2099-09-05', '10:00', 'individual', {
                individualStudentId: 'student-1',
                attendees: [],
            })],
        },
    };
    const membershipRow = membership({
        studentId: 'student-1',
        endDate: new Date('2100-12-31T00:00:00.000Z'),
        student: { id: 'student-1', accountBalance: 4000 },
    });

    const coverageByStudent = await loadBalanceCoverageForMembershipRows(db, [membershipRow]);

    assert.equal(coverageByStudent['student-1'].coveredLessons, 1);
    assert.equal(coverageByStudent['student-1'].remainingBalance, 0);
});
