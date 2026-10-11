const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { parseAdminTarget, parseAdminPassword, runAdminCommand } = require('../src/services/adminAccountMaintenance');

test('administrative commands require an explicit target and a password on stdin', async () => {
    assert.equal(parseAdminTarget('create', ['8 (777) 123-45-67', '--password-stdin']), '77771234567');
    assert.equal(parseAdminTarget('reset', ['exact-user-id', '--password-stdin']), 'exact-user-id');
    assert.equal(parseAdminPassword('a-long-explicit-password\n'), 'a-long-explicit-password');
    for (const args of [[], ['77771234567'], ['77771234567', 'positional-secret'], ['77771234567', '--password-stdin', 'extra']]) {
        let loaded = false;
        await assert.rejects(runAdminCommand('create', { args, loadDb: () => { loaded = true; } }));
        assert.equal(loaded, false);
    }
    for (const password of ['', 'short', 'long-enough\nsecond-line', 'a'.repeat(73), 'я'.repeat(37), 'password-with\0zero']) {
        let loaded = false;
        await assert.rejects(runAdminCommand('create', { args: ['+77771234567', '--password-stdin'],
            readPassword: () => password, loadDb: () => { loaded = true; } }));
        assert.equal(loaded, false);
    }
    for (const phone of ['+1-555-123-1234', '+77771234567garbage', '', '+77771234567;']) {
        assert.throws(() => parseAdminTarget('create', [phone, '--password-stdin']));
    }
});

test('retired seeds and missing command inputs stop before loading a database client', () => {
    const root = path.resolve(__dirname, '..');
    for (const script of ['prisma/seed.js', 'make-admin.js', 'create-super-admin.js', 'reset-admin.js', 'scripts/qa-seed.js']) {
        const source = `const Module=require('module'), original=Module._load;
            Module._load=function(id,...args){ if (/config\\/db|@prisma\\//.test(id)) { console.error('DB_WAS_LOADED'); throw Error('DB_WAS_LOADED'); } return original.call(this,id,...args); };
            require(${JSON.stringify(path.join(root, script))});`;
        const result = spawnSync(process.execPath, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 10000,
            env: { ...process.env, NODE_ENV: 'production', MAESTRO_QA_LOCAL: 'true',
                MAESTRO_QA_DB_MARKER: 'maestro-crm-regression', DATABASE_URL: 'postgresql://localhost/maestro_crm_regression?host=remote.invalid' } });
        assert.equal(result.error, undefined, script);
        assert.notEqual(result.status, 0, script);
        assert.doesNotMatch(result.stdout + result.stderr, /DB_WAS_LOADED/, script);
    }
});

test('passwords passed as command arguments are neither accepted nor echoed', () => {
    const secret = 'must-never-appear-in-command-output';
    for (const script of ['create-super-admin.js', 'reset-admin.js']) {
        const result = spawnSync(process.execPath, [path.resolve(__dirname, '..', script), '+77771234567', secret],
            { encoding: 'utf8', timeout: 10000 });
        assert.notEqual(result.status, 0);
        assert.equal(result.error, undefined);
        assert.equal((result.stdout + result.stderr).includes(secret), false);
    }
});

test('QA seed and administrative DB tests reject driver overrides before loading Prisma', () => {
    const root = path.resolve(__dirname, '..');
    for (const [script, database] of [['scripts/qa-seed.js', 'maestro_crm_regression'],
        ['test/admin-account-maintenance.db.test.js', 'maestro_p0_test']]) {
        for (const suffix of ['?host=remote.invalid', '?%68ost=%2Ftmp%2Fother-pg']) {
            const source = `const Module=require('module'), original=Module._load;
                Module._load=function(id,...args){ if (/config\\/db|@prisma\\//.test(id)) { console.error('DB_WAS_LOADED'); throw Error('DB_WAS_LOADED'); } return original.call(this,id,...args); };
                require(${JSON.stringify(path.join(root, script))});`;
            const url = `postgresql://localhost/${database}${suffix}`;
            const result = spawnSync(process.execPath, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 10000,
                env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: url, TEST_DATABASE_URL: url,
                    MAESTRO_QA_LOCAL: 'true', MAESTRO_QA_DB_MARKER: 'maestro-crm-regression' } });
            assert.equal(result.error, undefined);
            assert.notEqual(result.status, 0);
            assert.doesNotMatch(result.stdout + result.stderr, /DB_WAS_LOADED/);
        }
    }
});
