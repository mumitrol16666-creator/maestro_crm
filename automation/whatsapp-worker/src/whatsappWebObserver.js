const WHATSAPP_WEB_URL = 'https://web.whatsapp.com/';
const CONNECTED_SELECTORS = [
    '#pane-side',
    '#side [role="grid"]',
    '[data-testid="chat-list"]',
    '[aria-label="Chat list"]',
    '[aria-label="Список чатов"]',
];

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

        const displayName = await this.page.locator('header span[title]').first()
            .getAttribute('title').catch(() => null);
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
}

module.exports = { WHATSAPP_WEB_URL, CONNECTED_SELECTORS, extractChatId, inferMessageType, WhatsappWebObserver };
