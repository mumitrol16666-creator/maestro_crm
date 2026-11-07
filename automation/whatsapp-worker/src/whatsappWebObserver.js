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

    async collectVisibleIncoming() {
        const messages = await this.page.locator('div.message-in, [data-id][class*="message-in"]').evaluateAll((nodes) => {
            const uniqueNodes = [...new Set(nodes.map(node => node.closest('[data-id]') || node))];
            return uniqueNodes.slice(-50).map((element) => {
                const messageId = element.getAttribute('data-id')
                    || element.querySelector('[data-id]')?.getAttribute('data-id')
                    || '';
                const textElement = element.querySelector('.selectable-text, [dir="ltr"]');
                const content = (textElement?.innerText || element.innerText || '').trim();
                const metadata = element.getAttribute('data-pre-plain-text')
                    || element.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text')
                    || '';
                return { messageId, content, metadata };
            });
        });

        if (!messages.length) return [];
        // Без открытого чата заголовка нет: не ждать его 30 секунд по умолчанию, иначе круг воркера
        // растягивается и CRM видит его «не на связи».
        const displayName = await this.page.locator('header span[title]').first()
            .getAttribute('title', { timeout: 1000 }).catch(() => null);
        const imported = [];
        for (const item of messages) {
            const externalChatId = extractChatId(item.messageId);
            if (!externalChatId || !item.messageId || this.seenIds.has(item.messageId)) continue;
            this.seenIds.add(item.messageId);
            imported.push({
                externalChatId,
                externalMessageId: item.messageId,
                phoneNumber: externalChatId,
                displayName,
                content: item.content,
                messageType: item.content ? 'text' : 'unknown',
                timestamp: new Date().toISOString(),
                rawPayload: { domMetadata: item.metadata || null },
            });
        }
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

module.exports = { WHATSAPP_WEB_URL, CONNECTED_SELECTORS, extractChatId, inferMessageType, plainText, WhatsappWebObserver };
