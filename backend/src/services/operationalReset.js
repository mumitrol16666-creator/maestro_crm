const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { prisma } = require('../config/db');

const execFileAsync = promisify(execFile);
const CONFIRMATION_PHRASE = 'ОЧИСТИТЬ MAESTRO';
let resetInProgress = false;

async function getOperationalResetPreview() {
    const [
        users,
        activeStudents,
        bookings,
        groups,
        memberships,
        payments,
        cashTransactions,
        salaries,
        classes,
        studentSchedules,
        groupSchedules,
        studentGroups,
        freezes,
        membershipTransactions,
        studentsWithBalance,
        balance,
    ] = await Promise.all([
        prisma.student.count(),
        prisma.student.count({ where: { role: 'student', status: 'active' } }),
        prisma.booking.count(),
        prisma.group.count(),
        prisma.membership.count(),
        prisma.payment.count(),
        prisma.cashTransaction.count(),
        prisma.salary.count(),
        prisma.class.count(),
        prisma.studentSchedule.count(),
        prisma.groupSchedule.count(),
        prisma.studentGroup.count(),
        prisma.freeze.count(),
        prisma.membershipTransaction.count(),
        prisma.student.count({ where: { role: 'student', accountBalance: { not: 0 } } }),
        prisma.student.aggregate({
            where: { role: 'student' },
            _sum: { accountBalance: true },
        }),
    ]);

    return {
        preserved: { users, activeStudents, bookings },
        deleted: {
            groups,
            memberships,
            payments,
            cashTransactions,
            salaries,
            classes,
            studentSchedules,
            groupSchedules,
            studentGroups,
            freezes,
            membershipTransactions,
        },
        reset: {
            studentsWithBalance,
            totalStudentBalance: balance._sum.accountBalance || 0,
        },
    };
}

async function createDatabaseBackup() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL не задан');
    }

    const databaseResult = await prisma.$queryRaw`SELECT current_database() AS name`;
    const actualDatabase = databaseResult[0]?.name;
    const expectedDatabase = process.env.EXPECTED_DATABASE || 'maestro_crm';

    if (actualDatabase !== expectedDatabase) {
        throw new Error(`Подключена база "${actualDatabase}", ожидалась "${expectedDatabase}"`);
    }

    const backupDir = process.env.BACKUP_DIR || '/var/backups/maestro-crm';
    await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
    await fs.chmod(backupDir, 0o700);

    const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const backupFile = path.join(backupDir, `maestro_crm_before_operational_reset_${timestamp}.dump`);
    const databaseUrl = process.env.DATABASE_URL.split('?')[0];

    await execFileAsync('pg_dump', [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        `--file=${backupFile}`,
        databaseUrl,
    ], {
        timeout: 10 * 60 * 1000,
        maxBuffer: 1024 * 1024,
    });

    const stat = await fs.stat(backupFile);
    if (!stat.isFile() || stat.size === 0) {
        throw new Error('Резервная копия не создана или пуста');
    }

    await fs.chmod(backupFile, 0o600);
    return { backupFile, backupSize: stat.size };
}

async function resetOperationalData() {
    if (resetInProgress) {
        const error = new Error('Очистка уже выполняется');
        error.code = 'RESET_IN_PROGRESS';
        throw error;
    }

    resetInProgress = true;
    try {
        const before = await getOperationalResetPreview();
        const backup = await createDatabaseBackup();

        const deleted = await prisma.$transaction(async (tx) => {
            await tx.student.updateMany({
                where: { role: 'student' },
                data: {
                    activeMembershipId: null,
                    assignedTeacherId: null,
                    accountBalance: 0,
                    accountBalanceInitializedAt: null,
                    penaltyPoints: 0,
                },
            });
            await tx.booking.updateMany({
                where: { groupId: { not: null } },
                data: { groupId: null },
            });

            const results = {};
            results.cashTransactions = (await tx.cashTransaction.deleteMany()).count;
            results.payments = (await tx.payment.deleteMany()).count;
            results.salaries = (await tx.salary.deleteMany()).count;
            results.membershipTransactions = (await tx.membershipTransaction.deleteMany()).count;
            results.freezes = (await tx.freeze.deleteMany()).count;
            results.memberships = (await tx.membership.deleteMany()).count;
            results.classes = (await tx.class.deleteMany()).count;
            results.studentSchedules = (await tx.studentSchedule.deleteMany()).count;
            results.groupSchedules = (await tx.groupSchedule.deleteMany()).count;
            results.studentGroups = (await tx.studentGroup.deleteMany()).count;
            results.groups = (await tx.group.deleteMany()).count;
            return results;
        }, {
            maxWait: 10000,
            timeout: 120000,
        });

        return { before, deleted, ...backup };
    } finally {
        resetInProgress = false;
    }
}

module.exports = {
    CONFIRMATION_PHRASE,
    getOperationalResetPreview,
    resetOperationalData,
};
