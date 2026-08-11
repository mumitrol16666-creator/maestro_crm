require('dotenv').config();
const { prisma } = require('../src/config/db');
const { cashboxEffectiveAmount } = require('../src/services/cashboxAccounts');
const { isCashBalanceExcludedCategory } = require('../src/services/cashTransactionCategories');

const applyChanges = process.argv.includes('--apply');
const MIGRATION_MARKER = '[payment-method-migration:kaspi-to-kaspi-pay:v1]';
const SHOP_CATEGORIES = new Set([
    'shop_sale',
    'shop_refund',
    'shop_purchase',
    'cash_reconciliation_shop',
]);
const TARGETS = [
    { scope: 'school', target: 220_000, label: 'КаспиПей · школа' },
    { scope: 'shop', target: 0, label: 'КаспиПей · магазин' },
];

function signedAmount(transaction) {
    const amount = cashboxEffectiveAmount(transaction);
    return transaction.type === 'income' ? amount : -amount;
}

function transactionScope(transaction) {
    return SHOP_CATEGORIES.has(transaction.category) ? 'shop' : 'school';
}

function scopeBalance(transactions, scope) {
    return transactions.reduce((sum, transaction) => {
        if (transaction.paymentMethod !== 'kaspi_pay') return sum;
        if (transactionScope(transaction) !== scope) return sum;
        if (isCashBalanceExcludedCategory(transaction.category)) return sum;
        return sum + signedAmount(transaction);
    }, 0);
}

async function findAuthor(db) {
    const author = await db.student.findFirst({
        where: { role: { in: ['super_admin', 'admin'] }, status: 'active' },
        orderBy: [{ role: 'desc' }, { registeredAt: 'asc' }],
        select: { id: true, name: true, lastName: true },
    });
    if (!author) throw new Error('Не найден активный admin/super_admin для автора миграции');
    return author;
}

async function countLegacyRecords(db) {
    const [payments, cashTransactions, transfersFrom, transfersTo, shopSales] = await Promise.all([
        db.payment.count({ where: { paymentMethod: 'kaspi' } }),
        db.cashTransaction.count({ where: { paymentMethod: 'kaspi' } }),
        db.cashAccountTransfer.count({ where: { fromPaymentMethod: 'kaspi' } }),
        db.cashAccountTransfer.count({ where: { toPaymentMethod: 'kaspi' } }),
        db.shopSale.count({ where: { paymentMethod: 'kaspi' } }),
    ]);
    return { payments, cashTransactions, transfersFrom, transfersTo, shopSales };
}

async function kaspiPayTransactions(db) {
    return db.cashTransaction.findMany({
        where: { paymentMethod: 'kaspi_pay', date: { lte: new Date() } },
        select: {
            type: true,
            amount: true,
            category: true,
            paymentMethod: true,
            relatedPayment: { select: { amount: true, paymentMethod: true } },
        },
    });
}

async function main() {
    const previousRun = await prisma.integrationLog.findFirst({
        where: { idempotencyKey: MIGRATION_MARKER },
        select: { createdAt: true },
    });
    if (previousRun) {
        console.log(`Каспи уже объединён с КаспиПей ${previousRun.createdAt.toISOString()}; повторный запуск пропущен.`);
        return;
    }

    const legacy = await countLegacyRecords(prisma);
    console.table([legacy]);
    if (!applyChanges) {
        console.log('DRY-RUN: записи не изменены. Для применения добавьте --apply');
        return;
    }

    const author = await findAuthor(prisma);
    const result = await prisma.$transaction(async tx => {
        const updates = {
            payments: (await tx.payment.updateMany({
                where: { paymentMethod: 'kaspi' },
                data: { paymentMethod: 'kaspi_pay' },
            })).count,
            cashTransactions: (await tx.cashTransaction.updateMany({
                where: { paymentMethod: 'kaspi' },
                data: { paymentMethod: 'kaspi_pay' },
            })).count,
            transfersFrom: (await tx.cashAccountTransfer.updateMany({
                where: { fromPaymentMethod: 'kaspi' },
                data: { fromPaymentMethod: 'kaspi_pay' },
            })).count,
            transfersTo: (await tx.cashAccountTransfer.updateMany({
                where: { toPaymentMethod: 'kaspi' },
                data: { toPaymentMethod: 'kaspi_pay' },
            })).count,
            shopSales: (await tx.shopSale.updateMany({
                where: { paymentMethod: 'kaspi' },
                data: { paymentMethod: 'kaspi_pay' },
            })).count,
        };

        const transactions = await kaspiPayTransactions(tx);
        const reconciliations = [];
        for (const target of TARGETS) {
            const current = scopeBalance(transactions, target.scope);
            const delta = target.target - current;
            reconciliations.push({ ...target, current, delta });
            if (!delta) continue;
            await tx.cashTransaction.create({
                data: {
                    type: delta > 0 ? 'income' : 'expense',
                    amount: Math.abs(delta),
                    category: `cash_reconciliation_${target.scope}`,
                    description: `Сверка после объединения счетов: ${target.label} → ${target.target.toLocaleString('ru-RU')} ₸`,
                    date: new Date(),
                    paymentMethod: 'kaspi_pay',
                    notes: `${MIGRATION_MARKER} Техническая дельта ${delta.toLocaleString('ru-RU')} ₸. Не учитывать в аналитике.`,
                    createdById: author.id,
                },
            });
        }

        await tx.integrationLog.create({
            data: {
                direction: 'internal',
                system: 'crm',
                operation: 'payment_method.merge',
                method: 'SCRIPT',
                path: 'scripts/merge-kaspi-into-kaspi-pay.js',
                status: 'success',
                responseBody: { updates, reconciliations },
                attempts: 1,
                retryable: false,
                completedAt: new Date(),
                entityType: 'PaymentMethodMigration',
                createdById: author.id,
                idempotencyKey: MIGRATION_MARKER,
            },
        });
        return { updates, reconciliations };
    }, { isolationLevel: 'Serializable' });

    const remainingLegacy = await countLegacyRecords(prisma);
    const remainingCount = Object.values(remainingLegacy).reduce((sum, count) => sum + count, 0);
    if (remainingCount) throw new Error(`После миграции осталось ${remainingCount} записей обычного Каспи`);

    const verifiedTransactions = await kaspiPayTransactions(prisma);
    for (const target of TARGETS) {
        const actual = scopeBalance(verifiedTransactions, target.scope);
        if (actual !== target.target) {
            throw new Error(`${target.label}: ожидалось ${target.target}, получено ${actual}`);
        }
    }

    console.log(JSON.stringify({ success: true, ...result, remainingLegacy }, null, 2));
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
