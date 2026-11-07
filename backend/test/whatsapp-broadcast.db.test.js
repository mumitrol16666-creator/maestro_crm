const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Рассылка из «Напоминаний»: очередь в CRM, пауза между сообщениями держится на сервере,
// отправленное сообщение ставит ту же отметку «Отправлено», что и галочка администратора.
if (!process.env.TEST_DATABASE_URL) {
    test('WhatsApp broadcast queue on PostgreSQL', { skip: 'TEST_DATABASE_URL required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /test|qa/.test(url.pathname));
    const SECRET = 'whatsapp-broadcast-test-secret';
    Object.assign(process.env, {
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        NODE_ENV: 'test',
        JWT_SECRET: 'whatsapp-broadcast-test-jwt',
        WHATSAPP_BROWSER_WORKER_SECRET: SECRET,
    });
    const bcrypt = require('bcryptjs');
    const express = require('express');
    const { prisma } = require('../src/config/db');
    const {
        createBroadcast,
        claimNextBroadcastItem,
        reportBroadcastItemResult,
        cancelBroadcast,
        broadcastOverview,
        STALE_CLAIM_MS,
    } = require('../src/services/whatsappBroadcast');

    const ACCOUNT = 'broadcast-test-account';
    const WORKER = 'broadcast-test-worker';
    let admin, server, base;

    const clean = async () => {
        await prisma.whatsappBroadcast.deleteMany({});
        await prisma.activityLog.deleteMany({ where: { entityType: 'WhatsAppReminder', entityId: { startsWith: 'bc-test:' } } });
        await prisma.whatsappBrowserSession.deleteMany({ where: { accountKey: ACCOUNT } });
    };
    const item = (id, extra = {}) => ({
        reminderId: `bc-test:${id}`,
        studentId: null,
        recipientName: `Ученик ${id}`,
        phone: '8 705 000 00 0' + (String(id).length === 1 ? id : '9'),
        content: `Урок сегодня в 18:00 (${id})`,
        ...extra,
    });
    const at = seconds => new Date(Date.parse('2026-11-07T10:00:00Z') + seconds * 1000);
    const claim = (seconds, workerId = WORKER) => claimNextBroadcastItem(prisma, { workerId, now: at(seconds) });
    const sentMarks = () => prisma.activityLog.findMany({
        where: { entityType: 'WhatsAppReminder', action: 'sent', entityId: { startsWith: 'bc-test:' } },
        orderBy: { createdAt: 'asc' },
    });

    test.before(async () => {
        admin = await prisma.student.create({
            data: {
                name: 'Рассылка', lastName: 'Администратор', role: 'admin',
                phone: `+7${crypto.randomInt(1e9, 9e9)}`, password: await bcrypt.hash('unused-pass', 4),
            },
        });
        await clean();
        const app = express();
        app.use(express.json());
        app.use('/api/internal/whatsapp-browser', require('../src/routes/whatsappBrowserInternal'));
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        base = `http://127.0.0.1:${server.address().port}/api/internal/whatsapp-browser`;
    });

    test.beforeEach(clean);

    test.after(async () => {
        await clean();
        await prisma.activityLog.deleteMany({ where: { userId: admin.id } });
        await prisma.student.delete({ where: { id: admin.id } });
        server?.close();
        await prisma.$disconnect();
    });

    test('only ready messages are queued: no phone, unfilled sum, past lessons and already sent are skipped', async () => {
        await prisma.activityLog.create({
            data: { userId: admin.id, action: 'sent', entityType: 'WhatsAppReminder', entityId: 'bc-test:sent-before' },
        });
        const { broadcast, skipped } = await createBroadcast(prisma, {
            kind: 'today',
            userId: admin.id,
            items: [
                item(1),
                item(2, { phone: '' }),
                item(3, { content: 'Сумма: ___ ₸' }),
                item(1, { content: 'повтор той же карточки' }),
                item(4, { phone: item(1).phone, content: item(1).content }),
                item('sent-before'),
                item(5, { phone: '+7 705 000 00 05' }),
                item(6, { expiresAt: new Date(Date.now() - 60_000).toISOString() }),
            ],
        });
        assert.deepEqual(
            broadcast.items.map(row => [row.reminderId, row.status]),
            [['bc-test:1', 'pending'], ['bc-test:4', 'duplicate'], ['bc-test:5', 'pending']],
            'the same text to the same phone goes once; the second card waits as a duplicate',
        );
        assert.equal(broadcast.items[0].phone, '77050000001');
        assert.deepEqual(skipped.map(row => row.reason).sort(), [
            'в тексте пропуск «___», например не указана сумма', 'нет телефона', 'уже отправлено', 'урок уже начался',
        ].sort());

        await assert.rejects(createBroadcast(prisma, { kind: 'payments', userId: admin.id, items: [item(1)] }), /Некорректная очередь/);
        await assert.rejects(
            createBroadcast(prisma, { kind: 'tomorrow', userId: admin.id, items: [item(7)] }),
            error => error.status === 409 && /Уже идёт рассылка «Сегодня урок»/.test(error.message),
            'one broadcast at a time',
        );
    });

    test('a card already in a broadcast, sent or possibly sent is never queued again', async () => {
        const { broadcast } = await createBroadcast(prisma, { kind: 'today', userId: admin.id, items: [item(1), item(2)] });
        const first = await claim(0);
        await reportBroadcastItemResult(prisma, { itemId: first.item.id, workerId: WORKER, status: 'uncertain', error: 'нет галочки' });
        await cancelBroadcast(prisma, broadcast.id);

        await assert.rejects(
            createBroadcast(prisma, { kind: 'today', userId: admin.id, items: [item(1)] }),
            /Отправлять некому/,
            'an uncertain message is not sent a second time',
        );
        const again = await createBroadcast(prisma, { kind: 'today', userId: admin.id, items: [item(1), item(2)] });
        assert.deepEqual(again.broadcast.items.map(row => row.reminderId), ['bc-test:2']);
        assert.equal(again.skipped[0].reason, 'уже в рассылке или, возможно, ушло рассылкой');
    });

    test('ticked by hand while waiting in the queue: the bot skips the card', async () => {
        await createBroadcast(prisma, { kind: 'today', userId: admin.id, items: [item(1), item(2)] });
        await prisma.activityLog.create({
            data: { userId: admin.id, action: 'sent', entityType: 'WhatsAppReminder', entityId: 'bc-test:1' },
        });
        const next = await claim(0);
        assert.equal(next.item.phoneNumber, '77050000002');
        const skippedItem = await prisma.whatsappBroadcastItem.findFirst({ where: { reminderId: 'bc-test:1' } });
        assert.equal(skippedItem.status, 'cancelled');
    });

    test('a reminder past its time is not sent; the queue moves on', async () => {
        await createBroadcast(prisma, {
            kind: 'today',
            userId: admin.id,
            items: [item(1, { expiresAt: at(100).toISOString() }), item(2, { expiresAt: at(10_000).toISOString() })],
            now: at(0),
        });
        const next = await claim(200);
        assert.equal(next.item.phoneNumber, '77050000002');
        const expired = await prisma.whatsappBroadcastItem.findFirst({ where: { reminderId: 'bc-test:1' } });
        assert.equal(expired.status, 'expired');
    });

    test('one message for two cards on the same phone: both are marked as sent', async () => {
        await createBroadcast(prisma, {
            kind: 'homework',
            userId: admin.id,
            items: [item(1), item(2, { phone: item(1).phone, content: item(1).content })],
        });
        const first = await claim(0);
        await reportBroadcastItemResult(prisma, { itemId: first.item.id, workerId: WORKER, status: 'sent' });
        const marks = await sentMarks();
        assert.deepEqual(marks.map(row => row.entityId).sort(), ['bc-test:1', 'bc-test:2']);
        assert.equal(marks[0].metadata.reminderLabel, 'Домашнее задание', 'same label as the manual tick');
        assert.deepEqual(await claim(1000), { item: null, waitSeconds: null });
        const [row] = await prisma.whatsappBroadcast.findMany({});
        assert.equal(row.status, 'done');
    });

    test('own list: ids come from phone and text, the same text to the same phone goes once a day', async () => {
        const morning = new Date('2026-11-07T04:00:00Z');
        const list = [
            { recipientName: 'Айгерим', phone: '8 705 000 00 01', content: 'Урок сегодня перенесён на 19:00' },
            { recipientName: 'Данияр', phone: '+7 705 000 00 02', content: 'Урок сегодня перенесён на 19:00' },
            { recipientName: 'Повтор', phone: '87050000001', content: 'Урок сегодня перенесён на 19:00' },
        ];
        const { broadcast } = await createBroadcast(prisma, { kind: 'custom', userId: admin.id, items: list, now: morning });
        assert.equal(broadcast.label, 'Своя рассылка');
        assert.equal(broadcast.items.length, 2, 'the same phone with the same text is queued once');
        assert.ok(broadcast.items.every(row => /^custom:2026-11-07:[0-9a-f]{20}$/.test(row.reminderId) && row.studentId === null));

        const first = await claim(0);
        await reportBroadcastItemResult(prisma, { itemId: first.item.id, workerId: WORKER, status: 'sent' });
        const [mark] = await prisma.activityLog.findMany({ where: { entityType: 'WhatsAppReminder', entityId: { startsWith: 'custom:' } } });
        assert.equal(mark.details, 'Айгерим — Рассылка — Своя рассылка');
        await cancelBroadcast(prisma, broadcast.id);

        const again = await createBroadcast(prisma, { kind: 'custom', userId: admin.id, items: list.slice(0, 2), now: morning });
        assert.deepEqual(again.broadcast.items.map(row => row.phone), ['77050000002'], 'Айгерим already got this text today');
        assert.equal(again.skipped[0].reason, 'этот текст на этот номер сегодня уже ушёл');
        await cancelBroadcast(prisma, again.broadcast.id);

        const tomorrow = await createBroadcast(prisma, { kind: 'custom', userId: admin.id, items: list.slice(0, 1), now: new Date('2026-11-08T04:00:00Z') });
        assert.equal(tomorrow.broadcast.items.length, 1, 'the next day the same text may go again');
        await prisma.activityLog.deleteMany({ where: { entityType: 'WhatsAppReminder', entityId: { startsWith: 'custom:' } } });
    });

    test('one message at a time, then a three-minute pause; sent marks the reminder as sent', async () => {
        await createBroadcast(prisma, { kind: 'today', userId: admin.id, items: [item(1), item(2), item(3)] });

        const first = await claim(0);
        assert.equal(first.item.phoneNumber, '77050000001');
        assert.equal(first.item.content, 'Урок сегодня в 18:00 (1)');
        assert.deepEqual(await claim(1), { item: null, waitSeconds: 5 }, 'a claimed message blocks the next one');

        await reportBroadcastItemResult(prisma, { itemId: first.item.id, workerId: WORKER, status: 'sent', externalMessageId: 'true_7705@c.us_A' });
        const marks = await sentMarks();
        assert.equal(marks.length, 1);
        assert.equal(marks[0].entityId, 'bc-test:1');
        assert.equal(marks[0].userId, admin.id);
        await assert.rejects(
            reportBroadcastItemResult(prisma, { itemId: first.item.id, workerId: WORKER, status: 'sent' }),
            /не закреплено/,
            'a result is accepted once',
        );

        const early = await claim(60);
        assert.equal(early.item, null);
        assert.equal(early.waitSeconds, 120);
        const second = await claim(180);
        assert.equal(second.item.phoneNumber, '77050000002');

        await reportBroadcastItemResult(prisma, { itemId: second.item.id, workerId: WORKER, status: 'invalid', error: 'Номера нет в WhatsApp' });
        assert.equal((await sentMarks()).length, 1, 'a number without WhatsApp is not marked as sent');

        const third = await claim(360);
        await assert.rejects(
            reportBroadcastItemResult(prisma, { itemId: third.item.id, workerId: 'other-worker', status: 'sent' }),
            /не закреплено/,
        );
        await reportBroadcastItemResult(prisma, { itemId: third.item.id, workerId: WORKER, status: 'sent' });
        const [row] = await prisma.whatsappBroadcast.findMany({});
        assert.equal(row.status, 'done');
        assert.ok(row.finishedAt);
        assert.deepEqual(await claim(1000), { item: null, waitSeconds: null });
    });

    test('a message the worker never reported is not sent again', async () => {
        await createBroadcast(prisma, { kind: 'tomorrow', userId: admin.id, items: [item(1), item(2)] });
        const first = await claim(0);
        const later = await claim(STALE_CLAIM_MS / 1000 + 1);
        const stale = await prisma.whatsappBroadcastItem.findUnique({ where: { id: first.item.id } });
        assert.equal(stale.status, 'uncertain');
        assert.equal(later.item.phoneNumber, '77050000002', 'the queue moves on to the next number');
    });

    test('stop: messages not yet sent stay unsent', async () => {
        const { broadcast } = await createBroadcast(prisma, { kind: 'today', userId: admin.id, items: [item(1), item(2)] });
        const first = await claim(0);
        await cancelBroadcast(prisma, broadcast.id);
        await reportBroadcastItemResult(prisma, { itemId: first.item.id, workerId: WORKER, status: 'sent' });
        assert.deepEqual(await claim(1000), { item: null, waitSeconds: null });
        const statuses = (await prisma.whatsappBroadcastItem.findMany({ orderBy: { position: 'asc' } })).map(row => row.status);
        assert.deepEqual(statuses, ['sent', 'cancelled']);
        const overview = await broadcastOverview(prisma);
        assert.equal(overview.broadcasts[0].status, 'cancelled');
        assert.equal(overview.broadcasts[0].counts.sent, 1);
    });

    test('the worker API gives a message only to the connected worker that owns the WhatsApp session', async () => {
        await createBroadcast(prisma, { kind: 'today', userId: admin.id, items: [item(1)] });
        const call = (path, body, workerId = WORKER) => fetch(base + path, {
            method: 'POST',
            headers: { Authorization: `Bearer ${SECRET}`, 'X-Whatsapp-Worker-Id': workerId, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then(async response => ({ status: response.status, body: await response.json() }));

        assert.equal((await call('/broadcast/claim', { accountKey: ACCOUNT })).status, 409, 'no session yet');
        await call('/heartbeat', { accountKey: ACCOUNT, status: 'connected', mode: 'observer', metadata: { broadcast: true } });
        assert.equal((await call('/broadcast/claim', { accountKey: ACCOUNT }, 'old-server-worker')).status, 409, 'another worker');

        const claimed = await call('/broadcast/claim', { accountKey: ACCOUNT });
        assert.equal(claimed.status, 200);
        assert.equal(claimed.body.message.phoneNumber, '77050000001');
        const overview = await broadcastOverview(prisma);
        assert.equal(overview.worker.online, true);

        const reported = await call(`/broadcast/${claimed.body.message.id}/result`, { status: 'sent' });
        assert.equal(reported.status, 200);
        assert.equal((await call(`/broadcast/${claimed.body.message.id}/result`, { status: 'sent' })).status, 409);
        assert.equal((await call(`/broadcast/${claimed.body.message.id}/result`, { status: 'maybe' })).status, 400);
    });
}
