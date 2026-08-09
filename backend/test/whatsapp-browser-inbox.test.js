const test = require('node:test');
const assert = require('node:assert/strict');

const {
    isPersonalChatId,
    prepareInboundMessage,
    prepareInboundBatch,
} = require('../src/services/whatsappBrowserInbox');

test('browser importer accepts personal chats and excludes groups/statuses', () => {
    assert.equal(isPersonalChatId('77001234567@c.us'), true);
    assert.equal(isPersonalChatId('77001234567@s.whatsapp.net'), true);
    assert.equal(isPersonalChatId('120363000000@g.us'), false);
    assert.equal(isPersonalChatId('status@broadcast'), false);
});

test('inbound browser message is normalized and receives stable fingerprint', () => {
    const source = {
        externalChatId: '77001234567@c.us',
        externalMessageId: 'false_77001234567@c.us_ABC',
        displayName: '  Асем  ',
        content: '  Добрый день!  ',
        messageType: 'text',
        timestamp: '2026-08-09T10:00:00.000Z',
    };
    const first = prepareInboundMessage(source, 'maestro-main');
    const second = prepareInboundMessage(source, 'maestro-main');

    assert.equal(first.phoneNumber, '77001234567');
    assert.equal(first.displayName, 'Асем');
    assert.equal(first.content, 'Добрый день!');
    assert.equal(first.fingerprint, second.fingerprint);
});

test('duplicate messages inside one worker batch are collapsed', () => {
    const message = {
        externalChatId: '77001234567@c.us',
        externalMessageId: 'message-1',
        content: 'Тест',
        messageType: 'text',
        timestamp: '2026-08-09T10:00:00.000Z',
    };
    assert.equal(prepareInboundBatch([message, message], 'maestro-main').length, 1);
});

test('group messages and empty text are rejected before database access', () => {
    assert.throws(() => prepareInboundMessage({
        externalChatId: '120363000000@g.us',
        content: 'group',
        messageType: 'text',
    }, 'maestro-main'), /личные/);
    assert.throws(() => prepareInboundMessage({
        externalChatId: '77001234567@c.us',
        content: ' ',
        messageType: 'text',
    }, 'maestro-main'), /Пустое/);
});
