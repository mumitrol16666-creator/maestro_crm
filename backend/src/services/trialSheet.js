const fs = require('fs');
const path = require('path');
const { isTrialReportV3, TRIAL_DIAGNOSTIC_BLOCKS, TRIAL_DIAGNOSTIC_LABELS } = require('./trialReport');
const { findTrialBookingForClass } = require('./trialClass');

/*
 * «Лист первого занятия» (document 23 §5.2, §10; decision 03.11). One A4 page for the family after
 * the trial, built on the school methodology «Работа с учеником»: p.48 — four diagnostic actions,
 * «не для распределения на сильных и слабых», so levels are words, not scores; p.25 — the family
 * hears one learned skill, one difficulty and one home action. The plan for three months is the
 * snapshot of the start step and the next two saved in the report, so a reprint gives the same page.
 * Rendered here only: CRM prints it for the admin, the app gets the same HTML through integration.
 */

const SCHOOL = {
    name: 'Музыкальная школа Maestro',
    address: 'Актобе, ул. Марата Оспанова, 52/2',
    phone: '+7 777 505-57-88',
};

const LEVEL_WORDS = {
    not_yet: 'Пока не получилось',
    with_hint: 'С подсказкой',
    independent: 'Сам',
};

// The same words as the teacher's hints in the app; they hold for every instrument.
const BLOCK_MEANING = {
    instrument: 'посадка, положение рук, свобода в плечах',
    hearingPulse: 'повторить звук, различить высокий и низкий, повторить короткий ритм',
    movement: 'первый звук на инструменте, одно простое движение',
    learnability: 'как меняется следующая попытка после подсказки',
};

const FREQUENCY_WORDS = {
    '1_per_week': '1 раз в неделю',
    '2_per_week': '2 раза в неделю',
    '3_per_week': '3 раза в неделю',
};

// Only the dictionary's own keys: a stray «constructor» must not print Object's source.
function wordFor(dictionary, key) {
    return typeof key === 'string' && Object.hasOwn(dictionary, key) ? dictionary[key] : '';
}

