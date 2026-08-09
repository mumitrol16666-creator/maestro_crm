const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeManualMessage,
    buildOutboxIdempotencyKey,
    validateOutboxResult,
    canQueueManualMessage,
} = require('../src/services/whatsappOutboxPolicy');

test('manual WhatsApp message is trimmed and bounded', () => {
    assert.equal(normalizeManualMessage('  Добрый день!  '), 'Добрый день!');
    assert.throws(() => normalizeManualMessage('   '), /Введите/);
    assert.throws(() => normalizeManualMessage('x'.repeat(4001)), /4000/);
});

test('same browser mutation receives the same outbox idempotency key', () => {
    const input = { conversationId: 'c1', userId: 'u1', requestKey: 'request-1', content: 'Ответ' };
    assert.equal(buildOutboxIdempotencyKey(input), buildOutboxIdempotencyKey(input));
    assert.notEqual(buildOutboxIdempotencyKey(input), buildOutboxIdempotencyKey({ ...input, requestKey: 'request-2' }));
});

test('only the admin who took the dialog can queue a manual message', () => {
    const conversation = { automationStatus: 'paused', takeoverById: 'admin-1', externalChatId: '7700@c.us' };
    assert.equal(canQueueManualMessage(conversation, 'admin-1'), true);
    assert.equal(canQueueManualMessage(conversation, 'admin-2'), false);
    assert.equal(canQueueManualMessage({ ...conversation, automationStatus: 'observer' }, 'admin-1'), false);
});

test('worker result never turns an unknown state into a retry', () => {
    assert.equal(validateOutboxResult('sent'), 'sent');
    assert.equal(validateOutboxResult('uncertain'), 'uncertain');
    assert.equal(validateOutboxResult('failed'), 'failed');
    assert.throws(() => validateOutboxResult('retry'), /Некорректный/);
});
