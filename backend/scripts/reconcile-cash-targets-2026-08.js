require('dotenv').config();
const { prisma } = require('../src/config/db');
const {
    cashboxEffectiveAmount,
    resolveCashboxPaymentMethod,
} = require('../src/services/cashboxAccounts');
const { isCashBalanceExcludedCategory } = require('../src/services/cashTransactionCategories');

const applyChanges = process.argv.includes('--apply');
const SHOP_CATEGORIES = new Set([
    'shop_sale',
    'shop_refund',
    'shop_purchase',
    'cash_reconciliation_shop',
]);

// Это целевые остатки, а не суммы для прибавления.
const TARGETS = [
    { paymentMethod: 'cash', scope: 'shop', target: 5_000, label: 'Наличные · магазин' },
    { paymentMethod: 'cash', scope: 'school', target: 62_000, label: 'Наличные · школа' },
    { paymentMethod: 'kaspi_pay', scope: 'school', target: 220_000, label: 'КаспиПей · школа' },
    { paymentMethod: 'kaspi_pay', scope: 'shop', target: 0, label: 'КаспиПей · магазин' },
    { paymentMethod: 'freedom', scope: 'all', target: 24_000, label: 'Freedom · всего' },
    { paymentMethod: 'halyk', scope: 'all', target: 0, label: 'Халык · всего' },
];

function transactionScope(transaction) {
    return SHOP_CATEGORIES.has(transaction.category) ? 'shop' : 'school';
}

function signedAmount(transaction) {
    const amount = cashboxEffectiveAmount(transaction);
    return transaction.type === 'income' ? amount : -amount;
}

function previousMonthClosingDate(now = new Date()) {
    // 23:59:59 по Asia/Aqtobe (+05:00) последнего дня прошлого месяца.
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 18, 59, 59));
}

async function loadCurrentBalances(db) {
    const transactions = await db.cashTransaction.findMany({
        where: { date: { lte: new Date() } },
        select: {
            type: true,
            amount: true,
            category: true,
            paymentMethod: true,
            relatedPayment: { select: { amount: true, paymentMethod: true } },
            relatedShopSale: { select: { paymentMethod: true } },
        },
    });

    return transactions.filter(transaction => !isCashBalanceExcludedCategory(transaction.category));
}

function currentForTarget(transactions, target) {
    return transactions.reduce((sum, transaction) => {
        if (resolveCashboxPaymentMethod(transaction) !== target.paymentMethod) return sum;
        if (target.scope !== 'all' && transactionScope(transaction) !== target.scope) return sum;
        return sum + signedAmount(transaction);
    }, 0);
}

async function findAuthor(db) {
    const author = await db.student.findFirst({
        where: {
            role: { in: ['super_admin', 'admin'] },
            status: 'active',
        },
        orderBy: [
            { role: 'desc' },
            { registeredAt: 'asc' },
        ],
        select: { id: true, name: true, lastName: true },
    });
    if (!author) throw new Error('Не найден активный admin/super_admin для автора сверки');
    return author;
}

async function main() {
    const transactions = await loadCurrentBalances(prisma);
    const author = await findAuthor(prisma);
    const date = previousMonthClosingDate();
    const plan = TARGETS.map(target => {
        const current = currentForTarget(transactions, target);
        return { ...target, current, delta: target.target - current };
    });

    console.table(plan.map(item => ({
        account: item.label,
        current: item.current,
        target: item.target,
        delta: item.delta,
    })));

    if (!applyChanges) {
        console.log('\nDRY-RUN: изменения не внесены. Для применения добавьте --apply');
        return;
    }

    const changes = plan.filter(item => item.delta !== 0);
    await prisma.$transaction(async tx => {
        for (const item of changes) {
            const categoryScope = item.scope === 'shop' ? 'shop' : 'school';
            await tx.cashTransaction.create({
                data: {
                    type: item.delta > 0 ? 'income' : 'expense',
                    amount: Math.abs(item.delta),
                    category: `cash_reconciliation_${categoryScope}`,
                    description: `Сверка остатка: ${item.label} → ${item.target.toLocaleString('ru-RU')} ₸`,
                    date,
                    paymentMethod: item.paymentMethod,
                    notes: `Разовая сверка текущего остатка. Было ${item.current.toLocaleString('ru-RU')} ₸; целевое значение ${item.target.toLocaleString('ru-RU')} ₸. Не учитывать в аналитике.`,
                    createdById: author.id,
                },
            });
        }
    }, { isolationLevel: 'Serializable' });

    const updatedTransactions = await loadCurrentBalances(prisma);
    const verification = TARGETS.map(target => ({
        account: target.label,
        actual: currentForTarget(updatedTransactions, target),
        expected: target.target,
    }));
    console.table(verification);

    const failed = verification.filter(item => item.actual !== item.expected);
    if (failed.length) throw new Error(`Сверка не сошлась для ${failed.length} счётов`);
    console.log(`\nГотово: ${changes.length} корректировок, дата ${date.toISOString()}, автор ${author.lastName} ${author.name}`);
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
