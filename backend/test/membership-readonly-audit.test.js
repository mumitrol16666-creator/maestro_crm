const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeSnapshot, renderMarkdown } = require('../scripts/audit-memberships-readonly');

function fixture(overrides = {}) {
    const student = { id: 'student', name: 'Audit Fixture', role: 'student', status: 'active', accountBalance: 0, activeMembershipId: null };
    const membership = {
        id: 'membership', studentId: 'student', type: 'monthly', lessonFormat: 'group', status: 'expired',
        startDate: '2026-07-01', endDate: '2026-08-01',
        totalPrice: 0, paidAmount: 0, remainingAmount: 0, totalClasses: 0, classesRemaining: 0, classesUsed: 0,
        individualClassesRemaining: null, groupClassesRemaining: null, theoryClassesRemaining: null,
    };
    return {
        metadata: { asOf: '2026-09-13T10:00:00Z', readOnly: 'on' }, memberships: [membership], students: [student],
        payments: [], transactions: [], classAttendees: [], freezes: [], adjustments: [], studentGroups: [], scheduledClasses: [], ...overrides,
    };
}

test('only entirely empty expired membership qualifies as empty candidate', () => {
    const report = analyzeSnapshot(fixture());
    assert.equal(report.memberships[0].classification, 'safe_empty_candidate');
    assert.equal(report.totals.memberships, 1);
});

test('detached student payment prevents false empty membership classification', () => {
    const data = fixture({ payments: [{ id: 'payment', studentId: 'student', membershipId: null, amount: 27000, status: 'completed' }] });
    assert.equal(analyzeSnapshot(data).memberships[0].classification, 'archive_keep_history');
});

test('current legacy stays in place even with zero old counters', () => {
    const data = fixture();
    Object.assign(data.memberships[0], { status: 'active', endDate: '2026-10-01', type: 'hybrid_2m', lessonFormat: 'mixed', totalPrice: 50000 });
    const row = analyzeSnapshot(data).memberships[0];
    assert.equal(row.classification, 'keep_current_legacy');
    assert.deepEqual(row.issues, []);
});

test('past active legacy is separately listed and valuable remnants are flagged', () => {
    const data = fixture();
    Object.assign(data.memberships[0], { status: 'active', totalPrice: 50000, classesRemaining: 12 });
    const report = analyzeSnapshot(data);
    assert.equal(report.activeButPastEndDate.length, 1);
    assert.equal(report.activeButPastEndDate[0].valuableClaims, true);
    assert.match(report.memberships[0].reason, /не удалять автоматически/);
});

test('program counter and confirmed charge inconsistencies need review', () => {
    const data = fixture();
    Object.assign(data.memberships[0], { lessonFormat: 'program', status: 'active', endDate: '2026-10-01', classesRemaining: 8,
        individualClassesRemaining: 4, groupClassesRemaining: 4, theoryClassesRemaining: 2,
        individualLessonPrice: 4000, groupLessonPrice: 2250, theoryLessonPrice: 1000 });
    data.classAttendees.push({ id: 'charge', studentId: 'student', classId: 'class', chargedMembershipId: 'membership', classStatus: 'completed',
        classType: 'group', chargeSource: 'membership', chargeAmount: 1200 });
    const report = analyzeSnapshot(data);
    assert.equal(report.memberships[0].classification, 'manual_review');
    assert.equal(report.totals.confirmedCharges, 1200);
    assert.equal(report.totals.confirmedChargesWithoutDeductionReference, 1);
});

test('legacy zero-unit deduction is still a real billing relation', () => {
    const data = fixture();
    data.transactions.push({ id: 'tx', membershipId: 'membership', type: 'manual_deduct', classId: 'class', amount: 0 });
    assert.equal(analyzeSnapshot(data).memberships[0].classification, 'archive_keep_history');
    assert.equal(analyzeSnapshot(data).totals.deductionEvents, 1);
});

test('wallet residual is reported as unverified opening balance, not a financial error', () => {
    const data = fixture();
    data.students[0].accountBalance = 1234;
    const report = analyzeSnapshot(data);
    assert.equal(report.students[0].unexplainedOpeningOrLegacyBalance, 1234);
    assert.equal(report.anomalies.length, 0);
    assert.match(renderMarkdown(report), /2026-08-01/);
});

test('active student with teacher but no membership enters priority replacement review', () => {
    const data = fixture({ memberships: [] });
    data.students[0].assignedTeacherId = 'teacher';
    const report = analyzeSnapshot(data);
    assert.equal(report.students[0].priorityReplacementReview, true);
    assert.equal(report.totals.priorityReplacementReviewStudents, 1);
});

