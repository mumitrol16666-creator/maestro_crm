const test = require('node:test');
const assert = require('node:assert/strict');
const { Packer } = require('docx');
const { buildTrialAnalysisDocument } = require('../src/services/trialAnalysisDocument');
const { normalizeTrialReport, buildTrialReportDerivedFields } = require('../src/services/trialReport');

test('AI-анализ пробного урока собирается в непустой Word-файл', async () => {
    const payload = {
        student: { name: 'Тестовый Ученик' },
        teacher: { name: 'Тестовый Педагог' },
        lesson: {
            date: '2026-07-18',
            startTime: '16:00',
            endTime: '16:30',
            direction: 'Гитара',
        },
        trialReport: {
            lessonFacts: { homeworkGiven: 'Повторить упражнение на ритм.' },
        },
    };
    const analysis = {
        title: 'Анализ пробного урока',
        summary: 'Ученик включился в работу и проявил интерес.',
        observations: ['Уверенно повторял короткие ритмические фразы.'],
        strengths: ['Хорошая музыкальная память.'],
        skills: ['Ритм: 4/5.'],
        growthAreas: ['Развивать координацию рук.'],
        recommendations: ['Занятия два раза в неделю.'],
        firstMonthPlan: ['Постановка рук и базовый ритм.'],
        nextStep: 'Подобрать расписание.',
        parentMessage: 'Есть хороший потенциал для старта.',
        managerNote: 'Связаться после 18:00.',
    };

    const { doc, fileName } = buildTrialAnalysisDocument({
        payload,
        analysis,
        scoreItems: [],
        fileName: 'Анализ пробного урока.docx',
    });
    const buffer = await Packer.toBuffer(doc);

    assert.equal(fileName, 'Анализ пробного урока.docx');
    assert.ok(buffer.length > 5000);
    assert.equal(buffer.subarray(0, 2).toString('utf8'), 'PK');
});

test('пробный отчёт не превращает сопровождение родителя в присутствие на уроке', () => {
    const report = normalizeTrialReport({
        attendance: { arrivedWith: 'parent', parentPresent: true },
        lessonFacts: { whatWasTested: 'Ритм', whatWorkedWell: 'Включился в задания' },
        salesSignals: { buyProbability: 5 },
    }, { id: 'class-1', duration: 30 });

    assert.equal(report.attendance.parentAccompanied, false);
    assert.equal(report.attendance.parentPresent, false);
});

test('коммерческие поля не попадают в обычные поля урока', () => {
    const derived = buildTrialReportDerivedFields({
        lessonFacts: { whatWasTested: 'Ритм' },
        teacherAssessment: { interestLevel: 4 },
        recommendation: { nextStep: 'sell_membership', firstMonthFocus: 'Аккорды' },
        salesSignals: { buyProbability: 5 },
    });

    assert.doesNotMatch(derived.lessonSummary, /покупки/i);
    assert.doesNotMatch(derived.nextLessonFocus, /продаж|менеджер|следующий шаг/i);
});

test('отчёт преподавателя не затирает и не принимает коммерческие поля', () => {
    const report = normalizeTrialReport({
        studentProfile: { motivation: 'student', goalFromParent: 'Новая цель' },
        recommendation: { nextStep: 'sell_membership' },
        salesSignals: { buyProbability: 1 },
        lessonFacts: { parentReaction: 'Сразу готов купить' },
    }, {
        id: 'class-2',
        trialReport: {
            studentProfile: { motivation: 'parent', goalFromParent: 'Семейная цель' },
            recommendation: { nextStep: 'wait' },
            salesSignals: { buyProbability: 4 },
            lessonFacts: { parentReaction: 'Обсудят расписание' },
        },
    }, { teacherOnly: true });

    assert.equal(report.studentProfile.motivation, 'parent');
    assert.equal(report.studentProfile.goalFromParent, 'Семейная цель');
    assert.equal(report.recommendation.nextStep, 'wait');
    assert.equal(report.salesSignals.buyProbability, 4);
    assert.equal(report.lessonFacts.parentReaction, 'Обсудят расписание');
});
