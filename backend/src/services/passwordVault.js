const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Reversible copy of a user's password, so an admin can look it up and send it again.
// The login check still uses only the bcrypt hash in Student.password.
// The copy is AES-256-GCM encrypted with CRM_PASSWORD_VAULT_KEY (32 bytes, base64 or hex).
// Without the key nothing is stored and nothing can be shown.

const KEY_ENV = 'CRM_PASSWORD_VAULT_KEY';
const FORMAT = 'v1';
let warnedInvalidKey = false;

function vaultKey() {
    const raw = String(process.env[KEY_ENV] || '').trim();
    if (!raw) return null;
    const isHex = /^[0-9a-f]{64}$/i.test(raw);
    const isBase64 = /^[A-Za-z0-9+/]{43}=$/.test(raw);
    const key = isHex ? Buffer.from(raw, 'hex') : isBase64 ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
    if (key.length !== 32) {
        if (!warnedInvalidKey) {
            console.error(`[passwordVault] ${KEY_ENV} must be 32 bytes: 44 base64 chars ending with = or 64 hex chars; password copies are off`);
            warnedInvalidKey = true;
        }
        return null;
    }
    return key;
}

function isPasswordVaultEnabled() {
    return Boolean(vaultKey());
}

function sealPassword(plain) {
    const key = vaultKey();
    if (!key || typeof plain !== 'string' || !plain) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [FORMAT, iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

function openPassword(sealed) {
    const key = vaultKey();
    if (!key || typeof sealed !== 'string') return null;
    const [format, iv, tag, data] = sealed.split('.');
    if (format !== FORMAT || !iv || !tag || !data) return null;
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
        // Wrong or rotated key, or a damaged value.
        return null;
    }
}

// Every write of a new password goes through here, so the hash and the copy never disagree:
// when the vault is off, an older copy is cleared instead of staying stale.
async function passwordFields(plain) {
    const passwordEncrypted = sealPassword(plain);
    return {
        password: await bcrypt.hash(plain, 10),
        passwordEncrypted,
        passwordEncryptedAt: passwordEncrypted ? new Date() : null,
    };
}

// For accounts whose password nobody knows (random placeholder hashes).
const NO_PASSWORD_COPY = Object.freeze({ passwordEncrypted: null, passwordEncryptedAt: null });

module.exports = {
    KEY_ENV,
    isPasswordVaultEnabled,
    sealPassword,
    openPassword,
    passwordFields,
    NO_PASSWORD_COPY,
};
