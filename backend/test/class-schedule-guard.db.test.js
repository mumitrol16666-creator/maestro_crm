const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_DATABASE_URL) {
    test('PostgreSQL class schedule guard', { skip: 'TEST_DATABASE_URL не задан' }, () => {});
} else {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

    const { prisma } = require('../src/config/db');
    const {
        acquireClassScheduleLocks,
        findClassScheduleConflict,
        classScheduleConflictError,
    } = require('../src/services/classScheduleGuard');

    async function createSafely(classData) {
        return prisma.$transaction(async (tx) => {
            await acquireClassScheduleLocks(tx, [classData]);
            const conflict = await findClassScheduleConflict(tx, classData);
            if (conflict) throw classScheduleConflictError(conflict, 'Время уже занято');
            return tx.class.create({ data: classData });
        });
    }

    test.before(async () => {
        await prisma.$connect();
        await prisma.class.deleteMany();
        await prisma.room.deleteMany();
    });

    test.after(async () => {
        await prisma.$disconnect();
    });

    test('concurrent overlapping inserts keep one class and allow an adjacent class', async () => {
        const room = await prisma.room.create({ data: { name: 'DB guard room' } });
        const base = {
            roomId: room.id,
            title: 'DB guard lesson',
            date: new Date('2026-09-20T00:00:00.000Z'),
            duration: 60,
            status: 'scheduled',
        };

        const results = await Promise.allSettled([
            createSafely({ ...base, startTime: '10:00', endTime: '11:00' }),
            createSafely({ ...base, startTime: '10:30', endTime: '11:30' }),
        ]);

        assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
        const rejected = results.find(item => item.status === 'rejected');
        assert.equal(rejected.reason.code, 'CLASS_SCHEDULE_CONFLICT');
        assert.equal(await prisma.class.count({ where: { roomId: room.id } }), 1);

        const existing = await prisma.class.findFirst({ where: { roomId: room.id } });
        const adjacentStart = existing.endTime;
        const adjacentEnd = adjacentStart === '11:00' ? '12:00' : '12:30';
        await createSafely({ ...base, startTime: adjacentStart, endTime: adjacentEnd });
        assert.equal(await prisma.class.count({ where: { roomId: room.id } }), 2);

        const legacyRoom = await prisma.room.create({ data: { name: 'DB guard legacy date room' } });
        await prisma.class.create({
            data: {
                ...base,
                roomId: legacyRoom.id,
                date: new Date('2026-09-19T19:00:00.000Z'),
                startTime: '14:00',
                endTime: '15:00',
            },
        });
        await assert.rejects(
            createSafely({
                ...base,
                roomId: legacyRoom.id,
                date: new Date('2026-09-20T00:00:00.000Z'),
                startTime: '14:30',
                endTime: '15:30',
            }),
            error => error.code === 'CLASS_SCHEDULE_CONFLICT',
        );
    });
}
