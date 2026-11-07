const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CHROME_USER_AGENT, parseBoolean } = require('../src/config');
const { DomRecognitionGuard } = require('../src/domRecognitionGuard');
const {
    buildIncomingMessages, classifyMessageRow, extractChatId, parsePrePlainText, resolveChatId, WhatsappWebObserver,
} = require('../src/whatsappWebObserver');

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

test('brief post-login loading does not trigger a DOM alert', () => {
    const guard = new DomRecognitionGuard({ threshold: 12 });
    assert.equal(guard.observe('connected'), false);
    for (let cycle = 0; cycle < 11; cycle += 1) {
        assert.equal(guard.observe('starting'), false);
    }
    assert.equal(guard.observe('connected'), false);
});

test('DOM alert requires a continuous unknown screen and fires only once', () => {
    const guard = new DomRecognitionGuard({ threshold: 3 });
    guard.observe('connected');
    assert.equal(guard.observe('starting'), false);
    assert.equal(guard.observe('starting'), false);
    assert.equal(guard.observe('starting'), true);
    assert.equal(guard.observe('starting'), false);
});

test('known QR screen cancels post-login DOM suspicion', () => {
    const guard = new DomRecognitionGuard({ threshold: 3 });
    guard.observe('connected');
    guard.observe('starting');
    guard.observe('starting');
    assert.equal(guard.observe('qr_required'), false);
    assert.equal(guard.observe('starting'), false);
});

// A fake WhatsApp Web page for the broadcast: the chat opens with the drafted text,
// Enter adds a new row with the text and a server tick, or a «number is not on WhatsApp» dialog shows.
function broadcastPage({ invalid = false, drafted = null, bubble = null, label = ' Доставлено ' } = {}) {
    const calls = [];
    let sent = false;
    const never = () => new Promise(() => {});
    const oldRow = { id: 'OLD', text: 'старое сообщение 10:20', labels: ' Доставлено ' };
    const page = {
        goto: async url => calls.push(`goto:${url}`),
        waitForTimeout: async () => {},
        locator(selector) {
            if (selector.includes('footer')) {
                return {
                    last: () => ({
                        waitFor: async () => (invalid ? never() : undefined),
                        innerText: async () => drafted,
                        press: async key => { calls.push(`press:${key}`); sent = true; },
                    }),
                };
            }
            if (selector.includes('dialog')) {
                return {
                    filter: () => ({ first: () => ({ waitFor: async () => (invalid ? undefined : never()) }) }),
                };
            }
            assert.match(selector, /conv-msg-/);
            return {
                evaluateAll: async () => (sent && bubble ? [oldRow, { id: 'NEW', text: bubble, labels: `Вы: ${label}` }] : [oldRow]),
            };
        },
    };
    return { page, calls };
}

test('broadcast text is sent only after it appears in the input, and the bubble confirms it', async () => {
    const content = '*Тема урока:*\nАккорды Am и C 😊';
    const { page, calls } = broadcastPage({ drafted: 'Тема урока:\nАккорды Am и C', bubble: 'Тема урока: Аккорды Am и C 12:01' });
    const observer = new WhatsappWebObserver(page);
    const result = await observer.sendBroadcastText({ phoneNumber: '77050000001', content }, { timeoutMs: 50, confirmMs: 50 });
    assert.deepEqual(result, { status: 'sent', externalMessageId: 'NEW' });
    assert.match(calls[0], /send\?phone=77050000001&text=/);
    assert.equal(calls[1], 'press:Enter');
    assert.equal(calls.at(-1), 'goto:https://web.whatsapp.com/', 'back to the chat list');
});

test('a number without WhatsApp is reported as invalid and nothing is sent', async () => {
    const { page, calls } = broadcastPage({ invalid: true });
    const result = await new WhatsappWebObserver(page).sendBroadcastText({ phoneNumber: '77050000002', content: 'Урок сегодня' }, { timeoutMs: 50 });
    assert.equal(result.status, 'invalid');
    assert.ok(!calls.includes('press:Enter'));
});

