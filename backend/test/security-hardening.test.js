const test = require('node:test');
const assert = require('node:assert/strict');

const { isActiveCrmAccount } = require('../src/utils/accountStatus');
const {
    isSensitiveAuditKey,
    sanitizeForAudit,
} = require('../src/utils/auditSanitizer');

test('inactive CRM account is rejected immediately', () => {
    assert.equal(isActiveCrmAccount({ status: 'active' }), true);
    assert.equal(isActiveCrmAccount({ status: 'inactive' }), false);
    assert.equal(isActiveCrmAccount({}), false);
    assert.equal(isActiveCrmAccount(null), false);
});

test('audit recognizes password, token and secret field variants', () => {
    for (const key of [
        'password',
        'currentPassword',
        'new_password',
        'generatedPassword',
        'accessToken',
        'sso_token',
        'telegramBotToken',
        'clientSecret',
        'authorization',
        'cookie',
    ]) {
        assert.equal(isSensitiveAuditKey(key), true, `${key} must be sensitive`);
    }
});

test('audit recursively redacts secrets without mutating original payload', () => {
    const original = {
        currentPassword: 'old-value',
        nested: {
            newPassword: 'new-value',
            profile: { name: 'Анна' },
        },
        items: [{ access_token: 'token-value', amount: 5000 }],
    };

    const clean = sanitizeForAudit(original);

    assert.deepEqual(clean, {
        currentPassword: '***',
        nested: {
            newPassword: '***',
            profile: { name: 'Анна' },
        },
        items: [{ access_token: '***', amount: 5000 }],
    });
    assert.equal(original.currentPassword, 'old-value');
    assert.equal(original.nested.newPassword, 'new-value');
});
