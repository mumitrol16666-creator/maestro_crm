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
    assert.deepEqual(Object.keys(sheet), ['html', 'handedCopy']);
    assert.equal(sheet.handedCopy, false);
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

// «Лист отдан» (decision of 03.11): replaces «Подготовить анализ» for v3 trials.
const { setTrialSheetGiven } = require('../src/services/trialSheet');
const { trialNextActionAfterHeld, stageIsPastHeld, TRIAL_FUNNEL_STAGES } = require('../src/services/trialFunnel');
const { getTrialMilestones, getCurrentTrialStage } = require('../src/services/trialAnalytics');

function markPrisma({ classRecord, booking }) {
    const state = { booking: booking ? { ...booking } : null, updates: [] };
    return {
        state,
        class: { findUnique: async () => classRecord },
        booking: {
            findUnique: async () => state.booking,
            // Mirrors the conditional write: it lands only while the mark is as it was read.
            updateMany: async ({ where, data }) => {
                const marked = Boolean(state.booking.trialSheetGivenAt);
                const expectsMarked = where.trialSheetGivenAt !== null;
                if (marked !== expectsMarked) return { count: 0 };
                state.updates.push(data);
                state.booking = { ...state.booking, ...data };
                return { count: 1 };
            },
        },
    };
}

const v3Class = { id: 'c1', classType: 'trial', trialReport: report };
const now = new Date('2026-11-03T10:00:00Z');

test('after approval a v3 trial waits for the sheet, an older one for the analysis', () => {
    assert.equal(trialNextActionAfterHeld(report), 'give_sheet');
    assert.equal(trialNextActionAfterHeld({ version: 2, lessonFacts: {} }), 'prepare_analysis');
    assert.equal(trialNextActionAfterHeld(null), 'prepare_analysis');
    assert.ok(TRIAL_FUNNEL_STAGES.includes('sheet_given'));
    assert.equal(stageIsPastHeld('held'), false);
    assert.equal(stageIsPastHeld('sheet_given'), true);
    assert.equal(stageIsPastHeld('thinking'), true);
});

test('«Лист отдан» moves a held booking on and asks the manager to call in a day', async () => {
    const db = markPrisma({ classRecord: v3Class, booking: { id: 'b1', status: 'thinking', trialFunnelStage: 'held', trialNextAction: 'give_sheet', trialSheetGivenAt: null } });
    const result = await setTrialSheetGiven(db, 'c1', { given: true, actorId: 'admin-1', now });
    assert.equal(result.trialFunnelStage, 'sheet_given');
    assert.equal(result.trialNextAction, 'contact_family');
    assert.equal(result.trialNextActionAt.toISOString(), '2026-11-04T10:00:00.000Z');
    assert.equal(result.trialSheetGivenAt, now);
    assert.equal(result.trialSheetGivenById, 'admin-1');
    await setTrialSheetGiven(db, 'c1', { given: true, actorId: 'admin-2', now: new Date() });
    assert.equal(db.state.updates.length, 1, 'a second mark changes nothing');
});

test('a booking already past the sheet keeps its stage; only the fact is recorded', async () => {
    const db = markPrisma({ classRecord: v3Class, booking: { id: 'b1', status: 'thinking', trialFunnelStage: 'contacted', trialNextAction: 'follow_up', trialSheetGivenAt: null } });
    const result = await setTrialSheetGiven(db, 'c1', { given: true, actorId: 'm1', now });
    assert.equal(result.trialFunnelStage, 'contacted');
    assert.equal(result.trialNextAction, 'follow_up');
    assert.equal(result.trialSheetGivenAt, now);
});

test('removing a mistaken mark returns the booking to «Отдать лист»', async () => {
    const db = markPrisma({ classRecord: v3Class, booking: { id: 'b1', status: 'thinking', trialFunnelStage: 'sheet_given', trialNextAction: 'contact_family', trialSheetGivenAt: now, trialSheetGivenById: 'm1' } });
    const result = await setTrialSheetGiven(db, 'c1', { given: false, actorId: 'm1', now });
    assert.equal(result.trialFunnelStage, 'held');
    assert.equal(result.trialNextAction, 'give_sheet');
    assert.equal(result.trialSheetGivenAt, null);
    assert.equal(result.trialSheetGivenById, null);
});

