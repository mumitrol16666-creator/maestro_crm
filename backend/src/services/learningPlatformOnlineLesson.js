const { executeOutboundIntegration } = require('./integrationJournal');

function learningPlatformBaseUrl() {
    return (process.env.LEARNING_PLATFORM_API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
}

async function syncOnlineLessonToLearningPlatform(externalSourceId, payload) {
    return executeOutboundIntegration({
        operation: 'online-lesson.sync',
        url: `${learningPlatformBaseUrl()}/api/integration/v1/online-lessons/${encodeURIComponent(externalSourceId)}/sync`,
        method: 'POST',
        payload,
        entityType: 'Booking',
        entityId: externalSourceId,
    });
}

module.exports = { syncOnlineLessonToLearningPlatform };
