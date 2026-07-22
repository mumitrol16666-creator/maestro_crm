const test = require('node:test');
const assert = require('node:assert/strict');
const classesRouter = require('../src/routes/classes');

const report = {
    studentProfile: { direction: 'Гитара', goalFromStudent: 'Научиться играть любимые песни' },
    teacherAssessment: { hearing: 4, rhythm: 4, coordination: 3 },
    lessonFacts: {
        whatWasTested: 'Ритм, слух и базовые аккорды',
        whatWorkedWell: 'Ученик быстро включился в задания',
        difficulties: 'Пока непривычно менять аккорды',
        reactionToTasks: 'Спокойно принимал подсказки',
    },
    recommendation: { recommendedFormat: 'individual', recommendedFrequency: '1_per_week', firstMonthFocus: 'Базовые аккорды' },
};

test('анализ учитывает взрослого ученика и не предполагает ребёнка или родителя', () => {
    const payload = classesRouter.buildTrialAnalysisPayload({
        id: 'class-adult',
        date: '2026-07-22T00:00:00.000Z',
        title: 'Гитара',
        individualStudent: {
            id: 'student-adult',
            name: 'Иван',
            lastName: 'Петров',
            dateOfBirth: '1990-03-10T00:00:00.000Z',
            learningDirections: ['Гитара'],
        },
        teacher: { id: 'teacher-1', name: 'Анна', lastName: 'Смирнова' },
    }, report);

    assert.equal(payload.audience.type, 'adult_student');
    assert.equal(payload.audience.label, 'самому ученику');
    assert.equal(payload.trialReport.studentProfile.learningGoal, 'Научиться играть любимые песни');
    assert.match(payload.template.tone, /ученику или семье/);
    assert.doesNotMatch(JSON.stringify(payload), /Ваш ребенок|Ваш ребёнок/);
});

test('промпт требует цельный педагогический текст без коммерческих блоков и повторов', () => {
    const messages = classesRouter.buildTrialAnalysisMessages({
        template: { writingRules: ['Не повторять факты.'] },
        audience: { type: 'unknown_age', label: 'ученику и семье' },
        trialReport: report,
    });
    assert.match(messages[0].content, /только педагогический анализ/i);
    assert.match(messages[1].content, /Сильные стороны/);
    assert.match(messages[1].content, /Никогда не добавляй/);
    assert.match(messages[1].content, /не пересказывай предыдущие разделы/i);
    assert.equal(classesRouter.TRIAL_ANALYSIS_PROMPT_VERSION, 'parent-safe-v3');
});

test('ответ AI очищается от менеджерских и детско-родительских формулировок', () => {
    const output = classesRouter.normalizeTrialAnalysisModelOutput(JSON.stringify({
        summary: 'Ученик проявил интерес к занятиям.',
        observations: ['Ребёнок активно работал.', 'Ученик спокойно выполнял задания.'],
        recommendations: ['Следующий шаг — связаться с менеджером.', 'Развивать смену аккордов.'],
        nextStep: 'Продать абонемент',
        managerNote: 'Позвонить вечером',
    }));
    assert.deepEqual(output.observations, ['Ученик спокойно выполнял задания.']);
    assert.deepEqual(output.recommendations, ['Развивать смену аккордов.']);
    assert.equal(output.nextStep, '');
    assert.equal(output.managerNote, '');
});
