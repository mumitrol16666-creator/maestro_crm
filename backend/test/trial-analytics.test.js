const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildTrialAnalytics,
    getCurrentTrialStage,
    getTrialMilestones,
} = require('../src/services/trialAnalytics');

test('воронка пробного считает этапы даже для заявки без карточки ученика', () => {
    const bookings = [
        {
            id: 'lead-1',
            requestType: 'trial',
            status: 'trial',
            trialClassId: 'class-1',
            trialScheduledAt: new Date('2026-07-22T10:00:00Z'),
            source: 'instagram',
            attribution: { utm_campaign: 'summer' },
            cashTransactions: [{ type: 'income', category: 'trial_payment', amount: 2000 }],
        },
        {
            id: 'lead-2',
            requestType: 'trial',
            status: 'sold',
            convertedToStudentId: 'student-2',
            trialFunnelStage: 'sold',
            source: 'google',
            cashTransactions: [],
        },
        {
            id: 'lead-3',
            requestType: 'trial',
            status: 'rejected',
            source: 'instagram',
            cashTransactions: [],
        },
    ];
    const stats = buildTrialAnalytics(bookings, new Map([
        ['class-1', {
            id: 'class-1',
            status: 'completed',
            trialReport: { lessonFacts: { whatWorkedWell: 'Ритм' } },
            trialAiAnalysis: { status: 'generated' },
            attendees: [{ studentId: null, attended: true, attendanceStatus: 'present' }],
        }],
    ]));

    assert.deepEqual(stats.counts, {
        leads: 3,
        scheduled: 2,
        held: 2,
        analysisReady: 2,
        contacted: 1,
        thinking: 1,
        sold: 1,
        rejected: 1,
        cancelled: 0,
        noShow: 0,
        awaitingDecision: 0,
    });
    assert.equal(stats.conversion.leadToSold, 33);
    const instagramRow = stats.sources.find((row) => row.source === 'instagram' && row.campaign === 'summer');
    assert.ok(instagramRow);
    assert.equal(instagramRow.diagnosticRevenue, 2000);
});

test('UTM-источник заявки важнее общего источника лендинга', () => {
    const stats = buildTrialAnalytics([
        {
            id: 'lead-utm',
            requestType: 'trial',
            status: 'new',
            source: 'Сайт',
            attribution: {
                utm_source: 'instagram',
                utm_medium: 'paid_social',
                utm_campaign: 'guitar_trial',
            },
            cashTransactions: [],
        },
    ], new Map());

    assert.deepEqual(stats.sources.map(({ source, medium, campaign }) => ({ source, medium, campaign })), [
        { source: 'instagram', medium: 'paid_social', campaign: 'guitar_trial' },
    ]);
});

test('ответы квиза сохраняются в срезах аналитики пробных', () => {
    const stats = buildTrialAnalytics([
        {
            requestType: 'trial',
            status: 'sold',
            direction: 'Обычная гитара',
            convertedToStudentId: 'student-1',
            attribution: {
                trialQuiz: {
                    audience: 'Взрослому',
                    direction: 'Обычная гитара',
                    goal: 'skill',
                },
            },
        },
    ], new Map());

    assert.equal(stats.dimensions.audience[0].label, 'Для себя');
    assert.equal(stats.dimensions.audience[0].sold, 1);
    assert.equal(stats.dimensions.direction[0].label, 'Обычная гитара');
    assert.equal(stats.dimensions.goal[0].label, 'Поставить базу');
});

test('закрытая заявка после проведённого урока сохраняет milestone посещения', () => {
    const booking = {
        requestType: 'trial',
        status: 'rejected',
        trialClassId: 'class-1',
    };
    const classItem = {
        status: 'completed',
        attendees: [{ studentId: null, attended: true, attendanceStatus: 'present' }],
    };
    assert.equal(getCurrentTrialStage(booking, classItem), 'rejected');
    assert.deepEqual(getTrialMilestones(booking, classItem), {
        scheduled: true,
        held: true,
        analysisReady: false,
        contacted: false,
        thinking: false,
        sold: false,
        rejected: true,
        cancelled: false,
        noShow: false,
    });
});
