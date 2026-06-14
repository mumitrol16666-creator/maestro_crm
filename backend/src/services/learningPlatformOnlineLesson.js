const axios = require('axios');

function learningPlatformBaseUrl() {
    return (process.env.LEARNING_PLATFORM_API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
}

function integrationHeaders() {
    return {
        Authorization: `Bearer ${process.env.INTEGRATION_SERVICE_SECRET}`,
        'X-Integration-System': 'crm',
        'Content-Type': 'application/json',
    };
}

async function syncOnlineLessonToLearningPlatform(externalSourceId, payload) {
    const response = await axios.post(
        `${learningPlatformBaseUrl()}/api/integration/v1/online-lessons/${encodeURIComponent(externalSourceId)}/sync`,
        payload,
        { headers: integrationHeaders(), timeout: 15000 },
    );
    return response.data;
}

module.exports = { syncOnlineLessonToLearningPlatform };
