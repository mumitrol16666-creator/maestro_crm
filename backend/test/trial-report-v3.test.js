const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTrialReport, buildTrialReportDerivedFields, isTrialReportV3 } = require('../src/services/trialReport');

// Document 23 §8 (decision 03.11): the trial report v3 follows the methodology's four
// diagnostic blocks and the parent report «навык, трудность, действие».
// What the app sends after the trimming of 03.11 (§10): only what reaches the family sheet.
const v3Input = {
    version: 3,
    studentProfile: { direction: 'Гитара', goalAndSong: 'Сыграть «Кукушку»' },
    diagnostics: {
        instrument: { level: 'independent' },
        hearingPulse: { level: 'with_hint' },
        movement: { level: 'with_hint' },
        learnability: { level: 'independent' },
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
        recommendedFrequency: '2_per_week',
    },
};

test('a v3 report keeps the four blocks, three plan steps and no attendance outcome', () => {
    const report = normalizeTrialReport(v3Input, { id: 'class-1', trialReport: null }, { teacherOnly: true });
    assert.equal(report.version, 3);
    assert.ok(isTrialReportV3(report));
    assert.deepEqual(Object.keys(report.diagnostics), ['instrument', 'hearingPulse', 'movement', 'learnability']);
    assert.equal(report.diagnostics.hearingPulse.level, 'with_hint');
    assert.equal(report.attendance, undefined, 'attendance is the fact of starting the lesson');
    assert.equal(report.recommendation.plan.length, 3);
    assert.equal(report.recommendation.startStep.number, 1);
    assert.equal(report.recommendation.recommendedFrequency, '2_per_week');
    assert.equal(report.manager, null);
});

test('fields the app no longer asks are not kept even if an old build sends them', () => {
    const report = normalizeTrialReport({
        ...v3Input,
        attendance: { arrivedWith: 'adult' },
        studentProfile: { ...v3Input.studentProfile, priorExperience: 'none' },
        diagnostics: { ...v3Input.diagnostics, instrument: { level: 'independent', note: 'гитара по размеру' } },
        recommendation: { ...v3Input.recommendation, recommendedFormat: 'individual', recommendedFrequency: 'custom' },
        raw: { teacherNote: 'Хочет электрогитару' },
    }, { id: 'class-1' });
    assert.equal(report.attendance, undefined);
    assert.equal(report.studentProfile.priorExperience, undefined);
    assert.deepEqual(report.diagnostics.instrument, { level: 'independent' });
    assert.equal(report.recommendation.recommendedFormat, undefined);
    assert.equal(report.recommendation.recommendedFrequency, 'undecided');
    assert.equal(report.raw, undefined);
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
    assert.match(fields.nextLessonFocus, /Частота: 2 раза в неделю/);
    assert.doesNotMatch(fields.nextLessonFocus, /Формат/);
    assert.equal(fields.homeworkDraft, '');
    assert.equal(fields.teacherComment, '');
});

test('an older report no longer turns «Дали домой» into lesson homework', () => {
    const legacy = normalizeTrialReport({ version: 2, lessonFacts: { whatWasTested: 'Ритм', whatWorkedWell: 'Ритм', homeworkGiven: 'Звук на струне' } }, {});
    assert.equal(legacy.lessonFacts.homeworkGiven, 'Звук на струне', 'it stays in the report');
    assert.equal(buildTrialReportDerivedFields(legacy).homeworkDraft, '');
});
