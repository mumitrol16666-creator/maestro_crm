require('dotenv').config();

const failures = [];

function required(name) {
    const value = process.env[name]?.trim();
    if (!value) failures.push(`${name} is required`);
    return value || '';
}

function secureSecret(name, minimumLength = 32) {
    const value = required(name);
    if (!value) return;
    if (value.length < minimumLength) {
        failures.push(`${name} must contain at least ${minimumLength} characters`);
    }
    if (/change[-_ ]?me|replace|example|maestro_secret|super_secure/i.test(value)) {
        failures.push(`${name} still contains a placeholder value`);
    }
}

function parsedUrl(name, protocols) {
    const value = required(name);
    if (!value) return null;
    try {
        const url = new URL(value);
        if (!protocols.includes(url.protocol)) {
            failures.push(`${name} must use ${protocols.join(' or ')}`);
        }
        return url;
    } catch {
        failures.push(`${name} must be a valid URL`);
        return null;
    }
}

if (process.env.NODE_ENV !== 'production') {
    failures.push('NODE_ENV must be production');
}

parsedUrl('DATABASE_URL', ['postgresql:', 'postgres:']);
secureSecret('JWT_SECRET');
secureSecret('INTEGRATION_SERVICE_SECRET');
secureSecret('INTEGRATION_SSO_SECRET');

const frontendUrl = parsedUrl('FRONTEND_URL', ['https:']);
const learningUrl = parsedUrl('LEARNING_PLATFORM_URL', ['https:']);
const learningApiUrl = parsedUrl('LEARNING_PLATFORM_API_URL', ['http:', 'https:']);

if (frontendUrl?.pathname !== '/' && frontendUrl?.pathname !== '') {
    failures.push('FRONTEND_URL must not contain a path');
}
if (learningUrl?.pathname !== '/' && learningUrl?.pathname !== '') {
    failures.push('LEARNING_PLATFORM_URL must not contain a path');
}
if (learningApiUrl && !['127.0.0.1', 'localhost'].includes(learningApiUrl.hostname)) {
    failures.push('LEARNING_PLATFORM_API_URL must use the private loopback API');
}

const releaseSha = required('RELEASE_SHA');
if (releaseSha && !/^[0-9a-f]{40}$/i.test(releaseSha)) {
    failures.push('RELEASE_SHA must be a full 40-character Git SHA');
}

const releaseBuiltAt = required('RELEASE_BUILT_AT');
if (releaseBuiltAt && Number.isNaN(Date.parse(releaseBuiltAt))) {
    failures.push('RELEASE_BUILT_AT must be a valid ISO datetime');
}

const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
const telegramChatId = process.env.TELEGRAM_CHAT_ID?.trim();
if (Boolean(telegramToken) !== Boolean(telegramChatId)) {
    failures.push('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured together');
}

if (failures.length) {
    console.error('CRM release preflight failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log('CRM release preflight passed.');
