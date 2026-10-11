const bcrypt = require('bcryptjs');
const { normalizePhoneDigits } = require('../utils/phone');

function commandError(message) {
    return Object.assign(new Error(message), { safeForConsole: true });
}

function parseAdminTarget(mode, args) {
    if (args.length !== 2 || args[1] !== '--password-stdin') {
        throw commandError('Укажите точный телефон нового администратора или ID существующего и --password-stdin. Пароль в аргументах запрещён.');
    }
    const target = args[0];
    if (mode === 'create') {
        const phone = normalizePhoneDigits(target);
        if (!/^[+\d\s()\-]+$/.test(target) || !/^7\d{10}$/.test(phone)) throw commandError('Нужен полный номер телефона в формате +7XXXXXXXXXX.');
        return phone;
    }
    if (mode !== 'reset' || !/^[A-Za-z0-9_-]{1,128}$/.test(target)) throw commandError('Нужен точный ID администратора.');
    return target;
}

function parseAdminPassword(input) {
    const password = String(input).replace(/\r?\n$/, '');
    if (password.trim().length < 12 || Buffer.byteLength(password, 'utf8') > 72 || /[\r\n\0]/.test(password)) {
        throw commandError('Пароль должен содержать не менее 12 символов и не более 72 байт, без перевода строки.');
    }
    return password;
}

async function maintainAdminAccount(db, mode, target, password) {
    const passwordHash = await bcrypt.hash(password, 10);
    return db.$transaction(async tx => {
        if (mode === 'create') {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`admin-bootstrap:${target}`}, 0)) IS NULL AS locked`;
            const people = await tx.student.findMany({ select: { phone: true, phoneDigits: true } });
            if (people.some(p => normalizePhoneDigits(p.phone) === target || normalizePhoneDigits(p.phoneDigits) === target)) {
                throw commandError('Этот телефон уже используется. Создание не меняет пароль или роль существующих пользователей.');
            }
            return tx.student.create({ data: { phone: `+${target}`, phoneDigits: target, password: passwordHash,
                role: 'super_admin', name: 'Администратор', lastName: 'Maestro', status: 'active' }, select: { id: true } });
        }
        const user = await tx.student.findUnique({ where: { id: target }, select: { id: true, role: true, status: true, password: true } });
        if (!user || !['admin', 'super_admin'].includes(user.role) || user.status !== 'active') {
            throw commandError('Указанный ID не принадлежит действующему администратору. Роль и статус не менялись.');
        }
        return tx.student.update({ where: { id: user.id, role: user.role, status: user.status, password: user.password },
            data: { password: passwordHash }, select: { id: true } });
    });
}

async function runAdminCommand(mode, { args = process.argv.slice(2), readPassword, loadDb } = {}) {
    const target = parseAdminTarget(mode, args);
    const password = parseAdminPassword((readPassword || (() => require('fs').readFileSync(0, 'utf8')))());
    // Invalid/missing explicit inputs must not even load a database client.
    require('dotenv').config();
    const db = (loadDb || (() => require('../config/db').prisma))();
    try { return await maintainAdminAccount(db, mode, target, password); }
    finally { await db.$disconnect(); }
}

function reportCommandError(error) {
    console.error(error.safeForConsole ? error.message : 'Операция не выполнена. Проверьте подключение и состояние базы; данные доступа не выводятся.');
    process.exitCode = 1;
}

module.exports = { parseAdminTarget, parseAdminPassword, maintainAdminAccount, runAdminCommand, reportCommandError };
