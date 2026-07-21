const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    Header,
    HeadingLevel,
    PageNumber,
    Paragraph,
    ShadingType,
    TextRun,
} = require('docx');

const COLORS = {
    ink: '24211D',
    muted: '706B63',
    gold: 'B88A35',
    goldDark: '765619',
    goldSoft: 'F6EEDC',
    line: 'DDD7CC',
    soft: 'F7F5F1',
    white: 'FFFFFF',
};

const FONT = 'Arial';

function clean(value, fallback = '') {
    return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function comparable(value) {
    return clean(value)
        .toLocaleLowerCase('ru-RU')
        .replace(/[«»"'`.,!?;:()\[\]{}—–-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function uniqueItems(items, limit = 12) {
    const seen = new Set();
    return (items || [])
        .map(item => clean(item))
        .filter(Boolean)
        .filter(item => {
            const key = comparable(item);
            if (!key || seen.has(key)) return false;
            // Do not print a shorter restatement when it is already present in
            // the same pedagogical block.
            for (const previous of seen) {
                if (key.length > 24 && previous.length > 24 && (key.includes(previous) || previous.includes(key))) {
                    return false;
                }
            }
            seen.add(key);
            return true;
        })
        .slice(0, limit);
}

function meaningfulHomework(value) {
    const text = clean(value);
    return text && !/^(ничего|нет|не задано|не было|отсутствует)[.!… ]*$/i.test(text) ? text : '';
}

function run(text, options = {}) {
    return new TextRun({
        text: clean(text),
        font: FONT,
        size: options.size ?? 22,
        bold: Boolean(options.bold),
        italics: Boolean(options.italics),
        color: options.color || COLORS.ink,
        break: options.break,
    });
}

function bodyParagraph(text, options = {}) {
    return new Paragraph({
        alignment: options.alignment,
        keepNext: Boolean(options.keepNext),
        keepLines: true,
        spacing: {
            before: options.before ?? 0,
            after: options.after ?? 120,
            line: options.line ?? 276,
            lineRule: 'auto',
        },
        indent: options.indent,
        border: options.border,
        shading: options.shading,
        children: [run(text, options)],
    });
}

function metadataParagraph(label, value) {
    const text = clean(value);
    if (!text) return null;
    return new Paragraph({
        keepLines: true,
        spacing: { before: 0, after: 55, line: 260, lineRule: 'auto' },
        children: [
            new TextRun({
                text: `${label.toLocaleUpperCase('ru-RU')}: `,
                font: FONT,
                size: 17,
                bold: true,
                color: COLORS.goldDark,
            }),
            new TextRun({ text, font: FONT, size: 20, color: COLORS.ink }),
        ],
    });
}

function sectionHeading(text) {
    return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        keepNext: true,
        spacing: { before: 280, after: 110 },
        border: {
            bottom: { style: BorderStyle.SINGLE, size: 7, color: COLORS.gold, space: 5 },
        },
        children: [run(text, { size: 25, bold: true, color: COLORS.ink })],
    });
}

function bulletParagraph(text) {
    return new Paragraph({
        numbering: { reference: 'maestro-bullets', level: 0 },
        keepLines: true,
        spacing: { before: 0, after: 95, line: 276, lineRule: 'auto' },
        children: [run(text, { size: 21 })],
    });
}

function bulletSection(title, items) {
    const cleanItems = (items || []).map(item => clean(item)).filter(Boolean);
    if (!cleanItems.length) return [];
    return [sectionHeading(title), ...cleanItems.map(bulletParagraph)];
}

function callout(label, text) {
    const value = clean(text);
    if (!value) return [];
    return [
        new Paragraph({
            keepNext: true,
            spacing: { before: 190, after: 40 },
            indent: { left: 260, right: 260 },
            shading: { type: ShadingType.CLEAR, fill: COLORS.goldSoft, color: 'auto' },
            border: {
                left: { style: BorderStyle.SINGLE, size: 22, color: COLORS.gold, space: 12 },
                top: { style: BorderStyle.SINGLE, size: 2, color: COLORS.goldSoft },
                bottom: { style: BorderStyle.SINGLE, size: 2, color: COLORS.goldSoft },
                right: { style: BorderStyle.SINGLE, size: 2, color: COLORS.goldSoft },
            },
            children: [run(label.toLocaleUpperCase('ru-RU'), { size: 17, bold: true, color: COLORS.goldDark })],
        }),
        new Paragraph({
            keepLines: true,
            spacing: { before: 0, after: 190, line: 288, lineRule: 'auto' },
            indent: { left: 260, right: 260 },
            shading: { type: ShadingType.CLEAR, fill: COLORS.goldSoft, color: 'auto' },
            border: {
                left: { style: BorderStyle.SINGLE, size: 22, color: COLORS.gold, space: 12 },
                bottom: { style: BorderStyle.SINGLE, size: 2, color: COLORS.goldSoft },
                right: { style: BorderStyle.SINGLE, size: 2, color: COLORS.goldSoft },
            },
            children: [run(value, { size: 23, bold: true, color: COLORS.ink })],
        }),
    ];
}

function noteBlock(label, text) {
    const value = clean(text);
    if (!value) return [];
    return [
        new Paragraph({
            keepNext: true,
            spacing: { before: 230, after: 35 },
            shading: { type: ShadingType.CLEAR, fill: COLORS.soft, color: 'auto' },
            children: [run(label.toLocaleUpperCase('ru-RU'), { size: 16, bold: true, color: COLORS.muted })],
        }),
        new Paragraph({
            keepLines: true,
            spacing: { before: 0, after: 150, line: 270, lineRule: 'auto' },
            shading: { type: ShadingType.CLEAR, fill: COLORS.soft, color: 'auto' },
            children: [run(value, { size: 19, color: COLORS.muted })],
        }),
    ];
}

function buildTrialAnalysisDocument({ payload, analysis, scoreItems, fileName }) {
    const studentName = payload.student?.name || 'Ученик';
    const teacherName = payload.teacher?.name || 'Преподаватель';
    const lessonDate = payload.lesson?.date
        ? new Date(payload.lesson.date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
        : '';
    const lessonTime = [payload.lesson?.startTime, payload.lesson?.endTime].filter(Boolean).join('–');
    const metadata = [
        metadataParagraph('Ученик', studentName),
        metadataParagraph('Направление', payload.lesson?.direction),
        metadataParagraph('Дата', [lessonDate, lessonTime].filter(Boolean).join(' · ')),
        metadataParagraph('Педагог', teacherName),
    ].filter(Boolean);

    const observations = uniqueItems(analysis.observations, 8);
    const skills = uniqueItems(analysis.skills?.length ? analysis.skills : scoreItems, 8);
    const growthAreas = uniqueItems(analysis.growthAreas, 6);
    const recommendations = uniqueItems([...(analysis.recommendations || []), ...(analysis.firstMonthPlan || [])], 8);
    const homework = meaningfulHomework(payload.trialReport?.lessonFacts?.homeworkGiven);

    const children = [
        bodyParagraph('MAESTRO', { size: 19, bold: true, color: COLORS.gold, after: 35 }),
        bodyParagraph('Музыкальная школа', { size: 18, color: COLORS.muted, after: 300 }),
        bodyParagraph(analysis.title || 'Анализ пробного урока', {
            size: 42,
            bold: true,
            color: COLORS.ink,
            line: 300,
            after: 90,
        }),
        bodyParagraph(studentName, { size: 27, color: COLORS.goldDark, after: 260 }),
        ...metadata,
        ...callout('Главный вывод', analysis.summary || 'Анкета пробного урока заполнена.'),
        ...bulletSection('Наблюдения педагога', observations),
        ...bulletSection('Музыкальные навыки', skills),
        ...bulletSection('Зоны развития', growthAreas),
        ...bulletSection('Рекомендации по обучению', recommendations),
        ...(homework
            ? [sectionHeading('Домашнее задание'), bodyParagraph(homework)]
            : []),
        bodyParagraph('С уважением, команда музыкальной школы Maestro', {
            before: 300,
            after: 50,
            bold: true,
            color: COLORS.goldDark,
        }),
    ];

    const doc = new Document({
        creator: 'Maestro CRM',
        title: analysis.title || 'Анализ пробного урока',
        description: 'AI-анализ пробного урока Maestro CRM',
        styles: {
            default: {
                document: {
                    run: { font: FONT, size: 22, color: COLORS.ink },
                    paragraph: { spacing: { after: 120, line: 276, lineRule: 'auto' } },
                },
                heading2: {
                    run: { font: FONT, size: 25, bold: true, color: COLORS.ink },
                    paragraph: { spacing: { before: 280, after: 110 }, keepNext: true },
                },
            },
        },
        numbering: {
            config: [{
                reference: 'maestro-bullets',
                levels: [{
                    level: 0,
                    format: 'bullet',
                    text: '•',
                    alignment: AlignmentType.LEFT,
                    style: {
                        paragraph: { indent: { left: 720, hanging: 300 } },
                        run: { color: COLORS.gold, font: FONT },
                    },
                }],
            }],
        },
        sections: [{
            properties: {
                page: {
                    size: { width: 12240, height: 15840 },
                    margin: {
                        top: 1080,
                        right: 1260,
                        bottom: 1080,
                        left: 1260,
                        header: 540,
                        footer: 540,
                    },
                },
            },
            headers: {
                default: new Header({
                    children: [
                        new Paragraph({
                            alignment: AlignmentType.RIGHT,
                            spacing: { after: 0 },
                            children: [run('MAESTRO · АНАЛИЗ ПРОБНОГО УРОКА', { size: 15, bold: true, color: COLORS.muted })],
                        }),
                    ],
                }),
            },
            footers: {
                default: new Footer({
                    children: [
                        new Paragraph({
                            alignment: AlignmentType.CENTER,
                            border: { top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.line, space: 6 } },
                            children: [
                                run('Музыкальная школа Maestro   ·   ', { size: 15, color: COLORS.muted }),
                                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 15, color: COLORS.muted }),
                            ],
                        }),
                    ],
                }),
            },
            children,
        }],
    });

    return { doc, fileName };
}

module.exports = { buildTrialAnalysisDocument };
