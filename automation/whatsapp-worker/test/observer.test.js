const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CHROME_USER_AGENT, parseBoolean } = require('../src/config');
const { extractChatId, WhatsappWebObserver } = require('../src/whatsappWebObserver');

test('boolean config is explicit and safe by default', () => {
    assert.equal(parseBoolean(undefined, false), false);
    assert.equal(parseBoolean('true'), true);
    assert.equal(parseBoolean('0'), false);
});

test('server user agent is accepted as a current Chrome browser', () => {
    assert.match(DEFAULT_CHROME_USER_AGENT, /Chrome\/1\d{2}\./);
    assert.doesNotMatch(DEFAULT_CHROME_USER_AGENT, /HeadlessChrome/);
});

test('manual sending must be enabled explicitly', () => {
    const previous = process.env.WHATSAPP_BROWSER_MODE;
    process.env.WHATSAPP_BROWSER_MODE = 'automatic';
    try {
        const { loadConfig } = require('../src/config');
        assert.throws(() => loadConfig(), /observer or manual/);
    } finally {
        if (previous === undefined) delete process.env.WHATSAPP_BROWSER_MODE;
        else process.env.WHATSAPP_BROWSER_MODE = previous;
    }
});

test('chat id is extracted only from a personal WhatsApp message id', () => {
    assert.equal(extractChatId('false_77001234567@c.us_AABBCC'), '77001234567@c.us');
    assert.equal(extractChatId('true_123456@g.us_AABBCC'), null);
});

test('expired QR is reloaded before a fresh canvas screenshot is captured', async () => {
    const calls = [];
    const qrImage = Buffer.from('fresh-qr');
    const page = {
        getByText(pattern) {
            assert.match('Select to reload QR code', pattern);
            return {
                first: () => ({
                    isVisible: async () => true,
                    click: async () => calls.push('reload'),
                }),
            };
        },
        waitForTimeout: async () => calls.push('wait'),
        locator(selector) {
            assert.equal(selector, 'canvas');
            return {
                first: () => ({
                    waitFor: async options => calls.push(`visible:${options.state}`),
                    screenshot: async options => {
                        assert.equal(options.type, 'png');
                        calls.push('screenshot');
                        return qrImage;
                    },
                }),
            };
        },
    };

    const observer = new WhatsappWebObserver(page);
    const result = await observer.captureQrCode();

    assert.equal(result, qrImage.toString('base64'));
    assert.deepEqual(calls, ['reload', 'wait', 'visible:visible', 'screenshot']);
});