test('future membership prevents an unnecessary replacement without an earlier lesson', () => {
    const data = fixture();
    Object.assign(data.memberships[0], { status: 'active', startDate: '2026-10-01', endDate: '2026-11-01' });
    data.students[0].assignedTeacherId = 'teacher';
    assert.equal(analyzeSnapshot(data).students[0].priorityReplacementReview, false);
});

function programFixture(overrides = {}) {
    const data = fixture();
    Object.assign(data.memberships[0], { type: 'program', lessonFormat: 'program', status: 'active', endDate: '2026-10-01',
        totalClasses: 10, classesRemaining: 10, classesUsed: 0, individualClassesRemaining: 4, groupClassesRemaining: 4,
        theoryClassesRemaining: 2, individualLessonPrice: 0, groupLessonPrice: 2250, theoryLessonPrice: 1000,
        individualBudgetTotal: 0, individualBudgetRemaining: 0, ...overrides });
    return data;
}

test('zero individual cost is a legitimate fully discounted program, not a missing rate', () => {
    const report = analyzeSnapshot(programFixture());
    assert.deepEqual(report.memberships[0].issues, []);
    assert.equal(report.memberships[0].programAllocation.budgetLedger.status, 'matched');
});

test('null individual snapshot and zero group price remain invalid program prices', () => {
    assert.match(analyzeSnapshot(programFixture({ individualLessonPrice: null })).memberships[0].issues.join(';'), /отсутствует/);
    assert.match(analyzeSnapshot(programFixture({ groupLessonPrice: 0 })).memberships[0].issues.join(';'), /Нулевая цена квартета/);
});

test('allocated individual price may be display snapshot +1 and follows its money ledger', () => {
    const data = programFixture({ individualLessonPrice: 3333, individualBudgetTotal: 10000, individualBudgetRemaining: 6666,
        classesUsed: 1, classesRemaining: 9, individualClassesRemaining: 3 });
    data.transactions.push({ id: 't1', membershipId: 'membership', classId: 'class', classType: 'individual',
        type: 'manual_deduct', amount: 1, chargeAmount: 3334 });
    data.classAttendees.push({ id: 'charge', studentId: 'student', classId: 'class', chargedMembershipId: 'membership',
        classStatus: 'completed', classType: 'individual', chargeSource: 'membership', chargeAmount: 3334 });
    const row = analyzeSnapshot(data).memberships[0];
    assert.deepEqual(row.issues, []);
    assert.equal(row.programAllocation.budgetLedger.status, 'matched');
    data.transactions[0].chargeAmount = 3333;
    assert.match(analyzeSnapshot(data).memberships[0].issues.join(';'), /денежным журналом/);
});

test('budget ledger includes manual additions, removals and reopened lesson refunds', () => {
    const data = programFixture({ individualLessonPrice: 3500, individualBudgetTotal: 14000, individualBudgetRemaining: 15000 });
    data.transactions.push(
        { id: 'extension', membershipId: 'membership', type: 'extension', amount: 1, chargeAmount: 4000, componentHint: 'individual' },
        { id: 'deduct', membershipId: 'membership', type: 'manual_deduct', amount: 1, chargeAmount: 3500, classId: 'class', classType: 'individual' },
        { id: 'return', membershipId: 'membership', type: 'add', amount: 1, chargeAmount: 3500, classId: 'class', classType: 'individual' },
        { id: 'remove', membershipId: 'membership', type: 'manual_deduct', amount: 1, chargeAmount: 3000, componentHint: 'individual' });
    assert.equal(analyzeSnapshot(data).memberships[0].programAllocation.budgetLedger.status, 'matched');
});

test('today past classes are not upcoming in Aqtobe and past pending review is separate', () => {
    const data = fixture({ memberships: [], scheduledClasses: [
        { id: 'past', individualStudentId: 'student', date: '2026-09-13', startTime: '14:00', status: 'scheduled', classType: 'individual' },
        { id: 'review', individualStudentId: 'student', date: '2026-09-13', startTime: '13:00', status: 'pending_admin_review', classType: 'individual' },
        { id: 'future', individualStudentId: 'student', date: '2026-09-14', startTime: '09:00', status: 'scheduled', classType: 'individual' },
    ] });
    const row = analyzeSnapshot(data).students[0];
    assert.equal(row.upcomingClassCount, 1);
    assert.equal(row.pastPendingReviewCount, 1);
    assert.equal(row.nextClassOccurrenceAt, '2026-09-14T04:00:00.000Z');
});
