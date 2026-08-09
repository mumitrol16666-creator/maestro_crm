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
    let lastStatus = null;
    let degradedAlertSent = false;
    let wasConnected = false;
    let unrecognizedCycles = 0;
    let domAlertSent = false;
    let lastQrImage = null;
    let lastQrUploadAt = 0;

    const heartbeat = async (status, extra = {}) => crm.heartbeat({
        accountKey: config.accountKey,
        connector: 'playwright',
        mode: config.mode,
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
        userAgent: config.userAgent,
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
            if (status === 'qr_required' && lastStatus !== 'qr_required') {
                await crm.alert({ accountKey: config.accountKey, type: 'qr_required' }).catch(error => {
                    console.error(`[worker] QR alert failed: ${error.message}`);
                });
            }
            if (status === 'connected') {
                wasConnected = true;
                unrecognizedCycles = 0;
                domAlertSent = false;
                lastQrImage = null;
            } else if (status === 'starting' && wasConnected) {
                unrecognizedCycles += 1;
                if (unrecognizedCycles >= 3 && !domAlertSent) {
                    domAlertSent = true;
                    await crm.alert({
                        accountKey: config.accountKey,
                        type: 'dom_changed',
                        details: 'Neither chat list nor QR screen was found for three cycles',
                    }).catch(error => console.error(`[worker] DOM alert failed: ${error.message}`));
                }
            }
            lastStatus = status;
            if (status === 'connected') {
                await observer.openUnreadConversation();
                const messages = await observer.collectVisibleIncoming();
                if (messages.length) {
                    const result = await crm.importMessages(config.accountKey, messages);
                    console.log(`[worker] imported=${result.imported} skipped=${result.skipped}`);
                }
                if (config.mode === 'manual') {
                    const claimed = await crm.claimOutbox(config.accountKey);
                    if (claimed.message) {
                        const sendResult = await observer.sendApprovedText(claimed.message);
                        await crm.reportOutboxResult(claimed.message.id, sendResult);
                        console.log(`[worker] outbox=${claimed.message.id} status=${sendResult.status}`);
                    }
                }
            } else if (status === 'qr_required') {
                const imageBase64 = await observer.captureQrCode();
                const shouldUpload = imageBase64 !== lastQrImage || Date.now() - lastQrUploadAt >= 30000;
                if (shouldUpload) {
                    await crm.publishQr(config.accountKey, imageBase64);
                    lastQrImage = imageBase64;
                    lastQrUploadAt = Date.now();
                    console.log('[worker] fresh QR published to CRM');
                }
            }
            failures = 0;
            degradedAlertSent = false;
        } catch (error) {
            failures += 1;
            console.error(`[worker] cycle failed (${failures}): ${error.message}`);
            await heartbeat('degraded', { stoppedReason: error.message.slice(0, 500) }).catch(() => {});
            if (failures >= 3 && !degradedAlertSent) {
                degradedAlertSent = true;
                await crm.alert({
                    accountKey: config.accountKey,
                    type: 'degraded',
                    details: error.message.slice(0, 500),
                }).catch(alertError => console.error(`[worker] degraded alert failed: ${alertError.message}`));
            }
        }
        await sleep(Math.min(config.pollIntervalMs * Math.max(1, failures), 30000));
    }
}

main().catch(error => {
    console.error('[worker] fatal:', error.message);
    process.exitCode = 1;
});
