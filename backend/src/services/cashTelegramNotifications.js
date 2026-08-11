const { getPaymentMethodLabel } = require('./paymentMethods');
const { buildCashboxAccountSummary, resolveCashboxPaymentMethod } = require('./cashboxAccounts');

const CASH_NOTIFICATION_OPERATION = 'cash_transaction.created';
const CASH_NOTIFICATION_PATH = 'telegram:cashbox';
const MAX_NOTIFICATION_ATTEMPTS = 5;
const IGNORED_CATEGORIES = new Set([
    'account_transfer_in',
    'account_transfer_out',
    'correction',
    'balance_adjustment',
]);

const CATEGORY_LABELS = Object.freeze({
    payment: 'Оплата обучения',
    trial_payment: 'Диагностический урок',
    refund: 'Возврат',
    deletion: 'Удаление платежа',
    salary: 'Зарплата',
    salary_advance: 'Аванс',
    shop_purchase: 'Закупка магазина',
    shop_sale: 'Продажа магазина',
    shop_refund: 'Возврат магазина',
});

const CASHBOX_ACCOUNT_SELECT = {
    type: true,
    amount: true,
    category: true,
    paymentMethod: true,
    relatedPayment: { select: { amount: true, paymentMethod: true } },
    relatedShopSale: { select: { paymentMethod: true } },
};

function defaultDb() {
    // Lazy import keeps pure formatting/outbox unit tests independent from PostgreSQL.
    return require('../config/db').prisma;
}

function telegramSender() {
    // Telegram/axios загружается только worker-процессом, а не pure unit tests.
    return require('../utils/telegram').sendTelegramNotification;
}

function notificationsEnabled() {
    return process.env.TELEGRAM_CASHBOX_NOTIFICATIONS_ENABLED !== 'false';
}

function shouldNotifyCashTransaction(transaction) {
    return Boolean(
        transaction
        && ['income', 'expense'].includes(transaction.type)
        && Number(transaction.amount) > 0
        && !IGNORED_CATEGORIES.has(transaction.category)
    );
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatMoney(amount) {
    return `${Math.round(Number(amount) || 0).toLocaleString('ru-RU')} ₸`;
}

function personName(person, fallback = 'Система') {
    return [person?.lastName, person?.name, person?.middleName]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join(' ') || fallback;
}

function formatCashTransactionNotification(transaction, accountBalance = null) {
    const income = transaction.type === 'income';
    const title = income ? '💰 Приход в кассу' : '🔻 Расход из кассы';
    const sign = income ? '+' : '−';
    const account = getPaymentMethodLabel(resolveCashboxPaymentMethod(transaction)) || 'Не указан';
    const category = CATEGORY_LABELS[transaction.category] || transaction.category || 'Не указана';
    const description = String(transaction.description || '').trim();
    const notes = String(transaction.notes || '').trim();
    const lines = [
        `<b>${title}</b>`,
        '',
        `<b>${sign}${formatMoney(transaction.amount)}</b>`,
        `Счёт: ${escapeHtml(account)}`,
        `Операция: ${escapeHtml(description || category)}`,
        `Категория: ${escapeHtml(category)}`,
        `Провёл: ${escapeHtml(personName(transaction.createdBy))}`,
    ];
    if (accountBalance !== null && Number.isFinite(Number(accountBalance))) {
        lines.push(`Остаток счёта: <b>${formatMoney(accountBalance)}</b>`);
    }
    if (notes && notes !== description) lines.push(`Комментарий: ${escapeHtml(notes)}`);
    return lines.join('\n');
}

/**
 * Создаёт движение и задачу Telegram в одной транзакции.
 * Внешний HTTP-запрос здесь не выполняется, поэтому Telegram не может откатить кассу.
 */
async function createCashTransaction(tx, data, options = {}) {
    const transaction = await tx.cashTransaction.create({ data });
    if (options.notify === false || !shouldNotifyCashTransaction(transaction)) return transaction;

    await tx.integrationLog.create({
        data: {
            direction: 'outbound',
            system: 'telegram',
            operation: CASH_NOTIFICATION_OPERATION,
            method: 'POST',
            path: CASH_NOTIFICATION_PATH,
            status: 'pending',
            requestBody: { cashTransactionId: transaction.id },
            attempts: 0,
            retryable: true,
            nextRetryAt: new Date(),
            entityType: 'CashTransaction',
            entityId: transaction.id,
            createdById: transaction.createdById || null,
            idempotencyKey: `telegram:cash:${transaction.id}`,
        },
    });
    return transaction;
}

async function claimPendingNotifications(limit = 10, db = defaultDb()) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
    return db.$transaction(async tx => {
        const rows = await tx.$queryRaw`
            SELECT id
            FROM "IntegrationLog"
            WHERE system = 'telegram'
              AND operation = ${CASH_NOTIFICATION_OPERATION}
              AND retryable = true
              AND (
                    status IN ('pending', 'failed')
                    OR (status = 'processing' AND "lastAttemptAt" < NOW() - INTERVAL '2 minutes')
              )
              AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= NOW())
            ORDER BY "createdAt" ASC
            LIMIT ${safeLimit}
            FOR UPDATE SKIP LOCKED
        `;
        const ids = rows.map(row => row.id);
        if (!ids.length) return [];
        await tx.integrationLog.updateMany({
            where: { id: { in: ids } },
            data: {
                status: 'processing',
                attempts: { increment: 1 },
                lastAttemptAt: new Date(),
                errorMessage: null,
            },
        });
        return ids;
    });
}

