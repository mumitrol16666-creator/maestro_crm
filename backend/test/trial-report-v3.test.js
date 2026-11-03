const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTrialReport, buildTrialReportDerivedFields, isTrialReportV3 } = require('../src/services/trialReport');

// Document 23 §8 (decision 03.11): the trial report v3 follows the methodology's four
// diagnostic blocks and the parent report «навык, трудность, действие».
const v3Input = {
    version: 3,
    attendance: { arrivedWith: 'adult' },
    studentProfile: { direction: 'Гитара', priorExperience: 'none', goalAndSong: 'Сыграть «Кукушку»' },
    diagnostics: {
        instrument: { level: 'independent', note: 'Посадка свободная, гитара по размеру' },
        hearingPulse: { level: 'with_hint', note: 'Ритм из четырёх хлопков со второго раза' },
        movement: { level: 'with_hint', note: 'Звук на 1-й струне' },
        learnability: { level: 'independent', note: 'После подсказки сразу исправил' },
        extra: { level: 'independent' },
    },
    lessonFacts: { achieved: 'Чистый звук на открытой струне', difficulty: 'Левая рука быстро устаёт', homeAction: 'Пять минут: звук на 1-й струне со счётом' },
    recommendation: {
        startStep: { templateId: 'tpl-1', number: 1, title: 'Первые звуки', direction: 'Гитара' },
        plan: [
            { templateId: 'tpl-1', number: 1, title: 'Первые звуки', topics: ['Посадка', 'Звук пальцем'] },
            { templateId: 'tpl-2', number: 2, title: 'Ритм и аккорды', topics: ['Am', 'E'] },
            { templateId: 'tpl-3', number: 3, title: 'Баррэ и перебор', topics: [] },
            { templateId: 'tpl-4', number: 4, title: 'Лишняя', topics: [] },
        ],
        recommendedFormat: 'individual',
        recommendedFrequency: '2_per_week',
    },
    raw: { teacherNote: 'Хочет электрогитару' },
};

test('a v3 report keeps the four blocks, three plan steps and no attendance outcome', () => {
    const report = normalizeTrialReport(v3Input, { id: 'class-1', trialReport: null }, { teacherOnly: true });
    assert.equal(report.version, 3);
    assert.ok(isTrialReportV3(report));
    assert.deepEqual(Object.keys(report.diagnostics), ['instrument', 'hearingPulse', 'movement', 'learnability']);
    assert.equal(report.diagnostics.hearingPulse.level, 'with_hint');
    assert.equal(report.attendance.outcome, undefined, 'attendance is the fact of starting the lesson');
    assert.equal(report.recommendation.plan.length, 3);
    assert.equal(report.recommendation.startStep.number, 1);
    assert.equal(report.manager, null);
});

test('unknown levels are dropped, not guessed', () => {
    const report = normalizeTrialReport({ ...v3Input, diagnostics: { instrument: { level: '5' } } }, {});
    assert.equal(report.diagnostics.instrument.level, null);
    assert.equal(report.diagnostics.movement.level, null);
});

test('manager fields saved by an older report survive the teacher’s v3 report', () => {
    const existing = {
        version: 2,
        studentProfile: { motivation: 'parent', goalFromParent: 'Чтобы занимался' },
        recommendation: { nextStep: 'sell_membership' },
        salesSignals: { buyProbability: 4, priceSensitivity: 'high', parentObjections: ['price'] },
        raw: { adminComment: 'Позвонить вечером' },
    };
    const report = normalizeTrialReport(v3Input, { id: 'class-1', trialReport: existing }, { teacherOnly: true });
    assert.equal(report.manager.motivation, 'parent');
    assert.equal(report.manager.buyProbability, 4);
    assert.deepEqual(report.manager.parentObjections, ['price']);
    assert.equal(report.manager.adminComment, 'Позвонить вечером');
    const again = normalizeTrialReport(v3Input, { id: 'class-1', trialReport: report }, { teacherOnly: true });
    assert.deepEqual(again.manager, report.manager, 'a resubmission keeps them');
});

test('the older CRM form never overwrites a v3 report', () => {
    const saved = normalizeTrialReport(v3Input, { id: 'class-1' });
    const legacyForm = { version: 1, attendance: { outcome: 'attended' }, teacherAssessment: { interestLevel: 3 }, lessonFacts: { whatWasTested: 'x' } };
    assert.equal(normalizeTrialReport(legacyForm, { id: 'class-1', trialReport: saved }), saved);
});

test('v3 lesson fields: diagnostics in the summary, start step in the focus, no homework (LEARN-042)', () => {
    const fields = buildTrialReportDerivedFields(normalizeTrialReport(v3Input, { id: 'class-1' }));
    assert.equal(fields.topic, 'Пробный урок · диагностика');
    assert.match(fields.lessonSummary, /Получилось: Чистый звук/);
    assert.match(fields.lessonSummary, /Слух и пульс — с подсказкой/);
    assert.match(fields.nextLessonFocus, /Начинаем со ступени 1 «Первые звуки»/);
    assert.equal(fields.homeworkDraft, '');
    assert.equal(fields.teacherComment, 'Хочет электрогитару');
});

test('an older report no longer turns «Дали домой» into lesson homework', () => {
    const legacy = normalizeTrialReport({ version: 2, lessonFacts: { whatWasTested: 'Ритм', whatWorkedWell: 'Ритм', homeworkGiven: 'Звук на струне' } }, {});
    assert.equal(legacy.lessonFacts.homeworkGiven, 'Звук на струне', 'it stays in the report');
    assert.equal(buildTrialReportDerivedFields(legacy).homeworkDraft, '');
});
