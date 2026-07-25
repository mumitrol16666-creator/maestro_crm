const test = require('node:test');
const assert = require('node:assert/strict');
const { integrationSecretMatches } = require('../src/middleware/integrationAuth');

test('служебный токен сравнивается без обычного строкового сравнения', () => {
    assert.equal(integrationSecretMatches('same-secret', 'same-secret'), true);
    assert.equal(integrationSecretMatches('same-secret', 'other-secret'), false);
    assert.equal(integrationSecretMatches('short', 'much-longer-secret'), false);
    assert.equal(integrationSecretMatches('', 'secret'), false);
});