test('an empty input is not sent; a missing bubble after Enter is uncertain, never resent', async () => {
    const empty = broadcastPage({ drafted: '' });
    const notSent = await new WhatsappWebObserver(empty.page).sendBroadcastText({ phoneNumber: '77050000003', content: 'Урок сегодня' }, { timeoutMs: 50 });
    assert.equal(notSent.status, 'failed');
    assert.ok(!empty.calls.includes('press:Enter'));

    const lost = broadcastPage({ drafted: 'Урок сегодня', bubble: 'другой текст' });
    const unsure = await new WhatsappWebObserver(lost.page).sendBroadcastText({ phoneNumber: '77050000003', content: 'Урок сегодня' }, { timeoutMs: 50, confirmMs: 30 });
    assert.equal(unsure.status, 'uncertain');

    const clock = broadcastPage({ drafted: 'Урок сегодня', bubble: 'Урок сегодня 12:06', label: ' Ожидание ' });
    const pending = await new WhatsappWebObserver(clock.page).sendBroadcastText({ phoneNumber: '77050000003', content: 'Урок сегодня' }, { timeoutMs: 50, confirmMs: 30 });
    assert.equal(pending.status, 'uncertain', 'a message still waiting for the server is not reported as sent');
});

test('broadcast is off unless switched on explicitly', () => {
    const keys = ['WHATSAPP_BROWSER_CRM_URL', 'WHATSAPP_BROWSER_WORKER_SECRET', 'WHATSAPP_BROWSER_ACCOUNT_KEY', 'WHATSAPP_BROWSER_WORKER_ID', 'WHATSAPP_BROWSER_BROADCAST', 'WHATSAPP_BROWSER_MODE'];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    Object.assign(process.env, {
        WHATSAPP_BROWSER_CRM_URL: 'http://127.0.0.1:5000',
        WHATSAPP_BROWSER_WORKER_SECRET: 'x',
        WHATSAPP_BROWSER_ACCOUNT_KEY: 'maestro-main',
        WHATSAPP_BROWSER_WORKER_ID: 'mac-1',
        WHATSAPP_BROWSER_MODE: 'observer',
    });
    delete process.env.WHATSAPP_BROWSER_BROADCAST;
    try {
        const { loadConfig } = require('../src/config');
        assert.equal(loadConfig().broadcast, false);
        process.env.WHATSAPP_BROWSER_BROADCAST = 'true';
        assert.equal(loadConfig().broadcast, true);
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});

// Rows as WhatsApp Web drew them on 07.11.2026: no message-in/out classes, a bare data-id,
// the chat addressed by a hidden @lid and the phone number only in the contact model.
const NEW_LAYOUT_CHAT = { id: '229037821698265@lid', phoneNumber: '77053802607@c.us', title: 'Абьюзерша' };
const newIncoming = (dataId, text, time, extra = {}) => ({
    dataId,
    legacy: null,
    fromMe: null,
    content: text,
    prePlain: `[${time}, 07.11.2026] Абьюзерша🩵: `,
    labels: ['Абьюзерша🩵:'],
    testids: ['msg-container', 'selectable-text', 'msg-meta', 'addon-bubble-container'],
    ...extra,
});
const newOutgoing = (dataId, text, time, labels = [' Доставлено ']) => ({
    dataId,
    legacy: null,
    fromMe: null,
    content: text,
    prePlain: `[${time}, 07.11.2026] Maestro Online: `,
    labels,
    testids: ['msg-container', 'selectable-text', 'msg-meta', 'addon-bubble-container'],
});

test('new layout: incoming rows are told apart from outgoing ones without React data', () => {
    const rows = [
        newIncoming('3A89A727EDACD3B12D29', 'Супер)', '09:35', { testids: ['msg-container', 'tail-in', 'msg-meta'] }),
        newIncoming('3A457C205D1CAFE52211', 'Как настроение?', '10:03'),
        newOutgoing('3B9B544C0029E1C44C24', 'да пойдет', '10:20'),
        newOutgoing('3EB0X', 'ждёт сети', '10:21', [' Ожидание ']),
        newOutgoing('3EB09F19AF06F407C9D438', 'Сегодня в 23:00 занятие', '12:27', ['Вы:', ' Доставлено ']),
    ];
    const messages = buildIncomingMessages({ chat: NEW_LAYOUT_CHAT, rows });
    assert.deepEqual(messages.map(message => message.content), ['Супер)', 'Как настроение?']);
    assert.equal(messages[0].externalChatId, '77053802607@c.us');
    assert.equal(messages[0].phoneNumber, '77053802607@c.us');
    assert.equal(messages[0].externalMessageId, 'false_77053802607@c.us_3A89A727EDACD3B12D29');
    assert.equal(messages[0].displayName, 'Абьюзерша');
    assert.equal(new Date(messages[1].timestamp).getTime(), new Date(2026, 10, 7, 10, 3).getTime());
});

test('React message data wins over layout guesses', () => {
    assert.equal(classifyMessageRow({ ...newIncoming('A', 'x', '10:00'), fromMe: true }), 'out');
    assert.equal(classifyMessageRow({ ...newOutgoing('B', 'x', '10:00'), fromMe: false }), 'in');
});

test('an outgoing row without a status is recognised by the own sender name', () => {
    const rows = [
        newOutgoing('OWN1', 'первое', '10:00', ['Вы:', ' Прочитано ']),
        newOutgoing('OWN2', 'второе, статус ещё не нарисован', '10:01', []),
        newIncoming('IN1', 'ответ', '10:02'),
    ];
    assert.deepEqual(buildIncomingMessages({ chat: NEW_LAYOUT_CHAT, rows }).map(m => m.content), ['ответ']);
});

test('a sender label is not mistaken for a delivery status', () => {
    assert.equal(classifyMessageRow(newIncoming('A', 'hi', '10:00', { labels: ['Read Smith:'] })), 'in');
    assert.equal(classifyMessageRow({ dataId: 'X', labels: [], testids: [] }), null, 'date separators are skipped');
});

test('old layout still works: message-in rows and the number from data-id', () => {
    const rows = [
        { dataId: 'false_77001234567@c.us_AABB', legacy: 'in', content: 'Здравствуйте', prePlain: '[9:05, 06.11.2026] +7 700 123 4567: ', labels: [], testids: [] },
        { dataId: 'true_77001234567@c.us_CCDD', legacy: 'out', content: 'Добрый день', prePlain: '', labels: [], testids: [] },
    ];
    const messages = buildIncomingMessages({ chat: { id: null, phoneNumber: null, title: '+7 700 123 4567' }, rows });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].externalChatId, '77001234567@c.us');
    assert.equal(messages[0].externalMessageId, 'false_77001234567@c.us_AABB');
});

