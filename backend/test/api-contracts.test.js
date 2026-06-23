const test = require('node:test');
const assert = require('node:assert/strict');

const {
    validatePaymentCreateResponse,
    validateClassApproveResponse,
    validateIntegrationClassResponse,
    validateIntegrationLogListResponse,
    validateReconciliationResponse,
} = require('../src/services/apiContracts');

test('contract: создание платежа возвращает стабильную форму', () => {
    assert.equal(validatePaymentCreateResponse({
        success: true,
        payment: {
            id: 'payment-1',
            _id: 'payment-1',
            studentId: 'student-1',
            amount: 4000,
            status: 'completed',
        },
    }), true);
    assert.throws(() => validatePaymentCreateResponse({
        success: true,
        payment: { id: 'payment-1', amount: 4000, status: 'completed' },
    }), /studentId/);
});

test('contract: подтверждение урока возвращает урок со статусом', () => {
    assert.equal(validateClassApproveResponse({
        success: true,
        class: {
            id: 'class-1',
            status: 'completed',
        },
    }), true);
});

test('contract: интеграция урока отдаёт crmClassId и статус', () => {
    assert.equal(validateIntegrationClassResponse({
        success: true,
        data: {
            crmClassId: 'class-1',
            status: 'scheduled',
            topic: null,
            publishedHomework: null,
        },
    }), true);
});

test('contract: журнал интеграций отдаёт список и пагинацию', () => {
    assert.equal(validateIntegrationLogListResponse({
        success: true,
        logs: [],
        pagination: {
            total: 0,
            page: 1,
            totalPages: 0,
            limit: 50,
        },
    }), true);
});

test('contract: сверка CRM ↔ приложение отдаёт summary и issues', () => {
    assert.equal(validateReconciliationResponse({
        success: true,
        data: {
            appAvailable: false,
            crm: { counts: {} },
            app: null,
            issues: [],
            summary: { critical: 0, warnings: 0, info: 0 },
        },
    }), true);
});
