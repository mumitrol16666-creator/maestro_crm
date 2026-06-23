const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';

const { redact, safeBody, isRetryableStatus } = require('../src/services/integrationJournal');
const { compareSnapshots } = require('../src/services/integrationReconciliation');

test('журнал интеграций скрывает пароли и токены', () => {
    assert.deepEqual(redact({
        phone: '+77000000000',
        password: 'secret-password',
        nested: { token: 'abc', name: 'Максим' },
    }), {
        phone: '+77000000000',
        password: '[скрыто]',
        nested: { token: '[скрыто]', name: 'Максим' },
    });
    assert.deepEqual(safeBody({ apiKey: 'x' }), { apiKey: '[скрыто]' });
});

test('повтор разрешён только для временных интеграционных ошибок', () => {
    assert.equal(isRetryableStatus(null), true);
    assert.equal(isRetryableStatus(500), true);
    assert.equal(isRetryableStatus(429), true);
    assert.equal(isRetryableStatus(400), false);
    assert.equal(isRetryableStatus(401), false);
});

test('сверка находит расхождения CRM ↔ приложение', () => {
    const issues = compareSnapshots({
        linkedUsers: [{ id: 'crm-1', appUserId: 'app-1' }],
        externalBookings: [{ id: 'booking-1', externalSourceId: 'ext-1' }],
        failedIntegrationOperations: [{
            id: 'log-1',
            retryable: true,
            operation: 'users.link',
            errorMessage: 'timeout',
        }],
    }, {
        linkedUsers: [{ crmStudentId: 'crm-1', appUserId: 'another-app' }],
        externalBookings: [],
    });

    assert.equal(issues.some((item) => item.type === 'linked_user_mismatch'), true);
    assert.equal(issues.some((item) => item.type === 'external_booking_missing_in_app'), true);
    assert.equal(issues.some((item) => item.type === 'failed_integration_operation'), true);
});
