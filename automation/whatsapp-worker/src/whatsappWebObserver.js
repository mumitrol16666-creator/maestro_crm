const WHATSAPP_WEB_URL = 'https://web.whatsapp.com/';
const CONNECTED_SELECTORS = [
    '#pane-side',
    '#side [role="grid"]',
    '[data-testid="chat-list"]',
    '[aria-label="Chat list"]',
    '[aria-label="Список чатов"]',
];

const COMPOSE_SELECTOR = 'footer [contenteditable="true"][role="textbox"], footer [contenteditable="true"]';
// Строки переписки: новая вёрстка WhatsApp Web (conv-msg-*) и старая (message-out).
const MESSAGE_ROW_SELECTOR = '#main [data-testid^="conv-msg-"], div.message-out';
// Для входящих читаем все строки чата (внутри #main) и разбираем их в buildIncomingMessages.
const INCOMING_ROW_SELECTOR = '[data-testid^="conv-msg-"], div.message-in, div.message-out, [data-id][class*="message-in"]';
// Галочка сервера: «Отправлено», «Доставлено» или «Прочитано». Часы «Ожидание» не считаются.
const DELIVERY_LABEL = /отправлено|доставлено|прочитано|\bsent\b|delivered|\bread\b/i;
const INVALID_PHONE_TEXT = /invalid|недействител|не зарегистрирован|isn.t on whatsapp|not on whatsapp|нет в whatsapp/i;