let logoDataUri = null;
function schoolLogo() {
    if (logoDataUri === null) {
        try {
            const file = fs.readFileSync(path.join(__dirname, '..', 'assets', 'trial-sheet-logo.png'));
            logoDataUri = `data:image/png;base64,${file.toString('base64')}`;
        } catch (_) {
            logoDataUri = '';
        }
    }
    return logoDataUri;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function personName(person, fallback) {
    const parts = [person?.lastName, person?.name].map((part) => String(part || '').trim()).filter(Boolean);
    return parts.join(' ') || fallback;
}

function formatLessonDate(date) {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Aqtobe' }).format(value);
}

const MONTHS = ['1-й месяц', '2-й месяц', '3-й месяц'];

const STYLE = `
@page { size: A4; margin: 12mm 14mm 10mm; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: #161513; }
body { font: 10.5pt/1.4 "Inter", "Helvetica Neue", Arial, sans-serif; }
.sheet { max-width: 182mm; margin: 0 auto; }
.head { display: flex; align-items: center; gap: 5mm; border-bottom: 0.6mm solid #b88a35; padding-bottom: 3mm; }
.head img { width: 17mm; height: 17mm; object-fit: contain; }
.brand { font-family: "Playfair Display", Didot, Georgia, serif; font-size: 19pt; letter-spacing: 0.08em; line-height: 1; }
.brand small { display: block; font-family: "Inter", Arial, sans-serif; font-size: 7.5pt; letter-spacing: 0.22em; color: #5f5a52; margin-top: 1.5mm; }
.contacts { margin-left: auto; text-align: right; font-size: 8pt; color: #5f5a52; line-height: 1.5; }
h1 { font-family: "Playfair Display", Didot, Georgia, serif; font-weight: 600; font-size: 20pt; margin: 4.5mm 0 2mm; }
.meta { display: grid; grid-template-columns: repeat(4, auto); gap: 1mm 6mm; justify-content: start; font-size: 9pt; }
.meta b { display: block; font-size: 7pt; letter-spacing: 0.14em; text-transform: uppercase; color: #8a8378; font-weight: 600; }
.goal { margin-top: 3mm; padding: 2.5mm 3.5mm; border-left: 0.8mm solid #b88a35; background: #f7f3ea; font-size: 10pt; }
h2 { font-size: 8pt; letter-spacing: 0.16em; text-transform: uppercase; color: #8a8378; margin: 4.5mm 0 1.8mm; font-weight: 700; }
.blocks { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; }
.block { border: 0.3mm solid #d9d2c4; border-radius: 2mm; padding: 2.5mm; }
.block .title { font-weight: 700; font-size: 9.5pt; }
.block .level { font-family: "Playfair Display", Georgia, serif; font-size: 12pt; margin: 1mm 0; }
.block .meaning { font-size: 7.5pt; color: #6b655c; line-height: 1.3; }
.three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; }
.three div { border: 0.3mm solid #d9d2c4; border-radius: 2mm; padding: 2.5mm 3mm; min-height: 14mm; }
.three b { display: block; font-size: 7.5pt; letter-spacing: 0.14em; text-transform: uppercase; color: #8a8378; margin-bottom: 1mm; }
.start { font-family: "Playfair Display", Georgia, serif; font-size: 13pt; }
.plan { margin: 0; padding: 0; list-style: none; display: grid; gap: 2mm; }
.plan li { display: grid; grid-template-columns: 22mm 1fr; gap: 3mm; border-top: 0.3mm solid #e6e0d4; padding-top: 2mm; }
.plan .month { font-size: 8pt; letter-spacing: 0.1em; text-transform: uppercase; color: #8a8378; padding-top: 0.6mm; }
.plan .step { font-weight: 700; }
.plan .topics { font-size: 9pt; color: #3d3a35; }
.note { font-size: 8pt; color: #6b655c; margin-top: 3.5mm; }
.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 4mm; font-size: 9pt; align-items: end; break-inside: avoid; }
.sign .line { border-bottom: 0.3mm solid #161513; height: 9mm; margin-bottom: 1mm; }
.stamp { width: 26mm; height: 26mm; border: 0.3mm dashed #b5ad9f; border-radius: 50%; display: grid; place-items: center; color: #b5ad9f; font-size: 8pt; justify-self: end; }
.toolbar { position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; }
.toolbar button { font: 600 14px Inter, Arial, sans-serif; min-height: 44px; padding: 0 18px; border-radius: 12px; border: 0; background: #161513; color: #fff; cursor: pointer; }
@media print { .toolbar { display: none; } .sheet { zoom: var(--fit, 1); } }
html.measure body { padding: 0; } html.measure .sheet { padding: 0; box-shadow: none; max-width: 182mm; width: 182mm; }
@media screen { body { background: #ece8df; padding: 24px 12px; } .sheet { background: #fff; padding: 14mm; box-shadow: 0 4px 24px rgba(0,0,0,.12); } }
@media screen and (max-width: 700px) {
  .meta, .blocks, .three { grid-template-columns: 1fr 1fr; }
  .contacts { display: none; }
}
`;

/** The sheet as one HTML document. `report` must be a v3 trial report. */
function renderTrialSheetHtml({ studentName, teacherName, direction, lessonDate, report }) {
    const diagnostics = report.diagnostics || {};
    const facts = report.lessonFacts || {};
    const recommendation = report.recommendation || {};
    const start = recommendation.startStep;
    const plan = Array.isArray(recommendation.plan) ? recommendation.plan.slice(0, 3) : [];
    const frequency = wordFor(FREQUENCY_WORDS, recommendation.recommendedFrequency);
    const goal = report.studentProfile?.goalAndSong;
    const logo = schoolLogo();

    const blocks = TRIAL_DIAGNOSTIC_BLOCKS.map((key) => `
        <div class="block">
            <div class="title">${escapeHtml(TRIAL_DIAGNOSTIC_LABELS[key])}</div>
            <div class="level">${escapeHtml(wordFor(LEVEL_WORDS, diagnostics[key]?.level) || '—')}</div>
            <div class="meaning">${escapeHtml(BLOCK_MEANING[key])}</div>
        </div>`).join('');

    const planHtml = plan.length ? `
        <h2>План на три месяца</h2>
        <ol class="plan">
            ${plan.map((step, index) => `
            <li>
                <span class="month">${MONTHS[index] || ''}</span>
                <span>
                    <span class="step">Ступень ${escapeHtml(step.number)} · ${escapeHtml(step.title)}</span>
                    ${Array.isArray(step.topics) && step.topics.length ? `<br><span class="topics">${escapeHtml(step.topics.join(' · '))}</span>` : ''}
                </span>
            </li>`).join('')}
        </ol>` : '';

    return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Лист первого занятия — ${escapeHtml(studentName)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="toolbar"><button type="button" onclick="window.print()">Распечатать</button></div>
<script>
// Long answers or a long program must not push the signature onto a second sheet:
// measure the sheet at print width and shrink it to the printable A4 height (297 − 12 − 10 mm).
(function () {
    function fit() {
        var root = document.documentElement, sheet = document.querySelector('.sheet');
        if (!sheet) return;
        root.classList.add('measure');
        var mm = 96 / 25.4, height = sheet.getBoundingClientRect().height, limit = 273 * mm;
        root.classList.remove('measure');
        root.style.setProperty('--fit', height > limit ? Math.max(0.75, limit / height).toFixed(3) : '1');
    }
    document.addEventListener('DOMContentLoaded', fit);
    window.addEventListener('beforeprint', fit);
})();
</script>
<main class="sheet">
    <header class="head">
        ${logo ? `<img src="${logo}" alt="">` : ''}
        <div class="brand">MAESTRO<small>MUSIC SCHOOL</small></div>
        <div class="contacts">${escapeHtml(SCHOOL.address)}<br>${escapeHtml(SCHOOL.phone)}</div>
    </header>

    <h1>Лист первого занятия</h1>
    <div class="meta">
        <div><b>Ученик</b>${escapeHtml(studentName)}</div>
        <div><b>Дата</b>${escapeHtml(formatLessonDate(lessonDate))}</div>
        <div><b>Направление</b>${escapeHtml(direction || '—')}</div>
        <div><b>Педагог</b>${escapeHtml(teacherName)}</div>
    </div>
    ${goal ? `<div class="goal"><b>Цель:</b> ${escapeHtml(goal)}</div>` : ''}

    <h2>Что проверили на занятии</h2>
    <div class="blocks">${blocks}</div>

    <h2>Итог занятия</h2>
    <div class="three">
        <div><b>Получилось</b>${escapeHtml(facts.achieved || '—')}</div>
        <div><b>Поработаем</b>${escapeHtml(facts.difficulty || '—')}</div>
        <div><b>Дома</b>${escapeHtml(facts.homeAction || '—')}</div>
    </div>

    ${start ? `<h2>С чего начнём</h2><div class="start">Ступень ${escapeHtml(start.number)} · ${escapeHtml(start.title)}</div>` : ''}
    ${planHtml}
    ${frequency ? `<p><b>Рекомендуем заниматься:</b> ${escapeHtml(frequency)}.</p>` : ''}

    <p class="note">Диагностика нужна, чтобы выбрать, с чего начать, а не чтобы оценить ученика. План остаётся у вас при любом решении.</p>

    <div class="sign">
        <div><div class="line"></div>Педагог: ${escapeHtml(teacherName)}</div>
        <div class="stamp">М. П.</div>
    </div>
</main>
</body>
</html>`;
}

class TrialSheetError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

/** Loads the trial lesson and renders its sheet; refuses lessons without a v3 report. */
async function buildTrialSheetForClass(prisma, classId) {
    const classRecord = await prisma.class.findUnique({
        where: { id: classId },
        include: {
            teacher: { select: { name: true, lastName: true } },
            individualStudent: { select: { name: true, lastName: true } },
        },
    });
    if (!classRecord) throw new TrialSheetError(404, 'CLASS_NOT_FOUND', 'Урок не найден');
    const booking = await findTrialBookingForClass(prisma, classRecord.id, { id: true, name: true, lastName: true, direction: true });
    if (classRecord.classType !== 'trial' && !booking) {
        throw new TrialSheetError(400, 'NOT_A_TRIAL', 'Лист первого занятия есть только у пробного урока');
    }
    if (!isTrialReportV3(classRecord.trialReport)) {
        throw new TrialSheetError(409, 'TRIAL_SHEET_NEEDS_REPORT', 'Лист печатается после того, как преподаватель отправит диагностику в приложении.');
    }
    const report = classRecord.trialReport;
    const studentName = personName(classRecord.individualStudent || booking, 'Ученик');
    const html = renderTrialSheetHtml({
        studentName,
        teacherName: personName(classRecord.teacher, 'Преподаватель'),
        direction: report.studentProfile?.direction || booking?.direction || '',
        lessonDate: classRecord.date,
        report,
    });
    return { html };
}

module.exports = { renderTrialSheetHtml, buildTrialSheetForClass, TrialSheetError };
