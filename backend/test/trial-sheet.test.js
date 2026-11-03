const test = require('node:test');
const assert = require('node:assert/strict');
const { renderTrialSheetHtml, buildTrialSheetForClass, TrialSheetError } = require('../src/services/trialSheet');

// Document 23, step 2: «Лист первого занятия» — the family's A4 sheet built only from the v3 report.
const report = {
    version: 3,
    studentProfile: { direction: 'Гитара', goalAndSong: 'Сыграть <b>«Кукушку»</b>' },
    diagnostics: {
        instrument: { level: 'independent' },
        hearingPulse: { level: 'with_hint' },
        movement: { level: 'not_yet' },
        learnability: { level: 'independent' },
    },
    lessonFacts: { achieved: 'Чистый звук', difficulty: 'Левая рука устаёт', homeAction: 'Пять минут в день' },
    recommendation: {
        startStep: { number: 1, title: 'Первые звуки' },
        recommendedFrequency: '2_per_week',
        plan: [
            { number: 1, title: 'Первые звуки', topics: ['Посадка', 'Аккорды Am, Em'] },
            { number: 2, title: 'Ритм и аккорды', topics: [] },
            { number: 3, title: 'Баррэ и перебор' },
        ],
    },
};

function fakePrisma({ classRecord, booking = null }) {
    return {
        class: { findUnique: async () => classRecord },
        booking: { findUnique: async () => booking },
    };
}

test('the sheet shows what the teacher filled and nothing about scores', () => {
    const html = renderTrialSheetHtml({ studentName: 'Сейткали Камбар', teacherName: 'Сидоров Владислав', direction: 'Гитара', lessonDate: new Date('2026-11-03T07:20:00Z'), report });
    for (const text of ['Лист первого занятия', 'Сейткали Камбар', '3 ноября 2026', 'Сам', 'С подсказкой', 'Пока не получилось',
        'Чистый звук', 'Левая рука устаёт', 'Пять минут в день', 'Ступень 1 · Первые звуки', '1-й месяц', '3-й месяц', '2 раза в неделю']) {
        assert.ok(html.includes(text), `missing «${text}»`);
    }
    assert.ok(!html.includes('<b>«Кукушку»</b>'), 'teacher text must be escaped');
    assert.ok(html.includes('&lt;b&gt;«Кукушку»&lt;/b&gt;'));
    assert.ok(!/fonts\.googleapis/.test(html), 'no external fonts: the app CSP blocks them');
    assert.ok(html.includes('--fit'), 'the sheet shrinks itself to one A4 page');
    assert.ok(!/гитар|струн/i.test(html.replace('Гитара', '')), 'block meanings hold for every instrument');
});

test('unknown levels and frequencies print as a dash, not as object internals', () => {
    const odd = { ...report, diagnostics: { instrument: { level: 'constructor' }, hearingPulse: { level: '__proto__' } }, recommendation: { ...report.recommendation, recommendedFrequency: 'toString' } };
    const html = renderTrialSheetHtml({ studentName: 'Лид', teacherName: 'Педагог', direction: 'Гитара', lessonDate: new Date(), report: odd });
    assert.ok(!html.includes('native code'));
    assert.ok(!html.includes('[object Object]'));
    assert.ok(!html.includes('Рекомендуем заниматься'));
});

test('without a plan the sheet has no plan section', () => {
    const html = renderTrialSheetHtml({ studentName: 'Лид', teacherName: 'Педагог', direction: 'Вокал', lessonDate: new Date(), report: { ...report, recommendation: { startStep: null, plan: [], recommendedFrequency: 'undecided' } } });
    assert.ok(!html.includes('План на три месяца'));
    assert.ok(!html.includes('Рекомендуем заниматься'));
});

test('the sheet for a lead takes the name from the booking', async () => {
    const sheet = await buildTrialSheetForClass(fakePrisma({
        classRecord: { id: 'c1', classType: 'trial', date: new Date('2026-11-03T07:20:00Z'), trialReport: report, teacher: { name: 'Владислав', lastName: 'Сидоров' }, individualStudent: null },
        booking: { id: 'b1', name: 'QA', lastName: 'Лид', direction: 'Гитара' },
    }), 'c1');
    assert.match(sheet.html, /Лид QA/);
    assert.match(sheet.html, /Сидоров Владислав/);
    assert.deepEqual(Object.keys(sheet), ['html']);
});

test('no sheet for a missing lesson, a regular lesson or an old-format report', async () => {
    await assert.rejects(buildTrialSheetForClass(fakePrisma({ classRecord: null }), 'x'), (error) => error instanceof TrialSheetError && error.status === 404);
    await assert.rejects(
        buildTrialSheetForClass(fakePrisma({ classRecord: { id: 'c2', classType: 'individual', trialReport: report } }), 'c2'),
        (error) => error.code === 'NOT_A_TRIAL' && error.status === 400,
    );
    await assert.rejects(
        buildTrialSheetForClass(fakePrisma({ classRecord: { id: 'c3', classType: 'trial', trialReport: { version: 2, lessonFacts: {} } } }), 'c3'),
        (error) => error.code === 'TRIAL_SHEET_NEEDS_REPORT' && error.status === 409,
    );
});
