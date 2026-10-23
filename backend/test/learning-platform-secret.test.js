const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
process.env.LEARNING_PLATFORM_API_URL = 'http://127.0.0.1:9';

const calls = [];
const axiosPath = require.resolve('axios');
require(axiosPath);
const fakeAxios = async (config) => { calls.push(config); return { status: 200, data: { data: { ok: true } } }; };
require.cache[axiosPath].exports = fakeAxios;

const { learningPlatformSecret } = require('../src/services/learningPlatformAuth');
const { platform } = require('../src/services/enrollmentAccess');

test('запросы CRM к платформе подписываются LEARNING_PLATFORM_SECRET, если он задан', async () => {
    process.env.INTEGRATION_SERVICE_SECRET = 'incoming-from-platform-secret';
    process.env.LEARNING_PLATFORM_SECRET = 'outgoing-to-platform-secret';
    assert.equal(learningPlatformSecret(), 'outgoing-to-platform-secret');
    calls.length = 0;
    await platform('/family/1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.Authorization, 'Bearer outgoing-to-platform-secret');
});

test('без LEARNING_PLATFORM_SECRET (или с пустым) подписывает общий INTEGRATION_SERVICE_SECRET', async () => {
    process.env.INTEGRATION_SERVICE_SECRET = 'incoming-from-platform-secret';
    for (const empty of [undefined, '']) {
        if (empty === undefined) delete process.env.LEARNING_PLATFORM_SECRET; else process.env.LEARNING_PLATFORM_SECRET = empty;
        assert.equal(learningPlatformSecret(), 'incoming-from-platform-secret');
        calls.length = 0;
        await platform('/family/1');
        assert.equal(calls[0].headers.Authorization, 'Bearer incoming-from-platform-secret');
    }
});

test('INTEGRATION_SERVICE_SECRET в src читают только входящая проверка и общая функция', () => {
    const readers = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js') && /process\.env\.INTEGRATION_SERVICE_SECRET/.test(fs.readFileSync(full, 'utf8'))) {
                readers.push(path.relative(path.join(__dirname, '../src'), full));
            }
        }
    };
    walk(path.join(__dirname, '../src'));
    assert.deepEqual(readers.sort(), ['middleware/integrationAuth.js', 'services/learningPlatformAuth.js']);
});
