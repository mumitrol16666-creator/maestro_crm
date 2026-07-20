const { executeOutboundIntegration } = require('./integrationJournal');

function learningPlatformBaseUrl() {
    return (process.env.LEARNING_PLATFORM_API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
}

function formatDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Asia/Aqtobe',
    }).format(date);
}

async function syncLessonApprovedToLearningPlatform(classRecord = {}) {
    const crmTeacherId = classRecord.teacherId || classRecord.teacher?.id;
    const crmClassId = classRecord.id || classRecord._id;
    if (!crmTeacherId || !crmClassId) {
        return { success: false, skipped: true, reason: 'teacher_or_lesson_not_linked' };
    }

    const lessonTitle = classRecord.title
        || classRecord.group?.name
        || classRecord.individualStudent?.name
        || 'Урок';

    return executeOutboundIntegration({
        operation: 'notifications.offline-lesson-approved',
        url: `${learningPlatformBaseUrl()}/api/integration/v1/notifications/offline-lesson-approved`,
        method: 'POST',
        payload: {
            crmClassId,
            crmTeacherId,
            lessonTitle,
            date: formatDate(classRecord.date),
            startTime: classRecord.startTime || null,
        },
        entityType: 'Class',
        entityId: crmClassId,
    });
}

module.exports = { syncLessonApprovedToLearningPlatform };