test('no mark without the teacher’s v3 report or a trial booking', async () => {
    await assert.rejects(
        setTrialSheetGiven(markPrisma({ classRecord: { id: 'c1', classType: 'trial', trialReport: { version: 2 } }, booking: { id: 'b1' } }), 'c1', { given: true }),
        (error) => error.code === 'TRIAL_SHEET_NEEDS_REPORT',
    );
    await assert.rejects(
        setTrialSheetGiven(markPrisma({ classRecord: v3Class, booking: null }), 'c1', { given: true }),
        (error) => error.code === 'NOT_A_TRIAL',
    );
});

test('two simultaneous marks write once', async () => {
    const db = markPrisma({ classRecord: v3Class, booking: { id: 'b1', status: 'thinking', trialFunnelStage: 'held', trialSheetGivenAt: null } });
    const stale = { ...db.state.booking };
    const original = db.booking.findUnique;
    let reads = 0;
    // Both requests read the booking before either writes.
    db.booking.findUnique = async () => (reads++ < 2 ? stale : original());
    await Promise.all([
        setTrialSheetGiven(db, 'c1', { given: true, actorId: 'm1', now }),
        setTrialSheetGiven(db, 'c1', { given: true, actorId: 'm2', now: new Date('2026-11-03T10:05:00Z') }),
    ]);
    assert.equal(db.state.updates.length, 1);
    assert.equal(db.state.booking.trialSheetGivenById, 'm1');
});

test('analytics count a handed sheet as «Итог для семьи»', () => {
    const milestones = getTrialMilestones({ trialClassId: 'c1', trialFunnelStage: 'sheet_given', trialSheetGivenAt: now });
    assert.equal(milestones.held, true);
    assert.equal(milestones.analysisReady, true);
    assert.equal(getCurrentTrialStage({ trialFunnelStage: 'sheet_given' }), 'sheet_given');
    const later = getTrialMilestones({ trialClassId: 'c1', trialFunnelStage: 'contacted', trialSheetGivenAt: now });
    assert.equal(later.analysisReady, true);
});

test('the handed copy is kept and printed even after the report is corrected', async () => {
    const lesson = { ...v3Class, date: new Date('2026-11-03T07:20:00Z'), teacher: { name: 'Владислав', lastName: 'Сидоров' }, individualStudent: null };
    const db = markPrisma({ classRecord: lesson, booking: { id: 'b1', name: 'QA', lastName: 'Лид', status: 'thinking', trialFunnelStage: 'held', trialSheetGivenAt: null } });
    await setTrialSheetGiven(db, 'c1', { given: true, actorId: 'm1', now });
    const copy = db.state.booking.trialSheetSnapshot;
    assert.equal(copy.studentName, 'Лид QA');
    assert.equal(copy.report.lessonFacts.achieved, 'Чистый звук');
    assert.equal(copy.capturedAt, now.toISOString());

    // The lesson goes back to the teacher, who rewrites a line; the family still holds the first sheet.
    lesson.trialReport = { ...report, lessonFacts: { ...report.lessonFacts, achieved: 'Исправлено после возврата' } };
    const printed = await buildTrialSheetForClass(db, 'c1');
    assert.equal(printed.handedCopy, true);
    assert.match(printed.html, /Чистый звук/);
    assert.doesNotMatch(printed.html, /Исправлено после возврата/);

    await setTrialSheetGiven(db, 'c1', { given: false, actorId: 'm1', now });
    assert.equal(db.state.booking.trialSheetGivenAt, null);
    const live = await buildTrialSheetForClass(db, 'c1');
    assert.equal(live.handedCopy, false);
    assert.match(live.html, /Исправлено после возврата/);
});
