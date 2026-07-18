const test = require('node:test');
const assert = require('node:assert/strict');
const { Packer } = require('docx');
const { buildTrialAnalysisDocument } = require('../src/services/trialAnalysisDocument');

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
