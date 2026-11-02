const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) {
    test('app_registration booking + PostgreSQL', { skip: 'TEST_DATABASE_URL required' }, () => {});
} else {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /test|qa/.test(url.pathname));
    Object.assign(process.env, {
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        NODE_ENV: 'test',
        INTEGRATION_SERVICE_SECRET: 'app-registration-test',
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: 'test-chat',
    });
    const { prisma } = require('../src/config/db');
    const { createAppOnlineLessonBooking, resolveRequestType } = require('../src/services/integrationBooking');

    const realFetch = globalThis.fetch;
    const telegramMessages = [];
    globalThis.fetch = async (input, init) => {
        const target = String(input?.url || input);
        if (target.startsWith('https://api.telegram.org/')) {
            telegramMessages.push(JSON.parse(init.body).text);
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return realFetch(input, init);
    };
    const waitFor = async (predicate) => {
        for (let i = 0; i < 50 && !predicate(); i += 1) await new Promise((r) => setTimeout(r, 20));
    };

    const created = [];
    const payload = (extra = {}) => {
        const externalSourceId = `app-reg-${randomUUID()}`;
        created.push(externalSourceId);
        return {
            externalSourceId,
            requestType: 'app_registration',
            name: 'Айдана',
            lastName: 'Серикова',
            phone: `+7701${Date.now().toString().slice(-7)}`,
            ...extra,
        };
    };

    test.after(async () => {
        globalThis.fetch = realFetch;
        await prisma.booking.deleteMany({ where: { externalSourceId: { in: created } } });
        await prisma.$disconnect();
    });

    test('resolveRequestType: старые типы и неизвестное значение работают как раньше', () => {
        assert.equal(resolveRequestType('trial'), 'trial');
        assert.equal(resolveRequestType('online_lesson'), 'online_lesson');
        assert.equal(resolveRequestType('app_registration'), 'app_registration');
        assert.equal(resolveRequestType(undefined), 'online_lesson');
        assert.equal(resolveRequestType('whatever'), 'online_lesson');
    });

    test('app_registration создаёт заявку с источником, направлением и комментарием, без ученика и денег', async () => {
        const before = {
            students: await prisma.student.count(),
            payments: await prisma.payment.count(),
            memberships: await prisma.membership.count(),
        };
        const body = payload({ comment: 'Ребёнок: Мира' });
        const result = await createAppOnlineLessonBooking(body);
        assert.equal(result.success, true);
        assert.equal(result.data.status, 'new');
        const booking = await prisma.booking.findUnique({ where: { externalSourceId: body.externalSourceId } });
        assert.equal(booking.requestType, 'app_registration');
        assert.equal(booking.source, 'Приложение — регистрация');
        assert.equal(booking.direction, 'Курсы в приложении');
        assert.equal(booking.createdBy, 'learning-platform');
        assert.equal(booking.convertedToStudentId, null);
        assert.match(booking.notes, /Комментарий: Ребёнок: Мира/);
        assert.doesNotMatch(booking.notes, /Уровень|Удобное время/);
        assert.deepEqual({
            students: await prisma.student.count(),
            payments: await prisma.payment.count(),
            memberships: await prisma.membership.count(),
        }, before);

        await waitFor(() => telegramMessages.some((m) => m.includes(booking.id)));
        const message = telegramMessages.find((m) => m.includes(booking.id));
        assert.ok(message, 'Telegram notification sent');
        assert.match(message, /Регистрация в приложении/);
        assert.match(message, /Ребёнок: Мира/);
    });

    test('app_registration: направление не требуется от платформы, чужое направление игнорируется', async () => {
        const noDirection = await createAppOnlineLessonBooking(payload());
        assert.equal(noDirection.success, true);
        const other = payload({ direction: 'Гитара' });
        assert.equal((await createAppOnlineLessonBooking(other)).success, true);
        assert.equal((await prisma.booking.findUnique({ where: { externalSourceId: other.externalSourceId } })).direction, 'Курсы в приложении');
    });

    test('app_registration: без телефона или имени заявка отклоняется', async () => {
        const noPhone = await createAppOnlineLessonBooking(payload({ phone: '' }));
        assert.equal(noPhone.success, false);
        assert.equal(noPhone.status, 400);
        const noName = await createAppOnlineLessonBooking(payload({ name: '' }));
        assert.equal(noName.status, 400);
    });

    test('повтор того же externalSourceId не создаёт вторую заявку и не шлёт второе уведомление', async () => {
        const body = payload({ comment: 'Ребёнок: Мира' });
        const first = await createAppOnlineLessonBooking(body);
        await waitFor(() => telegramMessages.some((m) => m.includes(first.data.crmBookingId)));
        const sent = telegramMessages.length;
        const second = await createAppOnlineLessonBooking({ ...body, comment: 'другое' });
        assert.equal(second.success, true);
        assert.equal(second.data.crmBookingId, first.data.crmBookingId);
        assert.equal(await prisma.booking.count({ where: { externalSourceId: body.externalSourceId } }), 1);
        await new Promise((r) => setTimeout(r, 100));
        assert.equal(telegramMessages.length, sent);
        assert.match((await prisma.booking.findUnique({ where: { id: first.data.crmBookingId } })).notes, /Ребёнок: Мира/);
    });

    test('HTTP: POST /bookings/online-lesson принимает app_registration, повтор с тем же ключом идемпотентен', async () => {
        const express = require('express');
        const app = express();
        app.use(express.json());
        app.use(require('../src/middleware/idempotency'));
        app.use('/api/integration/v1', require('../src/routes/integration'));
        const server = app.listen(0, '127.0.0.1');
        await new Promise((r) => server.once('listening', r));
        try {
            const body = payload({ comment: 'Ребёнок: Мира' });
            const key = `reg-${randomUUID()}`;
            const send = (data) => realFetch(`http://127.0.0.1:${server.address().port}/api/integration/v1/bookings/online-lesson`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer app-registration-test',
                    'X-Integration-System': 'learning-platform',
                    'X-Idempotency-Key': key,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });
            const first = await send(body);
            assert.equal(first.status, 201);
            const firstBody = await first.json();
            assert.equal(firstBody.success, true);
            const replay = await send(body);
            assert.equal(replay.status, 201);
            assert.equal((await replay.json()).data.crmBookingId, firstBody.data.crmBookingId);
            // Same externalSourceId without the idempotency key: still one booking.
            const noKey = await realFetch(`http://127.0.0.1:${server.address().port}/api/integration/v1/bookings/online-lesson`, {
                method: 'POST',
                headers: { Authorization: 'Bearer app-registration-test', 'X-Integration-System': 'learning-platform', 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            assert.equal((await noKey.json()).data.crmBookingId, firstBody.data.crmBookingId);
            assert.equal(await prisma.booking.count({ where: { externalSourceId: body.externalSourceId } }), 1);
        } finally {
            await new Promise((r) => server.close(r));
        }
    });

    test('старые типы заявок не изменились: источник, направление, заметки', async () => {
        const online = {
            externalSourceId: `app-old-${randomUUID()}`,
            name: 'Ученик', lastName: 'Один', phone: '+77010000001',
            direction: 'Гитара', level: 'Начальный', preferredTime: 'вечером', comment: 'привет',
        };
        const trial = { ...online, externalSourceId: `app-old-${randomUUID()}`, requestType: 'trial' };
        created.push(online.externalSourceId, trial.externalSourceId);
        assert.equal((await createAppOnlineLessonBooking(online)).success, true);
        assert.equal((await createAppOnlineLessonBooking(trial)).success, true);
        const a = await prisma.booking.findUnique({ where: { externalSourceId: online.externalSourceId } });
        const b = await prisma.booking.findUnique({ where: { externalSourceId: trial.externalSourceId } });
        assert.equal(a.requestType, 'online_lesson');
        assert.equal(a.source, 'Приложение — онлайн-урок');
        assert.equal(a.direction, 'Гитара');
        assert.equal(a.notes, 'Тип заявки: онлайн-урок\nУровень: Начальный\nУдобное время: вечером\nКомментарий ученика: привет');
        assert.equal(b.requestType, 'trial');
        assert.equal(b.source, 'Приложение — пробный урок');
        assert.match(b.notes, /^Тип заявки: пробный урок/);
        const missing = await createAppOnlineLessonBooking({ ...online, externalSourceId: `x-${randomUUID()}`, direction: '' });
        assert.equal(missing.status, 400);
    });
}
