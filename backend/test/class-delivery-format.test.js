const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeMeetingUrl } = require('../src/utils/classDelivery');

test('online lesson meeting URL accepts only http and https', () => {
    assert.equal(
        normalizeMeetingUrl('https://meet.example.test/lesson').value,
        'https://meet.example.test/lesson',
    );
    assert.match(
        normalizeMeetingUrl('javascript:alert(1)').error,
        /http:\/\//,
    );
    assert.match(
        normalizeMeetingUrl('not a url').error,
        /корректную ссылку/,
    );
    assert.deepEqual(normalizeMeetingUrl(''), { value: null });
});
