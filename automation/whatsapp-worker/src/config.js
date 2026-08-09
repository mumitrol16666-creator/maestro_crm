const path = require('path');
require('dotenv').config();

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function requireValue(name) {
    const value = String(process.env[name] || '').trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function loadConfig() {
    const pollIntervalMs = Number(process.env.WHATSAPP_BROWSER_POLL_INTERVAL_MS || 5000);
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 2000 || pollIntervalMs > 60000) {
        throw new Error('WHATSAPP_BROWSER_POLL_INTERVAL_MS must be between 2000 and 60000');
    }

    const mode = String(process.env.WHATSAPP_BROWSER_MODE || 'observer').trim();
    if (!['observer', 'manual'].includes(mode)) {
        throw new Error('WHATSAPP_BROWSER_MODE must be observer or manual');
    }

    return {
        crmUrl: requireValue('WHATSAPP_BROWSER_CRM_URL').replace(/\/$/, ''),
        secret: requireValue('WHATSAPP_BROWSER_WORKER_SECRET'),
        accountKey: requireValue('WHATSAPP_BROWSER_ACCOUNT_KEY'),
        workerId: requireValue('WHATSAPP_BROWSER_WORKER_ID'),
        sessionPath: path.resolve(process.cwd(), process.env.WHATSAPP_SESSION_PATH || '../../sessions/whatsapp'),
        headless: parseBoolean(process.env.WHATSAPP_BROWSER_HEADLESS, false),
        openUnreadChats: parseBoolean(process.env.WHATSAPP_BROWSER_OPEN_UNREAD_CHATS, false),
        mode,
        pollIntervalMs,
    };
}

module.exports = { parseBoolean, loadConfig };
