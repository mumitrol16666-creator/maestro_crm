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

async function syncLessonApprovedToLearningPlatform(classRecord = {}, crmStudentIds = []) {
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
            crmStudentIds: Array.isArray(crmStudentIds) ? crmStudentIds.filter(Boolean) : [],
            lessonTitle,
            date: formatDate(classRecord.date),
            startTime: classRecord.startTime || null,
        },
        entityType: 'Class',
        entityId: crmClassId,
    });
}

async function generateLessonHomeworkWhatsappDrafts(classRecord = {}) {
    const crmClassId = classRecord.id || classRecord._id;
    if (!crmClassId) {
        return { success: false, skipped: true, reason: 'lesson_not_linked' };
    }
    if (
        classRecord.classType === 'trial'
        || ['no_submission', 'not_held'].includes(classRecord.teacherOutcomeHint)
    ) {
        return { success: false, skipped: true, reason: 'message_not_required' };
    }

    return executeOutboundIntegration({
        operation: 'whatsapp.homework-drafts.generate',
        url: `${learningPlatformBaseUrl()}/api/integration/v1/whatsapp/homework-drafts`,
        method: 'POST',
        payload: { crmClassId },
        entityType: 'Class',
        entityId: crmClassId,
        timeout: 30000,
    });
}

async function syncOfflineLessonEventToLearningPlatform(event, classRecord = {}, crmStudentIds = [], message = null) {
    const crmTeacherId = classRecord.teacherId || classRecord.teacher?.id;
    const crmClassId = classRecord.id || classRecord._id;
    if (!crmClassId) {
        return { success: false, skipped: true, reason: 'lesson_not_linked' };
    }

    const lessonTitle = classRecord.title
        || classRecord.group?.name
        || classRecord.individualStudent?.name
        || 'Урок';

    return executeOutboundIntegration({
        operation: `notifications.offline-lesson-${event}`,
        url: `${learningPlatformBaseUrl()}/api/integration/v1/notifications/offline-lesson-event`,
        method: 'POST',
        payload: {
            event,
            crmClassId,
            crmTeacherId,
            crmStudentIds: Array.isArray(crmStudentIds) ? crmStudentIds.filter(Boolean) : [],
            lessonTitle,
            date: formatDate(classRecord.date),
            startTime: classRecord.startTime || null,
            message: message || null,
        },
        entityType: 'Class',
        entityId: crmClassId,
    });
}

module.exports = {
    syncLessonApprovedToLearningPlatform,
    syncOfflineLessonEventToLearningPlatform,
    generateLessonHomeworkWhatsappDrafts,
};