// WhatsApp рисует *жирный* без звёздочек, эмодзи картинками, а переносы по-своему:
// сравниваем только буквы и цифры.
function plainText(value) {
    return String(value || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

function extractChatId(messageId) {
    const match = String(messageId || '').match(/(\d{7,15}@(c\.us|s\.whatsapp\.net))/i);
    return match?.[1] || null;
}

// Номер чата: из модели контакта (WhatsApp теперь адресует чаты скрытым @lid, а номер
// лежит в contact.phoneNumber), из старого data-id или из заголовка, если там номер, а не имя.
function resolveChatId(chat = {}, rows = []) {
    const id = String(chat.id || '');
    if (/@g\.us$|status@broadcast|@newsletter$/i.test(id)) return null;
    const fromModel = extractChatId(chat.phoneNumber) || extractChatId(id);
    if (fromModel) return fromModel;
    for (const row of rows) {
        const fromRow = extractChatId(row.dataId) || extractChatId(row.fiberId);
        if (fromRow) return fromRow;
    }
    const title = String(chat.title || '').trim();
    if (/^\+?[\d\s()-]{7,22}$/.test(title)) {
        const digits = title.replace(/\D/g, '');
        if (digits.length >= 7 && digits.length <= 15) return `${digits}@c.us`;
    }
    return null;
}

const SELF_LABEL = /^(вы|you|сіз):?$/i;
const PENDING_LABEL = /ожидание|pending|\bsending\b/i;

// «[10:20, 07.11.2026] Имя: » → { sender: 'Имя', timestamp }
function parsePrePlainText(value) {
    const match = String(value || '').match(/^\[(\d{1,2}):(\d{2})(?:\s*([AP]M))?,\s*(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})\]\s*(.*?):\s*$/i);
    if (!match) return { sender: null, timestamp: null };
    let [, hours, minutes, ampm, a, month, c, sender] = match;
    hours = Number(hours);
    if (ampm) hours = (hours % 12) + (/pm/i.test(ampm) ? 12 : 0);
    // День.месяц.год (RU) или месяц/день/год (EN) — WhatsApp пишет в формате языка интерфейса.
    let day = Number(a); let mon = Number(month); let year = Number(c);
    if (a.length === 4) { year = Number(a); day = Number(c); }
    else if (ampm) { day = Number(month); mon = Number(a); }
    if (year < 100) year += 2000;
    const date = new Date(year, mon - 1, day, hours, Number(minutes));
    const valid = !Number.isNaN(date.getTime()) && date.getMonth() === mon - 1;
    return { sender: sender.trim() || null, timestamp: valid ? date.toISOString() : null };
}

// Строка переписки → 'in', 'out' или null (служебная строка без сообщения).
function classifyMessageRow(row, selfNames = new Set()) {
    if (row.fromMe === true) return 'out';
    if (row.fromMe === false) return 'in';
    if (row.legacy === 'in' || row.legacy === 'out') return row.legacy;
    if (/^true_/.test(row.dataId || '')) return 'out';
    if (/^false_/.test(row.dataId || '')) return 'in';
    const labels = (row.labels || []).map(label => String(label || '').trim()).filter(Boolean);
    const testids = row.testids || [];
    if (labels.some(label => SELF_LABEL.test(label))) return 'out';
    // Подпись отправителя заканчивается двоеточием; статус доставки — без него.
    if (labels.some(label => !label.endsWith(':') && (DELIVERY_LABEL.test(label) || PENDING_LABEL.test(label)))) return 'out';
    if (testids.some(id => /^(tail-out|msg-check|msg-dblcheck|msg-time|msg-status)$/.test(id))) return 'out';
    const { sender } = parsePrePlainText(row.prePlain);
    if (sender && selfNames.has(sender)) return 'out';
    if (testids.includes('tail-in')) return 'in';
    if (row.prePlain || testids.includes('msg-meta')) return 'in';
    return null;
}

// Снимок открытого чата → сообщения для CRM. Без номера чата ничего не импортируем:
// CRM связывает переписку с учеником по номеру.
function buildIncomingMessages(snapshot, seenIds = new Set()) {
    const rows = snapshot?.rows || [];
    if (!rows.length) return [];
    const externalChatId = resolveChatId(snapshot.chat || {}, rows);
    if (!externalChatId) return [];
    const selfNames = new Set();
    for (const row of rows) {
        const own = row.fromMe === true || row.legacy === 'out'
            || (row.labels || []).some(label => SELF_LABEL.test(String(label || '').trim()));
        const { sender } = parsePrePlainText(row.prePlain);
        if (own && sender) selfNames.add(sender);
    }
    const imported = [];
    for (const row of rows) {
        if (!row.dataId || classifyMessageRow(row, selfNames) !== 'in') continue;
        // Новый data-id без префикса и номера: собираем id в прежнем виде, чтобы он был уникален по CRM.
        const externalMessageId = /^(true|false)_/.test(row.dataId)
            ? row.dataId
            : `false_${externalChatId}_${row.dataId}`;
        if (seenIds.has(externalMessageId)) continue;
        seenIds.add(externalMessageId);
        const { sender, timestamp } = parsePrePlainText(row.prePlain);
        const content = String(row.content || '').trim();
        imported.push({
            externalChatId,
            externalMessageId,
            phoneNumber: externalChatId,
            displayName: snapshot.chat?.title || sender || null,
            content,
            messageType: content ? 'text' : 'unknown',
            timestamp: timestamp || new Date().toISOString(),
            rawPayload: { domMetadata: row.prePlain || null },
        });
    }
    return imported;
}

function inferMessageType(element) {
    if (element.querySelector('img')) return 'image';
    if (element.querySelector('audio, [data-icon="audio-play"]')) return 'audio';
    if (element.querySelector('video')) return 'video';
    if (element.querySelector('[data-icon="document"]')) return 'document';
    return 'text';
}

class WhatsappWebObserver {
    constructor(page, { openUnreadChats = false } = {}) {
        this.page = page;
        this.openUnreadChats = openUnreadChats;
        this.seenIds = new Set();
    }

    async open() {
        await this.page.goto(WHATSAPP_WEB_URL, { waitUntil: 'domcontentloaded' });
    }

    async getStatus() {
        if (await this.page.locator(CONNECTED_SELECTORS.join(', ')).count()) return 'connected';
        if (await this.page.locator('canvas, [data-ref] canvas').count()) return 'qr_required';
        return 'starting';
    }

    async captureQrCode() {
        const reload = this.page.getByText(
            /select to reload qr code|click to reload qr code|нажмите.*обнов.*qr|обновить qr[- ]?код/i,
        ).first();
        if (await reload.isVisible().catch(() => false)) {
            await reload.click();
            await this.page.waitForTimeout(900);
        }

        let lastError;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                const canvas = this.page.locator('canvas').first();
                await canvas.waitFor({ state: 'visible', timeout: 3000 });
                const image = await canvas.screenshot({ type: 'png' });
                return image.toString('base64');
            } catch (error) {
                lastError = error;
                await this.page.waitForTimeout(300);
            }
        }
        throw lastError || new Error('QR canvas was not found');
    }

    async openUnreadConversation() {
        if (!this.openUnreadChats) return false;
        const unread = this.page.locator([
            '#pane-side [aria-label*="непрочитан" i]',
            '#pane-side [aria-label*="unread" i]',
            '#pane-side [data-icon="unread-count"]',
        ].join(', ')).first();
        if (!await unread.count()) return false;
        const row = unread.locator('xpath=ancestor::*[@role="listitem" or @role="row"][1]');
        if (!await row.count()) return false;
        await row.click();
        await this.page.waitForTimeout(700);
        return true;
    }

    // Читает открытый чат одним проходом по странице: строки переписки (новая вёрстка conv-msg-*
    // и старая message-in/out) и сведения о чате из заголовка. Ничего не нажимает.
    async readOpenConversation() {
        return this.page.evaluate(({ rowSelector }) => {
            const main = document.querySelector('#main');
            if (!main) return { chat: null, rows: [] };
            const fiberOf = el => {
                const key = el && Object.keys(el).find(name => name.startsWith('__reactFiber'));
                return key ? el[key] : null;
            };
            const wid = value => {
                try {
                    if (!value) return null;
                    if (typeof value === 'string') return value;
                    const text = value._serialized || String(value);
                    return text && text !== '[object Object]' ? text : null;
                } catch { return null; }
            };
            const findProp = (el, name, maxDepth) => {
                let fiber = fiberOf(el);
                for (let depth = 0; fiber && depth < maxDepth; depth += 1) {
                    const value = fiber.memoizedProps?.[name];
                    if (value) return value;
                    fiber = fiber.return;
                }
                return null;
            };

            const header = main.querySelector('header');
            const title = (main.querySelector('[data-testid="conversation-info-header-chat-title"]')?.innerText
                || header?.querySelector('span[title]')?.getAttribute('title')
                || '').trim() || null;
            let id = null;
            let phoneNumber = null;
            try {
                const chat = header && findProp(header, 'chat', 25);
                id = wid(chat?.id || chat?.__x_id);
                const contact = chat?.contact || chat?.__x_contact;
                phoneNumber = wid(contact?.phoneNumber || contact?.__x_phoneNumber);
            } catch { /* внутренности WhatsApp могут поменяться: тогда номер ищем по строкам и заголовку */ }

            const nodes = [...main.querySelectorAll(rowSelector)];
            const unique = [...new Set(nodes.map(node => node.closest('[data-testid^="conv-msg-"]') || node.closest('[data-id]') || node))];
            const rows = unique.slice(-50).map(element => {
                const holder = element.matches('[data-id]') ? element : element.querySelector('[data-id]');
                const legacyNode = element.closest('.message-in, .message-out') || element.querySelector('.message-in, .message-out');
                let fromMe = null;
                let fiberId = null;
                try {
                    const msg = findProp(element, 'msg', 12);
                    if (msg) {
                        const msgId = msg.id || msg.__x_id;
                        if (typeof msgId?.fromMe === 'boolean') fromMe = msgId.fromMe;
                        fiberId = wid(msgId);
                    }
                } catch { /* без React-данных решают признаки вёрстки */ }
                const textElement = element.querySelector('[data-testid="selectable-text"], .selectable-text, [dir="ltr"]');
                return {
                    dataId: holder?.getAttribute('data-id') || '',
                    legacy: legacyNode ? (legacyNode.classList.contains('message-in') ? 'in' : 'out') : null,
                    fromMe,
                    fiberId,
                    content: (textElement?.innerText || '').trim(),
                    prePlain: element.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || '',
                    labels: [...element.querySelectorAll('[aria-label]')].map(node => node.getAttribute('aria-label')).slice(0, 8),
                    testids: [...new Set([...element.querySelectorAll('[data-testid]')].map(node => node.getAttribute('data-testid')))].slice(0, 20),
                };
            });
            return { chat: { id, phoneNumber, title }, rows };
        }, { rowSelector: INCOMING_ROW_SELECTOR });
    }

    async collectVisibleIncoming() {
        const snapshot = await this.readOpenConversation();
        const imported = buildIncomingMessages(snapshot, this.seenIds);
        if (this.seenIds.size > 5000) this.seenIds = new Set([...this.seenIds].slice(-2500));
        return imported;
    }

    async sendApprovedText({ phoneNumber, content }) {
        const digits = String(phoneNumber || '').replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) throw new Error('Invalid destination phone');
        let pressedEnter = false;
        try {
            await this.page.goto(`${WHATSAPP_WEB_URL}send?phone=${digits}&text=${encodeURIComponent(content)}`, {
                waitUntil: 'domcontentloaded',
            });
            const compose = this.page.locator('footer [contenteditable="true"][role="textbox"], footer [contenteditable="true"]').last();
            await compose.waitFor({ state: 'visible', timeout: 20000 });
            await compose.press('Enter');
            pressedEnter = true;
            await this.page.waitForTimeout(1200);
            const outgoing = this.page.locator('div.message-out [data-id], [data-id][class*="message-out"]').last();
            const externalMessageId = await outgoing.getAttribute('data-id').catch(() => null);
            return externalMessageId
                ? { status: 'sent', externalMessageId }
                : { status: 'uncertain', error: 'Enter pressed but outgoing message id was not found' };
        } catch (error) {
            return {
                status: pressedEnter ? 'uncertain' : 'failed',
                error: error.message.slice(0, 1000),
            };
        }
    }

    // Рассылка: открыть чат по номеру с уже вставленным текстом, отправить,
    // убедиться, что в чате появилось наше сообщение с галочкой, вернуться к списку чатов.
    async sendBroadcastText({ phoneNumber, content }, { timeoutMs = 45000, confirmMs = 15000 } = {}) {
        const digits = String(phoneNumber || '').replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) return { status: 'invalid', error: 'Некорректный номер' };
        let pressedEnter = false;
        try {
            await this.page.goto(`${WHATSAPP_WEB_URL}send?phone=${digits}&text=${encodeURIComponent(content)}`, {
                waitUntil: 'domcontentloaded',
            });
            const compose = this.page.locator(COMPOSE_SELECTOR).last();
            const invalid = this.page.locator('[role="dialog"], [data-animate-modal-popup="true"]')
                .filter({ hasText: INVALID_PHONE_TEXT }).first();
            const opened = await Promise.race([
                compose.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => 'chat'),
                invalid.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => 'invalid'),
            ]);
            if (opened === 'invalid') return { status: 'invalid', error: 'Номера нет в WhatsApp' };

            const expected = plainText(content).slice(0, 40);
            const drafted = plainText(await compose.innerText().catch(() => ''));
            if (!drafted || !expected.startsWith(drafted.slice(0, 20))) {
                return { status: 'failed', error: 'Текст не вставился в поле сообщения' };
            }

            const rows = this.page.locator(MESSAGE_ROW_SELECTOR);
            const readRows = () => rows.evaluateAll(nodes => nodes.slice(-8).map(node => ({
                id: node.getAttribute('data-id') || node.closest('[data-id]')?.getAttribute('data-id') || '',
                text: node.innerText || '',
                labels: [...node.querySelectorAll('[aria-label]')].map(item => item.getAttribute('aria-label')).join(' '),
            })));
            const before = new Set((await readRows().catch(() => [])).map(row => row.id));
            await compose.press('Enter');
            pressedEnter = true;
            // Отправлено, когда в чате появилась новая строка с нашим текстом и у неё есть галочка сервера.
            const deadline = Date.now() + confirmMs;
            let appeared = null;
            while (Date.now() < deadline) {
                await this.page.waitForTimeout(700);
                const current = await readRows().catch(() => []);
                appeared = current.find(row => !before.has(row.id) && plainText(row.text).includes(expected.slice(0, 30))) || appeared;
                if (appeared && DELIVERY_LABEL.test(current.find(row => row.id === appeared.id)?.labels || '')) {
                    return { status: 'sent', externalMessageId: appeared.id || null };
                }
            }
            if (appeared) {
                return { status: 'uncertain', error: 'Сообщение в чате, но WhatsApp не подтвердил отправку (часы вместо галочки)' };
            }
            return { status: 'uncertain', error: 'Enter нажат, но сообщение не появилось в чате' };
        } catch (error) {
            return {
                status: pressedEnter ? 'uncertain' : 'failed',
                error: String(error.message || error).slice(0, 1000),
            };
        } finally {
            await this.page.goto(WHATSAPP_WEB_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
        }
    }
}

module.exports = {
    WHATSAPP_WEB_URL,
    CONNECTED_SELECTORS,
    buildIncomingMessages,
    classifyMessageRow,
    extractChatId,
    inferMessageType,
    parsePrePlainText,
    plainText,
    resolveChatId,
    WhatsappWebObserver,
};
