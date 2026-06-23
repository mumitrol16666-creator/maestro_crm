function assertObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} должен быть объектом`);
    }
}

function assertString(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} должен быть непустой строкой`);
    }
}

function assertOptionalString(value, label) {
    if (value !== null && value !== undefined && typeof value !== 'string') {
        throw new Error(`${label} должен быть строкой или пустым`);
    }
}

function assertBoolean(value, label) {
    if (typeof value !== 'boolean') {
        throw new Error(`${label} должен быть true/false`);
    }
}

function assertNumber(value, label) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error(`${label} должен быть числом`);
    }
}

function assertArray(value, label) {
    if (!Array.isArray(value)) {
        throw new Error(`${label} должен быть списком`);
    }
}

function validatePaymentCreateResponse(payload) {
    assertObject(payload, 'Ответ платежа');
    assertBoolean(payload.success, 'success');
    assertObject(payload.payment, 'payment');
    assertString(payload.payment.id || payload.payment._id, 'payment.id');
    assertNumber(payload.payment.amount, 'payment.amount');
    assertString(payload.payment.studentId, 'payment.studentId');
    assertString(payload.payment.status, 'payment.status');
    return true;
}

function validateClassApproveResponse(payload) {
    assertObject(payload, 'Ответ подтверждения урока');
    assertBoolean(payload.success, 'success');
    assertObject(payload.class || payload.data?.class, 'class');
    const lesson = payload.class || payload.data.class;
    assertString(lesson.id || lesson.crmClassId, 'class.id');
    assertString(lesson.status, 'class.status');
    return true;
}

function validateIntegrationClassResponse(payload) {
    assertObject(payload, 'Ответ интеграции по уроку');
    assertBoolean(payload.success, 'success');
    assertObject(payload.data, 'data');
    assertString(payload.data.crmClassId, 'data.crmClassId');
    assertString(payload.data.status, 'data.status');
    assertOptionalString(payload.data.topic, 'data.topic');
    assertOptionalString(payload.data.publishedHomework, 'data.publishedHomework');
    return true;
}

function validateIntegrationLogListResponse(payload) {
    assertObject(payload, 'Ответ журнала интеграций');
    assertBoolean(payload.success, 'success');
    assertArray(payload.logs, 'logs');
    assertObject(payload.pagination, 'pagination');
    assertNumber(payload.pagination.total, 'pagination.total');
    assertNumber(payload.pagination.page, 'pagination.page');
    assertNumber(payload.pagination.limit, 'pagination.limit');
    return true;
}

function validateReconciliationResponse(payload) {
    assertObject(payload, 'Ответ сверки');
    assertBoolean(payload.success, 'success');
    assertObject(payload.data, 'data');
    assertBoolean(payload.data.appAvailable, 'data.appAvailable');
    assertObject(payload.data.crm, 'data.crm');
    assertObject(payload.data.summary, 'data.summary');
    assertArray(payload.data.issues, 'data.issues');
    return true;
}

module.exports = {
    validatePaymentCreateResponse,
    validateClassApproveResponse,
    validateIntegrationClassResponse,
    validateIntegrationLogListResponse,
    validateReconciliationResponse,
};
