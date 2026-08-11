const test = require('node:test');
const assert = require('node:assert/strict');

const {
    CASH_NOTIFICATION_OPERATION,
    createCashTransaction,
    formatCashTransactionNotification,
    processPendingCashTelegramNotifications,
    shouldNotifyCashTransaction,
} = require('../src/services/cashTelegramNotifications');

function makeTx() {
    const cash = [];
    const outbox = [];
    return {
        cash,
        outbox,
        cashTransaction: {
            create: async ({ data }) => {
                const transaction = { id: `cash-${cash.length + 1}`, ...data };
                cash.push(transaction);
                return transaction;
            },
        },
        integrationLog: {
            create: async ({ data }) => {
                outbox.push(data);
                return { id: `log-${outbox.length}`, ...data };
            },
        },
    };
}

test('реальный приход создаёт Telegram outbox в той же транзакции', async () => {
    const tx = makeTx();
    const transaction = await createCashTransaction(tx, {
        type: 'income',
        amount: 12000,
        category: 'payment',
        description: 'Оплата обучения: Тестовый ученик',
        createdById: 'admin-1',
        paymentMethod: 'kaspi',
        notes: '',
    });

    assert.equal(tx.cash.length, 1);
    assert.equal(tx.outbox.length, 1);
    assert.equal(tx.outbox[0].operation, CASH_NOTIFICATION_OPERATION);
    assert.equal(tx.outbox[0].entityId, transaction.id);
    assert.equal(tx.outbox[0].status, 'pending');
    assert.equal(tx.outbox[0].retryable, true);
});

test('внутренний перевод между счетами не выглядит как новый доход или расход', async () => {
    const tx = makeTx();
    await createCashTransaction(tx, {
        type: 'expense',
        amount: 5000,
        category: 'account_transfer_out',
        description: 'Перевод между счетами',
        createdById: 'admin-1',
        paymentMethod: 'kaspi',
    });

    assert.equal(tx.cash.length, 1);
    assert.equal(tx.outbox.length, 0);
    assert.equal(shouldNotifyCashTransaction(tx.cash[0]), false);
});

test('формат прихода короткий, экранирует HTML и показывает остаток', () => {
    const message = formatCashTransactionNotification({
        type: 'income',
        amount: 12000,
        category: 'payment',
        description: 'Оплата <абонемента>',
        paymentMethod: 'kaspi',
        notes: 'Без комментария',
        createdBy: { name: 'Анна', lastName: 'Администратор' },
    }, 42000);

    assert.match(message, /💰 Приход в кассу/);
    assert.match(message, /\+12 000 ₸/);
    assert.match(message, /Каспи/);
    assert.match(message, /Оплата &lt;абонемента&gt;/);
    assert.match(message, /Администратор Анна/);
    assert.match(message, /42 000 ₸/);
});

test('формат расхода показывает минус и категорию', () => {
    const message = formatCashTransactionNotification({
        type: 'expense',
        amount: 4000,
        category: 'salary_advance',
        description: 'Выдача аванса',
        paymentMethod: 'cash',
        notes: '',
        createdBy: { name: 'Иван', lastName: 'Админ' },
    });

    assert.match(message, /🔻 Расход из кассы/);
    assert.match(message, /−4 000 ₸/);
    assert.match(message, /Наличные/);
    assert.match(message, /Аванс/);
});

function makeProcessorDb() {
    const log = {
        id: 'log-1',
        status: 'pending',
        attempts: 0,
        retryable: true,
        entityId: 'cash-1',
    };
    const transaction = {
        id: 'cash-1',
        type: 'income',
        amount: 7000,
        category: 'payment',
        description: 'Оплата обучения',
        paymentMethod: 'kaspi',
        notes: '',
        createdBy: { name: 'Анна', lastName: 'Администратор' },
        relatedPayment: { amount: 7000, paymentMethod: 'kaspi' },
        relatedShopSale: null,
    };
    const applyLogData = (data) => {
        for (const [key, value] of Object.entries(data)) {
            if (key === 'attempts' && value?.increment) log.attempts += value.increment;
            else log[key] = value;
        }
    };
    const integrationLog = {
        updateMany: async ({ data }) => {
            applyLogData(data);
            return { count: 1 };
        },
        findUnique: async () => ({ ...log }),
        update: async ({ data }) => {
            applyLogData(data);
            return { ...log };
        },
    };
    const db = {
        log,
        integrationLog,
        cashTransaction: {
            findUnique: async () => transaction,
            findMany: async () => [transaction],
        },
        $transaction: async callback => callback({
            $queryRaw: async () => [{ id: log.id }],
            integrationLog,
        }),
    };
    return db;
}

test('worker отправляет pending-уведомление и отмечает его доставленным', async () => {
    const db = makeProcessorDb();
    const messages = [];
    const result = await processPendingCashTelegramNotifications({
        db,
        sender: async message => {
            messages.push(message);
            return true;
        },
    });

    assert.deepEqual(result, { claimed: 1, sent: 1 });
    assert.equal(messages.length, 1);
    assert.match(messages[0], /\+7 000 ₸/);
    assert.equal(db.log.status, 'success');
    assert.equal(db.log.retryable, false);
    assert.ok(db.log.completedAt instanceof Date);
});
