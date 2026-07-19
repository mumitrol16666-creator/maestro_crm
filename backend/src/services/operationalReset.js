const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { prisma } = require('../config/db');

const execFileAsync = promisify(execFile);
const CONFIRMATION_PHRASE = 'ОЧИСТИТЬ MAESTRO';
let resetInProgress = false;

function isMissingTableError(error) {
    return error.code === '42P01' || error.meta?.code === '42P01';
}

async function countTable(db, tableName) {
    try {
        const rows = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${tableName}"`);
        return Number(rows?.[0]?.count || 0);
    } catch (error) {
        if (isMissingTableError(error)) return 0;
        throw error;
    }
}

async function deleteTable(db, tableName) {
    try {
        const rows = await db.$queryRawUnsafe(`DELETE FROM "${tableName}" RETURNING 1`);
        return Array.isArray(rows) ? rows.length : 0;
    } catch (error) {
        if (isMissingTableError(error)) return 0;
        throw error;
    }
}

async function getOperationalResetPreview() {
    const [
        preservedUsers,
        students,
        bookings,
        families,
        groups,
        memberships,
        payments,
        cashTransactions,
        salaries,
        salaryOperations,
        classes,
        studentSchedules,
        groupSchedules,
        studentGroups,
        freezes,
        membershipTransactions,
        activityLogs,
        integrationLogs,
        idempotencyKeys,
        conversations,
        conversationMessages,
        studentRecoveries,
        shopProducts,
        shopSales,
        shopSaleItems,
        shopStockMovements,
        studentsWithBalance,
        balance,
    ] = await Promise.all([
        prisma.student.count({ where: { role: { not: 'student' } } }),
        prisma.student.count({ where: { role: 'student' } }),
        prisma.booking.count(),
        prisma.family.count(),
        prisma.group.count(),
        prisma.membership.count(),
        prisma.payment.count(),
        prisma.cashTransaction.count(),
        prisma.salary.count(),
        countTable(prisma, 'SalaryOperation'),
        prisma.class.count(),
        prisma.studentSchedule.count(),
        prisma.groupSchedule.count(),
        prisma.studentGroup.count(),
        prisma.freeze.count(),
        prisma.membershipTransaction.count(),
        prisma.activityLog.count(),
        prisma.integrationLog.count(),
        prisma.idempotencyKey.count(),
        prisma.conversation.count(),
        prisma.conversationMessage.count(),
        prisma.studentRecovery.count(),
        countTable(prisma, 'ShopProduct'),
        countTable(prisma, 'ShopSale'),
        countTable(prisma, 'ShopSaleItem'),
        countTable(prisma, 'ShopStockMovement'),
        prisma.student.count({ where: { role: 'student', accountBalance: { not: 0 } } }),
        prisma.student.aggregate({
            where: { role: 'student' },
            _sum: { accountBalance: true },
        }),
    ]);

    return {
        preserved: { users: preservedUsers },
        deleted: {
            students,
            bookings,
            families,
            groups,
            memberships,
            payments,
            cashTransactions,
            salaries,
            salaryOperations,
            classes,
            studentSchedules,
            groupSchedules,
            studentGroups,
            freezes,
            membershipTransactions,
            activityLogs,
            integrationLogs,
            idempotencyKeys,
            conversations,
            conversationMessages,
            studentRecoveries,
            shopProducts,
            shopSales,
            shopSaleItems,
            shopStockMovements,
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
            const results = {};
            results.conversationMessages = (await tx.conversationMessage.deleteMany()).count;
            results.conversations = (await tx.conversation.deleteMany()).count;
            results.activityLogs = (await tx.activityLog.deleteMany()).count;
            results.integrationLogs = (await tx.integrationLog.deleteMany()).count;
            results.idempotencyKeys = (await tx.idempotencyKey.deleteMany()).count;
            results.studentRecoveries = (await tx.studentRecovery.deleteMany()).count;
            results.salaryOperations = await deleteTable(tx, 'SalaryOperation');
            results.cashTransactions = (await tx.cashTransaction.deleteMany()).count;
            results.shopStockMovements = await deleteTable(tx, 'ShopStockMovement');
            results.shopSaleItems = await deleteTable(tx, 'ShopSaleItem');
            results.shopSales = await deleteTable(tx, 'ShopSale');
            results.shopProducts = await deleteTable(tx, 'ShopProduct');
            results.payments = (await tx.payment.deleteMany()).count;
            results.salaries = (await tx.salary.deleteMany()).count;
            results.membershipTransactions = (await tx.membershipTransaction.deleteMany()).count;
            results.freezes = (await tx.freeze.deleteMany()).count;
            results.classes = (await tx.class.deleteMany()).count;
            await tx.membership.updateMany({
                where: { previousMembershipId: { not: null } },
                data: { previousMembershipId: null },
            });
            results.memberships = (await tx.membership.deleteMany()).count;
            results.studentSchedules = (await tx.studentSchedule.deleteMany()).count;
            results.groupSchedules = (await tx.groupSchedule.deleteMany()).count;
            results.studentGroups = (await tx.studentGroup.deleteMany()).count;
            results.groups = (await tx.group.deleteMany()).count;
            results.bookings = (await tx.booking.deleteMany()).count;
            await tx.student.updateMany({
                where: { referredByStudentId: { not: null } },
                data: { referredByStudentId: null },
            });
            results.students = (await tx.student.deleteMany({ where: { role: 'student' } })).count;
            results.families = (await tx.family.deleteMany()).count;
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
