const WHATSAPP_WEB_URL = 'https://web.whatsapp.com/';

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
        if (await this.page.locator('canvas').count()) return 'qr_required';
        if (await this.page.locator('#pane-side').count()) return 'connected';
        return 'starting';
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
}

module.exports = { WHATSAPP_WEB_URL, extractChatId, inferMessageType, WhatsappWebObserver };
