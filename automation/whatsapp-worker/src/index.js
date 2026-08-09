const { chromium } = require('playwright');
const { loadConfig } = require('./config');
const { CrmClient } = require('./crmClient');
const { WhatsappWebObserver } = require('./whatsappWebObserver');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const config = loadConfig();
    const crm = new CrmClient(config);
    let context;
    let shuttingDown = false;

    const heartbeat = async (status, extra = {}) => crm.heartbeat({
        accountKey: config.accountKey,
        connector: 'playwright',
        mode: 'observer',
        status,
        metadata: {
            openUnreadChats: config.openUnreadChats,
            headless: config.headless,
            ...extra.metadata,
        },
        ...extra,
    });

    const shutdown = async signal => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`[worker] stopping (${signal})`);
        await heartbeat('stopped', { stoppedReason: signal }).catch(() => {});
        await context?.close().catch(() => {});
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    await heartbeat('starting');
    context = await chromium.launchPersistentContext(config.sessionPath, {
        headless: config.headless,
        viewport: { width: 1440, height: 1000 },
        args: ['--disable-dev-shm-usage'],
    });
    const page = context.pages()[0] || await context.newPage();
    const observer = new WhatsappWebObserver(page, { openUnreadChats: config.openUnreadChats });
    await observer.open();

    if (config.openUnreadChats) {
        console.warn('[worker] OPEN_UNREAD_CHATS=true: WhatsApp may mark scanned chats as read');
    }
    console.log(`[worker] observer started; profile=${config.sessionPath}`);

    let failures = 0;
    while (!shuttingDown) {
        try {
            const status = await observer.getStatus();
            await heartbeat(status);
            if (status === 'connected') {
                await observer.openUnreadConversation();
                const messages = await observer.collectVisibleIncoming();
                if (messages.length) {
                    const result = await crm.importMessages(config.accountKey, messages);
                    console.log(`[worker] imported=${result.imported} skipped=${result.skipped}`);
                }
            } else if (status === 'qr_required') {
                console.log('[worker] scan the QR code in the opened browser window');
            }
            failures = 0;
        } catch (error) {
            failures += 1;
            console.error(`[worker] cycle failed (${failures}): ${error.message}`);
            await heartbeat('degraded', { stoppedReason: error.message.slice(0, 500) }).catch(() => {});
        }
        await sleep(Math.min(config.pollIntervalMs * Math.max(1, failures), 30000));
    }
}

main().catch(error => {
    console.error('[worker] fatal:', error.message);
    process.exitCode = 1;
});