test('chat number: contact model, then message id, then a phone-looking title; never a group or a bare @lid', () => {
    assert.equal(resolveChatId(NEW_LAYOUT_CHAT), '77053802607@c.us');
    assert.equal(resolveChatId({ id: '77001234567@c.us' }), '77001234567@c.us');
    assert.equal(resolveChatId({ id: '229037821698265@lid', title: '+7 705 380 26 07' }), '77053802607@c.us');
    assert.equal(resolveChatId({ id: '229037821698265@lid', title: 'Абьюзерша' }), null);
    assert.equal(resolveChatId({ id: '120363000000000000@g.us', phoneNumber: '77001234567@c.us' }), null);
    assert.deepEqual(buildIncomingMessages({ chat: { id: '229037821698265@lid', title: 'Мама' }, rows: [newIncoming('A', 'hi', '10:00')] }), []);
});

test('pre-plain text gives the sender and the local time in RU and EN formats', () => {
    const ru = parsePrePlainText('[10:20, 07.11.2026] Maestro Online: ');
    assert.equal(ru.sender, 'Maestro Online');
    assert.equal(new Date(ru.timestamp).getTime(), new Date(2026, 10, 7, 10, 20).getTime());
    const en = parsePrePlainText('[3:05 PM, 11/23/2026] Anna: ');
    assert.equal(new Date(en.timestamp).getTime(), new Date(2026, 10, 23, 15, 5).getTime());
    assert.deepEqual(parsePrePlainText('garbage'), { sender: null, timestamp: null });
});

test('the observer reads the open chat once and does not resend already imported messages', async () => {
    let reads = 0;
    const page = {
        evaluate: async (fn, args) => {
            reads += 1;
            assert.equal(typeof fn, 'function');
            assert.match(args.rowSelector, /conv-msg-/);
            assert.match(args.rowSelector, /message-in/);
            return { chat: NEW_LAYOUT_CHAT, rows: [newIncoming('3A457C205D1CAFE52211', 'Как настроение?', '10:03'), newOutgoing('OUT', 'ok', '10:04')] };
        },
    };
    const observer = new WhatsappWebObserver(page);
    assert.equal((await observer.collectVisibleIncoming()).length, 1);
    assert.equal((await observer.collectVisibleIncoming()).length, 0);
    assert.equal(reads, 2);
});
