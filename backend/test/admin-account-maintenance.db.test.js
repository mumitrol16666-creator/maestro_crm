const test = require('node:test');
const assert = require('node:assert/strict');
const { randomInt } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('administrator maintenance uses exact identity in PostgreSQL', { skip: 'TEST_DATABASE_URL required' }, () => {});
} else {
    const { inspectLocalDatabaseTarget } = require('../src/services/qaEnvironment');
    const target = inspectLocalDatabaseTarget(process.env.TEST_DATABASE_URL);
    assert.ok(target.ok && ['127.0.0.1', 'localhost'].includes(target.hostname)
        && /^maestro_[a-z0-9_]*test$/.test(target.database), 'Only an explicit local Maestro test database is allowed');
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { prisma } = require('../src/config/db');
    const bcrypt = require('bcryptjs');
    const { maintainAdminAccount } = require('../src/services/adminAccountMaintenance');
    const phone = () => `7${String(randomInt(10000000000)).padStart(10, '0')}`;
    const createUser = extra => prisma.student.create({ data: { name: 'Admin maintenance', lastName: 'Test',
        role: 'student', status: 'active', phone: phone(), password: 'old-hash', ...extra } });
    test.after(async () => prisma.$disconnect());

    test('explicit bootstrap creates only a new administrator and never promotes a phone match', async () => {
        const number = phone();
        const created = await maintainAdminAccount(prisma, 'create', number, 'new-explicit-admin-password');
        const admin = await prisma.student.findUnique({ where: { id: created.id } });
        assert.equal(admin.role, 'super_admin');
        assert.equal(admin.status, 'active');
        assert.equal(admin.phoneDigits, number);
        assert.equal(await bcrypt.compare('new-explicit-admin-password', admin.password), true);
        await assert.rejects(maintainAdminAccount(prisma, 'create', number, 'another-explicit-password'), /уже используется/);
        assert.deepEqual(await prisma.student.findUnique({ where: { id: admin.id } }), admin);

        const shared = phone();
        const people = await Promise.all([
            createUser({ phone: `8 ${shared.slice(1, 4)} ${shared.slice(4)}` }),
            createUser({ phone: '+70000000000', phoneDigits: shared, role: 'teacher' }),
        ]);
        await assert.rejects(maintainAdminAccount(prisma, 'create', shared, 'another-explicit-password'), /уже используется/);
        for (const person of people) assert.deepEqual(await prisma.student.findUnique({ where: { id: person.id } }), person);
    });

    test('reset changes only the exact active administrator password and revokes its sessions', async () => {
        const number = phone();
        const admin = await createUser({ role: 'admin', phone: number });
        const student = await createUser({ phone: number });
        await maintainAdminAccount(prisma, 'reset', admin.id, 'replacement-explicit-password');
        const updated = await prisma.student.findUnique({ where: { id: admin.id } });
        assert.equal(updated.role, 'admin');
        assert.equal(updated.status, 'active');
        assert.equal(updated.sessionVersion, admin.sessionVersion + 1);
        assert.equal(await bcrypt.compare('replacement-explicit-password', updated.password), true);
        assert.deepEqual(await prisma.student.findUnique({ where: { id: student.id } }), student);
        const inactive = await createUser({ role: 'super_admin', status: 'inactive' });
        const teacher = await createUser({ role: 'teacher' });
        for (const person of [student, inactive, teacher]) {
            await assert.rejects(maintainAdminAccount(prisma, 'reset', person.id, 'replacement-explicit-password'), /действующему администратору/);
            assert.deepEqual(await prisma.student.findUnique({ where: { id: person.id } }), person);
        }
        await assert.rejects(maintainAdminAccount(prisma, 'reset', 'missing-id', 'replacement-explicit-password'));
    });
}
