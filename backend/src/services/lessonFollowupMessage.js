function cleanLessonFollowupText(value) {
    return String(value || '').trim();
}

function buildLessonFollowupMessage(classRecord = {}) {
    const sections = [
        ['Тема урока', classRecord.topic],
        ['Домашнее задание', classRecord.homeworkDraft ?? classRecord.homework],
        ['Итог урока', classRecord.lessonSummary ?? classRecord.summary],
    ]
        .map(([label, value]) => [label, cleanLessonFollowupText(value)])
        .filter(([, value]) => value)
        .map(([label, value]) => `*${label}:*\n${value}`);

    return sections.join('\n\n');
}

module.exports = { buildLessonFollowupMessage };
