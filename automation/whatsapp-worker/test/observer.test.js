const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBoolean } = require('../src/config');
const { extractChatId } = require('../src/whatsappWebObserver');

test('boolean config is explicit and safe by default', () => {
    assert.equal(parseBoolean(undefined, false), false);
    assert.equal(parseBoolean('true'), true);
    assert.equal(parseBoolean('0'), false);
});

test('chat id is extracted only from a personal WhatsApp message id', () => {
    assert.equal(extractChatId('false_77001234567@c.us_AABBCC'), '77001234567@c.us');
    assert.equal(extractChatId('true_123456@g.us_AABBCC'), null);
});
