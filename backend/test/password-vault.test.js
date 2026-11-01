const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const vault = require('../src/services/passwordVault');

function withKey(value, fn) {
    const previous = process.env.CRM_PASSWORD_VAULT_KEY;
    if (value === undefined) delete process.env.CRM_PASSWORD_VAULT_KEY;
    else process.env.CRM_PASSWORD_VAULT_KEY = value;
    const restore = () => {
        if (previous === undefined) delete process.env.CRM_PASSWORD_VAULT_KEY;
        else process.env.CRM_PASSWORD_VAULT_KEY = previous;
    };
    let result;
    try { result = fn(); } catch (error) { restore(); throw error; }
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
}

test('sealed password opens with the same key in base64 or hex, and the ciphertext differs each time', () => {
    const raw = crypto.randomBytes(32);
    for (const key of [raw.toString('base64'), raw.toString('hex')]) {
        withKey(key, () => {
            const a = vault.sealPassword('Пароль-123');
            const b = vault.sealPassword('Пароль-123');
            assert.notEqual(a, b);
            assert.ok(!a.includes('Пароль'));
            assert.equal(vault.openPassword(a), 'Пароль-123');
            assert.equal(vault.openPassword(b), 'Пароль-123');
        });
    }
});

test('a different key, a damaged value or no key never reveals anything', () => {
    const sealed = withKey(crypto.randomBytes(32).toString('base64'), () => vault.sealPassword('secret-pass'));
    withKey(crypto.randomBytes(32).toString('base64'), () => assert.equal(vault.openPassword(sealed), null));
    withKey(undefined, () => assert.equal(vault.openPassword(sealed), null));
    withKey(crypto.randomBytes(32).toString('base64'), () => {
        const own = vault.sealPassword('secret-pass');
        const parts = own.split('.');
        parts[3] = Buffer.from('tampered').toString('base64');
        assert.equal(vault.openPassword(parts.join('.')), null);
        assert.equal(vault.openPassword('garbage'), null);
    });
});

test('a short key disables the vault instead of storing a weak copy', () => {
    withKey(crypto.randomBytes(16).toString('base64'), () => {
        assert.equal(vault.isPasswordVaultEnabled(), false);
        assert.equal(vault.sealPassword('secret-pass'), null);
    });
});

test('passwordFields always writes the hash and either a fresh copy or an explicit null', async () => {
    await withKey(crypto.randomBytes(32).toString('base64'), async () => {
        const fields = await vault.passwordFields('first-pass');
        assert.equal(await bcrypt.compare('first-pass', fields.password), true);
        assert.equal(vault.openPassword(fields.passwordEncrypted), 'first-pass');
        assert.ok(fields.passwordEncryptedAt instanceof Date);
    });
    await withKey(undefined, async () => {
        const fields = await vault.passwordFields('second-pass');
        assert.equal(await bcrypt.compare('second-pass', fields.password), true);
        assert.ok(Object.hasOwn(fields, 'passwordEncrypted'));
        assert.equal(fields.passwordEncrypted, null);
        assert.equal(fields.passwordEncryptedAt, null);
    });
});
