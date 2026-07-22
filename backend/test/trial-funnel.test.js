const test = require('node:test');
const assert = require('node:assert/strict');
const {
    TRIAL_FUNNEL_STAGES,
    defaultTrialNextAction,
    deriveTrialFunnelStage,
    trialFunnelPayload,
} = require('../src/services/trialFunnel');

test('воронка пробного содержит понятные отдельные этапы', () => {
    assert.deepEqual(TRIAL_FUNNEL_STAGES, [
        'scheduled', 'held', 'analysis_ready', 'contacted', 'thinking', 'sold', 'rejected',
    ]);
    assert.equal(defaultTrialNextAction('analysis_ready'), 'contact_family');
    assert.equal(defaultTrialNextAction('sold'), 'none');
});

test('старые заявки получают безопасный этап без изменения общего статуса', () => {
    assert.equal(deriveTrialFunnelStage({ requestType: 'trial', status: 'trial', trialScheduledAt: new Date() }), 'scheduled');
    assert.equal(deriveTrialFunnelStage({ requestType: 'trial', status: 'thinking' }), 'thinking');
    assert.equal(deriveTrialFunnelStage({ requestType: 'trial', status: 'sold' }), 'sold');
    assert.equal(deriveTrialFunnelStage({ requestType: 'online_lesson', status: 'new' }), null);
});

test('данные воронки валидируют этап, действие и сроки', () => {
    const deadline = new Date('2026-07-23T12:00:00.000Z');
    const payload = trialFunnelPayload({
        stage: 'contacted',
        nextAction: 'follow_up',
        nextActionAt: deadline.toISOString(),
        note: 'Позвонить после 18:00',
    });
    assert.equal(payload.trialFunnelStage, 'contacted');
    assert.equal(payload.trialNextAction, 'follow_up');
    assert.equal(payload.trialNextActionAt.toISOString(), deadline.toISOString());
    assert.equal(payload.trialFunnelNote, 'Позвонить после 18:00');
    assert.throws(() => trialFunnelPayload({ stage: 'unknown' }), /Неверный этап/);
    assert.throws(() => trialFunnelPayload({ nextActionAt: 'not-a-date' }), /Некорректный срок/);
});