async function getAccountBalance(transaction, db = defaultDb()) {
    const method = resolveCashboxPaymentMethod(transaction);
    if (!method) return null;
    const transactions = await db.cashTransaction.findMany({
        where: { date: { lte: new Date() } },
        select: CASHBOX_ACCOUNT_SELECT,
    });
    const account = buildCashboxAccountSummary([], transactions)
        .find(item => item.paymentMethod === method);
    return account ? Number(account.currentBalance || 0) : null;
}

function nextRetryDate(attempts) {
    const minutes = Math.min(2 ** Math.max(0, attempts - 1), 60);
    return new Date(Date.now() + minutes * 60 * 1000);
}

async function processClaimedNotification(logId, db = defaultDb(), sender = telegramSender()) {
    const log = await db.integrationLog.findUnique({ where: { id: logId } });
    if (!log || log.status !== 'processing') return false;

    const transaction = log.entityId
        ? await db.cashTransaction.findUnique({
            where: { id: log.entityId },
            include: {
                createdBy: { select: { name: true, lastName: true, middleName: true } },
                relatedPayment: { select: { amount: true, paymentMethod: true } },
                relatedShopSale: { select: { paymentMethod: true } },
            },
        })
        : null;

    if (!transaction) {
        await db.integrationLog.update({
            where: { id: log.id },
            data: {
                status: 'failed',
                retryable: false,
                completedAt: new Date(),
                errorMessage: 'Движение кассы не найдено',
            },
        });
        return false;
    }

    try {
        const balance = await getAccountBalance(transaction, db);
        const sent = await sender(formatCashTransactionNotification(transaction, balance));
        if (!sent) throw new Error('Telegram не подтвердил отправку');
        await db.integrationLog.update({
            where: { id: log.id },
            data: {
                status: 'success',
                responseStatus: 200,
                responseBody: { delivered: true },
                retryable: false,
                nextRetryAt: null,
                completedAt: new Date(),
                errorMessage: null,
            },
        });
        return true;
    } catch (error) {
        const exhausted = log.attempts >= MAX_NOTIFICATION_ATTEMPTS;
        await db.integrationLog.update({
            where: { id: log.id },
            data: {
                status: 'failed',
                retryable: !exhausted,
                nextRetryAt: exhausted ? null : nextRetryDate(log.attempts),
                completedAt: exhausted ? new Date() : null,
                errorMessage: String(error.message || error).slice(0, 2000),
            },
        });
        return false;
    }
}

let processing = false;

async function processPendingCashTelegramNotifications(options = {}) {
    if (!notificationsEnabled() || processing) return { claimed: 0, sent: 0 };
    processing = true;
    try {
        const db = options.db || defaultDb();
        const sender = options.sender || telegramSender();
        const ids = await claimPendingNotifications(options.limit || 10, db);
        let sent = 0;
        for (const id of ids) {
            if (await processClaimedNotification(id, db, sender)) sent += 1;
        }
        return { claimed: ids.length, sent };
    } finally {
        processing = false;
    }
}

module.exports = {
    CASH_NOTIFICATION_OPERATION,
    IGNORED_CATEGORIES,
    createCashTransaction,
    formatCashTransactionNotification,
    processPendingCashTelegramNotifications,
    shouldNotifyCashTransaction,
};
