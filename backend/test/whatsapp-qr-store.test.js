const test = require('node:test');
const assert = require('node:assert/strict');
const {
    QR_TTL_MS,
    putWhatsappQr,
    getWhatsappQr,
    clearAllWhatsappQr,
} = require('../src/services/whatsappQrStore');

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test.afterEach(() => clearAllWhatsappQr());

test('stores a PNG QR only until its expiry time', () => {
    const now = new Date('2026-08-09T18:00:00.000Z');
    const stored = putWhatsappQr({
        accountKey: 'maestro-main',
        imageBase64: ONE_PIXEL_PNG,
        workerId: 'worker-1',
        now,
    });

    assert.equal(stored.workerId, 'worker-1');
    assert.equal(getWhatsappQr('maestro-main', new Date(now.getTime() + QR_TTL_MS - 1))?.image.length > 0, true);
    assert.equal(getWhatsappQr('maestro-main', new Date(now.getTime() + QR_TTL_MS)), null);
});

test('rejects non-PNG and malformed account input', () => {
    assert.throws(() => putWhatsappQr({
        accountKey: 'valid-account',
        imageBase64: Buffer.from('not png').toString('base64'),
        workerId: 'worker-1',
    }), /PNG/);
    assert.throws(() => putWhatsappQr({
        accountKey: '../bad',
        imageBase64: ONE_PIXEL_PNG,
        workerId: 'worker-1',
    }), /accountKey/);
});
